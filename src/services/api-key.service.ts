/**
 * API Key Management Service
 * Handles API key creation, validation, and usage tracking
 *
 * Key Format: cito_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx (cito_ prefix + 32 hex chars)
 *
 * Rate Limits by Tier:
 * - FREE: 100/day, 250/month, NO live data
 * - DEVELOPER ($29): 10k/day, NO live data
 * - BUSINESS ($99): 100k/day, live data, webhooks
 * - ENTERPRISE: Custom limits
 */

import crypto from 'crypto';
import { prisma } from '../db/client.js';
import { ApiKey, ApiUser } from '@prisma/client';
import { TIER_CONFIG } from './stripe.service.js';

// ============ TYPES ============

export interface ApiKeyValidation {
  valid: boolean;
  error?: string;
  apiKey?: ApiKey & { user: ApiUser };
  rateLimitRemaining?: number;
  monthlyLimitRemaining?: number;
}

export interface CreateKeyOptions {
  name: string;
  userId: string;
  expiresInDays?: number;
}

// ============ KEY GENERATION ============

/**
 * Generate a new API key
 * Format: cito_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 */
function generateApiKey(): { key: string; prefix: string; hash: string } {
  const randomBytes = crypto.randomBytes(32).toString('hex');
  const key = `cito_${randomBytes}`;
  const prefix = key.slice(0, 12); // cito_xxxxxxx
  const hash = crypto.createHash('sha256').update(key).digest('hex');

  return { key, prefix, hash };
}

/**
 * Hash an API key for storage/lookup
 */
function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// ============ KEY MANAGEMENT ============

/**
 * Create a new API key for a user
 */
export async function createApiKey(options: CreateKeyOptions): Promise<{
  apiKey: ApiKey;
  rawKey: string;
}> {
  const { name, userId, expiresInDays } = options;

  // Get user to determine tier
  const user = await prisma.apiUser.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new Error('User not found');
  }

  // Check how many keys user already has (limit to 5 for non-enterprise)
  const existingKeys = await prisma.apiKey.count({
    where: { userId, isActive: true },
  });

  const maxKeys = user.subscriptionTier === 'ENTERPRISE' ? 25 : 5;
  if (existingKeys >= maxKeys) {
    throw new Error(`Maximum ${maxKeys} API keys allowed for your plan`);
  }

  // Generate key
  const { key, prefix, hash } = generateApiKey();

  // Get tier config for feature flags
  const tierConfig = TIER_CONFIG[user.subscriptionTier];

  // Create API key
  const apiKey = await prisma.apiKey.create({
    data: {
      key: hash, // Store hash, not raw key
      keyPrefix: prefix,
      name,
      userId,
      tier: user.subscriptionTier,
      hasLiveAccess: tierConfig.hasLiveAccess,
      hasWebhooks: tierConfig.hasWebhooks,
      hasHistoricalData: tierConfig.hasHistoricalData,
      hasBulkExport: tierConfig.hasBulkExport,
      expiresAt: expiresInDays
        ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
        : null,
    },
  });

  // Return raw key (only shown once!)
  return {
    apiKey,
    rawKey: key,
  };
}

/**
 * Validate an API key and check rate limits
 */
export async function validateApiKey(rawKey: string): Promise<ApiKeyValidation> {
  // Basic format validation
  if (!rawKey || !rawKey.startsWith('cito_') || rawKey.length !== 69) {
    return { valid: false, error: 'Invalid API key format' };
  }

  const keyHash = hashApiKey(rawKey);

  // Look up key
  const apiKey = await prisma.apiKey.findUnique({
    where: { key: keyHash },
    include: { user: true },
  });

  if (!apiKey) {
    return { valid: false, error: 'Invalid API key' };
  }

  // Check if revoked
  if (!apiKey.isActive || apiKey.revokedAt) {
    return { valid: false, error: 'API key has been revoked' };
  }

  // Check expiration
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    return { valid: false, error: 'API key has expired' };
  }

  // Check user subscription status
  if (apiKey.user.subscriptionStatus === 'CANCELED' && apiKey.tier !== 'FREE') {
    // Downgrade to free tier limits
    await prisma.apiKey.update({
      where: { id: apiKey.id },
      data: {
        tier: 'FREE',
        hasLiveAccess: false,
        hasWebhooks: false,
        hasBulkExport: false,
      },
    });
    apiKey.tier = 'FREE';
    apiKey.hasLiveAccess = false;
  }

  // Get tier limits
  const tierConfig = TIER_CONFIG[apiKey.tier];
  const dailyLimit = apiKey.dailyLimit || tierConfig.dailyLimit || 100;
  const monthlyLimit = apiKey.monthlyLimit || tierConfig.monthlyLimit;

  // Reset counters if needed
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  let requestsToday = apiKey.requestsToday;
  let requestsMonth = apiKey.requestsMonth;

  // Reset daily counter
  if (!apiKey.lastResetDay || apiKey.lastResetDay < today) {
    requestsToday = 0;
    await prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { requestsToday: 0, lastResetDay: today },
    });
  }

  // Reset monthly counter
  if (!apiKey.lastResetMonth || apiKey.lastResetMonth < firstOfMonth) {
    requestsMonth = 0;
    await prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { requestsMonth: 0, lastResetMonth: firstOfMonth },
    });
  }

  // Check daily limit
  if (dailyLimit && requestsToday >= dailyLimit) {
    return {
      valid: false,
      error: `Daily rate limit exceeded (${dailyLimit}/day). Resets at midnight UTC.`,
    };
  }

  // Check monthly limit (FREE tier only)
  if (monthlyLimit && requestsMonth >= monthlyLimit) {
    return {
      valid: false,
      error: `Monthly limit exceeded (${monthlyLimit}/month). Upgrade your plan for more requests.`,
    };
  }

  return {
    valid: true,
    apiKey,
    rateLimitRemaining: dailyLimit ? dailyLimit - requestsToday : undefined,
    monthlyLimitRemaining: monthlyLimit ? monthlyLimit - requestsMonth : undefined,
  };
}

