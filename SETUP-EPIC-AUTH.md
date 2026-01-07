# Epic Games Authentication Setup Guide

## ⚠️ CRITICAL: Token Refresh System

This API requires a **dedicated Epic Games account** with automated token refresh to prevent the API from breaking every 6 hours when OAuth tokens expire.

---

## Step 1: Create Burner Epic Account

### Requirements
1. Create a **NEW Epic Games account** (separate from your personal account)
2. **DO NOT enable 2FA** (two-factor authentication) - the automation requires direct login
3. Use a disposable email service or create a dedicated Gmail account
4. This account is **ONLY for API authentication** - never use it for gameplay

### Security Best Practices
- Use a strong, unique password
- Store credentials only in `.env` file (never commit to git)
- Rotate the account every 6 months
- Monitor the account for any suspicious activity
- Consider using a password manager to generate/store credentials

### How to Create

1. Go to https://www.epicgames.com/id/register
2. Fill in the form:
   - Email: `fortnite-api-burner@yourdomain.com` (or any disposable email)
   - Username: Something generic like `FortniteAPI_Bot`
   - Password: Generate a strong password (min 20 chars)
3. Verify email
4. **IMPORTANT:** Do NOT enable 2FA when prompted
5. Login to Epic Games once to verify the account works

---

## Step 2: Configure Environment Variables

### Fill in `.env` file

Open `/cito api fortnite/.env` and fill in:

```bash
# Epic Account Credentials
EPIC_ACCOUNT_EMAIL=fortnite-api-burner@yourdomain.com
EPIC_ACCOUNT_PASSWORD=your-super-secure-password-here

# Leave these blank for now (generated automatically)
EPIC_DEVICE_ID=
EPIC_ACCOUNT_ID=
EPIC_DEVICE_SECRET=
```

---

## Step 3: Generate Device Auth Credentials

### What is Device Auth?

Device Auth allows the API to authenticate without requiring your password every time. It generates a `device_id` and `secret` that can be exchanged for access tokens.

### How to Generate

**Option A: Use the API endpoint (after building the API)**

1. Start your API server: `npm run dev`
2. Make a POST request to `/auth/device`:
   ```bash
   curl -X POST http://localhost:3000/api/v1/auth/device \
     -H "Content-Type: application/json" \
     -d '{
       "email": "fortnite-api-burner@yourdomain.com",
       "password": "your-super-secure-password-here"
     }'
   ```
3. Response will include:
   ```json
   {
     "deviceId": "abc123...",
     "accountId": "def456...",
     "secret": "ghi789..."
   }
   ```
4. Copy these values to your `.env` file:
   ```bash
   EPIC_DEVICE_ID=abc123...
   EPIC_ACCOUNT_ID=def456...
   EPIC_DEVICE_SECRET=ghi789...
   ```

**Option B: Manual generation (Python script)**

If you need to generate device auth before building the API:

```python
import requests

# Step 1: Get access token with email/password
auth_response = requests.post(
    'https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token',
    headers={
        'Authorization': 'basic ZWM2ODRiOGM2ODdmNDc5ZmFkZWEzY2IyYWQ4M2Y1YzY6ZTFmMzFjMjExZjI4NDEzMTg2MjYyZDM3YTEzZmM4NGQ=',
        'Content-Type': 'application/x-www-form-urlencoded'
    },
    data={
        'grant_type': 'password',
        'username': 'fortnite-api-burner@yourdomain.com',
        'password': 'your-super-secure-password-here'
    }
)

access_token = auth_response.json()['access_token']
account_id = auth_response.json()['account_id']

# Step 2: Generate device auth
device_response = requests.post(
    f'https://account-public-service-prod.ol.epicgames.com/account/api/public/account/{account_id}/deviceAuth',
    headers={
        'Authorization': f'bearer {access_token}'
    }
)

device_auth = device_response.json()
print(f"EPIC_DEVICE_ID={device_auth['deviceId']}")
print(f"EPIC_ACCOUNT_ID={device_auth['accountId']}")
print(f"EPIC_DEVICE_SECRET={device_auth['secret']}")
```

---

## Step 4: Verify Token Refresh System

### How It Works

