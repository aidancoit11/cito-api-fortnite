import { prisma } from '../../db/client.js';
import {
  lolEsportsApiService,
  LolScheduleEventApiResponse,
} from './lol-esports-api.service.js';
import NodeCache from 'node-cache';

/**
 * LoL Live Service
 * Handles real-time game data, live match tracking, and cache management
 */

// Short TTL cache for live data
const liveCache = new NodeCache({ stdTTL: 30, checkperiod: 10 });

// ========== TYPES ==========

export interface LiveMatch {
  matchId: string;
  esportsApiId?: string;
  leagueId?: string;
  leagueName?: string;
  leagueImage?: string;
  team1: {
    id: string;
    slug: string;
    name: string;
    code: string;
    image: string;
    score?: number;
  };
  team2: {
    id: string;
    slug: string;
    name: string;
    code: string;
    image: string;
    score?: number;
  };
  strategy: {
    type: string;
    count: number;
  };
  state: string;
  startTime: string;
  blockName?: string;
  currentGame?: LiveGameState;
}

export interface LiveGameState {
  gameId: string;
  gameNumber?: number;
  state: string;
  gameTime?: number;
  blueTeam: TeamLiveStats;
  redTeam: TeamLiveStats;
  players?: PlayerLiveStats[];
}

export interface TeamLiveStats {
  teamSlug?: string;
  totalGold: number;
  totalKills: number;
  towers: number;
  inhibitors: number;
  dragons: string[];
  barons: number;
  participants?: ParticipantLiveStats[];
}

export interface ParticipantLiveStats {
  participantId: number;
  summonerName?: string;
  championId?: string;
  role?: string;
  kills: number;
  deaths: number;
  assists: number;
  creepScore: number;
  totalGold: number;
  level: number;
  currentHealth: number;
  maxHealth: number;
}

export interface PlayerLiveStats {
  participantId: number;
  esportsPlayerId?: string;
  summonerName: string;
  championId: string;
  role: string;
  side: 'blue' | 'red';
  kills: number;
  deaths: number;
  assists: number;
  creepScore: number;
  totalGold: number;
  level: number;
  currentHealth: number;
  maxHealth: number;
}

export interface LiveGameDetails {
  gameId: string;
  esportsMatchId: string;
  patchVersion: string;
  gameTime: number;
  blueTeam: DetailedTeamStats;
  redTeam: DetailedTeamStats;
}

export interface DetailedTeamStats {
  esportsTeamId: string;
  totalGold: number;
  totalKills: number;
  towers: number;
  inhibitors: number;
  dragons: string[];
  barons: number;
  participants: DetailedParticipantStats[];
}

export interface DetailedParticipantStats extends ParticipantLiveStats {
  items?: number[];
  abilities?: {
    q: number;
    w: number;
    e: number;
    r: number;
  };
  perkPrimaryStyle?: number;
  perkSubStyle?: number;
}

export interface LiveGameEvent {
  timestamp: number;
  type: string;
  teamSlug?: string;
  side?: 'blue' | 'red';
  killerName?: string;
  victimName?: string;
  objectiveType?: string;
  data?: Record<string, unknown>;
}

// ========== SERVICE FUNCTIONS ==========

/**
 * Get all currently live matches
 */
export async function getLiveMatches(locale: string = 'en-US'): Promise<LiveMatch[]> {
  const cacheKey = `live_matches_${locale}`;
  const cached = liveCache.get<LiveMatch[]>(cacheKey);
  if (cached) return cached;

  try {
    const liveEvents = await lolEsportsApiService.getLive(locale);

    if (!liveEvents || liveEvents.length === 0) {
      return [];
    }

    const liveMatches: LiveMatch[] = liveEvents
      .filter((event: LolScheduleEventApiResponse) => event.match.teams[0] && event.match.teams[1])
      .map((event: LolScheduleEventApiResponse) => {
      const team1 = event.match.teams[0]!;
      const team2 = event.match.teams[1]!;

      return {
        matchId: event.match.id,
        leagueId: event.league.id,
        leagueName: event.league.name,
        leagueImage: event.league.image,
        team1: {
          id: team1.id,
          slug: team1.slug,
          name: team1.name,
          code: team1.code,
          image: team1.image,
          score: team1.result?.gameWins ?? 0,
        },
        team2: {
          id: team2.id,
          slug: team2.slug,
          name: team2.name,
          code: team2.code,
          image: team2.image,
          score: team2.result?.gameWins ?? 0,
        },
        strategy: event.match.strategy,
        state: event.state,
        startTime: event.startTime,
        blockName: event.blockName,
      };
    });

    liveCache.set(cacheKey, liveMatches, 30);
    return liveMatches;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[LolLive] Error fetching live matches:', message);
    throw error;
  }
}

