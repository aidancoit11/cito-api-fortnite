/**
 * Epic Games Events Service
 * Handles live tournament data from Epic Games API
 * - Active/upcoming events
 * - Live leaderboards
 * - Match-by-match stats
 */

import axios from 'axios';
import { tokenManager } from './token-manager.js';
import { prisma } from '../../db/client.js';
import NodeCache from 'node-cache';

const cache = new NodeCache({ stdTTL: 300 }); // 5 min cache

const EVENTS_API_BASE = 'https://events-public-service-live.ol.epicgames.com';

// ============ TYPES ============

export interface EpicEvent {
  eventId: string;
  displayDataId: string;
  name: string;
  description: string | null;
  regions: string[];
  eventWindows: EventWindow[];
  metadata: {
    minimumAccountLevel?: number;
    teamAccountIds?: string[];
    scoreLocationId?: string;
  };
}

export interface EventWindow {
  eventWindowId: string;
  eventId: string;
  beginTime: Date;
  endTime: Date;
  round: number;
  scoreboardWindowEndTime: Date | null;
  leaderboardId: string | null;
  requireAllTokens: string[];
  requireAnyTokens: string[];
  requireNoneTokens: string[];
}

export interface LeaderboardEntry {
  rank: number;
  accountId: string;
  displayName: string;
  teamId: string | null;
  teamAccountIds: string[];
  score: number;
  pointsEarned: number;
  sessions: MatchSession[];
  lastUpdated: Date;
}

export interface MatchSession {
  sessionId: string;
  matchId: string;
  matchNumber: number;
  placement: number;
  kills: number;
  points: number;
  damageDealt: number | null;
  timeAlive: number | null;
  assists: number | null;
}

export interface LiveTournament {
  eventId: string;
  eventWindowId: string;
  name: string;
  region: string;
  startTime: Date;
  endTime: Date;
  isLive: boolean;
  leaderboard: LeaderboardEntry[];
  lastUpdated: Date;
}

// ============ API FUNCTIONS ============

/**
 * Make authenticated request to Epic Games API
 * Handles auth failures gracefully
 */
async function epicRequest<T>(url: string, retries = 2): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const token = await tokenManager.getToken();

      const response = await axios.get<T>(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });

      return response.data;
    } catch (error: any) {
      lastError = error;

      // Log the error with full details
      const status = error.response?.status;
      console.error(`[EpicEvents] Request failed (attempt ${attempt + 1}/${retries + 1}):`);
      console.error(`  URL: ${url}`);
      console.error(`  Status: ${status || 'N/A'}`);
      console.error(`  Message: ${error.message}`);
      if (error.response?.data) {
        console.error(`  Response:`, JSON.stringify(error.response.data, null, 2));
      }

      // If auth failed, try to reset and reinitialize token manager
      if (status === 401 || status === 403) {
        console.log('[EpicEvents] Auth error, resetting token manager...');
        tokenManager.reset();

        if (attempt < retries) {
          await sleep(1000);
          continue;
        }
      }

      // Don't retry on other 4xx errors
      if (status && status >= 400 && status < 500 && status !== 401 && status !== 403) {
        break;
      }

      // Wait before retry
      if (attempt < retries) {
        await sleep(1000 * (attempt + 1));
      }
    }
  }

  throw lastError || new Error('Epic API request failed');
}

/**
 * Get all enabled events (upcoming and active)
 */
