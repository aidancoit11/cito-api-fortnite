import { prisma } from '../../db/client.js';
import { lolEsportsApiService, LolTeamApiResponse } from './lol-esports-api.service.js';
import { Prisma } from '@prisma/client';

/**
 * LoL Team/Organization Service
 * Handles all Team/Organization operations for League of Legends esports
 */

// ============== TYPES ==============

export interface TeamFilters {
  league?: string;
  region?: string;
  active?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface TeamRosterMember {
  lolPlayerId: string | null;
  playerName: string;
  role: string;
  status: string;
  joinDate: Date | null;
  leaveDate: Date | null;
  isStarter: boolean;
  isActive: boolean;
}

export interface TeamStats {
  totalMatches: number;
  wins: number;
  losses: number;
  winRate: number;
  avgGameDuration: number | null;
  avgGamesPerMatch: number | null;
  gameWins: number;
  gameLosses: number;
  gameWinRate: number;
  blueWins: number;
  blueLosses: number;
  redWins: number;
  redLosses: number;
  firstBloodRate: number | null;
  firstTowerRate: number | null;
  firstDragonRate: number | null;
  firstBaronRate: number | null;
  avgKillsPerGame: number | null;
  avgDeathsPerGame: number | null;
  avgGoldPerGame: number | null;
}

export interface HeadToHeadRecord {
  opponent: {
    slug: string;
    name: string;
    logoUrl: string | null;
  };
  matches: {
    total: number;
    wins: number;
    losses: number;
    winRate: number;
  };
  games: {
    total: number;
    wins: number;
    losses: number;
    winRate: number;
  };
  recentMatches: Array<{
    matchId: string;
    tournamentName: string;
    date: Date | null;
    team1Score: number | null;
    team2Score: number | null;
    winner: string | null;
  }>;
}

export interface TeamEarnings {
  totalEarnings: number;
  tournamentCount: number;
  firstPlaceCount: number;
  worldsWins: number;
  msiWins: number;
  regionalTitles: number;
  earningsByYear: Record<string, number>;
  topEarningTournaments: Array<{
    tournamentId: string;
    name: string;
    placement: number;
    earnings: number;
    date: Date | null;
  }>;
}

export interface TeamAchievement {
  tournamentId: string;
  tournamentName: string;
  placement: number;
  prizeMoney: number | null;
  date: Date | null;
  tier: string | null;
  isInternational: boolean;
}

export interface ChampionPoolEntry {
  championId: number;
  championName: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  playedByPlayers: string[];
}

// ============== HELPER FUNCTIONS ==============

function calculateWinRate(wins: number, losses: number): number {
  const total = wins + losses;
  if (total === 0) return 0;
  return Math.round((wins / total) * 10000) / 100; // 2 decimal places percentage
}

// ============== SERVICE FUNCTIONS ==============

/**
 * Sync teams from the LoL Esports API
 */
export async function syncTeams(): Promise<number> {
  console.log('[LolTeamService] Starting team sync...');
  let synced = 0;

  try {
    // First, get all leagues to find teams
    const leagues = await lolEsportsApiService.getLeagues();

    for (const league of leagues) {
      try {
        // Get teams for this league
        const teams = await lolEsportsApiService.getTeams(league.id);

        for (const team of teams) {
          try {
            await syncTeamFromApi(team, league.region);
            synced++;
          } catch (error: any) {
            console.error(`[LolTeamService] Failed to sync team ${team.slug}:`, error.message);
          }
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error: any) {
        console.error(`[LolTeamService] Failed to fetch teams for league ${league.slug}:`, error.message);
      }
    }

    console.log(`[LolTeamService] Synced ${synced} teams`);
    return synced;
  } catch (error: any) {
    console.error('[LolTeamService] Team sync failed:', error.message);
    throw error;
  }
}

/**
 * Sync a single team from API data
 */
async function syncTeamFromApi(team: LolTeamApiResponse, leagueRegion?: string): Promise<void> {
  const region = team.homeLeague?.region || leagueRegion || null;

  await prisma.lolOrganization.upsert({
    where: { slug: team.slug },
    create: {
      slug: team.slug,
      esportsApiId: team.id,
      name: team.name,
      shortName: team.code || null,
      region,
      logoUrl: team.image || null,
      altLogoUrl: team.alternativeImage || null,
      isActive: team.status === 'active',
    },
    update: {
      esportsApiId: team.id,
      name: team.name,
      shortName: team.code || null,
      region,
      logoUrl: team.image || null,
      altLogoUrl: team.alternativeImage || null,
      isActive: team.status === 'active',
      lastUpdated: new Date(),
    },
  });

  // Sync players if available
  if (team.players && team.players.length > 0) {
    for (const player of team.players) {
      try {
        // Upsert player
        const lolPlayer = await prisma.lolPlayer.upsert({
          where: { esportsApiId: player.id },
          create: {
            esportsApiId: player.id,
            currentIgn: player.summonerName,
            realName: player.firstName && player.lastName
              ? `${player.firstName} ${player.lastName}`
              : player.firstName || null,
            role: player.role || null,
            imageUrl: player.image || null,
            isActive: true,
          },
          update: {
            currentIgn: player.summonerName,
            realName: player.firstName && player.lastName
              ? `${player.firstName} ${player.lastName}`
              : player.firstName || null,
            role: player.role || null,
            imageUrl: player.image || null,
            lastUpdated: new Date(),
          },
        });

        // Check if roster entry exists
        const existingRoster = await prisma.lolTeamRoster.findFirst({
          where: {
            orgSlug: team.slug,
            lolPlayerId: lolPlayer.lolPlayerId,
            status: 'current',
          },
        });

        if (existingRoster) {
          await prisma.lolTeamRoster.update({
            where: { id: existingRoster.id },
            data: {
              playerName: player.summonerName,
              role: player.role || 'Unknown',
              isActive: true,
              lastUpdated: new Date(),
            },
          });
        } else {
          await prisma.lolTeamRoster.create({
            data: {
              orgSlug: team.slug,
              lolPlayerId: lolPlayer.lolPlayerId,
              playerName: player.summonerName,
              role: player.role || 'Unknown',
              status: 'current',
              isStarter: true,
              isActive: true,
            },
          });
        }
      } catch (error: any) {
        console.error(`[LolTeamService] Failed to sync player ${player.summonerName}:`, error.message);
      }
    }
  }
}

/**
 * Get all teams with filters
 */
export async function getAllTeams(filters: TeamFilters = {}): Promise<{
  teams: any[];
  total: number;
  hasMore: boolean;
}> {
  const { league, region, active, search, limit = 50, offset = 0 } = filters;

  const where: Prisma.LolOrganizationWhereInput = {};

  if (region) {
    where.region = region;
  }

  if (active !== undefined) {
    where.isActive = active;
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { slug: { contains: search, mode: 'insensitive' } },
      { shortName: { contains: search, mode: 'insensitive' } },
    ];
  }

  // If league filter is specified, we need to join with LolLeagueTeam
  if (league) {
    where.leagueTeams = {
      some: {
        league: {
          OR: [
            { slug: league },
            { leagueId: league },
          ],
        },
        isActive: true,
      },
    };
  }

  const [teams, total] = await Promise.all([
    prisma.lolOrganization.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: {
        leagueTeams: {
          where: { isActive: true },
          include: {
            league: {
              select: { slug: true, name: true, region: true },
            },
          },
        },
        _count: {
          select: {
            roster: { where: { status: 'current', isActive: true } },
          },
        },
      },
    }),
    prisma.lolOrganization.count({ where }),
  ]);

  return {
    teams: teams.map(team => ({
      slug: team.slug,
      name: team.name,
      shortName: team.shortName,
      region: team.region,
      logoUrl: team.logoUrl,
      isActive: team.isActive,
      leagues: team.leagueTeams.map(lt => lt.league),
      rosterCount: team._count.roster,
    })),
    total,
    hasMore: offset + teams.length < total,
  };
}

