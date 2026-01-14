import { prisma } from '../../db/client.js';
import { Prisma } from '@prisma/client';

/**
 * LoL Search Service
 * Handles search and discovery for League of Legends esports data
 */

// ============== TYPES ==============

export type SearchType = 'player' | 'team' | 'tournament' | 'all';

export interface SearchResult {
  type: 'player' | 'team' | 'tournament';
  id: string;
  name: string;
  slug?: string;
  imageUrl?: string | null;
  region?: string | null;
  metadata?: Record<string, unknown>;
}

export interface GlobalSearchResponse {
  query: string;
  type: SearchType;
  results: SearchResult[];
  totalCount: number;
}

export interface AutocompleteResult {
  type: 'player' | 'team' | 'tournament';
  id: string;
  name: string;
  slug?: string;
}

export interface AutocompleteResponse {
  query: string;
  type: SearchType;
  suggestions: AutocompleteResult[];
}

export interface TrendingItem {
  type: 'player' | 'team' | 'match';
  id: string;
  name: string;
  slug?: string;
  imageUrl?: string | null;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface TrendingResponse {
  players: TrendingItem[];
  teams: TrendingItem[];
  matches: TrendingItem[];
  updatedAt: Date;
}

// ============== HELPER FUNCTIONS ==============

/**
 * Build case-insensitive partial match filter
 */
function buildSearchFilter(query: string): string {
  // Escape special characters and build pattern for partial matching
  const escaped = query.replace(/[%_\\]/g, '\\$&');
  return `%${escaped}%`;
}

// ============== SEARCH FUNCTIONS ==============

/**
 * Global search across players, teams, and tournaments
 * Supports case-insensitive partial matching
 */
export async function globalSearch(
  query: string,
  type: SearchType = 'all',
  limit: number = 20
): Promise<GlobalSearchResponse> {
  if (!query || query.trim().length === 0) {
    return {
      query,
      type,
      results: [],
      totalCount: 0,
    };
  }

  // Note: buildSearchFilter could be used for more advanced filtering
  void buildSearchFilter(query.trim());
  const results: SearchResult[] = [];

  try {
    // Search players
    if (type === 'all' || type === 'player') {
      const players = await prisma.lolPlayer.findMany({
        where: {
          OR: [
            { currentIgn: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
            { realName: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
          ],
          isActive: true,
        },
        take: type === 'player' ? limit : Math.ceil(limit / 3),
        orderBy: [
          { currentIgn: 'asc' },
        ],
        select: {
          lolPlayerId: true,
          currentIgn: true,
          realName: true,
          imageUrl: true,
          role: true,
          nationality: true,
          earningsSummary: {
            select: {
              totalEarnings: true,
            },
          },
        },
      });

      for (const player of players) {
        results.push({
          type: 'player',
          id: player.lolPlayerId,
          name: player.currentIgn,
          imageUrl: player.imageUrl,
          region: player.nationality,
          metadata: {
            realName: player.realName,
            role: player.role,
            totalEarnings: player.earningsSummary?.totalEarnings?.toString() || '0',
          },
        });
      }
    }

    // Search teams (organizations)
    if (type === 'all' || type === 'team') {
      const teams = await prisma.lolOrganization.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
            { slug: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
            { shortName: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
          ],
          isActive: true,
        },
        take: type === 'team' ? limit : Math.ceil(limit / 3),
        orderBy: [
          { name: 'asc' },
        ],
        select: {
          slug: true,
          name: true,
          shortName: true,
          logoUrl: true,
          region: true,
          earningsSummary: {
            select: {
              totalEarnings: true,
              worldsWins: true,
            },
          },
        },
      });

      for (const team of teams) {
        results.push({
          type: 'team',
          id: team.slug,
          name: team.name,
          slug: team.slug,
          imageUrl: team.logoUrl,
          region: team.region,
          metadata: {
            shortName: team.shortName,
            totalEarnings: team.earningsSummary?.totalEarnings?.toString() || '0',
            worldsWins: team.earningsSummary?.worldsWins || 0,
          },
        });
      }
    }

    // Search tournaments
    if (type === 'all' || type === 'tournament') {
      const tournaments = await prisma.lolTournament.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
            { slug: { contains: query, mode: 'insensitive' as Prisma.QueryMode } },
          ],
        },
        take: type === 'tournament' ? limit : Math.ceil(limit / 3),
        orderBy: [
          { startDate: 'desc' },
        ],
        select: {
          tournamentId: true,
          name: true,
          slug: true,
          tier: true,
          startDate: true,
          endDate: true,
          prizePool: true,
          isCompleted: true,
          league: {
            select: {
              name: true,
              region: true,
            },
          },
        },
      });

      for (const tournament of tournaments) {
        results.push({
          type: 'tournament',
          id: tournament.tournamentId,
          name: tournament.name,
          slug: tournament.slug || undefined,
          region: tournament.league?.region,
          metadata: {
            tier: tournament.tier,
            startDate: tournament.startDate?.toISOString(),
            endDate: tournament.endDate?.toISOString(),
            prizePool: tournament.prizePool?.toString(),
            isCompleted: tournament.isCompleted,
            leagueName: tournament.league?.name,
          },
        });
      }
    }

    return {
      query,
      type,
      results,
      totalCount: results.length,
    };
  } catch (error) {
    console.error('[LolSearchService] Error in globalSearch:', error);
    throw new Error('Failed to perform search');
  }
}

