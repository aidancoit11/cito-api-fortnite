import { prisma } from '../../db/client.js';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * LoL Esports Analytics Service
 * Provides advanced analytics and insights for LoL esports data
 */

// ============== TYPES ==============

export type PerformanceMetric =
  | 'kda'
  | 'kills'
  | 'deaths'
  | 'assists'
  | 'cs'
  | 'csPerMin'
  | 'gold'
  | 'goldPerMin'
  | 'damageDealt'
  | 'damagePerMin'
  | 'visionScore'
  | 'killParticipation'
  | 'winRate';

export type TimePeriod = '7d' | '30d' | '90d' | '6m' | '1y' | 'all';

export interface PerformanceTrendPoint {
  date: string;
  value: number;
  gameCount: number;
}

export interface PlayerPerformanceTrend {
  playerId: string;
  playerName: string;
  metric: PerformanceMetric;
  period: TimePeriod;
  trend: PerformanceTrendPoint[];
  average: number;
  min: number;
  max: number;
  change: number; // Percentage change from start to end
}

export interface TeamPerformanceTrend {
  teamSlug: string;
  teamName: string;
  metric: PerformanceMetric;
  period: TimePeriod;
  trend: PerformanceTrendPoint[];
  average: number;
  change: number;
}

export interface RoleComparisonEntry {
  playerId: string;
  playerName: string;
  teamSlug: string | null;
  teamName: string | null;
  value: number;
  gameCount: number;
  rank: number;
}

export interface RoleComparison {
  role: string;
  league: string | null;
  metric: PerformanceMetric;
  players: RoleComparisonEntry[];
  average: number;
  median: number;
}

export interface RegionStats {
  region: string;
  teamCount: number;
  playerCount: number;
  avgGameDuration: number | null;
  avgKillsPerGame: number | null;
  avgGoldPerMin: number | null;
  blueWinRate: number | null;
  firstBloodWinRate: number | null;
  firstTowerWinRate: number | null;
  mostPickedChampions: { championName: string; pickCount: number }[];
  mostBannedChampions: { championName: string; banCount: number }[];
}

export interface RegionComparison {
  regions: RegionStats[];
  generatedAt: string;
}

export interface DraftPick {
  pick: number;
  side: 'blue' | 'red';
  championId: number;
  championName: string;
  role: string | null;
  playerName: string | null;
}

export interface DraftBan {
  ban: number;
  side: 'blue' | 'red';
  championId: number;
  championName: string;
}

export interface DraftAnalysis {
  matchId: string;
  gameId: string;
  blueTeam: string;
  redTeam: string;
  winner: string | null;
  blueBans: DraftBan[];
  redBans: DraftBan[];
  bluePicks: DraftPick[];
  redPicks: DraftPick[];
  counterPicks: {
    champion: string;
    countering: string;
    side: 'blue' | 'red';
  }[];
  flexPicks: string[];
  blindPicks: string[];
  comfortPicks: { playerName: string; championName: string; gamesPlayed: number }[];
}

export interface WinCondition {
  condition: string;
  winRate: number;
  occurrences: number;
  description: string;
}

export interface TeamWinConditions {
  teamSlug: string;
  teamName: string;
  totalGames: number;
  wins: number;
  losses: number;
  overallWinRate: number;
  conditions: WinCondition[];
}

export interface PlayerImpactScore {
  playerId: string;
  playerName: string;
  teamSlug: string | null;
  role: string | null;
  impactScore: number; // 0-100 scale
  components: {
    killParticipation: number;
    deathAvoidance: number;
    goldEfficiency: number;
    damageOutput: number;
    visionControl: number;
    objectiveContribution: number;
  };
  percentile: number;
  rank: number;
  totalPlayers: number;
  gamesAnalyzed: number;
}

export interface ClutchFactor {
  playerId: string;
  playerName: string;
  teamSlug: string | null;
  clutchScore: number; // 0-100 scale
  eliminationGames: number;
  eliminationWins: number;
  eliminationWinRate: number;
  avgKdaInElimination: number;
  avgKdaRegular: number;
  performanceIncrease: number; // Percentage increase in elimination games
  notablePerformances: {
    matchId: string;
    tournamentName: string;
    opponent: string;
    kda: number;
    result: 'win' | 'loss';
  }[];
}

// ============== HELPER FUNCTIONS ==============

function getPeriodStartDate(period: TimePeriod): Date {
  const now = new Date();
  switch (period) {
    case '7d':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '30d':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case '90d':
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    case '6m':
      return new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
    case '1y':
      return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    case 'all':
    default:
      return new Date('2010-01-01');
  }
}

function calculatePercentageChange(start: number, end: number): number {
  if (start === 0) return end > 0 ? 100 : 0;
  return ((end - start) / start) * 100;
}

function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function decimalToNumber(value: Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
}

// ============== ANALYTICS FUNCTIONS ==============

/**
 * Get player performance trend over time for a specific metric
 */
