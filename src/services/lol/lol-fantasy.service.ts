import { prisma } from '../../db/client.js';
import { Prisma } from '@prisma/client';

/**
 * LoL Fantasy Service
 * Handles fantasy/projection data for League of Legends esports
 */

// ============== TYPES ==============

export interface FantasyPoints {
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  bonusTenPlusKills: number;
  bonusTripleKill: number;
  bonusQuadraKill: number;
  bonusPentaKill: number;
  bonusFirstBlood: number;
  total: number;
}

export interface PlayerProjection {
  lolPlayerId: string;
  playerName: string;
  teamSlug: string;
  role: string;
  projectedPoints: number;
  confidence: number; // 0-1 confidence score
  breakdown: FantasyPoints;
  recentForm: {
    avgKills: number;
    avgDeaths: number;
    avgAssists: number;
    avgCs: number;
    gamesPlayed: number;
  };
  upcomingMatches: number;
  salary?: number;
}

export interface PlayerFantasyStats {
  lolPlayerId: string;
  playerName: string;
  teamSlug: string;
  role: string;
  totalGames: number;
  totalFantasyPoints: number;
  avgFantasyPoints: number;
  maxFantasyPoints: number;
  minFantasyPoints: number;
  consistency: number; // standard deviation, lower = more consistent
  recentGames: Array<{
    gameId: string;
    date: Date;
    opponent: string;
    fantasyPoints: number;
    kills: number;
    deaths: number;
    assists: number;
    cs: number;
  }>;
  seasonStats: {
    avgKills: number;
    avgDeaths: number;
    avgAssists: number;
    avgCs: number;
    tripleKills: number;
    quadraKills: number;
    pentaKills: number;
    firstBloods: number;
  };
}

export interface LineupPlayer {
  lolPlayerId: string;
  playerName: string;
  teamSlug: string;
  role: string;
  salary: number;
  projectedPoints: number;
  value: number; // points per salary
}

export interface OptimalLineup {
  players: LineupPlayer[];
  totalSalary: number;
  totalProjectedPoints: number;
  remainingBudget: number;
}

export interface ValuePick {
  lolPlayerId: string;
  playerName: string;
  teamSlug: string;
  role: string;
  salary: number;
  projectedPoints: number;
  value: number;
  valueRank: number;
  reason: string;
}

// ============== FANTASY POINT CALCULATION ==============

const FANTASY_POINTS = {
  KILL: 3,
  DEATH: -1,
  ASSIST: 2,
  CS_PER_POINT: 0.02, // 0.02 pts per CS (50 CS = 1 point)
  BONUS_TEN_PLUS_KILLS: 2,
  BONUS_TRIPLE_KILL: 2,
  BONUS_QUADRA_KILL: 5,
  BONUS_PENTA_KILL: 10,
  BONUS_FIRST_BLOOD: 2,
};

/**
 * Calculate fantasy points for a player's game stats
 */
function calculateFantasyPoints(stats: {
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  tripleKills?: number;
  quadraKills?: number;
  pentaKills?: number;
  firstBlood?: boolean;
}): FantasyPoints {
  const killPoints = stats.kills * FANTASY_POINTS.KILL;
  const deathPoints = stats.deaths * FANTASY_POINTS.DEATH;
  const assistPoints = stats.assists * FANTASY_POINTS.ASSIST;
  const csPoints = stats.cs * FANTASY_POINTS.CS_PER_POINT;

  const bonusTenPlusKills = stats.kills >= 10 ? FANTASY_POINTS.BONUS_TEN_PLUS_KILLS : 0;
  const bonusTripleKill = (stats.tripleKills || 0) * FANTASY_POINTS.BONUS_TRIPLE_KILL;
  const bonusQuadraKill = (stats.quadraKills || 0) * FANTASY_POINTS.BONUS_QUADRA_KILL;
  const bonusPentaKill = (stats.pentaKills || 0) * FANTASY_POINTS.BONUS_PENTA_KILL;
  const bonusFirstBlood = stats.firstBlood ? FANTASY_POINTS.BONUS_FIRST_BLOOD : 0;

  const total =
    killPoints +
    deathPoints +
    assistPoints +
    csPoints +
    bonusTenPlusKills +
    bonusTripleKill +
    bonusQuadraKill +
    bonusPentaKill +
    bonusFirstBlood;

  return {
    kills: killPoints,
    deaths: deathPoints,
    assists: assistPoints,
    cs: csPoints,
    bonusTenPlusKills,
    bonusTripleKill,
    bonusQuadraKill,
    bonusPentaKill,
    bonusFirstBlood,
    total: Math.round(total * 100) / 100, // Round to 2 decimal places
  };
}