/**
 * Get team by slug
 */
export async function getTeamBySlug(slug: string): Promise<any | null> {
  const team = await prisma.lolOrganization.findUnique({
    where: { slug },
    include: {
      leagueTeams: {
        where: { isActive: true },
        include: {
          league: true,
        },
      },
      roster: {
        where: { status: 'current', isActive: true },
        orderBy: { role: 'asc' },
        include: {
          player: {
            select: {
              lolPlayerId: true,
              currentIgn: true,
              realName: true,
              nationality: true,
              role: true,
              imageUrl: true,
            },
          },
        },
      },
      earningsSummary: true,
      standings: {
        orderBy: { lastUpdated: 'desc' },
        take: 1,
      },
    },
  });

  if (!team) {
    // Try to fetch from API
    try {
      const apiTeams = await lolEsportsApiService.getTeams(slug);
      const firstTeam = apiTeams[0];
      if (firstTeam) {
        await syncTeamFromApi(firstTeam, undefined);
        return getTeamBySlug(slug);
      }
    } catch {
      // Team not found
    }
    return null;
  }

  return {
    slug: team.slug,
    esportsApiId: team.esportsApiId,
    name: team.name,
    shortName: team.shortName,
    region: team.region,
    logoUrl: team.logoUrl,
    altLogoUrl: team.altLogoUrl,
    wikiUrl: team.wikiUrl,
    website: team.website,
    socialMedia: team.socialMedia,
    foundedDate: team.foundedDate,
    headquarters: team.headquarters,
    description: team.description,
    isActive: team.isActive,
    leagues: team.leagueTeams.map(lt => ({
      leagueId: lt.league.leagueId,
      slug: lt.league.slug,
      name: lt.league.name,
      region: lt.league.region,
    })),
    roster: team.roster.map(r => ({
      playerId: r.lolPlayerId,
      playerName: r.playerName,
      role: r.role,
      isStarter: r.isStarter,
      player: r.player,
    })),
    standings: team.standings[0] || null,
    earnings: team.earningsSummary ? {
      total: Number(team.earningsSummary.totalEarnings),
      tournamentCount: team.earningsSummary.tournamentCount,
      firstPlaceCount: team.earningsSummary.firstPlaceCount,
    } : null,
  };
}