/**
 * Get a specific live match state
 */
export async function getLiveMatch(matchId: string): Promise<LiveMatch | null> {
  try {
    const liveMatches = await getLiveMatches();
    const match = liveMatches.find(m => m.matchId === matchId);

    if (!match) {
      return null;
    }

    // Try to get current game data if match is in progress
    const gameDetails = await lolEsportsApiService.getEventDetails(matchId);

    if (gameDetails?.match?.games) {
      const currentGame = gameDetails.match.games.find(g => g.state === 'inProgress');
      if (currentGame) {
        const gameWindow = await getGameWindow(currentGame.id);
        if (gameWindow) {
          match.currentGame = gameWindow;
        }
      }
    }

    return match;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[LolLive] Error fetching live match ${matchId}:`, message);
    throw error;
  }
}

/**
 * Get real-time game stats (kills, gold, CS)
 */
export async function getLiveGameStats(gameId: string): Promise<LiveGameState | null> {
  const cacheKey = `live_stats_${gameId}`;
  const cached = liveCache.get<LiveGameState>(cacheKey);
  if (cached) return cached;

  try {
    const window = await lolEsportsApiService.getGameWindow(gameId);
    if (!window || !window.frames || window.frames.length === 0) {
      return null;
    }

    // Get the most recent frame
    const latestFrame = window.frames[window.frames.length - 1]!;

    const liveStats: LiveGameState = {
      gameId: window.esportsGameId,
      state: latestFrame.gameState,
      blueTeam: {
        teamSlug: window.gameMetadata?.blueTeamMetadata?.esportsTeamId,
        totalGold: latestFrame.blueTeam.totalGold,
        totalKills: latestFrame.blueTeam.totalKills,
        towers: latestFrame.blueTeam.towers,
        inhibitors: latestFrame.blueTeam.inhibitors,
        dragons: latestFrame.blueTeam.dragons,
        barons: latestFrame.blueTeam.barons,
        participants: latestFrame.blueTeam.participants.map(p => ({
          participantId: p.participantId,
          kills: p.kills,
          deaths: p.deaths,
          assists: p.assists,
          creepScore: p.creepScore,
          totalGold: p.totalGold,
          level: p.level,
          currentHealth: p.currentHealth,
          maxHealth: p.maxHealth,
        })),
      },
      redTeam: {
        teamSlug: window.gameMetadata?.redTeamMetadata?.esportsTeamId,
        totalGold: latestFrame.redTeam.totalGold,
        totalKills: latestFrame.redTeam.totalKills,
        towers: latestFrame.redTeam.towers,
        inhibitors: latestFrame.redTeam.inhibitors,
        dragons: latestFrame.redTeam.dragons,
        barons: latestFrame.redTeam.barons,
        participants: latestFrame.redTeam.participants.map(p => ({
          participantId: p.participantId,
          kills: p.kills,
          deaths: p.deaths,
          assists: p.assists,
          creepScore: p.creepScore,
          totalGold: p.totalGold,
          level: p.level,
          currentHealth: p.currentHealth,
          maxHealth: p.maxHealth,
        })),
      },
    };

    // Merge player metadata with stats
    const players: PlayerLiveStats[] = [];

    if (window.gameMetadata?.blueTeamMetadata?.participantMetadata) {
      for (const metadata of window.gameMetadata.blueTeamMetadata.participantMetadata) {
        const participant = latestFrame.blueTeam.participants.find(
          p => p.participantId === metadata.participantId
        );
        if (participant) {
          players.push({
            participantId: metadata.participantId,
            esportsPlayerId: metadata.esportsPlayerId,
            summonerName: metadata.summonerName,
            championId: metadata.championId,
            role: metadata.role,
            side: 'blue',
            kills: participant.kills,
            deaths: participant.deaths,
            assists: participant.assists,
            creepScore: participant.creepScore,
            totalGold: participant.totalGold,
            level: participant.level,
            currentHealth: participant.currentHealth,
            maxHealth: participant.maxHealth,
          });
        }
      }
    }

    if (window.gameMetadata?.redTeamMetadata?.participantMetadata) {
      for (const metadata of window.gameMetadata.redTeamMetadata.participantMetadata) {
        const participant = latestFrame.redTeam.participants.find(
          p => p.participantId === metadata.participantId
        );
        if (participant) {
          players.push({
            participantId: metadata.participantId,
            esportsPlayerId: metadata.esportsPlayerId,
            summonerName: metadata.summonerName,
            championId: metadata.championId,
            role: metadata.role,
            side: 'red',
            kills: participant.kills,
            deaths: participant.deaths,
            assists: participant.assists,
            creepScore: participant.creepScore,
            totalGold: participant.totalGold,
            level: participant.level,
            currentHealth: participant.currentHealth,
            maxHealth: participant.maxHealth,
          });
        }
      }
    }

    liveStats.players = players;
    liveCache.set(cacheKey, liveStats, 10);
    return liveStats;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[LolLive] Error fetching live game stats for ${gameId}:`, message);
    return null;
  }
}

