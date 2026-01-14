import { prisma } from '../../db/client.js';
import { lolEsportsApiService } from './lol-esports-api.service.js';
import { Prisma } from '@prisma/client';

/**
 * League filter options for querying leagues
 */
export interface LeagueFilters {
  region?: string;
  tier?: string;
  isActive?: boolean;
}

/**
 * Schedule filters for retrieving league schedules
 */
export interface ScheduleFilters {
  startDate?: Date;
  endDate?: Date;
  state?: 'completed' | 'inProgress' | 'unstarted';
  pageToken?: string;
}

/**
 * Standings response structure
 */
export interface LeagueStandings {
  leagueId: string;
  leagueName: string;
  tournamentId?: string;
  stage?: string;
  rankings: Array<{
    rank: number;
    orgSlug: string;
    teamName: string;
    wins: number;
    losses: number;
    winRate: number;
    gameWins: number;
    gameLosses: number;
    gameWinRate: number;
    streak?: string;
  }>;
}

/**
 * Historical season data
 */
export interface LeagueHistoryEntry {
  tournamentId: string;
  name: string;
  season?: string;
  startDate?: Date;
  endDate?: Date;
  winner?: {
    orgSlug: string;
    teamName: string;
  };
  prizePool?: number;
  isCompleted: boolean;
}

/**
 * Sync result structure
 */
export interface SyncResult {
  synced: number;
  created: number;
  updated: number;
  errors: string[];
}

// ============== SERVICE FUNCTIONS ==============

/**
 * Syncs leagues from the LoL Esports API to the database
 * Creates new leagues and updates existing ones
 * @returns Sync result with counts and any errors
 */
async function syncLeagues(): Promise<SyncResult> {
  const result: SyncResult = {
    synced: 0,
    created: 0,
    updated: 0,
    errors: [],
  };

  try {
    // Fetch leagues from the esports API
    const apiLeagues = await lolEsportsApiService.getLeagues();

    for (const league of apiLeagues) {
      try {
        // Map region from API to our standard format
        const normalizedRegion = normalizeRegion(league.region);
        const tier = determineTier(league.priority);

        // Check if league already exists
        const existingLeague = await prisma.lolLeague.findFirst({
          where: {
            OR: [
              { esportsApiId: league.id },
              { slug: league.slug },
            ],
          },
        });

        const leagueData = {
          esportsApiId: league.id,
          name: league.name,
          slug: league.slug,
          region: normalizedRegion,
          tier,
          imageUrl: league.image,
          priority: league.priority,
          isActive: true,
          lastUpdated: new Date(),
        };

        if (existingLeague) {
          // Update existing league
          await prisma.lolLeague.update({
            where: { leagueId: existingLeague.leagueId },
            data: leagueData,
          });
          result.updated++;
        } else {
          // Create new league
          await prisma.lolLeague.create({
            data: {
              leagueId: `lol_league_${league.slug}`,
              ...leagueData,
            },
          });
          result.created++;
        }
        result.synced++;
      } catch (error: any) {
        result.errors.push(`Failed to sync league ${league.slug}: ${error.message}`);
      }
    }

    console.log(`[LolLeagueService] Synced ${result.synced} leagues (${result.created} created, ${result.updated} updated)`);
    return result;
  } catch (error: any) {
    console.error('[LolLeagueService] Error syncing leagues:', error.message);
    result.errors.push(`Sync failed: ${error.message}`);
    return result;
  }
}

/**
 * Gets all leagues with optional filtering
 * @param filters - Optional filters for region, tier, and active status
 * @returns Array of leagues matching the filters
 */
