import { chromium } from 'playwright';

/**
 * Debug script to inspect Epic Games login page
 * Takes screenshots and shows HTML structure
 */

async function debugLoginPage() {
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
  });

  const page = await context.newPage();

  try {
    // Logout first
    console.log('Logging out...');
    await page.goto('https://www.epicgames.com/id/logout', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Navigate to login
    const clientId = 'ec684b8c687f479fadea3cb2ad83f5c6';
    const authorizeUrl = `https://www.epicgames.com/id/api/redirect?clientId=${clientId}&responseType=code`;

    console.log('Navigating to login page...');
    await page.goto(authorizeUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    console.log('Current URL:', currentUrl);

    // Take screenshot
    await page.screenshot({ path: 'debug-login-page.png', fullPage: true });
    console.log('Screenshot saved to: debug-login-page.png');

    // Get page HTML
    const html = await page.content();
    console.log('\n=== PAGE HTML (first 2000 chars) ===');
    console.log(html.substring(0, 2000));
    console.log('...\n');

    // Look for common form elements
    console.log('=== SEARCHING FOR FORM ELEMENTS ===');

    const selectors = [
      'input[type="email"]',
      'input[type="text"]',
      'input[name="email"]',
      'input[name="usernameOrEmail"]',
      '#email',
      '#login',
      '#username',
      'input[placeholder*="email"]',
      'input[placeholder*="Email"]',
      'form input',
    ];

    for (const selector of selectors) {
      const element = await page.$(selector);
      if (element) {
        const attrs = await element.evaluate((el) => {
          return {
            id: el.id,
            name: (el as HTMLInputElement).name,
            type: (el as HTMLInputElement).type,
            placeholder: (el as HTMLInputElement).placeholder,
            className: el.className,
          };
        });
        console.log(`✓ Found: ${selector}`);
        console.log('  Attributes:', attrs);
      }
    }

    console.log('\n=== ALL INPUT FIELDS ===');
    const inputs = await page.$$('input');
    console.log(`Total input fields: ${inputs.length}`);

    for (let i = 0; i < inputs.length; i++) {
      const attrs = await inputs[i].evaluate((el) => {
        return {
          id: el.id,
          name: (el as HTMLInputElement).name,
          type: (el as HTMLInputElement).type,
          placeholder: (el as HTMLInputElement).placeholder,
          className: el.className,
        };
      });
      console.log(`Input ${i + 1}:`, attrs);
    }

    console.log('\n=== ALL BUTTONS ===');
    const buttons = await page.$$('button');
    console.log(`Total buttons: ${buttons.length}`);

    for (let i = 0; i < buttons.length; i++) {
      const attrs = await buttons[i].evaluate((el) => {
        return {
          id: el.id,
          type: (el as HTMLButtonElement).type,
          text: el.textContent?.trim(),
          className: el.className,
        };
      });
      console.log(`Button ${i + 1}:`, attrs);
    }

    console.log('\n=== WAITING FOR MANUAL INSPECTION ===');
    console.log('Browser window is open. Inspect the page and press Ctrl+C when done.');
    await page.waitForTimeout(300000); // Wait 5 minutes for manual inspection

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
  }
}

debugLoginPage();