/**
 * Get game state at a specific timestamp
 */
export async function getLiveGameWindow(
  gameId: string,
  startingTime?: string
): Promise<LiveGameState | null> {
  try {
    const window = await lolEsportsApiService.getGameWindow(gameId, startingTime);
    if (!window || !window.frames || window.frames.length === 0) {
      return null;
    }

    const latestFrame = window.frames[window.frames.length - 1]!;

    const gameState: LiveGameState = {
      gameId: window.esportsGameId,
      state: latestFrame.gameState,
      blueTeam: {
        totalGold: latestFrame.blueTeam.totalGold,
        totalKills: latestFrame.blueTeam.totalKills,
        towers: latestFrame.blueTeam.towers,
        inhibitors: latestFrame.blueTeam.inhibitors,
        dragons: latestFrame.blueTeam.dragons,
        barons: latestFrame.blueTeam.barons,
        participants: latestFrame.blueTeam.participants.map(p => ({
          participantId: p.participantId,
          kills: p.kills,
          deaths: p.deaths,
          assists: p.assists,
          creepScore: p.creepScore,
          totalGold: p.totalGold,
          level: p.level,
          currentHealth: p.currentHealth,
          maxHealth: p.maxHealth,
        })),
      },
      redTeam: {
        totalGold: latestFrame.redTeam.totalGold,
        totalKills: latestFrame.redTeam.totalKills,
        towers: latestFrame.redTeam.towers,
        inhibitors: latestFrame.redTeam.inhibitors,
        dragons: latestFrame.redTeam.dragons,
        barons: latestFrame.redTeam.barons,
        participants: latestFrame.redTeam.participants.map(p => ({
          participantId: p.participantId,
          kills: p.kills,
          deaths: p.deaths,
          assists: p.assists,
          creepScore: p.creepScore,
          totalGold: p.totalGold,
          level: p.level,
          currentHealth: p.currentHealth,
          maxHealth: p.maxHealth,
        })),
      },
    };

    return gameState;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[LolLive] Error fetching game window for ${gameId}:`, message);
    return null;
  }
}

/**
 * Get detailed real-time game data
 */
export async function getLiveGameDetails(gameId: string): Promise<LiveGameDetails | null> {
  const cacheKey = `live_details_${gameId}`;
  const cached = liveCache.get<LiveGameDetails>(cacheKey);
  if (cached) return cached;

  try {
    const [windowData, detailsData] = await Promise.all([
      lolEsportsApiService.getGameWindow(gameId),
      lolEsportsApiService.getGameDetails(gameId),
    ]);

    if (!windowData || !windowData.frames || windowData.frames.length === 0) {
      return null;
    }

    const latestFrame = windowData.frames[windowData.frames.length - 1]!;

    // Parse game time from timestamp if available
    let gameTime = 0;
    if (latestFrame.rfc460Timestamp) {
      const timestamp = new Date(latestFrame.rfc460Timestamp).getTime();
      const firstTimestamp = new Date(windowData.frames[0]!.rfc460Timestamp).getTime();
      gameTime = Math.floor((timestamp - firstTimestamp) / 1000);
    }

    const details: LiveGameDetails = {
      gameId: windowData.esportsGameId,
      esportsMatchId: windowData.esportsMatchId,
      patchVersion: windowData.gameMetadata?.patchVersion || 'unknown',
      gameTime,
      blueTeam: {
        esportsTeamId: windowData.gameMetadata?.blueTeamMetadata?.esportsTeamId || '',
        totalGold: latestFrame.blueTeam.totalGold,
        totalKills: latestFrame.blueTeam.totalKills,
        towers: latestFrame.blueTeam.towers,
        inhibitors: latestFrame.blueTeam.inhibitors,
        dragons: latestFrame.blueTeam.dragons,
        barons: latestFrame.blueTeam.barons,
        participants: latestFrame.blueTeam.participants.map(p => {
          const metadata = windowData.gameMetadata?.blueTeamMetadata?.participantMetadata?.find(
            m => m.participantId === p.participantId
          );
          return {
            participantId: p.participantId,
            summonerName: metadata?.summonerName,
            championId: metadata?.championId,
            role: metadata?.role,
            kills: p.kills,
            deaths: p.deaths,
            assists: p.assists,
            creepScore: p.creepScore,
            totalGold: p.totalGold,
            level: p.level,
            currentHealth: p.currentHealth,
            maxHealth: p.maxHealth,
          };
        }),
      },
      redTeam: {
        esportsTeamId: windowData.gameMetadata?.redTeamMetadata?.esportsTeamId || '',
        totalGold: latestFrame.redTeam.totalGold,
        totalKills: latestFrame.redTeam.totalKills,
        towers: latestFrame.redTeam.towers,
        inhibitors: latestFrame.redTeam.inhibitors,
        dragons: latestFrame.redTeam.dragons,
        barons: latestFrame.redTeam.barons,
        participants: latestFrame.redTeam.participants.map(p => {
          const metadata = windowData.gameMetadata?.redTeamMetadata?.participantMetadata?.find(
            m => m.participantId === p.participantId
          );
          return {
            participantId: p.participantId,
            summonerName: metadata?.summonerName,
            championId: metadata?.championId,
            role: metadata?.role,
            kills: p.kills,
            deaths: p.deaths,
            assists: p.assists,
            creepScore: p.creepScore,
            totalGold: p.totalGold,
            level: p.level,
            currentHealth: p.currentHealth,
            maxHealth: p.maxHealth,
          };
        }),
      },
    };

    // Merge detailed stats if available
    if (detailsData?.frames) {
      const detailsFrame = detailsData.frames[detailsData.frames.length - 1];
      if (detailsFrame) {
        // Add items and abilities from details API if available
        if (detailsFrame.blueTeam?.participants) {
          for (const detailP of detailsFrame.blueTeam.participants) {
            const participant = details.blueTeam.participants.find(
              p => p.participantId === detailP.participantId
            );
            if (participant) {
              participant.items = detailP.items;
              participant.abilities = detailP.abilities;
              participant.perkPrimaryStyle = detailP.perkPrimaryStyle;
              participant.perkSubStyle = detailP.perkSubStyle;
            }
          }
        }
        if (detailsFrame.redTeam?.participants) {
          for (const detailP of detailsFrame.redTeam.participants) {
            const participant = details.redTeam.participants.find(
              p => p.participantId === detailP.participantId
            );
            if (participant) {
              participant.items = detailP.items;
              participant.abilities = detailP.abilities;
              participant.perkPrimaryStyle = detailP.perkPrimaryStyle;
              participant.perkSubStyle = detailP.perkSubStyle;
            }
          }
        }
      }
    }

    liveCache.set(cacheKey, details, 10);
    return details;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[LolLive] Error fetching live game details for ${gameId}:`, message);
    return null;
  }
}