/**
 * Calculate standard deviation for consistency metric
 */
function calculateStandardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(avgSquaredDiff);
}

/**
 * Generate a salary for a player based on their average fantasy points
 * This is a simple model - real fantasy platforms have more complex salary algorithms
 */
function estimateSalary(avgFantasyPoints: number, role: string): number {
  // Base salary by role (supports typically have lower fantasy output)
  const roleMultiplier: Record<string, number> = {
    Mid: 1.1,
    ADC: 1.1,
    Jungle: 1.0,
    Top: 0.95,
    Support: 0.85,
  };

  const multiplier = roleMultiplier[role] || 1.0;
  const baseSalary = 3000 + avgFantasyPoints * 400 * multiplier;

  // Round to nearest 100
  return Math.round(baseSalary / 100) * 100;
}

// ============== QUERY TYPES ==============

export interface ProjectionsQuery {
  matchweek?: string | number;
  league?: string;
}

export interface FantasyStatsQuery {
  season?: string;
  limit?: string | number;
}

export interface OptimalLineupQuery {
  budget?: string | number;
  matchweek?: string | number;
  league?: string;
}

export interface ValuePicksQuery {
  matchweek?: string | number;
  limit?: string | number;
}

// ============== API METHODS ==============

/**
 * Get player projections for a given matchweek and league
 */
