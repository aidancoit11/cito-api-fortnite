import cron from 'node-cron';
import { config } from '../config/index.js';
import { tokenManager } from '../services/epic/token-manager.js';

/**
 * Token Refresh Job
 * Refreshes Epic Games access token every 4 hours
 *
 * Epic tokens expire in ~8 hours, so refreshing every 4 hours
 * ensures we always have a valid token ready for API requests
 */

const JOB_NAME = 'token-refresh';
const SCHEDULE = '0 */4 * * *'; // Every 4 hours

let isRunning = false;

async function refreshToken(): Promise<void> {
  if (isRunning) {
    console.log(`[${JOB_NAME}] ⏳ Job already running, skipping...`);
    return;
  }

  isRunning = true;
  const startTime = Date.now();
  console.log(`[${JOB_NAME}] 🔄 Starting token refresh...`);

  try {
    // Force refresh the token
    await tokenManager.refresh();

    const tokenInfo = tokenManager.getTokenInfo();
    const elapsed = Date.now() - startTime;

    console.log(`[${JOB_NAME}] ✅ Token refreshed successfully (${elapsed}ms)`);

    if (tokenInfo) {
      const expiresInHours = Math.round(tokenInfo.expiresInMs / 3600000 * 10) / 10;
      console.log(`[${JOB_NAME}] 📋 Token expires in ${expiresInHours} hours`);
    }
  } catch (error) {
    console.error(`[${JOB_NAME}] ❌ Failed to refresh token:`, error);

    // Try to notify via Discord if configured
    if (config.discord?.webhookUrl) {
      await notifyDiscord(`Token refresh failed: ${error}`);
    }
  } finally {
    isRunning = false;
  }
}

async function notifyDiscord(message: string): Promise<void> {
  if (!config.discord?.webhookUrl) return;

  try {
    await fetch(config.discord.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `⚠️ **Fortnite API Alert**\n${message}`,
      }),
    });
  } catch {
    console.error(`[${JOB_NAME}] Failed to send Discord notification`);
  }
}

/**
 * Start the token refresh cron job
 */
export function startTokenRefreshJob(): void {
  if (!config.cron.tokenRefresh) {
    console.log(`[${JOB_NAME}] ⏹️  Job disabled in config`);
    return;
  }

  console.log(`[${JOB_NAME}] 📅 Scheduling job: ${SCHEDULE}`);

  cron.schedule(SCHEDULE, refreshToken, {
    scheduled: true,
    timezone: 'UTC',
  });

  console.log(`[${JOB_NAME}] ✅ Job scheduled - runs every 4 hours`);
}

/**
 * Run token refresh immediately (for manual triggers)
 */
export async function runTokenRefreshNow(): Promise<void> {
  await refreshToken();
}

// If running directly via CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🚀 Running token refresh manually...\n');
  runTokenRefreshNow()
    .then(() => {
      console.log('\n✅ Done!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Failed:', error);
      process.exit(1);
    });
}
