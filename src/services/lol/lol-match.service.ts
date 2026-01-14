import { prisma } from '../../db/client.js';
import { lolEsportsApiService } from './lol-esports-api.service.js';

/**
 * LoL Match Service
 * Handles Match and Game operations for League of Legends esports data
 */

// ============== TYPES ==============

export interface MatchDetails {
  matchId: string;
  esportsApiId: string | null;
  tournamentId: string;
  blockName: string | null;
  round: string | null;
  team1: {
    slug: string;
    name: string;
    score: number | null;
  };
  team2: {
    slug: string;
    name: string;
    score: number | null;
  };
  winnerSlug: string | null;
  strategy: string | null;
  startTime: Date | null;
  endTime: Date | null;
  state: string | null;
  vodUrl: string | null;
  gameCount: number;
}

export interface GameDetails {
  gameId: string;
  esportsApiId: string | null;
  matchId: string;
  gameNumber: number;
  blueTeam: {
    slug: string;
    kills: number | null;
    gold: number | null;
    towers: number | null;
    dragons: number | null;
    barons: number | null;
    heralds: number | null;
    inhibitors: number | null;
    bans: number[] | null;
  };
  redTeam: {
    slug: string;
    kills: number | null;
    gold: number | null;
    towers: number | null;
    dragons: number | null;
    barons: number | null;
    heralds: number | null;
    inhibitors: number | null;
    bans: number[] | null;
  };
  winnerSlug: string | null;
  winningSide: string | null;
  duration: number | null;
  patch: string | null;
  firstObjectives: {
    firstBlood: string | null;
    firstTower: string | null;
    firstDragon: string | null;
    firstBaron: string | null;
    firstHerald: string | null;
  };
}

export interface MatchStats {
  matchId: string;
  totalGames: number;
  team1: {
    slug: string;
    gamesWon: number;
    totalKills: number;
    totalGold: number;
    totalTowers: number;
    totalDragons: number;
    totalBarons: number;
    avgGameDuration: number | null;
  };
  team2: {
    slug: string;
    gamesWon: number;
    totalKills: number;
    totalGold: number;
    totalTowers: number;
    totalDragons: number;
    totalBarons: number;
    avgGameDuration: number | null;
  };
}

export interface TimelineEvent {
  id: string;
  timestamp: number;
  eventType: string;
  teamSlug: string | null;
  side: string | null;
  playerName: string | null;
  victimName: string | null;
  objectiveType: string | null;
  killType: string | null;
  position: { x: number; y: number } | null;
}

export interface PlayerGameStats {
  id: string;
  playerName: string;
  teamSlug: string;
  side: string;
  role: string;
  championId: number;
  championName: string;
  kills: number;
  deaths: number;
  assists: number;
  kda: number | null;
  killParticipation: number | null;
  cs: number;
  csPerMin: number | null;
  gold: number;
  goldPerMin: number | null;
  goldShare: number | null;
  damageDealt: number | null;
  damagePerMin: number | null;
  damageShare: number | null;
  visionScore: number | null;
  wardsPlaced: number | null;
  wardsKilled: number | null;
  items: number[] | null;
  primaryRune: number | null;
  secondaryRune: number | null;
  summonerSpell1: number | null;
  summonerSpell2: number | null;
}

export interface PlayerBuild {
  playerName: string;
  teamSlug: string;
  role: string;
  championId: number;
  championName: string;
  items: number[] | null;
  primaryRune: number | null;
  secondaryRune: number | null;
  summonerSpell1: number | null;
  summonerSpell2: number | null;
}

export interface GoldGraphPoint {
  timestamp: number;
  blueGold: number;
  redGold: number;
  goldDiff: number;
}

export interface ObjectiveEvent {
  timestamp: number;
  eventType: string;
  side: string;
  objectiveType: string | null;
  playerName: string | null;
}

// ============== MATCH METHODS ==============

/**
 * Get match details by ID
 */
