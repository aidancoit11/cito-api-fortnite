import { prisma } from '../../db/client.js';
import { lolEsportsApiService, LolScheduleEventApiResponse } from './lol-esports-api.service.js';

/**
 * LoL Schedule Service
 * Handles match schedules, filtering, and synchronization
 */

// ============== TYPES ==============

export interface ScheduleFilters {
  from?: Date;
  to?: Date;
  leagueId?: string;
  leagueSlug?: string;
  teamSlug?: string;
  live?: boolean;
  upcoming?: boolean;
  completed?: boolean;
  limit?: number;
  offset?: number;
}

export interface ScheduleMatch {
  matchId: string;
  tournamentId: string;
  tournamentName?: string;
  leagueId?: string;
  leagueName?: string;
  leagueSlug?: string;
  blockName?: string | null;
  round?: string | null;
  team1: {
    slug: string;
    name: string;
    code?: string;
    logoUrl?: string | null;
    score?: number | null;
  };
  team2: {
    slug: string;
    name: string;
    code?: string;
    logoUrl?: string | null;
    score?: number | null;
  };
  winnerSlug?: string | null;
  strategy?: string | null;
  startTime?: Date | null;
  endTime?: Date | null;
  state?: string | null;
}

export interface ScheduleResponse {
  matches: ScheduleMatch[];
  total: number;
  hasMore: boolean;
}

export interface SyncResult {
  synced: number;
  created: number;
  updated: number;
  errors: string[];
}

// ============== HELPER FUNCTIONS ==============

/**
 * Get start and end of day for a given date and timezone
 */
function getDayBounds(date: Date, timezone: string): { start: Date; end: Date } {
  try {
    // Create formatter for the timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    // Get the date parts in the target timezone
    const parts = formatter.formatToParts(date);
    const year = parseInt(parts.find(p => p.type === 'year')?.value || '0');
    const month = parseInt(parts.find(p => p.type === 'month')?.value || '0') - 1;
    const day = parseInt(parts.find(p => p.type === 'day')?.value || '0');

    // Create start of day in UTC (approximate - timezone offset handling)
    const start = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));

    // Adjust for timezone offset
    const offset = getTimezoneOffset(timezone, date);
    start.setTime(start.getTime() + offset);
    end.setTime(end.getTime() + offset);

    return { start, end };
  } catch {
    // Fallback to UTC
    const start = new Date(date);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setUTCHours(23, 59, 59, 999);
    return { start, end };
  }
}

/**
 * Get timezone offset in milliseconds
 */
function getTimezoneOffset(timezone: string, date: Date): number {
  try {
    const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
    const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
    return utcDate.getTime() - tzDate.getTime();
  } catch {
    return 0;
  }
}

/**
 * Get start and end of week (Monday to Sunday)
 */
function getWeekBounds(date: Date): { start: Date; end: Date } {
  const dayOfWeek = date.getUTCDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Adjust to get Monday

  const start = new Date(date);
  start.setUTCDate(date.getUTCDate() + diff);
  start.setUTCHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  end.setUTCHours(23, 59, 59, 999);

  return { start, end };
}

/**
 * Transform database match to schedule match format
 */
function transformDbMatch(match: any): ScheduleMatch {
  return {
    matchId: match.matchId,
    tournamentId: match.tournamentId,
    tournamentName: match.tournament?.name,
    leagueId: match.tournament?.leagueId,
    leagueName: match.tournament?.league?.name,
    leagueSlug: match.tournament?.league?.slug,
    blockName: match.blockName,
    round: match.round,
    team1: {
      slug: match.team1Slug,
      name: match.team1?.name || match.team1Slug,
      code: match.team1?.shortName,
      logoUrl: match.team1?.logoUrl,
      score: match.team1Score,
    },
    team2: {
      slug: match.team2Slug,
      name: match.team2?.name || match.team2Slug,
      code: match.team2?.shortName,
      logoUrl: match.team2?.logoUrl,
      score: match.team2Score,
    },
    winnerSlug: match.winnerSlug,
    strategy: match.strategy,
    startTime: match.startTime,
    endTime: match.endTime,
    state: match.state,
  };
}

// ============== SERVICE METHODS ==============

/**
 * Get full schedule with filters
 */
