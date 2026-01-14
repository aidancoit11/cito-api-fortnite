import { prisma } from '../../db/client.js';
import { lolEsportsApiService } from './lol-esports-api.service.js';

/**
 * LoL Tournament Service
 * Handles tournament operations including sync, retrieval, standings, brackets, and stats
 */

// ============== TYPES ==============

export interface TournamentFilters {
  league?: string;
  tier?: string;
  year?: number;
  completed?: boolean;
  upcoming?: boolean;
  limit?: number;
  offset?: number;
}

export interface MatchFilters {
  round?: string;
  team?: string;
  completed?: boolean;
  limit?: number;
  offset?: number;
}

export interface TournamentStanding {
  rank: number;
  orgSlug: string;
  teamName: string;
  logoUrl: string | null;
  wins: number;
  losses: number;
  winRate: number;
  gameWins: number;
  gameLosses: number;
  gameWinRate: number;
  streak: string | null;
}

export interface TournamentBracket {
  stages: BracketStage[];
}

export interface BracketStage {
  name: string;
  type: string;
  sections: BracketSection[];
}

export interface BracketSection {
  name: string;
  matches: BracketMatch[];
}

export interface BracketMatch {
  matchId: string;
  round: string | null;
  team1: {
    slug: string;
    name: string;
    logoUrl: string | null;
    score: number | null;
  };
  team2: {
    slug: string;
    name: string;
    logoUrl: string | null;
    score: number | null;
  };
  winnerSlug: string | null;
  state: string | null;
  startTime: Date | null;
}

export interface TournamentResult {
  rank: number;
  orgSlug: string;
  teamName: string;
  logoUrl: string | null;
  prizeMoney: number | null;
  prizeMoneyUsd: number | null;
  wins: number | null;
  losses: number | null;
  gameWins: number | null;
  gameLosses: number | null;
}

export interface TournamentStats {
  totalGames: number;
  totalKills: number;
  avgGameDuration: number;
  mostPickedChampions: {
    championId: number;
    championName: string;
    picks: number;
    wins: number;
    winRate: number;
  }[];
  mostBannedChampions: {
    championId: number;
    championName: string;
    bans: number;
  }[];
  topKillers: {
    playerName: string;
    teamSlug: string;
    kills: number;
    deaths: number;
    assists: number;
    kda: number;
  }[];
  highestKDA: {
    playerName: string;
    teamSlug: string;
    kills: number;
    deaths: number;
    assists: number;
    kda: number;
    gamesPlayed: number;
  }[];
  firstBloodRate: {
    teamSlug: string;
    teamName: string;
    firstBloods: number;
    games: number;
    rate: number;
  }[];
}

export interface TournamentMVP {
  playerName: string;
  lolPlayerId: string | null;
  teamSlug: string;
  teamName: string;
  role: string | null;
  imageUrl: string | null;
  stats: {
    gamesPlayed: number;
    kills: number;
    deaths: number;
    assists: number;
    kda: number;
    avgKills: number;
    avgDeaths: number;
    avgAssists: number;
    avgCs: number;
    avgGold: number;
    killParticipation: number;
    damageShare: number;
  };
  championPool: {
    championId: number;
    championName: string;
    games: number;
    wins: number;
    winRate: number;
  }[];
  achievements: string[];
}

// ============== SYNC FUNCTIONS ==============

/**
 * Sync tournaments from LoL Esports API
 */