1. **Token Manager Service** (`src/services/epic/token-manager.service.ts`)
   - Stores access tokens in Supabase (`oauth_tokens` table)
   - Checks if token expires within 30 minutes
   - Auto-refreshes tokens before expiration
   - Returns valid token for all Epic API requests

2. **Token Refresh Job** (`src/jobs/token-refresh.ts`)
   - Runs **every 4 hours** (before 6-hour expiration)
   - Exchanges refresh token for new access token
   - Updates database with new tokens
   - Logs refresh status

3. **Epic Auth Middleware** (`src/middleware/epic-auth.middleware.ts`)
   - Injects fresh token into all Epic API requests
   - Auto-refreshes if expired
   - Throws error if refresh fails

### Token Lifecycle

```
Initial Login (Device Auth)
    ↓
Access Token (valid 6 hours)
    ↓
Token Refresh Job (every 4 hours)
    ↓
New Access Token (valid 6 hours)
    ↓
Repeat Forever
```

### Testing Token Refresh

After setting up, verify the system works:

1. Check database for stored token:
   ```sql
   SELECT * FROM oauth_tokens ORDER BY created_at DESC LIMIT 1;
   ```

2. Verify token is valid:
   ```bash
   curl http://localhost:3000/api/v1/player/lookup?username=Ninja
   ```

3. Check logs for refresh job:
   ```bash
   tail -f logs/api.log | grep "token-refresh"
   ```

---

## Step 5: Monitor Token Health

### Alerts to Set Up

1. **Discord Webhook** (optional but recommended)
   - Get notified when token refresh fails
   - Add webhook URL to `.env`:
     ```bash
     DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
     ```

2. **Sentry Error Tracking** (optional)
   - Track authentication errors
   - Add DSN to `.env`:
     ```bash
     SENTRY_DSN=https://...@sentry.io/...
     ```

### Common Issues

| Issue | Solution |
|-------|----------|
| `Invalid credentials` | Verify EPIC_ACCOUNT_EMAIL and EPIC_ACCOUNT_PASSWORD in `.env` |
| `Device auth expired` | Re-generate device auth using `/auth/device` endpoint |
| `Token refresh failed` | Check if Epic account has 2FA enabled (must be disabled) |
| `Account locked` | Epic may lock accounts with suspicious activity - use a new burner |
| `Rate limited` | Epic may rate limit frequent auth requests - wait 1 hour |

---

## Step 6: Account Rotation (Every 6 Months)

To maintain security, rotate your burner account twice a year:

1. Create new Epic account (follow Step 1)
2. Generate new device auth (follow Step 3)
3. Update `.env` with new credentials
4. Restart API server
5. Verify token refresh works
6. Delete old Epic account

---

## Security Checklist

- [ ] Created dedicated Epic account (no 2FA)
- [ ] Used strong, unique password
- [ ] Stored credentials only in `.env` file
- [ ] Added `.env` to `.gitignore`
- [ ] Generated device auth credentials
- [ ] Verified token refresh job runs every 4 hours
- [ ] Set up monitoring/alerts (Discord/Sentry)
- [ ] Documented account rotation schedule (every 6 months)

---

## FAQ

**Q: Why no 2FA?**
A: The automated token refresh requires direct login without 2FA. Since this is a dedicated burner account (not your personal account), the risk is minimal.

**Q: What if my token refresh fails?**
A: The API will throw errors. Check logs, verify credentials, and re-generate device auth if needed. Set up Discord alerts to get notified immediately.

**Q: Can I use my personal Epic account?**
A: **NO.** Never use your personal account. Always create a dedicated burner account for API access.

**Q: How often do I need to refresh tokens?**
A: Automatic! The token refresh job runs every 4 hours. You don't need to do anything manually.

**Q: What happens if Epic locks my account?**
A: Create a new burner account and update `.env`. Epic may flag automated logins, so rotating accounts every 6 months helps prevent this.

---

## Next Steps

Once authentication is set up:

1. ✅ Verify `.env` is filled correctly
2. ✅ Run `npm install` to install dependencies
3. ✅ Run `npx prisma migrate dev` to set up database
4. ✅ Run `npm run dev` to start the API
5. ✅ Test authentication with `/player/lookup` endpoint
6. ✅ Monitor logs for token refresh job

**You're ready to build!** 🚀
