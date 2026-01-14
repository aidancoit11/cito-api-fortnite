import { prisma } from '../../db/client.js';
import type { Prisma } from '@prisma/client';

/**
 * League of Legends Player Service
 * Handles all player-related operations including stats, earnings, team history, and comparisons
 */

// ========== INTERFACES ==========

export interface LolPlayerFilters {
  team?: string;
  role?: 'Top' | 'Jungle' | 'Mid' | 'ADC' | 'Support';
  region?: string;
  nationality?: string;
  active?: boolean;
  freeAgent?: boolean;
  search?: string;
  sort?: 'ign' | 'earnings' | 'games' | 'winRate' | 'kda';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface LolPlayerListResult {
  lolPlayerId: string;
  currentIgn: string;
  realName: string | null;
  role: string | null;
  nationality: string | null;
  imageUrl: string | null;
  isActive: boolean;
  isFreeAgent: boolean;
  currentTeam: string | null;
  currentTeamSlug: string | null;
  totalEarnings: number | null;
}

export interface LolPlayerSearchResult {
  lolPlayerId: string;
  currentIgn: string;
  realName: string | null;
  role: string | null;
  imageUrl: string | null;
  currentTeam: string | null;
}

export interface LolPlayerDetails extends LolPlayerListResult {
  esportsApiId: string | null;
  riotId: string | null;
  puuid: string | null;
  country: string | null;
  birthDate: Date | null;
  wikiUrl: string | null;
  socialMedia: any;
  createdAt: Date;
  lastUpdated: Date;
}

export interface LolPlayerStatsFilters {
  season?: string;
  tournament?: string;
  team?: string;
  champion?: string | number;
  league?: string;
}

export interface LolPlayerStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  avgKda: number;
  avgCs: number;
  avgCsPerMin: number;
  avgGold: number;
  avgGoldPerMin: number;
  avgDamage: number;
  avgDamagePerMin: number;
  avgVisionScore: number;
  killParticipation: number;
  firstBloodRate: number;
  pentaKills: number;
  quadraKills: number;
  tripleKills: number;
}

export interface LolPlayerCareerStats extends LolPlayerStats {
  totalGamesPlayed: number;
  careerLengthYears: number;
  teamsPlayed: number;
  leaguesPlayed: string[];
  tournamentsPlayed: number;
  internationalAppearances: number;
  worldsAppearances: number;
  msiAppearances: number;
}

export interface LolPlayerEarningsEntry {
  tournamentId: string;
  tournamentName: string;
  tournamentDate: Date;
  placement: number;
  earnings: number;
  prizePool: number | null;
  tier: string | null;
  league: string | null;
  teamSize: number;
  teammates: any;
  orgSlugAtTime: string | null;
}

export interface LolPlayerEarningsSummaryResult {
  totalEarnings: number;
  tournamentCount: number;
  firstPlaceCount: number;
  top3Count: number;
  avgPlacement: number | null;
  bestPlacement: number | null;
  highestEarning: number | null;
  earningsByYear: Record<string, number>;
  earningsByLeague: Record<string, number>;
  worldsAppearances: number;
  worldsWins: number;
  msiAppearances: number;
  msiWins: number;
}

export interface LolPlayerTeamHistoryEntry {
  orgSlug: string;
  teamName: string;
  role: string;
  status: string;
  joinDate: Date | null;
  leaveDate: Date | null;
  leaveReason: string | null;
  isStarter: boolean;
  logoUrl: string | null;
}

export interface LolPlayerMatchEntry {
  matchId: string;
  tournamentId: string;
  tournamentName: string | null;
  team1Slug: string;
  team2Slug: string;
  team1Score: number | null;
  team2Score: number | null;
  winnerSlug: string | null;
  startTime: Date | null;
  strategy: string | null;
  playerTeamSlug: string;
  result: 'win' | 'loss' | 'unknown';
}

export interface LolPlayerChampionEntry {
  championId: number;
  championName: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  avgKills: number | null;
  avgDeaths: number | null;
  avgAssists: number | null;
  avgKda: number | null;
  avgCs: number | null;
  avgGold: number | null;
}