async function getFullSchedule(filters: ScheduleFilters = {}): Promise<ScheduleResponse> {
  const {
    from,
    to,
    leagueId,
    leagueSlug,
    teamSlug,
    live,
    upcoming,
    completed,
    limit = 50,
    offset = 0,
  } = filters;

  try {
    // Build where clause
    const where: any = {};

    // Date filters
    if (from || to) {
      where.startTime = {};
      if (from) where.startTime.gte = from;
      if (to) where.startTime.lte = to;
    }

    // League filters
    if (leagueId) {
      where.tournament = { leagueId };
    } else if (leagueSlug) {
      where.tournament = {
        league: { slug: leagueSlug },
      };
    }

    // Team filter
    if (teamSlug) {
      where.OR = [
        { team1Slug: teamSlug },
        { team2Slug: teamSlug },
      ];
    }

    // State filters
    const stateFilters: string[] = [];
    if (live) stateFilters.push('inProgress');
    if (upcoming) stateFilters.push('unstarted');
    if (completed) stateFilters.push('completed');

    if (stateFilters.length > 0) {
      where.state = { in: stateFilters };
    }

    // Query matches
    const [matches, total] = await Promise.all([
      prisma.lolMatch.findMany({
        where,
        include: {
          tournament: {
            include: {
              league: true,
            },
          },
          team1: true,
          team2: true,
        },
        orderBy: { startTime: 'asc' },
        take: limit,
        skip: offset,
      }),
      prisma.lolMatch.count({ where }),
    ]);

    return {
      matches: matches.map(transformDbMatch),
      total,
      hasMore: offset + matches.length < total,
    };
  } catch (error: any) {
    console.error('[LolScheduleService] Error fetching schedule:', error.message);
    throw error;
  }
}

/**
 * Get matches for today
 */
async function getTodaysMatches(
  timezone: string = 'UTC',
  leagueSlug?: string
): Promise<ScheduleMatch[]> {
  try {
    const now = new Date();
    const { start, end } = getDayBounds(now, timezone);

    const filters: ScheduleFilters = {
      from: start,
      to: end,
      limit: 100,
    };

    if (leagueSlug) {
      filters.leagueSlug = leagueSlug;
    }

    const result = await getFullSchedule(filters);
    return result.matches;
  } catch (error: any) {
    console.error('[LolScheduleService] Error fetching today\'s matches:', error.message);
    throw error;
  }
}

/**
 * Get matches for this week
 */
async function getThisWeeksMatches(leagueSlug?: string): Promise<ScheduleMatch[]> {
  try {
    const now = new Date();
    const { start, end } = getWeekBounds(now);

    const filters: ScheduleFilters = {
      from: start,
      to: end,
      limit: 200,
    };

    if (leagueSlug) {
      filters.leagueSlug = leagueSlug;
    }

    const result = await getFullSchedule(filters);
    return result.matches;
  } catch (error: any) {
    console.error('[LolScheduleService] Error fetching this week\'s matches:', error.message);
    throw error;
  }
}

/**
 * Get upcoming matches within the next X hours
 */
async function getUpcomingMatches(
  hours: number = 24,
  leagueSlug?: string
): Promise<ScheduleMatch[]> {
  try {
    const now = new Date();
    const end = new Date(now.getTime() + hours * 60 * 60 * 1000);

    const filters: ScheduleFilters = {
      from: now,
      to: end,
      upcoming: true,
      limit: 100,
    };

    if (leagueSlug) {
      filters.leagueSlug = leagueSlug;
    }

    const result = await getFullSchedule(filters);
    return result.matches;
  } catch (error: any) {
    console.error('[LolScheduleService] Error fetching upcoming matches:', error.message);
    throw error;
  }
}

/**
 * Sync schedule from the esports API
 */