async function getMatchById(matchId: string): Promise<MatchDetails | null> {
  try {
    const match = await prisma.lolMatch.findUnique({
      where: { matchId },
      include: {
        team1: true,
        team2: true,
        games: {
          select: { gameId: true },
        },
      },
    });

    if (!match) {
      return null;
    }

    return {
      matchId: match.matchId,
      esportsApiId: match.esportsApiId,
      tournamentId: match.tournamentId,
      blockName: match.blockName,
      round: match.round,
      team1: {
        slug: match.team1Slug,
        name: match.team1.name,
        score: match.team1Score,
      },
      team2: {
        slug: match.team2Slug,
        name: match.team2.name,
        score: match.team2Score,
      },
      winnerSlug: match.winnerSlug,
      strategy: match.strategy,
      startTime: match.startTime,
      endTime: match.endTime,
      state: match.state,
      vodUrl: match.vodUrl,
      gameCount: match.games.length,
    };
  } catch (error: any) {
    console.error('[LolMatchService] Error getting match by ID:', error.message);
    throw error;
  }
}

/**
 * Get all games in a match
 */
async function getMatchGames(matchId: string): Promise<GameDetails[]> {
  try {
    const games = await prisma.lolGame.findMany({
      where: { matchId },
      orderBy: { gameNumber: 'asc' },
    });

    return games.map((game) => ({
      gameId: game.gameId,
      esportsApiId: game.esportsApiId,
      matchId: game.matchId,
      gameNumber: game.gameNumber,
      blueTeam: {
        slug: game.blueTeamSlug,
        kills: game.blueKills,
        gold: game.blueGold,
        towers: game.blueTowers,
        dragons: game.blueDragons,
        barons: game.blueBarons,
        heralds: game.blueHeralds,
        inhibitors: game.blueInhibitors,
        bans: game.blueBans as number[] | null,
      },
      redTeam: {
        slug: game.redTeamSlug,
        kills: game.redKills,
        gold: game.redGold,
        towers: game.redTowers,
        dragons: game.redDragons,
        barons: game.redBarons,
        heralds: game.redHeralds,
        inhibitors: game.redInhibitors,
        bans: game.redBans as number[] | null,
      },
      winnerSlug: game.winnerSlug,
      winningSide: game.winningSide,
      duration: game.duration,
      patch: game.patch,
      firstObjectives: {
        firstBlood: game.firstBlood,
        firstTower: game.firstTower,
        firstDragon: game.firstDragon,
        firstBaron: game.firstBaron,
        firstHerald: game.firstHerald,
      },
    }));
  } catch (error: any) {
    console.error('[LolMatchService] Error getting match games:', error.message);
    throw error;
  }
}

/**
 * Get aggregated stats across all games in a match
 */
