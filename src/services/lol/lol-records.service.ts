import { prisma } from '../../db/client.js';

// Types
interface RecordEntry {
  id: string;
  category: string;
  subcategory: string | null;
  recordValue: number;
  recordHolderId: string | null;
  recordHolderName: string;
  recordHolderType: string;
  recordDate: Date | null;
  tournamentId: string | null;
  gameId: string | null;
  context: string | null;
  source: string | null;
}

interface RecordHolder {
  holderId: string | null;
  holderType: string;
  holderName: string;
  value: number;
  recordDate: Date | null;
}

interface PlayerRecord {
  category: string;
  subcategory: string | null;
  value: number;
  recordDate: Date | null;
}

interface TeamRecord {
  category: string;
  subcategory: string | null;
  value: number;
  recordDate: Date | null;
}

interface HistoricalStats {
  year: number;
  totalMatches: number;
  totalGames: number;
  totalPlayers: number;
  totalTeams: number;
  topKiller?: { playerId: string; playerName: string; kills: number };
  mostWins?: { teamSlug: string; teamName: string; wins: number };
  avgGameDuration?: number;
  majorEvents: Array<{
    tournamentId: string;
    tournamentName: string;
    leagueName: string | null;
    region: string | null;
  }>;
}

// Record categories
const RECORD_CATEGORIES = {
  PLAYER_KILLS: 'player_kills',
  PLAYER_DEATHS: 'player_deaths',
  PLAYER_ASSISTS: 'player_assists',
  PLAYER_KDA: 'player_kda',
  PLAYER_CS: 'player_cs',
  PLAYER_GOLD: 'player_gold',
  PLAYER_DAMAGE: 'player_damage',
  PLAYER_VISION: 'player_vision',
  TEAM_WINS: 'team_wins',
  TEAM_WIN_STREAK: 'team_win_streak',
  TEAM_GAME_TIME: 'team_game_time',
  TEAM_FIRST_BLOOD: 'team_first_blood',
  TEAM_OBJECTIVES: 'team_objectives',
  MATCH_LONGEST: 'match_longest',
  MATCH_SHORTEST: 'match_shortest',
  MATCH_MOST_KILLS: 'match_most_kills',
  SEASON_MVP: 'season_mvp',
  TOURNAMENT_MVP: 'tournament_mvp',
} as const;

/**
 * Get all records with optional filters
 */