export interface LolPlayerAchievements {
  championships: {
    tournamentId: string;
    tournamentName: string;
    tournamentDate: Date;
    placement: number;
    tier: string | null;
    league: string | null;
    isInternational: boolean;
  }[];
  mvpAwards: {
    tournamentId: string;
    tournamentName: string;
    award: string;
  }[];
  worldsAppearances: number;
  worldsWins: number;
  msiAppearances: number;
  msiWins: number;
  regionalTitles: number;
  allProSelections: number;
}

export interface LolPlayerComparison {
  player1: LolPlayerDetails;
  player2: LolPlayerDetails;
  stats1: LolPlayerStats;
  stats2: LolPlayerStats;
  earnings1: LolPlayerEarningsSummaryResult;
  earnings2: LolPlayerEarningsSummaryResult;
  headToHead?: {
    player1Wins: number;
    player2Wins: number;
    totalGames: number;
  };
}

export interface LolPlayerPeer {
  lolPlayerId: string;
  currentIgn: string;
  role: string | null;
  imageUrl: string | null;
  currentTeam: string | null;
  similarity: number;
  sharedTeams: string[];
  similarStats: boolean;
}

// ========== SERVICE FUNCTIONS ==========

/**
 * Get all players with filters
 */
async function getAllPlayers(filters: LolPlayerFilters = {}): Promise<{
  players: LolPlayerListResult[];
  total: number;
}> {
  const {
    team,
    role,
    region,
    nationality,
    active,
    freeAgent,
    search,
    sort = 'ign',
    sortOrder = 'asc',
    limit = 50,
    offset = 0,
  } = filters;

  const where: Prisma.LolPlayerWhereInput = {};

  // Filter by active status
  if (active !== undefined) {
    where.isActive = active;
  }

  // Filter by free agent status
  if (freeAgent !== undefined) {
    where.isFreeAgent = freeAgent;
  }

  // Filter by role
  if (role) {
    where.role = role;
  }

  // Filter by nationality
  if (nationality) {
    where.nationality = nationality.toUpperCase();
  }

  // Filter by search term
  if (search) {
    where.OR = [
      { currentIgn: { contains: search, mode: 'insensitive' } },
      { realName: { contains: search, mode: 'insensitive' } },
    ];
  }

  // Filter by team
  if (team) {
    where.rosterHistory = {
      some: {
        orgSlug: team,
        status: 'current',
      },
    };
  }

  // Filter by region (through current team)
  if (region) {
    where.rosterHistory = {
      some: {
        status: 'current',
        organization: {
          region: region,
        },
      },
    };
  }

  // Build orderBy
  let orderBy: Prisma.LolPlayerOrderByWithRelationInput = { currentIgn: sortOrder };
  if (sort === 'games') {
    orderBy = { gameStats: { _count: sortOrder } };
  }

  const [players, total] = await Promise.all([
    prisma.lolPlayer.findMany({
      where,
      include: {
        rosterHistory: {
          where: { status: 'current' },
          include: { organization: true },
          take: 1,
        },
        earningsSummary: true,
      },
      take: limit,
      skip: offset,
      orderBy,
    }),
    prisma.lolPlayer.count({ where }),
  ]);

  // Sort by earnings or other computed fields
  let results = players.map((player) => {
    const currentRoster = player.rosterHistory[0];
    return {
      lolPlayerId: player.lolPlayerId,
      currentIgn: player.currentIgn,
      realName: player.realName,
      role: player.role,
      nationality: player.nationality,
      imageUrl: player.imageUrl,
      isActive: player.isActive,
      isFreeAgent: player.isFreeAgent,
      currentTeam: currentRoster?.organization.name || null,
      currentTeamSlug: currentRoster?.orgSlug || null,
      totalEarnings: player.earningsSummary
        ? Number(player.earningsSummary.totalEarnings)
        : null,
    };
  });

  // Sort by earnings if requested
  if (sort === 'earnings') {
    results.sort((a, b) => {
      const aEarnings = a.totalEarnings || 0;
      const bEarnings = b.totalEarnings || 0;
      return sortOrder === 'desc' ? bEarnings - aEarnings : aEarnings - bEarnings;
    });
  }

  return { players: results, total };
}

/**
 * Search players for autocomplete
 */