/**
 * Get current team roster
 */
export async function getTeamRoster(slug: string): Promise<TeamRosterMember[]> {
  const roster = await prisma.lolTeamRoster.findMany({
    where: {
      orgSlug: slug,
      status: 'current',
      isActive: true,
    },
    orderBy: [
      { isStarter: 'desc' },
      { role: 'asc' },
    ],
    include: {
      player: {
        select: {
          lolPlayerId: true,
          currentIgn: true,
          realName: true,
          nationality: true,
          imageUrl: true,
        },
      },
    },
  });

  return roster.map(r => ({
    lolPlayerId: r.lolPlayerId,
    playerName: r.playerName,
    role: r.role,
    status: r.status,
    joinDate: r.joinDate,
    leaveDate: r.leaveDate,
    isStarter: r.isStarter,
    isActive: r.isActive,
  }));
}

/**
 * Get team roster history (all past and current members)
 */
export async function getTeamRosterHistory(slug: string, options?: {
  limit?: number;
  offset?: number;
}): Promise<{
  roster: TeamRosterMember[];
  total: number;
}> {
  const { limit = 100, offset = 0 } = options || {};

  const [roster, total] = await Promise.all([
    prisma.lolTeamRoster.findMany({
      where: { orgSlug: slug },
      take: limit,
      skip: offset,
      orderBy: [
        { status: 'asc' },
        { joinDate: 'desc' },
      ],
      include: {
        player: {
          select: {
            lolPlayerId: true,
            currentIgn: true,
            realName: true,
            nationality: true,
          },
        },
      },
    }),
    prisma.lolTeamRoster.count({ where: { orgSlug: slug } }),
  ]);

  return {
    roster: roster.map(r => ({
      lolPlayerId: r.lolPlayerId,
      playerName: r.playerName,
      role: r.role,
      status: r.status,
      joinDate: r.joinDate,
      leaveDate: r.leaveDate,
      isStarter: r.isStarter,
      isActive: r.isActive,
    })),
    total,
  };
}

/**
 * Get matches for a team
 */
