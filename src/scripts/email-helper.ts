import * as msal from '@azure/msal-node';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Email Helper - Microsoft Graph API
 * Fetches Epic verification codes from Outlook
 */

const tokenCachePath = path.join(process.cwd(), '.ms-token-cache.json');

// MSAL config with cache plugin
const cachePlugin: msal.ICachePlugin = {
  beforeCacheAccess: async (context: msal.TokenCacheContext) => {
    if (fs.existsSync(tokenCachePath)) {
      context.tokenCache.deserialize(fs.readFileSync(tokenCachePath, 'utf-8'));
    }
  },
  afterCacheAccess: async (context: msal.TokenCacheContext) => {
    if (context.cacheHasChanged) {
      fs.writeFileSync(tokenCachePath, context.tokenCache.serialize());
    }
  },
};

const msalConfig: msal.Configuration = {
  auth: {
    clientId: '14d82eec-204b-4c2f-b7e8-296a70dab67e',
    authority: 'https://login.microsoftonline.com/consumers',
  },
  cache: {
    cachePlugin,
  },
};

const pca = new msal.PublicClientApplication(msalConfig);

/**
 * Get Microsoft Graph access token (cached or via device code)
 */
async function getMsGraphToken(): Promise<string> {
  const accounts = await pca.getTokenCache().getAllAccounts();

  // Try silent token acquisition first
  if (accounts.length > 0) {
    try {
      const silentResult = await pca.acquireTokenSilent({
        account: accounts[0],
        scopes: ['https://graph.microsoft.com/Mail.Read'],
      });
      if (silentResult?.accessToken) {
        return silentResult.accessToken;
      }
    } catch {
      // Silent failed, need interactive
    }
  }

  // Device code flow
  console.log('\n⚠️  Microsoft Graph authentication required (one-time setup)');
  const deviceCodeRequest: msal.DeviceCodeRequest = {
    scopes: ['https://graph.microsoft.com/Mail.Read'],
    timeout: 120,
    deviceCodeCallback: (response) => {
      console.log('\n📱 To authenticate with Outlook:');
      console.log(`   1. Go to: ${response.verificationUri}`);
      console.log(`   2. Enter code: ${response.userCode}`);
      console.log('\n   Token will be cached for future use.\n');
    },
  };

  const response = await pca.acquireTokenByDeviceCode(deviceCodeRequest);

  if (!response?.accessToken) {
    throw new Error('Failed to get Microsoft Graph access token');
  }

  console.log('✅ Microsoft Graph authenticated and cached!\n');
  return response.accessToken;
}

/**
 * Check if Microsoft Graph is authenticated
 */
export async function isMsGraphAuthenticated(): Promise<boolean> {
  const accounts = await pca.getTokenCache().getAllAccounts();
  return accounts.length > 0;
}

/**
 * Authenticate with Microsoft Graph (call before using email functions)
 */
export async function authenticateMsGraph(): Promise<void> {
  await getMsGraphToken();
}

/**
 * Get the most recent Epic verification code from Outlook
 */
export async function getEpicCodeFromOutlook(
  maxWaitMs: number = 120000
): Promise<string> {
  console.log('📧 Fetching Epic verification code from Outlook...');

  const accessToken = await getMsGraphToken();
  const startTime = Date.now();
  let lastCheckedTime: string | null = null;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const res = await axios.get(
        'https://graph.microsoft.com/v1.0/me/messages?$top=5&$orderby=receivedDateTime desc',
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      const messages = res.data.value || [];

      for (const msg of messages) {
        const from = msg.from?.emailAddress?.address || '';
        const receivedTime = msg.receivedDateTime;

        // Only check Epic emails
        if (from.toLowerCase().includes('epic')) {
          // Skip if we already checked this email
          if (lastCheckedTime && receivedTime <= lastCheckedTime) {
            continue;
          }

          // Strip HTML and find 6-digit code
          const body = msg.body?.content || '';
          const textOnly = body.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
          const codeMatch = textOnly.match(/\b(\d{6})\b/);

          if (codeMatch) {
            console.log(`\n  📩 Found Epic email: "${msg.subject}"`);
            console.log(`  ✅ Verification code: ${codeMatch[1]}`);
            return codeMatch[1];
          }
        }
      }

      // Track the most recent email time we've seen
      if (messages.length > 0 && messages[0].receivedDateTime) {
        lastCheckedTime = messages[0].receivedDateTime;
      }
    } catch (err: any) {
      if (err.response?.status === 401) {
        // Token expired, clear cache
        if (fs.existsSync(tokenCachePath)) {
          fs.unlinkSync(tokenCachePath);
        }
        throw new Error('Microsoft Graph token expired. Please re-run to authenticate.');
      }
      // Other errors - keep polling
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    process.stdout.write(`\r  ⏳ Waiting for Epic verification email... (${elapsed}s)  `);
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log('');
  throw new Error('Timeout waiting for Epic verification email');
}

/**
 * Poll for a NEW Epic verification code (ignores existing emails)
 * Use this when you've just triggered Epic to send a new code
 */
export async function waitForNewEpicCode(
  maxWaitMs: number = 120000
): Promise<string> {
  console.log('📧 Waiting for NEW Epic verification code...');

  const accessToken = await getMsGraphToken();

  // Get the timestamp of the most recent email to ignore older ones
  let ignoreBeforeTime: string | null = null;
  try {
    const initialRes = await axios.get(
      'https://graph.microsoft.com/v1.0/me/messages?$top=1&$orderby=receivedDateTime desc',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (initialRes.data.value?.length > 0) {
      ignoreBeforeTime = initialRes.data.value[0].receivedDateTime;
    }
  } catch {
    // Ignore
  }

  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const res = await axios.get(
        'https://graph.microsoft.com/v1.0/me/messages?$top=5&$orderby=receivedDateTime desc',
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      const messages = res.data.value || [];

      for (const msg of messages) {
        const from = msg.from?.emailAddress?.address || '';
        const receivedTime = msg.receivedDateTime;

        // Skip emails from before we started waiting
        if (ignoreBeforeTime && receivedTime <= ignoreBeforeTime) {
          continue;
        }

        // Only check Epic emails
        if (from.toLowerCase().includes('epic')) {
          const body = msg.body?.content || '';
          const textOnly = body.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
          const codeMatch = textOnly.match(/\b(\d{6})\b/);

          if (codeMatch) {
            console.log(`\n  📩 New Epic email: "${msg.subject}"`);
            console.log(`  ✅ Verification code: ${codeMatch[1]}`);
            return codeMatch[1];
          }
        }
      }
    } catch (err: any) {
      if (err.response?.status === 401) {
        if (fs.existsSync(tokenCachePath)) {
          fs.unlinkSync(tokenCachePath);
        }
        throw new Error('Microsoft Graph token expired. Please re-run to authenticate.');
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    process.stdout.write(`\r  ⏳ Waiting for new Epic email... (${elapsed}s)  `);
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log('');
  throw new Error('Timeout waiting for Epic verification email');
}