async function searchPlayers(
  query: string,
  options?: { limit?: number }
): Promise<LolPlayerSearchResult[]> {
  const { limit = 10 } = options || {};

  if (!query || query.length < 2) {
    return [];
  }

  const players = await prisma.lolPlayer.findMany({
    where: {
      OR: [
        { currentIgn: { contains: query, mode: 'insensitive' } },
        { realName: { contains: query, mode: 'insensitive' } },
      ],
    },
    include: {
      rosterHistory: {
        where: { status: 'current' },
        include: { organization: true },
        take: 1,
      },
    },
    take: limit,
    orderBy: { currentIgn: 'asc' },
  });

  return players.map((player) => ({
    lolPlayerId: player.lolPlayerId,
    currentIgn: player.currentIgn,
    realName: player.realName,
    role: player.role,
    imageUrl: player.imageUrl,
    currentTeam: player.rosterHistory[0]?.organization.name || null,
  }));
}

/**
 * Get player by ID
 */
async function getPlayerById(playerId: string): Promise<LolPlayerDetails | null> {
  const player = await prisma.lolPlayer.findUnique({
    where: { lolPlayerId: playerId },
    include: {
      rosterHistory: {
        where: { status: 'current' },
        include: { organization: true },
        take: 1,
      },
      earningsSummary: true,
    },
  });

  if (!player) {
    return null;
  }

  const currentRoster = player.rosterHistory[0];

  return {
    lolPlayerId: player.lolPlayerId,
    esportsApiId: player.esportsApiId,
    riotId: player.riotId,
    puuid: player.puuid,
    currentIgn: player.currentIgn,
    realName: player.realName,
    nationality: player.nationality,
    country: player.country,
    birthDate: player.birthDate,
    role: player.role,
    wikiUrl: player.wikiUrl,
    imageUrl: player.imageUrl,
    socialMedia: player.socialMedia,
    isActive: player.isActive,
    isFreeAgent: player.isFreeAgent,
    currentTeam: currentRoster?.organization.name || null,
    currentTeamSlug: currentRoster?.orgSlug || null,
    totalEarnings: player.earningsSummary
      ? Number(player.earningsSummary.totalEarnings)
      : null,
    createdAt: player.createdAt,
    lastUpdated: player.lastUpdated,
  };
}

/**
 * Get player stats with filters
 */
async function getPlayerStats(
  playerId: string,
  filters: LolPlayerStatsFilters = {}
): Promise<LolPlayerStats | null> {
  const { season, tournament, team, champion, league } = filters;

  // Build where clause for game stats
  const where: Prisma.LolGamePlayerStatsWhereInput = {
    lolPlayerId: playerId,
  };

  if (team) {
    where.teamSlug = team;
  }

  if (champion) {
    if (typeof champion === 'number') {
      where.championId = champion;
    } else {
      where.championName = { equals: champion, mode: 'insensitive' };
    }
  }

  // Filter by tournament or season through game -> match -> tournament
  if (tournament || season || league) {
    where.game = {
      match: {
        tournament: {
          ...(tournament && { tournamentId: tournament }),
          ...(season && { slug: { contains: season, mode: 'insensitive' } }),
          ...(league && { league: { slug: league } }),
        },
      },
    };
  }

  const stats = await prisma.lolGamePlayerStats.findMany({
    where,
    include: {
      game: {
        select: {
          duration: true,
          winnerSlug: true,
        },
      },
    },
  });

  if (stats.length === 0) {
    return null;
  }

  // Calculate aggregated stats
  const gamesPlayed = stats.length;
  const wins = stats.filter((s) => s.game.winnerSlug === s.teamSlug).length;
  const losses = gamesPlayed - wins;

  const totalKills = stats.reduce((sum, s) => sum + s.kills, 0);
  const totalDeaths = stats.reduce((sum, s) => sum + s.deaths, 0);
  const totalAssists = stats.reduce((sum, s) => sum + s.assists, 0);
  const totalCs = stats.reduce((sum, s) => sum + s.cs, 0);
  const totalGold = stats.reduce((sum, s) => sum + s.gold, 0);
  const totalDamage = stats.reduce((sum, s) => sum + (s.damageDealt || 0), 0);
  const totalVision = stats.reduce((sum, s) => sum + (s.visionScore || 0), 0);
  const totalFirstBloods = stats.filter((s) => s.firstBlood).length;
  const totalPentaKills = stats.reduce((sum, s) => sum + (s.pentaKills || 0), 0);
  const totalQuadraKills = stats.reduce((sum, s) => sum + (s.quadraKills || 0), 0);
  const totalTripleKills = stats.reduce((sum, s) => sum + (s.tripleKills || 0), 0);

  // Calculate game minutes for per-minute stats
  const totalMinutes = stats.reduce((sum, s) => sum + (s.game.duration || 0) / 60, 0);

  // Calculate kill participation
  const killParticipations = stats
    .filter((s) => s.killParticipation !== null)
    .map((s) => Number(s.killParticipation));
  const avgKillParticipation =
    killParticipations.length > 0
      ? killParticipations.reduce((sum, kp) => sum + kp, 0) / killParticipations.length
      : 0;

  return {
    gamesPlayed,
    wins,
    losses,
    winRate: gamesPlayed > 0 ? wins / gamesPlayed : 0,
    avgKills: gamesPlayed > 0 ? totalKills / gamesPlayed : 0,
    avgDeaths: gamesPlayed > 0 ? totalDeaths / gamesPlayed : 0,
    avgAssists: gamesPlayed > 0 ? totalAssists / gamesPlayed : 0,
    avgKda:
      totalDeaths > 0
        ? (totalKills + totalAssists) / totalDeaths
        : totalKills + totalAssists,
    avgCs: gamesPlayed > 0 ? totalCs / gamesPlayed : 0,
    avgCsPerMin: totalMinutes > 0 ? totalCs / totalMinutes : 0,
    avgGold: gamesPlayed > 0 ? totalGold / gamesPlayed : 0,
    avgGoldPerMin: totalMinutes > 0 ? totalGold / totalMinutes : 0,
    avgDamage: gamesPlayed > 0 ? totalDamage / gamesPlayed : 0,
    avgDamagePerMin: totalMinutes > 0 ? totalDamage / totalMinutes : 0,
    avgVisionScore: gamesPlayed > 0 ? totalVision / gamesPlayed : 0,
    killParticipation: avgKillParticipation,
    firstBloodRate: gamesPlayed > 0 ? totalFirstBloods / gamesPlayed : 0,
    pentaKills: totalPentaKills,
    quadraKills: totalQuadraKills,
    tripleKills: totalTripleKills,
  };
}