export async function getTeamMatches(slug: string, options?: {
  limit?: number;
  offset?: number;
  tournamentId?: string;
  state?: 'completed' | 'upcoming' | 'all';
}): Promise<{
  matches: any[];
  total: number;
}> {
  const { limit = 50, offset = 0, tournamentId, state = 'all' } = options || {};

  const where: Prisma.LolMatchWhereInput = {
    OR: [
      { team1Slug: slug },
      { team2Slug: slug },
    ],
  };

  if (tournamentId) {
    where.tournamentId = tournamentId;
  }

  if (state === 'completed') {
    where.state = 'completed';
  } else if (state === 'upcoming') {
    where.state = { in: ['unstarted', 'inProgress'] };
  }

  const [matches, total] = await Promise.all([
    prisma.lolMatch.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { startTime: 'desc' },
      include: {
        tournament: {
          select: { name: true, tier: true },
        },
        team1: {
          select: { name: true, logoUrl: true },
        },
        team2: {
          select: { name: true, logoUrl: true },
        },
        games: {
          select: { gameNumber: true, winnerSlug: true, duration: true },
          orderBy: { gameNumber: 'asc' },
        },
      },
    }),
    prisma.lolMatch.count({ where }),
  ]);

  return {
    matches: matches.map(m => ({
      matchId: m.matchId,
      tournamentId: m.tournamentId,
      tournamentName: m.tournament.name,
      round: m.round,
      startTime: m.startTime,
      state: m.state,
      team1: {
        slug: m.team1Slug,
        name: m.team1.name,
        logoUrl: m.team1.logoUrl,
        score: m.team1Score,
        isRequested: m.team1Slug === slug,
      },
      team2: {
        slug: m.team2Slug,
        name: m.team2.name,
        logoUrl: m.team2.logoUrl,
        score: m.team2Score,
        isRequested: m.team2Slug === slug,
      },
      winner: m.winnerSlug,
      won: m.winnerSlug === slug,
      games: m.games,
      vodUrl: m.vodUrl,
    })),
    total,
  };
}

/**
 * Get aggregated team stats
 */
export async function getTeamStats(slug: string, options?: {
  tournamentId?: string;
  season?: string;
}): Promise<TeamStats> {
  const { tournamentId } = options || {};

  // Build match filter
  const matchWhere: Prisma.LolMatchWhereInput = {
    OR: [
      { team1Slug: slug },
      { team2Slug: slug },
    ],
    state: 'completed',
  };

  if (tournamentId) {
    matchWhere.tournamentId = tournamentId;
  }

  // Get all completed matches for this team
  const matches = await prisma.lolMatch.findMany({
    where: matchWhere,
    include: {
      games: true,
    },
  });

  let wins = 0;
  let losses = 0;
  let gameWins = 0;
  let gameLosses = 0;
  let blueWins = 0;
  let blueLosses = 0;
  let redWins = 0;
  let redLosses = 0;
  let totalDuration = 0;
  let durationCount = 0;
  let totalGamesPerMatch = 0;

  for (const match of matches) {
    if (match.winnerSlug === slug) {
      wins++;
    } else if (match.winnerSlug) {
      losses++;
    }

    totalGamesPerMatch += match.games.length;

    for (const game of match.games) {
      if (game.winnerSlug === slug) {
        gameWins++;
        // Determine side
        if (game.blueTeamSlug === slug) {
          blueWins++;
        } else {
          redWins++;
        }
      } else if (game.winnerSlug) {
        gameLosses++;
        if (game.blueTeamSlug === slug) {
          blueLosses++;
        } else {
          redLosses++;
        }
      }

      if (game.duration) {
        totalDuration += game.duration;
        durationCount++;
      }
    }
  }

  // Calculate first objective rates
  const totalGames = gameWins + gameLosses;

  // For first objective rates, we need to query separately
  const blueFirstStats = await prisma.lolGame.count({
    where: {
      match: matchWhere,
      blueTeamSlug: slug,
      firstBlood: 'blue',
    },
  });

  const redFirstStats = await prisma.lolGame.count({
    where: {
      match: matchWhere,
      redTeamSlug: slug,
      firstBlood: 'red',
    },
  });

  const firstBloodCount = blueFirstStats + redFirstStats;

  return {
    totalMatches: matches.length,
    wins,
    losses,
    winRate: calculateWinRate(wins, losses),
    avgGameDuration: durationCount > 0 ? Math.round(totalDuration / durationCount) : null,
    avgGamesPerMatch: matches.length > 0 ? Math.round((totalGamesPerMatch / matches.length) * 100) / 100 : null,
    gameWins,
    gameLosses,
    gameWinRate: calculateWinRate(gameWins, gameLosses),
    blueWins,
    blueLosses,
    redWins,
    redLosses,
    firstBloodRate: totalGames > 0 ? Math.round((firstBloodCount / totalGames) * 10000) / 100 : null,
    firstTowerRate: null, // Would need separate queries
    firstDragonRate: null,
    firstBaronRate: null,
    avgKillsPerGame: null, // Complex to calculate per-team
    avgDeathsPerGame: null,
    avgGoldPerGame: null,
  };
}

