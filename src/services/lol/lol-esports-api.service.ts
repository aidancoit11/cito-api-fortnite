import axios, { AxiosInstance } from 'axios';
import NodeCache from 'node-cache';

/**
 * LoL Esports API Service
 * Interfaces with Riot's official LoL Esports API
 * Base URL: https://esports-api.lolesports.com/persisted/gw/
 */

const LOL_ESPORTS_API_KEY = '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z';
const LOL_ESPORTS_BASE_URL = 'https://esports-api.lolesports.com/persisted/gw';
const LOL_FEED_BASE_URL = 'https://feed.lolesports.com/livestats/v1';

// Cache for API responses
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 }); // 5 min default TTL

// Create axios instance with default headers
const esportsApi: AxiosInstance = axios.create({
  baseURL: LOL_ESPORTS_BASE_URL,
  headers: {
    'x-api-key': LOL_ESPORTS_API_KEY,
    'Accept': 'application/json',
  },
  timeout: 30000,
});

const feedApi: AxiosInstance = axios.create({
  baseURL: LOL_FEED_BASE_URL,
  headers: {
    'Accept': 'application/json',
  },
  timeout: 30000,
});

// Types
export interface LolLeagueApiResponse {
  id: string;
  slug: string;
  name: string;
  region: string;
  image: string;
  priority: number;
}

export interface LolTournamentApiResponse {
  id: string;
  slug: string;
  startDate: string;
  endDate: string;
}

export interface LolTeamApiResponse {
  id: string;
  slug: string;
  name: string;
  code: string;
  image: string;
  alternativeImage: string;
  backgroundImage: string;
  status: string;
  homeLeague?: {
    name: string;
    region: string;
  };
  players?: LolPlayerApiResponse[];
}

export interface LolPlayerApiResponse {
  id: string;
  summonerName: string;
  firstName: string;
  lastName: string;
  image: string;
  role: string;
}

export interface LolScheduleEventApiResponse {
  startTime: string;
  state: string;
  type: string;
  blockName: string;
  league: {
    id: string;
    slug: string;
    name: string;
    image: string;
  };
  match: {
    id: string;
    teams: Array<{
      id: string;
      slug: string;
      name: string;
      code: string;
      image: string;
      result?: {
        outcome: string;
        gameWins: number;
      };
      record?: {
        wins: number;
        losses: number;
      };
    }>;
    strategy: {
      type: string;
      count: number;
    };
  };
}

export interface LolStandingApiResponse {
  stages: Array<{
    name: string;
    type: string;
    slug: string;
    sections: Array<{
      name: string;
      rankings: Array<{
        ordinal: number;
        teams: Array<{
          id: string;
          slug: string;
          name: string;
          code: string;
          image: string;
          record: {
            wins: number;
            losses: number;
          };
        }>;
      }>;
    }>;
  }>;
}

export interface LolEventDetailsApiResponse {
  id: string;
  type: string;
  tournament: {
    id: string;
  };
  league: {
    id: string;
    slug: string;
    name: string;
    image: string;
  };
  match: {
    id: string;
    teams: Array<{
      id: string;
      slug: string;
      name: string;
      code: string;
      image: string;
      result?: {
        outcome: string;
        gameWins: number;
      };
    }>;
    games: Array<{
      id: string;
      number: number;
      state: string;
      teams: Array<{
        id: string;
        side: string;
      }>;
      vods: Array<{
        id: string;
        parameter: string;
        locale: string;
        mediaLocale: {
          locale: string;
          englishName: string;
          translatedName: string;
        };
        provider: string;
        offset: number;
      }>;
    }>;
  };
  streams: Array<{
    parameter: string;
    locale: string;
    mediaLocale: {
      locale: string;
      englishName: string;
      translatedName: string;
    };
    provider: string;
    countries: string[];
    offset: number;
  }>;
}

export interface LolLiveGameWindowApiResponse {
  esportsGameId: string;
  esportsMatchId: string;
  gameMetadata: {
    patchVersion: string;
    blueTeamMetadata: {
      esportsTeamId: string;
      participantMetadata: Array<{
        participantId: number;
        esportsPlayerId: string;
        summonerName: string;
        championId: string;
        role: string;
      }>;
    };
    redTeamMetadata: {
      esportsTeamId: string;
      participantMetadata: Array<{
        participantId: number;
        esportsPlayerId: string;
        summonerName: string;
        championId: string;
        role: string;
      }>;
    };
  };
  frames: Array<{
    rfc460Timestamp: string;
    gameState: string;
    blueTeam: {
      totalGold: number;
      inhibitors: number;
      towers: number;
      barons: number;
      totalKills: number;
      dragons: string[];
      participants: Array<{
        participantId: number;
        totalGold: number;
        level: number;
        kills: number;
        deaths: number;
        assists: number;
        creepScore: number;
        currentHealth: number;
        maxHealth: number;
      }>;
    };
    redTeam: {
      totalGold: number;
      inhibitors: number;
      towers: number;
      barons: number;
      totalKills: number;
      dragons: string[];
      participants: Array<{
        participantId: number;
        totalGold: number;
        level: number;
        kills: number;
        deaths: number;
        assists: number;
        creepScore: number;
        currentHealth: number;
        maxHealth: number;
      }>;
    };
  }>;
}

