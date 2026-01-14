import { prisma } from '../../db/client.js';
import { Prisma } from '@prisma/client';

/**
 * LoL Champion/Meta Analysis Service
 * Handles champion statistics, meta analysis, and player champion pools
 */

// ========== TYPES ==========

export interface ChampionStatsFilters {
  patch?: string;
  league?: string;
  tier?: string;
  role?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'winRate' | 'pickRate' | 'banRate' | 'presence' | 'gamesPlayed';
  sortOrder?: 'asc' | 'desc';
}

export interface ChampionStats {
  championId: number;
  championName: string;
  patch: string;
  league: string | null;
  tier: string | null;
  role: string | null;
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number | null;
  pickRate: number | null;
  banRate: number | null;
  presence: number | null;
  avgKills: number | null;
  avgDeaths: number | null;
  avgAssists: number | null;
  avgKda: number | null;
  avgCs: number | null;
  avgGold: number | null;
  avgDamage: number | null;
  blueSideGames: number | null;
  blueSideWins: number | null;
  redSideGames: number | null;
  redSideWins: number | null;
}

export interface ChampionPlayerStats {
  lolPlayerId: string;
  playerName: string;
  currentTeam: string | null;
  role: string | null;
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgKills: number | null;
  avgDeaths: number | null;
  avgAssists: number | null;
  avgKda: number | null;
}

export interface ChampionMatchup {
  opponentChampionId: number;
  opponentChampionName: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  avgKillDiff: number | null;
  avgGoldDiff: number | null;
}

export interface MetaSummary {
  patch: string;
  league: string | null;
  role: string | null;
  tierList: {
    sTier: ChampionStats[];
    aTier: ChampionStats[];
    bTier: ChampionStats[];
    cTier: ChampionStats[];
  };
  trendingPicks: ChampionStats[];
  highestWinRate: ChampionStats[];
  mostBanned: ChampionStats[];
  totalGamesAnalyzed: number;
  generatedAt: Date;
}

export interface PatchChanges {
  patch: string;
  releaseDate: Date | null;
  previousPatch: string | null;
  championChanges: {
    championId: number;
    championName: string;
    winRateChange: number | null;
    pickRateChange: number | null;
    banRateChange: number | null;
    currentStats: ChampionStats | null;
    previousStats: ChampionStats | null;
    trend: 'rising' | 'falling' | 'stable';
  }[];
  meta: {
    newPicks: ChampionStats[];
    droppedPicks: ChampionStats[];
    biggestWinners: { championName: string; change: number }[];
    biggestLosers: { championName: string; change: number }[];
  };
}

export interface PlayerChampionPool {
  lolPlayerId: string;
  playerName: string;
  champions: {
    championId: number;
    championName: string;
    gamesPlayed: number;
    wins: number;
    losses: number;
    winRate: number | null;
    avgKda: number | null;
    lastPlayed: Date | null;
  }[];
  signatureChampions: string[];
  totalChampionsPlayed: number;
}

// ========== SERVICE FUNCTIONS ==========

/**
 * Get champion statistics with optional filters
 */
export async function getChampionStats(filters: ChampionStatsFilters = {}): Promise<ChampionStats[]> {
  const {
    patch,
    league,
    tier,
    role,
    limit = 50,
    offset = 0,
    sortBy = 'gamesPlayed',
    sortOrder = 'desc',
  } = filters;

  try {
    const where: Prisma.LolChampionStatsWhereInput = {};

    if (patch) where.patch = patch;
    if (league) where.league = league;
    if (tier) where.tier = tier;
    if (role) where.role = role;

    // Map sortBy to database column
    const orderByMap: Record<string, Prisma.LolChampionStatsOrderByWithRelationInput> = {
      winRate: { winRate: sortOrder },
      pickRate: { pickRate: sortOrder },
      banRate: { banRate: sortOrder },
      presence: { presence: sortOrder },
      gamesPlayed: { gamesPlayed: sortOrder },
    };

    const stats = await prisma.lolChampionStats.findMany({
      where,
      orderBy: orderByMap[sortBy] || { gamesPlayed: 'desc' },
      take: limit,
      skip: offset,
    });

    return stats.map(formatChampionStats);
  } catch (error: any) {
    console.error('[LolChampionService] Error fetching champion stats:', error.message);
    throw new Error(`Failed to fetch champion stats: ${error.message}`);
  }
}