/**
 * Get aggregated career stats
 */
async function getPlayerCareerStats(playerId: string): Promise<LolPlayerCareerStats | null> {
  const player = await prisma.lolPlayer.findUnique({
    where: { lolPlayerId: playerId },
    include: {
      earningsSummary: true,
    },
  });

  if (!player) {
    return null;
  }

  // Get base stats
  const baseStats = await getPlayerStats(playerId);
  if (!baseStats) {
    return null;
  }

  // Get team history
  const teamHistory = await prisma.lolTeamRoster.findMany({
    where: { lolPlayerId: playerId },
    select: { orgSlug: true },
  });

  // Get tournaments played
  const tournaments = await prisma.lolPlayerTournamentEarning.findMany({
    where: { lolPlayerId: playerId },
    select: {
      tournamentId: true,
      tournamentDate: true,
      league: true,
    },
  });

  // Get unique leagues
  const leagues = [...new Set(tournaments.map((t) => t.league).filter(Boolean))] as string[];

  // Calculate career length
  const tournamentDates = tournaments
    .map((t) => t.tournamentDate)
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime());
  const careerLengthYears =
    tournamentDates.length >= 2
      ? (tournamentDates[tournamentDates.length - 1]!.getTime() -
          tournamentDates[0]!.getTime()) /
        (365 * 24 * 60 * 60 * 1000)
      : 0;

  // Count international appearances (Worlds, MSI)
  const internationalTournaments = tournaments.filter((t) =>
    ['worlds', 'msi', 'mid-season'].some((keyword) =>
      t.tournamentId.toLowerCase().includes(keyword)
    )
  );

  return {
    ...baseStats,
    totalGamesPlayed: baseStats.gamesPlayed,
    careerLengthYears: Math.round(careerLengthYears * 10) / 10,
    teamsPlayed: new Set(teamHistory.map((t) => t.orgSlug)).size,
    leaguesPlayed: leagues,
    tournamentsPlayed: tournaments.length,
    internationalAppearances: internationalTournaments.length,
    worldsAppearances: player.earningsSummary?.worldsAppearances || 0,
    msiAppearances: player.earningsSummary?.msiAppearances || 0,
  };
}

/**
 * Get player earnings history
 */