async function getMatchStats(matchId: string): Promise<MatchStats | null> {
  try {
    const match = await prisma.lolMatch.findUnique({
      where: { matchId },
      include: {
        games: true,
      },
    });

    if (!match) {
      return null;
    }

    const games = match.games;
    if (games.length === 0) {
      return {
        matchId,
        totalGames: 0,
        team1: {
          slug: match.team1Slug,
          gamesWon: 0,
          totalKills: 0,
          totalGold: 0,
          totalTowers: 0,
          totalDragons: 0,
          totalBarons: 0,
          avgGameDuration: null,
        },
        team2: {
          slug: match.team2Slug,
          gamesWon: 0,
          totalKills: 0,
          totalGold: 0,
          totalTowers: 0,
          totalDragons: 0,
          totalBarons: 0,
          avgGameDuration: null,
        },
      };
    }

    // Aggregate stats for each team
    let team1Stats = {
      gamesWon: 0,
      totalKills: 0,
      totalGold: 0,
      totalTowers: 0,
      totalDragons: 0,
      totalBarons: 0,
      totalDuration: 0,
      gamesWithDuration: 0,
    };

    let team2Stats = {
      gamesWon: 0,
      totalKills: 0,
      totalGold: 0,
      totalTowers: 0,
      totalDragons: 0,
      totalBarons: 0,
      totalDuration: 0,
      gamesWithDuration: 0,
    };

    for (const game of games) {
      // Team 1 could be blue or red side in different games
      const team1IsBlue = game.blueTeamSlug === match.team1Slug;

      if (team1IsBlue) {
        if (game.winnerSlug === match.team1Slug) team1Stats.gamesWon++;
        team1Stats.totalKills += game.blueKills || 0;
        team1Stats.totalGold += game.blueGold || 0;
        team1Stats.totalTowers += game.blueTowers || 0;
        team1Stats.totalDragons += game.blueDragons || 0;
        team1Stats.totalBarons += game.blueBarons || 0;

        if (game.winnerSlug === match.team2Slug) team2Stats.gamesWon++;
        team2Stats.totalKills += game.redKills || 0;
        team2Stats.totalGold += game.redGold || 0;
        team2Stats.totalTowers += game.redTowers || 0;
        team2Stats.totalDragons += game.redDragons || 0;
        team2Stats.totalBarons += game.redBarons || 0;
      } else {
        if (game.winnerSlug === match.team1Slug) team1Stats.gamesWon++;
        team1Stats.totalKills += game.redKills || 0;
        team1Stats.totalGold += game.redGold || 0;
        team1Stats.totalTowers += game.redTowers || 0;
        team1Stats.totalDragons += game.redDragons || 0;
        team1Stats.totalBarons += game.redBarons || 0;

        if (game.winnerSlug === match.team2Slug) team2Stats.gamesWon++;
        team2Stats.totalKills += game.blueKills || 0;
        team2Stats.totalGold += game.blueGold || 0;
        team2Stats.totalTowers += game.blueTowers || 0;
        team2Stats.totalDragons += game.blueDragons || 0;
        team2Stats.totalBarons += game.blueBarons || 0;
      }

      if (game.duration) {
        team1Stats.totalDuration += game.duration;
        team1Stats.gamesWithDuration++;
        team2Stats.totalDuration += game.duration;
        team2Stats.gamesWithDuration++;
      }
    }

    return {
      matchId,
      totalGames: games.length,
      team1: {
        slug: match.team1Slug,
        gamesWon: team1Stats.gamesWon,
        totalKills: team1Stats.totalKills,
        totalGold: team1Stats.totalGold,
        totalTowers: team1Stats.totalTowers,
        totalDragons: team1Stats.totalDragons,
        totalBarons: team1Stats.totalBarons,
        avgGameDuration:
          team1Stats.gamesWithDuration > 0
            ? Math.round(team1Stats.totalDuration / team1Stats.gamesWithDuration)
            : null,
      },
      team2: {
        slug: match.team2Slug,
        gamesWon: team2Stats.gamesWon,
        totalKills: team2Stats.totalKills,
        totalGold: team2Stats.totalGold,
        totalTowers: team2Stats.totalTowers,
        totalDragons: team2Stats.totalDragons,
        totalBarons: team2Stats.totalBarons,
        avgGameDuration:
          team2Stats.gamesWithDuration > 0
            ? Math.round(team2Stats.totalDuration / team2Stats.gamesWithDuration)
            : null,
      },
    };
  } catch (error: any) {
    console.error('[LolMatchService] Error getting match stats:', error.message);
    throw error;
  }
}

/**
 * Get key timeline events for a match (first blood, objectives across all games)
 */
async function getMatchTimeline(matchId: string): Promise<TimelineEvent[]> {
  try {
    const games = await prisma.lolGame.findMany({
      where: { matchId },
      include: {
        timeline: {
          where: {
            eventType: {
              in: ['KILL', 'TOWER', 'DRAGON', 'BARON', 'HERALD', 'INHIBITOR'],
            },
          },
          orderBy: { timestamp: 'asc' },
        },
      },
      orderBy: { gameNumber: 'asc' },
    });

    const events: TimelineEvent[] = [];

    for (const game of games) {
      // Find first blood for each game
      const firstBloodEvent = game.timeline.find(
        (e) => e.eventType === 'KILL' && e.killType === 'firstBlood'
      );

      if (firstBloodEvent) {
        events.push({
          id: firstBloodEvent.id,
          timestamp: firstBloodEvent.timestamp,
          eventType: 'FIRST_BLOOD',
          teamSlug: firstBloodEvent.teamSlug,
          side: firstBloodEvent.side,
          playerName: firstBloodEvent.playerName,
          victimName: firstBloodEvent.victimName,
          objectiveType: null,
          killType: firstBloodEvent.killType,
          position: firstBloodEvent.position as { x: number; y: number } | null,
        });
      }

      // Add objective events
      const objectiveEvents = game.timeline.filter((e) =>
        ['TOWER', 'DRAGON', 'BARON', 'HERALD', 'INHIBITOR'].includes(e.eventType)
      );

      for (const event of objectiveEvents) {
        events.push({
          id: event.id,
          timestamp: event.timestamp,
          eventType: event.eventType,
          teamSlug: event.teamSlug,
          side: event.side,
          playerName: event.playerName,
          victimName: event.victimName,
          objectiveType: event.objectiveType,
          killType: null,
          position: event.position as { x: number; y: number } | null,
        });
      }
    }

    return events;
  } catch (error: any) {
    console.error('[LolMatchService] Error getting match timeline:', error.message);
    throw error;
  }
}