/**
 * Get head-to-head record vs another team
 */
export async function getTeamHeadToHead(slug: string, opponentSlug: string): Promise<HeadToHeadRecord | null> {
  const opponent = await prisma.lolOrganization.findUnique({
    where: { slug: opponentSlug },
    select: { slug: true, name: true, logoUrl: true },
  });

  if (!opponent) {
    return null;
  }

  const matches = await prisma.lolMatch.findMany({
    where: {
      OR: [
        { team1Slug: slug, team2Slug: opponentSlug },
        { team1Slug: opponentSlug, team2Slug: slug },
      ],
      state: 'completed',
    },
    orderBy: { startTime: 'desc' },
    include: {
      tournament: {
        select: { name: true },
      },
      games: {
        select: { winnerSlug: true },
      },
    },
  });

  let matchWins = 0;
  let matchLosses = 0;
  let gameWins = 0;
  let gameLosses = 0;

  for (const match of matches) {
    if (match.winnerSlug === slug) {
      matchWins++;
    } else if (match.winnerSlug === opponentSlug) {
      matchLosses++;
    }

    for (const game of match.games) {
      if (game.winnerSlug === slug) {
        gameWins++;
      } else if (game.winnerSlug === opponentSlug) {
        gameLosses++;
      }
    }
  }

  return {
    opponent: {
      slug: opponent.slug,
      name: opponent.name,
      logoUrl: opponent.logoUrl,
    },
    matches: {
      total: matches.length,
      wins: matchWins,
      losses: matchLosses,
      winRate: calculateWinRate(matchWins, matchLosses),
    },
    games: {
      total: gameWins + gameLosses,
      wins: gameWins,
      losses: gameLosses,
      winRate: calculateWinRate(gameWins, gameLosses),
    },
    recentMatches: matches.slice(0, 10).map(m => ({
      matchId: m.matchId,
      tournamentName: m.tournament.name,
      date: m.startTime,
      team1Score: m.team1Score,
      team2Score: m.team2Score,
      winner: m.winnerSlug,
    })),
  };
}

/**
 * Get team earnings breakdown
 */
export async function getTeamEarnings(slug: string): Promise<TeamEarnings> {
  const summary = await prisma.lolOrgEarningsSummary.findUnique({
    where: { orgSlug: slug },
  });

  const tournamentResults = await prisma.lolTournamentResult.findMany({
    where: { orgSlug: slug },
    orderBy: { prizeMoney: 'desc' },
    take: 10,
    include: {
      tournament: {
        select: { name: true, startDate: true },
      },
    },
  });

  return {
    totalEarnings: summary ? Number(summary.totalEarnings) : 0,
    tournamentCount: summary?.tournamentCount || 0,
    firstPlaceCount: summary?.firstPlaceCount || 0,
    worldsWins: summary?.worldsWins || 0,
    msiWins: summary?.msiWins || 0,
    regionalTitles: summary?.regionalTitles || 0,
    earningsByYear: (summary?.earningsByYear as Record<string, number>) || {},
    topEarningTournaments: tournamentResults.map(r => ({
      tournamentId: r.tournamentId,
      name: r.tournament.name,
      placement: r.rank,
      earnings: Number(r.prizeMoney || 0),
      date: r.tournament.startDate,
    })),
  };
}

/**
 * Get team achievements (championships and notable placements)
 */