async function getPlayerEarnings(
  playerId: string,
  options?: { limit?: number; offset?: number }
): Promise<LolPlayerEarningsEntry[]> {
  const { limit = 50, offset = 0 } = options || {};

  const earnings = await prisma.lolPlayerTournamentEarning.findMany({
    where: { lolPlayerId: playerId },
    orderBy: { tournamentDate: 'desc' },
    take: limit,
    skip: offset,
  });

  return earnings.map((e) => ({
    tournamentId: e.tournamentId,
    tournamentName: e.tournamentName,
    tournamentDate: e.tournamentDate,
    placement: e.placement,
    earnings: Number(e.earnings),
    prizePool: e.prizePool ? Number(e.prizePool) : null,
    tier: e.tier,
    league: e.league,
    teamSize: e.teamSize,
    teammates: e.teammates,
    orgSlugAtTime: e.orgSlugAtTime,
  }));
}

/**
 * Get aggregated earnings summary
 */
async function getPlayerEarningsSummary(
  playerId: string
): Promise<LolPlayerEarningsSummaryResult | null> {
  const summary = await prisma.lolPlayerEarningsSummary.findUnique({
    where: { lolPlayerId: playerId },
  });

  if (!summary) {
    // Calculate from tournament earnings
    const earnings = await prisma.lolPlayerTournamentEarning.findMany({
      where: { lolPlayerId: playerId },
    });

    if (earnings.length === 0) {
      return null;
    }

    const totalEarnings = earnings.reduce((sum, e) => sum + Number(e.earnings), 0);
    const placements = earnings.map((e) => e.placement);
    const firstPlaceCount = placements.filter((p) => p === 1).length;
    const top3Count = placements.filter((p) => p <= 3).length;
    const avgPlacement = placements.reduce((sum, p) => sum + p, 0) / placements.length;
    const bestPlacement = Math.min(...placements);
    const highestEarning = Math.max(...earnings.map((e) => Number(e.earnings)));

    // Group by year
    const earningsByYear: Record<string, number> = {};
    earnings.forEach((e) => {
      const year = e.tournamentDate.getFullYear().toString();
      earningsByYear[year] = (earningsByYear[year] || 0) + Number(e.earnings);
    });

    // Group by league
    const earningsByLeague: Record<string, number> = {};
    earnings.forEach((e) => {
      if (e.league) {
        earningsByLeague[e.league] = (earningsByLeague[e.league] || 0) + Number(e.earnings);
      }
    });

    return {
      totalEarnings,
      tournamentCount: earnings.length,
      firstPlaceCount,
      top3Count,
      avgPlacement,
      bestPlacement,
      highestEarning,
      earningsByYear,
      earningsByLeague,
      worldsAppearances: 0,
      worldsWins: 0,
      msiAppearances: 0,
      msiWins: 0,
    };
  }

  return {
    totalEarnings: Number(summary.totalEarnings),
    tournamentCount: summary.tournamentCount,
    firstPlaceCount: summary.firstPlaceCount,
    top3Count: summary.top3Count,
    avgPlacement: summary.avgPlacement ? Number(summary.avgPlacement) : null,
    bestPlacement: summary.bestPlacement,
    highestEarning: summary.highestEarning ? Number(summary.highestEarning) : null,
    earningsByYear: (summary.earningsByYear as Record<string, number>) || {},
    earningsByLeague: (summary.earningsByLeague as Record<string, number>) || {},
    worldsAppearances: summary.worldsAppearances,
    worldsWins: summary.worldsWins,
    msiAppearances: summary.msiAppearances,
    msiWins: summary.msiWins,
  };
}

/**
 * Get player team history
 */
async function getPlayerTeamHistory(playerId: string): Promise<LolPlayerTeamHistoryEntry[]> {
  const rosters = await prisma.lolTeamRoster.findMany({
    where: { lolPlayerId: playerId },
    include: {
      organization: {
        select: { name: true, logoUrl: true },
      },
    },
    orderBy: [{ status: 'asc' }, { joinDate: 'desc' }],
  });

  return rosters.map((r) => ({
    orgSlug: r.orgSlug,
    teamName: r.organization.name,
    role: r.role,
    status: r.status,
    joinDate: r.joinDate,
    leaveDate: r.leaveDate,
    leaveReason: r.leaveReason,
    isStarter: r.isStarter,
    logoUrl: r.organization.logoUrl,
  }));
}

/**
 * Get player match history
 */