async function getPlayerProjections(
  query: ProjectionsQuery | number,
  legacyLeague?: string
): Promise<PlayerProjection[]> {
  // Handle both object query and legacy positional parameters
  let matchweek: number;
  let league: string | undefined;

  if (typeof query === 'number') {
    matchweek = query;
    league = legacyLeague;
  } else {
    matchweek = parseInt(String(query.matchweek || '1'), 10);
    league = query.league;
  }

  try {
    // Get upcoming matches for the matchweek
    const now = new Date();
    const matchweekStart = new Date(now);
    matchweekStart.setDate(now.getDate() + (matchweek - 1) * 7);
    const matchweekEnd = new Date(matchweekStart);
    matchweekEnd.setDate(matchweekStart.getDate() + 7);

    // Build match query
    const matchWhere: Prisma.LolMatchWhereInput = {
      startTime: {
        gte: matchweekStart,
        lt: matchweekEnd,
      },
      state: 'unstarted',
    };

    if (league) {
      matchWhere.tournament = {
        league: {
          slug: league,
        },
      };
    }

    // Get all matches for the matchweek
    const upcomingMatches = await prisma.lolMatch.findMany({
      where: matchWhere,
      include: {
        team1: true,
        team2: true,
        tournament: {
          include: {
            league: true,
          },
        },
      },
    });

    // Get unique team slugs from matches
    const teamSlugs = new Set<string>();
    upcomingMatches.forEach((match) => {
      teamSlugs.add(match.team1Slug);
      teamSlugs.add(match.team2Slug);
    });

    if (teamSlugs.size === 0) {
      return [];
    }

    // Count matches per team
    const matchCountByTeam = new Map<string, number>();
    upcomingMatches.forEach((match) => {
      matchCountByTeam.set(
        match.team1Slug,
        (matchCountByTeam.get(match.team1Slug) || 0) + 1
      );
      matchCountByTeam.set(
        match.team2Slug,
        (matchCountByTeam.get(match.team2Slug) || 0) + 1
      );
    });

    // Get active roster players from teams with upcoming matches
    const rosters = await prisma.lolTeamRoster.findMany({
      where: {
        orgSlug: { in: Array.from(teamSlugs) },
        isActive: true,
        role: { in: ['Top', 'Jungle', 'Mid', 'ADC', 'Support'] },
      },
      include: {
        player: true,
        organization: true,
      },
    });

    // Get recent game stats for these players (last 10 games)
    const playerIds = rosters
      .filter((r) => r.lolPlayerId)
      .map((r) => r.lolPlayerId as string);

    const recentStats = await prisma.lolGamePlayerStats.findMany({
      where: {
        lolPlayerId: { in: playerIds },
      },
      include: {
        game: {
          include: {
            match: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Group stats by player
    const statsByPlayer = new Map<string, typeof recentStats>();
    recentStats.forEach((stat) => {
      if (!stat.lolPlayerId) return;
      const existing = statsByPlayer.get(stat.lolPlayerId) || [];
      if (existing.length < 10) {
        // Limit to last 10 games
        existing.push(stat);
        statsByPlayer.set(stat.lolPlayerId, existing);
      }
    });

    // Build projections
    const projections: PlayerProjection[] = [];

    for (const roster of rosters) {
      if (!roster.lolPlayerId || !roster.player) continue;

      const playerStats = statsByPlayer.get(roster.lolPlayerId) || [];
      const upcomingMatchCount = matchCountByTeam.get(roster.orgSlug) || 0;

      if (playerStats.length === 0) {
        // No recent stats, use default projection
        projections.push({
          lolPlayerId: roster.lolPlayerId,
          playerName: roster.player.currentIgn,
          teamSlug: roster.orgSlug,
          role: roster.role,
          projectedPoints: 15 * upcomingMatchCount, // Default 15 pts per game
          confidence: 0.3,
          breakdown: {
            kills: 0,
            deaths: 0,
            assists: 0,
            cs: 0,
            bonusTenPlusKills: 0,
            bonusTripleKill: 0,
            bonusQuadraKill: 0,
            bonusPentaKill: 0,
            bonusFirstBlood: 0,
            total: 15,
          },
          recentForm: {
            avgKills: 0,
            avgDeaths: 0,
            avgAssists: 0,
            avgCs: 0,
            gamesPlayed: 0,
          },
          upcomingMatches: upcomingMatchCount,
        });
        continue;
      }

      // Calculate averages from recent games
      const avgKills =
        playerStats.reduce((sum, s) => sum + s.kills, 0) / playerStats.length;
      const avgDeaths =
        playerStats.reduce((sum, s) => sum + s.deaths, 0) / playerStats.length;
      const avgAssists =
        playerStats.reduce((sum, s) => sum + s.assists, 0) / playerStats.length;
      const avgCs = playerStats.reduce((sum, s) => sum + s.cs, 0) / playerStats.length;
      const tripleKillRate =
        playerStats.reduce((sum, s) => sum + (s.tripleKills || 0), 0) /
        playerStats.length;
      const quadraKillRate =
        playerStats.reduce((sum, s) => sum + (s.quadraKills || 0), 0) /
        playerStats.length;
      const pentaKillRate =
        playerStats.reduce((sum, s) => sum + (s.pentaKills || 0), 0) /
        playerStats.length;
      const firstBloodRate =
        playerStats.filter((s) => s.firstBlood).length / playerStats.length;

      // Project fantasy points per game
      const projectedPerGame = calculateFantasyPoints({
        kills: avgKills,
        deaths: avgDeaths,
        assists: avgAssists,
        cs: avgCs,
        tripleKills: tripleKillRate,
        quadraKills: quadraKillRate,
        pentaKills: pentaKillRate,
        firstBlood: firstBloodRate >= 0.5,
      });

      // Confidence based on sample size
      const confidence = Math.min(playerStats.length / 10, 1);

      // Calculate salary
      const salary = estimateSalary(projectedPerGame.total, roster.role);

      projections.push({
        lolPlayerId: roster.lolPlayerId,
        playerName: roster.player.currentIgn,
        teamSlug: roster.orgSlug,
        role: roster.role,
        projectedPoints:
          Math.round(projectedPerGame.total * upcomingMatchCount * 100) / 100,
        confidence,
        breakdown: projectedPerGame,
        recentForm: {
          avgKills: Math.round(avgKills * 100) / 100,
          avgDeaths: Math.round(avgDeaths * 100) / 100,
          avgAssists: Math.round(avgAssists * 100) / 100,
          avgCs: Math.round(avgCs * 100) / 100,
          gamesPlayed: playerStats.length,
        },
        upcomingMatches: upcomingMatchCount,
        salary,
      });
    }

    // Sort by projected points descending
    projections.sort((a, b) => b.projectedPoints - a.projectedPoints);

    return projections;
  } catch (error) {
    console.error('[LolFantasyService] Error getting player projections:', error);
    throw error;
  }
}

/**
 * Get detailed fantasy stats for a specific player
 */
async function getPlayerFantasyStats(
  playerId: string,
  _query?: FantasyStatsQuery
): Promise<PlayerFantasyStats | null> {
  // Query parameter reserved for future filtering (season, limit, etc.)
  try {
    // Get the player
    const player = await prisma.lolPlayer.findUnique({
      where: { lolPlayerId: playerId },
      include: {
        rosterHistory: {
          where: { isActive: true },
          take: 1,
        },
      },
    });

    if (!player) {
      return null;
    }

    // Get all game stats for this player
    const gameStats = await prisma.lolGamePlayerStats.findMany({
      where: { lolPlayerId: playerId },
      include: {
        game: {
          include: {
            match: {
              include: {
                team1: true,
                team2: true,
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
      return {
        lolPlayerId: playerId,
        playerName: player.currentIgn,
        teamSlug: player.rosterHistory[0]?.orgSlug || 'unknown',
        role: player.role || 'unknown',
        totalGames: 0,
        totalFantasyPoints: 0,
        avgFantasyPoints: 0,
        maxFantasyPoints: 0,
        minFantasyPoints: 0,
        consistency: 0,
        recentGames: [],
        seasonStats: {
          avgKills: 0,
          avgDeaths: 0,
          avgAssists: 0,
          avgCs: 0,
          tripleKills: 0,
          quadraKills: 0,
          pentaKills: 0,
          firstBloods: 0,
        },
      };
    }

    // Calculate fantasy points for each game
    const gameFantasyPoints: Array<{
      gameId: string;
      date: Date;
      opponent: string;
      fantasyPoints: number;
      kills: number;
      deaths: number;
      assists: number;
      cs: number;
    }> = [];

    const fantasyPointValues: number[] = [];
    let totalTripleKills = 0;
    let totalQuadraKills = 0;
    let totalPentaKills = 0;
    let totalFirstBloods = 0;

    for (const stat of gameStats) {
      const points = calculateFantasyPoints({
        kills: stat.kills,
        deaths: stat.deaths,
        assists: stat.assists,
        cs: stat.cs,
        tripleKills: stat.tripleKills || 0,
        quadraKills: stat.quadraKills || 0,
        pentaKills: stat.pentaKills || 0,
        firstBlood: stat.firstBlood,
      });

      fantasyPointValues.push(points.total);

      // Determine opponent
      let opponent = 'unknown';
      if (stat.game?.match) {
        opponent =
          stat.teamSlug === stat.game.match.team1Slug
            ? stat.game.match.team2?.name || stat.game.match.team2Slug
            : stat.game.match.team1?.name || stat.game.match.team1Slug;
      }

      gameFantasyPoints.push({
        gameId: stat.gameId,
        date: stat.createdAt,
        opponent,
        fantasyPoints: points.total,
        kills: stat.kills,
        deaths: stat.deaths,
        assists: stat.assists,
        cs: stat.cs,
      });

      totalTripleKills += stat.tripleKills || 0;
      totalQuadraKills += stat.quadraKills || 0;
      totalPentaKills += stat.pentaKills || 0;
      totalFirstBloods += stat.firstBlood ? 1 : 0;
    }

    const totalFantasyPoints = fantasyPointValues.reduce((a, b) => a + b, 0);
    const avgFantasyPoints = totalFantasyPoints / gameStats.length;
    const maxFantasyPoints = Math.max(...fantasyPointValues);
    const minFantasyPoints = Math.min(...fantasyPointValues);
    const consistency = calculateStandardDeviation(fantasyPointValues);

    const avgKills = gameStats.reduce((sum, s) => sum + s.kills, 0) / gameStats.length;
    const avgDeaths = gameStats.reduce((sum, s) => sum + s.deaths, 0) / gameStats.length;
    const avgAssists = gameStats.reduce((sum, s) => sum + s.assists, 0) / gameStats.length;
    const avgCs = gameStats.reduce((sum, s) => sum + s.cs, 0) / gameStats.length;

    return {
      lolPlayerId: playerId,
      playerName: player.currentIgn,
      teamSlug: player.rosterHistory[0]?.orgSlug || gameStats[0]?.teamSlug || 'unknown',
      role: player.role || gameStats[0]?.role || 'unknown',
      totalGames: gameStats.length,
      totalFantasyPoints: Math.round(totalFantasyPoints * 100) / 100,
      avgFantasyPoints: Math.round(avgFantasyPoints * 100) / 100,
      maxFantasyPoints: Math.round(maxFantasyPoints * 100) / 100,
      minFantasyPoints: Math.round(minFantasyPoints * 100) / 100,
      consistency: Math.round(consistency * 100) / 100,
      recentGames: gameFantasyPoints.slice(0, 10), // Last 10 games
      seasonStats: {
        avgKills: Math.round(avgKills * 100) / 100,
        avgDeaths: Math.round(avgDeaths * 100) / 100,
        avgAssists: Math.round(avgAssists * 100) / 100,
        avgCs: Math.round(avgCs * 100) / 100,
        tripleKills: totalTripleKills,
        quadraKills: totalQuadraKills,
        pentaKills: totalPentaKills,
        firstBloods: totalFirstBloods,
      },
    };
  } catch (error) {
    console.error('[LolFantasyService] Error getting player fantasy stats:', error);
    throw error;
  }
}

/**
 * Get optimal lineup given a budget
 * Uses a greedy algorithm to maximize projected points within budget
 */
async function getOptimalLineup(
  query: OptimalLineupQuery | number,
  legacyMatchweek?: number,
  legacyLeague?: string
): Promise<OptimalLineup> {
  // Handle both object query and legacy positional parameters
  let budget: number;
  let matchweek: number;
  let league: string | undefined;

  if (typeof query === 'number') {
    budget = query;
    matchweek = legacyMatchweek || 1;
    league = legacyLeague;
  } else {
    budget = parseInt(String(query.budget || '50000'), 10);
    matchweek = parseInt(String(query.matchweek || '1'), 10);
    league = query.league;
  }

  try {
    // Get projections for the matchweek
    const projections = await getPlayerProjections(matchweek, league);

    if (projections.length === 0) {
      return {
        players: [],
        totalSalary: 0,
        totalProjectedPoints: 0,
        remainingBudget: budget,
      };
    }

    // We need to fill 5 roster spots: Top, Jungle, Mid, ADC, Support
    const requiredRoles = ['Top', 'Jungle', 'Mid', 'ADC', 'Support'];

    // Group players by role
    const playersByRole = new Map<string, PlayerProjection[]>();
    for (const role of requiredRoles) {
      playersByRole.set(role, []);
    }
    for (const projection of projections) {
      const roleList = playersByRole.get(projection.role);
      if (roleList && projection.salary) {
        roleList.push(projection);
      }
    }

    // Sort each role by value (points per salary)
    for (const role of requiredRoles) {
      const players = playersByRole.get(role);
      if (players) {
        players.sort((a, b) => {
          const valueA = a.projectedPoints / (a.salary || 1);
          const valueB = b.projectedPoints / (b.salary || 1);
          return valueB - valueA;
        });
      }
    }

    // Greedy selection with budget constraint
    const selectedPlayers: LineupPlayer[] = [];
    let remainingBudget = budget;

    // First pass: select best value player for each role that fits budget
    for (const role of requiredRoles) {
      const players = playersByRole.get(role) || [];
      const affordable = players.filter((p) => (p.salary || 0) <= remainingBudget);
      const selected = affordable[0];

      if (selected) {
        selectedPlayers.push({
          lolPlayerId: selected.lolPlayerId,
          playerName: selected.playerName,
          teamSlug: selected.teamSlug,
          role: selected.role,
          salary: selected.salary || 0,
          projectedPoints: selected.projectedPoints,
          value: selected.projectedPoints / (selected.salary || 1),
        });
        remainingBudget -= selected.salary || 0;
      }
    }

    // Second pass: try to upgrade players if we have budget remaining
    // Sort selected by value ascending (worst value first)
    selectedPlayers.sort((a, b) => a.value - b.value);

    for (let i = 0; i < selectedPlayers.length; i++) {
      const current = selectedPlayers[i];
      if (!current) continue;

      const players = playersByRole.get(current.role) || [];

      // Find better player that fits within remaining + current salary
      const availableBudget = remainingBudget + current.salary;
      const upgrades = players.filter(
        (p) =>
          (p.salary || 0) <= availableBudget &&
          p.projectedPoints > current.projectedPoints &&
          p.lolPlayerId !== current.lolPlayerId
      );

      // Sort by projected points (maximize points)
      upgrades.sort((a, b) => b.projectedPoints - a.projectedPoints);
      const upgrade = upgrades[0];

      if (upgrade) {
        const newSalary = upgrade.salary || 0;
        remainingBudget = availableBudget - newSalary;

        selectedPlayers[i] = {
          lolPlayerId: upgrade.lolPlayerId,
          playerName: upgrade.playerName,
          teamSlug: upgrade.teamSlug,
          role: upgrade.role,
          salary: newSalary,
          projectedPoints: upgrade.projectedPoints,
          value: upgrade.projectedPoints / (newSalary || 1),
        };
      }
    }

    // Sort final lineup by role order
    const roleOrder = { Top: 1, Jungle: 2, Mid: 3, ADC: 4, Support: 5 };
    selectedPlayers.sort(
      (a, b) =>
        (roleOrder[a.role as keyof typeof roleOrder] || 6) -
        (roleOrder[b.role as keyof typeof roleOrder] || 6)
    );

    const totalSalary = selectedPlayers.reduce((sum, p) => sum + p.salary, 0);
    const totalProjectedPoints = selectedPlayers.reduce(
      (sum, p) => sum + p.projectedPoints,
      0
    );

    return {
      players: selectedPlayers,
      totalSalary,
      totalProjectedPoints: Math.round(totalProjectedPoints * 100) / 100,
      remainingBudget: budget - totalSalary,
    };
  } catch (error) {
    console.error('[LolFantasyService] Error getting optimal lineup:', error);
    throw error;
  }
}

/**
 * Get value picks for a matchweek
 * These are players with high projected points relative to their salary
 */
async function getValuePicks(
  query: ValuePicksQuery | number,
  legacyLimit?: number
): Promise<ValuePick[]> {
  // Handle both object query and legacy positional parameters
  let matchweek: number;
  let limit: number;

  if (typeof query === 'number') {
    matchweek = query;
    limit = legacyLimit || 10;
  } else {
    matchweek = parseInt(String(query.matchweek || '1'), 10);
    limit = parseInt(String(query.limit || '10'), 10);
  }

  try {
    const projections = await getPlayerProjections(matchweek);

    if (projections.length === 0) {
      return [];
    }

    // Filter players with salary and calculate value
    const playersWithValue = projections
      .filter((p) => p.salary && p.salary > 0)
      .map((p) => ({
        lolPlayerId: p.lolPlayerId,
        playerName: p.playerName,
        teamSlug: p.teamSlug,
        role: p.role,
        salary: p.salary!,
        projectedPoints: p.projectedPoints,
        value: p.projectedPoints / p.salary!,
        confidence: p.confidence,
        upcomingMatches: p.upcomingMatches,
      }));

    // Sort by value (points per salary)
    playersWithValue.sort((a, b) => b.value - a.value);

    // Build value picks with reasons
    const valuePicks: ValuePick[] = playersWithValue.slice(0, limit).map((p, index) => {
      let reason = '';

      if (p.upcomingMatches >= 2) {
        reason = `${p.upcomingMatches} matches this week provide high floor`;
      } else if (p.value > 0.003) {
        reason = 'Elite points-per-dollar efficiency';
      } else if (p.confidence >= 0.8) {
        reason = 'Highly consistent performer based on recent form';
      } else {
        reason = 'Strong projected output relative to salary';
      }

      return {
        lolPlayerId: p.lolPlayerId,
        playerName: p.playerName,
        teamSlug: p.teamSlug,
        role: p.role,
        salary: p.salary,
        projectedPoints: p.projectedPoints,
        value: Math.round(p.value * 10000) / 10000, // 4 decimal places
        valueRank: index + 1,
        reason,
      };
    });

    return valuePicks;
  } catch (error) {
    console.error('[LolFantasyService] Error getting value picks:', error);
    throw error;
  }
}

// ============== NAMED EXPORTS ==============

// Export individual functions for `import * as` usage
export { getPlayerProjections, getPlayerFantasyStats, getOptimalLineup, getValuePicks };

// Also export as a service object for flexibility
export const lolFantasyService = {
  // Core fantasy methods
  getPlayerProjections,
  getPlayerFantasyStats,
  getOptimalLineup,
  getValuePicks,

  // Utility exports
  calculateFantasyPoints,
  FANTASY_POINTS,
};