/**
 * Track API usage for a key
 */
export async function trackUsage(
  apiKeyId: string,
  endpoint: string,
  method: string,
  statusCode: number,
  responseTime: number,
  ipAddress?: string,
  userAgent?: string,
  isLiveEndpoint: boolean = false
): Promise<void> {
  const now = new Date();

  // Update request counters
  await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: {
      requestsToday: { increment: 1 },
      requestsMonth: { increment: 1 },
      lastRequestAt: now,
    },
  });

  // Log usage (for analytics)
  await prisma.apiUsageLog.create({
    data: {
      apiKeyId,
      endpoint,
      method,
      statusCode,
      responseTime,
      ipAddress,
      userAgent,
      isLiveEndpoint,
    },
  });
}

/**
 * Check if key has access to live data
 */
export function hasLiveAccess(apiKey: ApiKey): boolean {
  return apiKey.hasLiveAccess && (apiKey.tier === 'BUSINESS' || apiKey.tier === 'ENTERPRISE');
}

/**
 * Revoke an API key
 */
export async function revokeApiKey(
  apiKeyId: string,
  userId: string,
  reason?: string
): Promise<void> {
  const apiKey = await prisma.apiKey.findFirst({
    where: { id: apiKeyId, userId },
  });

  if (!apiKey) {
    throw new Error('API key not found');
  }

  await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: {
      isActive: false,
      revokedAt: new Date(),
      revokedReason: reason || 'Revoked by user',
    },
  });
}

/**
 * List API keys for a user
 */
export async function listApiKeys(userId: string): Promise<ApiKey[]> {
  return prisma.apiKey.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Get usage stats for a key
 */
export async function getKeyUsageStats(
  apiKeyId: string,
  userId: string,
  days: number = 30
): Promise<{
  totalRequests: number;
  requestsByDay: { date: string; count: number }[];
  topEndpoints: { endpoint: string; count: number }[];
  avgResponseTime: number;
}> {
  const apiKey = await prisma.apiKey.findFirst({
    where: { id: apiKeyId, userId },
  });

  if (!apiKey) {
    throw new Error('API key not found');
  }

  const since = new Date();
  since.setDate(since.getDate() - days);

  // Get total requests
  const totalRequests = await prisma.apiUsageLog.count({
    where: {
      apiKeyId,
      timestamp: { gte: since },
    },
  });

  // Get requests by day
  const logs = await prisma.apiUsageLog.findMany({
    where: {
      apiKeyId,
      timestamp: { gte: since },
    },
    select: {
      timestamp: true,
      endpoint: true,
      responseTime: true,
    },
  });

  // Aggregate by day
  const byDay = new Map<string, number>();
  const byEndpoint = new Map<string, number>();
  let totalResponseTime = 0;

  for (const log of logs) {
    const dateParts = log.timestamp.toISOString().split('T');
    const date = dateParts[0] || '';
    byDay.set(date, (byDay.get(date) || 0) + 1);
    byEndpoint.set(log.endpoint, (byEndpoint.get(log.endpoint) || 0) + 1);
    totalResponseTime += log.responseTime;
  }

  const requestsByDay = Array.from(byDay.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const topEndpoints = Array.from(byEndpoint.entries())
    .map(([endpoint, count]) => ({ endpoint, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    totalRequests,
    requestsByDay,
    topEndpoints,
    avgResponseTime: logs.length > 0 ? Math.round(totalResponseTime / logs.length) : 0,
  };
}

// ============ USER MANAGEMENT ============

/**
 * Create a new API user
 */
export async function createApiUser(
  email: string,
  password?: string,
  name?: string,
  company?: string
): Promise<ApiUser> {
  // Check if email already exists
  const existing = await prisma.apiUser.findUnique({
    where: { email },
  });

  if (existing) {
    throw new Error('Email already registered');
  }

  // Hash password if provided
  let passwordHash: string | null = null;
  if (password) {
    passwordHash = crypto.createHash('sha256').update(password).digest('hex');
  }

  return prisma.apiUser.create({
    data: {
      email,
      passwordHash,
      name,
      company,
      emailVerified: false,
      verificationToken: crypto.randomBytes(32).toString('hex'),
    },
  });
}

/**
 * Verify user password
 */
export async function verifyPassword(email: string, password: string): Promise<ApiUser | null> {
  const user = await prisma.apiUser.findUnique({
    where: { email },
  });

  if (!user || !user.passwordHash) {
    return null;
  }

  const hash = crypto.createHash('sha256').update(password).digest('hex');
  if (hash !== user.passwordHash) {
    return null;
  }

  // Update last login
  await prisma.apiUser.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  return user;
}

// ============ EXPORTS ============

export const apiKeyService = {
  createApiKey,
  validateApiKey,
  trackUsage,
  hasLiveAccess,
  revokeApiKey,
  listApiKeys,
  getKeyUsageStats,
  createApiUser,
  verifyPassword,
};