async function syncScheduleFromApi(leagueId?: string): Promise<SyncResult> {
  const result: SyncResult = {
    synced: 0,
    created: 0,
    updated: 0,
    errors: [],
  };

  try {
    // Fetch schedule from API
    const { events } = await lolEsportsApiService.getSchedule(leagueId);

    if (!events || events.length === 0) {
      return result;
    }

    for (const event of events) {
      try {
        if (!event.match || event.type !== 'match') continue;

        const teams = event.match.teams || [];
        const team1 = teams[0];
        const team2 = teams[1];

        if (!team1 || !team2) continue;

        // Ensure teams exist in database
        await ensureTeamExists(team1);
        await ensureTeamExists(team2);

        // Determine winner
        let winnerSlug: string | null = null;
        if (team1.result?.outcome === 'win') winnerSlug = team1.slug;
        else if (team2.result?.outcome === 'win') winnerSlug = team2.slug;

        // Find or create tournament
        const tournamentId = await findOrCreateTournament(event);

        // Upsert match
        const matchData = {
          tournamentId,
          blockName: event.blockName || null,
          team1Slug: team1.slug,
          team2Slug: team2.slug,
          team1Score: team1.result?.gameWins ?? null,
          team2Score: team2.result?.gameWins ?? null,
          winnerSlug,
          strategy: event.match.strategy ? `Bo${event.match.strategy.count}` : null,
          startTime: event.startTime ? new Date(event.startTime) : null,
          state: event.state || null,
          lastUpdated: new Date(),
        };

        const existing = await prisma.lolMatch.findUnique({
          where: { matchId: event.match.id },
        });

        if (existing) {
          await prisma.lolMatch.update({
            where: { matchId: event.match.id },
            data: matchData,
          });
          result.updated++;
        } else {
          await prisma.lolMatch.create({
            data: {
              matchId: event.match.id,
              esportsApiId: event.match.id,
              ...matchData,
            },
          });
          result.created++;
        }

        result.synced++;
      } catch (eventError: any) {
        result.errors.push(`Failed to sync match ${event.match?.id}: ${eventError.message}`);
      }
    }

    console.log(`[LolScheduleService] Synced ${result.synced} matches (${result.created} created, ${result.updated} updated)`);
    return result;
  } catch (error: any) {
    console.error('[LolScheduleService] Error syncing schedule:', error.message);
    result.errors.push(`Sync failed: ${error.message}`);
    throw error;
  }
}

/**
 * Ensure team exists in database
 */
async function ensureTeamExists(team: {
  id: string;
  slug: string;
  name: string;
  code: string;
  image?: string;
}): Promise<void> {
  const existing = await prisma.lolOrganization.findUnique({
    where: { slug: team.slug },
  });

  if (!existing) {
    await prisma.lolOrganization.create({
      data: {
        slug: team.slug,
        esportsApiId: team.id,
        name: team.name,
        shortName: team.code,
        logoUrl: team.image || null,
        isActive: true,
      },
    });
  } else if (!existing.esportsApiId) {
    await prisma.lolOrganization.update({
      where: { slug: team.slug },
      data: { esportsApiId: team.id },
    });
  }
}

/**
 * Find or create tournament from event data
 */
async function findOrCreateTournament(event: LolScheduleEventApiResponse): Promise<string> {
  // Try to find by league and approximate date
  const leagueSlug = event.league?.slug || 'unknown';
  const eventDate = event.startTime ? new Date(event.startTime) : new Date();
  const year = eventDate.getFullYear();

  // Generate a tournament ID based on league and period
  const tournamentId = `${leagueSlug}-${year}`;

  const existing = await prisma.lolTournament.findUnique({
    where: { tournamentId },
  });

  if (existing) {
    return existing.tournamentId;
  }

  // Ensure league exists
  if (event.league) {
    const leagueExists = await prisma.lolLeague.findUnique({
      where: { leagueId: event.league.id },
    });

    if (!leagueExists) {
      await prisma.lolLeague.create({
        data: {
          leagueId: event.league.id,
          esportsApiId: event.league.id,
          name: event.league.name,
          slug: event.league.slug,
          imageUrl: event.league.image,
          region: 'UNKNOWN',
          isActive: true,
        },
      });
    }
  }

  // Create tournament
  await prisma.lolTournament.create({
    data: {
      tournamentId,
      leagueId: event.league?.id || null,
      name: `${event.league?.name || 'Unknown League'} ${year}`,
      slug: tournamentId,
      startDate: eventDate,
      isCompleted: false,
    },
  });

  return tournamentId;
}

// ============== EXPORT SERVICE ==============

export const lolScheduleService = {
  getFullSchedule,
  getTodaysMatches,
  getThisWeeksMatches,
  getUpcomingMatches,
  syncScheduleFromApi,
};