// ============== GAME METHODS ==============

/**
 * Get single game details by ID
 */
async function getGameById(gameId: string): Promise<GameDetails | null> {
  try {
    const game = await prisma.lolGame.findUnique({
      where: { gameId },
    });

    if (!game) {
      return null;
    }

    return {
      gameId: game.gameId,
      esportsApiId: game.esportsApiId,
      matchId: game.matchId,
      gameNumber: game.gameNumber,
      blueTeam: {
        slug: game.blueTeamSlug,
        kills: game.blueKills,
        gold: game.blueGold,
        towers: game.blueTowers,
        dragons: game.blueDragons,
        barons: game.blueBarons,
        heralds: game.blueHeralds,
        inhibitors: game.blueInhibitors,
        bans: game.blueBans as number[] | null,
      },
      redTeam: {
        slug: game.redTeamSlug,
        kills: game.redKills,
        gold: game.redGold,
        towers: game.redTowers,
        dragons: game.redDragons,
        barons: game.redBarons,
        heralds: game.redHeralds,
        inhibitors: game.redInhibitors,
        bans: game.redBans as number[] | null,
      },
      winnerSlug: game.winnerSlug,
      winningSide: game.winningSide,
      duration: game.duration,
      patch: game.patch,
      firstObjectives: {
        firstBlood: game.firstBlood,
        firstTower: game.firstTower,
        firstDragon: game.firstDragon,
        firstBaron: game.firstBaron,
        firstHerald: game.firstHerald,
      },
    };
  } catch (error: any) {
    console.error('[LolMatchService] Error getting game by ID:', error.message);
    throw error;
  }
}

/**
 * Get player stats for a game
 */
async function getGameStats(gameId: string): Promise<PlayerGameStats[]> {
  try {
    const stats = await prisma.lolGamePlayerStats.findMany({
      where: { gameId },
      orderBy: [{ side: 'asc' }, { role: 'asc' }],
    });

    return stats.map((stat) => ({
      id: stat.id,
      playerName: stat.playerName,
      teamSlug: stat.teamSlug,
      side: stat.side,
      role: stat.role,
      championId: stat.championId,
      championName: stat.championName,
      kills: stat.kills,
      deaths: stat.deaths,
      assists: stat.assists,
      kda: stat.kda ? Number(stat.kda) : null,
      killParticipation: stat.killParticipation ? Number(stat.killParticipation) : null,
      cs: stat.cs,
      csPerMin: stat.csPerMin ? Number(stat.csPerMin) : null,
      gold: stat.gold,
      goldPerMin: stat.goldPerMin ? Number(stat.goldPerMin) : null,
      goldShare: stat.goldShare ? Number(stat.goldShare) : null,
      damageDealt: stat.damageDealt,
      damagePerMin: stat.damagePerMin ? Number(stat.damagePerMin) : null,
      damageShare: stat.damageShare ? Number(stat.damageShare) : null,
      visionScore: stat.visionScore,
      wardsPlaced: stat.wardsPlaced,
      wardsKilled: stat.wardsKilled,
      items: stat.items as number[] | null,
      primaryRune: stat.primaryRune,
      secondaryRune: stat.secondaryRune,
      summonerSpell1: stat.summonerSpell1,
      summonerSpell2: stat.summonerSpell2,
    }));
  } catch (error: any) {
    console.error('[LolMatchService] Error getting game stats:', error.message);
    throw error;
  }
}

