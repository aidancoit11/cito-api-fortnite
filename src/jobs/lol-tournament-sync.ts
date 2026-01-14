import { prisma } from '../db/client.js';
import { lolEsportsApiService } from '../services/lol/lol-esports-api.service.js';
import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * LoL Tournament Sync Job
 * Syncs leagues, tournaments, and schedule from LoL Esports API + Liquipedia
 * Run daily at 4 AM UTC
 */

const LIQUIPEDIA_API_URL = 'https://liquipedia.net/leagueoflegends/api.php';
const REQUEST_DELAY_MS = 2500;

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function syncLeagues() {
  console.log('[LolTournamentSync] Syncing leagues...');

  try {
    const leagues = await lolEsportsApiService.getLeagues();
    let synced = 0;

    for (const league of leagues) {
      await prisma.lolLeague.upsert({
        where: { esportsApiId: league.id },
        create: {
          leagueId: `lol-${league.slug}`,
          esportsApiId: league.id,
          name: league.name,
          slug: league.slug,
          region: league.region || 'INTL',
          imageUrl: league.image,
          priority: league.priority,
          isActive: true,
        },
        update: {
          name: league.name,
          imageUrl: league.image,
          priority: league.priority,
          lastUpdated: new Date(),
        },
      });
      synced++;
    }

    console.log(`[LolTournamentSync] Synced ${synced} leagues`);
    return synced;
  } catch (error: any) {
    console.error('[LolTournamentSync] Error syncing leagues:', error.message);
    throw error;
  }
}

async function syncTournaments() {
  console.log('[LolTournamentSync] Syncing tournaments from API...');

  try {
    const leagues = await prisma.lolLeague.findMany({
      where: { isActive: true },
    });

    let totalSynced = 0;

    for (const league of leagues) {
      if (!league.esportsApiId) continue;

      try {
        const tournaments = await lolEsportsApiService.getTournamentsForLeague(league.esportsApiId);

        for (const tournament of tournaments) {
          await prisma.lolTournament.upsert({
            where: { esportsApiId: tournament.id },
            create: {
              tournamentId: `lol-${tournament.slug || tournament.id}`,
              esportsApiId: tournament.id,
              leagueId: league.leagueId,
              name: tournament.slug || tournament.id,
              slug: tournament.slug,
              startDate: tournament.startDate ? new Date(tournament.startDate) : null,
              endDate: tournament.endDate ? new Date(tournament.endDate) : null,
              isCompleted: tournament.endDate ? new Date(tournament.endDate) < new Date() : false,
            },
            update: {
              startDate: tournament.startDate ? new Date(tournament.startDate) : null,
              endDate: tournament.endDate ? new Date(tournament.endDate) : null,
              isCompleted: tournament.endDate ? new Date(tournament.endDate) < new Date() : false,
              lastUpdated: new Date(),
            },
          });
          totalSynced++;
        }

        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error: any) {
        console.error(`[LolTournamentSync] Error syncing tournaments for ${league.name}:`, error.message);
      }
    }

    console.log(`[LolTournamentSync] Synced ${totalSynced} tournaments from API`);
    return totalSynced;
  } catch (error: any) {
    console.error('[LolTournamentSync] Error syncing tournaments:', error.message);
    throw error;
  }
}

interface WikiTournament {
  title: string;
  fullurl: string;
}

/**
 * Get tournaments from Liquipedia API using category queries
 */
async function getTournamentsFromCategory(category: string): Promise<WikiTournament[]> {
  const tournaments: WikiTournament[] = [];
  let cmcontinue: string | undefined;

  do {
    try {
      const params: Record<string, string> = {
        action: 'query',
        list: 'categorymembers',
        cmtitle: category,
        cmlimit: '500',
        format: 'json',
      };
      if (cmcontinue) params.cmcontinue = cmcontinue;

      const response = await axios.get(LIQUIPEDIA_API_URL, {
        params,
        headers: {
          'User-Agent': 'CitoBot/1.0 (esports data aggregator; contact@cito.gg)',
          'Accept': 'application/json',
        },
        timeout: 30000,
      });

      const data = response.data;
      const members = data.query?.categorymembers || [];

      for (const member of members) {
        if (member.ns === 0) {
          tournaments.push({
            title: member.title,
            fullurl: `https://liquipedia.net/leagueoflegends/${encodeURIComponent(member.title.replace(/ /g, '_'))}`,
          });
        }
      }

      cmcontinue = data.continue?.cmcontinue;
      await delay(REQUEST_DELAY_MS);
    } catch (error: any) {
      console.error(`[LolTournamentSync] Error fetching category ${category}:`, error.message);
      break;
    }
  } while (cmcontinue);

  return tournaments;
}