export async function getEnabledEvents(): Promise<EpicEvent[]> {
  const cacheKey = 'enabled_events';
  const cached = cache.get<EpicEvent[]>(cacheKey);
  if (cached) return cached;

  try {
    const accountId = tokenManager.getAccountId();
    if (!accountId) {
      throw new Error('No account ID available');
    }

    // Fetch events for all regions
    const regions = ['NAE', 'NAW', 'EU', 'BR', 'OCE', 'ASIA', 'ME'];
    const allEvents: EpicEvent[] = [];

    console.log('[EpicEvents] Fetching enabled events for all regions...');
    console.log(`[EpicEvents] Account ID: ${accountId} (length: ${accountId.length})`);

    for (const region of regions) {
      try {
        const url = `${EVENTS_API_BASE}/api/v1/events/Fortnite/download/${accountId}?region=${region}`;
        console.log(`[EpicEvents] Fetching ${region}...`);

        const data = await epicRequest<any>(url);
        console.log(`[EpicEvents] ${region}: ${data?.events?.length || 0} events`);

        if (data?.events && Array.isArray(data.events)) {
          // Process events from this region
          for (const event of data.events) {
            // Skip if we already have this event
            if (allEvents.some(e => e.eventId === event.eventId)) continue;

            const windows: EventWindow[] = [];

            if (event.eventWindows && Array.isArray(event.eventWindows)) {
              for (const window of event.eventWindows) {
                windows.push({
                  eventWindowId: window.eventWindowId,
                  eventId: event.eventId,
                  beginTime: new Date(window.beginTime),
                  endTime: new Date(window.endTime),
                  round: window.round || 1,
                  scoreboardWindowEndTime: window.scoreboardWindowEndTime
                    ? new Date(window.scoreboardWindowEndTime)
                    : null,
                  leaderboardId: window.leaderboardId || null,
                  requireAllTokens: window.requireAllTokens || [],
                  requireAnyTokens: window.requireAnyTokens || [],
                  requireNoneTokens: window.requireNoneTokens || [],
                });
              }
            }

            allEvents.push({
              eventId: event.eventId,
              displayDataId: event.displayDataId || event.eventId,
              name: event.displayDataId || event.eventId,
              description: event.longFormatTitle || null,
              regions: event.regions || [region],
              eventWindows: windows,
              metadata: {
                minimumAccountLevel: event.minimumAccountLevel,
                scoreLocationId: event.scoreLocationId,
              },
            });
          }
        }

        // Small delay between requests
        await sleep(200);
      } catch (regionError: any) {
        console.warn(`[EpicEvents] Failed to fetch ${region}: ${regionError.message}`);
      }
    }

    console.log(`[EpicEvents] Total unique events: ${allEvents.length}`);
    cache.set(cacheKey, allEvents);
    return allEvents;
  } catch (error: any) {
    console.error('Failed to get enabled events:', error.message);
    return [];
  }
}

/**
 * Get currently live events
 */
export async function getLiveEvents(): Promise<EpicEvent[]> {
  const events = await getEnabledEvents();
  const now = new Date();

  return events.filter(event =>
    event.eventWindows.some(window =>
      window.beginTime <= now && window.endTime >= now
    )
  );
}

/**
 * Get upcoming events
 */
export async function getUpcomingEvents(): Promise<EpicEvent[]> {
  const events = await getEnabledEvents();
  const now = new Date();

  return events.filter(event =>
    event.eventWindows.some(window => window.beginTime > now)
  );
}

/**
 * Get leaderboard for a specific event window
 */
export async function getEventLeaderboard(
  eventId: string,
  eventWindowId: string,
  options?: { page?: number; limit?: number }
): Promise<LeaderboardEntry[]> {
  const { page = 0 } = options || {};
  const cacheKey = `leaderboard_${eventId}_${eventWindowId}_${page}`;
  const cached = cache.get<LeaderboardEntry[]>(cacheKey);
  if (cached) return cached;

  try {
    const accountId = tokenManager.getAccountId();
    if (!accountId) {
      throw new Error('No account ID available');
    }

    // Get leaderboard data
    const url = `${EVENTS_API_BASE}/api/v1/leaderboards/Fortnite/${eventId}/${eventWindowId}/${accountId}?page=${page}&rank=0&teamAccountIds=&appId=Fortnite&showLiveSessions=true`;

    const data = await epicRequest<any>(url);
    const entries: LeaderboardEntry[] = [];

    if (data.entries && Array.isArray(data.entries)) {
      for (const entry of data.entries) {
        const sessions: MatchSession[] = [];

        // Parse session/match data
        if (entry.sessionHistory && Array.isArray(entry.sessionHistory)) {
          let matchNumber = 1;
          for (const session of entry.sessionHistory) {
            sessions.push({
              sessionId: session.sessionId || `session_${matchNumber}`,
              matchId: session.sessionId || `match_${matchNumber}`,
              matchNumber,
              placement: session.trackedStats?.PLACEMENT || session.placement || 0,
              kills: session.trackedStats?.TEAM_ELIMS || session.kills || 0,
              points: session.trackedStats?.MATCH_POINTS || session.points || 0,
              damageDealt: session.trackedStats?.DAMAGE_DEALT || null,
              timeAlive: session.trackedStats?.TIME_ALIVE || null,
              assists: session.trackedStats?.ASSISTS || null,
            });
            matchNumber++;
          }
        }

        entries.push({
          rank: entry.rank || 0,
          accountId: entry.teamAccountIds?.[0] || entry.accountId || '',
          displayName: entry.displayName || entry.teamAccountIds?.[0] || 'Unknown',
          teamId: entry.teamId || null,
          teamAccountIds: entry.teamAccountIds || [],
          score: entry.score || 0,
          pointsEarned: entry.pointsEarned || entry.score || 0,
          sessions,
          lastUpdated: new Date(),
        });
      }
    }

    // Sort by rank
    entries.sort((a, b) => a.rank - b.rank);

    cache.set(cacheKey, entries, 60); // 1 min cache for live data
    return entries;
  } catch (error: any) {
    console.error(`Failed to get leaderboard for ${eventId}/${eventWindowId}:`, error.message);
    return [];
  }
}

