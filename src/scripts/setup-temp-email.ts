import { createMailAccount } from './email-helper.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Creates a temporary email account for Epic Games signup
 * Adds credentials to .env file
 */

async function setupTempEmail() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('📧 TEMPORARY EMAIL SETUP FOR EPIC GAMES');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');

  try {
    // Create temp email account
    const account = await createMailAccount();

    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('✅ EMAIL ACCOUNT CREATED');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    console.log('📧 Email Address:', account.address);
    console.log('🔑 Password:', account.password);
    console.log('🎫 API Token:', account.token.substring(0, 50) + '...');
    console.log('');

    // Update .env file
    const envPath = path.join(process.cwd(), '.env');
    let envContent = fs.readFileSync(envPath, 'utf-8');

    // Update or add EPIC_ACCOUNT_EMAIL
    if (envContent.includes('EPIC_ACCOUNT_EMAIL=')) {
      envContent = envContent.replace(
        /EPIC_ACCOUNT_EMAIL=.*/,
        `EPIC_ACCOUNT_EMAIL=${account.address}`
      );
    } else {
      envContent += `\nEPIC_ACCOUNT_EMAIL=${account.address}`;
    }

    // Add MAIL_TM_TOKEN for auto-verification
    if (envContent.includes('MAIL_TM_TOKEN=')) {
      envContent = envContent.replace(
        /MAIL_TM_TOKEN=.*/,
        `MAIL_TM_TOKEN=${account.token}`
      );
    } else {
      envContent += `\nMAIL_TM_TOKEN=${account.token}`;
    }

    fs.writeFileSync(envPath, envContent);

    console.log('═══════════════════════════════════════════════════════');
    console.log('📝 NEXT STEPS');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    console.log('1. Go to: https://www.epicgames.com/id/register');
    console.log('');
    console.log('2. Create an Epic account with:');
    console.log(`   Email: ${account.address}`);
    console.log('   Password: Choose a strong password (save it!)');
    console.log('   Display Name: Anything you want');
    console.log('   DON\'T enable 2FA');
    console.log('');
    console.log('3. Update .env with your chosen Epic password:');
    console.log('   EPIC_ACCOUNT_PASSWORD=your_chosen_password');
    console.log('');
    console.log('4. Run: npm run generate-auth');
    console.log('   (Verification codes will be auto-fetched!)');
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    console.log('💾 .env has been updated with:');
    console.log(`   EPIC_ACCOUNT_EMAIL=${account.address}`);
    console.log('   MAIL_TM_TOKEN=<token for auto-verification>');
    console.log('');

  } catch (error: any) {
    console.error('❌ Failed to create email:', error.message);
    process.exit(1);
  }
}

setupTempEmail();