async function getAllLeagues(filters?: LeagueFilters) {
  try {
    const where: Prisma.LolLeagueWhereInput = {};

    if (filters?.region) {
      where.region = filters.region;
    }

    if (filters?.tier) {
      where.tier = filters.tier;
    }

    if (filters?.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    const leagues = await prisma.lolLeague.findMany({
      where,
      orderBy: [
        { priority: 'asc' },
        { name: 'asc' },
      ],
      include: {
        _count: {
          select: {
            tournaments: true,
            teams: true,
          },
        },
      },
    });

    return leagues;
  } catch (error: any) {
    console.error('[LolLeagueService] Error getting leagues:', error.message);
    throw new Error(`Failed to get leagues: ${error.message}`);
  }
}

/**
 * Gets a single league by its ID
 * @param leagueId - The league ID to look up
 * @returns The league if found, null otherwise
 */
async function getLeagueById(leagueId: string) {
  try {
    const league = await prisma.lolLeague.findUnique({
      where: { leagueId },
      include: {
        tournaments: {
          orderBy: { startDate: 'desc' },
          take: 10,
        },
        teams: {
          where: { isActive: true },
          include: {
            organization: true,
          },
        },
        _count: {
          select: {
            tournaments: true,
            teams: true,
          },
        },
      },
    });

    return league;
  } catch (error: any) {
    console.error('[LolLeagueService] Error getting league by ID:', error.message);
    throw new Error(`Failed to get league: ${error.message}`);
  }
}

/**
 * Gets a league by its slug
 * @param slug - The league slug (e.g., 'lck', 'lec', 'lcs')
 * @returns The league if found, null otherwise
 */
async function getLeagueBySlug(slug: string) {
  try {
    const league = await prisma.lolLeague.findUnique({
      where: { slug },
      include: {
        tournaments: {
          orderBy: { startDate: 'desc' },
          take: 10,
        },
        teams: {
          where: { isActive: true },
          include: {
            organization: true,
          },
        },
        _count: {
          select: {
            tournaments: true,
            teams: true,
          },
        },
      },
    });

    return league;
  } catch (error: any) {
    console.error('[LolLeagueService] Error getting league by slug:', error.message);
    throw new Error(`Failed to get league: ${error.message}`);
  }
}

/**
 * Gets standings for a league
 * First attempts to fetch from database, then falls back to API if needed
 * @param leagueId - The league ID
 * @param tournamentId - Optional tournament ID for specific tournament standings
 * @param stage - Optional stage filter (e.g., 'Regular Season', 'Playoffs')
 * @returns League standings
 */
async function getLeagueStandings(
  leagueId: string,
  tournamentId?: string,
  stage?: string
): Promise<LeagueStandings | null> {
  try {
    // First, get the league details
    const league = await prisma.lolLeague.findUnique({
      where: { leagueId },
    });

    if (!league) {
      return null;
    }

    // If no tournament specified, get the most recent active tournament
    let targetTournamentId = tournamentId;
    if (!targetTournamentId) {
      const latestTournament = await prisma.lolTournament.findFirst({
        where: {
          leagueId,
          isCompleted: false,
        },
        orderBy: { startDate: 'desc' },
      });

      if (latestTournament) {
        targetTournamentId = latestTournament.tournamentId;
      }
    }

    // Try to get standings from database
    const dbStandings = await prisma.lolStanding.findMany({
      where: {
        leagueId,
        ...(targetTournamentId && { tournamentId: targetTournamentId }),
        ...(stage && { stage }),
      },
      orderBy: { rank: 'asc' },
      include: {
        organization: true,
      },
    });

    if (dbStandings.length > 0) {
      return {
        leagueId,
        leagueName: league.name,
        tournamentId: targetTournamentId || undefined,
        stage: stage || dbStandings[0]!.stage || undefined,
        rankings: dbStandings.map((standing) => ({
          rank: standing.rank,
          orgSlug: standing.orgSlug,
          teamName: standing.organization.name,
          wins: standing.wins,
          losses: standing.losses,
          winRate: standing.winRate ? Number(standing.winRate) : 0,
          gameWins: standing.gameWins,
          gameLosses: standing.gameLosses,
          gameWinRate: standing.gameWinRate ? Number(standing.gameWinRate) : 0,
          streak: standing.streak || undefined,
        })),
      };
    }

    // If no standings in DB and we have an esports API ID, try fetching from API
    if (league.esportsApiId && targetTournamentId) {
      const tournament = await prisma.lolTournament.findUnique({
        where: { tournamentId: targetTournamentId },
      });

      if (tournament?.esportsApiId) {
        const apiStandings = await lolEsportsApiService.getStandings(tournament.esportsApiId);

        if (apiStandings && apiStandings.stages.length > 0) {
          // Parse API standings and return
          const targetStage = stage
            ? apiStandings.stages.find((s) => s.name.toLowerCase().includes(stage.toLowerCase()))
            : apiStandings.stages[0];

          if (targetStage && targetStage.sections.length > 0) {
            const rankings = targetStage.sections[0]!.rankings.flatMap((ranking) =>
              ranking.teams.map((team) => ({
                rank: ranking.ordinal,
                orgSlug: team.slug,
                teamName: team.name,
                wins: team.record.wins,
                losses: team.record.losses,
                winRate: team.record.wins + team.record.losses > 0
                  ? team.record.wins / (team.record.wins + team.record.losses)
                  : 0,
                gameWins: 0,
                gameLosses: 0,
                gameWinRate: 0,
              }))
            );

            return {
              leagueId,
              leagueName: league.name,
              tournamentId: targetTournamentId,
              stage: targetStage.name,
              rankings,
            };
          }
        }
      }
    }

    return null;
  } catch (error: any) {
    console.error('[LolLeagueService] Error getting standings:', error.message);
    throw new Error(`Failed to get standings: ${error.message}`);
  }
}

/**
 * Gets the schedule for a league
 * @param leagueId - The league ID
 * @param filters - Optional filters for date range and match state
 * @returns Array of scheduled matches/events
 */
async function getLeagueSchedule(leagueId: string, filters?: ScheduleFilters) {
  try {
    const league = await prisma.lolLeague.findUnique({
      where: { leagueId },
    });

    if (!league) {
      return null;
    }

    // Build match query
    const where: Prisma.LolMatchWhereInput = {
      tournament: {
        leagueId,
      },
    };

    if (filters?.startDate || filters?.endDate) {
      where.startTime = {};
      if (filters.startDate) {
        where.startTime.gte = filters.startDate;
      }
      if (filters.endDate) {
        where.startTime.lte = filters.endDate;
      }
    }

    if (filters?.state) {
      where.state = filters.state;
    }

    // Get matches from database
    const matches = await prisma.lolMatch.findMany({
      where,
      orderBy: { startTime: 'asc' },
      include: {
        team1: true,
        team2: true,
        tournament: true,
      },
      take: 50,
    });

    // If we have an esports API ID and want fresh data, also check the API
    if (league.esportsApiId && matches.length === 0) {
      try {
        const apiSchedule = await lolEsportsApiService.getSchedule(league.esportsApiId, filters?.pageToken);

        return {
          leagueId,
          leagueName: league.name,
          events: apiSchedule.events.map((event) => ({
            startTime: event.startTime,
            state: event.state,
            type: event.type,
            blockName: event.blockName,
            matchId: event.match.id,
            teams: event.match.teams.map((team) => ({
              slug: team.slug,
              name: team.name,
              code: team.code,
              imageUrl: team.image,
              score: team.result?.gameWins,
              outcome: team.result?.outcome,
              record: team.record,
            })),
            strategy: event.match.strategy,
          })),
          pages: apiSchedule.pages,
        };
      } catch (apiError: any) {
        console.warn('[LolLeagueService] API schedule fetch failed:', apiError.message);
      }
    }

    return {
      leagueId,
      leagueName: league.name,
      events: matches.map((match) => ({
        startTime: match.startTime?.toISOString(),
        state: match.state,
        type: 'match',
        blockName: match.blockName,
        matchId: match.matchId,
        teams: [
          {
            slug: match.team1Slug,
            name: match.team1.name,
            code: match.team1.shortName,
            imageUrl: match.team1.logoUrl,
            score: match.team1Score,
            outcome: match.winnerSlug === match.team1Slug ? 'win' : match.winnerSlug ? 'loss' : undefined,
          },
          {
            slug: match.team2Slug,
            name: match.team2.name,
            code: match.team2.shortName,
            imageUrl: match.team2.logoUrl,
            score: match.team2Score,
            outcome: match.winnerSlug === match.team2Slug ? 'win' : match.winnerSlug ? 'loss' : undefined,
          },
        ],
        strategy: { type: match.strategy?.includes('5') ? 'bestOf' : 'bestOf', count: parseInt(match.strategy?.replace(/\D/g, '') || '1') },
      })),
      pages: {},
    };
  } catch (error: any) {
    console.error('[LolLeagueService] Error getting schedule:', error.message);
    throw new Error(`Failed to get schedule: ${error.message}`);
  }
}

/**
 * Gets historical seasons and winners for a league
 * @param leagueId - The league ID
 * @param limit - Maximum number of historical entries to return (default 20)
 * @returns Array of historical season data
 */
async function getLeagueHistory(leagueId: string, limit: number = 20): Promise<LeagueHistoryEntry[]> {
  try {
    // Get all completed tournaments for this league
    const tournaments = await prisma.lolTournament.findMany({
      where: {
        leagueId,
        isCompleted: true,
      },
      orderBy: { startDate: 'desc' },
      take: limit,
      include: {
        results: {
          where: { rank: 1 },
          include: {
            organization: true,
          },
        },
      },
    });

    return tournaments.map((tournament) => {
      const winner = tournament.results[0];
      return {
        tournamentId: tournament.tournamentId,
        name: tournament.name,
        season: extractSeasonFromName(tournament.name),
        startDate: tournament.startDate || undefined,
        endDate: tournament.endDate || undefined,
        winner: winner
          ? {
              orgSlug: winner.orgSlug,
              teamName: winner.organization.name,
            }
          : undefined,
        prizePool: tournament.prizePool ? Number(tournament.prizePool) : undefined,
        isCompleted: tournament.isCompleted,
      };
    });
  } catch (error: any) {
    console.error('[LolLeagueService] Error getting league history:', error.message);
    throw new Error(`Failed to get league history: ${error.message}`);
  }
}

/**
 * Gets all teams currently in a league
 * @param leagueId - The league ID
 * @param includeFormer - Whether to include former teams (default false)
 * @returns Array of teams in the league
 */
async function getLeagueTeams(leagueId: string, includeFormer: boolean = false) {
  try {
    const where: Prisma.LolLeagueTeamWhereInput = {
      leagueId,
    };

    if (!includeFormer) {
      where.isActive = true;
    }

    const leagueTeams = await prisma.lolLeagueTeam.findMany({
      where,
      include: {
        organization: {
          include: {
            roster: {
              where: {
                isActive: true,
                status: 'current',
              },
              orderBy: {
                role: 'asc',
              },
            },
            _count: {
              select: {
                tournamentResults: true,
              },
            },
          },
        },
      },
      orderBy: {
        organization: {
          name: 'asc',
        },
      },
    });

    return leagueTeams.map((lt) => ({
      orgSlug: lt.orgSlug,
      name: lt.organization.name,
      shortName: lt.organization.shortName,
      logoUrl: lt.organization.logoUrl,
      region: lt.organization.region,
      isActive: lt.isActive,
      season: lt.season,
      joinedDate: lt.joinedDate,
      leftDate: lt.leftDate,
      roster: lt.organization.roster.map((r) => ({
        playerName: r.playerName,
        role: r.role,
        isStarter: r.isStarter,
      })),
      tournamentCount: lt.organization._count.tournamentResults,
    }));
  } catch (error: any) {
    console.error('[LolLeagueService] Error getting league teams:', error.message);
    throw new Error(`Failed to get league teams: ${error.message}`);
  }
}

// ============== HELPER FUNCTIONS ==============

/**
 * Normalizes region strings from the API to a standard format
 * @param region - Raw region string from API
 * @returns Normalized region code
 */
function normalizeRegion(region: string): string {
  const regionMap: Record<string, string> = {
    'NORTH_AMERICA': 'NA',
    'EUROPE': 'EU',
    'KOREA': 'KR',
    'CHINA': 'CN',
    'TAIWAN': 'TW',
    'ASIA_PACIFIC': 'APAC',
    'ASIA': 'APAC',
    'BRAZIL': 'BR',
    'LATIN_AMERICA': 'LATAM',
    'JAPAN': 'JP',
    'OCEANIA': 'OCE',
    'TURKEY': 'TR',
    'VIETNAM': 'VN',
    'RUSSIA': 'CIS',
    'INTERNATIONAL': 'INT',
    'WORLD': 'INT',
  };

  const upper = region.toUpperCase().replace(/\s+/g, '_');
  return regionMap[upper] || region;
}

/**
 * Determines the tier of a league based on its priority
 * @param priority - Priority value from the API
 * @returns Tier string
 */
function determineTier(priority: number): string {
  if (priority <= 100) return 'major';
  if (priority <= 200) return 'regional';
  if (priority <= 300) return 'minor';
  return 'amateur';
}

/**
 * Extracts season information from a tournament name
 * @param name - Tournament name
 * @returns Season string or undefined
 */
function extractSeasonFromName(name: string): string | undefined {
  // Try to match patterns like "Spring 2024", "Summer Split 2023", "2024 Spring"
  const patterns = [
    /(\d{4})\s*(Spring|Summer|Fall|Winter)/i,
    /(Spring|Summer|Fall|Winter)\s*(\d{4})/i,
    /(Split\s*\d+)\s*(\d{4})?/i,
    /Season\s*(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = name.match(pattern);
    if (match) {
      return match[0];
    }
  }

  return undefined;
}

// ============== EXPORT SERVICE ==============

/**
 * LoL League Service
 * Handles all League-related operations for the LoL esports data
 */
export const lolLeagueService = {
  syncLeagues,
  getAllLeagues,
  getLeagueById,
  getLeagueBySlug,
  getLeagueStandings,
  getLeagueSchedule,
  getLeagueHistory,
  getLeagueTeams,
};