/**
 * Fast autocomplete suggestions
 * Returns lightweight results for quick UI updates
 */
export async function autocomplete(
  query: string,
  type: SearchType = 'all',
  limit: number = 10
): Promise<AutocompleteResponse> {
  if (!query || query.trim().length === 0) {
    return {
      query,
      type,
      suggestions: [],
    };
  }

  const suggestions: AutocompleteResult[] = [];

  try {
    // Autocomplete players
    if (type === 'all' || type === 'player') {
      const players = await prisma.lolPlayer.findMany({
        where: {
          currentIgn: { startsWith: query, mode: 'insensitive' as Prisma.QueryMode },
          isActive: true,
        },
        take: type === 'player' ? limit : Math.ceil(limit / 3),
        orderBy: { currentIgn: 'asc' },
        select: {
          lolPlayerId: true,
          currentIgn: true,
        },
      });

      for (const player of players) {
        suggestions.push({
          type: 'player',
          id: player.lolPlayerId,
          name: player.currentIgn,
        });
      }
    }

    // Autocomplete teams
    if (type === 'all' || type === 'team') {
      const teams = await prisma.lolOrganization.findMany({
        where: {
          OR: [
            { name: { startsWith: query, mode: 'insensitive' as Prisma.QueryMode } },
            { shortName: { startsWith: query, mode: 'insensitive' as Prisma.QueryMode } },
          ],
          isActive: true,
        },
        take: type === 'team' ? limit : Math.ceil(limit / 3),
        orderBy: { name: 'asc' },
        select: {
          slug: true,
          name: true,
        },
      });

      for (const team of teams) {
        suggestions.push({
          type: 'team',
          id: team.slug,
          name: team.name,
          slug: team.slug,
        });
      }
    }

    // Autocomplete tournaments
    if (type === 'all' || type === 'tournament') {
      const tournaments = await prisma.lolTournament.findMany({
        where: {
          name: { startsWith: query, mode: 'insensitive' as Prisma.QueryMode },
        },
        take: type === 'tournament' ? limit : Math.ceil(limit / 3),
        orderBy: { startDate: 'desc' },
        select: {
          tournamentId: true,
          name: true,
          slug: true,
        },
      });

      for (const tournament of tournaments) {
        suggestions.push({
          type: 'tournament',
          id: tournament.tournamentId,
          name: tournament.name,
          slug: tournament.slug || undefined,
        });
      }
    }

    return {
      query,
      type,
      suggestions,
    };
  } catch (error) {
    console.error('[LolSearchService] Error in autocomplete:', error);
    throw new Error('Failed to get autocomplete suggestions');
  }
}

/**
 * Get currently trending players, teams, and matches
 * Based on recent activity, upcoming matches, and recent performance
 */
