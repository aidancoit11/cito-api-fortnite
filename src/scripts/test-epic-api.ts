import axios from 'axios';
import { config } from '../config/index.js';
import { EPIC_ENDPOINTS, EPIC_CLIENT_CREDENTIALS, GRANT_TYPES } from '../config/endpoints.js';

/**
 * Test Epic Games API endpoints with device auth credentials
 */

async function testEpicApi() {
  console.log('');
  console.log('🧪 Testing Epic Games API with Device Auth');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');

  const deviceId = config.epic.deviceId;
  const accountId = config.epic.accountId;
  const secret = config.epic.deviceSecret;

  if (!deviceId || !accountId || !secret) {
    console.error('❌ Missing device auth credentials in .env');
    console.error('   Run npm run generate-auth first');
    process.exit(1);
  }

  console.log('Device ID:', deviceId);
  console.log('Account ID:', accountId);
  console.log('');

  try {
    // Step 1: Get access token using device auth
    console.log('1️⃣  Getting access token with device auth...');

    const tokenUrl = `${EPIC_ENDPOINTS.ACCOUNT_SERVICE}${EPIC_ENDPOINTS.OAUTH_TOKEN}`;
    const tokenResponse = await axios.post(
      tokenUrl,
      new URLSearchParams({
        grant_type: GRANT_TYPES.DEVICE_AUTH,
        device_id: deviceId,
        account_id: accountId,
        secret: secret,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: EPIC_CLIENT_CREDENTIALS.FORTNITE_ANDROID_BASIC_AUTH,
        },
      }
    );

    const accessToken = tokenResponse.data.access_token;
    console.log('   ✅ Access token obtained!');
    console.log(`   Display Name: ${tokenResponse.data.displayName}`);
    console.log(`   Expires in: ${tokenResponse.data.expires_in} seconds`);
    console.log('');

    // Step 2: Test account lookup (Ninja)
    console.log('2️⃣  Looking up account: Ninja...');

    const lookupUrl = `${EPIC_ENDPOINTS.ACCOUNT_SERVICE}/account/api/public/account/displayName/Ninja`;
    const lookupResponse = await axios.get(lookupUrl, {
      headers: { Authorization: `bearer ${accessToken}` },
    });

    const ninjaAccount = lookupResponse.data;
    console.log('   ✅ Account found!');
    console.log(`   ID: ${ninjaAccount.id}`);
    console.log(`   Display Name: ${ninjaAccount.displayName}`);
    console.log('');

    // Step 3: Test stats endpoint
    console.log('3️⃣  Fetching Fortnite stats for Ninja...');

    const statsUrl = `${EPIC_ENDPOINTS.STATS_PROXY}/statsproxy/api/statsv2/account/${ninjaAccount.id}`;
    const statsResponse = await axios.get(statsUrl, {
      headers: { Authorization: `bearer ${accessToken}` },
    });

    const stats = statsResponse.data;
    console.log('   ✅ Stats retrieved!');
    console.log(`   Account ID: ${stats.accountId}`);

    // Count stats entries
    const statsCount = Object.keys(stats.stats || {}).length;
    console.log(`   Stats entries: ${statsCount}`);
    console.log('');

    // Step 4: Test competitive player data endpoint (own account)
    console.log('4️⃣  Fetching Own Competitive Data...');

    const compUrl = `https://events-public-service-live.ol.epicgames.com/api/v1/players/Fortnite/${accountId}`;
    const compResponse = await axios.get(compUrl, {
      headers: { Authorization: `bearer ${accessToken}` },
    });

    const compData = compResponse.data;
    console.log('   ✅ Competitive data retrieved!');
    console.log(`   Account ID: ${compData.accountId}`);
    console.log(`   Teams: ${compData.teams?.length || 0}`);
    console.log(`   Pending payouts: ${compData.pendingPayouts?.length || 0}`);

    // Step 5: Download events data (with region)
    console.log('');
    console.log('5️⃣  Downloading Events Data...');

    const eventsUrl = `https://events-public-service-live.ol.epicgames.com/api/v1/events/Fortnite/download/${accountId}?region=NAE&platform=Windows&teamAccountIds=${accountId}`;
    const eventsResponse = await axios.get(eventsUrl, {
      headers: { Authorization: `bearer ${accessToken}` },
    });

    const eventsData = eventsResponse.data;
    console.log('   ✅ Events downloaded!');
    console.log(`   Events: ${eventsData.events?.length || 0}`);
    console.log(`   Templates: ${eventsData.templates?.length || 0}`);
    if (eventsData.events?.length > 0) {
      console.log('   Sample events:');
      eventsData.events.slice(0, 3).forEach((e: any) => {
        console.log(`     - ${e.eventId}`);
      });
    }
    console.log('');

    // Success summary
    console.log('═══════════════════════════════════════════════════════');
    console.log('🎉 All Epic Games API endpoints working!');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');

  } catch (error: any) {
    console.error('');
    console.error('❌ API Error:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

testEpicApi();