// ============== API METHODS ==============

/**
 * Get all leagues
 */
export async function getLeagues(locale: string = 'en-US'): Promise<LolLeagueApiResponse[]> {
  const cacheKey = `lol_leagues_${locale}`;
  const cached = cache.get<LolLeagueApiResponse[]>(cacheKey);
  if (cached) return cached;

  try {
    const response = await esportsApi.get('/getLeagues', {
      params: { hl: locale },
    });

    const leagues = response.data?.data?.leagues || [];
    cache.set(cacheKey, leagues, 3600); // Cache for 1 hour
    return leagues;
  } catch (error: any) {
    console.error('[LolEsportsApi] Error fetching leagues:', error.message);
    throw error;
  }
}

/**
 * Get tournaments for a specific league
 */
export async function getTournamentsForLeague(
  leagueId: string,
  locale: string = 'en-US'
): Promise<LolTournamentApiResponse[]> {
  const cacheKey = `lol_tournaments_${leagueId}_${locale}`;
  const cached = cache.get<LolTournamentApiResponse[]>(cacheKey);
  if (cached) return cached;

  try {
    const response = await esportsApi.get('/getTournamentsForLeague', {
      params: { hl: locale, leagueId },
    });

    const tournaments = response.data?.data?.leagues?.[0]?.tournaments || [];
    cache.set(cacheKey, tournaments, 1800); // Cache for 30 min
    return tournaments;
  } catch (error: any) {
    console.error('[LolEsportsApi] Error fetching tournaments:', error.message);
    throw error;
  }
}

/**
 * Get schedule for a league (with pagination)
 */
export async function getSchedule(
  leagueId?: string,
  pageToken?: string,
  locale: string = 'en-US'
): Promise<{
  events: LolScheduleEventApiResponse[];
  pages: { older?: string; newer?: string };
}> {
  const cacheKey = `lol_schedule_${leagueId || 'all'}_${pageToken || 'latest'}_${locale}`;
  const cached = cache.get<{ events: LolScheduleEventApiResponse[]; pages: { older?: string; newer?: string } }>(cacheKey);
  if (cached) return cached;

  try {
    const params: Record<string, string> = { hl: locale };
    if (leagueId) params.leagueId = leagueId;
    if (pageToken) params.pageToken = pageToken;

    const response = await esportsApi.get('/getSchedule', { params });

    const schedule = response.data?.data?.schedule || {};
    const result = {
      events: schedule.events || [],
      pages: schedule.pages || {},
    };

    cache.set(cacheKey, result, 300); // Cache for 5 min
    return result;
  } catch (error: any) {
    console.error('[LolEsportsApi] Error fetching schedule:', error.message);
    throw error;
  }
}

/**
 * Get standings for a tournament
 */
export async function getStandings(
  tournamentId: string,
  locale: string = 'en-US'
): Promise<LolStandingApiResponse> {
  const cacheKey = `lol_standings_${tournamentId}_${locale}`;
  const cached = cache.get<LolStandingApiResponse>(cacheKey);
  if (cached) return cached;

  try {
    const response = await esportsApi.get('/getStandings', {
      params: { hl: locale, tournamentId },
    });

    const standings = response.data?.data?.standings?.[0] || { stages: [] };
    cache.set(cacheKey, standings, 600); // Cache for 10 min
    return standings;
  } catch (error: any) {
    console.error('[LolEsportsApi] Error fetching standings:', error.message);
    throw error;
  }
}

/**
 * Get completed events for a tournament
 */
export async function getCompletedEvents(
  tournamentId: string,
  locale: string = 'en-US'
): Promise<LolScheduleEventApiResponse[]> {
  const cacheKey = `lol_completed_${tournamentId}_${locale}`;
  const cached = cache.get<LolScheduleEventApiResponse[]>(cacheKey);
  if (cached) return cached;

  try {
    const response = await esportsApi.get('/getCompletedEvents', {
      params: { hl: locale, tournamentId },
    });

    const events = response.data?.data?.schedule?.events || [];
    cache.set(cacheKey, events, 1800); // Cache for 30 min
    return events;
  } catch (error: any) {
    console.error('[LolEsportsApi] Error fetching completed events:', error.message);
    throw error;
  }
}