/**
 * Get minute-by-minute timeline events for a game
 */
async function getGameTimeline(gameId: string): Promise<TimelineEvent[]> {
  try {
    const events = await prisma.lolGameTimeline.findMany({
      where: { gameId },
      orderBy: { timestamp: 'asc' },
    });

    return events.map((event) => ({
      id: event.id,
      timestamp: event.timestamp,
      eventType: event.eventType,
      teamSlug: event.teamSlug,
      side: event.side,
      playerName: event.playerName,
      victimName: event.victimName,
      objectiveType: event.objectiveType,
      killType: event.killType,
      position: event.position as { x: number; y: number } | null,
    }));
  } catch (error: any) {
    console.error('[LolMatchService] Error getting game timeline:', error.message);
    throw error;
  }
}

/**
 * Get item builds and runes for all players in a game
 */
async function getGameBuilds(gameId: string): Promise<PlayerBuild[]> {
  try {
    const stats = await prisma.lolGamePlayerStats.findMany({
      where: { gameId },
      select: {
        playerName: true,
        teamSlug: true,
        role: true,
        championId: true,
        championName: true,
        items: true,
        primaryRune: true,
        secondaryRune: true,
        summonerSpell1: true,
        summonerSpell2: true,
      },
      orderBy: [{ side: 'asc' }, { role: 'asc' }],
    });

    return stats.map((stat) => ({
      playerName: stat.playerName,
      teamSlug: stat.teamSlug,
      role: stat.role,
      championId: stat.championId,
      championName: stat.championName,
      items: stat.items as number[] | null,
      primaryRune: stat.primaryRune,
      secondaryRune: stat.secondaryRune,
      summonerSpell1: stat.summonerSpell1,
      summonerSpell2: stat.summonerSpell2,
    }));
  } catch (error: any) {
    console.error('[LolMatchService] Error getting game builds:', error.message);
    throw error;
  }
}

/**
 * Get gold difference over time for a game
 * Returns data points from timeline events
 */
async function getGameGoldGraph(gameId: string): Promise<GoldGraphPoint[]> {
  try {
    // First try to get from stored game data
    const game = await prisma.lolGame.findUnique({
      where: { gameId },
      select: { data: true, esportsApiId: true },
    });

    // Check if we have gold graph data stored
    if (game?.data && typeof game.data === 'object') {
      const data = game.data as Record<string, unknown>;
      if (Array.isArray(data.goldGraph)) {
        return data.goldGraph as GoldGraphPoint[];
      }
    }

    // If no stored data, try to fetch from API for live/recent games
    if (game?.esportsApiId) {
      const windowData = await lolEsportsApiService.getGameWindow(game.esportsApiId);
      if (windowData?.frames) {
        const goldGraph: GoldGraphPoint[] = [];

        for (const frame of windowData.frames) {
          const blueGold = frame.blueTeam?.totalGold || 0;
          const redGold = frame.redTeam?.totalGold || 0;

          // Parse timestamp to get game time in seconds
          let timestamp = 0;
          if (frame.rfc460Timestamp) {
            // Convert RFC 3339 timestamp to relative game time
            // This is a simplification - actual implementation may need game start time
            timestamp = goldGraph.length * 60000; // Approximate 1 minute intervals
          }

          goldGraph.push({
            timestamp,
            blueGold,
            redGold,
            goldDiff: blueGold - redGold,
          });
        }

        return goldGraph;
      }
    }

    // Return empty array if no data available
    return [];
  } catch (error: any) {
    console.error('[LolMatchService] Error getting game gold graph:', error.message);
    throw error;
  }
}

/**
 * Get dragon/baron/tower timeline for a game
 */