/**
 * Get full leaderboard (top 500)
 */
export async function getFullLeaderboard(
  eventId: string,
  eventWindowId: string
): Promise<LeaderboardEntry[]> {
  const allEntries: LeaderboardEntry[] = [];
  let page = 0;
  const maxPages = 5; // 100 per page = 500 total

  while (page < maxPages) {
    const entries = await getEventLeaderboard(eventId, eventWindowId, { page, limit: 100 });
    if (entries.length === 0) break;

    allEntries.push(...entries);
    page++;

    // Small delay between pages
    await sleep(100);
  }

  return allEntries;
}

/**
 * Get player's stats for a specific event
 */
export async function getPlayerEventStats(
  eventId: string,
  eventWindowId: string,
  accountId: string
): Promise<LeaderboardEntry | null> {
  try {
    const url = `${EVENTS_API_BASE}/api/v1/leaderboards/Fortnite/${eventId}/${eventWindowId}/${accountId}?showLiveSessions=true`;
    const data = await epicRequest<any>(url);

    if (!data.entries || data.entries.length === 0) {
      return null;
    }

    // Find the player's entry
    const entry = data.entries.find((e: any) =>
      e.teamAccountIds?.includes(accountId) || e.accountId === accountId
    );

    if (!entry) return null;

    const sessions: MatchSession[] = [];
    if (entry.sessionHistory && Array.isArray(entry.sessionHistory)) {
      let matchNumber = 1;
      for (const session of entry.sessionHistory) {
        sessions.push({
          sessionId: session.sessionId || `session_${matchNumber}`,
          matchId: session.sessionId || `match_${matchNumber}`,
          matchNumber,
          placement: session.trackedStats?.PLACEMENT || 0,
          kills: session.trackedStats?.TEAM_ELIMS || 0,
          points: session.trackedStats?.MATCH_POINTS || 0,
          damageDealt: session.trackedStats?.DAMAGE_DEALT || null,
          timeAlive: session.trackedStats?.TIME_ALIVE || null,
          assists: session.trackedStats?.ASSISTS || null,
        });
        matchNumber++;
      }
    }

    return {
      rank: entry.rank || 0,
      accountId,
      displayName: entry.displayName || accountId,
      teamId: entry.teamId || null,
      teamAccountIds: entry.teamAccountIds || [accountId],
      score: entry.score || 0,
      pointsEarned: entry.pointsEarned || 0,
      sessions,
      lastUpdated: new Date(),
    };
  } catch (error: any) {
    console.error(`Failed to get player stats for ${accountId}:`, error.message);
    return null;
  }
}

/**
 * Get combined live tournament data
 */
export async function getLiveTournamentData(
  eventId: string,
  eventWindowId: string
): Promise<LiveTournament | null> {
  try {
    const events = await getEnabledEvents();
    const event = events.find(e => e.eventId === eventId);

    if (!event) return null;

    const window = event.eventWindows.find(w => w.eventWindowId === eventWindowId);
    if (!window) return null;

    const now = new Date();
    const isLive = window.beginTime <= now && window.endTime >= now;

    const leaderboard = await getFullLeaderboard(eventId, eventWindowId);

    // Extract region from event ID (e.g., "epicgames_Arena_S22_Duos_PC_NAE")
    let region = 'Unknown';
    const regionMatch = eventId.match(/(NAE|NAW|EU|BR|OCE|ASIA|ME)/i);
    if (regionMatch && regionMatch[1]) {
      const regionMap: Record<string, string> = {
        'NAE': 'NA East',
        'NAW': 'NA West',
        'EU': 'Europe',
        'BR': 'Brazil',
        'OCE': 'Oceania',
        'ASIA': 'Asia',
        'ME': 'Middle East',
      };
      const matchedRegion = regionMatch[1].toUpperCase();
      region = regionMap[matchedRegion] || matchedRegion;
    }

    return {
      eventId,
      eventWindowId,
      name: event.name,
      region,
      startTime: window.beginTime,
      endTime: window.endTime,
      isLive,
      leaderboard,
      lastUpdated: new Date(),
    };
  } catch (error: any) {
    console.error(`Failed to get live tournament data:`, error.message);
    return null;
  }
}

// ============ DATABASE SYNC ============

/**
 * Sync live event leaderboard to database
 */