/**
 * Scrape tournament details from wiki page
 */
async function scrapeTournamentDetails(url: string, title: string): Promise<{
  name: string;
  slug: string;
  tier: string | null;
  startDate: Date | null;
  endDate: Date | null;
  prizePool: number | null;
  currency: string | null;
  location: string | null;
  venue: string | null;
  format: string | null;
  wikiUrl: string;
} | null> {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'CitoBot/1.0 (esports data aggregator; contact@cito.gg)',
        'Accept': 'text/html',
      },
      timeout: 30000,
    });

    const $ = cheerio.load(response.data);
    const tournament: any = {
      name: title,
      slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      tier: null,
      startDate: null,
      endDate: null,
      prizePool: null,
      currency: null,
      location: null,
      venue: null,
      format: null,
      wikiUrl: url,
    };

    // Parse infobox
    $('.infobox-cell-2').each((_, cell) => {
      const $cell = $(cell);
      const label = $cell.prev('.infobox-cell-1').text().toLowerCase().trim();
      const value = $cell.text().trim();

      if (label.includes('liquipedia tier')) {
        if (value.includes('1') || value.toLowerCase().includes('tier 1')) tournament.tier = 'S';
        else if (value.includes('2') || value.toLowerCase().includes('tier 2')) tournament.tier = 'A';
        else if (value.includes('3') || value.toLowerCase().includes('tier 3')) tournament.tier = 'B';
        else if (value.includes('4') || value.toLowerCase().includes('tier 4')) tournament.tier = 'C';
        else tournament.tier = 'D';
      } else if (label.includes('start date') || label.includes('date')) {
        const dateMatch = value.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (dateMatch) {
          tournament.startDate = new Date(dateMatch[0]);
        }
      } else if (label.includes('end date')) {
        const dateMatch = value.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (dateMatch) {
          tournament.endDate = new Date(dateMatch[0]);
        }
      } else if (label.includes('prize pool') || label.includes('prize')) {
        const prizeMatch = value.match(/[\$€£]?([\d,]+)/);
        if (prizeMatch && prizeMatch[1]) {
          tournament.prizePool = parseInt(prizeMatch[1].replace(/,/g, ''));
          if (value.includes('€')) tournament.currency = 'EUR';
          else if (value.includes('£')) tournament.currency = 'GBP';
          else if (value.includes('¥')) tournament.currency = 'CNY';
          else if (value.includes('₩')) tournament.currency = 'KRW';
          else tournament.currency = 'USD';
        }
      } else if (label.includes('location')) {
        tournament.location = value;
      } else if (label.includes('venue')) {
        tournament.venue = value;
      } else if (label.includes('type') || label.includes('format')) {
        tournament.format = value;
      }
    });

    return tournament;
  } catch (error: any) {
    console.error(`[LolTournamentSync] Error scraping ${title}:`, error.message);
    return null;
  }
}

/**
 * Sync historical tournaments from Liquipedia
 */
