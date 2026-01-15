/**
 * Stripe Service
 * Handles all Stripe payment and subscription operations
 *
 * Pricing Tiers:
 * - FREE: $0 - 100 req/day, 250/month, NO live data
 * - DEVELOPER: $29/month - 10k req/day, NO live data
 * - BUSINESS: $99/month - 100k req/day, live data, webhooks
 * - ENTERPRISE: Custom pricing - all features
 */

import Stripe from 'stripe';
import { config } from '../config/index.js';
import { prisma } from '../db/client.js';
import { SubscriptionTier, SubscriptionStatus } from '@prisma/client';

// Initialize Stripe (lazy - only when needed)
let stripeClient: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripeClient) {
    if (!config.stripe.secretKey) {
      throw new Error('Stripe secret key not configured');
    }
    stripeClient = new Stripe(config.stripe.secretKey, {
      apiVersion: '2025-12-15.clover',
    });
  }
  return stripeClient;
}

// ============ TIER CONFIGURATION ============

export const TIER_CONFIG = {
  FREE: {
    price: 0,
    dailyLimit: 100,
    monthlyLimit: 250,
    hasLiveAccess: false,
    hasWebhooks: false,
    hasHistoricalData: true,
    hasBulkExport: false,
  },
  DEVELOPER: {
    price: 29,
    dailyLimit: 10000,
    monthlyLimit: null, // No monthly cap for paid tiers
    hasLiveAccess: false, // NO LIVE DATA for $29 tier
    hasWebhooks: false,
    hasHistoricalData: true,
    hasBulkExport: false,
  },
  BUSINESS: {
    price: 99,
    dailyLimit: 100000,
    monthlyLimit: null,
    hasLiveAccess: true, // LIVE DATA starts here
    hasWebhooks: true,
    hasHistoricalData: true,
    hasBulkExport: true,
  },
  ENTERPRISE: {
    price: null, // Custom
    dailyLimit: null, // Custom
    monthlyLimit: null,
    hasLiveAccess: true,
    hasWebhooks: true,
    hasHistoricalData: true,
    hasBulkExport: true,
  },
} as const;

// ============ CUSTOMER MANAGEMENT ============

/**
 * Create or get Stripe customer for a user
 */
export async function getOrCreateCustomer(userId: string): Promise<string> {
  const stripe = getStripe();

  const user = await prisma.apiUser.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new Error('User not found');
  }

  // Return existing customer if we have one
  if (user.stripeCustomerId) {
    return user.stripeCustomerId;
  }

  // Create new Stripe customer
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name || undefined,
    metadata: {
      userId: user.id,
      company: user.company || '',
    },
  });

  // Save customer ID
  await prisma.apiUser.update({
    where: { id: userId },
    data: { stripeCustomerId: customer.id },
  });

  return customer.id;
}

// ============ SUBSCRIPTION MANAGEMENT ============

/**
 * Create a checkout session for subscription
 */
export async function createCheckoutSession(
  userId: string,
  tier: 'DEVELOPER' | 'BUSINESS',
  successUrl: string,
  cancelUrl: string
): Promise<string> {
  const stripe = getStripe();
  const customerId = await getOrCreateCustomer(userId);

  const priceId = tier === 'DEVELOPER'
    ? config.stripe.prices.developer
    : config.stripe.prices.business;

  if (!priceId) {
    throw new Error(`Stripe price not configured for ${tier} tier`);
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      userId,
      tier,
    },
    subscription_data: {
      metadata: {
        userId,
        tier,
      },
    },
  });

  return session.url || '';
}

/**
 * Create a billing portal session for managing subscription
 */
export async function createBillingPortalSession(
  userId: string,
  returnUrl: string
): Promise<string> {
  const stripe = getStripe();

  const user = await prisma.apiUser.findUnique({
    where: { id: userId },
  });

  if (!user?.stripeCustomerId) {
    throw new Error('No Stripe customer found for user');
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: returnUrl,
  });

  return session.url;
}

/**
 * Handle subscription created/updated from webhook
 */
