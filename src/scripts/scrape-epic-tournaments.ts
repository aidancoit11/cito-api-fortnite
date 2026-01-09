/**
 * Epic Games Tournament Scraper
 *
 * Scrapes top 500 results for all available tournaments from Epic Games API
 * - Fetches events for all regions
 * - Gets leaderboard for each completed event window
 * - Stores results in database with accountId for stable identity
 */

import axios from 'axios';
import { prisma } from '../db/client.js';
import { config } from '../config/index.js';
import { EPIC_ENDPOINTS, EPIC_CLIENT_CREDENTIALS, GRANT_TYPES } from '../config/endpoints.js';

const EVENTS_API_BASE = 'https://events-public-service-live.ol.epicgames.com';
const REGIONS = ['NAE', 'NAW', 'EU', 'BR', 'OCE', 'ASIA', 'ME'];

interface EventWindow {
  eventWindowId: string;
  eventId: string;
  beginTime: string;
  endTime: string;
  round: number;
}

interface Event {
  eventId: string;
  displayDataId: string;
  eventWindows: EventWindow[];
  regions: string[];
}

interface LeaderboardEntry {
  rank: number;
  accountId: string;
  displayName: string;
  teamAccountIds: string[];
  points: number;
  kills: number;
  matchesPlayed: number;
  sessionHistory?: any[];
}

// Cache for display names to reduce API calls
const displayNameCache = new Map<string, string>();

async function lookupDisplayNames(accountIds: string[]): Promise<void> {
  // Filter out already cached IDs
  const uncachedIds = accountIds.filter(id => !displayNameCache.has(id));
  if (uncachedIds.length === 0) return;

  // Epic allows up to 100 accounts per request
  const batches = [];
  for (let i = 0; i < uncachedIds.length; i += 100) {
    batches.push(uncachedIds.slice(i, i + 100));
  }

  for (const batch of batches) {
    try {
      const token = await getAccessToken();
      const url = `${EPIC_ENDPOINTS.ACCOUNT_SERVICE}/account/api/public/account?accountId=${batch.join('&accountId=')}`;

      const response = await axios.get<any[]>(url, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000,
      });

      for (const account of response.data || []) {
        if (account.id && account.displayName) {
          displayNameCache.set(account.id, account.displayName);
        }
      }
    } catch (error: any) {
      // Continue even if lookup fails - will use accountId as fallback
    }
    await sleep(100);
  }
}

let accessToken: string | null = null;
let tokenExpiry: Date | null = null;

async function getAccessToken(): Promise<string> {
  // Reuse token if still valid
  if (accessToken && tokenExpiry && new Date() < tokenExpiry) {
    return accessToken;
  }

  const tokenUrl = `${EPIC_ENDPOINTS.ACCOUNT_SERVICE}${EPIC_ENDPOINTS.OAUTH_TOKEN}`;
  const response = await axios.post(
    tokenUrl,
    new URLSearchParams({
      grant_type: GRANT_TYPES.DEVICE_AUTH,
      device_id: config.epic.deviceId!,
      account_id: config.epic.accountId!,
      secret: config.epic.deviceSecret!,
    }).toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: EPIC_CLIENT_CREDENTIALS.FORTNITE_ANDROID_BASIC_AUTH,
      },
    }
  );

  accessToken = response.data.access_token;
  tokenExpiry = new Date(Date.now() + (response.data.expires_in - 300) * 1000); // 5 min buffer

  return accessToken!;
}

async function epicRequest<T>(url: string, retries = 2): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const token = await getAccessToken();
      const response = await axios.get<T>(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });
      return response.data;
    } catch (error: any) {
      lastError = error;

      if (error.response?.status === 401 || error.response?.status === 403) {
        accessToken = null; // Force token refresh
        if (attempt < retries) {
          await sleep(1000);
          continue;
        }
      }

      // Don't retry on 404 or other client errors
      if (error.response?.status >= 400 && error.response?.status < 500) {
        break;
      }

      if (attempt < retries) {
        await sleep(1000 * (attempt + 1));
      }
    }
  }

  throw lastError || new Error('Request failed');
}