async function syncTournamentsFromLiquipedia(): Promise<number> {
  console.log('[LolTournamentSync] Fetching tournaments from Liquipedia categories...');

  // Categories for tournaments by year and type
  const categories = [
    'Category:Tournaments',
    'Category:S-Tier_Tournaments',
    'Category:A-Tier_Tournaments',
    'Category:B-Tier_Tournaments',
    'Category:C-Tier_Tournaments',
  ];

  // Also add year-specific categories
  for (let year = 2011; year <= new Date().getFullYear(); year++) {
    categories.push(`Category:${year}_Tournaments`);
  }

  const allTournaments = new Map<string, WikiTournament>();

  for (const category of categories) {
    console.log(`[LolTournamentSync] Fetching ${category}...`);
    const tournaments = await getTournamentsFromCategory(category);
    console.log(`[LolTournamentSync] Found ${tournaments.length} tournaments`);

    for (const tournament of tournaments) {
      // Skip non-tournament pages
      if (tournament.title.includes(':') || tournament.title.includes('/Scoreboards')) continue;
      if (tournament.title.startsWith('Category:')) continue;
      if (!allTournaments.has(tournament.title)) {
        allTournaments.set(tournament.title, tournament);
      }
    }
  }

  console.log(`[LolTournamentSync] Total unique tournaments found: ${allTournaments.size}`);

  let synced = 0;
  let batchCount = 0;
  const batchSize = 100;

  for (const [title, wikiTournament] of allTournaments) {
    try {
      const details = await scrapeTournamentDetails(wikiTournament.fullurl, title);

      if (details) {
        const tournamentId = `lol-wiki-${details.slug}`;

        // Find matching league based on tournament name
        let leagueId: string | null = null;
        const nameLower = title.toLowerCase();

        if (nameLower.includes('worlds') || nameLower.includes('world championship')) {
          leagueId = 'lol-worlds';
        } else if (nameLower.includes('msi') || nameLower.includes('mid-season')) {
          leagueId = 'lol-msi';
        } else if (nameLower.includes('lck')) {
          leagueId = 'lol-lck';
        } else if (nameLower.includes('lpl')) {
          leagueId = 'lol-lpl';
        } else if (nameLower.includes('lec') || nameLower.includes('eu lcs')) {
          leagueId = 'lol-lec';
        } else if (nameLower.includes('lcs') && (nameLower.includes('na') || !nameLower.includes('eu'))) {
          leagueId = 'lol-lcs';
        }

        await prisma.lolTournament.upsert({
          where: { tournamentId },
          create: {
            tournamentId,
            leagueId,
            name: details.name,
            slug: details.slug,
            tier: details.tier,
            startDate: details.startDate,
            endDate: details.endDate,
            prizePool: details.prizePool,
            prizePoolUsd: details.prizePool, // Approximate
            currency: details.currency,
            format: details.format,
            location: details.location,
            venue: details.venue,
            wikiUrl: details.wikiUrl,
            isCompleted: details.endDate ? details.endDate < new Date() : false,
          },
          update: {
            name: details.name,
            tier: details.tier || undefined,
            startDate: details.startDate || undefined,
            endDate: details.endDate || undefined,
            prizePool: details.prizePool || undefined,
            currency: details.currency || undefined,
            format: details.format || undefined,
            location: details.location || undefined,
            venue: details.venue || undefined,
            wikiUrl: details.wikiUrl,
            lastUpdated: new Date(),
          },
        });
        synced++;
      }

      batchCount++;
      if (batchCount % batchSize === 0) {
        console.log(`[LolTournamentSync] Progress: ${batchCount}/${allTournaments.size} tournaments processed, ${synced} synced`);
      }

      await delay(REQUEST_DELAY_MS);
    } catch (error: any) {
      console.error(`[LolTournamentSync] Error syncing ${title}:`, error.message);
    }
  }

  return synced;
}

async function syncSchedule() {
  console.log('[LolTournamentSync] Syncing schedule...');

  try {
    const leagues = await prisma.lolLeague.findMany({
      where: { isActive: true },
      orderBy: { priority: 'asc' },
      take: 10,
    });

    let totalMatches = 0;

    for (const league of leagues) {
      if (!league.esportsApiId) continue;

      try {
        const schedule = await lolEsportsApiService.getSchedule(league.esportsApiId);

        for (const event of schedule.events) {
          if (!event.match) continue;

          const match = event.match;
          const team1 = match.teams[0];
          const team2 = match.teams[1];

          if (!team1 || !team2) continue;

          for (const team of [team1, team2]) {
            const teamSlug = team.slug || team.code?.toLowerCase() || team.name?.toLowerCase().replace(/\s+/g, '-');
            if (!teamSlug) continue;

            await prisma.lolOrganization.upsert({
              where: { slug: teamSlug },
              create: {
                slug: teamSlug,
                esportsApiId: team.id,
                name: team.name,
                shortName: team.code,
                logoUrl: team.image,
                isActive: true,
              },
              update: {
                name: team.name,
                shortName: team.code,
                logoUrl: team.image,
                lastUpdated: new Date(),
              },
            });
          }

          const team1Slug = team1.slug || team1.code?.toLowerCase() || team1.name?.toLowerCase().replace(/\s+/g, '-');
          const team2Slug = team2.slug || team2.code?.toLowerCase() || team2.name?.toLowerCase().replace(/\s+/g, '-');
          if (!team1Slug || !team2Slug) continue;

          const tournament = await prisma.lolTournament.findFirst({
            where: { leagueId: league.leagueId },
            orderBy: { startDate: 'desc' },
          });

          if (!tournament) continue;

          const winnerSlug = team1.result?.outcome === 'win' ? team1Slug :
                            team2.result?.outcome === 'win' ? team2Slug : null;
          await prisma.lolMatch.upsert({
            where: { esportsApiId: match.id },
            create: {
              matchId: `lol-match-${match.id}`,
              esportsApiId: match.id,
              tournamentId: tournament.tournamentId,
              blockName: event.blockName,
              team1Slug,
              team2Slug,
              team1Score: team1.result?.gameWins ?? null,
              team2Score: team2.result?.gameWins ?? null,
              winnerSlug,
              strategy: match.strategy ? `Bo${match.strategy.count}` : null,
              startTime: event.startTime ? new Date(event.startTime) : null,
              state: event.state,
            },
            update: {
              team1Score: team1.result?.gameWins ?? null,
              team2Score: team2.result?.gameWins ?? null,
              winnerSlug,
              state: event.state,
              lastUpdated: new Date(),
            },
          });

          totalMatches++;
        }

        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error: any) {
        console.error(`[LolTournamentSync] Error syncing schedule for ${league.name}:`, error.message);
      }
    }

    console.log(`[LolTournamentSync] Synced ${totalMatches} matches`);
    return totalMatches;
  } catch (error: any) {
    console.error('[LolTournamentSync] Error syncing schedule:', error.message);
    throw error;
  }
}