export async function handleSubscriptionUpdate(
  subscription: Stripe.Subscription
): Promise<void> {
  const userId = subscription.metadata.userId;
  if (!userId) {
    console.error('[Stripe] Subscription missing userId metadata:', subscription.id);
    return;
  }

  // Map Stripe status to our status
  const statusMap: Record<string, SubscriptionStatus> = {
    active: 'ACTIVE',
    canceled: 'CANCELED',
    past_due: 'PAST_DUE',
    trialing: 'TRIALING',
    paused: 'PAUSED',
  };

  const status = statusMap[subscription.status] || 'ACTIVE';

  // Get tier from metadata
  const tierString = subscription.metadata.tier || 'FREE';
  const tier = tierString as SubscriptionTier;

  // Get subscription dates (cast to any for flexibility with Stripe API versions)
  const subData = subscription as any;
  const periodStart = subData.current_period_start || subData.currentPeriodStart;
  const periodEnd = subData.current_period_end || subData.currentPeriodEnd;
  const trialEnd = subData.trial_end || subData.trialEnd;

  // Update user subscription
  await prisma.apiUser.update({
    where: { id: userId },
    data: {
      stripeSubscriptionId: subscription.id,
      subscriptionTier: tier,
      subscriptionStatus: status,
      subscriptionStart: periodStart ? new Date(periodStart * 1000) : null,
      subscriptionEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      trialEndsAt: trialEnd ? new Date(trialEnd * 1000) : null,
    },
  });

  // Update all API keys for this user with new tier features
  const tierConfig = TIER_CONFIG[tier];
  await prisma.apiKey.updateMany({
    where: { userId },
    data: {
      tier,
      hasLiveAccess: tierConfig.hasLiveAccess,
      hasWebhooks: tierConfig.hasWebhooks,
      hasBulkExport: tierConfig.hasBulkExport,
    },
  });

  console.log(`[Stripe] Updated subscription for user ${userId}: ${tier} (${status})`);
}

/**
 * Handle subscription deleted from webhook
 */
export async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription
): Promise<void> {
  const userId = subscription.metadata.userId;
  if (!userId) return;

  // Downgrade to free tier
  await prisma.apiUser.update({
    where: { id: userId },
    data: {
      subscriptionTier: 'FREE',
      subscriptionStatus: 'CANCELED',
      stripeSubscriptionId: null,
    },
  });

  // Update API keys to free tier (no live access)
  await prisma.apiKey.updateMany({
    where: { userId },
    data: {
      tier: 'FREE',
      hasLiveAccess: false,
      hasWebhooks: false,
      hasBulkExport: false,
    },
  });

  console.log(`[Stripe] Subscription canceled for user ${userId}, downgraded to FREE`);
}

/**
 * Handle invoice payment succeeded
 */
export async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const customerId = invoice.customer as string;

  const user = await prisma.apiUser.findFirst({
    where: { stripeCustomerId: customerId },
  });

  if (!user) return;

  // Record invoice
  await prisma.invoice.create({
    data: {
      userId: user.id,
      stripeInvoiceId: invoice.id,
      amount: invoice.amount_paid / 100, // Convert from cents
      currency: invoice.currency,
      status: 'paid',
      description: invoice.description || `Subscription invoice`,
      invoiceUrl: invoice.hosted_invoice_url || null,
      pdfUrl: invoice.invoice_pdf || null,
      periodStart: invoice.period_start
        ? new Date(invoice.period_start * 1000)
        : null,
      periodEnd: invoice.period_end
        ? new Date(invoice.period_end * 1000)
        : null,
      paidAt: new Date(),
    },
  });

  console.log(`[Stripe] Invoice paid for user ${user.id}: $${invoice.amount_paid / 100}`);
}

/**
 * Handle invoice payment failed
 */
export async function handleInvoiceFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId = invoice.customer as string;

  const user = await prisma.apiUser.findFirst({
    where: { stripeCustomerId: customerId },
  });

  if (!user) return;

  // Update subscription status to past_due
  await prisma.apiUser.update({
    where: { id: user.id },
    data: {
      subscriptionStatus: 'PAST_DUE',
    },
  });

  console.log(`[Stripe] Invoice failed for user ${user.id}`);
}

// ============ WEBHOOK VERIFICATION ============

/**
 * Verify Stripe webhook signature
 */
export function verifyWebhookSignature(
  payload: Buffer,
  signature: string
): Stripe.Event {
  const stripe = getStripe();

  if (!config.stripe.webhookSecret) {
    throw new Error('Stripe webhook secret not configured');
  }

  return stripe.webhooks.constructEvent(
    payload,
    signature,
    config.stripe.webhookSecret
  );
}

// ============ EXPORTS ============

export const stripeService = {
  TIER_CONFIG,
  getOrCreateCustomer,
  createCheckoutSession,
  createBillingPortalSession,
  handleSubscriptionUpdate,
  handleSubscriptionDeleted,
  handleInvoicePaid,
  handleInvoiceFailed,
  verifyWebhookSignature,
};