async function getAllEvents(): Promise<Event[]> {
  console.log('📥 Fetching events from all regions...');
  const allEvents: Map<string, Event> = new Map();
  const accountId = config.epic.accountId!;

  for (const region of REGIONS) {
    try {
      console.log(`  ${region}...`);
      const url = `${EVENTS_API_BASE}/api/v1/events/Fortnite/download/${accountId}?region=${region}&platform=Windows&teamAccountIds=${accountId}`;

      const data = await epicRequest<any>(url);
      const events = data.events || [];

      for (const event of events) {
        if (!allEvents.has(event.eventId)) {
          allEvents.set(event.eventId, {
            eventId: event.eventId,
            displayDataId: event.displayDataId || event.eventId,
            eventWindows: event.eventWindows || [],
            regions: event.regions || [region],
          });
        }
      }

      await sleep(200);
    } catch (error: any) {
      console.log(`  ⚠️  ${region}: ${error.message}`);
    }
  }

  console.log(`Found ${allEvents.size} unique events\n`);
  return Array.from(allEvents.values());
}

async function getLeaderboard(eventId: string, windowId: string, page: number = 0): Promise<LeaderboardEntry[]> {
  const accountId = config.epic.accountId!;
  const url = `${EVENTS_API_BASE}/api/v1/leaderboards/Fortnite/${eventId}/${windowId}/${accountId}?page=${page}&rank=0&teamAccountIds=&appId=Fortnite&showLiveSessions=false`;

  try {
    const data = await epicRequest<any>(url);
    const entries: LeaderboardEntry[] = [];

    for (const entry of data.entries || []) {
      // Get primary account ID (first team member for team modes)
      const primaryAccountId = entry.teamAccountIds?.[0] || '';
      if (!primaryAccountId) continue;

      // Calculate kills from session history
      let totalKills = 0;
      const sessions = entry.sessionHistory || [];
      for (const session of sessions) {
        totalKills += session.trackedStats?.TEAM_ELIMS_STAT_INDEX || 0;
      }

      entries.push({
        rank: entry.rank || 0,
        accountId: primaryAccountId,
        displayName: '', // Will be filled in later
        teamAccountIds: entry.teamAccountIds || [],
        points: entry.pointsEarned || 0,
        kills: totalKills,
        matchesPlayed: sessions.length,
        sessionHistory: sessions,
      });
    }

    return entries;
  } catch (error: any) {
    // 404 = no leaderboard available
    if (error.response?.status === 404) {
      return [];
    }
    throw error;
  }
}

async function getFullLeaderboard(eventId: string, windowId: string, limit: number = 500): Promise<LeaderboardEntry[]> {
  const allEntries: LeaderboardEntry[] = [];
  const maxPages = Math.ceil(limit / 100);

  for (let page = 0; page < maxPages; page++) {
    const entries = await getLeaderboard(eventId, windowId, page);
    if (entries.length === 0) break;

    allEntries.push(...entries);

    if (entries.length < 100) break; // No more pages
    await sleep(100);
  }

  const finalEntries = allEntries.slice(0, limit);

  // Lookup display names for all entries
  const accountIds = finalEntries.map(e => e.accountId);
  await lookupDisplayNames(accountIds);

  // Fill in display names from cache
  for (const entry of finalEntries) {
    entry.displayName = displayNameCache.get(entry.accountId) || entry.accountId.substring(0, 12);
  }

  return finalEntries;
}