async function getGameObjectives(gameId: string): Promise<ObjectiveEvent[]> {
  try {
    const events = await prisma.lolGameTimeline.findMany({
      where: {
        gameId,
        eventType: {
          in: ['DRAGON', 'BARON', 'HERALD', 'TOWER', 'INHIBITOR'],
        },
      },
      orderBy: { timestamp: 'asc' },
    });

    return events.map((event) => ({
      timestamp: event.timestamp,
      eventType: event.eventType,
      side: event.side || 'unknown',
      objectiveType: event.objectiveType,
      playerName: event.playerName,
    }));
  } catch (error: any) {
    console.error('[LolMatchService] Error getting game objectives:', error.message);
    throw error;
  }
}

// ============== SYNC METHODS ==============

/**
 * Sync match data from esports API
 */
async function syncMatchFromApi(matchId: string): Promise<MatchDetails | null> {
  try {
    // Fetch event details from API
    const eventDetails = await lolEsportsApiService.getEventDetails(matchId);

    if (!eventDetails?.match) {
      console.warn(`[LolMatchService] No match data found for matchId: ${matchId}`);
      return null;
    }

    const apiMatch = eventDetails.match;
    const teams = apiMatch.teams || [];
    const team1 = teams[0];
    const team2 = teams[1];

    if (!team1 || !team2) {
      console.warn(`[LolMatchService] Missing team data for matchId: ${matchId}`);
      return null;
    }

    // Upsert the match
    await prisma.lolMatch.upsert({
      where: { matchId },
      create: {
        matchId,
        esportsApiId: apiMatch.id,
        tournamentId: eventDetails.tournament?.id || 'unknown',
        blockName: eventDetails.type || null,
        team1Slug: team1.slug,
        team2Slug: team2.slug,
        team1Score: team1.result?.gameWins || null,
        team2Score: team2.result?.gameWins || null,
        winnerSlug:
          team1.result?.outcome === 'win'
            ? team1.slug
            : team2.result?.outcome === 'win'
            ? team2.slug
            : null,
        strategy: apiMatch.games?.length ? `Bo${Math.max(3, apiMatch.games.length * 2 - 1)}` : null,
        state: 'completed',
        lastUpdated: new Date(),
      },
      update: {
        esportsApiId: apiMatch.id,
        team1Score: team1.result?.gameWins || null,
        team2Score: team2.result?.gameWins || null,
        winnerSlug:
          team1.result?.outcome === 'win'
            ? team1.slug
            : team2.result?.outcome === 'win'
            ? team2.slug
            : null,
        state: 'completed',
        lastUpdated: new Date(),
      },
      include: {
        team1: true,
        team2: true,
        games: true,
      },
    });

    // Sync individual games if available
    if (apiMatch.games && apiMatch.games.length > 0) {
      for (const apiGame of apiMatch.games) {
        const gameTeams = apiGame.teams || [];
        const blueTeam = gameTeams.find((t: { side: string }) => t.side === 'blue');
        const redTeam = gameTeams.find((t: { side: string }) => t.side === 'red');

        const gameId = `${matchId}_game${apiGame.number}`;

        await prisma.lolGame.upsert({
          where: { gameId },
          create: {
            gameId,
            esportsApiId: apiGame.id,
            matchId,
            gameNumber: apiGame.number,
            blueTeamSlug: blueTeam?.id || team1.slug,
            redTeamSlug: redTeam?.id || team2.slug,
            lastUpdated: new Date(),
          },
          update: {
            esportsApiId: apiGame.id,
            lastUpdated: new Date(),
          },
        });

        // Try to fetch detailed game stats from feed API
        try {
          const gameWindow = await lolEsportsApiService.getGameWindow(apiGame.id);
          if (gameWindow) {
            await syncGameWindowData(gameId, gameWindow);
          }
        } catch (gameError: any) {
          console.warn(
            `[LolMatchService] Could not fetch game window for ${apiGame.id}:`,
            gameError.message
          );
        }
      }
    }

    return getMatchById(matchId);
  } catch (error: any) {
    console.error('[LolMatchService] Error syncing match from API:', error.message);
    throw error;
  }
}

/**
 * Helper function to sync game window data
 */