/**
 * Get stream of game events (kills, objectives, etc.)
 * Returns events from the game window frames
 */
export async function getLiveGameEvents(
  gameId: string,
  sinceTimestamp?: number
): Promise<LiveGameEvent[]> {
  try {
    const window = await lolEsportsApiService.getGameWindow(gameId);
    if (!window || !window.frames || window.frames.length < 2) {
      return [];
    }

    const events: LiveGameEvent[] = [];
    let prevFrame = window.frames[0]!;

    for (let i = 1; i < window.frames.length; i++) {
      const frame = window.frames[i]!;
      const timestamp = new Date(frame.rfc460Timestamp).getTime();

      // Skip frames before sinceTimestamp
      if (sinceTimestamp && timestamp < sinceTimestamp) {
        prevFrame = frame;
        continue;
      }

      // Detect kill events
      const blueKillDiff = frame.blueTeam.totalKills - prevFrame.blueTeam.totalKills;
      const redKillDiff = frame.redTeam.totalKills - prevFrame.redTeam.totalKills;

      if (blueKillDiff > 0) {
        events.push({
          timestamp,
          type: 'KILL',
          side: 'blue',
          data: { kills: blueKillDiff },
        });
      }

      if (redKillDiff > 0) {
        events.push({
          timestamp,
          type: 'KILL',
          side: 'red',
          data: { kills: redKillDiff },
        });
      }

      // Detect tower events
      const blueTowerDiff = frame.blueTeam.towers - prevFrame.blueTeam.towers;
      const redTowerDiff = frame.redTeam.towers - prevFrame.redTeam.towers;

      if (blueTowerDiff > 0) {
        events.push({
          timestamp,
          type: 'TOWER_DESTROYED',
          side: 'blue',
          data: { towers: blueTowerDiff },
        });
      }

      if (redTowerDiff > 0) {
        events.push({
          timestamp,
          type: 'TOWER_DESTROYED',
          side: 'red',
          data: { towers: redTowerDiff },
        });
      }

      // Detect dragon events
      if (frame.blueTeam.dragons.length > prevFrame.blueTeam.dragons.length) {
        const newDragon = frame.blueTeam.dragons[frame.blueTeam.dragons.length - 1];
        events.push({
          timestamp,
          type: 'DRAGON_KILL',
          side: 'blue',
          objectiveType: newDragon,
        });
      }

      if (frame.redTeam.dragons.length > prevFrame.redTeam.dragons.length) {
        const newDragon = frame.redTeam.dragons[frame.redTeam.dragons.length - 1];
        events.push({
          timestamp,
          type: 'DRAGON_KILL',
          side: 'red',
          objectiveType: newDragon,
        });
      }

      // Detect baron events
      const blueBaronDiff = frame.blueTeam.barons - prevFrame.blueTeam.barons;
      const redBaronDiff = frame.redTeam.barons - prevFrame.redTeam.barons;

      if (blueBaronDiff > 0) {
        events.push({
          timestamp,
          type: 'BARON_KILL',
          side: 'blue',
        });
      }

      if (redBaronDiff > 0) {
        events.push({
          timestamp,
          type: 'BARON_KILL',
          side: 'red',
        });
      }

      // Detect inhibitor events
      const blueInhibDiff = frame.blueTeam.inhibitors - prevFrame.blueTeam.inhibitors;
      const redInhibDiff = frame.redTeam.inhibitors - prevFrame.redTeam.inhibitors;

      if (blueInhibDiff > 0) {
        events.push({
          timestamp,
          type: 'INHIBITOR_DESTROYED',
          side: 'blue',
        });
      }

      if (redInhibDiff > 0) {
        events.push({
          timestamp,
          type: 'INHIBITOR_DESTROYED',
          side: 'red',
        });
      }

      prevFrame = frame;
    }

    return events.sort((a, b) => a.timestamp - b.timestamp);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[LolLive] Error fetching live game events for ${gameId}:`, message);
    return [];
  }
}

/**
 * Get game window state (internal helper)
 */
async function getGameWindow(gameId: string): Promise<LiveGameState | null> {
  return getLiveGameStats(gameId);
}

/**
 * Update live game data in the database cache
 */
export async function updateLiveGameCache(gameId: string): Promise<boolean> {
  try {
    const [windowData, liveMatches] = await Promise.all([
      lolEsportsApiService.getGameWindow(gameId),
      getLiveMatches(),
    ]);

    if (!windowData || !windowData.frames || windowData.frames.length === 0) {
      console.log(`[LolLive] No window data found for game ${gameId}`);
      return false;
    }

    const latestFrame = windowData.frames[windowData.frames.length - 1]!;

    // Find the match this game belongs to
    const match = liveMatches.find(m => m.currentGame?.gameId === gameId);

    // Calculate game time from frames
    let gameTime: number | undefined;
    if (windowData.frames.length > 1) {
      const firstTimestamp = new Date(windowData.frames[0]!.rfc460Timestamp).getTime();
      const lastTimestamp = new Date(latestFrame.rfc460Timestamp).getTime();
      gameTime = Math.floor((lastTimestamp - firstTimestamp) / 1000);
    }

    // Build player stats snapshot
    const playerStats: PlayerLiveStats[] = [];

    if (windowData.gameMetadata?.blueTeamMetadata?.participantMetadata) {
      for (const metadata of windowData.gameMetadata.blueTeamMetadata.participantMetadata) {
        const participant = latestFrame.blueTeam.participants.find(
          p => p.participantId === metadata.participantId
        );
        if (participant) {
          playerStats.push({
            participantId: metadata.participantId,
            esportsPlayerId: metadata.esportsPlayerId,
            summonerName: metadata.summonerName,
            championId: metadata.championId,
            role: metadata.role,
            side: 'blue',
            kills: participant.kills,
            deaths: participant.deaths,
            assists: participant.assists,
            creepScore: participant.creepScore,
            totalGold: participant.totalGold,
            level: participant.level,
            currentHealth: participant.currentHealth,
            maxHealth: participant.maxHealth,
          });
        }
      }
    }

    if (windowData.gameMetadata?.redTeamMetadata?.participantMetadata) {
      for (const metadata of windowData.gameMetadata.redTeamMetadata.participantMetadata) {
        const participant = latestFrame.redTeam.participants.find(
          p => p.participantId === metadata.participantId
        );
        if (participant) {
          playerStats.push({
            participantId: metadata.participantId,
            esportsPlayerId: metadata.esportsPlayerId,
            summonerName: metadata.summonerName,
            championId: metadata.championId,
            role: metadata.role,
            side: 'red',
            kills: participant.kills,
            deaths: participant.deaths,
            assists: participant.assists,
            creepScore: participant.creepScore,
            totalGold: participant.totalGold,
            level: participant.level,
            currentHealth: participant.currentHealth,
            maxHealth: participant.maxHealth,
          });
        }
      }
    }

    // Get last event timestamp
    const lastEventTime = new Date(latestFrame.rfc460Timestamp).getTime();

    // Upsert live game data in database
    await prisma.lolLiveGame.upsert({
      where: { gameId },
      create: {
        gameId,
        matchId: windowData.esportsMatchId,
        leagueId: match?.leagueId,
        blueTeamSlug: windowData.gameMetadata?.blueTeamMetadata?.esportsTeamId || 'unknown',
        redTeamSlug: windowData.gameMetadata?.redTeamMetadata?.esportsTeamId || 'unknown',
        state: latestFrame.gameState,
        gameTime,
        blueKills: latestFrame.blueTeam.totalKills,
        blueGold: latestFrame.blueTeam.totalGold,
        blueTowers: latestFrame.blueTeam.towers,
        blueDragons: latestFrame.blueTeam.dragons.length,
        blueBarons: latestFrame.blueTeam.barons,
        redKills: latestFrame.redTeam.totalKills,
        redGold: latestFrame.redTeam.totalGold,
        redTowers: latestFrame.redTeam.towers,
        redDragons: latestFrame.redTeam.dragons.length,
        redBarons: latestFrame.redTeam.barons,
        playerStats: JSON.parse(JSON.stringify(playerStats)),
        lastEventTime,
      },
      update: {
        state: latestFrame.gameState,
        gameTime,
        blueKills: latestFrame.blueTeam.totalKills,
        blueGold: latestFrame.blueTeam.totalGold,
        blueTowers: latestFrame.blueTeam.towers,
        blueDragons: latestFrame.blueTeam.dragons.length,
        blueBarons: latestFrame.blueTeam.barons,
        redKills: latestFrame.redTeam.totalKills,
        redGold: latestFrame.redTeam.totalGold,
        redTowers: latestFrame.redTeam.towers,
        redDragons: latestFrame.redTeam.dragons.length,
        redBarons: latestFrame.redTeam.barons,
        playerStats: JSON.parse(JSON.stringify(playerStats)),
        lastEventTime,
        lastUpdated: new Date(),
      },
    });

    console.log(`[LolLive] Updated cache for game ${gameId}`);
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[LolLive] Error updating live game cache for ${gameId}:`, message);
    return false;
  }
}

