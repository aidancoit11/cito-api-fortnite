import { prisma } from '../db/client.js';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { lolEsportsApiService } from '../services/lol/lol-esports-api.service.js';

/**
 * LoL Team/Organization Sync Job
 * Scrapes team data from Liquipedia and LoL Esports API
 * Run daily at 3 AM UTC
 */

const LIQUIPEDIA_BASE_URL = 'https://liquipedia.net';
const REQUEST_DELAY_MS = 2500;

// Team list pages by region
const TEAM_LIST_PAGES = [
  '/leagueoflegends/Portal:Teams/Americas',
  '/leagueoflegends/Portal:Teams/EMEA',
  '/leagueoflegends/Portal:Teams/Asia_Pacific',
  '/leagueoflegends/Portal:Teams/China',
  '/leagueoflegends/Portal:Teams/Korea',
];

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'CitoBot/1.0 (esports data aggregator; contact@cito.gg)',
        'Accept': 'text/html',
      },
      timeout: 30000,
    });
    return response.data;
  } catch (error: any) {
    console.error(`[LolTeamSync] Error fetching ${url}:`, error.message);
    return null;
  }
}

interface ScrapedTeam {
  name: string;
  slug: string;
  shortName: string | null;
  region: string | null;
  logoUrl: string | null;
  wikiUrl: string | null;
  website: string | null;
  foundedDate: Date | null;
  isActive: boolean;
}

async function scrapeTeamsFromPage(pageUrl: string, region: string): Promise<ScrapedTeam[]> {
  const html = await fetchPage(`${LIQUIPEDIA_BASE_URL}${pageUrl}`);
  if (!html) return [];

  const $ = cheerio.load(html);
  const teams: ScrapedTeam[] = [];

  // Find team cards/rows
  $('.team-template-team-standard, .wikitable tbody tr').each((_, element) => {
    const el = $(element);

    // Try different selectors for team name
    let name = el.find('.team-template-text a').text().trim() ||
               el.find('td:first-child a').text().trim() ||
               el.find('.team a').text().trim();

    if (!name || name.length < 2) return;

    const wikiPath = el.find('a').first().attr('href');
    const logoImg = el.find('img').first();
    const logoUrl = logoImg.attr('src') ? `https:${logoImg.attr('src')}` : null;

    const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const shortName = el.find('.team-template-team-short').text().trim() ||
                      name.substring(0, 3).toUpperCase();

    teams.push({
      name,
      slug,
      shortName,
      region,
      logoUrl,
      wikiUrl: wikiPath ? `${LIQUIPEDIA_BASE_URL}${wikiPath}` : null,
      website: null,
      foundedDate: null,
      isActive: true,
    });
  });

  return teams;
}

async function scrapeTeamDetails(wikiUrl: string): Promise<Partial<ScrapedTeam>> {
  const html = await fetchPage(wikiUrl);
  if (!html) return {};

  const $ = cheerio.load(html);
  const details: Partial<ScrapedTeam> = {};

  // Extract from infobox
  $('.infobox-cell-2').each((_, cell) => {
    const label = $(cell).prev('.infobox-cell-1').text().toLowerCase();
    const value = $(cell).text().trim();

    if (label.includes('location') || label.includes('region')) {
      details.region = value;
    } else if (label.includes('founded') || label.includes('created')) {
      const dateMatch = value.match(/(\d{4})/);
      if (dateMatch) {
        details.foundedDate = new Date(`${dateMatch[1]}-01-01`);
      }
    } else if (label.includes('website')) {
      const link = $(cell).find('a').attr('href');
      if (link && !link.includes('liquipedia')) {
        details.website = link;
      }
    }
  });

  // Get logo from infobox
  const infoboxLogo = $('.infobox-image img').attr('src');
  if (infoboxLogo) {
    details.logoUrl = infoboxLogo.startsWith('//') ? `https:${infoboxLogo}` : infoboxLogo;
  }

  return details;
}

async function syncTeamsFromEsportsApi(): Promise<number> {
  console.log('[LolTeamSync] Syncing teams from esports API...');

  const leagues = await prisma.lolLeague.findMany({
    where: { isActive: true },
  });

  let totalSynced = 0;

  for (const league of leagues) {
    if (!league.esportsApiId) continue;

    try {
      const schedule = await lolEsportsApiService.getSchedule(league.esportsApiId);

      for (const event of schedule.events) {
        if (!event.match) continue;

        for (const team of event.match.teams) {
          if (!team.name) continue;

          const teamSlug = team.slug || team.code?.toLowerCase() || team.name.toLowerCase().replace(/\s+/g, '-');

          await prisma.lolOrganization.upsert({
            where: { slug: teamSlug },
            create: {
              slug: teamSlug,
              esportsApiId: team.id,
              name: team.name,
              shortName: team.code,
              logoUrl: team.image,
              region: league.region,
              isActive: true,
            },
            update: {
              name: team.name,
              shortName: team.code,
              logoUrl: team.image,
              lastUpdated: new Date(),
            },
          });
          totalSynced++;
        }
      }

      await delay(500);
    } catch (error: any) {
      console.error(`[LolTeamSync] Error syncing teams from ${league.name}:`, error.message);
    }
  }

  return totalSynced;
}

