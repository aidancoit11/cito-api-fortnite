# Device Auth Generator Script

Automated Playwright script to generate Epic Games device auth credentials.

## Usage

```bash
npm run generate-auth
```

## What it does

1. **Launches browser** - Opens Chromium in headless mode
2. **Navigates to Epic login** - Goes to Epic Games OAuth authorize page
3. **Fills credentials** - Enters email/password from `.env` file
4. **Handles login** - Submits form and waits for authorization code
5. **Exchanges code** - Converts authorization code to access token
6. **Generates device auth** - Creates device_id and secret
7. **Saves to database** - Stores credentials in Supabase `oauth_tokens` table
8. **Prints to console** - Shows credentials to copy to `.env` file

## Prerequisites

- Epic Games account configured in `.env`:
  ```
  EPIC_ACCOUNT_EMAIL=your-email@example.com
  EPIC_ACCOUNT_PASSWORD=your-password
  ```
- **NO 2FA** on Epic account (script will fail with clear message if 2FA is enabled)
- Supabase database connected and `oauth_tokens` table created

## Output

The script will print:
```
✅ Device auth credentials generated successfully!

📋 Credentials:
─────────────────────────────────────────────────
Device ID:  abc123...
Account ID: def456...
Secret:     ghi789...
─────────────────────────────────────────────────

📝 Update your .env file with these values:
─────────────────────────────────────────────────
EPIC_DEVICE_ID=abc123...
EPIC_ACCOUNT_ID=def456...
EPIC_DEVICE_SECRET=ghi789...
─────────────────────────────────────────────────
```

## Error Handling

### 2FA Detected
```
❌ 2FA/MFA detected!

Your Epic account has 2FA enabled. Please disable 2FA on your burner account:
1. Go to https://www.epicgames.com/account/password
2. Turn off two-factor authentication
3. Run this script again
```

**Solution**: Disable 2FA on your burner Epic account

### Captcha Detected
```
❌ Captcha detected!

Epic Games has presented a captcha challenge.
```

**Solutions**:
- Wait 1-2 hours and try again
- Use a different IP address (VPN)
- Run with `headless: false` in script and solve captcha manually

### Login Failed
```
❌ Login failed!

Possible reasons:
1. Incorrect email or password
2. Account locked or banned
3. Epic detected automated login
```

**Solution**: Verify credentials in `.env` file

## Debugging

To see the browser window (helpful for debugging):

Edit `src/scripts/generate-device-auth.ts`:
```typescript
browser = await chromium.launch({
  headless: false, // Change to false
  ...
});
```

Then run again:
```bash
npm run generate-auth
```

## Next Steps

After running successfully:

1. Copy the credentials printed to console
2. Add them to your `.env` file:
   ```
   EPIC_DEVICE_ID=abc123...
   EPIC_ACCOUNT_ID=def456...
   EPIC_DEVICE_SECRET=ghi789...
   ```
3. Restart your API server:
   ```bash
   npm run dev
   ```
4. Your API will now automatically refresh tokens every 4 hours!

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Browser doesn't launch | Run `npx playwright install chromium` |
| Script hangs at login | Epic may have changed their login page structure |
| Database error | Ensure Supabase is connected and tables are created |
| Network timeout | Check your internet connection |

## Security Note

- This script uses your Epic account credentials
- Credentials are read from `.env` file (never committed to git)
- Device auth is stored in Supabase database (encrypted at rest)
- Access tokens expire after 6 hours but auto-refresh
- Use a **burner Epic account**, not your personal account

## Technical Details

- **Browser**: Chromium (via Playwright)
- **Auth Flow**: OAuth 2.0 Authorization Code Grant
- **Grant Types Used**:
  1. `authorization_code` - Initial login
  2. `device_auth` - Subsequent logins (stored in DB)
- **Endpoints**:
  - `/api/redirect` - OAuth authorize
  - `/account/api/oauth/token` - Token exchange
  - `/account/api/public/account/{id}/deviceAuth` - Device auth generation