/**
 * Remove finished games from the live cache
 */
export async function cleanupFinishedGames(): Promise<number> {
  try {
    // Get all live games from database
    const liveGames = await prisma.lolLiveGame.findMany({
      where: {
        state: {
          not: 'finished',
        },
      },
    });

    if (liveGames.length === 0) {
      console.log('[LolLive] No active games to check');
      return 0;
    }

    let cleanedCount = 0;

    for (const game of liveGames) {
      try {
        // Check if game is still live from API
        const windowData = await lolEsportsApiService.getGameWindow(game.gameId);

        if (!windowData || windowData.frames?.length === 0) {
          // Game data not available, likely finished
          await prisma.lolLiveGame.delete({
            where: { gameId: game.gameId },
          });
          cleanedCount++;
          console.log(`[LolLive] Removed finished game ${game.gameId} (no data)`);
          continue;
        }

        const latestFrame = windowData.frames[windowData.frames.length - 1]!;

        // Check if game state indicates finished
        if (latestFrame.gameState === 'finished' || latestFrame.gameState === 'ended') {
          await prisma.lolLiveGame.delete({
            where: { gameId: game.gameId },
          });
          cleanedCount++;
          console.log(`[LolLive] Removed finished game ${game.gameId}`);
        }
      } catch (error: unknown) {
        // If we can't fetch data for a game, assume it's finished
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.warn(`[LolLive] Error checking game ${game.gameId}, removing:`, message);

        try {
          await prisma.lolLiveGame.delete({
            where: { gameId: game.gameId },
          });
          cleanedCount++;
        } catch {
          // Ignore delete errors
        }
      }
    }

    // Also clean up games older than 6 hours (matches shouldn't last that long)
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const staleGames = await prisma.lolLiveGame.deleteMany({
      where: {
        lastUpdated: {
          lt: sixHoursAgo,
        },
      },
    });

    if (staleGames.count > 0) {
      console.log(`[LolLive] Removed ${staleGames.count} stale games`);
      cleanedCount += staleGames.count;
    }

    console.log(`[LolLive] Cleanup complete. Removed ${cleanedCount} finished/stale games`);
    return cleanedCount;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[LolLive] Error during cleanup:', message);
    throw error;
  }
}

/**
 * Clear the live cache (for testing/debugging)
 */
export function clearLiveCache(): void {
  liveCache.flushAll();
  console.log('[LolLive] Cache cleared');
}

// ========== EXPORT SERVICE OBJECT ==========

export const lolLiveService = {
  getLiveMatches,
  getLiveMatch,
  getLiveGameStats,
  getLiveGameWindow,
  getLiveGameDetails,
  getLiveGameEvents,
  updateLiveGameCache,
  cleanupFinishedGames,
  clearLiveCache,
};