async function syncGameWindowData(gameId: string, windowData: any): Promise<void> {
  try {
    if (!windowData.frames || windowData.frames.length === 0) {
      return;
    }

    // Get the last frame for final stats
    const lastFrame = windowData.frames[windowData.frames.length - 1];
    const blueTeam = lastFrame.blueTeam;
    const redTeam = lastFrame.redTeam;

    // Update game with stats from window
    await prisma.lolGame.update({
      where: { gameId },
      data: {
        blueKills: blueTeam?.totalKills || null,
        blueGold: blueTeam?.totalGold || null,
        blueTowers: blueTeam?.towers || null,
        blueBarons: blueTeam?.barons || null,
        blueDragons: blueTeam?.dragons?.length || null,
        blueInhibitors: blueTeam?.inhibitors || null,
        redKills: redTeam?.totalKills || null,
        redGold: redTeam?.totalGold || null,
        redTowers: redTeam?.towers || null,
        redBarons: redTeam?.barons || null,
        redDragons: redTeam?.dragons?.length || null,
        redInhibitors: redTeam?.inhibitors || null,
        winningSide:
          blueTeam?.totalGold > redTeam?.totalGold ? 'blue' : 'red',
        lastUpdated: new Date(),
      },
    });

    // Sync player stats from game metadata
    if (windowData.gameMetadata) {
      const metadata = windowData.gameMetadata;

      // Blue team players
      for (const player of metadata.blueTeamMetadata?.participantMetadata || []) {
        const playerFrame = blueTeam?.participants?.find(
          (p: { participantId: number }) => p.participantId === player.participantId
        );

        if (playerFrame) {
          await prisma.lolGamePlayerStats.upsert({
            where: {
              gameId_playerName: {
                gameId,
                playerName: player.summonerName,
              },
            },
            create: {
              gameId,
              playerName: player.summonerName,
              teamSlug: metadata.blueTeamMetadata.esportsTeamId,
              side: 'blue',
              role: player.role || 'unknown',
              championId: parseInt(player.championId) || 0,
              championName: player.championId || 'Unknown',
              kills: playerFrame.kills || 0,
              deaths: playerFrame.deaths || 0,
              assists: playerFrame.assists || 0,
              cs: playerFrame.creepScore || 0,
              gold: playerFrame.totalGold || 0,
            },
            update: {
              kills: playerFrame.kills || 0,
              deaths: playerFrame.deaths || 0,
              assists: playerFrame.assists || 0,
              cs: playerFrame.creepScore || 0,
              gold: playerFrame.totalGold || 0,
            },
          });
        }
      }

      // Red team players
      for (const player of metadata.redTeamMetadata?.participantMetadata || []) {
        const playerFrame = redTeam?.participants?.find(
          (p: { participantId: number }) => p.participantId === player.participantId
        );

        if (playerFrame) {
          await prisma.lolGamePlayerStats.upsert({
            where: {
              gameId_playerName: {
                gameId,
                playerName: player.summonerName,
              },
            },
            create: {
              gameId,
              playerName: player.summonerName,
              teamSlug: metadata.redTeamMetadata.esportsTeamId,
              side: 'red',
              role: player.role || 'unknown',
              championId: parseInt(player.championId) || 0,
              championName: player.championId || 'Unknown',
              kills: playerFrame.kills || 0,
              deaths: playerFrame.deaths || 0,
              assists: playerFrame.assists || 0,
              cs: playerFrame.creepScore || 0,
              gold: playerFrame.totalGold || 0,
            },
            update: {
              kills: playerFrame.kills || 0,
              deaths: playerFrame.deaths || 0,
              assists: playerFrame.assists || 0,
              cs: playerFrame.creepScore || 0,
              gold: playerFrame.totalGold || 0,
            },
          });
        }
      }
    }
  } catch (error: any) {
    console.error('[LolMatchService] Error syncing game window data:', error.message);
    // Don't throw - this is a helper function, let the parent continue
  }
}

// ============== EXPORT ==============

export const lolMatchService = {
  // Match methods
  getMatchById,
  getMatchGames,
  getMatchStats,
  getMatchTimeline,

  // Game methods
  getGameById,
  getGameStats,
  getGameTimeline,
  getGameBuilds,
  getGameGoldGraph,
  getGameObjectives,

  // Sync methods
  syncMatchFromApi,
};
