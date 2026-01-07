import { chromium, Browser, Page } from 'playwright';
import { config } from '../config/index.js';
import { prisma } from '../db/client.js';
import { EPIC_ENDPOINTS, EPIC_CLIENT_CREDENTIALS } from '../config/endpoints.js';

/**
 * Manual Device Auth Generator
 *
 * This version opens the browser and lets YOU log in manually.
 * It watches for the authorization code and completes the rest automatically.
 *
 * More reliable than fully automated login!
 */

interface DeviceAuthResponse {
  deviceId: string;
  accountId: string;
  secret: string;
  userAgent: string;
  created: {
    location: string;
    ipAddress: string;
    dateTime: string;
  };
}

interface OAuthTokenResponse {
  access_token: string;
  expires_in: number;
  expires_at: string;
  token_type: string;
  refresh_token?: string;
  refresh_expires?: number;
  refresh_expires_at?: string;
  account_id: string;
  client_id: string;
  displayName?: string;
}

async function generateDeviceAuthManual() {
  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    console.log('');
    console.log('🤖 Manual Device Auth Generator');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    console.log('This script will:');
    console.log('1. Open Epic Games login in a browser');
    console.log('2. YOU log in manually');
    console.log('3. Script detects authorization code automatically');
    console.log('4. Script generates device auth and saves to database');
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');

    // Launch browser
    console.log('🌐 Launching browser...');
    browser = await chromium.launch({
      headless: false, // Must be false so you can see and interact
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
    });

    page = await context.newPage();
    console.log('✓ Browser opened');
    console.log('');

    // Navigate to Epic OAuth authorize page
    const clientId = EPIC_CLIENT_CREDENTIALS.LAUNCHER_CLIENT_ID;
    const authorizeUrl = `https://www.epicgames.com/id/api/redirect?clientId=${clientId}&responseType=code`;

    console.log('📍 Navigating to Epic Games login...');
    console.log('');
    await page.goto(authorizeUrl);

    console.log('═══════════════════════════════════════════════════════');
    console.log('👤 YOUR TURN:');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    console.log('1. Log into your Epic Games account in the browser window');
    console.log(`   Email: ${config.epic.accountEmail}`);
    console.log('');
    console.log('2. Complete any 2FA/captcha if prompted');
    console.log('');
    console.log('3. Wait for redirect (the script will detect it automatically)');
    console.log('');
    console.log('⏳ Watching for authorization code...');
    console.log('   (Script will continue automatically once you log in)');
    console.log('');

    // Wait for URL to contain authorization code (max 5 minutes)
    let authorizationCode: string | null = null;

    try {
      await page.waitForURL(
        (url) => url.href.includes('code='),
        { timeout: 300000 } // 5 minutes
      );

      const currentUrl = page.url();
      const urlParams = new URLSearchParams(currentUrl.split('?')[1]);
      authorizationCode = urlParams.get('code');

      console.log('✅ Authorization code detected!');
      console.log(`   Code: ${authorizationCode?.substring(0, 20)}...`);
      console.log('');

    } catch (error) {
      throw new Error(
        'Timeout waiting for login. Did you complete the login in the browser window?'
      );
    }

    if (!authorizationCode) {
      throw new Error('No authorization code found in URL');
    }

    // Rest is automated
    console.log('🤖 Script taking over - automating the rest...');
    console.log('');

    // Exchange authorization code for access token
    console.log('🔄 Exchanging authorization code for access token...');

    const tokenUrl = `${EPIC_ENDPOINTS.ACCOUNT_SERVICE}${EPIC_ENDPOINTS.OAUTH_TOKEN}`;

    const tokenResponse = await page.request.post(tokenUrl, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': EPIC_CLIENT_CREDENTIALS.LAUNCHER_BASIC_AUTH,
      },
      data: new URLSearchParams({
        grant_type: 'authorization_code',
        code: authorizationCode,
      }).toString(),
    });

    if (!tokenResponse.ok()) {
      const errorText = await tokenResponse.text();
      throw new Error(`Failed to exchange code: ${tokenResponse.status()} - ${errorText}`);
    }

    const tokenData: OAuthTokenResponse = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    const accountId = tokenData.account_id;

    console.log('✓ Access token obtained');
    console.log(`  Account ID: ${accountId}`);
    console.log(`  Display Name: ${tokenData.displayName || 'N/A'}`);
    console.log('');

    // Generate device auth
    console.log('🔑 Generating device auth credentials...');

    const deviceAuthUrl = `${EPIC_ENDPOINTS.ACCOUNT_SERVICE}${EPIC_ENDPOINTS.ACCOUNT_DEVICE_AUTH(accountId)}`;

    const deviceAuthResponse = await page.request.post(deviceAuthUrl, {
      headers: {
        'Authorization': `bearer ${accessToken}`,
      },
    });

    if (!deviceAuthResponse.ok()) {
      const errorText = await deviceAuthResponse.text();
      throw new Error(`Failed to generate device auth: ${deviceAuthResponse.status()} - ${errorText}`);
    }

    const deviceAuthData: DeviceAuthResponse = await deviceAuthResponse.json();

    console.log('✅ Device auth generated!');
    console.log('');

    // Test the device auth
    console.log('🧪 Testing device auth credentials...');

    const testTokenUrl = `${EPIC_ENDPOINTS.ACCOUNT_SERVICE}${EPIC_ENDPOINTS.OAUTH_TOKEN}`;
    const testTokenResponse = await page.request.post(testTokenUrl, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': EPIC_CLIENT_CREDENTIALS.LAUNCHER_BASIC_AUTH,
      },
      data: new URLSearchParams({
        grant_type: 'device_auth',
        device_id: deviceAuthData.deviceId,
        account_id: deviceAuthData.accountId,
        secret: deviceAuthData.secret,
      }).toString(),
    });

    if (!testTokenResponse.ok()) {
      throw new Error('Device auth test failed!');
    }

    const testTokenData: OAuthTokenResponse = await testTokenResponse.json();
    console.log('✓ Device auth works!');
    console.log('');

    // Save to database
    console.log('💾 Saving to database...');

    await prisma.oAuthToken.create({
      data: {
        accountId: deviceAuthData.accountId,
        accessToken: testTokenData.access_token,
        refreshToken: testTokenData.refresh_token || '',
        expiresAt: new Date(testTokenData.expires_at),
      },
    });

    console.log('✓ Saved to Supabase');
    console.log('');

    // Print credentials
    console.log('═══════════════════════════════════════════════════════');
    console.log('✅ SUCCESS!');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    console.log('📋 Your Device Auth Credentials:');
    console.log('');
    console.log(`EPIC_DEVICE_ID=${deviceAuthData.deviceId}`);
    console.log(`EPIC_ACCOUNT_ID=${deviceAuthData.accountId}`);
    console.log(`EPIC_DEVICE_SECRET=${deviceAuthData.secret}`);
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    console.log('📝 Next Steps:');
    console.log('');
    console.log('1. Copy the 3 lines above to your .env file');
    console.log('2. Restart your API: npm run dev');
    console.log('3. Done! Tokens will auto-refresh every 4 hours');
    console.log('');

  } catch (error: any) {
    console.error('');
    console.error('═══════════════════════════════════════════════════════');
    console.error('❌ ERROR');
    console.error('═══════════════════════════════════════════════════════');
    console.error('');
    console.error(error.message);
    console.error('');
    process.exit(1);
  } finally {
    if (browser) {
      console.log('🔒 Closing browser...');
      await browser.close();
    }
  }
}

// Run
generateDeviceAuthManual()
  .then(() => {
    console.log('👋 Complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