export async function syncEventLeaderboard(
  eventId: string,
  eventWindowId: string
): Promise<{ tournament: boolean; results: number; matches: number }> {
  const liveData = await getLiveTournamentData(eventId, eventWindowId);

  if (!liveData) {
    return { tournament: false, results: 0, matches: 0 };
  }

  // Generate tournament ID from event ID
  const tournamentId = `epic-${eventId}-${eventWindowId}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  try {
    // Upsert tournament
    await prisma.tournament.upsert({
      where: { tournamentId },
      create: {
        tournamentId,
        name: liveData.name,
        startDate: liveData.startTime,
        endDate: liveData.endTime,
        region: liveData.region,
        isCompleted: !liveData.isLive,
        data: {
          eventId,
          eventWindowId,
          source: 'epic',
          isLive: liveData.isLive,
        },
      },
      update: {
        name: liveData.name,
        endDate: liveData.endTime,
        isCompleted: !liveData.isLive,
        data: {
          eventId,
          eventWindowId,
          source: 'epic',
          isLive: liveData.isLive,
        },
        lastUpdated: new Date(),
      },
    });

    let syncedResults = 0;
    let syncedMatches = 0;

    // Sync leaderboard entries
    for (const entry of liveData.leaderboard) {
      try {
        // Upsert tournament result
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
            points: entry.score,
            kills: entry.sessions.reduce((sum, s) => sum + s.kills, 0),
            matchesPlayed: entry.sessions.length,
            teamName: entry.teamId,
            data: {
              teamAccountIds: entry.teamAccountIds,
              pointsEarned: entry.pointsEarned,
              source: 'epic',
            },
          },
          update: {
            displayName: entry.displayName,
            rank: entry.rank,
            points: entry.score,
            kills: entry.sessions.reduce((sum, s) => sum + s.kills, 0),
            matchesPlayed: entry.sessions.length,
            teamName: entry.teamId,
            data: {
              teamAccountIds: entry.teamAccountIds,
              pointsEarned: entry.pointsEarned,
              source: 'epic',
            },
          },
        });
        syncedResults++;

        // Sync match results
        for (const session of entry.sessions) {
          try {
            await prisma.matchResult.upsert({
              where: {
                tournamentId_matchId_accountId: {
                  tournamentId,
                  matchId: session.matchId,
                  accountId: entry.accountId,
                },
              },
              create: {
                tournamentId,
                matchId: session.matchId,
                matchNumber: session.matchNumber,
                accountId: entry.accountId,
                displayName: entry.displayName,
                placement: session.placement,
                kills: session.kills,
                points: session.points,
                damageDealt: session.damageDealt,
                timeAlive: session.timeAlive,
                data: {
                  sessionId: session.sessionId,
                  assists: session.assists,
                  source: 'epic',
                },
              },
              update: {
                displayName: entry.displayName,
                placement: session.placement,
                kills: session.kills,
                points: session.points,
                damageDealt: session.damageDealt,
                timeAlive: session.timeAlive,
                data: {
                  sessionId: session.sessionId,
                  assists: session.assists,
                  source: 'epic',
                },
              },
            });
            syncedMatches++;
          } catch (error: any) {
            console.error(`Failed to sync match ${session.matchId}:`, error.message);
          }
        }
      } catch (error: any) {
        console.error(`Failed to sync result for ${entry.displayName}:`, error.message);
      }
    }

    return { tournament: true, results: syncedResults, matches: syncedMatches };
  } catch (error: any) {
    console.error('Failed to sync event leaderboard:', error.message);
    return { tournament: false, results: 0, matches: 0 };
  }
}

/**
 * Sync all currently live events
 */
export async function syncAllLiveEvents(): Promise<{
  events: number;
  results: number;
  matches: number;
}> {
  const liveEvents = await getLiveEvents();

  let totalResults = 0;
  let totalMatches = 0;
  let syncedEvents = 0;

  for (const event of liveEvents) {
    for (const window of event.eventWindows) {
      const now = new Date();
      if (window.beginTime <= now && window.endTime >= now) {
        console.log(`Syncing live event: ${event.name} - ${window.eventWindowId}`);

        const result = await syncEventLeaderboard(event.eventId, window.eventWindowId);
        if (result.tournament) {
          syncedEvents++;
          totalResults += result.results;
          totalMatches += result.matches;
        }

        await sleep(200); // Rate limit
      }
    }
  }

  return { events: syncedEvents, results: totalResults, matches: totalMatches };
}

// ============ UTILITY ============

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============ EXPORTS ============

export const eventsService = {
  getEnabledEvents,
  getLiveEvents,
  getUpcomingEvents,
  getEventLeaderboard,
  getFullLeaderboard,
  getPlayerEventStats,
  getLiveTournamentData,
  syncEventLeaderboard,
  syncAllLiveEvents,
};