/**
 * Get statistics for a specific champion
 */
export async function getChampionById(
  championId: number,
  filters: Omit<ChampionStatsFilters, 'sortBy' | 'sortOrder' | 'limit' | 'offset'> = {}
): Promise<ChampionStats[]> {
  const { patch, league, tier, role } = filters;

  try {
    const where: Prisma.LolChampionStatsWhereInput = {
      championId,
    };

    if (patch) where.patch = patch;
    if (league) where.league = league;
    if (tier) where.tier = tier;
    if (role) where.role = role;

    const stats = await prisma.lolChampionStats.findMany({
      where,
      orderBy: { patch: 'desc' },
    });

    if (stats.length === 0) {
      // Try to get champion name for better error message
      const champion = await prisma.lolChampion.findUnique({
        where: { championId },
      });

      if (!champion) {
        throw new Error(`Champion with ID ${championId} not found`);
      }

      return [];
    }

    return stats.map(formatChampionStats);
  } catch (error: any) {
    console.error(`[LolChampionService] Error fetching champion ${championId}:`, error.message);
    throw new Error(`Failed to fetch champion stats: ${error.message}`);
  }
}

/**
 * Get best players on a specific champion
 */
export async function getChampionPlayers(
  championId: number,
  options: {
    season?: string;
    league?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<ChampionPlayerStats[]> {
  const { season, league, limit = 20, offset = 0 } = options;

  try {
    const where: Prisma.LolPlayerChampionStatsWhereInput = {
      championId,
      gamesPlayed: { gte: 3 }, // Minimum games threshold
    };

    if (season) where.season = season;
    if (league) where.league = league;

    const playerStats = await prisma.lolPlayerChampionStats.findMany({
      where,
      orderBy: [
        { winRate: 'desc' },
        { gamesPlayed: 'desc' },
      ],
      take: limit,
      skip: offset,
      // Prisma doesn't have this relation directly, so we need to query separately
    });

    // Get player details for each stat entry
    const playerIds = playerStats.map(ps => ps.lolPlayerId).filter(Boolean);
    const players = await prisma.lolPlayer.findMany({
      where: {
        lolPlayerId: { in: playerIds },
      },
      include: {
        rosterHistory: {
          where: { status: 'current' },
          take: 1,
        },
      },
    });

    const playerMap = new Map(players.map(p => [p.lolPlayerId, p]));

    return playerStats.map(ps => {
      const player = playerMap.get(ps.lolPlayerId);
      return {
        lolPlayerId: ps.lolPlayerId,
        playerName: player?.currentIgn || ps.championName,
        currentTeam: player?.rosterHistory[0]?.orgSlug || null,
        role: player?.role || null,
        gamesPlayed: ps.gamesPlayed,
        wins: ps.wins,
        losses: ps.losses,
        winRate: ps.winRate ? Number(ps.winRate) : null,
        avgKills: ps.avgKills ? Number(ps.avgKills) : null,
        avgDeaths: ps.avgDeaths ? Number(ps.avgDeaths) : null,
        avgAssists: ps.avgAssists ? Number(ps.avgAssists) : null,
        avgKda: ps.avgKda ? Number(ps.avgKda) : null,
      };
    });
  } catch (error: any) {
    console.error(`[LolChampionService] Error fetching champion players for ${championId}:`, error.message);
    throw new Error(`Failed to fetch champion players: ${error.message}`);
  }
}

/**
 * Get champion matchup data (win rate vs other champions)
 */
export async function getChampionMatchups(
  championId: number,
  options: {
    patch?: string;
    role?: string;
    limit?: number;
  } = {}
): Promise<ChampionMatchup[]> {
  const { patch, role, limit = 20 } = options;

  try {
    // Get games where this champion was played
    const gameStats = await prisma.lolGamePlayerStats.findMany({
      where: {
        championId,
        ...(role ? { role } : {}),
        ...(patch ? {
          game: {
            patch,
          },
        } : {}),
      },
      include: {
        game: {
          include: {
            playerStats: true,
          },
        },
      },
    });

    // Aggregate matchup data
    const matchups = new Map<number, {
      opponentChampionId: number;
      opponentChampionName: string;
      wins: number;
      losses: number;
      killDiffs: number[];
      goldDiffs: number[];
    }>();

    for (const stat of gameStats) {
      if (!stat.game) continue;

      // Find the opponent in the same role on the opposite team
      const opponent = stat.game.playerStats.find(
        ps => ps.role === stat.role && ps.side !== stat.side
      );

      if (!opponent) continue;

      const existing = matchups.get(opponent.championId) || {
        opponentChampionId: opponent.championId,
        opponentChampionName: opponent.championName,
        wins: 0,
        losses: 0,
        killDiffs: [],
        goldDiffs: [],
      };

      // Determine if this was a win (team won)
      const isWin = stat.game.winnerSlug === stat.teamSlug;
      if (isWin) {
        existing.wins++;
      } else {
        existing.losses++;
      }

      // Calculate diffs
      const killDiff = stat.kills - opponent.kills;
      const goldDiff = stat.gold - opponent.gold;
      existing.killDiffs.push(killDiff);
      existing.goldDiffs.push(goldDiff);

      matchups.set(opponent.championId, existing);
    }

    // Convert to array and calculate averages
    const results: ChampionMatchup[] = Array.from(matchups.values())
      .map(m => ({
        opponentChampionId: m.opponentChampionId,
        opponentChampionName: m.opponentChampionName,
        gamesPlayed: m.wins + m.losses,
        wins: m.wins,
        losses: m.losses,
        winRate: (m.wins / (m.wins + m.losses)) * 100,
        avgKillDiff: m.killDiffs.length > 0
          ? m.killDiffs.reduce((a, b) => a + b, 0) / m.killDiffs.length
          : null,
        avgGoldDiff: m.goldDiffs.length > 0
          ? m.goldDiffs.reduce((a, b) => a + b, 0) / m.goldDiffs.length
          : null,
      }))
      .sort((a, b) => b.gamesPlayed - a.gamesPlayed)
      .slice(0, limit);

    return results;
  } catch (error: any) {
    console.error(`[LolChampionService] Error fetching matchups for ${championId}:`, error.message);
    throw new Error(`Failed to fetch champion matchups: ${error.message}`);
  }
}

/**
 * Get meta summary (tier list, trending picks) for a patch/league/role
 */
export async function getMetaSummary(
  patch: string,
  league?: string,
  role?: string
): Promise<MetaSummary> {
  try {
    const where: Prisma.LolChampionStatsWhereInput = {
      patch,
      gamesPlayed: { gte: 5 }, // Minimum sample size
    };

    if (league) where.league = league;
    if (role) where.role = role;

    const stats = await prisma.lolChampionStats.findMany({
      where,
      orderBy: { gamesPlayed: 'desc' },
    });

    const formattedStats = stats.map(formatChampionStats);

    // Calculate tier list based on win rate and presence
    const tierList = calculateTierList(formattedStats);

    // Get trending picks (high pick rate, recent increase)
    const trendingPicks = formattedStats
      .filter(s => s.pickRate && s.pickRate > 0.1)
      .sort((a, b) => (b.pickRate || 0) - (a.pickRate || 0))
      .slice(0, 10);

    // Highest win rate with minimum games
    const highestWinRate = formattedStats
      .filter(s => s.gamesPlayed >= 10)
      .sort((a, b) => (b.winRate || 0) - (a.winRate || 0))
      .slice(0, 10);

    // Most banned
    const mostBanned = formattedStats
      .filter(s => s.banRate && s.banRate > 0)
      .sort((a, b) => (b.banRate || 0) - (a.banRate || 0))
      .slice(0, 10);

    // Total games analyzed
    const totalGamesAnalyzed = Math.round(
      formattedStats.reduce((sum, s) => sum + s.gamesPlayed, 0) / 10 // Divide by ~10 champs per game
    );

    return {
      patch,
      league: league || null,
      role: role || null,
      tierList,
      trendingPicks,
      highestWinRate,
      mostBanned,
      totalGamesAnalyzed,
      generatedAt: new Date(),
    };
  } catch (error: any) {
    console.error(`[LolChampionService] Error generating meta summary:`, error.message);
    throw new Error(`Failed to generate meta summary: ${error.message}`);
  }
}

/**
 * Get patch changes and their impact on pro play
 */
export async function getPatchChanges(patch: string): Promise<PatchChanges> {
  try {
    // Get patch info
    const patchInfo = await prisma.lolPatch.findUnique({
      where: { patch },
    });

    // Find previous patch
    const patches = await prisma.lolPatch.findMany({
      orderBy: { releaseDate: 'desc' },
      take: 20,
    });

    const patchIndex = patches.findIndex(p => p.patch === patch);
    const previousPatchEntry = patchIndex >= 0 && patchIndex < patches.length - 1
      ? patches[patchIndex + 1]
      : null;
    const previousPatch = previousPatchEntry?.patch ?? null;

    // Get current patch stats
    const currentStats = await prisma.lolChampionStats.findMany({
      where: { patch },
    });

    // Get previous patch stats if available
    const previousStats = previousPatch
      ? await prisma.lolChampionStats.findMany({
          where: { patch: previousPatch },
        })
      : [];

    const previousStatsMap = new Map(
      previousStats.map(s => [`${s.championId}-${s.role || 'all'}`, s])
    );

    // Calculate changes
    const championChanges = currentStats.map(curr => {
      const prev = previousStatsMap.get(`${curr.championId}-${curr.role || 'all'}`);

      const winRateChange = prev && curr.winRate && prev.winRate
        ? Number(curr.winRate) - Number(prev.winRate)
        : null;

      const pickRateChange = prev && curr.pickRate && prev.pickRate
        ? Number(curr.pickRate) - Number(prev.pickRate)
        : null;

      const banRateChange = prev && curr.banRate && prev.banRate
        ? Number(curr.banRate) - Number(prev.banRate)
        : null;

      // Determine trend
      let trend: 'rising' | 'falling' | 'stable' = 'stable';
      if (winRateChange !== null) {
        if (winRateChange > 0.02) trend = 'rising';
        else if (winRateChange < -0.02) trend = 'falling';
      }

      return {
        championId: curr.championId,
        championName: curr.championName,
        winRateChange: winRateChange ? winRateChange * 100 : null,
        pickRateChange: pickRateChange ? pickRateChange * 100 : null,
        banRateChange: banRateChange ? banRateChange * 100 : null,
        currentStats: formatChampionStats(curr),
        previousStats: prev ? formatChampionStats(prev) : null,
        trend,
      };
    });

    // Find new picks (in current but not previous)
    const previousChampionIds = new Set(previousStats.map(s => s.championId));
    const newPicks = currentStats
      .filter(s => !previousChampionIds.has(s.championId) && s.gamesPlayed >= 3)
      .map(formatChampionStats);

    // Find dropped picks (in previous but not current with significant games)
    const currentChampionIds = new Set(currentStats.map(s => s.championId));
    const droppedPicks = previousStats
      .filter(s => !currentChampionIds.has(s.championId) && s.gamesPlayed >= 5)
      .map(formatChampionStats);

    // Biggest winners and losers
    const sortedByWinChange = championChanges
      .filter(c => c.winRateChange !== null)
      .sort((a, b) => (b.winRateChange || 0) - (a.winRateChange || 0));

    const biggestWinners = sortedByWinChange
      .slice(0, 5)
      .map(c => ({ championName: c.championName, change: c.winRateChange || 0 }));

    const biggestLosers = sortedByWinChange
      .slice(-5)
      .reverse()
      .map(c => ({ championName: c.championName, change: c.winRateChange || 0 }));

    return {
      patch,
      releaseDate: patchInfo?.releaseDate || null,
      previousPatch,
      championChanges,
      meta: {
        newPicks,
        droppedPicks,
        biggestWinners,
        biggestLosers,
      },
    };
  } catch (error: any) {
    console.error(`[LolChampionService] Error fetching patch changes for ${patch}:`, error.message);
    throw new Error(`Failed to fetch patch changes: ${error.message}`);
  }
}

/**
 * Sync champion stats from game data
 * Recalculates aggregated statistics from individual game data
 */
export async function syncChampionStats(options: {
  patch?: string;
  league?: string;
  forceRefresh?: boolean;
} = {}): Promise<{
  success: boolean;
  statsUpdated: number;
  errors: string[];
}> {
  const { patch, league } = options;
  const errors: string[] = [];
  let statsUpdated = 0;

  try {
    console.log('[LolChampionService] Starting champion stats sync...');

    // Get all games matching the criteria
    const gameWhere: Prisma.LolGameWhereInput = {};
    if (patch) gameWhere.patch = patch;

    // Add league filter through match -> tournament -> league
    if (league) {
      gameWhere.match = {
        tournament: {
          league: {
            slug: league,
          },
        },
      };
    }

    const games = await prisma.lolGame.findMany({
      where: gameWhere,
      include: {
        playerStats: true,
        match: {
          include: {
            tournament: {
              include: {
                league: true,
              },
            },
          },
        },
      },
    });

    console.log(`[LolChampionService] Found ${games.length} games to process`);

    // Aggregate stats by champion/patch/league/role
    const aggregatedStats = new Map<string, {
      championId: number;
      championName: string;
      patch: string;
      league: string | null;
      tier: string | null;
      role: string | null;
      gamesPlayed: number;
      wins: number;
      losses: number;
      totalKills: number;
      totalDeaths: number;
      totalAssists: number;
      totalCs: number;
      totalGold: number;
      totalDamage: number;
      blueSideGames: number;
      blueSideWins: number;
      redSideGames: number;
      redSideWins: number;
      bans: number;
    }>();

    // Count total games per patch/league for pick/ban rate calculation
    const gameCounts = new Map<string, number>();

    for (const game of games) {
      if (!game.patch) continue;

      const gameLeague = game.match?.tournament?.league?.slug || null;
      const gameTier = game.match?.tournament?.tier || null;
      const gameKey = `${game.patch}-${gameLeague}`;

      gameCounts.set(gameKey, (gameCounts.get(gameKey) || 0) + 1);

      // Process bans
      const allBans = [
        ...(game.blueBans as number[] || []),
        ...(game.redBans as number[] || []),
      ];

      for (const bannedChampionId of allBans) {
        // We'd need champion name lookup here - skip for now or use a lookup
        const banKey = `${bannedChampionId}-${game.patch}-${gameLeague}-ban`;
        const existing = aggregatedStats.get(banKey);
        if (existing) {
          existing.bans++;
        }
      }

      // Process player stats
      for (const stat of game.playerStats) {
        const key = `${stat.championId}-${game.patch}-${gameLeague}-${stat.role}`;

        const existing = aggregatedStats.get(key) || {
          championId: stat.championId,
          championName: stat.championName,
          patch: game.patch,
          league: gameLeague,
          tier: gameTier,
          role: stat.role,
          gamesPlayed: 0,
          wins: 0,
          losses: 0,
          totalKills: 0,
          totalDeaths: 0,
          totalAssists: 0,
          totalCs: 0,
          totalGold: 0,
          totalDamage: 0,
          blueSideGames: 0,
          blueSideWins: 0,
          redSideGames: 0,
          redSideWins: 0,
          bans: 0,
        };

        existing.gamesPlayed++;

        const isWin = game.winnerSlug === stat.teamSlug;
        if (isWin) existing.wins++;
        else existing.losses++;

        existing.totalKills += stat.kills;
        existing.totalDeaths += stat.deaths;
        existing.totalAssists += stat.assists;
        existing.totalCs += stat.cs;
        existing.totalGold += stat.gold;
        existing.totalDamage += stat.damageDealt || 0;

        if (stat.side === 'blue') {
          existing.blueSideGames++;
          if (isWin) existing.blueSideWins++;
        } else {
          existing.redSideGames++;
          if (isWin) existing.redSideWins++;
        }

        aggregatedStats.set(key, existing);
      }
    }

    // Upsert all aggregated stats
    for (const [, stats] of aggregatedStats) {
      try {
        const totalGames = gameCounts.get(`${stats.patch}-${stats.league}`) || 1;

        await prisma.lolChampionStats.upsert({
          where: {
            championId_patch_league_role: {
              championId: stats.championId,
              patch: stats.patch,
              league: stats.league ?? '',
              role: stats.role ?? '',
            },
          },
          create: {
            championId: stats.championId,
            championName: stats.championName,
            patch: stats.patch,
            league: stats.league,
            tier: stats.tier,
            role: stats.role,
            gamesPlayed: stats.gamesPlayed,
            wins: stats.wins,
            losses: stats.losses,
            winRate: stats.gamesPlayed > 0 ? stats.wins / stats.gamesPlayed : null,
            pickRate: totalGames > 0 ? stats.gamesPlayed / totalGames : null,
            banRate: totalGames > 0 ? stats.bans / totalGames : null,
            presence: totalGames > 0
              ? (stats.gamesPlayed + stats.bans) / totalGames
              : null,
            avgKills: stats.gamesPlayed > 0 ? stats.totalKills / stats.gamesPlayed : null,
            avgDeaths: stats.gamesPlayed > 0 ? stats.totalDeaths / stats.gamesPlayed : null,
            avgAssists: stats.gamesPlayed > 0 ? stats.totalAssists / stats.gamesPlayed : null,
            avgKda: stats.gamesPlayed > 0 && stats.totalDeaths > 0
              ? (stats.totalKills + stats.totalAssists) / stats.totalDeaths
              : null,
            avgCs: stats.gamesPlayed > 0 ? stats.totalCs / stats.gamesPlayed : null,
            avgGold: stats.gamesPlayed > 0 ? stats.totalGold / stats.gamesPlayed : null,
            avgDamage: stats.gamesPlayed > 0 ? stats.totalDamage / stats.gamesPlayed : null,
            blueSideGames: stats.blueSideGames,
            blueSideWins: stats.blueSideWins,
            redSideGames: stats.redSideGames,
            redSideWins: stats.redSideWins,
          },
          update: {
            gamesPlayed: stats.gamesPlayed,
            wins: stats.wins,
            losses: stats.losses,
            winRate: stats.gamesPlayed > 0 ? stats.wins / stats.gamesPlayed : null,
            pickRate: totalGames > 0 ? stats.gamesPlayed / totalGames : null,
            banRate: totalGames > 0 ? stats.bans / totalGames : null,
            presence: totalGames > 0
              ? (stats.gamesPlayed + stats.bans) / totalGames
              : null,
            avgKills: stats.gamesPlayed > 0 ? stats.totalKills / stats.gamesPlayed : null,
            avgDeaths: stats.gamesPlayed > 0 ? stats.totalDeaths / stats.gamesPlayed : null,
            avgAssists: stats.gamesPlayed > 0 ? stats.totalAssists / stats.gamesPlayed : null,
            avgKda: stats.gamesPlayed > 0 && stats.totalDeaths > 0
              ? (stats.totalKills + stats.totalAssists) / stats.totalDeaths
              : null,
            avgCs: stats.gamesPlayed > 0 ? stats.totalCs / stats.gamesPlayed : null,
            avgGold: stats.gamesPlayed > 0 ? stats.totalGold / stats.gamesPlayed : null,
            avgDamage: stats.gamesPlayed > 0 ? stats.totalDamage / stats.gamesPlayed : null,
            blueSideGames: stats.blueSideGames,
            blueSideWins: stats.blueSideWins,
            redSideGames: stats.redSideGames,
            redSideWins: stats.redSideWins,
            lastUpdated: new Date(),
          },
        });

        statsUpdated++;
      } catch (err: any) {
        errors.push(`Failed to update stats for ${stats.championName}: ${err.message}`);
      }
    }

    console.log(`[LolChampionService] Sync complete. Updated ${statsUpdated} champion stat entries.`);

    return {
      success: errors.length === 0,
      statsUpdated,
      errors,
    };
  } catch (error: any) {
    console.error('[LolChampionService] Error syncing champion stats:', error.message);
    throw new Error(`Failed to sync champion stats: ${error.message}`);
  }
}

/**
 * Update a player's champion pool statistics
 */
export async function updatePlayerChampionStats(playerId: string): Promise<{
  success: boolean;
  championsUpdated: number;
  pool: PlayerChampionPool | null;
}> {
  try {
    console.log(`[LolChampionService] Updating champion stats for player ${playerId}...`);

    // Get all game stats for this player
    const gameStats = await prisma.lolGamePlayerStats.findMany({
      where: {
        lolPlayerId: playerId,
      },
      include: {
        game: {
          include: {
            match: {
              include: {
                tournament: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (gameStats.length === 0) {
      console.log(`[LolChampionService] No game stats found for player ${playerId}`);
      return {
        success: true,
        championsUpdated: 0,
        pool: null,
      };
    }

    // Get player info
    const player = await prisma.lolPlayer.findUnique({
      where: { lolPlayerId: playerId },
    });

    // Aggregate by champion
    const championAggregates = new Map<number, {
      championId: number;
      championName: string;
      gamesPlayed: number;
      wins: number;
      losses: number;
      totalKills: number;
      totalDeaths: number;
      totalAssists: number;
      totalCs: number;
      totalGold: number;
      lastPlayed: Date | null;
      seasons: Set<string>;
      leagues: Set<string>;
    }>();

    for (const stat of gameStats) {
      const existing = championAggregates.get(stat.championId) || {
        championId: stat.championId,
        championName: stat.championName,
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        totalKills: 0,
        totalDeaths: 0,
        totalAssists: 0,
        totalCs: 0,
        totalGold: 0,
        lastPlayed: null,
        seasons: new Set<string>(),
        leagues: new Set<string>(),
      };

      existing.gamesPlayed++;

      // Determine win
      const isWin = stat.game?.winnerSlug === stat.teamSlug;
      if (isWin) existing.wins++;
      else existing.losses++;

      existing.totalKills += stat.kills;
      existing.totalDeaths += stat.deaths;
      existing.totalAssists += stat.assists;
      existing.totalCs += stat.cs;
      existing.totalGold += stat.gold;

      // Track last played
      if (!existing.lastPlayed || (stat.game?.match?.startTime && stat.game.match.startTime > existing.lastPlayed)) {
        existing.lastPlayed = stat.game?.match?.startTime || null;
      }

      // Track seasons/leagues
      const tournament = stat.game?.match?.tournament;
      if (tournament?.slug) {
        // Extract season from tournament slug if possible
        const seasonMatch = tournament.slug.match(/(\d{4})/);
        if (seasonMatch && seasonMatch[1]) {
          existing.seasons.add(seasonMatch[1]);
        }
      }
      if (tournament?.leagueId) {
        existing.leagues.add(tournament.leagueId);
      }

      championAggregates.set(stat.championId, existing);
    }

    // Upsert player champion stats
    let championsUpdated = 0;
    const championsList: PlayerChampionPool['champions'] = [];

    for (const [championId, data] of championAggregates) {
      // For each unique season/league combination, create a stat entry
      // For simplicity, we'll use null for season/league to get career stats
      try {
        const avgKda = data.totalDeaths > 0
          ? (data.totalKills + data.totalAssists) / data.totalDeaths
          : data.totalKills + data.totalAssists;

        await prisma.lolPlayerChampionStats.upsert({
          where: {
            lolPlayerId_championId_season_league: {
              lolPlayerId: playerId,
              championId: data.championId,
              season: '',
              league: '',
            },
          },
          create: {
            lolPlayerId: playerId,
            championId: data.championId,
            championName: data.championName,
            gamesPlayed: data.gamesPlayed,
            wins: data.wins,
            losses: data.losses,
            winRate: data.gamesPlayed > 0 ? data.wins / data.gamesPlayed : null,
            avgKills: data.gamesPlayed > 0 ? data.totalKills / data.gamesPlayed : null,
            avgDeaths: data.gamesPlayed > 0 ? data.totalDeaths / data.gamesPlayed : null,
            avgAssists: data.gamesPlayed > 0 ? data.totalAssists / data.gamesPlayed : null,
            avgKda,
            avgCs: data.gamesPlayed > 0 ? data.totalCs / data.gamesPlayed : null,
            avgGold: data.gamesPlayed > 0 ? data.totalGold / data.gamesPlayed : null,
          },
          update: {
            gamesPlayed: data.gamesPlayed,
            wins: data.wins,
            losses: data.losses,
            winRate: data.gamesPlayed > 0 ? data.wins / data.gamesPlayed : null,
            avgKills: data.gamesPlayed > 0 ? data.totalKills / data.gamesPlayed : null,
            avgDeaths: data.gamesPlayed > 0 ? data.totalDeaths / data.gamesPlayed : null,
            avgAssists: data.gamesPlayed > 0 ? data.totalAssists / data.gamesPlayed : null,
            avgKda,
            avgCs: data.gamesPlayed > 0 ? data.totalCs / data.gamesPlayed : null,
            avgGold: data.gamesPlayed > 0 ? data.totalGold / data.gamesPlayed : null,
            lastUpdated: new Date(),
          },
        });

        championsUpdated++;

        championsList.push({
          championId: data.championId,
          championName: data.championName,
          gamesPlayed: data.gamesPlayed,
          wins: data.wins,
          losses: data.losses,
          winRate: data.gamesPlayed > 0
            ? (data.wins / data.gamesPlayed) * 100
            : null,
          avgKda,
          lastPlayed: data.lastPlayed,
        });
      } catch (err: any) {
        console.error(`[LolChampionService] Error updating champion ${championId} for player ${playerId}:`, err.message);
      }
    }

    // Sort champions by games played and identify signature champions
    championsList.sort((a, b) => b.gamesPlayed - a.gamesPlayed);
    const signatureChampions = championsList
      .filter(c => c.gamesPlayed >= 10 && (c.winRate || 0) >= 55)
      .slice(0, 5)
      .map(c => c.championName);

    const pool: PlayerChampionPool = {
      lolPlayerId: playerId,
      playerName: player?.currentIgn || 'Unknown',
      champions: championsList,
      signatureChampions,
      totalChampionsPlayed: championsList.length,
    };

    console.log(`[LolChampionService] Updated ${championsUpdated} champions for player ${playerId}`);

    return {
      success: true,
      championsUpdated,
      pool,
    };
  } catch (error: any) {
    console.error(`[LolChampionService] Error updating player champion stats:`, error.message);
    throw new Error(`Failed to update player champion stats: ${error.message}`);
  }
}

// ========== HELPER FUNCTIONS ==========

/**
 * Format database champion stats to API response format
 */
function formatChampionStats(stats: any): ChampionStats {
  return {
    championId: stats.championId,
    championName: stats.championName,
    patch: stats.patch,
    league: stats.league,
    tier: stats.tier,
    role: stats.role,
    gamesPlayed: stats.gamesPlayed,
    wins: stats.wins,
    losses: stats.losses,
    winRate: stats.winRate ? Number(stats.winRate) * 100 : null,
    pickRate: stats.pickRate ? Number(stats.pickRate) * 100 : null,
    banRate: stats.banRate ? Number(stats.banRate) * 100 : null,
    presence: stats.presence ? Number(stats.presence) * 100 : null,
    avgKills: stats.avgKills ? Number(stats.avgKills) : null,
    avgDeaths: stats.avgDeaths ? Number(stats.avgDeaths) : null,
    avgAssists: stats.avgAssists ? Number(stats.avgAssists) : null,
    avgKda: stats.avgKda ? Number(stats.avgKda) : null,
    avgCs: stats.avgCs ? Number(stats.avgCs) : null,
    avgGold: stats.avgGold ? Number(stats.avgGold) : null,
    avgDamage: stats.avgDamage ? Number(stats.avgDamage) : null,
    blueSideGames: stats.blueSideGames,
    blueSideWins: stats.blueSideWins,
    redSideGames: stats.redSideGames,
    redSideWins: stats.redSideWins,
  };
}

/**
 * Calculate tier list based on win rate and presence
 */
function calculateTierList(stats: ChampionStats[]): MetaSummary['tierList'] {
  // Score champions based on win rate and presence
  const scoredChampions = stats
    .filter(s => s.gamesPlayed >= 5)
    .map(s => ({
      ...s,
      score: calculateTierScore(s),
    }))
    .sort((a, b) => b.score - a.score);

  // Divide into tiers (roughly: top 10% S, next 20% A, next 30% B, rest C)
  const total = scoredChampions.length;

  return {
    sTier: scoredChampions.slice(0, Math.ceil(total * 0.1)),
    aTier: scoredChampions.slice(Math.ceil(total * 0.1), Math.ceil(total * 0.3)),
    bTier: scoredChampions.slice(Math.ceil(total * 0.3), Math.ceil(total * 0.6)),
    cTier: scoredChampions.slice(Math.ceil(total * 0.6)),
  };
}

/**
 * Calculate tier score for a champion
 * Considers win rate, presence, and sample size
 */
function calculateTierScore(stats: ChampionStats): number {
  const winRate = stats.winRate || 50;
  const presence = stats.presence || 0;
  const games = stats.gamesPlayed;

  // Base score from win rate (normalized around 50%)
  const winRateScore = (winRate - 50) * 2;

  // Presence score (higher presence = more contested = more valuable)
  const presenceScore = presence * 0.5;

  // Sample size bonus (more confidence with more games)
  const sampleBonus = Math.min(games / 50, 1) * 10;

  return winRateScore + presenceScore + sampleBonus;
}

// ========== EXPORT SERVICE ==========

export const lolChampionService = {
  getChampionStats,
  getChampionById,
  getChampionPlayers,
  getChampionMatchups,
  getMetaSummary,
  getPatchChanges,
  syncChampionStats,
  updatePlayerChampionStats,
};
