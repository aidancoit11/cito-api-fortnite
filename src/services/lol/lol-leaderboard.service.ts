import { prisma } from '../../db/client.js';
import { Prisma } from '@prisma/client';

/**
 * LoL Leaderboard Service
 * Provides various leaderboards for League of Legends esports data
 */

// ============== TYPES ==============

export interface EarningsFilters {
  region?: string;
  role?: string;
  nationality?: string;
  year?: number;
  limit?: number;
  offset?: number;
}

export interface KdaFilters {
  season?: string;
  league?: string;
  role?: string;
  minGames?: number;
  limit?: number;
  offset?: number;
}

export interface CsFilters {
  season?: string;
  league?: string;
  role?: string;
  minGames?: number;
  limit?: number;
  offset?: number;
}

export interface WinRateFilters {
  season?: string;
  league?: string;
  role?: string;
  minGames?: number;
  limit?: number;
  offset?: number;
}

export interface VisionFilters {
  season?: string;
  league?: string;
  role?: string;
  minGames?: number;
  limit?: number;
  offset?: number;
}

export interface FirstBloodFilters {
  season?: string;
  league?: string;
  role?: string;
  minGames?: number;
  limit?: number;
  offset?: number;
}

export interface DamageFilters {
  season?: string;
  league?: string;
  role?: string;
  minGames?: number;
  sortBy?: 'damagePerMin' | 'damageShare';
  limit?: number;
  offset?: number;
}

export type ChampionshipType = 'worlds' | 'msi' | 'regional' | 'all';

export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  playerName: string;
  nationality?: string | null;
  role?: string | null;
  currentTeam?: string | null;
  value: number;
  gamesPlayed?: number;
}

export interface EarningsLeaderboardEntry extends LeaderboardEntry {
  totalEarnings: number;
  tournamentCount: number;
  firstPlaceCount: number;
}

export interface ChampionshipLeaderboardEntry {
  rank: number;
  holderId: string;
  holderName: string;
  holderType: 'player' | 'team';
  region?: string | null;
  championships: number;
  worldsWins?: number;
  msiWins?: number;
  regionalTitles?: number;
}

// ============== HELPER FUNCTIONS ==============

function buildWhereClause(filters: { season?: string; league?: string; role?: string }): Prisma.LolGamePlayerStatsWhereInput {
  const where: Prisma.LolGamePlayerStatsWhereInput = {};

  if (filters.role) {
    where.role = filters.role;
  }

  if (filters.league || filters.season) {
    where.game = {
      match: {
        tournament: {
          ...(filters.league && {
            league: {
              slug: filters.league,
            },
          }),
          ...(filters.season && {
            slug: {
              contains: filters.season,
            },
          }),
        },
      },
    };
  }

  return where;
}

// ============== LEADERBOARD FUNCTIONS ==============

/**
 * Get top earners leaderboard
 * Filters: region, role, nationality, year
 */
async function getTopEarners(filters: EarningsFilters = {}): Promise<EarningsLeaderboardEntry[]> {
  const { region, role, nationality, year, limit = 50, offset = 0 } = filters;

  try {
    // Build where clause for player filters
    const playerWhere: Prisma.LolPlayerWhereInput = {};
    if (role) playerWhere.role = role;
    if (nationality) playerWhere.nationality = nationality;
    if (region) {
      playerWhere.rosterHistory = {
        some: {
          organization: {
            region: region,
          },
          isActive: true,
        },
      };
    }

    // Get players with their earnings summaries
    const players = await prisma.lolPlayer.findMany({
      where: {
        ...playerWhere,
        earningsSummary: {
          isNot: null,
        },
      },
      include: {
        earningsSummary: true,
        rosterHistory: {
          where: { isActive: true },
          include: {
            organization: {
              select: { name: true, slug: true },
            },
          },
          take: 1,
        },
      },
    });

    // Process and filter by year if needed
    let results = players
      .filter(p => p.earningsSummary)
      .map(player => {
        let totalEarnings = Number(player.earningsSummary!.totalEarnings);

        // If year filter is set, use year-specific earnings
        if (year && player.earningsSummary!.earningsByYear) {
          const earningsByYear = player.earningsSummary!.earningsByYear as Record<string, number>;
          totalEarnings = earningsByYear[year.toString()] || 0;
        }

        return {
          playerId: player.lolPlayerId,
          playerName: player.currentIgn,
          nationality: player.nationality,
          role: player.role,
          currentTeam: player.rosterHistory[0]?.organization?.name || null,
          totalEarnings,
          tournamentCount: player.earningsSummary!.tournamentCount,
          firstPlaceCount: player.earningsSummary!.firstPlaceCount,
        };
      })
      .filter(p => p.totalEarnings > 0)
      .sort((a, b) => b.totalEarnings - a.totalEarnings);

    // Apply pagination
    results = results.slice(offset, offset + limit);

    // Add ranks
    return results.map((entry, index) => ({
      rank: offset + index + 1,
      ...entry,
      value: entry.totalEarnings,
    }));
  } catch (error) {
    console.error('[LolLeaderboardService] Error fetching top earners:', error);
    throw error;
  }
}