async function syncStandings() {
  console.log('[LolTournamentSync] Syncing standings...');

  try {
    const activeTournaments = await prisma.lolTournament.findMany({
      where: {
        isCompleted: false,
        esportsApiId: { not: null },
      },
      include: { league: true },
    });

    let totalStandings = 0;

    for (const tournament of activeTournaments) {
      if (!tournament.esportsApiId || !tournament.league) continue;

      try {
        const standings = await lolEsportsApiService.getStandings(tournament.esportsApiId);

        for (const stage of standings.stages || []) {
          for (const section of stage.sections || []) {
            for (const ranking of section.rankings || []) {
              for (const team of ranking.teams || []) {
                await prisma.lolStanding.upsert({
                  where: {
                    leagueId_tournamentId_orgSlug_stage: {
                      leagueId: tournament.leagueId!,
                      tournamentId: tournament.tournamentId,
                      orgSlug: team.slug,
                      stage: stage.name || 'Regular Season',
                    },
                  },
                  create: {
                    leagueId: tournament.leagueId!,
                    tournamentId: tournament.tournamentId,
                    orgSlug: team.slug,
                    stage: stage.name || 'Regular Season',
                    rank: ranking.ordinal,
                    wins: team.record?.wins || 0,
                    losses: team.record?.losses || 0,
                    winRate: team.record ? team.record.wins / (team.record.wins + team.record.losses) : null,
                  },
                  update: {
                    rank: ranking.ordinal,
                    wins: team.record?.wins || 0,
                    losses: team.record?.losses || 0,
                    winRate: team.record ? team.record.wins / (team.record.wins + team.record.losses) : null,
                    lastUpdated: new Date(),
                  },
                });
                totalStandings++;
              }
            }
          }
        }

        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error: any) {
        console.error(`[LolTournamentSync] Error syncing standings for ${tournament.name}:`, error.message);
      }
    }

    console.log(`[LolTournamentSync] Synced ${totalStandings} standings entries`);
    return totalStandings;
  } catch (error: any) {
    console.error('[LolTournamentSync] Error syncing standings:', error.message);
    throw error;
  }
}

export async function runLolTournamentSync(options?: { includeHistorical?: boolean }) {
  console.log('═══════════════════════════════════════════════');
  console.log('🎮 Starting LoL Tournament Sync');
  console.log('═══════════════════════════════════════════════');

  const startTime = Date.now();

  try {
    const leagueCount = await syncLeagues();
    const tournamentCountApi = await syncTournaments();

    // Sync historical tournaments from Liquipedia if requested
    let tournamentCountWiki = 0;
    if (options?.includeHistorical !== false) {
      tournamentCountWiki = await syncTournamentsFromLiquipedia();
    }

    const matchCount = await syncSchedule();
    const standingsCount = await syncStandings();

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const totalTournaments = await prisma.lolTournament.count();

    console.log('═══════════════════════════════════════════════');
    console.log('✅ LoL Tournament Sync Complete');
    console.log(`   Leagues: ${leagueCount}`);
    console.log(`   Tournaments (API): ${tournamentCountApi}`);
    console.log(`   Tournaments (Liquipedia): ${tournamentCountWiki}`);
    console.log(`   Total Tournaments: ${totalTournaments}`);
    console.log(`   Matches: ${matchCount}`);
    console.log(`   Standings: ${standingsCount}`);
    console.log(`   Duration: ${duration}s`);
    console.log('═══════════════════════════════════════════════');

    return {
      leagueCount,
      tournamentCountApi,
      tournamentCountWiki,
      totalTournaments,
      matchCount,
      standingsCount,
    };
  } catch (error) {
    console.error('❌ LoL Tournament Sync Failed:', error);
    throw error;
  }
}

// Run if called directly
const isMainModule = require.main === module;
if (isMainModule) {
  const includeHistorical = !process.argv.includes('--skip-historical');
  runLolTournamentSync({ includeHistorical })
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