/**
 * Get event details (match details with VODs)
 */
export async function getEventDetails(
  matchId: string,
  locale: string = 'en-US'
): Promise<LolEventDetailsApiResponse | null> {
  const cacheKey = `lol_event_${matchId}_${locale}`;
  const cached = cache.get<LolEventDetailsApiResponse>(cacheKey);
  if (cached) return cached;

  try {
    const response = await esportsApi.get('/getEventDetails', {
      params: { hl: locale, id: matchId },
    });

    const event = response.data?.data?.event || null;
    if (event) {
      cache.set(cacheKey, event, 1800); // Cache for 30 min
    }
    return event;
  } catch (error: any) {
    console.error('[LolEsportsApi] Error fetching event details:', error.message);
    throw error;
  }
}

/**
 * Get teams for a league or by team slug
 */
export async function getTeams(
  idOrSlug: string,
  locale: string = 'en-US'
): Promise<LolTeamApiResponse[]> {
  const cacheKey = `lol_teams_${idOrSlug}_${locale}`;
  const cached = cache.get<LolTeamApiResponse[]>(cacheKey);
  if (cached) return cached;

  try {
    const response = await esportsApi.get('/getTeams', {
      params: { hl: locale, id: idOrSlug },
    });

    const teams = response.data?.data?.teams || [];
    cache.set(cacheKey, teams, 3600); // Cache for 1 hour
    return teams;
  } catch (error: any) {
    console.error('[LolEsportsApi] Error fetching teams:', error.message);
    throw error;
  }
}

/**
 * Get currently live matches
 */
export async function getLive(locale: string = 'en-US'): Promise<LolScheduleEventApiResponse[]> {
  const cacheKey = `lol_live_${locale}`;
  const cached = cache.get<LolScheduleEventApiResponse[]>(cacheKey);
  if (cached) return cached;

  try {
    const response = await esportsApi.get('/getLive', {
      params: { hl: locale },
    });

    const events = response.data?.data?.schedule?.events || [];
    cache.set(cacheKey, events, 30); // Cache for 30 seconds only
    return events;
  } catch (error: any) {
    console.error('[LolEsportsApi] Error fetching live events:', error.message);
    throw error;
  }
}

// ============== LIVE STATS FEED API ==============

/**
 * Get live game window (scoreboard, objectives)
 */
export async function getGameWindow(
  gameId: string,
  startingTime?: string
): Promise<LolLiveGameWindowApiResponse | null> {
  const cacheKey = `lol_window_${gameId}_${startingTime || 'latest'}`;
  const cached = cache.get<LolLiveGameWindowApiResponse>(cacheKey);
  if (cached) return cached;

  try {
    const params: Record<string, string> = {};
    if (startingTime) params.startingTime = startingTime;

    const response = await feedApi.get(`/window/${gameId}`, { params });

    const window = response.data || null;
    if (window) {
      cache.set(cacheKey, window, 10); // Cache for 10 seconds only (live data)
    }
    return window;
  } catch (error: any) {
    console.error('[LolFeedApi] Error fetching game window:', error.message);
    return null;
  }
}

/**
 * Get live game details (gold, CS, levels, abilities)
 */
export async function getGameDetails(
  gameId: string,
  startingTime?: string
): Promise<any | null> {
  const cacheKey = `lol_details_${gameId}_${startingTime || 'latest'}`;
  const cached = cache.get<any>(cacheKey);
  if (cached) return cached;

  try {
    const params: Record<string, string> = {};
    if (startingTime) params.startingTime = startingTime;

    const response = await feedApi.get(`/details/${gameId}`, { params });

    const details = response.data || null;
    if (details) {
      cache.set(cacheKey, details, 10); // Cache for 10 seconds only (live data)
    }
    return details;
  } catch (error: any) {
    console.error('[LolFeedApi] Error fetching game details:', error.message);
    return null;
  }
}

// ============== UTILITY FUNCTIONS ==============

/**
 * Clear cache for a specific key or all keys
 */
export function clearCache(key?: string): void {
  if (key) {
    cache.del(key);
  } else {
    cache.flushAll();
  }
}

/**
 * Get cache stats
 */
export function getCacheStats(): NodeCache.Stats {
  return cache.getStats();
}

// Export all functions as a service object
export const lolEsportsApiService = {
  getLeagues,
  getTournamentsForLeague,
  getSchedule,
  getStandings,
  getCompletedEvents,
  getEventDetails,
  getTeams,
  getLive,
  getGameWindow,
  getGameDetails,
  clearCache,
  getCacheStats,
};
