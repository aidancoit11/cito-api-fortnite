import { chromium, Browser, Page, BrowserContext } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { config } from '../config/index.js';
import { prisma } from '../db/client.js';
import { EPIC_ENDPOINTS, EPIC_CLIENT_CREDENTIALS } from '../config/endpoints.js';
import { solveCaptcha } from './captcha-solver.js';
import { waitForNewEpicCode } from './email-helper.js';

// Add stealth plugin to avoid detection
chromium.use(StealthPlugin());

/**
 * Playwright Automation Script
 * Generates Epic Games Device Auth Credentials
 *
 * This script:
 * 1. Launches browser and clears any existing Epic session
 * 2. Logs into Epic Games account
 * 3. Generates device auth credentials
 * 4. Saves to Supabase database
 * 5. Prints credentials to console
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

async function generateDeviceAuth() {
  let browser: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    console.log('');
    console.log('🤖 Starting Playwright Device Auth Generator...');
    console.log('');

    // Validate environment variables
    const email = config.epic.accountEmail;
    const password = config.epic.accountPassword;

    if (!email || !password) {
      throw new Error(
        'Missing Epic account credentials. Set EPIC_ACCOUNT_EMAIL and EPIC_ACCOUNT_PASSWORD in .env'
      );
    }

    console.log('✓ Environment variables loaded');
    console.log(`  Email: ${email}`);
    console.log('');

    // Launch REAL Chrome browser (not Playwright's test Chromium)
    console.log('🌐 Launching real Chrome browser...');

    // Find Chrome on the system
    const chromePaths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // macOS
      '/usr/bin/google-chrome', // Linux
      '/usr/bin/google-chrome-stable', // Linux
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', // Windows
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', // Windows x86
    ];

    let chromePath = '';
    const fs = await import('fs');
    for (const p of chromePaths) {
      if (fs.existsSync(p)) {
        chromePath = p;
        break;
      }
    }

    if (chromePath) {
      console.log(`  ✓ Found Chrome at: ${chromePath}`);
    } else {
      console.log('  ⚠️  Chrome not found, using Playwright Chromium');
    }

    // Use persistent browser profile (Epic sees returning user, not fresh bot)
    const path = await import('path');
    const userDataDir = path.join(process.cwd(), '.browser-profile');

    browser = await chromium.launchPersistentContext(userDataDir, {
      headless: false, // Must be visible for captcha
      executablePath: chromePath || undefined, // Use real Chrome if found
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--disable-dev-shm-usage',
        '--no-first-run',
      ],
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      colorScheme: 'light',
      deviceScaleFactor: 1,
    });

    // Get or create page from persistent context
    const context = browser;
    page = context.pages()[0] || await context.newPage();
    console.log('✓ Browser launched (fresh session)');
    console.log('');

    // Use the simple login URL first (looks more natural, avoids bot detection)
    const clientId = EPIC_CLIENT_CREDENTIALS.LAUNCHER_CLIENT_ID;
    const simpleLoginUrl = 'https://www.epicgames.com/id/login';
    const authorizeUrl = `https://www.epicgames.com/id/api/redirect?clientId=${clientId}&responseType=code`;

    console.log('🔐 Navigating to Epic Games login...');
    await page.goto(simpleLoginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000); // Wait for React/dynamic content to load
    console.log('✓ Login page loaded');
    console.log('');

    // Check current URL
    let currentUrl = page.url();
    console.log(`📍 Current URL: ${currentUrl.substring(0, 100)}...`);
    console.log('');

    let authorizationCode: string | null = null;

    // Check if already logged in (redirected to account page)
    if (currentUrl.includes('/account/') || currentUrl.includes('/store') || !currentUrl.includes('/id/login')) {
      console.log('✅ Already logged in! Skipping login form...');
      console.log('🔄 Going directly to authorization URL...');
      console.log('');

      await page.goto(authorizeUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);

      const urlAfterAuth = page.url();
      console.log(`📍 URL after authorize: ${urlAfterAuth.substring(0, 100)}...`);

      // Check for authorization code in URL
      if (urlAfterAuth.includes('code=')) {
        const urlParams = new URLSearchParams(urlAfterAuth.split('?')[1]);
        authorizationCode = urlParams.get('code');
        console.log('✅ Authorization code found in URL!');
      } else {
        // Epic returns JSON with authorizationCode
        try {
          const pageContent = await page.content();
          const jsonMatch = pageContent.match(/"authorizationCode"\s*:\s*"([^"]+)"/);
          if (jsonMatch && jsonMatch[1]) {
            authorizationCode = jsonMatch[1];
            console.log('✅ Authorization code found in JSON response!');
            console.log(`   Code: ${authorizationCode.substring(0, 20)}...`);
          }
        } catch (e) {
          // Not JSON
        }
      }

      if (!authorizationCode) {
        throw new Error('Already logged in but could not get authorization code');
      }
    }

    // Only try login form if we don't have auth code yet
    if (!authorizationCode) {
      console.log('📝 Attempting to fill login credentials...');

    try {
      // Wait for email input with flexible selectors
      console.log('  🔍 Looking for email field...');
      const emailInput = await page.waitForSelector(
        'input[type="email"], input[name="email"], input[id*="email" i], input[placeholder*="email" i]',
        { timeout: 15000 }
      );

      if (!emailInput) {
        throw new Error('Email input not found');
      }

      // Click on email field first (human behavior)
      await emailInput.click();
      await page.waitForTimeout(300 + Math.random() * 200);

      // Type email slowly like a human (not instant fill)
      await emailInput.type(email, { delay: 50 + Math.random() * 30 });
      console.log('  ✓ Email typed');

      // Human-like delay before clicking continue
      await page.waitForTimeout(800 + Math.random() * 400);

      // Epic has a 2-step login: email -> Continue -> password
      // Click the Continue button to reveal password field
      console.log('  🔍 Looking for Continue button...');
      const continueBtn = await page.$('button#continue, button:has-text("Continue"), button:has-text("CONTINUE"), button[type="submit"]');

      if (continueBtn) {
        console.log('  ✓ Found Continue button, clicking...');
        await continueBtn.click();
        await page.waitForTimeout(1500 + Math.random() * 500);
      } else {
        console.log('  ⚠️  No Continue button found, password might already be visible');
        await page.waitForTimeout(500);
      }

      // Check if password field exists
      console.log('  🔍 Looking for password field...');
      const passwordInput = await page.waitForSelector(
        'input[type="password"]',
        { timeout: 10000 }
      );

      if (!passwordInput) {
        throw new Error('Password input not found');
      }

      // Click on password field first (human behavior)
      await passwordInput.click();
      await page.waitForTimeout(200 + Math.random() * 200);

      // Type password slowly like a human
      await passwordInput.type(password, { delay: 40 + Math.random() * 30 });
      console.log('  ✓ Password typed');
      console.log('');

      // Human-like delay before clicking submit (1-2 seconds)
      await page.waitForTimeout(1000 + Math.random() * 500);

      // Click login button aggressively until captcha appears
      console.log('🚀 Submitting login form...');
      console.log('');

      // EXTRACT HTML TO FIND THE CORRECT BUTTON
      console.log('  🔍 Extracting page HTML to find sign-in button...');
      const pageHtml = await page.content();

      // Log all buttons on the page
      const allButtons = await page.$$('button');
      console.log(`  📋 Found ${allButtons.length} buttons on page`);

      for (let i = 0; i < allButtons.length; i++) {
        const btn = allButtons[i];
        const text = await btn.textContent();
        const type = await btn.getAttribute('type');
        const id = await btn.getAttribute('id');
        const className = await btn.getAttribute('class');
        console.log(`    Button ${i + 1}: text="${text?.trim()}" type="${type}" id="${id}" class="${className?.substring(0, 50)}"`);
      }
      console.log('');

      // Try multiple selectors for the sign-in button
      const buttonSelectors = [
        'button#sign-in',
        'button[id*="sign-in" i]',
        'button[id*="login" i]',
        'button:has-text("Sign In")',
        'button:has-text("LOG IN")',
        'button:has-text("SIGN IN")',
        'button:has-text("Log In")',
        'button:has-text("Continue")',
        'button[type="submit"]',
        'button[class*="sign-in" i]',
        'button[class*="login" i]',
        'button[class*="submit" i]',
        '#sign-in',
        '#login-btn',
        '[data-testid*="sign-in" i]',
        '[data-testid*="login" i]',
        'form button',
      ];

      const captchaSelectors = [
        'iframe[src*="hcaptcha"]',
        'iframe[src*="recaptcha"]',
        '[class*="captcha" i]',
        '[id*="captcha" i]',
        'iframe[title*="captcha" i]',
        '#talon_container_',
        '[class*="talon" i]',
      ];

      let captchaDetected = false;
      let attempts = 0;
      const maxAttempts = 15;
      let buttonClicked = false;

      while (!captchaDetected && attempts < maxAttempts) {
        attempts++;

        // Try each button selector until one works
        buttonClicked = false;
        for (const selector of buttonSelectors) {
          try {
            const submitButton = await page.$(selector);
            if (submitButton) {
              const isVisible = await submitButton.isVisible();
              if (isVisible) {
                await submitButton.click({ force: true });
                const btnText = await submitButton.textContent();
                console.log(`  🔄 Attempt ${attempts}: Clicked "${btnText?.trim()}" (${selector})`);
                buttonClicked = true;
                break;
              }
            }
          } catch (e) {
            // Try next selector
          }
        }

        // If no button found, try JavaScript click
        if (!buttonClicked) {
          try {
            await page.evaluate(() => {
              // Find button by text content
              const buttons = document.querySelectorAll('button');
              for (const btn of buttons) {
                const text = btn.textContent?.toLowerCase() || '';
                if (text.includes('sign in') || text.includes('log in') || text.includes('continue')) {
                  (btn as HTMLButtonElement).click();
                  console.log('JS clicked:', text);
                  return true;
                }
              }
              // Try submit buttons
              const submitBtns = document.querySelectorAll('button[type="submit"]');
              if (submitBtns.length > 0) {
                (submitBtns[0] as HTMLButtonElement).click();
                return true;
              }
              return false;
            });
            console.log(`  🔄 Attempt ${attempts}: JavaScript click`);
            buttonClicked = true;
          } catch (e) {
            // Fallback to Enter key
            await passwordInput.press('Enter');
            console.log(`  🔄 Attempt ${attempts}: Pressed Enter key`);
          }
        }

        // Wait for page to react
        await page.waitForTimeout(2000);

        // Check for captcha
        for (const selector of captchaSelectors) {
          const element = await page.$(selector);
          if (element) {
            captchaDetected = true;
            console.log('');
            console.log(`  ✅ CAPTCHA DETECTED: ${selector}`);
            console.log('');
            break;
          }
        }

        // Check if we got redirected (login succeeded, now need to get OAuth code)
        const currentUrl = page.url();

        // If we're no longer on the login page, login succeeded
        if (!currentUrl.includes('/id/login') && !currentUrl.includes('code=')) {
          console.log('');
          console.log('  ✅ Login successful! Now getting OAuth code...');
          await page.goto(authorizeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(2000);
          console.log('');
          break;
        }

        // If we already have the code
        if (currentUrl.includes('code=')) {
          console.log('');
          console.log('  ✅ Login successful - got authorization code!');
          console.log('');
          break;
        }

        // Check for error messages that might indicate we need to click differently
        const errorText = await page.$eval('[class*="error" i], [role="alert"]', (el) => el.textContent).catch(() => null);
        if (errorText) {
          console.log(`  ⚠️  Error on page: ${errorText}`);
        }
      }

      if (!captchaDetected && attempts >= maxAttempts) {
        console.log(`  ⚠️  No captcha after ${maxAttempts} attempts`);
        // Extract current HTML for debugging
        const debugHtml = await page.content();
        console.log('');
        console.log('  📄 Current page HTML (buttons section):');
        const buttonMatches = debugHtml.match(/<button[^>]*>.*?<\/button>/gis);
        if (buttonMatches) {
          buttonMatches.slice(0, 5).forEach((btn, i) => {
            console.log(`    ${i + 1}: ${btn.substring(0, 200)}`);
          });
        }
        console.log('');
      }

      // MAIN LOOP: Keep solving captchas until we get the authorization code
      let maxCaptchaAttempts = 10;
      let captchaAttempt = 0;
      let alreadyNavigatedToAuthorize = false;

      while (captchaAttempt < maxCaptchaAttempts) {
        // Check if we already have the code or if login succeeded
        const currentUrlCheck = page.url();

        // Check for authorization code first
        if (currentUrlCheck.includes('code=')) {
          console.log('✅ Authorization code received!');
          console.log('');
          break;
        }

        // If we're no longer on login page, login succeeded - go get the OAuth code
        if (!currentUrlCheck.includes('/id/login') && !alreadyNavigatedToAuthorize) {
          console.log('✅ Login successful! Getting OAuth code...');
          alreadyNavigatedToAuthorize = true;
          await page.goto(authorizeUrl, { waitUntil: 'networkidle', timeout: 30000 });
          await page.waitForTimeout(2000);

          // Check URL for code= parameter
          const urlAfterAuth = page.url();
          console.log(`📍 URL after authorize redirect: ${urlAfterAuth.substring(0, 100)}...`);

          if (urlAfterAuth.includes('code=')) {
            console.log('✅ Authorization code in URL!');
            break;
          }

          // Epic might return JSON with authorizationCode instead of redirect
          try {
            const pageContent = await page.content();
            const jsonMatch = pageContent.match(/"authorizationCode"\s*:\s*"([^"]+)"/);
            if (jsonMatch && jsonMatch[1]) {
              authorizationCode = jsonMatch[1];
              console.log('✅ Authorization code found in JSON response!');
              console.log(`   Code: ${authorizationCode.substring(0, 20)}...`);
              break;
            }
          } catch (e) {
            // Not JSON, continue
          }
          continue;
        }

        // If we already tried authorize URL but no code, try extracting from page
        if (alreadyNavigatedToAuthorize) {
          try {
            const pageContent = await page.content();
            const jsonMatch = pageContent.match(/"authorizationCode"\s*:\s*"([^"]+)"/);
            if (jsonMatch && jsonMatch[1]) {
              authorizationCode = jsonMatch[1];
              console.log('✅ Authorization code found in JSON response!');
              break;
            }
          } catch (e) {
            // Not JSON
          }

          console.log('⚠️  No authorization code found, retrying...');
          await page.waitForTimeout(2000);

          // Try one more time with page reload
          await page.goto(authorizeUrl, { waitUntil: 'networkidle', timeout: 30000 });
          await page.waitForTimeout(2000);

          const retryContent = await page.content();
          const retryMatch = retryContent.match(/"authorizationCode"\s*:\s*"([^"]+)"/);
          if (retryMatch && retryMatch[1]) {
            authorizationCode = retryMatch[1];
            console.log('✅ Authorization code found on retry!');
            break;
          }

          console.log('❌ Could not get authorization code');
          break;
        }

        // Check for email verification code input
        const verificationInput = await page.$('input[name="code-input-0"], input[placeholder*="code"], input[aria-label*="verification"], input[data-testid*="verification"]');
        if (verificationInput && await verificationInput.isVisible().catch(() => false)) {
          console.log('');
          console.log('📧 Email verification code required!');
          console.log('  🔄 Fetching verification code from Outlook via Microsoft Graph...');

          let verificationCode: string | null = null;

          try {
            // Use Microsoft Graph API to fetch the code
            verificationCode = await waitForNewEpicCode(120000);
          } catch (e: any) {
            console.log(`  ❌ Failed to fetch code: ${e.message}`);
          }

          if (verificationCode) {
            try {
              // Type the code digit by digit
              for (let i = 0; i < verificationCode.length; i++) {
                const digitInput = await page.$(`input[name="code-input-${i}"]`);
                if (digitInput) {
                  await digitInput.type(verificationCode[i], { delay: 100 });
                } else {
                  // Fallback: type into main input
                  await verificationInput.type(verificationCode[i], { delay: 100 });
                }
                await page.waitForTimeout(100);
              }

              console.log('  ✅ Verification code entered');
              await page.waitForTimeout(2000);

              // Click continue/verify button
              const verifyBtn = await page.$('button:has-text("Continue"), button:has-text("Verify"), button[type="submit"]');
              if (verifyBtn) {
                await verifyBtn.click();
                await page.waitForTimeout(3000);
              }
            } catch (e: any) {
              console.log(`  ❌ Failed to enter code: ${e.message}`);
              console.log('  👉 Please enter the code manually in the browser');
              await page.waitForTimeout(60000); // Wait 60s for manual input
            }
          } else {
            console.log('  ⚠️  Could not fetch verification code automatically');
            console.log('');
            console.log('  To fix this, run: npx tsx src/scripts/check-outlook-graph.ts auth');
            console.log('  This will authenticate with Microsoft Graph (one-time setup)');
            console.log('');
            console.log('  👉 Enter the verification code in the browser window');
            console.log('  ⏳ Waiting up to 2 minutes for manual entry...');
            await page.waitForTimeout(120000); // Wait 2 min for manual input
          }
          continue;
        }

        // Check for captcha every second
        console.log('  🔍 Checking for captcha...');
        let captchaFound = false;

        for (const selector of captchaSelectors) {
          const element = await page.$(selector);
          if (element) {
            const isVisible = await element.isVisible().catch(() => false);
            if (isVisible) {
              captchaFound = true;
              console.log(`  ✅ CAPTCHA FOUND: ${selector}`);
              break;
            }
          }
        }

        if (captchaFound) {
          captchaAttempt++;
          console.log(`  🔄 Captcha attempt ${captchaAttempt}/${maxCaptchaAttempts}`);
          console.log('');

          // Solve the captcha
          try {
            await solveCaptcha(page);

            // Wait a moment for the page to process
            await page.waitForTimeout(3000);

            // Check if login succeeded after solving
            const urlAfterSolve = page.url();

            // If we're no longer on login page, login succeeded - go get OAuth code
            if (!urlAfterSolve.includes('/id/login') && !urlAfterSolve.includes('code=')) {
              console.log('✅ Login successful after captcha! Getting OAuth code...');
              await page.goto(authorizeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
              await page.waitForTimeout(2000);
            }

            // Check for authorization code
            const finalUrl = page.url();
            if (finalUrl.includes('code=')) {
              console.log('✅ Authorization code received!');
              console.log('');
              break;
            }

            // Check for "Incorrect response" error - means captcha failed
            const errorText = await page.$eval(
              '[class*="error"], [role="alert"], .challenge-error',
              (el) => el.textContent
            ).catch(() => null);

            if (errorText && (errorText.includes('Incorrect') || errorText.includes('refresh'))) {
              console.log('  ❌ Captcha failed - "Incorrect response" detected');
              console.log('  🔄 Refreshing page to get fresh captcha...');

              // Go back to simple login page to start fresh (avoids bot detection)
              await page.goto(simpleLoginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
              await page.waitForTimeout(2000);

              // Re-fill credentials with human-like typing
              const emailInputRefresh = await page.$('input[type="email"], input[name="email"]');

              if (emailInputRefresh) {
                // Clear and retype email
                await emailInputRefresh.click();
                await page.waitForTimeout(200);
                await emailInputRefresh.fill(''); // Clear first
                await emailInputRefresh.type(email, { delay: 50 + Math.random() * 30 });

                await page.waitForTimeout(800 + Math.random() * 400);

                // Click Continue button
                const continueBtnRefresh = await page.$('button#continue, button:has-text("Continue"), button:has-text("CONTINUE"), button[type="submit"]');
                if (continueBtnRefresh) {
                  await continueBtnRefresh.click();
                  await page.waitForTimeout(1500 + Math.random() * 500);
                }

                // Now find and fill password
                const passwordInputRefresh = await page.$('input[type="password"]');
                if (passwordInputRefresh) {
                  await passwordInputRefresh.click();
                  await page.waitForTimeout(200);
                  await passwordInputRefresh.type(password, { delay: 40 + Math.random() * 30 });

                  await page.waitForTimeout(1000 + Math.random() * 500);

                  // Click sign in to trigger fresh captcha
                  const signInBtnRefresh = await page.$('button#sign-in, button:has-text("Sign In"), button[type="submit"]');
                  if (signInBtnRefresh) {
                    await signInBtnRefresh.click({ force: true });
                  }
                }
                console.log('  ✓ Re-typed credentials, waiting for new captcha...');
                await page.waitForTimeout(3000);
              }
              continue;
            }

            // Check if another captcha appeared
            console.log('  🔍 Checking if another captcha appeared...');

          } catch (e: any) {
            console.log(`  ⚠️  Captcha solve attempt failed: ${e.message}`);

            // If solve completely failed, refresh page (use simple login URL)
            console.log('  🔄 Refreshing page due to error...');
            await page.goto(simpleLoginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.waitForTimeout(2000);
          }
        } else {
          // No captcha visible, wait and check again
          await page.waitForTimeout(1000);

          // Maybe we need to click the button again
          if (captchaAttempt === 0) {
            try {
              const signInBtn = await page.$('button#sign-in, button:has-text("Sign In"), button:has-text("SIGN IN"), button[type="submit"]');
              if (signInBtn) {
                const isVisible = await signInBtn.isVisible().catch(() => false);
                if (isVisible) {
                  await signInBtn.click({ force: true });
                  console.log('  🔄 Clicked sign-in button again');
                  await page.waitForTimeout(2000);
                }
              }
            } catch (e) {
              // Ignore
            }
          }
        }
      }

      if (captchaAttempt >= maxCaptchaAttempts) {
        console.log(`  ❌ Failed after ${maxCaptchaAttempts} captcha attempts`);
      }

      await page.waitForTimeout(2000);
      currentUrl = page.url();
      console.log('');

      // Extract authorization code (if not already extracted from JSON in loop)
      if (!authorizationCode) {
        if (currentUrl.includes('code=')) {
          const urlParams = new URLSearchParams(currentUrl.split('?')[1]);
          authorizationCode = urlParams.get('code');
          console.log('✓ Authorization code received from URL');
          console.log('');
        } else {
          // Try to extract from JSON response in page content
          const html = await page.content();
          const jsonMatch = html.match(/"authorizationCode"\s*:\s*"([^"]+)"/);
          if (jsonMatch && jsonMatch[1]) {
            authorizationCode = jsonMatch[1];
            console.log('✓ Authorization code received from JSON');
            console.log('');
          } else {
            // No code found - save debug info
            console.error('❌ No authorization code found');
            console.error(`   Current URL: ${currentUrl}`);
            console.error('');
            console.error('Page HTML (first 2000 chars):');
            console.error(html.substring(0, 2000));
            console.error('');
          }
        }
      } else {
        console.log('✓ Authorization code already extracted');
        console.log('');
      }

    } catch (error: any) {
      // Save screenshot and HTML for debugging
      await page.screenshot({ path: 'login-error.png', fullPage: true });
      const html = await page.content();

      console.error('');
      console.error('❌ Login form error - Debug info saved:');
      console.error(`   Screenshot: login-error.png`);
      console.error(`   Current URL: ${page.url()}`);
      console.error('');
      console.error('Page HTML (first 2000 chars):');
      console.error(html.substring(0, 2000));
      console.error('');

      throw new Error(
        `Login form error: ${error.message}\n\n` +
        'Possible issues:\n' +
        '1. Epic changed their login page structure\n' +
        '2. Wrong credentials\n' +
        '3. Captcha/2FA triggered\n\n' +
        'Debug files saved: login-error.png'
      );
    }
    } // End of if (!authorizationCode) - login form block

    // Check for 2FA or captcha
    if (currentUrl.includes('mfa') || currentUrl.includes('2fa')) {
      throw new Error(
        '❌ 2FA/MFA detected!\n\n' +
        'Your Epic account has 2FA enabled. Please disable 2FA:\n' +
        '1. Go to https://www.epicgames.com/account/password\n' +
        '2. Turn off two-factor authentication\n' +
        '3. Run this script again\n'
      );
    }

    if (currentUrl.includes('captcha') || currentUrl.includes('challenge') || currentUrl.includes('talon')) {
      throw new Error(
        '❌ Captcha/Challenge detected!\n\n' +
        'Epic Games presented a security challenge. Solutions:\n' +
        '- Wait 1-2 hours and try again\n' +
        '- Use a different network/VPN\n' +
        '- The browser window is still open - solve the captcha manually and press Enter here\n'
      );
    }

    // Verify we have an authorization code
    if (!authorizationCode) {
      throw new Error(
        `No authorization code found!\n\n` +
        `Current URL: ${currentUrl}\n\n` +
        'The login may have failed or Epic changed their OAuth flow.'
      );
    }

    console.log(`✅ Authorization code obtained: ${authorizationCode.substring(0, 20)}...`);
    console.log('');

    // STEP 3: Exchange authorization code for access token
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
      throw new Error(`Failed to exchange code for token: ${tokenResponse.status()} - ${errorText}`);
    }

    const tokenData: OAuthTokenResponse = await tokenResponse.json();

    if (!tokenData.access_token) {
      throw new Error('No access token in response');
    }

    const launcherAccessToken = tokenData.access_token;
    const accountId = tokenData.account_id;

    console.log('✓ Launcher access token obtained');
    console.log(`  Account ID: ${accountId}`);
    console.log(`  Display Name: ${tokenData.displayName || 'N/A'}`);
    console.log('');

    // STEP 4: Get exchange code from Launcher token
    console.log('🔄 Getting exchange code...');

    const exchangeUrl = `${EPIC_ENDPOINTS.ACCOUNT_SERVICE}${EPIC_ENDPOINTS.OAUTH_EXCHANGE}`;
    const exchangeResponse = await page.request.get(exchangeUrl, {
      headers: {
        'Authorization': `bearer ${launcherAccessToken}`,
      },
    });

    if (!exchangeResponse.ok()) {
      const errorText = await exchangeResponse.text();
      throw new Error(`Failed to get exchange code: ${exchangeResponse.status()} - ${errorText}`);
    }

    const exchangeData = await exchangeResponse.json();
    const exchangeCode = exchangeData.code;
    console.log('✓ Exchange code obtained');
    console.log('');

    // STEP 5: Exchange for Fortnite Android token (has device auth permissions)
    console.log('🔄 Exchanging for Fortnite Android token...');

    const fnTokenResponse = await page.request.post(tokenUrl, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': EPIC_CLIENT_CREDENTIALS.FORTNITE_ANDROID_BASIC_AUTH,
      },
      data: new URLSearchParams({
        grant_type: 'exchange_code',
        exchange_code: exchangeCode,
      }).toString(),
    });

    if (!fnTokenResponse.ok()) {
      const errorText = await fnTokenResponse.text();
      throw new Error(`Failed to get Fortnite Android token: ${fnTokenResponse.status()} - ${errorText}`);
    }

    const fnTokenData: OAuthTokenResponse = await fnTokenResponse.json();
    const accessToken = fnTokenData.access_token;

    console.log('✓ Fortnite Android access token obtained');
    console.log('');

    // STEP 6: Generate device auth using the Fortnite Android token
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

    if (!deviceAuthData.deviceId || !deviceAuthData.secret) {
      throw new Error('Invalid device auth response');
    }

    console.log('✅ Device auth credentials generated successfully!');
    console.log('');
    console.log('📋 Credentials:');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`Device ID:  ${deviceAuthData.deviceId}`);
    console.log(`Account ID: ${deviceAuthData.accountId}`);
    console.log(`Secret:     ${deviceAuthData.secret}`);
    console.log('═══════════════════════════════════════════════════════');
    console.log('');

    // STEP 7: Test device auth and get a fresh token
    console.log('🧪 Testing device auth credentials...');

    const testTokenUrl = `${EPIC_ENDPOINTS.ACCOUNT_SERVICE}${EPIC_ENDPOINTS.OAUTH_TOKEN}`;
    const testTokenResponse = await page.request.post(testTokenUrl, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': EPIC_CLIENT_CREDENTIALS.FORTNITE_ANDROID_BASIC_AUTH,
      },
      data: new URLSearchParams({
        grant_type: 'device_auth',
        device_id: deviceAuthData.deviceId,
        account_id: deviceAuthData.accountId,
        secret: deviceAuthData.secret,
      }).toString(),
    });

    if (!testTokenResponse.ok()) {
      throw new Error('Device auth test failed! Credentials may be invalid.');
    }

    const testTokenData: OAuthTokenResponse = await testTokenResponse.json();
    console.log('✓ Device auth works! Token obtained successfully.');
    console.log('');

    // STEP 6: Save to database
    console.log('💾 Saving credentials to Supabase database...');

    await prisma.oAuthToken.create({
      data: {
        accountId: deviceAuthData.accountId,
        accessToken: testTokenData.access_token,
        refreshToken: testTokenData.refresh_token || '',
        expiresAt: new Date(testTokenData.expires_at),
      },
    });

    console.log('✓ Credentials saved to database');
    console.log('');

    // STEP 7: Print instructions
    console.log('📝 Next Steps:');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    console.log('1. Copy these credentials to your .env file:');
    console.log('');
    console.log(`   EPIC_DEVICE_ID=${deviceAuthData.deviceId}`);
    console.log(`   EPIC_ACCOUNT_ID=${deviceAuthData.accountId}`);
    console.log(`   EPIC_DEVICE_SECRET=${deviceAuthData.secret}`);
    console.log('');
    console.log('2. Restart your API server:');
    console.log('   npm run dev');
    console.log('');
    console.log('3. Your API will automatically refresh tokens every 4 hours!');
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    console.log('✅ Device auth generation complete!');
    console.log('');

  } catch (error: any) {
    console.error('');
    console.error('═══════════════════════════════════════════════════════');
    console.error('❌ ERROR GENERATING DEVICE AUTH');
    console.error('═══════════════════════════════════════════════════════');
    console.error('');
    console.error(error.message);
    console.error('');

    if (error.stack && config.debug) {
      console.error('Stack trace:');
      console.error(error.stack);
      console.error('');
    }

    console.error('Need help? Check:');
    console.error('- src/scripts/README.md for troubleshooting');
    console.error('- Make sure 2FA is disabled on your Epic account');
    console.error('- Verify credentials in .env file');
    console.error('');

    process.exit(1);
  } finally {
    // Close browser
    if (browser) {
      console.log('🔒 Closing browser...');
      await browser.close();
      console.log('✓ Browser closed');
      console.log('');
    }
  }
}

// Run the script
generateDeviceAuth()
  .then(() => {
    console.log('👋 Script finished successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
