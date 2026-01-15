/**
 * Firebase Authentication Routes
 * Handles user sync, profile management, and API key operations for dashboard users
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../db/client.js';
import { firebaseAuth, requireApiUser } from '../middleware/firebase-auth.middleware.js';
import { apiKeyService } from '../services/api-key.service.js';

const router = Router();

/**
 * POST /auth/firebase/sync
 * Sync Firebase user with ApiUser table
 * Creates user if doesn't exist, updates if exists
 */
router.post('/sync', firebaseAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, emailVerified } = req.body;
    const firebaseUser = req.firebaseUser;

    if (!firebaseUser || !firebaseUser.email) {
      res.status(400).json({
        success: false,
        error: 'Invalid request - no Firebase user',
      });
      return;
    }

    // Check if user exists by email
    let user = await prisma.apiUser.findUnique({
      where: { email: firebaseUser.email },
    });

    let isNewUser = false;
    let firstApiKey: { id: string; key: string; prefix: string } | null = null;

    if (!user) {
      // Create new user
      isNewUser = true;
      user = await prisma.apiUser.create({
        data: {
          email: firebaseUser.email,
          name: name || null,
          emailVerified: emailVerified || false,
          // No password hash for Firebase users
          passwordHash: null,
        },
      });

      // Create first API key automatically for new users
      try {
        const { apiKey, rawKey } = await apiKeyService.createApiKey({
          name: 'Default Key',
          userId: user.id,
        });

        firstApiKey = {
          id: apiKey.id,
          key: rawKey,
          prefix: apiKey.keyPrefix,
        };
      } catch (keyError) {
        console.error('[FirebaseAuth] Failed to create initial API key:', keyError);
        // Continue anyway - user can create key later
      }

      res.status(201).json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          subscriptionTier: user.subscriptionTier,
          subscriptionStatus: user.subscriptionStatus,
        },
        firstApiKey: firstApiKey
          ? {
              id: firstApiKey.id,
              key: firstApiKey.key,
              prefix: firstApiKey.prefix,
              note: 'Save this key - it will not be shown again!',
            }
          : null,
        isNewUser: true,
      });
      return;
    }

    // Update existing user
    user = await prisma.apiUser.update({
      where: { id: user.id },
      data: {
        name: name || user.name,
        emailVerified: emailVerified || user.emailVerified,
        lastLoginAt: new Date(),
      },
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        subscriptionTier: user.subscriptionTier,
        subscriptionStatus: user.subscriptionStatus,
      },
      isNewUser: false,
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[FirebaseAuth] Sync error:', err);
    console.error('[FirebaseAuth] Sync error stack:', err.stack);
    res.status(500).json({
      success: false,
      error: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
  }
});

/**
 * GET /auth/firebase/me
 * Get current user info with API keys
 */
router.get('/me', firebaseAuth, requireApiUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await prisma.apiUser.findUnique({
      where: { id: req.apiUser!.id },
      include: {
        apiKeys: {
          where: { isActive: true },
          select: {
            id: true,
            keyPrefix: true,
            name: true,
            tier: true,
            hasLiveAccess: true,
            requestsToday: true,
            requestsMonth: true,
            lastRequestAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!user) {
      res.status(404).json({
        success: false,
        error: 'User not found',
      });
      return;
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        subscriptionTier: user.subscriptionTier,
        subscriptionStatus: user.subscriptionStatus,
        createdAt: user.createdAt,
      },
      apiKeys: user.apiKeys,
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[FirebaseAuth] Get me error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /auth/firebase/api-keys
 * Get all API keys for the current user
 */
router.get('/api-keys', firebaseAuth, requireApiUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const keys = await prisma.apiKey.findMany({
      where: {
        userId: req.apiUser!.id,
        isActive: true,
      },
      select: {
        id: true,
        keyPrefix: true,
        name: true,
        tier: true,
        hasLiveAccess: true,
        hasWebhooks: true,
        hasBulkExport: true,
        dailyLimit: true,
        monthlyLimit: true,
        requestsToday: true,
        requestsMonth: true,
        lastRequestAt: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      keys,
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[FirebaseAuth] Get API keys error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * POST /auth/firebase/api-keys
 * Create a new API key
 */
router.post('/api-keys', firebaseAuth, requireApiUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.body;

    if (!name || typeof name !== 'string' || name.length < 1 || name.length > 100) {
      res.status(400).json({
        success: false,
        error: 'Name is required (1-100 characters)',
      });
      return;
    }

    const { apiKey, rawKey } = await apiKeyService.createApiKey({
      name,
      userId: req.apiUser!.id,
    });

    res.status(201).json({
      success: true,
      apiKey: {
        id: apiKey.id,
        key: rawKey, // Only returned once!
        prefix: apiKey.keyPrefix,
        name: apiKey.name,
        tier: apiKey.tier,
        hasLiveAccess: apiKey.hasLiveAccess,
        createdAt: apiKey.createdAt,
      },
      note: 'This is the only time the full key will be shown. Please save it securely.',
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[FirebaseAuth] Create API key error:', err);
    res.status(400).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * DELETE /auth/firebase/api-keys/:keyId
 * Revoke an API key
 */
router.delete('/api-keys/:keyId', firebaseAuth, requireApiUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const { keyId } = req.params;

    // Verify the key belongs to this user
    const key = await prisma.apiKey.findUnique({
      where: { id: keyId },
    });

    if (!key || key.userId !== req.apiUser!.id) {
      res.status(404).json({
        success: false,
        error: 'API key not found',
      });
      return;
    }

    // Revoke the key
    await prisma.apiKey.update({
      where: { id: keyId },
      data: { isActive: false },
    });

    res.json({
      success: true,
      message: 'API key revoked successfully',
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[FirebaseAuth] Revoke API key error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * GET /auth/firebase/api-keys/:keyId/usage
 * Get usage statistics for an API key
 */
router.get('/api-keys/:keyId/usage', firebaseAuth, requireApiUser, async (req: Request, res: Response): Promise<void> => {
  try {
    const { keyId } = req.params;
    const days = parseInt(req.query.days as string) || 30;

    // Verify the key belongs to this user
    const key = await prisma.apiKey.findUnique({
      where: { id: keyId },
    });

    if (!key || key.userId !== req.apiUser!.id) {
      res.status(404).json({
        success: false,
        error: 'API key not found',
      });
      return;
    }

    // Get usage stats
    const usage = await apiKeyService.getKeyUsageStats(keyId, req.apiUser!.id, days);

    res.json({
      success: true,
      usage,
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[FirebaseAuth] Get API key usage error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

export default router;