async function syncTeamsFromLiquipedia(): Promise<number> {
  console.log('[LolTeamSync] Syncing teams from Liquipedia...');

  const regionMap: Record<string, string> = {
    '/leagueoflegends/Portal:Teams/Americas': 'AMERICAS',
    '/leagueoflegends/Portal:Teams/EMEA': 'EMEA',
    '/leagueoflegends/Portal:Teams/Asia_Pacific': 'APAC',
    '/leagueoflegends/Portal:Teams/China': 'CHINA',
    '/leagueoflegends/Portal:Teams/Korea': 'KOREA',
  };

  let totalSynced = 0;

  for (const pageUrl of TEAM_LIST_PAGES) {
    const region = regionMap[pageUrl] || 'INTERNATIONAL';
    console.log(`[LolTeamSync] Scraping ${region} teams...`);

    const teams = await scrapeTeamsFromPage(pageUrl, region);
    console.log(`[LolTeamSync] Found ${teams.length} teams`);

    for (const team of teams) {
      try {
        await prisma.lolOrganization.upsert({
          where: { slug: team.slug },
          create: {
            slug: team.slug,
            name: team.name,
            shortName: team.shortName,
            region: team.region,
            logoUrl: team.logoUrl,
            wikiUrl: team.wikiUrl,
            website: team.website,
            foundedDate: team.foundedDate,
            isActive: team.isActive,
          },
          update: {
            name: team.name,
            shortName: team.shortName || undefined,
            region: team.region || undefined,
            logoUrl: team.logoUrl || undefined,
            wikiUrl: team.wikiUrl || undefined,
            lastUpdated: new Date(),
          },
        });
        totalSynced++;
      } catch (error: any) {
        console.error(`[LolTeamSync] Error syncing team ${team.name}:`, error.message);
      }
    }

    await delay(REQUEST_DELAY_MS);
  }

  return totalSynced;
}

async function enrichTeamDetails(limit: number = 50): Promise<number> {
  console.log(`[LolTeamSync] Enriching team details (limit: ${limit})...`);

  const teams = await prisma.lolOrganization.findMany({
    where: {
      wikiUrl: { not: null },
      OR: [
        { foundedDate: null },
        { website: null },
      ],
    },
    orderBy: { lastUpdated: 'asc' },
    take: limit,
  });

  let enriched = 0;
  for (const team of teams) {
    if (!team.wikiUrl) continue;

    try {
      const details = await scrapeTeamDetails(team.wikiUrl);

      if (Object.keys(details).length > 0) {
        await prisma.lolOrganization.update({
          where: { slug: team.slug },
          data: {
            region: details.region || team.region,
            logoUrl: details.logoUrl || team.logoUrl,
            website: details.website || team.website,
            foundedDate: details.foundedDate || team.foundedDate,
            lastUpdated: new Date(),
          },
        });
        enriched++;
      }

      await delay(REQUEST_DELAY_MS);
    } catch (error: any) {
      console.error(`[LolTeamSync] Error enriching team ${team.name}:`, error.message);
    }
  }

  return enriched;
}

export async function runLolTeamSync(options?: { enrichLimit?: number }): Promise<{
  fromApi: number;
  fromLiquipedia: number;
  enriched: number;
}> {
  console.log('═══════════════════════════════════════════════');
  console.log('🏢 Starting LoL Team Sync');
  console.log('═══════════════════════════════════════════════');

  const startTime = Date.now();

  try {
    // First sync from API (fast)
    const fromApi = await syncTeamsFromEsportsApi();
    console.log(`[LolTeamSync] Synced ${fromApi} teams from API`);

    // Then scrape from Liquipedia (slower, more comprehensive)
    const fromLiquipedia = await syncTeamsFromLiquipedia();
    console.log(`[LolTeamSync] Synced ${fromLiquipedia} teams from Liquipedia`);

    // Enrich team details
    const enriched = await enrichTeamDetails(options?.enrichLimit || 30);
    console.log(`[LolTeamSync] Enriched ${enriched} team profiles`);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const totalTeams = await prisma.lolOrganization.count();

    console.log('═══════════════════════════════════════════════');
    console.log('✅ LoL Team Sync Complete');
    console.log(`   From API: ${fromApi}`);
    console.log(`   From Liquipedia: ${fromLiquipedia}`);
    console.log(`   Enriched: ${enriched}`);
    console.log(`   Total Teams: ${totalTeams}`);
    console.log(`   Duration: ${duration}s`);
    console.log('═══════════════════════════════════════════════');

    return { fromApi, fromLiquipedia, enriched };
  } catch (error) {
    console.error('❌ LoL Team Sync Failed:', error);
    throw error;
  }
}

// Run if called directly
const isMainModule = require.main === module;
if (isMainModule) {
  runLolTeamSync()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