export async function getTeamAchievements(slug: string, options?: {
  minPlacement?: number;
  limit?: number;
}): Promise<TeamAchievement[]> {
  const { minPlacement = 4, limit = 50 } = options || {};

  const results = await prisma.lolTournamentResult.findMany({
    where: {
      orgSlug: slug,
      rank: { lte: minPlacement },
    },
    orderBy: [
      { rank: 'asc' },
      { tournament: { startDate: 'desc' } },
    ],
    take: limit,
    include: {
      tournament: {
        select: {
          name: true,
          tier: true,
          startDate: true,
          isInternational: true,
        },
      },
    },
  });

  return results.map(r => ({
    tournamentId: r.tournamentId,
    tournamentName: r.tournament.name,
    placement: r.rank,
    prizeMoney: r.prizeMoney ? Number(r.prizeMoney) : null,
    date: r.tournament.startDate,
    tier: r.tournament.tier,
    isInternational: r.tournament.isInternational,
  }));
}

/**
 * Get team's most played champions (champion pool)
 */
export async function getTeamChampionPool(slug: string, options?: {
  limit?: number;
  season?: string;
  role?: string;
}): Promise<ChampionPoolEntry[]> {
  const { limit = 20, role } = options || {};

  // Build the where clause for player stats
  const playerStatsWhere: Prisma.LolGamePlayerStatsWhereInput = {
    teamSlug: slug,
  };

  if (role) {
    playerStatsWhere.role = role;
  }

  // First get all player stats for this team
  const allStats = await prisma.lolGamePlayerStats.findMany({
    where: playerStatsWhere,
    select: {
      championId: true,
      championName: true,
      playerName: true,
      kills: true,
      deaths: true,
      assists: true,
      game: {
        select: {
          winnerSlug: true,
        },
      },
    },
  });

  // Aggregate champion data manually
  const championMap = new Map<number, {
    championId: number;
    championName: string;
    gamesPlayed: number;
    wins: number;
    losses: number;
    totalKills: number;
    totalDeaths: number;
    totalAssists: number;
    players: Set<string>;
  }>();

  for (const stat of allStats) {
    const existing = championMap.get(stat.championId);
    const isWin = stat.game.winnerSlug === slug;

    if (existing) {
      existing.gamesPlayed++;
      if (isWin) existing.wins++;
      else existing.losses++;
      existing.totalKills += stat.kills;
      existing.totalDeaths += stat.deaths;
      existing.totalAssists += stat.assists;
      existing.players.add(stat.playerName);
    } else {
      championMap.set(stat.championId, {
        championId: stat.championId,
        championName: stat.championName,
        gamesPlayed: 1,
        wins: isWin ? 1 : 0,
        losses: isWin ? 0 : 1,
        totalKills: stat.kills,
        totalDeaths: stat.deaths,
        totalAssists: stat.assists,
        players: new Set([stat.playerName]),
      });
    }
  }

  // Convert to array, sort by games played, and limit
  const sortedChampions = Array.from(championMap.values())
    .sort((a, b) => b.gamesPlayed - a.gamesPlayed)
    .slice(0, limit);

  return sortedChampions.map(champ => ({
    championId: champ.championId,
    championName: champ.championName,
    gamesPlayed: champ.gamesPlayed,
    wins: champ.wins,
    losses: champ.losses,
    winRate: calculateWinRate(champ.wins, champ.losses),
    avgKills: champ.gamesPlayed > 0 ? Math.round((champ.totalKills / champ.gamesPlayed) * 100) / 100 : 0,
    avgDeaths: champ.gamesPlayed > 0 ? Math.round((champ.totalDeaths / champ.gamesPlayed) * 100) / 100 : 0,
    avgAssists: champ.gamesPlayed > 0 ? Math.round((champ.totalAssists / champ.gamesPlayed) * 100) / 100 : 0,
    playedByPlayers: Array.from(champ.players),
  }));
}

// ============== EXPORT SERVICE OBJECT ==============

export const lolTeamService = {
  syncTeams,
  getAllTeams,
  getTeamBySlug,
  getTeamRoster,
  getTeamRosterHistory,
  getTeamMatches,
  getTeamStats,
  getTeamHeadToHead,
  getTeamEarnings,
  getTeamAchievements,
  getTeamChampionPool,
};