async function getPlayerMatches(
  playerId: string,
  options?: { limit?: number; offset?: number }
): Promise<LolPlayerMatchEntry[]> {
  const { limit = 20, offset = 0 } = options || {};

  // Get games where the player participated
  const gameStats = await prisma.lolGamePlayerStats.findMany({
    where: { lolPlayerId: playerId },
    include: {
      game: {
        include: {
          match: {
            include: {
              tournament: {
                select: { name: true },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });

  // Group by match
  const matchMap = new Map<string, LolPlayerMatchEntry>();

  for (const stat of gameStats) {
    const match = stat.game.match;
    if (!matchMap.has(match.matchId)) {
      const playerTeamSlug = stat.teamSlug;
      let result: 'win' | 'loss' | 'unknown' = 'unknown';
      if (match.winnerSlug) {
        result = match.winnerSlug === playerTeamSlug ? 'win' : 'loss';
      }

      matchMap.set(match.matchId, {
        matchId: match.matchId,
        tournamentId: match.tournamentId,
        tournamentName: match.tournament?.name || null,
        team1Slug: match.team1Slug,
        team2Slug: match.team2Slug,
        team1Score: match.team1Score,
        team2Score: match.team2Score,
        winnerSlug: match.winnerSlug,
        startTime: match.startTime,
        strategy: match.strategy,
        playerTeamSlug,
        result,
      });
    }
  }

  return Array.from(matchMap.values());
}

/**
 * Get player champion pool stats
 */
async function getPlayerChampions(
  playerId: string,
  options?: { season?: string; limit?: number }
): Promise<LolPlayerChampionEntry[]> {
  const { season, limit = 20 } = options || {};

  // First check if we have pre-computed champion stats
  const where: Prisma.LolPlayerChampionStatsWhereInput = {
    lolPlayerId: playerId,
    ...(season && { season }),
  };

  const championStats = await prisma.lolPlayerChampionStats.findMany({
    where,
    orderBy: { gamesPlayed: 'desc' },
    take: limit,
  });

  if (championStats.length > 0) {
    return championStats.map((cs) => ({
      championId: cs.championId,
      championName: cs.championName,
      gamesPlayed: cs.gamesPlayed,
      wins: cs.wins,
      losses: cs.losses,
      winRate: cs.winRate ? Number(cs.winRate) : 0,
      avgKills: cs.avgKills ? Number(cs.avgKills) : null,
      avgDeaths: cs.avgDeaths ? Number(cs.avgDeaths) : null,
      avgAssists: cs.avgAssists ? Number(cs.avgAssists) : null,
      avgKda: cs.avgKda ? Number(cs.avgKda) : null,
      avgCs: cs.avgCs ? Number(cs.avgCs) : null,
      avgGold: cs.avgGold ? Number(cs.avgGold) : null,
    }));
  }

  // Calculate from game stats
  const gameStats = await prisma.lolGamePlayerStats.findMany({
    where: { lolPlayerId: playerId },
    include: {
      game: {
        select: { winnerSlug: true },
      },
    },
  });

  // Group by champion
  const championMap = new Map<
    number,
    {
      championId: number;
      championName: string;
      games: typeof gameStats;
    }
  >();

  for (const stat of gameStats) {
    const existing = championMap.get(stat.championId);
    if (existing) {
      existing.games.push(stat);
    } else {
      championMap.set(stat.championId, {
        championId: stat.championId,
        championName: stat.championName,
        games: [stat],
      });
    }
  }

  // Calculate stats for each champion
  const results: LolPlayerChampionEntry[] = [];
  for (const [, data] of championMap) {
    const gamesPlayed = data.games.length;
    const wins = data.games.filter((g) => g.game.winnerSlug === g.teamSlug).length;
    const losses = gamesPlayed - wins;

    const totalKills = data.games.reduce((sum, g) => sum + g.kills, 0);
    const totalDeaths = data.games.reduce((sum, g) => sum + g.deaths, 0);
    const totalAssists = data.games.reduce((sum, g) => sum + g.assists, 0);
    const totalCs = data.games.reduce((sum, g) => sum + g.cs, 0);
    const totalGold = data.games.reduce((sum, g) => sum + g.gold, 0);

    results.push({
      championId: data.championId,
      championName: data.championName,
      gamesPlayed,
      wins,
      losses,
      winRate: gamesPlayed > 0 ? wins / gamesPlayed : 0,
      avgKills: gamesPlayed > 0 ? totalKills / gamesPlayed : null,
      avgDeaths: gamesPlayed > 0 ? totalDeaths / gamesPlayed : null,
      avgAssists: gamesPlayed > 0 ? totalAssists / gamesPlayed : null,
      avgKda:
        totalDeaths > 0
          ? (totalKills + totalAssists) / totalDeaths
          : gamesPlayed > 0
          ? totalKills + totalAssists
          : null,
      avgCs: gamesPlayed > 0 ? totalCs / gamesPlayed : null,
      avgGold: gamesPlayed > 0 ? totalGold / gamesPlayed : null,
    });
  }

  // Sort by games played
  results.sort((a, b) => b.gamesPlayed - a.gamesPlayed);

  return results.slice(0, limit);
}

/**
 * Get player achievements
 */
async function getPlayerAchievements(playerId: string): Promise<LolPlayerAchievements> {
  // Get tournament earnings for championships
  const earnings = await prisma.lolPlayerTournamentEarning.findMany({
    where: {
      lolPlayerId: playerId,
      placement: { lte: 3 },
    },
    orderBy: { tournamentDate: 'desc' },
  });

  // Get earnings summary for international stats
  const summary = await prisma.lolPlayerEarningsSummary.findUnique({
    where: { lolPlayerId: playerId },
  });

  const championships = earnings
    .filter((e) => e.placement === 1)
    .map((e) => ({
      tournamentId: e.tournamentId,
      tournamentName: e.tournamentName,
      tournamentDate: e.tournamentDate,
      placement: e.placement,
      tier: e.tier,
      league: e.league,
      isInternational: ['worlds', 'msi', 'mid-season'].some((keyword) =>
        e.tournamentId.toLowerCase().includes(keyword)
      ),
    }));

  // Count regional titles (1st place in major regional leagues)
  const regionalTitles = championships.filter(
    (c) =>
      !c.isInternational &&
      c.league &&
      ['LCK', 'LPL', 'LEC', 'LCS'].some((league) =>
        c.league!.toUpperCase().includes(league)
      )
  ).length;

  return {
    championships,
    mvpAwards: [], // Would need a separate MVP tracking system
    worldsAppearances: summary?.worldsAppearances || 0,
    worldsWins: summary?.worldsWins || 0,
    msiAppearances: summary?.msiAppearances || 0,
    msiWins: summary?.msiWins || 0,
    regionalTitles,
    allProSelections: 0, // Would need a separate tracking system
  };
}

/**
 * Compare two players
 */
async function comparePlayer(
  player1Id: string,
  player2Id: string
): Promise<LolPlayerComparison | null> {
  const [player1, player2] = await Promise.all([
    getPlayerById(player1Id),
    getPlayerById(player2Id),
  ]);

  if (!player1 || !player2) {
    return null;
  }

  const [stats1, stats2, earnings1, earnings2] = await Promise.all([
    getPlayerStats(player1Id),
    getPlayerStats(player2Id),
    getPlayerEarningsSummary(player1Id),
    getPlayerEarningsSummary(player2Id),
  ]);

  if (!stats1 || !stats2) {
    return null;
  }

  // Calculate head-to-head if they played against each other
  const player1Teams = await prisma.lolTeamRoster.findMany({
    where: { lolPlayerId: player1Id },
    select: { orgSlug: true },
  });
  const player2Teams = await prisma.lolTeamRoster.findMany({
    where: { lolPlayerId: player2Id },
    select: { orgSlug: true },
  });

  const player1TeamSlugs = player1Teams.map((t) => t.orgSlug);
  const player2TeamSlugs = player2Teams.map((t) => t.orgSlug);

  // Find matches where their teams faced each other
  const headToHeadMatches = await prisma.lolMatch.findMany({
    where: {
      OR: [
        {
          team1Slug: { in: player1TeamSlugs },
          team2Slug: { in: player2TeamSlugs },
        },
        {
          team1Slug: { in: player2TeamSlugs },
          team2Slug: { in: player1TeamSlugs },
        },
      ],
      winnerSlug: { not: null },
    },
    select: {
      team1Slug: true,
      team2Slug: true,
      winnerSlug: true,
    },
  });

  let headToHead: LolPlayerComparison['headToHead'];
  if (headToHeadMatches.length > 0) {
    let player1Wins = 0;
    let player2Wins = 0;

    for (const match of headToHeadMatches) {
      if (match.winnerSlug && player1TeamSlugs.includes(match.winnerSlug)) {
        player1Wins++;
      } else if (match.winnerSlug && player2TeamSlugs.includes(match.winnerSlug)) {
        player2Wins++;
      }
    }

    headToHead = {
      player1Wins,
      player2Wins,
      totalGames: headToHeadMatches.length,
    };
  }

  return {
    player1,
    player2,
    stats1,
    stats2,
    earnings1: earnings1 || {
      totalEarnings: 0,
      tournamentCount: 0,
      firstPlaceCount: 0,
      top3Count: 0,
      avgPlacement: null,
      bestPlacement: null,
      highestEarning: null,
      earningsByYear: {},
      earningsByLeague: {},
      worldsAppearances: 0,
      worldsWins: 0,
      msiAppearances: 0,
      msiWins: 0,
    },
    earnings2: earnings2 || {
      totalEarnings: 0,
      tournamentCount: 0,
      firstPlaceCount: 0,
      top3Count: 0,
      avgPlacement: null,
      bestPlacement: null,
      highestEarning: null,
      earningsByYear: {},
      earningsByLeague: {},
      worldsAppearances: 0,
      worldsWins: 0,
      msiAppearances: 0,
      msiWins: 0,
    },
    headToHead,
  };
}

/**
 * Get similar players (peers)
 */
async function getPlayerPeers(
  playerId: string,
  options?: { limit?: number }
): Promise<LolPlayerPeer[]> {
  const { limit = 10 } = options || {};

  const player = await prisma.lolPlayer.findUnique({
    where: { lolPlayerId: playerId },
    include: {
      rosterHistory: {
        select: { orgSlug: true },
      },
      earningsSummary: true,
    },
  });

  if (!player) {
    return [];
  }

  // Find players with same role
  const sameRolePlayers = await prisma.lolPlayer.findMany({
    where: {
      role: player.role,
      lolPlayerId: { not: playerId },
      isActive: true,
    },
    include: {
      rosterHistory: {
        where: { status: 'current' },
        include: { organization: true },
        take: 1,
      },
      earningsSummary: true,
    },
    take: 50,
  });

  const playerTeamSlugs = new Set(player.rosterHistory.map((r) => r.orgSlug));
  const playerEarnings = player.earningsSummary
    ? Number(player.earningsSummary.totalEarnings)
    : 0;

  // Calculate similarity scores
  const peers = sameRolePlayers.map((p) => {
    const pTeamSlugs = new Set(p.rosterHistory.map((r) => r.orgSlug));
    const sharedTeams = [...playerTeamSlugs].filter((t) => pTeamSlugs.has(t));

    const pEarnings = p.earningsSummary ? Number(p.earningsSummary.totalEarnings) : 0;
    const earningsRatio =
      playerEarnings > 0 && pEarnings > 0
        ? Math.min(playerEarnings, pEarnings) / Math.max(playerEarnings, pEarnings)
        : 0;

    // Calculate similarity score
    let similarity = 0;
    // Same role = base similarity
    similarity += 0.3;
    // Shared teams
    similarity += sharedTeams.length * 0.2;
    // Similar earnings
    similarity += earningsRatio * 0.3;
    // Same nationality
    if (player.nationality && p.nationality === player.nationality) {
      similarity += 0.1;
    }

    return {
      lolPlayerId: p.lolPlayerId,
      currentIgn: p.currentIgn,
      role: p.role,
      imageUrl: p.imageUrl,
      currentTeam: p.rosterHistory[0]?.organization.name || null,
      similarity: Math.min(similarity, 1),
      sharedTeams,
      similarStats: earningsRatio > 0.5,
    };
  });

  // Sort by similarity
  peers.sort((a, b) => b.similarity - a.similarity);

  return peers.slice(0, limit);
}

// ========== EXPORT SERVICE ==========

export const lolPlayerService = {
  getAllPlayers,
  searchPlayers,
  getPlayerById,
  getPlayerStats,
  getPlayerCareerStats,
  getPlayerEarnings,
  getPlayerEarningsSummary,
  getPlayerTeamHistory,
  getPlayerMatches,
  getPlayerChampions,
  getPlayerAchievements,
  comparePlayer,
  getPlayerPeers,
};