/**
 * Get KDA leaderboard
 * Filters: season, league, role, minGames
 */
async function getKdaLeaderboard(filters: KdaFilters = {}): Promise<LeaderboardEntry[]> {
  const { season, league, role, minGames = 10, limit = 50, offset = 0 } = filters;

  try {
    const whereClause = buildWhereClause({ season, league, role });

    // Aggregate player stats
    const playerStats = await prisma.lolGamePlayerStats.groupBy({
      by: ['lolPlayerId', 'playerName', 'role'],
      where: {
        ...whereClause,
        lolPlayerId: { not: null },
      },
      _count: { gameId: true },
      _sum: {
        kills: true,
        deaths: true,
        assists: true,
      },
    });

    // Calculate KDA and filter by minimum games
    const results = playerStats
      .filter(p => p._count.gameId >= minGames && p.lolPlayerId)
      .map(p => {
        const kills = p._sum.kills || 0;
        const deaths = p._sum.deaths || 1; // Avoid division by zero
        const assists = p._sum.assists || 0;
        const kda = (kills + assists) / Math.max(deaths, 1);

        return {
          playerId: p.lolPlayerId!,
          playerName: p.playerName,
          role: p.role,
          value: parseFloat(kda.toFixed(2)),
          gamesPlayed: p._count.gameId,
        };
      })
      .sort((a, b) => b.value - a.value)
      .slice(offset, offset + limit);

    // Get additional player info
    const playerIds = results.map(r => r.playerId);
    const players = await prisma.lolPlayer.findMany({
      where: { lolPlayerId: { in: playerIds } },
      include: {
        rosterHistory: {
          where: { isActive: true },
          include: { organization: { select: { name: true } } },
          take: 1,
        },
      },
    });

    const playerMap = new Map(players.map(p => [p.lolPlayerId, p]));

    return results.map((entry, index) => {
      const player = playerMap.get(entry.playerId);
      return {
        rank: offset + index + 1,
        playerId: entry.playerId,
        playerName: entry.playerName,
        nationality: player?.nationality || null,
        role: entry.role,
        currentTeam: player?.rosterHistory[0]?.organization?.name || null,
        value: entry.value,
        gamesPlayed: entry.gamesPlayed,
      };
    });
  } catch (error) {
    console.error('[LolLeaderboardService] Error fetching KDA leaderboard:', error);
    throw error;
  }
}

/**
 * Get CS per minute leaderboard
 * Filters: season, league, role, minGames
 */