export async function getTrending(): Promise<TrendingResponse> {
  try {
    const now = new Date();
    // Note: oneDayAgo could be used for more granular trending calculations
    void new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Get trending players - those with recent game activity or high earnings
    const trendingPlayers: TrendingItem[] = [];

    // Players who played in recent games
    const recentPlayerStats = await prisma.lolGamePlayerStats.findMany({
      where: {
        createdAt: { gte: oneWeekAgo },
        lolPlayerId: { not: null },
      },
      distinct: ['lolPlayerId'],
      take: 10,
      orderBy: { createdAt: 'desc' },
      select: {
        lolPlayerId: true,
        playerName: true,
        player: {
          select: {
            lolPlayerId: true,
            currentIgn: true,
            imageUrl: true,
            role: true,
          },
        },
      },
    });

    for (const stat of recentPlayerStats) {
      if (stat.player) {
        trendingPlayers.push({
          type: 'player',
          id: stat.player.lolPlayerId,
          name: stat.player.currentIgn,
          imageUrl: stat.player.imageUrl,
          reason: 'Recent match activity',
          metadata: {
            role: stat.player.role,
          },
        });
      }
    }

    // Get trending teams - those with recent matches or high standings
    const trendingTeams: TrendingItem[] = [];

    // Teams in recent matches
    const recentMatches = await prisma.lolMatch.findMany({
      where: {
        startTime: { gte: oneWeekAgo },
      },
      take: 20,
      orderBy: { startTime: 'desc' },
      select: {
        team1: {
          select: {
            slug: true,
            name: true,
            logoUrl: true,
            region: true,
          },
        },
        team2: {
          select: {
            slug: true,
            name: true,
            logoUrl: true,
            region: true,
          },
        },
      },
    });

    const seenTeamSlugs = new Set<string>();
    for (const match of recentMatches) {
      if (!seenTeamSlugs.has(match.team1.slug) && trendingTeams.length < 10) {
        seenTeamSlugs.add(match.team1.slug);
        trendingTeams.push({
          type: 'team',
          id: match.team1.slug,
          name: match.team1.name,
          slug: match.team1.slug,
          imageUrl: match.team1.logoUrl,
          reason: 'Recent match',
          metadata: {
            region: match.team1.region,
          },
        });
      }
      if (!seenTeamSlugs.has(match.team2.slug) && trendingTeams.length < 10) {
        seenTeamSlugs.add(match.team2.slug);
        trendingTeams.push({
          type: 'team',
          id: match.team2.slug,
          name: match.team2.name,
          slug: match.team2.slug,
          imageUrl: match.team2.logoUrl,
          reason: 'Recent match',
          metadata: {
            region: match.team2.region,
          },
        });
      }
    }

    // Get trending matches - live or upcoming
    const trendingMatches: TrendingItem[] = [];

    // Live matches first
    const liveMatches = await prisma.lolMatch.findMany({
      where: {
        state: 'inProgress',
      },
      take: 5,
      select: {
        matchId: true,
        team1Slug: true,
        team2Slug: true,
        team1Score: true,
        team2Score: true,
        state: true,
        team1: {
          select: {
            name: true,
            shortName: true,
          },
        },
        team2: {
          select: {
            name: true,
            shortName: true,
          },
        },
        tournament: {
          select: {
            name: true,
          },
        },
      },
    });

    for (const match of liveMatches) {
      const team1Name = match.team1.shortName || match.team1.name;
      const team2Name = match.team2.shortName || match.team2.name;
      trendingMatches.push({
        type: 'match',
        id: match.matchId,
        name: `${team1Name} vs ${team2Name}`,
        reason: 'Live now',
        metadata: {
          team1Slug: match.team1Slug,
          team2Slug: match.team2Slug,
          team1Score: match.team1Score,
          team2Score: match.team2Score,
          tournament: match.tournament?.name,
          state: match.state,
        },
      });
    }

    // Upcoming matches
    const upcomingMatches = await prisma.lolMatch.findMany({
      where: {
        state: 'unstarted',
        startTime: {
          gte: now,
          lte: new Date(now.getTime() + 24 * 60 * 60 * 1000), // Next 24 hours
        },
      },
      take: 5,
      orderBy: { startTime: 'asc' },
      select: {
        matchId: true,
        team1Slug: true,
        team2Slug: true,
        startTime: true,
        state: true,
        team1: {
          select: {
            name: true,
            shortName: true,
          },
        },
        team2: {
          select: {
            name: true,
            shortName: true,
          },
        },
        tournament: {
          select: {
            name: true,
          },
        },
      },
    });

    for (const match of upcomingMatches) {
      const team1Name = match.team1.shortName || match.team1.name;
      const team2Name = match.team2.shortName || match.team2.name;
      trendingMatches.push({
        type: 'match',
        id: match.matchId,
        name: `${team1Name} vs ${team2Name}`,
        reason: 'Upcoming',
        metadata: {
          team1Slug: match.team1Slug,
          team2Slug: match.team2Slug,
          startTime: match.startTime?.toISOString(),
          tournament: match.tournament?.name,
          state: match.state,
        },
      });
    }

    return {
      players: trendingPlayers,
      teams: trendingTeams,
      matches: trendingMatches,
      updatedAt: now,
    };
  } catch (error) {
    console.error('[LolSearchService] Error in getTrending:', error);
    throw new Error('Failed to get trending data');
  }
}

// ============== EXPORT SERVICE ==============

export const lolSearchService = {
  globalSearch,
  autocomplete,
  getTrending,
};