async function syncTournaments(leagueId?: string): Promise<number> {
  console.log('[LolTournamentService] Starting tournament sync...');
  let syncedCount = 0;

  try {
    // Get all leagues or specific league
    const leagues = leagueId
      ? [{ id: leagueId }]
      : await lolEsportsApiService.getLeagues();

    for (const league of leagues) {
      try {
        // Fetch tournaments for this league
        const apiTournaments = await lolEsportsApiService.getTournamentsForLeague(league.id);

        for (const apiTournament of apiTournaments) {
          try {
            // Get tournament details from standings endpoint for more info
            const standings = await lolEsportsApiService.getStandings(apiTournament.id);

            const tournamentId = `lol-${league.id}-${apiTournament.slug}`;
            const startDate = apiTournament.startDate ? new Date(apiTournament.startDate) : null;
            const endDate = apiTournament.endDate ? new Date(apiTournament.endDate) : null;
            const now = new Date();
            const isCompleted = endDate ? endDate < now : false;

            // Upsert tournament
            await prisma.lolTournament.upsert({
              where: { tournamentId },
              create: {
                tournamentId,
                esportsApiId: apiTournament.id,
                leagueId: league.id,
                name: `${apiTournament.slug.replace(/_/g, ' ')}`,
                slug: apiTournament.slug,
                startDate,
                endDate,
                isCompleted,
              },
              update: {
                startDate,
                endDate,
                isCompleted,
                lastUpdated: new Date(),
              },
            });

            // Sync standings if available
            if (standings.stages && standings.stages.length > 0) {
              for (const stage of standings.stages) {
                for (const section of stage.sections || []) {
                  for (const ranking of section.rankings || []) {
                    for (const team of ranking.teams || []) {
                      try {
                        // Ensure organization exists
                        await prisma.lolOrganization.upsert({
                          where: { slug: team.slug },
                          create: {
                            slug: team.slug,
                            esportsApiId: team.id,
                            name: team.name,
                            shortName: team.code,
                            logoUrl: team.image,
                          },
                          update: {
                            name: team.name,
                            shortName: team.code,
                            logoUrl: team.image,
                            lastUpdated: new Date(),
                          },
                        });

                        // Upsert standing
                        await prisma.lolStanding.upsert({
                          where: {
                            leagueId_tournamentId_orgSlug_stage: {
                              leagueId: league.id,
                              tournamentId,
                              orgSlug: team.slug,
                              stage: stage.name || 'Regular Season',
                            },
                          },
                          create: {
                            leagueId: league.id,
                            tournamentId,
                            orgSlug: team.slug,
                            stage: stage.name || 'Regular Season',
                            rank: ranking.ordinal,
                            wins: team.record?.wins || 0,
                            losses: team.record?.losses || 0,
                            winRate: team.record ? team.record.wins / (team.record.wins + team.record.losses) : 0,
                          },
                          update: {
                            rank: ranking.ordinal,
                            wins: team.record?.wins || 0,
                            losses: team.record?.losses || 0,
                            winRate: team.record ? team.record.wins / (team.record.wins + team.record.losses) : 0,
                            lastUpdated: new Date(),
                          },
                        });
                      } catch (teamError: any) {
                        console.error(`[LolTournamentService] Error syncing team ${team.slug}:`, teamError.message);
                      }
                    }
                  }
                }
              }
            }

            syncedCount++;
          } catch (tournamentError: any) {
            console.error(`[LolTournamentService] Error syncing tournament ${apiTournament.slug}:`, tournamentError.message);
          }
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (leagueError: any) {
        console.error(`[LolTournamentService] Error processing league ${league.id}:`, leagueError.message);
      }
    }

    console.log(`[LolTournamentService] Synced ${syncedCount} tournaments`);
    return syncedCount;
  } catch (error: any) {
    console.error('[LolTournamentService] Sync error:', error.message);
    throw error;
  }
}

// ============== RETRIEVAL FUNCTIONS ==============

/**
 * Get all tournaments with filters
 */
async function getAllTournaments(filters: TournamentFilters = {}) {
  const { league, tier, year, completed, upcoming, limit = 50, offset = 0 } = filters;

  const where: any = {};

  if (league) {
    // Try to find league by name or slug
    const leagueRecord = await prisma.lolLeague.findFirst({
      where: {
        OR: [
          { slug: league.toLowerCase() },
          { name: { contains: league, mode: 'insensitive' } },
          { shortName: { equals: league, mode: 'insensitive' } },
        ],
      },
    });
    if (leagueRecord) {
      where.leagueId = leagueRecord.leagueId;
    }
  }

  if (tier) {
    where.tier = tier;
  }

  if (year) {
    where.startDate = {
      gte: new Date(`${year}-01-01`),
      lt: new Date(`${year + 1}-01-01`),
    };
  }

  if (completed !== undefined) {
    where.isCompleted = completed;
  }

  if (upcoming) {
    where.startDate = { gt: new Date() };
    where.isCompleted = false;
  }

  const [tournaments, total] = await Promise.all([
    prisma.lolTournament.findMany({
      where,
      include: {
        league: {
          select: {
            name: true,
            slug: true,
            shortName: true,
            region: true,
            imageUrl: true,
          },
        },
      },
      orderBy: { startDate: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.lolTournament.count({ where }),
  ]);

  return {
    tournaments: tournaments.map(t => ({
      tournamentId: t.tournamentId,
      name: t.name,
      slug: t.slug,
      tier: t.tier,
      league: t.league,
      startDate: t.startDate,
      endDate: t.endDate,
      prizePool: t.prizePool ? Number(t.prizePool) : null,
      prizePoolUsd: t.prizePoolUsd ? Number(t.prizePoolUsd) : null,
      location: t.location,
      venue: t.venue,
      isCompleted: t.isCompleted,
      isInternational: t.isInternational,
    })),
    total,
    limit,
    offset,
  };
}

/**
 * Get tournament by ID
 */
async function getTournamentById(tournamentId: string) {
  const tournament = await prisma.lolTournament.findUnique({
    where: { tournamentId },
    include: {
      league: {
        select: {
          name: true,
          slug: true,
          shortName: true,
          region: true,
          imageUrl: true,
        },
      },
      results: {
        include: {
          organization: {
            select: {
              name: true,
              logoUrl: true,
            },
          },
        },
        orderBy: { rank: 'asc' },
      },
      matches: {
        include: {
          team1: { select: { name: true, logoUrl: true } },
          team2: { select: { name: true, logoUrl: true } },
        },
        orderBy: { startTime: 'desc' },
        take: 20,
      },
    },
  });

  if (!tournament) {
    throw new Error(`Tournament not found: ${tournamentId}`);
  }

  return {
    tournamentId: tournament.tournamentId,
    name: tournament.name,
    slug: tournament.slug,
    tier: tournament.tier,
    league: tournament.league,
    startDate: tournament.startDate,
    endDate: tournament.endDate,
    prizePool: tournament.prizePool ? Number(tournament.prizePool) : null,
    prizePoolUsd: tournament.prizePoolUsd ? Number(tournament.prizePoolUsd) : null,
    format: tournament.format,
    location: tournament.location,
    venue: tournament.venue,
    patch: tournament.patch,
    isCompleted: tournament.isCompleted,
    isInternational: tournament.isInternational,
    wikiUrl: tournament.wikiUrl,
    results: tournament.results.map(r => ({
      rank: r.rank,
      orgSlug: r.orgSlug,
      teamName: r.organization.name,
      logoUrl: r.organization.logoUrl,
      prizeMoney: r.prizeMoney ? Number(r.prizeMoney) : null,
      prizeMoneyUsd: r.prizeMoneyUsd ? Number(r.prizeMoneyUsd) : null,
      wins: r.wins,
      losses: r.losses,
      gameWins: r.gameWins,
      gameLosses: r.gameLosses,
    })),
    recentMatches: tournament.matches.map(m => ({
      matchId: m.matchId,
      round: m.round,
      team1: {
        slug: m.team1Slug,
        name: m.team1.name,
        logoUrl: m.team1.logoUrl,
        score: m.team1Score,
      },
      team2: {
        slug: m.team2Slug,
        name: m.team2.name,
        logoUrl: m.team2.logoUrl,
        score: m.team2Score,
      },
      winnerSlug: m.winnerSlug,
      state: m.state,
      startTime: m.startTime,
    })),
  };
}

/**
 * Get tournament standings
 */
async function getTournamentStandings(tournamentId: string): Promise<TournamentStanding[]> {
  const standings = await prisma.lolStanding.findMany({
    where: { tournamentId },
    include: {
      organization: {
        select: {
          name: true,
          logoUrl: true,
        },
      },
    },
    orderBy: { rank: 'asc' },
  });

  return standings.map(s => ({
    rank: s.rank,
    orgSlug: s.orgSlug,
    teamName: s.organization.name,
    logoUrl: s.organization.logoUrl,
    wins: s.wins,
    losses: s.losses,
    winRate: s.winRate ? Number(s.winRate) : s.wins / Math.max(s.wins + s.losses, 1),
    gameWins: s.gameWins,
    gameLosses: s.gameLosses,
    gameWinRate: s.gameWinRate ? Number(s.gameWinRate) : s.gameWins / Math.max(s.gameWins + s.gameLosses, 1),
    streak: s.streak,
  }));
}

/**
 * Get tournament bracket structure
 */
async function getTournamentBracket(tournamentId: string): Promise<TournamentBracket> {
  // First try to get from API if we have esportsApiId
  const tournament = await prisma.lolTournament.findUnique({
    where: { tournamentId },
    select: { esportsApiId: true },
  });

  if (tournament?.esportsApiId) {
    try {
      const apiStandings = await lolEsportsApiService.getStandings(tournament.esportsApiId);

      if (apiStandings.stages && apiStandings.stages.length > 0) {
        return {
          stages: apiStandings.stages.map(stage => ({
            name: stage.name,
            type: stage.type,
            sections: stage.sections.map(section => ({
              name: section.name,
              matches: section.rankings.map(r => ({
                matchId: '',
                round: null,
                team1: {
                  slug: r.teams[0]?.slug || '',
                  name: r.teams[0]?.name || '',
                  logoUrl: r.teams[0]?.image || null,
                  score: r.teams[0]?.record?.wins || null,
                },
                team2: {
                  slug: '',
                  name: '',
                  logoUrl: null,
                  score: null,
                },
                winnerSlug: null,
                state: null,
                startTime: null,
              })),
            })),
          })),
        };
      }
    } catch (error: any) {
      console.error('[LolTournamentService] Error fetching bracket from API:', error.message);
    }
  }

  // Fallback to database matches
  const matches = await prisma.lolMatch.findMany({
    where: { tournamentId },
    include: {
      team1: { select: { name: true, logoUrl: true } },
      team2: { select: { name: true, logoUrl: true } },
    },
    orderBy: [{ blockName: 'asc' }, { startTime: 'asc' }],
  });

  // Group matches by round/block
  const roundGroups = new Map<string, typeof matches>();
  for (const match of matches) {
    const round = match.blockName || match.round || 'Unknown';
    if (!roundGroups.has(round)) {
      roundGroups.set(round, []);
    }
    roundGroups.get(round)!.push(match);
  }

  const sections: BracketSection[] = Array.from(roundGroups.entries()).map(([name, roundMatches]) => ({
    name,
    matches: roundMatches.map(m => ({
      matchId: m.matchId,
      round: m.round,
      team1: {
        slug: m.team1Slug,
        name: m.team1.name,
        logoUrl: m.team1.logoUrl,
        score: m.team1Score,
      },
      team2: {
        slug: m.team2Slug,
        name: m.team2.name,
        logoUrl: m.team2.logoUrl,
        score: m.team2Score,
      },
      winnerSlug: m.winnerSlug,
      state: m.state,
      startTime: m.startTime,
    })),
  }));

  return {
    stages: [{
      name: 'Tournament',
      type: 'bracket',
      sections,
    }],
  };
}

/**
 * Get tournament matches with filters
 */
async function getTournamentMatches(tournamentId: string, filters: MatchFilters = {}) {
  const { round, team, completed, limit = 50, offset = 0 } = filters;

  const where: any = { tournamentId };

  if (round) {
    where.OR = [
      { round: { contains: round, mode: 'insensitive' } },
      { blockName: { contains: round, mode: 'insensitive' } },
    ];
  }

  if (team) {
    where.OR = [
      { team1Slug: team },
      { team2Slug: team },
    ];
  }

  if (completed !== undefined) {
    where.state = completed ? 'completed' : { not: 'completed' };
  }

  const [matches, total] = await Promise.all([
    prisma.lolMatch.findMany({
      where,
      include: {
        team1: { select: { name: true, logoUrl: true } },
        team2: { select: { name: true, logoUrl: true } },
        games: {
          select: {
            gameId: true,
            gameNumber: true,
            winnerSlug: true,
            duration: true,
          },
          orderBy: { gameNumber: 'asc' },
        },
      },
      orderBy: { startTime: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.lolMatch.count({ where }),
  ]);

  return {
    matches: matches.map(m => ({
      matchId: m.matchId,
      round: m.round,
      blockName: m.blockName,
      team1: {
        slug: m.team1Slug,
        name: m.team1.name,
        logoUrl: m.team1.logoUrl,
        score: m.team1Score,
      },
      team2: {
        slug: m.team2Slug,
        name: m.team2.name,
        logoUrl: m.team2.logoUrl,
        score: m.team2Score,
      },
      winnerSlug: m.winnerSlug,
      strategy: m.strategy,
      state: m.state,
      startTime: m.startTime,
      endTime: m.endTime,
      vodUrl: m.vodUrl,
      games: m.games.map(g => ({
        gameId: g.gameId,
        gameNumber: g.gameNumber,
        winnerSlug: g.winnerSlug,
        duration: g.duration,
      })),
    })),
    total,
    limit,
    offset,
  };
}

/**
 * Get tournament results (final placements with prizes)
 */
async function getTournamentResults(tournamentId: string): Promise<TournamentResult[]> {
  const results = await prisma.lolTournamentResult.findMany({
    where: { tournamentId },
    include: {
      organization: {
        select: {
          name: true,
          logoUrl: true,
        },
      },
    },
    orderBy: { rank: 'asc' },
  });

  return results.map(r => ({
    rank: r.rank,
    orgSlug: r.orgSlug,
    teamName: r.organization.name,
    logoUrl: r.organization.logoUrl,
    prizeMoney: r.prizeMoney ? Number(r.prizeMoney) : null,
    prizeMoneyUsd: r.prizeMoneyUsd ? Number(r.prizeMoneyUsd) : null,
    wins: r.wins,
    losses: r.losses,
    gameWins: r.gameWins,
    gameLosses: r.gameLosses,
  }));
}

/**
 * Get tournament-wide stats
 */
async function getTournamentStats(tournamentId: string): Promise<TournamentStats> {
  // Get all games for this tournament
  const games = await prisma.lolGame.findMany({
    where: {
      match: { tournamentId },
    },
    include: {
      playerStats: true,
    },
  });

  if (games.length === 0) {
    return {
      totalGames: 0,
      totalKills: 0,
      avgGameDuration: 0,
      mostPickedChampions: [],
      mostBannedChampions: [],
      topKillers: [],
      highestKDA: [],
      firstBloodRate: [],
    };
  }

  // Calculate stats
  const totalGames = games.length;
  let totalKills = 0;
  let totalDuration = 0;
  const championPicks = new Map<number, { name: string; picks: number; wins: number }>();
  const championBans = new Map<number, { name: string; bans: number }>();
  const playerStats = new Map<string, {
    teamSlug: string;
    kills: number;
    deaths: number;
    assists: number;
    games: number;
  }>();
  const teamFirstBloods = new Map<string, { teamName: string; firstBloods: number; games: number }>();

  for (const game of games) {
    // Duration
    if (game.duration) {
      totalDuration += game.duration;
    }

    // Kills
    totalKills += (game.blueKills || 0) + (game.redKills || 0);

    // First blood
    if (game.firstBlood) {
      const teamSlug = game.firstBlood === 'blue' ? game.blueTeamSlug : game.redTeamSlug;
      if (!teamFirstBloods.has(teamSlug)) {
        teamFirstBloods.set(teamSlug, { teamName: teamSlug, firstBloods: 0, games: 0 });
      }
      const fb = teamFirstBloods.get(teamSlug)!;
      fb.firstBloods++;
    }

    // Track games for all teams
    for (const teamSlug of [game.blueTeamSlug, game.redTeamSlug]) {
      if (!teamFirstBloods.has(teamSlug)) {
        teamFirstBloods.set(teamSlug, { teamName: teamSlug, firstBloods: 0, games: 0 });
      }
      teamFirstBloods.get(teamSlug)!.games++;
    }

    // Bans
    for (const ban of [...(game.blueBans as number[] || []), ...(game.redBans as number[] || [])]) {
      if (!championBans.has(ban)) {
        championBans.set(ban, { name: `Champion ${ban}`, bans: 0 });
      }
      championBans.get(ban)!.bans++;
    }

    // Player stats
    for (const ps of game.playerStats) {
      // Champion picks
      if (!championPicks.has(ps.championId)) {
        championPicks.set(ps.championId, { name: ps.championName, picks: 0, wins: 0 });
      }
      const cp = championPicks.get(ps.championId)!;
      cp.picks++;
      if (game.winnerSlug === ps.teamSlug) {
        cp.wins++;
      }

      // Player aggregated stats
      const key = `${ps.playerName}|${ps.teamSlug}`;
      if (!playerStats.has(key)) {
        playerStats.set(key, { teamSlug: ps.teamSlug, kills: 0, deaths: 0, assists: 0, games: 0 });
      }
      const pStats = playerStats.get(key)!;
      pStats.kills += ps.kills;
      pStats.deaths += ps.deaths;
      pStats.assists += ps.assists;
      pStats.games++;
    }
  }

  // Convert to arrays and sort
  const mostPickedChampions = Array.from(championPicks.entries())
    .map(([championId, data]) => ({
      championId,
      championName: data.name,
      picks: data.picks,
      wins: data.wins,
      winRate: data.picks > 0 ? data.wins / data.picks : 0,
    }))
    .sort((a, b) => b.picks - a.picks)
    .slice(0, 10);

  const mostBannedChampions = Array.from(championBans.entries())
    .map(([championId, data]) => ({
      championId,
      championName: data.name,
      bans: data.bans,
    }))
    .sort((a, b) => b.bans - a.bans)
    .slice(0, 10);

  const playerArray = Array.from(playerStats.entries()).map(([key, data]) => {
    const playerName = key.split('|')[0] || 'Unknown';
    const kda = data.deaths > 0 ? (data.kills + data.assists) / data.deaths : data.kills + data.assists;
    return {
      playerName,
      teamSlug: data.teamSlug,
      kills: data.kills,
      deaths: data.deaths,
      assists: data.assists,
      kda,
      gamesPlayed: data.games,
    };
  });

  const topKillers = [...playerArray]
    .sort((a, b) => b.kills - a.kills)
    .slice(0, 10);

  const highestKDA = [...playerArray]
    .filter(p => p.gamesPlayed >= 3) // Minimum games threshold
    .sort((a, b) => b.kda - a.kda)
    .slice(0, 10);

  const firstBloodRate = Array.from(teamFirstBloods.entries())
    .map(([teamSlug, data]) => ({
      teamSlug,
      teamName: data.teamName,
      firstBloods: data.firstBloods,
      games: data.games,
      rate: data.games > 0 ? data.firstBloods / data.games : 0,
    }))
    .sort((a, b) => b.rate - a.rate);

  return {
    totalGames,
    totalKills,
    avgGameDuration: totalGames > 0 ? Math.round(totalDuration / totalGames) : 0,
    mostPickedChampions,
    mostBannedChampions,
    topKillers,
    highestKDA,
    firstBloodRate,
  };
}

/**
 * Get tournament MVP
 */
async function getTournamentMVP(tournamentId: string): Promise<TournamentMVP | null> {
  // Get all player stats for this tournament
  const playerStats = await prisma.lolGamePlayerStats.findMany({
    where: {
      game: {
        match: { tournamentId },
      },
    },
    include: {
      player: {
        select: {
          lolPlayerId: true,
          currentIgn: true,
          role: true,
          imageUrl: true,
        },
      },
      game: {
        select: {
          winnerSlug: true,
          duration: true,
        },
      },
    },
  });

  if (playerStats.length === 0) {
    return null;
  }

  // Aggregate stats by player
  const aggregated = new Map<string, {
    playerName: string;
    lolPlayerId: string | null;
    teamSlug: string;
    role: string | null;
    imageUrl: string | null;
    gamesPlayed: number;
    wins: number;
    kills: number;
    deaths: number;
    assists: number;
    cs: number;
    gold: number;
    damage: number;
    killParticipation: number;
    damageShare: number;
    champions: Map<number, { name: string; games: number; wins: number }>;
  }>();

  for (const ps of playerStats) {
    const key = ps.playerName;
    if (!aggregated.has(key)) {
      aggregated.set(key, {
        playerName: ps.playerName,
        lolPlayerId: ps.player?.lolPlayerId || null,
        teamSlug: ps.teamSlug,
        role: ps.player?.role || ps.role,
        imageUrl: ps.player?.imageUrl || null,
        gamesPlayed: 0,
        wins: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        cs: 0,
        gold: 0,
        damage: 0,
        killParticipation: 0,
        damageShare: 0,
        champions: new Map(),
      });
    }

    const agg = aggregated.get(key)!;
    agg.gamesPlayed++;
    if (ps.game.winnerSlug === ps.teamSlug) {
      agg.wins++;
    }
    agg.kills += ps.kills;
    agg.deaths += ps.deaths;
    agg.assists += ps.assists;
    agg.cs += ps.cs;
    agg.gold += ps.gold;
    agg.damage += ps.damageDealt || 0;
    agg.killParticipation += ps.killParticipation ? Number(ps.killParticipation) : 0;
    agg.damageShare += ps.damageShare ? Number(ps.damageShare) : 0;

    // Track champion usage
    if (!agg.champions.has(ps.championId)) {
      agg.champions.set(ps.championId, { name: ps.championName, games: 0, wins: 0 });
    }
    const champ = agg.champions.get(ps.championId)!;
    champ.games++;
    if (ps.game.winnerSlug === ps.teamSlug) {
      champ.wins++;
    }
  }

  // Calculate MVP score for each player
  // Score = (KDA * 2) + (Win Rate * 3) + (Kill Participation * 1.5) + (Games Played * 0.1)
  let mvp: any = null;
  let maxScore = -Infinity;

  const aggregatedArray = Array.from(aggregated.values());
  for (const data of aggregatedArray) {
    if (data.gamesPlayed < 3) continue; // Minimum games threshold

    const kda = data.deaths > 0 ? (data.kills + data.assists) / data.deaths : data.kills + data.assists;
    const winRate = data.gamesPlayed > 0 ? data.wins / data.gamesPlayed : 0;
    const avgKP = data.gamesPlayed > 0 ? data.killParticipation / data.gamesPlayed : 0;

    const score = (kda * 2) + (winRate * 3) + (avgKP * 1.5) + (data.gamesPlayed * 0.1);

    if (score > maxScore) {
      maxScore = score;
      mvp = data;
    }
  }

  if (!mvp) {
    return null;
  }

  // Build achievements list
  const achievements: string[] = [];
  const kda = mvp.deaths > 0 ? (mvp.kills + mvp.assists) / mvp.deaths : mvp.kills + mvp.assists;
  const winRate = mvp.gamesPlayed > 0 ? mvp.wins / mvp.gamesPlayed : 0;

  if (kda >= 5) achievements.push('Elite KDA (5.0+)');
  if (kda >= 3) achievements.push('Excellent KDA (3.0+)');
  if (winRate >= 0.75) achievements.push('Dominant Win Rate (75%+)');
  if (winRate >= 0.6) achievements.push('Strong Win Rate (60%+)');
  if (mvp.kills >= 50) achievements.push('50+ Tournament Kills');
  if (mvp.gamesPlayed >= 10) achievements.push('10+ Games Played');

  // Get team name
  const org = await prisma.lolOrganization.findUnique({
    where: { slug: mvp.teamSlug },
    select: { name: true },
  });

  return {
    playerName: mvp.playerName,
    lolPlayerId: mvp.lolPlayerId,
    teamSlug: mvp.teamSlug,
    teamName: org?.name || mvp.teamSlug,
    role: mvp.role,
    imageUrl: mvp.imageUrl,
    stats: {
      gamesPlayed: mvp.gamesPlayed,
      kills: mvp.kills,
      deaths: mvp.deaths,
      assists: mvp.assists,
      kda,
      avgKills: mvp.gamesPlayed > 0 ? mvp.kills / mvp.gamesPlayed : 0,
      avgDeaths: mvp.gamesPlayed > 0 ? mvp.deaths / mvp.gamesPlayed : 0,
      avgAssists: mvp.gamesPlayed > 0 ? mvp.assists / mvp.gamesPlayed : 0,
      avgCs: mvp.gamesPlayed > 0 ? mvp.cs / mvp.gamesPlayed : 0,
      avgGold: mvp.gamesPlayed > 0 ? mvp.gold / mvp.gamesPlayed : 0,
      killParticipation: mvp.gamesPlayed > 0 ? mvp.killParticipation / mvp.gamesPlayed : 0,
      damageShare: mvp.gamesPlayed > 0 ? mvp.damageShare / mvp.gamesPlayed : 0,
    },
    championPool: (Array.from(mvp.champions.entries()) as [number, { name: string; games: number; wins: number }][])
      .map(([championId, data]) => ({
        championId,
        championName: data.name,
        games: data.games,
        wins: data.wins,
        winRate: data.games > 0 ? data.wins / data.games : 0,
      }))
      .sort((a, b) => b.games - a.games),
    achievements,
  };
}

// ============== EXPORT SERVICE ==============

export const lolTournamentService = {
  syncTournaments,
  getAllTournaments,
  getTournamentById,
  getTournamentStandings,
  getTournamentBracket,
  getTournamentMatches,
  getTournamentResults,
  getTournamentStats,
  getTournamentMVP,
};