async function syncLeaderboardToDatabase(
  eventId: string,
  windowId: string,
  eventName: string,
  startDate: Date,
  endDate: Date,
  entries: LeaderboardEntry[]
): Promise<number> {
  const tournamentId = `epic-${eventId}-${windowId}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  // Extract region from event ID
  let region = 'Unknown';
  const regionMatch = eventId.match(/(NAE|NAW|EU|BR|OCE|ASIA|ME|NAC)/i);
  if (regionMatch) {
    const regionMap: Record<string, string> = {
      'NAE': 'NA East', 'NAW': 'NA West', 'EU': 'Europe',
      'BR': 'Brazil', 'OCE': 'Oceania', 'ASIA': 'Asia',
      'ME': 'Middle East', 'NAC': 'NA Central'
    };
    region = regionMap[regionMatch[1].toUpperCase()] || regionMatch[1];
  }

  // Upsert tournament
  await prisma.tournament.upsert({
    where: { tournamentId },
    create: {
      tournamentId,
      name: eventName,
      startDate,
      endDate,
      region,
      isCompleted: true,
      data: {
        eventId,
        eventWindowId: windowId,
        source: 'epic-api',
      },
    },
    update: {
      name: eventName,
      startDate,
      endDate,
      region,
      isCompleted: true,
      data: {
        eventId,
        eventWindowId: windowId,
        source: 'epic-api',
      },
      lastUpdated: new Date(),
    },
  });

  let synced = 0;

  // Upsert results
  for (const entry of entries) {
    if (!entry.accountId) continue;

    try {
      await prisma.tournamentResult.upsert({
        where: {
          tournamentId_accountId: {
            tournamentId,
            accountId: entry.accountId,
          },
        },
        create: {
          tournamentId,
          accountId: entry.accountId,
          displayName: entry.displayName,
          rank: entry.rank,
          points: entry.points,
          kills: entry.kills,
          matchesPlayed: entry.matchesPlayed,
          data: {
            teamAccountIds: entry.teamAccountIds,
            source: 'epic-api',
          },
        },
        update: {
          displayName: entry.displayName,
          rank: entry.rank,
          points: entry.points,
          kills: entry.kills,
          matchesPlayed: entry.matchesPlayed,
          data: {
            teamAccountIds: entry.teamAccountIds,
            source: 'epic-api',
          },
        },
      });
      synced++;
    } catch (error: any) {
      // Skip errors for individual entries
    }
  }

  return synced;
}

async function main() {
  console.log('');
  console.log('🏆 Epic Games Tournament Scraper');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');

  // Get all events
  const events = await getAllEvents();
  const now = new Date();

  // Filter to completed event windows
  const completedWindows: Array<{ event: Event; window: EventWindow }> = [];

  for (const event of events) {
    for (const window of event.eventWindows) {
      const endTime = new Date(window.endTime);
      // Only include windows that ended in the past year
      const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

      if (endTime < now && endTime > oneYearAgo) {
        completedWindows.push({ event, window });
      }
    }
  }

  console.log(`Found ${completedWindows.length} completed event windows from the past year\n`);

  let totalTournaments = 0;
  let totalResults = 0;
  let errors = 0;

  // Sort by end date (most recent first)
  completedWindows.sort((a, b) =>
    new Date(b.window.endTime).getTime() - new Date(a.window.endTime).getTime()
  );

  for (let i = 0; i < completedWindows.length; i++) {
    const { event, window } = completedWindows[i];
    const progress = `[${i + 1}/${completedWindows.length}]`;

    process.stdout.write(`${progress} ${event.displayDataId}...`);

    try {
      // Fetch leaderboard (top 500)
      const entries = await getFullLeaderboard(event.eventId, window.eventWindowId, 500);

      if (entries.length === 0) {
        console.log(' no data');
        continue;
      }

      // Sync to database
      const synced = await syncLeaderboardToDatabase(
        event.eventId,
        window.eventWindowId,
        event.displayDataId,
        new Date(window.beginTime),
        new Date(window.endTime),
        entries
      );

      console.log(` ✓ ${synced} results`);
      totalTournaments++;
      totalResults += synced;

      // Rate limit
      await sleep(200);
    } catch (error: any) {
      console.log(` ✗ ${error.message}`);
      errors++;
    }

    // Progress update every 10 events
    if ((i + 1) % 10 === 0) {
      console.log(`\n📊 Progress: ${totalTournaments} tournaments, ${totalResults} results, ${errors} errors\n`);
    }
  }

  // Final stats
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('📊 Final Results:');
  console.log(`   Tournaments: ${totalTournaments}`);
  console.log(`   Results: ${totalResults}`);
  console.log(`   Errors: ${errors}`);
  console.log('═══════════════════════════════════════════════════════');

  // Show database stats
  const dbTournaments = await prisma.tournament.count({
    where: { data: { path: ['source'], equals: 'epic-api' } }
  });
  const dbResults = await prisma.tournamentResult.count({
    where: { data: { path: ['source'], equals: 'epic-api' } }
  });

  console.log('');
  console.log('📦 Database Stats (Epic API sourced):');
  console.log(`   Tournaments: ${dbTournaments}`);
  console.log(`   Results: ${dbResults}`);

  console.log('\n✅ Done!');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