async function getCsLeaderboard(filters: CsFilters = {}): Promise<LeaderboardEntry[]> {
  const { season, league, role, minGames = 10, limit = 50, offset = 0 } = filters;

  try {
    const whereClause = buildWhereClause({ season, league, role });

    // Get game stats with duration info
    const gameStats = await prisma.lolGamePlayerStats.findMany({
      where: {
        ...whereClause,
        lolPlayerId: { not: null },
        csPerMin: { not: null },
      },
      select: {
        lolPlayerId: true,
        playerName: true,
        role: true,
        csPerMin: true,
      },
    });

    // Aggregate by player
    const playerAggregates = new Map<string, {
      playerName: string;
      role: string;
      totalCsPerMin: number;
      count: number;
    }>();

    for (const stat of gameStats) {
      if (!stat.lolPlayerId) continue;

      const existing = playerAggregates.get(stat.lolPlayerId);
      if (existing) {
        existing.totalCsPerMin += Number(stat.csPerMin);
        existing.count++;
      } else {
        playerAggregates.set(stat.lolPlayerId, {
          playerName: stat.playerName,
          role: stat.role,
          totalCsPerMin: Number(stat.csPerMin),
          count: 1,
        });
      }
    }

    // Calculate averages and filter
    const results = Array.from(playerAggregates.entries())
      .filter(([, data]) => data.count >= minGames)
      .map(([playerId, data]) => ({
        playerId,
        playerName: data.playerName,
        role: data.role,
        value: parseFloat((data.totalCsPerMin / data.count).toFixed(2)),
        gamesPlayed: data.count,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(offset, offset + limit);

    // Get additional player info
    const playerIds = results.map(r => r.playerId);
    const players = await prisma.lolPlayer.findMany({
      where: { lolPlayerId: { in: playerIds } },
      include: {
        rosterHistory: {
          where: { isActive: true },
          include: { organization: { select: { name: true } } },
          take: 1,
        },
      },
    });

    const playerMap = new Map(players.map(p => [p.lolPlayerId, p]));

    return results.map((entry, index) => {
      const player = playerMap.get(entry.playerId);
      return {
        rank: offset + index + 1,
        playerId: entry.playerId,
        playerName: entry.playerName,
        nationality: player?.nationality || null,
        role: entry.role,
        currentTeam: player?.rosterHistory[0]?.organization?.name || null,
        value: entry.value,
        gamesPlayed: entry.gamesPlayed,
      };
    });
  } catch (error) {
    console.error('[LolLeaderboardService] Error fetching CS leaderboard:', error);
    throw error;
  }
}

/**
 * Get win rate leaderboard
 * Filters: season, league, role, minGames threshold
 */
async function getWinRateLeaderboard(filters: WinRateFilters = {}): Promise<LeaderboardEntry[]> {
  const { season, league, role, minGames = 20, limit = 50, offset = 0 } = filters;

  try {
    const whereClause = buildWhereClause({ season, league, role });

    // Get game stats with winner info
    const gameStats = await prisma.lolGamePlayerStats.findMany({
      where: {
        ...whereClause,
        lolPlayerId: { not: null },
      },
      select: {
        lolPlayerId: true,
        playerName: true,
        role: true,
        teamSlug: true,
        game: {
          select: {
            winnerSlug: true,
          },
        },
      },
    });

    // Aggregate wins and games by player
    const playerAggregates = new Map<string, {
      playerName: string;
      role: string;
      wins: number;
      total: number;
    }>();

    for (const stat of gameStats) {
      if (!stat.lolPlayerId) continue;

      const isWin = stat.teamSlug === stat.game.winnerSlug;
      const existing = playerAggregates.get(stat.lolPlayerId);

      if (existing) {
        existing.total++;
        if (isWin) existing.wins++;
      } else {
        playerAggregates.set(stat.lolPlayerId, {
          playerName: stat.playerName,
          role: stat.role,
          wins: isWin ? 1 : 0,
          total: 1,
        });
      }
    }

    // Calculate win rates and filter
    const results = Array.from(playerAggregates.entries())
      .filter(([, data]) => data.total >= minGames)
      .map(([playerId, data]) => ({
        playerId,
        playerName: data.playerName,
        role: data.role,
        value: parseFloat(((data.wins / data.total) * 100).toFixed(1)),
        gamesPlayed: data.total,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(offset, offset + limit);

    // Get additional player info
    const playerIds = results.map(r => r.playerId);
    const players = await prisma.lolPlayer.findMany({
      where: { lolPlayerId: { in: playerIds } },
      include: {
        rosterHistory: {
          where: { isActive: true },
          include: { organization: { select: { name: true } } },
          take: 1,
        },
      },
    });

    const playerMap = new Map(players.map(p => [p.lolPlayerId, p]));

    return results.map((entry, index) => {
      const player = playerMap.get(entry.playerId);
      return {
        rank: offset + index + 1,
        playerId: entry.playerId,
        playerName: entry.playerName,
        nationality: player?.nationality || null,
        role: entry.role,
        currentTeam: player?.rosterHistory[0]?.organization?.name || null,
        value: entry.value,
        gamesPlayed: entry.gamesPlayed,
      };
    });
  } catch (error) {
    console.error('[LolLeaderboardService] Error fetching win rate leaderboard:', error);
    throw error;
  }
}

/**
 * Get vision score leaderboard (support focused)
 * Filters: season, league, role (defaults to Support), minGames
 */
async function getVisionLeaderboard(filters: VisionFilters = {}): Promise<LeaderboardEntry[]> {
  const { season, league, role = 'Support', minGames = 10, limit = 50, offset = 0 } = filters;

  try {
    const whereClause = buildWhereClause({ season, league, role });

    // Get game stats with vision data
    const gameStats = await prisma.lolGamePlayerStats.findMany({
      where: {
        ...whereClause,
        lolPlayerId: { not: null },
        visionScore: { not: null },
      },
      select: {
        lolPlayerId: true,
        playerName: true,
        role: true,
        visionScore: true,
        game: {
          select: {
            duration: true,
          },
        },
      },
    });

    // Aggregate vision score per minute by player
    const playerAggregates = new Map<string, {
      playerName: string;
      role: string;
      totalVisionPerMin: number;
      count: number;
    }>();

    for (const stat of gameStats) {
      if (!stat.lolPlayerId || !stat.game.duration) continue;

      const durationMinutes = stat.game.duration / 60;
      const visionPerMin = (stat.visionScore || 0) / durationMinutes;

      const existing = playerAggregates.get(stat.lolPlayerId);
      if (existing) {
        existing.totalVisionPerMin += visionPerMin;
        existing.count++;
      } else {
        playerAggregates.set(stat.lolPlayerId, {
          playerName: stat.playerName,
          role: stat.role,
          totalVisionPerMin: visionPerMin,
          count: 1,
        });
      }
    }

    // Calculate averages and filter
    const results = Array.from(playerAggregates.entries())
      .filter(([, data]) => data.count >= minGames)
      .map(([playerId, data]) => ({
        playerId,
        playerName: data.playerName,
        role: data.role,
        value: parseFloat((data.totalVisionPerMin / data.count).toFixed(2)),
        gamesPlayed: data.count,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(offset, offset + limit);

    // Get additional player info
    const playerIds = results.map(r => r.playerId);
    const players = await prisma.lolPlayer.findMany({
      where: { lolPlayerId: { in: playerIds } },
      include: {
        rosterHistory: {
          where: { isActive: true },
          include: { organization: { select: { name: true } } },
          take: 1,
        },
      },
    });

    const playerMap = new Map(players.map(p => [p.lolPlayerId, p]));

    return results.map((entry, index) => {
      const player = playerMap.get(entry.playerId);
      return {
        rank: offset + index + 1,
        playerId: entry.playerId,
        playerName: entry.playerName,
        nationality: player?.nationality || null,
        role: entry.role,
        currentTeam: player?.rosterHistory[0]?.organization?.name || null,
        value: entry.value,
        gamesPlayed: entry.gamesPlayed,
      };
    });
  } catch (error) {
    console.error('[LolLeaderboardService] Error fetching vision leaderboard:', error);
    throw error;
  }
}

/**
 * Get first blood rate leaderboard
 * Filters: season, league, role, minGames
 */
async function getFirstBloodLeaderboard(filters: FirstBloodFilters = {}): Promise<LeaderboardEntry[]> {
  const { season, league, role, minGames = 15, limit = 50, offset = 0 } = filters;

  try {
    const whereClause = buildWhereClause({ season, league, role });

    // Get game stats with first blood data
    const gameStats = await prisma.lolGamePlayerStats.findMany({
      where: {
        ...whereClause,
        lolPlayerId: { not: null },
      },
      select: {
        lolPlayerId: true,
        playerName: true,
        role: true,
        firstBlood: true,
        firstBloodAssist: true,
      },
    });

    // Aggregate first blood participation by player
    const playerAggregates = new Map<string, {
      playerName: string;
      role: string;
      firstBloods: number;
      firstBloodAssists: number;
      total: number;
    }>();

    for (const stat of gameStats) {
      if (!stat.lolPlayerId) continue;

      const existing = playerAggregates.get(stat.lolPlayerId);
      if (existing) {
        existing.total++;
        if (stat.firstBlood) existing.firstBloods++;
        if (stat.firstBloodAssist) existing.firstBloodAssists++;
      } else {
        playerAggregates.set(stat.lolPlayerId, {
          playerName: stat.playerName,
          role: stat.role,
          firstBloods: stat.firstBlood ? 1 : 0,
          firstBloodAssists: stat.firstBloodAssist ? 1 : 0,
          total: 1,
        });
      }
    }

    // Calculate first blood participation rate and filter
    const results = Array.from(playerAggregates.entries())
      .filter(([, data]) => data.total >= minGames)
      .map(([playerId, data]) => ({
        playerId,
        playerName: data.playerName,
        role: data.role,
        value: parseFloat((((data.firstBloods + data.firstBloodAssists) / data.total) * 100).toFixed(1)),
        gamesPlayed: data.total,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(offset, offset + limit);

    // Get additional player info
    const playerIds = results.map(r => r.playerId);
    const players = await prisma.lolPlayer.findMany({
      where: { lolPlayerId: { in: playerIds } },
      include: {
        rosterHistory: {
          where: { isActive: true },
          include: { organization: { select: { name: true } } },
          take: 1,
        },
      },
    });

    const playerMap = new Map(players.map(p => [p.lolPlayerId, p]));

    return results.map((entry, index) => {
      const player = playerMap.get(entry.playerId);
      return {
        rank: offset + index + 1,
        playerId: entry.playerId,
        playerName: entry.playerName,
        nationality: player?.nationality || null,
        role: entry.role,
        currentTeam: player?.rosterHistory[0]?.organization?.name || null,
        value: entry.value,
        gamesPlayed: entry.gamesPlayed,
      };
    });
  } catch (error) {
    console.error('[LolLeaderboardService] Error fetching first blood leaderboard:', error);
    throw error;
  }
}

/**
 * Get damage leaderboard (damage per minute or damage share)
 * Filters: season, league, role, minGames, sortBy
 */
async function getDamageLeaderboard(filters: DamageFilters = {}): Promise<LeaderboardEntry[]> {
  const { season, league, role, minGames = 10, sortBy = 'damagePerMin', limit = 50, offset = 0 } = filters;

  try {
    const whereClause = buildWhereClause({ season, league, role });

    // Get game stats with damage data
    const gameStats = await prisma.lolGamePlayerStats.findMany({
      where: {
        ...whereClause,
        lolPlayerId: { not: null },
        damagePerMin: { not: null },
      },
      select: {
        lolPlayerId: true,
        playerName: true,
        role: true,
        damagePerMin: true,
        damageShare: true,
      },
    });

    // Aggregate by player
    const playerAggregates = new Map<string, {
      playerName: string;
      role: string;
      totalDamagePerMin: number;
      totalDamageShare: number;
      count: number;
    }>();

    for (const stat of gameStats) {
      if (!stat.lolPlayerId) continue;

      const existing = playerAggregates.get(stat.lolPlayerId);
      if (existing) {
        existing.totalDamagePerMin += Number(stat.damagePerMin || 0);
        existing.totalDamageShare += Number(stat.damageShare || 0);
        existing.count++;
      } else {
        playerAggregates.set(stat.lolPlayerId, {
          playerName: stat.playerName,
          role: stat.role,
          totalDamagePerMin: Number(stat.damagePerMin || 0),
          totalDamageShare: Number(stat.damageShare || 0),
          count: 1,
        });
      }
    }

    // Calculate averages and filter
    const results = Array.from(playerAggregates.entries())
      .filter(([, data]) => data.count >= minGames)
      .map(([playerId, data]) => {
        const avgDamagePerMin = data.totalDamagePerMin / data.count;
        const avgDamageShare = (data.totalDamageShare / data.count) * 100;

        return {
          playerId,
          playerName: data.playerName,
          role: data.role,
          value: sortBy === 'damagePerMin'
            ? parseFloat(avgDamagePerMin.toFixed(1))
            : parseFloat(avgDamageShare.toFixed(1)),
          gamesPlayed: data.count,
        };
      })
      .sort((a, b) => b.value - a.value)
      .slice(offset, offset + limit);

    // Get additional player info
    const playerIds = results.map(r => r.playerId);
    const players = await prisma.lolPlayer.findMany({
      where: { lolPlayerId: { in: playerIds } },
      include: {
        rosterHistory: {
          where: { isActive: true },
          include: { organization: { select: { name: true } } },
          take: 1,
        },
      },
    });

    const playerMap = new Map(players.map(p => [p.lolPlayerId, p]));

    return results.map((entry, index) => {
      const player = playerMap.get(entry.playerId);
      return {
        rank: offset + index + 1,
        playerId: entry.playerId,
        playerName: entry.playerName,
        nationality: player?.nationality || null,
        role: entry.role,
        currentTeam: player?.rosterHistory[0]?.organization?.name || null,
        value: entry.value,
        gamesPlayed: entry.gamesPlayed,
      };
    });
  } catch (error) {
    console.error('[LolLeaderboardService] Error fetching damage leaderboard:', error);
    throw error;
  }
}

/**
 * Get most championships leaderboard
 * Type: worlds, msi, regional, all
 */
async function getMostChampionships(type: ChampionshipType = 'all'): Promise<ChampionshipLeaderboardEntry[]> {
  try {
    // Get player championships
    const playerSummaries = await prisma.lolPlayerEarningsSummary.findMany({
      where: {
        OR: [
          { worldsWins: { gt: 0 } },
          { msiWins: { gt: 0 } },
        ],
      },
      include: {
        player: {
          include: {
            rosterHistory: {
              where: { isActive: true },
              include: { organization: { select: { region: true } } },
              take: 1,
            },
          },
        },
      },
    });

    // Get org championships
    const orgSummaries = await prisma.lolOrgEarningsSummary.findMany({
      where: {
        OR: [
          { worldsWins: { gt: 0 } },
          { msiWins: { gt: 0 } },
          { regionalTitles: { gt: 0 } },
        ],
      },
      include: {
        organization: {
          select: { name: true, region: true },
        },
      },
    });

    // Build combined leaderboard
    const entries: ChampionshipLeaderboardEntry[] = [];

    // Add players
    for (const summary of playerSummaries) {
      let championships = 0;

      switch (type) {
        case 'worlds':
          championships = summary.worldsWins;
          break;
        case 'msi':
          championships = summary.msiWins;
          break;
        case 'regional':
          // Players don't have regional titles in summary, skip for regional
          continue;
        case 'all':
        default:
          championships = summary.worldsWins + summary.msiWins;
      }

      if (championships > 0) {
        entries.push({
          rank: 0,
          holderId: summary.lolPlayerId,
          holderName: summary.player.currentIgn,
          holderType: 'player',
          region: summary.player.rosterHistory[0]?.organization?.region || null,
          championships,
          worldsWins: summary.worldsWins,
          msiWins: summary.msiWins,
        });
      }
    }

    // Add orgs
    for (const summary of orgSummaries) {
      let championships = 0;

      switch (type) {
        case 'worlds':
          championships = summary.worldsWins;
          break;
        case 'msi':
          championships = summary.msiWins;
          break;
        case 'regional':
          championships = summary.regionalTitles;
          break;
        case 'all':
        default:
          championships = summary.worldsWins + summary.msiWins + summary.regionalTitles;
      }

      if (championships > 0) {
        entries.push({
          rank: 0,
          holderId: summary.orgSlug,
          holderName: summary.organization.name,
          holderType: 'team',
          region: summary.organization.region,
          championships,
          worldsWins: summary.worldsWins,
          msiWins: summary.msiWins,
          regionalTitles: summary.regionalTitles,
        });
      }
    }

    // Sort and add ranks
    entries.sort((a, b) => b.championships - a.championships);

    return entries.map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));
  } catch (error) {
    console.error('[LolLeaderboardService] Error fetching championships leaderboard:', error);
    throw error;
  }
}

// ============== EXPORT SERVICE ==============

export const lolLeaderboardService = {
  getTopEarners,
  getKdaLeaderboard,
  getCsLeaderboard,
  getWinRateLeaderboard,
  getVisionLeaderboard,
  getFirstBloodLeaderboard,
  getDamageLeaderboard,
  getMostChampionships,
};
