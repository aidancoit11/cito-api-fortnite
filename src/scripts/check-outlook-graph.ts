import * as msal from '@azure/msal-node';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Check Outlook emails using Microsoft Graph API
 * Uses device code flow with persistent token cache
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

async function getAccessToken(): Promise<string> {
  const accounts = await pca.getTokenCache().getAllAccounts();

  // Try silent token acquisition first
  if (accounts.length > 0) {
    try {
      const silentResult = await pca.acquireTokenSilent({
        account: accounts[0],
        scopes: ['https://graph.microsoft.com/Mail.Read'],
      });
      if (silentResult?.accessToken) {
        console.log('✅ Using cached token\n');
        return silentResult.accessToken;
      }
    } catch {
      // Silent failed, need interactive
    }
  }

  // Device code flow
  const deviceCodeRequest: msal.DeviceCodeRequest = {
    scopes: ['https://graph.microsoft.com/Mail.Read'],
    timeout: 120,
    deviceCodeCallback: (response) => {
      console.log('\n📱 ONE-TIME AUTH REQUIRED:');
      console.log(`   1. Go to: ${response.verificationUri}`);
      console.log(`   2. Enter code: ${response.userCode}`);
      console.log('\n   Token will be cached for future use.\n');
    },
  };

  const response = await pca.acquireTokenByDeviceCode(deviceCodeRequest);

  if (!response?.accessToken) {
    throw new Error('Failed to get access token');
  }

  console.log('✅ Authenticated and token cached!\n');
  return response.accessToken;
}

async function checkForEpicEmail(accessToken: string): Promise<string | null> {
  const response = await axios.get(
    'https://graph.microsoft.com/v1.0/me/messages?$top=20&$orderby=receivedDateTime desc&$select=subject,from,body,receivedDateTime',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  const messages = response.data.value || [];

  for (const msg of messages) {
    const from = msg.from?.emailAddress?.address || '';
    const subject = msg.subject || '';
    const body = msg.body?.content || '';

    if (
      from.toLowerCase().includes('epic') ||
      subject.toLowerCase().includes('epic') ||
      subject.toLowerCase().includes('verification') ||
      subject.toLowerCase().includes('security code')
    ) {
      const codeMatch = body.match(/\b(\d{6})\b/);
      if (codeMatch) {
        return codeMatch[1];
      }
    }
  }

  return null;
}

async function main() {
  const mode = process.argv[2]; // 'auth' or 'check'

  if (mode === 'auth') {
    // Just authenticate and cache token
    console.log('🔐 Authenticating with Microsoft...\n');
    await getAccessToken();
    console.log('✅ Done! Token cached. You can now run without auth.\n');
    return;
  }

  // Default: check for code
  console.log('📬 Checking Outlook for Epic verification code...\n');

  const accessToken = await getAccessToken();

  const startTime = Date.now();
  const maxWait = 120000;

  while (Date.now() - startTime < maxWait) {
    try {
      const code = await checkForEpicEmail(accessToken);
      if (code) {
        console.log('\n🎉 VERIFICATION CODE FOUND!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`🔑 CODE: ${code}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        process.exit(0);
      }
    } catch (err: any) {
      if (err.response?.status === 401) {
        console.log('Token expired, re-authenticating...');
        fs.unlinkSync(tokenCachePath);
        process.exit(1);
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    process.stdout.write(`\r⏳ Waiting for Epic email... ${elapsed}s  `);
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log('\n\n❌ Timeout - no verification email received');
  process.exit(1);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