async function getAllRecords(
  category?: string,
  _league?: string,
  _region?: string
): Promise<RecordEntry[]> {
  try {
    const where: Record<string, unknown> = {};

    if (category) {
      where.category = category;
    }

    const records = await prisma.lolRecord.findMany({
      where,
      orderBy: [
        { category: 'asc' },
        { recordValue: 'desc' },
      ],
    });

    return records.map((record) => ({
      id: record.id,
      category: record.category,
      subcategory: record.subcategory,
      recordValue: Number(record.recordValue),
      recordHolderId: record.recordHolderId,
      recordHolderName: record.recordHolderName,
      recordHolderType: record.recordHolderType,
      recordDate: record.recordDate,
      tournamentId: record.tournamentId,
      gameId: record.gameId,
      context: record.context,
      source: record.source,
    }));
  } catch (error) {
    console.error('Error fetching all records:', error);
    throw new Error(`Failed to fetch records: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get holders for a specific record category
 */
async function getRecordHolders(category: string): Promise<RecordHolder[]> {
  try {
    const records = await prisma.lolRecord.findMany({
      where: { category },
      orderBy: { recordValue: 'desc' },
    });

    return records.map((record) => ({
      holderId: record.recordHolderId,
      holderType: record.recordHolderType,
      holderName: record.recordHolderName,
      value: Number(record.recordValue),
      recordDate: record.recordDate,
    }));
  } catch (error) {
    console.error('Error fetching record holders:', error);
    throw new Error(`Failed to fetch record holders for ${category}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get all records held by a specific player
 */
async function getPlayerRecords(playerId: string): Promise<PlayerRecord[]> {
  try {
    const records = await prisma.lolRecord.findMany({
      where: {
        recordHolderId: playerId,
        recordHolderType: 'player',
      },
      orderBy: { recordDate: 'desc' },
    });

    return records.map((record) => ({
      category: record.category,
      subcategory: record.subcategory,
      value: Number(record.recordValue),
      recordDate: record.recordDate,
    }));
  } catch (error) {
    console.error('Error fetching player records:', error);
    throw new Error(`Failed to fetch records for player ${playerId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get all records held by a specific team
 */
async function getTeamRecords(teamSlug: string): Promise<TeamRecord[]> {
  try {
    const records = await prisma.lolRecord.findMany({
      where: {
        recordHolderId: teamSlug,
        recordHolderType: 'team',
      },
      orderBy: { recordDate: 'desc' },
    });

    return records.map((record) => ({
      category: record.category,
      subcategory: record.subcategory,
      value: Number(record.recordValue),
      recordDate: record.recordDate,
    }));
  } catch (error) {
    console.error('Error fetching team records:', error);
    throw new Error(`Failed to fetch records for team ${teamSlug}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get historical stats summary for a specific year
 */
async function getHistoricalStats(year: number): Promise<HistoricalStats> {
  try {
    const startDate = new Date(`${year}-01-01`);
    const endDate = new Date(`${year}-12-31`);

    // Get match count
    const totalMatches = await prisma.lolMatch.count({
      where: {
        startTime: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    // Get game count
    const totalGames = await prisma.lolGame.count({
      where: {
        match: {
          startTime: {
            gte: startDate,
            lte: endDate,
          },
        },
      },
    });

    // Get unique players active in that year
    const playerStats = await prisma.lolGamePlayerStats.findMany({
      where: {
        game: {
          match: {
            startTime: {
              gte: startDate,
              lte: endDate,
            },
          },
        },
      },
      select: {
        lolPlayerId: true,
        kills: true,
      },
    });

    const uniquePlayerIds = new Set(playerStats.map((p) => p.lolPlayerId));
    const totalPlayers = uniquePlayerIds.size;

    // Get unique teams
    const matches = await prisma.lolMatch.findMany({
      where: {
        startTime: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        team1Slug: true,
        team2Slug: true,
      },
    });

    const teamSlugs = new Set<string>();
    matches.forEach((m) => {
      if (m.team1Slug) teamSlugs.add(m.team1Slug);
      if (m.team2Slug) teamSlugs.add(m.team2Slug);
    });
    const totalTeams = teamSlugs.size;

    // Calculate top killer
    const killsByPlayer: Record<string, number> = {};
    playerStats.forEach((stat) => {
      const pid = stat.lolPlayerId;
      if (pid) {
        killsByPlayer[pid] = (killsByPlayer[pid] || 0) + (stat.kills || 0);
      }
    });

    const topKillerEntry = Object.entries(killsByPlayer).sort(([, a], [, b]) => b - a)[0];
    let topKiller: { playerId: string; playerName: string; kills: number } | undefined;

    if (topKillerEntry) {
      const player = await prisma.lolPlayer.findUnique({
        where: { lolPlayerId: topKillerEntry[0] },
        select: { currentIgn: true },
      });
      topKiller = {
        playerId: topKillerEntry[0],
        playerName: player?.currentIgn || 'Unknown',
        kills: topKillerEntry[1],
      };
    }

    // Calculate team with most wins
    const winsByTeam: Record<string, number> = {};
    const matchesWithWinners = await prisma.lolMatch.findMany({
      where: {
        startTime: {
          gte: startDate,
          lte: endDate,
        },
        winnerSlug: { not: null },
      },
      select: {
        winnerSlug: true,
      },
    });

    matchesWithWinners.forEach((m) => {
      if (m.winnerSlug) {
        winsByTeam[m.winnerSlug] = (winsByTeam[m.winnerSlug] || 0) + 1;
      }
    });

    const topTeamEntry = Object.entries(winsByTeam).sort(([, a], [, b]) => b - a)[0];
    let mostWins: { teamSlug: string; teamName: string; wins: number } | undefined;

    if (topTeamEntry) {
      const team = await prisma.lolOrganization.findUnique({
        where: { slug: topTeamEntry[0] },
        select: { name: true },
      });
      mostWins = {
        teamSlug: topTeamEntry[0],
        teamName: team?.name || 'Unknown',
        wins: topTeamEntry[1],
      };
    }

    // Get major events (tournaments) from that year
    const tournaments = await prisma.lolTournament.findMany({
      where: {
        startDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        league: true,
      },
      orderBy: { startDate: 'asc' },
    });

    const majorEvents = tournaments.map((t) => ({
      tournamentId: t.tournamentId,
      tournamentName: t.name,
      leagueName: t.league?.name || null,
      region: t.league?.region || null,
    }));

    return {
      year,
      totalMatches,
      totalGames,
      totalPlayers,
      totalTeams,
      topKiller,
      mostWins,
      majorEvents,
    };
  } catch (error) {
    console.error('Error fetching historical stats:', error);
    throw new Error(`Failed to fetch historical stats for ${year}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Recalculate and update all records from existing data
 */
async function updateRecords(): Promise<{ updated: number; created: number }> {
  try {
    let updated = 0;
    let created = 0;

    // Get all player stats for record calculation
    const playerStats = await prisma.lolGamePlayerStats.findMany({
      include: {
        player: true,
      },
    });

    // Calculate player records
    const playerRecords: Record<string, {
      playerId: string;
      playerName: string;
      kills: number;
      deaths: number;
      assists: number;
      cs: number;
      gold: number;
      damage: number;
      visionScore: number;
      games: number;
      lastGameDate: Date;
    }> = {};

    for (const stat of playerStats) {
      const playerId = stat.lolPlayerId;
      if (!playerId) continue;

      if (!playerRecords[playerId]) {
        playerRecords[playerId] = {
          playerId,
          playerName: stat.player?.currentIgn || 'Unknown',
          kills: 0,
          deaths: 0,
          assists: 0,
          cs: 0,
          gold: 0,
          damage: 0,
          visionScore: 0,
          games: 0,
          lastGameDate: new Date(),
        };
      }

      playerRecords[playerId]!.kills += stat.kills || 0;
      playerRecords[playerId]!.deaths += stat.deaths || 0;
      playerRecords[playerId]!.assists += stat.assists || 0;
      playerRecords[playerId]!.cs += stat.cs || 0;
      playerRecords[playerId]!.gold += stat.gold || 0;
      playerRecords[playerId]!.damage += stat.damageDealt || 0;
      playerRecords[playerId]!.visionScore += stat.visionScore || 0;
      playerRecords[playerId]!.games += 1;
    }

    // Find record holders and upsert records
    const recordTypes = [
      { category: RECORD_CATEGORIES.PLAYER_KILLS, field: 'kills' as const },
      { category: RECORD_CATEGORIES.PLAYER_ASSISTS, field: 'assists' as const },
      { category: RECORD_CATEGORIES.PLAYER_CS, field: 'cs' as const },
      { category: RECORD_CATEGORIES.PLAYER_GOLD, field: 'gold' as const },
      { category: RECORD_CATEGORIES.PLAYER_DAMAGE, field: 'damage' as const },
      { category: RECORD_CATEGORIES.PLAYER_VISION, field: 'visionScore' as const },
    ];

    for (const recordType of recordTypes) {
      const sortedPlayers = Object.values(playerRecords)
        .filter((p) => p.games >= 10) // Minimum games threshold
        .sort((a, b) => b[recordType.field] - a[recordType.field]);

      if (sortedPlayers.length > 0) {
        const topPlayer = sortedPlayers[0]!;

        const existingRecord = await prisma.lolRecord.findFirst({
          where: {
            category: recordType.category,
            subcategory: 'career_total',
          },
        });

        if (existingRecord) {
          await prisma.lolRecord.update({
            where: { id: existingRecord.id },
            data: {
              recordValue: topPlayer[recordType.field],
              recordHolderId: topPlayer.playerId,
              recordHolderName: topPlayer.playerName,
              recordHolderType: 'player',
              recordDate: topPlayer.lastGameDate,
            },
          });
          updated++;
        } else {
          await prisma.lolRecord.create({
            data: {
              category: recordType.category,
              subcategory: 'career_total',
              recordValue: topPlayer[recordType.field],
              recordHolderId: topPlayer.playerId,
              recordHolderName: topPlayer.playerName,
              recordHolderType: 'player',
              recordDate: topPlayer.lastGameDate,
            },
          });
          created++;
        }
      }
    }

    // Calculate team records
    const matchesWithWinners = await prisma.lolMatch.findMany({
      where: {
        winnerSlug: { not: null },
      },
      select: {
        winnerSlug: true,
        startTime: true,
      },
    });

    const teamWinCounts: Record<string, {
      teamSlug: string;
      wins: number;
      lastWinDate: Date;
    }> = {};

    for (const match of matchesWithWinners) {
      if (!match.winnerSlug) continue;

      if (!teamWinCounts[match.winnerSlug]) {
        teamWinCounts[match.winnerSlug] = {
          teamSlug: match.winnerSlug,
          wins: 0,
          lastWinDate: match.startTime || new Date(),
        };
      }

      teamWinCounts[match.winnerSlug]!.wins += 1;
      if (match.startTime && match.startTime > teamWinCounts[match.winnerSlug]!.lastWinDate) {
        teamWinCounts[match.winnerSlug]!.lastWinDate = match.startTime;
      }
    }

    // Most wins record
    const sortedTeams = Object.values(teamWinCounts).sort((a, b) => b.wins - a.wins);
    if (sortedTeams.length > 0) {
      const topTeam = sortedTeams[0]!;

      // Get team name
      const team = await prisma.lolOrganization.findUnique({
        where: { slug: topTeam.teamSlug },
        select: { name: true },
      });

      const existingTeamRecord = await prisma.lolRecord.findFirst({
        where: {
          category: RECORD_CATEGORIES.TEAM_WINS,
          subcategory: 'career_total',
        },
      });

      if (existingTeamRecord) {
        await prisma.lolRecord.update({
          where: { id: existingTeamRecord.id },
          data: {
            recordValue: topTeam.wins,
            recordHolderId: topTeam.teamSlug,
            recordHolderName: team?.name || topTeam.teamSlug,
            recordHolderType: 'team',
            recordDate: topTeam.lastWinDate,
          },
        });
        updated++;
      } else {
        await prisma.lolRecord.create({
          data: {
            category: RECORD_CATEGORIES.TEAM_WINS,
            subcategory: 'career_total',
            recordValue: topTeam.wins,
            recordHolderId: topTeam.teamSlug,
            recordHolderName: team?.name || topTeam.teamSlug,
            recordHolderType: 'team',
            recordDate: topTeam.lastWinDate,
          },
        });
        created++;
      }
    }

    console.log(`Records update complete: ${updated} updated, ${created} created`);
    return { updated, created };
  } catch (error) {
    console.error('Error updating records:', error);
    throw new Error(`Failed to update records: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get Worlds champions by year
 */
async function getWorldsChampions(): Promise<Array<{
  year: number;
  tournamentName: string;
  winner: string | null;
  winnerSlug: string | null;
  runnerUp: string | null;
}>> {
  try {
    // Find tournaments with "Worlds" or "World Championship" in the name
    const worldsTournaments = await prisma.lolTournament.findMany({
      where: {
        OR: [
          { name: { contains: 'Worlds', mode: 'insensitive' } },
          { name: { contains: 'World Championship', mode: 'insensitive' } },
        ],
      },
      orderBy: { startDate: 'desc' },
    });

    const results = [];
    for (const t of worldsTournaments) {
      const standings = await prisma.lolStanding.findMany({
        where: {
          tournamentId: t.tournamentId,
          rank: { in: [1, 2] },
        },
        include: {
          organization: true,
        },
        orderBy: { rank: 'asc' },
      });

      const winner = standings.find((s) => s.rank === 1);
      const runnerUp = standings.find((s) => s.rank === 2);
      results.push({
        year: t.startDate?.getFullYear() || 0,
        tournamentName: t.name,
        winner: winner?.organization?.name || null,
        winnerSlug: winner?.orgSlug || null,
        runnerUp: runnerUp?.organization?.name || null,
      });
    }
    return results;
  } catch (error) {
    console.error('Error fetching Worlds champions:', error);
    throw new Error(`Failed to fetch Worlds champions: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get MSI champions by year
 */
async function getMsiChampions(): Promise<Array<{
  year: number;
  tournamentName: string;
  winner: string | null;
  winnerSlug: string | null;
  runnerUp: string | null;
}>> {
  try {
    // Find tournaments with "MSI" or "Mid-Season Invitational" in the name
    const msiTournaments = await prisma.lolTournament.findMany({
      where: {
        OR: [
          { name: { contains: 'MSI', mode: 'insensitive' } },
          { name: { contains: 'Mid-Season Invitational', mode: 'insensitive' } },
        ],
      },
      orderBy: { startDate: 'desc' },
    });

    const results = [];
    for (const t of msiTournaments) {
      const standings = await prisma.lolStanding.findMany({
        where: {
          tournamentId: t.tournamentId,
          rank: { in: [1, 2] },
        },
        include: {
          organization: true,
        },
        orderBy: { rank: 'asc' },
      });

      const winner = standings.find((s) => s.rank === 1);
      const runnerUp = standings.find((s) => s.rank === 2);
      results.push({
        year: t.startDate?.getFullYear() || 0,
        tournamentName: t.name,
        winner: winner?.organization?.name || null,
        winnerSlug: winner?.orgSlug || null,
        runnerUp: runnerUp?.organization?.name || null,
      });
    }
    return results;
  } catch (error) {
    console.error('Error fetching MSI champions:', error);
    throw new Error(`Failed to fetch MSI champions: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get Hall of Fame - legendary players with most achievements
 */
async function getHallOfFame(): Promise<Array<{
  playerId: string;
  playerName: string;
  country: string | null;
  role: string | null;
  worldsWins: number;
  msiWins: number;
  majorTitles: number;
  careerEarnings: number;
}>> {
  try {
    // Get players with earnings summaries ordered by total earnings
    const summaries = await prisma.lolPlayerEarningsSummary.findMany({
      where: {
        totalEarnings: { gt: 10000 },
      },
      include: {
        player: true,
      },
      orderBy: { totalEarnings: 'desc' },
      take: 50,
    });

    return summaries.map((s) => ({
      playerId: s.lolPlayerId,
      playerName: s.player?.currentIgn || 'Unknown',
      country: s.player?.country || null,
      role: s.player?.role || null,
      worldsWins: s.worldsWins,
      msiWins: s.msiWins,
      majorTitles: s.firstPlaceCount,
      careerEarnings: Number(s.totalEarnings) || 0,
    }));
  } catch (error) {
    console.error('Error fetching Hall of Fame:', error);
    throw new Error(`Failed to fetch Hall of Fame: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Export service object
export const lolRecordsService = {
  getAllRecords,
  getRecordHolders,
  getPlayerRecords,
  getTeamRecords,
  getHistoricalStats,
  updateRecords,
  getWorldsChampions,
  getMsiChampions,
  getHallOfFame,
  RECORD_CATEGORIES,
};

export default lolRecordsService;