async function getPlayerPerformanceTrend(
  playerId: string,
  metric: PerformanceMetric,
  period: TimePeriod
): Promise<PlayerPerformanceTrend | null> {
  try {
    const startDate = getPeriodStartDate(period);

    // Get player info
    const player = await prisma.lolPlayer.findUnique({
      where: { lolPlayerId: playerId },
    });

    if (!player) {
      throw new Error(`Player not found: ${playerId}`);
    }

    // Get all game stats for this player in the period
    const gameStats = await prisma.lolGamePlayerStats.findMany({
      where: {
        lolPlayerId: playerId,
        createdAt: { gte: startDate },
      },
      include: {
        game: {
          include: {
            match: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (gameStats.length === 0) {
      return {
        playerId,
        playerName: player.currentIgn,
        metric,
        period,
        trend: [],
        average: 0,
        min: 0,
        max: 0,
        change: 0,
      };
    }

    // Extract metric values
    const getMetricValue = (stat: typeof gameStats[0]): number => {
      switch (metric) {
        case 'kda':
          return decimalToNumber(stat.kda);
        case 'kills':
          return stat.kills;
        case 'deaths':
          return stat.deaths;
        case 'assists':
          return stat.assists;
        case 'cs':
          return stat.cs;
        case 'csPerMin':
          return decimalToNumber(stat.csPerMin);
        case 'gold':
          return stat.gold;
        case 'goldPerMin':
          return decimalToNumber(stat.goldPerMin);
        case 'damageDealt':
          return stat.damageDealt || 0;
        case 'damagePerMin':
          return decimalToNumber(stat.damagePerMin);
        case 'visionScore':
          return stat.visionScore || 0;
        case 'killParticipation':
          return decimalToNumber(stat.killParticipation) * 100;
        case 'winRate':
          // Calculate win rate per game group
          const isWin = stat.game.winnerSlug === stat.teamSlug;
          return isWin ? 100 : 0;
        default:
          return 0;
      }
    };

    // Group by date and calculate averages
    const dateGroups = new Map<string, number[]>();
    for (const stat of gameStats) {
      const date = stat.createdAt.toISOString().split('T')[0]!;
      if (!dateGroups.has(date)) {
        dateGroups.set(date, []);
      }
      dateGroups.get(date)!.push(getMetricValue(stat));
    }

    const trend: PerformanceTrendPoint[] = [];
    const allValues: number[] = [];

    for (const [date, values] of dateGroups) {
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      trend.push({
        date,
        value: Math.round(avg * 100) / 100,
        gameCount: values.length,
      });
      allValues.push(...values);
    }

    const average = allValues.reduce((a, b) => a + b, 0) / allValues.length;
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const change = trend.length >= 2
      ? calculatePercentageChange(trend[0]!.value, trend[trend.length - 1]!.value)
      : 0;

    return {
      playerId,
      playerName: player.currentIgn,
      metric,
      period,
      trend,
      average: Math.round(average * 100) / 100,
      min: Math.round(min * 100) / 100,
      max: Math.round(max * 100) / 100,
      change: Math.round(change * 100) / 100,
    };
  } catch (error: any) {
    console.error(`[LolAnalytics] Error getting player performance trend:`, error.message);
    throw error;
  }
}

/**
 * Get team performance trend over time
 */
async function getTeamPerformanceTrend(
  teamSlug: string,
  metric: PerformanceMetric,
  period: TimePeriod
): Promise<TeamPerformanceTrend | null> {
  try {
    const startDate = getPeriodStartDate(period);

    // Get team info
    const team = await prisma.lolOrganization.findUnique({
      where: { slug: teamSlug },
    });

    if (!team) {
      throw new Error(`Team not found: ${teamSlug}`);
    }

    // Get all games for this team in the period
    const games = await prisma.lolGame.findMany({
      where: {
        OR: [
          { blueTeamSlug: teamSlug },
          { redTeamSlug: teamSlug },
        ],
        createdAt: { gte: startDate },
      },
      include: {
        playerStats: {
          where: { teamSlug: teamSlug },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (games.length === 0) {
      return {
        teamSlug,
        teamName: team.name,
        metric,
        period,
        trend: [],
        average: 0,
        change: 0,
      };
    }

    // Calculate team-level metrics per game
    const getTeamMetricValue = (game: typeof games[0]): number => {
      const isBlue = game.blueTeamSlug === teamSlug;
      const teamStats = game.playerStats;

      switch (metric) {
        case 'kda': {
          const totalKDA = teamStats.reduce((sum, s) => sum + decimalToNumber(s.kda), 0);
          return teamStats.length > 0 ? totalKDA / teamStats.length : 0;
        }
        case 'kills':
          return isBlue ? (game.blueKills || 0) : (game.redKills || 0);
        case 'gold':
          return isBlue ? (game.blueGold || 0) : (game.redGold || 0);
        case 'goldPerMin': {
          const gold = isBlue ? (game.blueGold || 0) : (game.redGold || 0);
          const duration = game.duration || 1800;
          return (gold / duration) * 60;
        }
        case 'damageDealt': {
          return teamStats.reduce((sum, s) => sum + (s.damageDealt || 0), 0);
        }
        case 'visionScore': {
          return teamStats.reduce((sum, s) => sum + (s.visionScore || 0), 0);
        }
        case 'winRate':
          return game.winnerSlug === teamSlug ? 100 : 0;
        default:
          return 0;
      }
    };

    // Group by date
    const dateGroups = new Map<string, number[]>();
    for (const game of games) {
      const date = game.createdAt.toISOString().split('T')[0]!;
      if (!dateGroups.has(date)) {
        dateGroups.set(date, []);
      }
      dateGroups.get(date)!.push(getTeamMetricValue(game));
    }

    const trend: PerformanceTrendPoint[] = [];
    const allValues: number[] = [];

    for (const [date, values] of dateGroups) {
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      trend.push({
        date,
        value: Math.round(avg * 100) / 100,
        gameCount: values.length,
      });
      allValues.push(...values);
    }

    const average = allValues.reduce((a, b) => a + b, 0) / allValues.length;
    const change = trend.length >= 2
      ? calculatePercentageChange(trend[0]!.value, trend[trend.length - 1]!.value)
      : 0;

    return {
      teamSlug,
      teamName: team.name,
      metric,
      period,
      trend,
      average: Math.round(average * 100) / 100,
      change: Math.round(change * 100) / 100,
    };
  } catch (error: any) {
    console.error(`[LolAnalytics] Error getting team performance trend:`, error.message);
    throw error;
  }
}

/**
 * Compare all players in a specific role across a league
 */
async function getRoleComparison(
  role: string,
  league: string | null,
  metric: PerformanceMetric
): Promise<RoleComparison> {
  try {
    const normalizedRole = role.toLowerCase();
    const roleMap: Record<string, string> = {
      'top': 'Top',
      'jungle': 'Jungle',
      'jng': 'Jungle',
      'mid': 'Mid',
      'middle': 'Mid',
      'adc': 'ADC',
      'bot': 'ADC',
      'support': 'Support',
      'sup': 'Support',
    };

    const dbRole = roleMap[normalizedRole] || role;

    // Build query conditions
    const whereConditions: any = {
      role: dbRole,
    };

    // Get all player stats for this role
    const playerStats = await prisma.lolGamePlayerStats.findMany({
      where: whereConditions,
      include: {
        player: true,
        game: {
          include: {
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
        },
      },
    });

    // Filter by league if specified
    const filteredStats = league
      ? playerStats.filter(s => s.game.match.tournament.league?.slug === league)
      : playerStats;

    // Group by player and calculate averages
    const playerAggregates = new Map<string, {
      playerId: string;
      playerName: string;
      teamSlug: string | null;
      values: number[];
    }>();

    for (const stat of filteredStats) {
      const playerId = stat.lolPlayerId || stat.playerName;
      if (!playerAggregates.has(playerId)) {
        playerAggregates.set(playerId, {
          playerId: stat.lolPlayerId || '',
          playerName: stat.playerName,
          teamSlug: stat.teamSlug,
          values: [],
        });
      }

      let value: number;
      switch (metric) {
        case 'kda':
          value = decimalToNumber(stat.kda);
          break;
        case 'kills':
          value = stat.kills;
          break;
        case 'deaths':
          value = stat.deaths;
          break;
        case 'assists':
          value = stat.assists;
          break;
        case 'cs':
          value = stat.cs;
          break;
        case 'csPerMin':
          value = decimalToNumber(stat.csPerMin);
          break;
        case 'gold':
          value = stat.gold;
          break;
        case 'goldPerMin':
          value = decimalToNumber(stat.goldPerMin);
          break;
        case 'damageDealt':
          value = stat.damageDealt || 0;
          break;
        case 'damagePerMin':
          value = decimalToNumber(stat.damagePerMin);
          break;
        case 'visionScore':
          value = stat.visionScore || 0;
          break;
        case 'killParticipation':
          value = decimalToNumber(stat.killParticipation) * 100;
          break;
        default:
          value = 0;
      }

      playerAggregates.get(playerId)!.values.push(value);
    }

    // Calculate averages and build result
    const players: RoleComparisonEntry[] = [];
    const allAverages: number[] = [];

    for (const [, data] of playerAggregates) {
      if (data.values.length < 3) continue; // Minimum games threshold

      const avg = data.values.reduce((a, b) => a + b, 0) / data.values.length;
      allAverages.push(avg);

      // Get team name
      let teamName: string | null = null;
      if (data.teamSlug) {
        const team = await prisma.lolOrganization.findUnique({
          where: { slug: data.teamSlug },
          select: { name: true },
        });
        teamName = team?.name || null;
      }

      players.push({
        playerId: data.playerId,
        playerName: data.playerName,
        teamSlug: data.teamSlug,
        teamName,
        value: Math.round(avg * 100) / 100,
        gameCount: data.values.length,
        rank: 0, // Will be set after sorting
      });
    }

    // Sort by value (descending for most metrics, ascending for deaths)
    const sortDescending = metric !== 'deaths';
    players.sort((a, b) => sortDescending ? b.value - a.value : a.value - b.value);

    // Assign ranks
    players.forEach((p, i) => {
      p.rank = i + 1;
    });

    const average = allAverages.length > 0
      ? allAverages.reduce((a, b) => a + b, 0) / allAverages.length
      : 0;

    return {
      role: dbRole,
      league,
      metric,
      players: players.slice(0, 50), // Top 50
      average: Math.round(average * 100) / 100,
      median: Math.round(calculateMedian(allAverages) * 100) / 100,
    };
  } catch (error: any) {
    console.error(`[LolAnalytics] Error getting role comparison:`, error.message);
    throw error;
  }
}

/**
 * Get cross-region statistics comparison
 */
async function getRegionComparison(): Promise<RegionComparison> {
  try {
    const regions = ['KR', 'CN', 'EU', 'NA', 'APAC', 'BR', 'LATAM'];
    const regionStats: RegionStats[] = [];

    for (const region of regions) {
      // Get teams in region
      const teams = await prisma.lolOrganization.findMany({
        where: { region },
        select: { slug: true },
      });

      if (teams.length === 0) {
        continue;
      }

      const teamSlugs = teams.map(t => t.slug);

      // Get players in region
      const playerCount = await prisma.lolTeamRoster.count({
        where: {
          orgSlug: { in: teamSlugs },
          status: 'current',
        },
      });

      // Get games for region
      const games = await prisma.lolGame.findMany({
        where: {
          OR: [
            { blueTeamSlug: { in: teamSlugs } },
            { redTeamSlug: { in: teamSlugs } },
          ],
        },
        select: {
          duration: true,
          blueKills: true,
          redKills: true,
          blueGold: true,
          redGold: true,
          winningSide: true,
          firstBlood: true,
          firstTower: true,
          blueBans: true,
          redBans: true,
        },
      });

      // Calculate averages
      let totalDuration = 0;
      let totalKills = 0;
      let totalGold = 0;
      let blueWins = 0;
      let firstBloodWins = 0;
      let firstBloodGames = 0;
      let firstTowerWins = 0;
      let firstTowerGames = 0;

      for (const game of games) {
        if (game.duration) totalDuration += game.duration;
        totalKills += (game.blueKills || 0) + (game.redKills || 0);
        totalGold += (game.blueGold || 0) + (game.redGold || 0);
        if (game.winningSide === 'blue') blueWins++;

        if (game.firstBlood) {
          firstBloodGames++;
          if (game.firstBlood === game.winningSide) firstBloodWins++;
        }
        if (game.firstTower) {
          firstTowerGames++;
          if (game.firstTower === game.winningSide) firstTowerWins++;
        }
      }

      const gameCount = games.length;

      // Get champion pick/ban stats
      const championPicks = await prisma.lolGamePlayerStats.groupBy({
        by: ['championName'],
        where: {
          teamSlug: { in: teamSlugs },
        },
        _count: { championName: true },
        orderBy: { _count: { championName: 'desc' } },
        take: 5,
      });

      // Count bans from game data
      const banCounts = new Map<string, number>();
      for (const game of games) {
        const bans = [
          ...(Array.isArray(game.blueBans) ? game.blueBans : []),
          ...(Array.isArray(game.redBans) ? game.redBans : []),
        ] as string[];
        for (const ban of bans) {
          if (typeof ban === 'string') {
            banCounts.set(ban, (banCounts.get(ban) || 0) + 1);
          }
        }
      }

      const sortedBans = Array.from(banCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      regionStats.push({
        region,
        teamCount: teams.length,
        playerCount,
        avgGameDuration: gameCount > 0 ? Math.round(totalDuration / gameCount) : null,
        avgKillsPerGame: gameCount > 0 ? Math.round((totalKills / gameCount) * 10) / 10 : null,
        avgGoldPerMin: gameCount > 0 && totalDuration > 0
          ? Math.round((totalGold / (totalDuration / 60)) * 10) / 10
          : null,
        blueWinRate: gameCount > 0 ? Math.round((blueWins / gameCount) * 1000) / 10 : null,
        firstBloodWinRate: firstBloodGames > 0
          ? Math.round((firstBloodWins / firstBloodGames) * 1000) / 10
          : null,
        firstTowerWinRate: firstTowerGames > 0
          ? Math.round((firstTowerWins / firstTowerGames) * 1000) / 10
          : null,
        mostPickedChampions: championPicks.map(c => ({
          championName: c.championName,
          pickCount: c._count.championName,
        })),
        mostBannedChampions: sortedBans.map(([name, count]) => ({
          championName: name,
          banCount: count,
        })),
      });
    }

    return {
      regions: regionStats,
      generatedAt: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error(`[LolAnalytics] Error getting region comparison:`, error.message);
    throw error;
  }
}

/**
 * Analyze the draft for a specific match
 */
async function getDraftAnalysis(matchId: string): Promise<DraftAnalysis | null> {
  try {
    // Get the most recent game in the match
    const game = await prisma.lolGame.findFirst({
      where: { matchId },
      include: {
        playerStats: {
          include: {
            player: true,
          },
        },
        match: {
          include: {
            team1: true,
            team2: true,
          },
        },
      },
      orderBy: { gameNumber: 'desc' },
    });

    if (!game) {
      throw new Error(`Match not found: ${matchId}`);
    }

    // Parse bans
    const blueBans: DraftBan[] = [];
    const redBans: DraftBan[] = [];

    if (Array.isArray(game.blueBans)) {
      game.blueBans.forEach((ban, index) => {
        if (typeof ban === 'object' && ban !== null) {
          blueBans.push({
            ban: index + 1,
            side: 'blue',
            championId: (ban as any).championId || 0,
            championName: (ban as any).championName || String(ban),
          });
        }
      });
    }

    if (Array.isArray(game.redBans)) {
      game.redBans.forEach((ban, index) => {
        if (typeof ban === 'object' && ban !== null) {
          redBans.push({
            ban: index + 1,
            side: 'red',
            championId: (ban as any).championId || 0,
            championName: (ban as any).championName || String(ban),
          });
        }
      });
    }

    // Build picks from player stats
    const bluePicks: DraftPick[] = [];
    const redPicks: DraftPick[] = [];

    const blueStats = game.playerStats.filter(s => s.side === 'blue');
    const redStats = game.playerStats.filter(s => s.side === 'red');

    blueStats.forEach((stat, index) => {
      bluePicks.push({
        pick: index + 1,
        side: 'blue',
        championId: stat.championId,
        championName: stat.championName,
        role: stat.role,
        playerName: stat.playerName,
      });
    });

    redStats.forEach((stat, index) => {
      redPicks.push({
        pick: index + 1,
        side: 'red',
        championId: stat.championId,
        championName: stat.championName,
        role: stat.role,
        playerName: stat.playerName,
      });
    });

    // Identify counter picks (simplified - picks that came after opponent's lane)
    const counterPicks: DraftAnalysis['counterPicks'] = [];

    // Identify flex picks (champions that can play multiple roles)
    const flexChampions = ['Ksante', 'Ambessa', 'Aurora', 'Gragas', 'Lee Sin', 'Pantheon', 'Sett'];
    const flexPicks = [...bluePicks, ...redPicks]
      .filter(p => flexChampions.some(fc => p.championName.toLowerCase().includes(fc.toLowerCase())))
      .map(p => p.championName);

    // Identify blind picks (first picks of each phase)
    const blindPicks = [
      bluePicks[0]?.championName,
      redPicks[0]?.championName,
      redPicks[1]?.championName,
    ].filter(Boolean) as string[];

    // Get comfort picks (champions played frequently by these players)
    const comfortPicks: DraftAnalysis['comfortPicks'] = [];

    for (const stat of game.playerStats) {
      if (!stat.lolPlayerId) continue;

      const champStats = await prisma.lolPlayerChampionStats.findFirst({
        where: {
          lolPlayerId: stat.lolPlayerId,
          championId: stat.championId,
        },
      });

      if (champStats && champStats.gamesPlayed >= 5) {
        comfortPicks.push({
          playerName: stat.playerName,
          championName: stat.championName,
          gamesPlayed: champStats.gamesPlayed,
        });
      }
    }

    return {
      matchId,
      gameId: game.gameId,
      blueTeam: game.blueTeamSlug,
      redTeam: game.redTeamSlug,
      winner: game.winnerSlug,
      blueBans,
      redBans,
      bluePicks,
      redPicks,
      counterPicks,
      flexPicks: [...new Set(flexPicks)],
      blindPicks: [...new Set(blindPicks)],
      comfortPicks,
    };
  } catch (error: any) {
    console.error(`[LolAnalytics] Error getting draft analysis:`, error.message);
    throw error;
  }
}

/**
 * Analyze what conditions lead to wins for a team
 */
async function getTeamWinConditions(teamSlug: string): Promise<TeamWinConditions | null> {
  try {
    const team = await prisma.lolOrganization.findUnique({
      where: { slug: teamSlug },
    });

    if (!team) {
      throw new Error(`Team not found: ${teamSlug}`);
    }

    // Get all games for this team
    const games = await prisma.lolGame.findMany({
      where: {
        OR: [
          { blueTeamSlug: teamSlug },
          { redTeamSlug: teamSlug },
        ],
      },
      select: {
        gameId: true,
        blueTeamSlug: true,
        redTeamSlug: true,
        winnerSlug: true,
        duration: true,
        blueKills: true,
        redKills: true,
        blueGold: true,
        redGold: true,
        blueDragons: true,
        redDragons: true,
        blueBarons: true,
        redBarons: true,
        blueTowers: true,
        redTowers: true,
        firstBlood: true,
        firstTower: true,
        firstDragon: true,
        firstBaron: true,
        firstHerald: true,
      },
    });

    if (games.length === 0) {
      return {
        teamSlug,
        teamName: team.name,
        totalGames: 0,
        wins: 0,
        losses: 0,
        overallWinRate: 0,
        conditions: [],
      };
    }

    // Track win conditions
    const conditionStats = {
      firstBlood: { wins: 0, total: 0 },
      firstTower: { wins: 0, total: 0 },
      firstDragon: { wins: 0, total: 0 },
      firstBaron: { wins: 0, total: 0 },
      firstHerald: { wins: 0, total: 0 },
      goldLead15: { wins: 0, total: 0 },
      earlyGame: { wins: 0, total: 0 }, // Games under 25 mins
      lateGame: { wins: 0, total: 0 }, // Games over 35 mins
      teamfightWin: { wins: 0, total: 0 }, // More kills
      objectiveControl: { wins: 0, total: 0 }, // More dragons + barons
    };

    let totalWins = 0;

    for (const game of games) {
      const isBlue = game.blueTeamSlug === teamSlug;
      const isWin = game.winnerSlug === teamSlug;
      const teamSide = isBlue ? 'blue' : 'red';

      if (isWin) totalWins++;

      // First blood
      if (game.firstBlood) {
        conditionStats.firstBlood.total++;
        if (game.firstBlood === teamSide && isWin) {
          conditionStats.firstBlood.wins++;
        }
      }

      // First tower
      if (game.firstTower) {
        conditionStats.firstTower.total++;
        if (game.firstTower === teamSide && isWin) {
          conditionStats.firstTower.wins++;
        }
      }

      // First dragon
      if (game.firstDragon) {
        conditionStats.firstDragon.total++;
        if (game.firstDragon === teamSide && isWin) {
          conditionStats.firstDragon.wins++;
        }
      }

      // First baron
      if (game.firstBaron) {
        conditionStats.firstBaron.total++;
        if (game.firstBaron === teamSide && isWin) {
          conditionStats.firstBaron.wins++;
        }
      }

      // First herald
      if (game.firstHerald) {
        conditionStats.firstHerald.total++;
        if (game.firstHerald === teamSide && isWin) {
          conditionStats.firstHerald.wins++;
        }
      }

      // Game duration
      if (game.duration) {
        if (game.duration < 1500) { // Under 25 mins
          conditionStats.earlyGame.total++;
          if (isWin) conditionStats.earlyGame.wins++;
        } else if (game.duration > 2100) { // Over 35 mins
          conditionStats.lateGame.total++;
          if (isWin) conditionStats.lateGame.wins++;
        }
      }

      // Kill lead (teamfight prowess)
      const teamKills = isBlue ? (game.blueKills || 0) : (game.redKills || 0);
      const enemyKills = isBlue ? (game.redKills || 0) : (game.blueKills || 0);
      if (teamKills > enemyKills) {
        conditionStats.teamfightWin.total++;
        if (isWin) conditionStats.teamfightWin.wins++;
      }

      // Objective control
      const teamObjectives = (isBlue ? (game.blueDragons || 0) : (game.redDragons || 0)) +
        (isBlue ? (game.blueBarons || 0) : (game.redBarons || 0));
      const enemyObjectives = (isBlue ? (game.redDragons || 0) : (game.blueDragons || 0)) +
        (isBlue ? (game.redBarons || 0) : (game.blueBarons || 0));
      if (teamObjectives > enemyObjectives) {
        conditionStats.objectiveControl.total++;
        if (isWin) conditionStats.objectiveControl.wins++;
      }
    }

    // Build conditions array
    const conditions: WinCondition[] = [
      {
        condition: 'First Blood',
        winRate: conditionStats.firstBlood.total > 0
          ? Math.round((conditionStats.firstBlood.wins / conditionStats.firstBlood.total) * 1000) / 10
          : 0,
        occurrences: conditionStats.firstBlood.total,
        description: 'Win rate when securing first blood',
      },
      {
        condition: 'First Tower',
        winRate: conditionStats.firstTower.total > 0
          ? Math.round((conditionStats.firstTower.wins / conditionStats.firstTower.total) * 1000) / 10
          : 0,
        occurrences: conditionStats.firstTower.total,
        description: 'Win rate when taking first tower',
      },
      {
        condition: 'First Dragon',
        winRate: conditionStats.firstDragon.total > 0
          ? Math.round((conditionStats.firstDragon.wins / conditionStats.firstDragon.total) * 1000) / 10
          : 0,
        occurrences: conditionStats.firstDragon.total,
        description: 'Win rate when securing first dragon',
      },
      {
        condition: 'First Baron',
        winRate: conditionStats.firstBaron.total > 0
          ? Math.round((conditionStats.firstBaron.wins / conditionStats.firstBaron.total) * 1000) / 10
          : 0,
        occurrences: conditionStats.firstBaron.total,
        description: 'Win rate when securing first baron',
      },
      {
        condition: 'Early Game (<25 min)',
        winRate: conditionStats.earlyGame.total > 0
          ? Math.round((conditionStats.earlyGame.wins / conditionStats.earlyGame.total) * 1000) / 10
          : 0,
        occurrences: conditionStats.earlyGame.total,
        description: 'Win rate in games that end before 25 minutes',
      },
      {
        condition: 'Late Game (>35 min)',
        winRate: conditionStats.lateGame.total > 0
          ? Math.round((conditionStats.lateGame.wins / conditionStats.lateGame.total) * 1000) / 10
          : 0,
        occurrences: conditionStats.lateGame.total,
        description: 'Win rate in games that go past 35 minutes',
      },
      {
        condition: 'Kill Lead',
        winRate: conditionStats.teamfightWin.total > 0
          ? Math.round((conditionStats.teamfightWin.wins / conditionStats.teamfightWin.total) * 1000) / 10
          : 0,
        occurrences: conditionStats.teamfightWin.total,
        description: 'Win rate when outperforming in kills',
      },
      {
        condition: 'Objective Control',
        winRate: conditionStats.objectiveControl.total > 0
          ? Math.round((conditionStats.objectiveControl.wins / conditionStats.objectiveControl.total) * 1000) / 10
          : 0,
        occurrences: conditionStats.objectiveControl.total,
        description: 'Win rate when securing more dragons and barons',
      },
    ];

    // Sort by win rate
    conditions.sort((a, b) => b.winRate - a.winRate);

    return {
      teamSlug,
      teamName: team.name,
      totalGames: games.length,
      wins: totalWins,
      losses: games.length - totalWins,
      overallWinRate: Math.round((totalWins / games.length) * 1000) / 10,
      conditions,
    };
  } catch (error: any) {
    console.error(`[LolAnalytics] Error getting team win conditions:`, error.message);
    throw error;
  }
}

/**
 * Calculate a player's overall impact score
 */
async function getPlayerImpactScore(playerId: string): Promise<PlayerImpactScore | null> {
  try {
    const player = await prisma.lolPlayer.findUnique({
      where: { lolPlayerId: playerId },
      include: {
        rosterHistory: {
          where: { status: 'current' },
          take: 1,
        },
      },
    });

    if (!player) {
      throw new Error(`Player not found: ${playerId}`);
    }

    // Get player's recent game stats
    const stats = await prisma.lolGamePlayerStats.findMany({
      where: { lolPlayerId: playerId },
      include: {
        game: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    if (stats.length === 0) {
      return {
        playerId,
        playerName: player.currentIgn,
        teamSlug: player.rosterHistory[0]?.orgSlug || null,
        role: player.role,
        impactScore: 0,
        components: {
          killParticipation: 0,
          deathAvoidance: 0,
          goldEfficiency: 0,
          damageOutput: 0,
          visionControl: 0,
          objectiveContribution: 0,
        },
        percentile: 0,
        rank: 0,
        totalPlayers: 0,
        gamesAnalyzed: 0,
      };
    }

    // Calculate component scores (normalized to 0-100)
    const avgKP = stats.reduce((sum, s) => sum + decimalToNumber(s.killParticipation), 0) / stats.length;
    const avgDeaths = stats.reduce((sum, s) => sum + s.deaths, 0) / stats.length;
    const avgGoldShare = stats.reduce((sum, s) => sum + decimalToNumber(s.goldShare), 0) / stats.length;
    const avgDamageShare = stats.reduce((sum, s) => sum + decimalToNumber(s.damageShare), 0) / stats.length;
    const avgVision = stats.reduce((sum, s) => sum + (s.visionScore || 0), 0) / stats.length;

    // Normalize scores
    const killParticipation = Math.min(avgKP * 100, 100);
    const deathAvoidance = Math.max(0, 100 - (avgDeaths * 15)); // Fewer deaths = higher score
    const goldEfficiency = avgGoldShare * 100 * 4; // Scale up since max is ~25%
    const damageOutput = avgDamageShare * 100 * 4;
    const visionControl = Math.min(avgVision * 2, 100); // Scale vision score

    // Calculate objective contribution based on game outcomes
    let objectiveContribution = 50; // Default neutral
    const wins = stats.filter(s => s.game.winnerSlug === s.teamSlug).length;
    const winRate = wins / stats.length;
    objectiveContribution = winRate * 100;

    // Calculate overall impact score (weighted average)
    const weights = {
      killParticipation: 0.25,
      deathAvoidance: 0.15,
      goldEfficiency: 0.15,
      damageOutput: 0.20,
      visionControl: 0.10,
      objectiveContribution: 0.15,
    };

    const impactScore = Math.round(
      killParticipation * weights.killParticipation +
      deathAvoidance * weights.deathAvoidance +
      goldEfficiency * weights.goldEfficiency +
      damageOutput * weights.damageOutput +
      visionControl * weights.visionControl +
      objectiveContribution * weights.objectiveContribution
    );

    // Get ranking among all players
    const allPlayers = await prisma.lolPlayer.findMany({
      where: { isActive: true },
      select: { lolPlayerId: true },
    });

    // Simplified percentile calculation
    const percentile = Math.round((impactScore / 100) * 100);
    const rank = Math.round((1 - impactScore / 100) * allPlayers.length) + 1;

    return {
      playerId,
      playerName: player.currentIgn,
      teamSlug: player.rosterHistory[0]?.orgSlug || null,
      role: player.role,
      impactScore,
      components: {
        killParticipation: Math.round(killParticipation * 10) / 10,
        deathAvoidance: Math.round(deathAvoidance * 10) / 10,
        goldEfficiency: Math.round(goldEfficiency * 10) / 10,
        damageOutput: Math.round(damageOutput * 10) / 10,
        visionControl: Math.round(visionControl * 10) / 10,
        objectiveContribution: Math.round(objectiveContribution * 10) / 10,
      },
      percentile,
      rank,
      totalPlayers: allPlayers.length,
      gamesAnalyzed: stats.length,
    };
  } catch (error: any) {
    console.error(`[LolAnalytics] Error getting player impact score:`, error.message);
    throw error;
  }
}

/**
 * Calculate a player's clutch factor (performance in elimination games)
 */
async function getClutchFactor(playerId: string): Promise<ClutchFactor | null> {
  try {
    const player = await prisma.lolPlayer.findUnique({
      where: { lolPlayerId: playerId },
      include: {
        rosterHistory: {
          where: { status: 'current' },
          take: 1,
        },
      },
    });

    if (!player) {
      throw new Error(`Player not found: ${playerId}`);
    }

    // Get all game stats for this player
    const allStats = await prisma.lolGamePlayerStats.findMany({
      where: { lolPlayerId: playerId },
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
    });

    if (allStats.length === 0) {
      return {
        playerId,
        playerName: player.currentIgn,
        teamSlug: player.rosterHistory[0]?.orgSlug || null,
        clutchScore: 0,
        eliminationGames: 0,
        eliminationWins: 0,
        eliminationWinRate: 0,
        avgKdaInElimination: 0,
        avgKdaRegular: 0,
        performanceIncrease: 0,
        notablePerformances: [],
      };
    }

    // Identify elimination games (finals, semifinals, deciding games in Bo5)
    const eliminationKeywords = ['final', 'semifinal', 'elimination', 'knockout', 'decider'];
    const eliminationStats = allStats.filter(stat => {
      const round = stat.game.match.round?.toLowerCase() || '';
      const blockName = stat.game.match.blockName?.toLowerCase() || '';
      return eliminationKeywords.some(kw => round.includes(kw) || blockName.includes(kw));
    });

    const regularStats = allStats.filter(stat => !eliminationStats.includes(stat));

    // Calculate KDA averages
    const calcAvgKda = (stats: typeof allStats) => {
      if (stats.length === 0) return 0;
      return stats.reduce((sum, s) => sum + decimalToNumber(s.kda), 0) / stats.length;
    };

    const avgKdaElimination = calcAvgKda(eliminationStats);
    const avgKdaRegular = calcAvgKda(regularStats);

    // Calculate win rates
    const eliminationWins = eliminationStats.filter(s => s.game.winnerSlug === s.teamSlug).length;
    const eliminationWinRate = eliminationStats.length > 0
      ? (eliminationWins / eliminationStats.length) * 100
      : 0;

    // Calculate performance increase
    const performanceIncrease = avgKdaRegular > 0
      ? ((avgKdaElimination - avgKdaRegular) / avgKdaRegular) * 100
      : 0;

    // Calculate clutch score
    let clutchScore = 50; // Base score

    // Bonus for elimination win rate above 50%
    if (eliminationWinRate > 50) {
      clutchScore += (eliminationWinRate - 50) * 0.5;
    }

    // Bonus for improved performance in elimination games
    if (performanceIncrease > 0) {
      clutchScore += Math.min(performanceIncrease * 0.5, 25);
    }

    // Penalty for worse performance in elimination games
    if (performanceIncrease < 0) {
      clutchScore += Math.max(performanceIncrease * 0.5, -25);
    }

    // Ensure score is in 0-100 range
    clutchScore = Math.max(0, Math.min(100, Math.round(clutchScore)));

    // Get notable performances
    const notablePerformances = eliminationStats
      .filter(s => decimalToNumber(s.kda) >= 4)
      .sort((a, b) => decimalToNumber(b.kda) - decimalToNumber(a.kda))
      .slice(0, 5)
      .map(s => ({
        matchId: s.game.matchId,
        tournamentName: s.game.match.tournament.name,
        opponent: s.teamSlug === s.game.blueTeamSlug ? s.game.redTeamSlug : s.game.blueTeamSlug,
        kda: Math.round(decimalToNumber(s.kda) * 100) / 100,
        result: (s.game.winnerSlug === s.teamSlug ? 'win' : 'loss') as 'win' | 'loss',
      }));

    return {
      playerId,
      playerName: player.currentIgn,
      teamSlug: player.rosterHistory[0]?.orgSlug || null,
      clutchScore,
      eliminationGames: eliminationStats.length,
      eliminationWins,
      eliminationWinRate: Math.round(eliminationWinRate * 10) / 10,
      avgKdaInElimination: Math.round(avgKdaElimination * 100) / 100,
      avgKdaRegular: Math.round(avgKdaRegular * 100) / 100,
      performanceIncrease: Math.round(performanceIncrease * 10) / 10,
      notablePerformances,
    };
  } catch (error: any) {
    console.error(`[LolAnalytics] Error getting clutch factor:`, error.message);
    throw error;
  }
}

// ============== EXPORT SERVICE ==============

export const lolAnalyticsService = {
  getPlayerPerformanceTrend,
  getTeamPerformanceTrend,
  getRoleComparison,
  getRegionComparison,
  getDraftAnalysis,
  getTeamWinConditions,
  getPlayerImpactScore,
  getClutchFactor,
};
