import axios from 'axios';
import * as cheerio from 'cheerio';
import { prisma } from '../../db/client.js';
import NodeCache from 'node-cache';
import { findOrCreatePlayer } from '../player.service.js';
import { proxyManager } from './proxy-manager.js';

/**
 * Organization & Roster Scraping Service
 * Scrapes Fortnite esports organizations and rosters from Liquipedia
 * IMPORTANT: Only scrapes from liquipedia.net/fortnite - Fortnite data only
 */

const cache = new NodeCache({ stdTTL: 3600 }); // 1 hour cache

const LIQUIPEDIA_BASE = 'https://liquipedia.net';
const LIQUIPEDIA_FORTNITE = `${LIQUIPEDIA_BASE}/fortnite`;

// User agent to be respectful to Liquipedia
const headers = {
  'User-Agent': 'FortniteCompetitiveAPI/1.0 (Educational/Research)',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};

/**
 * Fetch a URL using proxy manager (with rotation and rate limit handling)
 * Falls back to direct axios if proxy manager fails
 */
async function fetchWithProxy(url: string): Promise<string> {
  try {
    return await proxyManager.fetch(url);
  } catch (error) {
    // Fallback to direct request
    const response = await axios.get(url, { headers, timeout: 15000 });
    return response.data;
  }
}

export interface ScrapedPlayerDetails {
  imageUrl?: string;
  realName?: string;
  birthDate?: Date;
  nationality?: string;
  country?: string;
  socialMedia?: {
    twitter?: string;
    twitch?: string;
    youtube?: string;
  };
}

/**
 * Scrape detailed player info from their Liquipedia page
 */
async function scrapePlayerDetails(wikiUrl: string): Promise<ScrapedPlayerDetails> {
  const result: ScrapedPlayerDetails = {};

  try {
    const html = await fetchWithProxy(wikiUrl);
    const $ = cheerio.load(html);

    // Look for infobox image
    const imgSrc = $('.infobox-image img').first().attr('src');
    if (imgSrc && !imgSrc.includes('placeholder') && !imgSrc.includes('NoImage')) {
      result.imageUrl = imgSrc.startsWith('http') ? imgSrc : `${LIQUIPEDIA_BASE}${imgSrc}`;
    }

    // Helper to parse dates
    const parseDate = (text: string): Date | null => {
      if (!text) return null;
      // Try ISO format (2000-03-15)
      const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (isoMatch) {
        return new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`);
      }
      // Try "Month Day, Year" or "Day Month Year"
      const parsed = new Date(text.replace(/\([^)]*\)/g, '').trim());
      if (!isNaN(parsed.getTime())) return parsed;
      return null;
    };

    // Extract from infobox - Liquipedia Fortnite uses fo-nttax-infobox with divs
    // The format is "Label:Value" concatenated in divs
    $('.fo-nttax-infobox').children('div').each((_, div) => {
      const $div = $(div);
      const text = $div.text().trim();

      // Skip headers and empty divs
      if (!text || text.length < 3 || !text.includes(':')) return;

      // Split by first colon to get label and value
      const colonIdx = text.indexOf(':');
      if (colonIdx === -1) return;

      const label = text.substring(0, colonIdx).toLowerCase().trim();
      const value = text.substring(colonIdx + 1).trim();

      // Real name
      if (label === 'name' && !result.realName) {
        if (value && value.length > 0 && value.length < 100) {
          result.realName = value;
        }
      }

      // Birth date (e.g., "November 12, 2004 (age 21)")
      if (label === 'born' || label.includes('birth')) {
        const date = parseDate(value);
        if (date && date.getFullYear() > 1980 && date.getFullYear() < 2015) {
          result.birthDate = date;
        }
      }

      // Nationality (e.g., "Norway" or " Norway")
      if (label === 'nationality' && !result.nationality) {
        // Get from flag image
        const flagImg = $div.find('img[src*="flag"], .flag img').first();
        const flagSrc = flagImg.attr('src') || '';
        const nationalityMatch = flagSrc.match(/\/([a-z]{2})\.png/i);
        if (nationalityMatch && nationalityMatch[1]) {
          result.nationality = nationalityMatch[1].toUpperCase();
        }
        // Get full country name
        const countryLink = $div.find('a').first().text().trim();
        const countryText = (countryLink || value).replace(/\s+/g, ' ').trim();
        if (countryText && countryText.length > 1 && countryText.length < 50) {
          result.country = countryText;
        }
      }
    });

    // Fallback: Try traditional tr-based infobox (for other page formats)
    if (!result.realName || !result.birthDate) {
      $('.infobox tr').each((_, row) => {
        const $row = $(row);
        const label = $row.find('th').first().text().toLowerCase().trim();
        const valueCell = $row.find('td').first();
        const value = valueCell.text().trim();

        if (!label) return;

        if (label.includes('name') && !label.includes('romanized') && !label.includes('nick') && !result.realName) {
          if (value && value.length > 0 && value.length < 100) {
            result.realName = value;
          }
        }

        if ((label.includes('born') || label.includes('birth')) && !result.birthDate) {
          const date = parseDate(value);
          if (date && date.getFullYear() > 1980 && date.getFullYear() < 2015) {
            result.birthDate = date;
          }
        }

        if ((label.includes('nationality') || label.includes('country')) && !result.nationality) {
          const flagImg = valueCell.find('img[src*="flag"], .flag img').first();
          const flagSrc = flagImg.attr('src') || '';
          const nationalityMatch = flagSrc.match(/\/([a-z]{2})\.png/i);
          if (nationalityMatch && nationalityMatch[1]) {
            result.nationality = nationalityMatch[1].toUpperCase();
          }
          if (!result.country) {
            result.country = value.replace(/\s+/g, ' ').trim();
          }
        }
      });
    }

    // Extract social media
    const socialMedia: ScrapedPlayerDetails['socialMedia'] = {};
    $('a[href*="twitter.com"], a[href*="x.com"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && !href.includes('liquipedia')) {
        socialMedia.twitter = href;
      }
    });
    $('a[href*="twitch.tv"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && !href.includes('liquipedia')) {
        socialMedia.twitch = href;
      }
    });
    $('a[href*="youtube.com"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && !href.includes('liquipedia')) {
        socialMedia.youtube = href;
      }
    });
    if (Object.keys(socialMedia).length > 0) {
      result.socialMedia = socialMedia;
    }

    return result;
  } catch {
    return result;
  }
}

// Entries to filter out (not actual players)
const INVALID_PLAYER_PATTERNS = [
  /^s-tier$/i,
  /^a-tier$/i,
  /^b-tier$/i,
  /^tier$/i,
  /^tournaments?$/i,
  /^results?$/i,
  /^achievements?$/i,
  /^history$/i,
  /^overview$/i,
  /^statistics?$/i,
  /^portal:/i,
  /^category:/i,
  /^file:/i,
];

export interface ScrapedOrg {
  slug: string;
  name: string;
  logoUrl: string | null;
  region: string | null;
  wikiUrl: string;
}

export interface ScrapedPlayer {
  ign: string;
  realName: string | null;
  nationality: string | null;
  country: string | null;
  birthDate: Date | null;
  role: string;
  status: 'current' | 'former';
  wikiUrl: string | null;
  imageUrl?: string | null;
  playerId?: string;
}

export interface OrgWithRoster extends ScrapedOrg {
  roster: ScrapedPlayer[];
  description: string | null;
  foundedDate: Date | null;
  disbandedDate: Date | null;
  headquarters: string | null;
  websiteUrl: string | null;
  approxTotalWinnings: number | null;
  socialMedia: {
    twitter?: string;
    youtube?: string;
    twitch?: string;
    instagram?: string;
    discord?: string;
    facebook?: string;
  };
}

/**
 * Scrape all organizations from Liquipedia Teams Portal
 */
export async function scrapeAllOrgs(): Promise<ScrapedOrg[]> {
  const cacheKey = 'all_orgs';
  const cached = cache.get<ScrapedOrg[]>(cacheKey);
  if (cached) return cached;

  try {
    const html = await fetchWithProxy(`${LIQUIPEDIA_FORTNITE}/Portal:Teams`);
    const $ = cheerio.load(html);

    const orgs: ScrapedOrg[] = [];
    let currentRegion = 'Unknown';

    // Find all team boxes/entries
    $('h2, h3, .team-template-team-standard, .teamcard, [class*="team"]').each((_, el) => {
      const $el = $(el);

      // Track region headers
      if ($el.is('h2, h3')) {
        const headlineText = $el.find('.mw-headline').text().trim();
        if (headlineText && !headlineText.includes('Disbanded')) {
          currentRegion = headlineText;
        }
      }

      // Extract team info from team templates
      const teamLink = $el.find('a[href*="/fortnite/"]').first();
      const teamName = teamLink.text().trim() || $el.find('[class*="name"]').text().trim();
      const teamHref = teamLink.attr('href');

      if (teamName && teamHref && !teamHref.includes('Portal:') && !teamHref.includes('Category:')) {
        const logoImg = $el.find('img').first();
        const logoSrc = logoImg.attr('src') || logoImg.attr('data-src');

        const slug = teamName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');

        // Avoid duplicates
        if (!orgs.find(o => o.slug === slug)) {
          orgs.push({
            slug,
            name: teamName,
            logoUrl: logoSrc ? (logoSrc.startsWith('http') ? logoSrc : `${LIQUIPEDIA_BASE}${logoSrc}`) : null,
            region: currentRegion !== 'Unknown' ? currentRegion : null,
            wikiUrl: `${LIQUIPEDIA_BASE}${teamHref}`,
          });
        }
      }
    });

    // Also look for teams in tables
    $('table.wikitable tr').each((_, row) => {
      const $row = $(row);
      const teamCell = $row.find('td').first();
      const teamLink = teamCell.find('a[href*="/fortnite/"]').first();
      const teamName = teamLink.text().trim();
      const teamHref = teamLink.attr('href');

      if (teamName && teamHref && !teamHref.includes('Portal:')) {
        const slug = teamName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');

        if (!orgs.find(o => o.slug === slug)) {
          orgs.push({
            slug,
            name: teamName,
            logoUrl: null,
            region: null,
            wikiUrl: `${LIQUIPEDIA_BASE}${teamHref}`,
          });
        }
      }
    });

    cache.set(cacheKey, orgs);
    return orgs;
  } catch (error: any) {
    console.error('Failed to scrape orgs:', error.message);
    return [];
  }
}

/**
 * Scrape detailed org info and roster from org wiki page
 * Includes section detection for current vs former players
 */
export async function scrapeOrgDetails(orgSlug: string): Promise<OrgWithRoster | null> {
  const cacheKey = `org_${orgSlug}`;
  const cached = cache.get<OrgWithRoster>(cacheKey);
  if (cached) return cached;

  // First get the wiki URL
  const allOrgs = await scrapeAllOrgs();
  const org = allOrgs.find(o => o.slug === orgSlug);

  if (!org) {
    return null;
  }

  try {
    const html = await fetchWithProxy(org.wikiUrl);
    const $ = cheerio.load(html);

    const roster: ScrapedPlayer[] = [];
    const seenIgns = new Set<string>();
    const socialMedia: OrgWithRoster['socialMedia'] = {};

    // ========== EXTRACT INFOBOX DATA ==========
    let foundedDate: Date | null = null;
    let disbandedDate: Date | null = null;
    let headquarters: string | null = null;
    let websiteUrl: string | null = null;
    let approxTotalWinnings: number | null = null;

    // Helper to parse dates from various formats
    const parseInfoboxDate = (text: string): Date | null => {
      if (!text) return null;
      text = text.trim();
      // Try ISO format first (2018-03-15)
      const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (isoMatch) {
        return new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`);
      }
      // Try "Month Day, Year" format
      const dateFormats = [
        /(\w+)\s+(\d{1,2}),?\s+(\d{4})/,  // March 15, 2018
        /(\d{1,2})\s+(\w+)\s+(\d{4})/,     // 15 March 2018
      ];
      for (const format of dateFormats) {
        const match = text.match(format);
        if (match) {
          const parsed = new Date(text);
          if (!isNaN(parsed.getTime())) return parsed;
        }
      }
      // Try just year
      const yearMatch = text.match(/\b(20\d{2})\b/);
      if (yearMatch) {
        return new Date(`${yearMatch[1]}-01-01`);
      }
      return null;
    };

    // Helper to parse earnings from text like "$1,234,567" or "1.2M"
    const parseWinnings = (text: string): number | null => {
      if (!text) return null;
      text = text.replace(/,/g, '').replace(/\s/g, '');
      // Handle $1.2M format
      const millionMatch = text.match(/\$?([\d.]+)\s*[mM]/);
      if (millionMatch && millionMatch[1]) {
        return parseFloat(millionMatch[1]) * 1000000;
      }
      // Handle $1.2K format
      const thousandMatch = text.match(/\$?([\d.]+)\s*[kK]/);
      if (thousandMatch && thousandMatch[1]) {
        return parseFloat(thousandMatch[1]) * 1000;
      }
      // Handle plain number
      const numMatch = text.match(/\$?([\d.]+)/);
      if (numMatch && numMatch[1]) {
        const val = parseFloat(numMatch[1]);
        return val > 0 ? val : null;
      }
      return null;
    };

    // Extract from infobox rows
    $('.infobox-cell-2, .infobox-description, .fo-nttax-infobox tr').each((_, row) => {
      const $row = $(row);
      const labelCell = $row.find('th, .infobox-cell-1, .infobox-description').first();
      const valueCell = $row.find('td, .infobox-cell-2').first();
      const label = (labelCell.text() || '').toLowerCase().trim();
      const value = valueCell.text().trim();

      // Founded date
      if (label.includes('founded') || label.includes('created') || label.includes('established')) {
        foundedDate = parseInfoboxDate(value);
      }

      // Disbanded date
      if (label.includes('disbanded') || label.includes('dissolved') || label.includes('inactive')) {
        disbandedDate = parseInfoboxDate(value);
      }

      // Headquarters/Location
      if (label.includes('location') || label.includes('headquarters') || label.includes('hq') || label.includes('based')) {
        headquarters = value || null;
      }

      // Website (look for actual link, not wiki)
      if (label.includes('website') || label.includes('web')) {
        const link = valueCell.find('a').attr('href');
        if (link && !link.includes('liquipedia.net')) {
          websiteUrl = link;
        }
      }

      // Approx total winnings
      if (label.includes('winnings') || label.includes('earnings') || label.includes('prize')) {
        approxTotalWinnings = parseWinnings(value);
      }
    });

    // Also check for infobox data in different format
    $('.infobox').find('tr, div[class*="infobox"]').each((_, el) => {
      const $el = $(el);
      const text = $el.text().toLowerCase();
      const fullText = $el.text();

      if (text.includes('founded') && !foundedDate) {
        foundedDate = parseInfoboxDate(fullText);
      }
      if (text.includes('location') && !headquarters) {
        const match = fullText.match(/Location[:\s]+([^\n]+)/i);
        if (match && match[1]) headquarters = match[1].trim();
      }
      if (text.includes('total winnings') && !approxTotalWinnings) {
        approxTotalWinnings = parseWinnings(fullText);
      }
    });

    // Track current section (current vs former)
    let currentSection: 'current' | 'former' = 'current';

    // Process all content to detect sections
    const detectSection = (text: string): 'current' | 'former' | null => {
      const lowerText = text.toLowerCase();
      if (lowerText.includes('former') || lowerText.includes('inactive') ||
          lowerText.includes('left') || lowerText.includes('previous')) {
        return 'former';
      }
      if (lowerText.includes('current') || lowerText.includes('active roster') ||
          lowerText.includes('player roster')) {
        return 'current';
      }
      return null;
    };

    // Check headings for section changes
    $('h2, h3, h4').each((_, heading) => {
      const headingText = $(heading).text().trim();
      const section = detectSection(headingText);
      if (section) {
        currentSection = section;
      }
    });

    // Helper to extract and add player
    const addPlayer = (
      ign: string,
      realName: string | null,
      nationality: string | null,
      role: string,
      wikiUrl: string | null,
      status: 'current' | 'former'
    ) => {
      // Validate IGN
      if (!ign || ign.length === 0 || ign.length > 50) return;

      // Check for invalid patterns
      if (INVALID_PLAYER_PATTERNS.some(pattern => pattern.test(ign))) return;

      // Skip if we've already seen this IGN (dedupe)
      const ignLower = ign.toLowerCase();
      if (seenIgns.has(ignLower)) return;
      seenIgns.add(ignLower);

      // Clean up real name
      const cleanedRealName = cleanRealName(realName);

      roster.push({
        ign,
        realName: cleanedRealName,
        nationality,
        country: null,
        birthDate: null,
        role,
        status,
        wikiUrl,
      });
    };

    // Process each table, tracking section context
    $('h2, h3, h4, table.roster-card, table.wikitable, .roster-card').each((_, el) => {
      const $el = $(el);

      // Update section based on headings
      if ($el.is('h2, h3, h4')) {
        const headingText = $el.text().trim();
        const section = detectSection(headingText);
        if (section) {
          currentSection = section;
        }
        return;
      }

      // Process table rows
      if ($el.is('table')) {
        // Check if this table itself indicates a section
        const tableCaption = $el.find('caption').text().trim();
        const tableSection = detectSection(tableCaption);
        const effectiveSection = tableSection || currentSection;

        $el.find('tr').each((_, row) => {
          const $row = $(row);
          const cells = $row.find('td');
          const rowText = $row.text().toLowerCase();

          // Check if this row indicates former status
          const rowSection = detectSection(rowText) || effectiveSection;

          if (cells.length >= 2) {
            // Look for player link
            const playerLink = $row.find('a[href*="/fortnite/"]').first();
            const href = playerLink.attr('href') || '';

            // Skip non-player links
            if (href.includes('Portal:') || href.includes('Category:') ||
                href.includes('Tournament') || href.includes('S-Tier')) {
              return;
            }

            const ign = playerLink.text().trim() || cells.eq(1).text().trim();

            // Extract nationality from flag
            const flagImg = $row.find('img[src*="flag"], .flag img').first();
            const flagSrc = flagImg.attr('src') || '';
            const nationalityMatch = flagSrc.match(/\/([a-z]{2})\.png/i);

            // Extract real name
            let realName: string | null = cells.eq(2)?.text().trim() || null;
            if (!realName) {
              const textContent = $row.text();
              const nameMatch = textContent.match(/\(([^)]+)\)/);
              realName = nameMatch && nameMatch[1] ? nameMatch[1] : null;
            }

            // Determine role
            let role = 'Player';
            if (rowText.includes('coach')) role = 'Coach';
            else if (rowText.includes('manager')) role = 'Manager';
            else if (rowText.includes('analyst')) role = 'Analyst';
            else if (rowText.includes('substitute') || rowText.includes('sub')) role = 'Substitute';

            const wikiUrl = href ? `${LIQUIPEDIA_BASE}${href}` : null;
            addPlayer(ign, realName, nationalityMatch?.[1]?.toUpperCase() || null, role, wikiUrl, rowSection);
          }
        });
      }
    });

    // Also try to get players from infobox (usually current roster)
    $('.infobox-cell-2 a, .roster a').each((_, el) => {
      const $el = $(el);
      const href = $el.attr('href') || '';
      const ign = $el.text().trim();

      // Skip invalid links
      if (!href.includes('/fortnite/') || href.includes('Portal:') ||
          href.includes('Tournament') || href.includes('S-Tier')) {
        return;
      }

      addPlayer(ign, null, null, 'Player', `${LIQUIPEDIA_BASE}${href}`, 'current');
    });

    // Extract social media links (only from org-specific links, not Liquipedia's)
    const orgSocialMedia = new Map<string, string>();
    $('a[href*="twitter.com"], a[href*="x.com"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && !href.includes('liquipedia')) {
        orgSocialMedia.set('twitter', href);
      }
    });
    $('a[href*="youtube.com"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && !href.includes('liquipedia')) {
        orgSocialMedia.set('youtube', href);
      }
    });
    $('a[href*="twitch.tv"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && !href.includes('liquipedia')) {
        orgSocialMedia.set('twitch', href);
      }
    });
    $('a[href*="instagram.com"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        orgSocialMedia.set('instagram', href);
      }
    });
    $('a[href*="discord.gg"], a[href*="discord.com"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        orgSocialMedia.set('discord', href);
      }
    });
    $('a[href*="facebook.com"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && !href.includes('liquipedia')) {
        orgSocialMedia.set('facebook', href);
      }
    });

    if (orgSocialMedia.get('twitter')) socialMedia.twitter = orgSocialMedia.get('twitter');
    if (orgSocialMedia.get('youtube')) socialMedia.youtube = orgSocialMedia.get('youtube');
    if (orgSocialMedia.get('twitch')) socialMedia.twitch = orgSocialMedia.get('twitch');
    if (orgSocialMedia.get('instagram')) socialMedia.instagram = orgSocialMedia.get('instagram');
    if (orgSocialMedia.get('discord')) socialMedia.discord = orgSocialMedia.get('discord');
    if (orgSocialMedia.get('facebook')) socialMedia.facebook = orgSocialMedia.get('facebook');

    // Extract description from first paragraph
    const description = $('.mw-parser-output > p').first().text().trim() || null;

    // Try to get better logo from infobox (lightmode version)
    let logoUrl = org.logoUrl;
    const infoboxLogo = $('.infobox-image.lightmode img, .infobox img, .team-template-image img').first();
    const infoboxLogoSrc = infoboxLogo.attr('src') || infoboxLogo.attr('data-src');
    if (infoboxLogoSrc && !infoboxLogoSrc.includes('NoImage')) {
      logoUrl = infoboxLogoSrc.startsWith('http') ? infoboxLogoSrc : `${LIQUIPEDIA_BASE}${infoboxLogoSrc}`;
    }

    const result: OrgWithRoster = {
      ...org,
      logoUrl,
      roster,
      description,
      foundedDate,
      disbandedDate,
      headquarters,
      websiteUrl,
      approxTotalWinnings,
      socialMedia,
    };

    cache.set(cacheKey, result, 1800); // 30 min cache for details
    return result;
  } catch (error: any) {
    console.error(`Failed to scrape org ${orgSlug}:`, error.message);
    return null;
  }
}

/**
 * Clean up real name (fix duplicated names like "(Thomas Mulligan)Thomas Mulligan")
 */
function cleanRealName(name: string | null | undefined): string | null {
  if (!name) return null;

  // Fix pattern: "(Name)Name" -> "Name"
  const duplicateMatch = name.match(/^\(([^)]+)\)\1$/);
  if (duplicateMatch && duplicateMatch[1]) {
    return duplicateMatch[1];
  }

  // Fix pattern: "(Name)Name with extra" -> "Name with extra"
  const partialMatch = name.match(/^\(([^)]+)\)(.+)$/);
  if (partialMatch && partialMatch[1] && partialMatch[2]) {
    const inParens = partialMatch[1];
    const afterParens = partialMatch[2].trim();
    // If the text after parens starts with the text in parens, use after parens
    if (afterParens.toLowerCase().startsWith(inParens.toLowerCase())) {
      return afterParens;
    }
    return afterParens || inParens;
  }

  return name.trim();
}

/**
 * Sync scraped orgs to database
 */
export async function syncOrgsToDatabase(): Promise<number> {
  const orgs = await scrapeAllOrgs();
  let synced = 0;

  for (const org of orgs) {
    try {
      await prisma.organization.upsert({
        where: { slug: org.slug },
        create: {
          slug: org.slug,
          name: org.name,
          logoUrl: org.logoUrl,
          region: org.region,
          website: org.wikiUrl,
        },
        update: {
          name: org.name,
          logoUrl: org.logoUrl,
          region: org.region,
          website: org.wikiUrl,
          lastUpdated: new Date(),
        },
      });
      synced++;
    } catch (error: any) {
      console.error(`Failed to sync org ${org.slug}:`, error.message);
    }
  }

  return synced;
}

/**
 * Sync full details (logo, roster) for all orgs
 */
export async function syncAllOrgsWithDetails(): Promise<{
  synced: number;
  logos: number;
  withHQ: number;
  withWinnings: number;
  withWebsite: number;
}> {
  const orgs = await prisma.organization.findMany({ select: { slug: true } });
  let synced = 0;
  let logos = 0;
  let withHQ = 0;
  let withWinnings = 0;
  let withWebsite = 0;

  for (const org of orgs) {
    try {
      const details = await scrapeOrgDetails(org.slug);
      if (details) {
        await prisma.organization.update({
          where: { slug: org.slug },
          data: {
            logoUrl: details.logoUrl,
            description: details.description,
            foundedDate: details.foundedDate,
            disbandedDate: details.disbandedDate,
            headquarters: details.headquarters,
            website: details.websiteUrl,
            approxTotalWinnings: details.approxTotalWinnings,
            socialMedia: details.socialMedia || {},
            lastUpdated: new Date(),
          },
        });
        if (details.logoUrl) logos++;
        if (details.headquarters) withHQ++;
        if (details.approxTotalWinnings) withWinnings++;
        if (details.websiteUrl) withWebsite++;
      }
      synced++;
      // Rate limit to avoid hammering Liquipedia
      await new Promise(r => setTimeout(r, 200));
    } catch (error: any) {
      console.error(`Failed to sync details for ${org.slug}:`, error.message);
    }
  }

  return { synced, logos, withHQ, withWinnings, withWebsite };
}

/**
 * Sync org roster to database
 * Creates/links Player records and tracks current/former status
 * @param orgSlug - The org's slug identifier
 * @param options.skipPlayerDetails - If true, skip scraping individual player pages (faster)
 */
export async function syncRosterToDatabase(orgSlug: string, options?: { skipPlayerDetails?: boolean }): Promise<number> {
  const { skipPlayerDetails = false } = options || {};
  const orgDetails = await scrapeOrgDetails(orgSlug);
  if (!orgDetails) return 0;

  // Ensure organization exists in database (upsert)
  await prisma.organization.upsert({
    where: { slug: orgSlug },
    create: {
      slug: orgSlug,
      name: orgDetails.name,
      logoUrl: orgDetails.logoUrl,
      region: orgDetails.region,
      website: orgDetails.wikiUrl,
      description: orgDetails.description,
      socialMedia: orgDetails.socialMedia || {},
    },
    update: {
      name: orgDetails.name,
      logoUrl: orgDetails.logoUrl,
      region: orgDetails.region,
      website: orgDetails.wikiUrl,
      description: orgDetails.description,
      socialMedia: orgDetails.socialMedia || {},
      lastUpdated: new Date(),
    },
  });

  let synced = 0;

  // Mark existing roster entries as needing update
  // Don't immediately deactivate - we'll update based on scraped status
  const existingRoster = await prisma.teamRoster.findMany({
    where: { orgSlug },
  });
  const existingByName = new Map(existingRoster.map(r => [r.playerName.toLowerCase(), r]));

  for (const player of orgDetails.roster) {
    try {
      // Scrape full player details if they have a wiki URL (unless skipPlayerDetails is true)
      let playerDetails: ScrapedPlayerDetails = {};
      if (player.wikiUrl && !skipPlayerDetails) {
        playerDetails = await scrapePlayerDetails(player.wikiUrl);
      }

      // Find or create the Player record with full details
      const playerRecord = await findOrCreatePlayer(player.ign, {
        wikiUrl: player.wikiUrl || undefined,
        realName: playerDetails.realName || player.realName || undefined,
        nationality: playerDetails.nationality || player.nationality || undefined,
        country: playerDetails.country || undefined,
        birthDate: playerDetails.birthDate || undefined,
        imageUrl: playerDetails.imageUrl || undefined,
      });

      // Find existing roster entry for this player
      const existingEntry = existingByName.get(player.ign.toLowerCase());

      if (existingEntry) {
        // Update existing roster entry
        await prisma.teamRoster.update({
          where: { id: existingEntry.id },
          data: {
            playerId: playerRecord.playerId,
            role: player.role,
            nationality: player.nationality,
            status: player.status,
            isActive: player.status === 'current',
            leaveDate: player.status === 'former' ? new Date() : null,
            lastUpdated: new Date(),
          },
        });
      } else {
        // Create new roster entry
        await prisma.teamRoster.create({
          data: {
            orgSlug,
            playerId: playerRecord.playerId,
            playerName: player.ign,
            role: player.role,
            nationality: player.nationality,
            status: player.status,
            isActive: player.status === 'current',
            joinDate: player.status === 'current' ? new Date() : null,
            leaveDate: player.status === 'former' ? new Date() : null,
            socialMedia: player.wikiUrl ? { wiki: player.wikiUrl } : undefined,
          },
        });
      }
      synced++;
    } catch (error: any) {
      console.error(`Failed to sync player ${player.ign}:`, error.message);
    }
  }

  return synced;
}

/**
 * Get org from database with fallback to scraping
 */
export async function getOrg(slug: string, options?: { includeFormer?: boolean }): Promise<OrgWithRoster | null> {
  const { includeFormer = false } = options || {};

  // Try database first
  const dbOrg = await prisma.organization.findUnique({
    where: { slug },
    include: {
      roster: {
        where: includeFormer ? {} : { status: 'current' },
        orderBy: [{ status: 'asc' }, { role: 'asc' }],
        include: { player: true },
      },
    },
  });

  if (dbOrg) {
    return {
      slug: dbOrg.slug,
      name: dbOrg.name,
      logoUrl: dbOrg.logoUrl,
      region: dbOrg.region,
      wikiUrl: dbOrg.website || '',
      description: dbOrg.description,
      foundedDate: dbOrg.foundedDate,
      disbandedDate: dbOrg.disbandedDate,
      headquarters: dbOrg.headquarters,
      websiteUrl: dbOrg.website,
      approxTotalWinnings: dbOrg.approxTotalWinnings ? Number(dbOrg.approxTotalWinnings) : null,
      socialMedia: (dbOrg.socialMedia as OrgWithRoster['socialMedia']) || {},
      roster: dbOrg.roster.map(r => ({
        ign: r.playerName,
        realName: r.player?.realName || null,
        nationality: r.nationality || r.player?.nationality || null,
        country: r.player?.country || null,
        birthDate: r.player?.birthDate || null,
        role: r.role,
        status: r.status as 'current' | 'former',
        wikiUrl: r.player?.wikiUrl || (r.socialMedia as any)?.wiki || null,
        imageUrl: r.player?.imageUrl || null,
        playerId: r.playerId || undefined,
      })),
    };
  }

  // Fallback to scraping
  return scrapeOrgDetails(slug);
}

/**
 * Get roster counts for an org
 */
export async function getRosterCounts(slug: string): Promise<{ current: number; former: number }> {
  const [current, former] = await Promise.all([
    prisma.teamRoster.count({ where: { orgSlug: slug, status: 'current' } }),
    prisma.teamRoster.count({ where: { orgSlug: slug, status: 'former' } }),
  ]);
  return { current, former };
}

/**
 * List all orgs from database with fallback to scraping
 */
export async function listOrgs(options?: {
  region?: string;
  limit?: number;
  offset?: number;
}): Promise<ScrapedOrg[]> {
  const { region, limit = 50, offset = 0 } = options || {};

  // Try database first
  const dbOrgs = await prisma.organization.findMany({
    where: region ? { region } : undefined,
    take: limit,
    skip: offset,
    orderBy: { name: 'asc' },
  });

  if (dbOrgs.length > 0) {
    return dbOrgs.map(org => ({
      slug: org.slug,
      name: org.name,
      logoUrl: org.logoUrl,
      region: org.region,
      wikiUrl: org.website || '',
    }));
  }

  // Fallback to scraping
  const scraped = await scrapeAllOrgs();
  const filtered = region ? scraped.filter(o => o.region === region) : scraped;
  return filtered.slice(offset, offset + limit);
}

export interface ScrapedTransfer {
  playerName: string;
  playerWikiUrl?: string;
  fromOrg?: string;
  toOrg?: string;
  transferDate: Date;
  transferType: 'join' | 'leave' | 'transfer' | 'release' | 'retire';
  details?: string;
}

/**
 * Scrape transfers from Liquipedia Transfers portal
 * @param options.limit - Max transfers to return
 * @param options.startDate - Only return transfers after this date
 * @param options.year - Specific year to scrape (default: current year)
 * @param options.month - Specific month name to scrape (default: current month)
 */
export async function scrapeTransfers(options?: {
  limit?: number;
  startDate?: Date;
  year?: number;
  month?: string;
}): Promise<ScrapedTransfer[]> {
  const { limit = 100, startDate, year: requestedYear, month: requestedMonth } = options || {};

  try {
    // Get transfers page - use provided year/month or default to current
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                        'July', 'August', 'September', 'October', 'November', 'December'];
    const now = new Date();
    const year = requestedYear || now.getFullYear();
    const month = requestedMonth || monthNames[now.getMonth()];

    // Try requested month first, fall back to previous months if 404
    let transferUrl = `${LIQUIPEDIA_FORTNITE}/Player_Transfers/${year}/${month}`;
    let html: string;

    console.log(`Fetching transfers from: ${transferUrl}`);
    try {
      html = await fetchWithProxy(transferUrl);
    } catch (err: any) {
      if ((err.response?.status === 404 || err.message?.includes('404')) && !requestedMonth) {
        // Only fall back to previous month if no specific month was requested
        const prevDate = new Date(now);
        prevDate.setMonth(prevDate.getMonth() - 1);
        const prevYear = prevDate.getFullYear();
        const prevMonth = monthNames[prevDate.getMonth()];
        transferUrl = `${LIQUIPEDIA_FORTNITE}/Player_Transfers/${prevYear}/${prevMonth}`;
        console.log(`Current month not found, trying: ${transferUrl}`);
        html = await fetchWithProxy(transferUrl);
      } else {
        throw err;
      }
    }
    const $ = cheerio.load(html);

    const transfers: ScrapedTransfer[] = [];

    // Helper to get org name from a cell
    const getOrgName = ($cell: cheerio.Cheerio<cheerio.Element>): string | undefined => {
      // First try to get from data-highlighting-class attribute (most reliable for team names)
      const teamSpan = $cell.find('[data-highlighting-class]').first();
      if (teamSpan.length) {
        const name = teamSpan.attr('data-highlighting-class')?.trim();
        if (name && name.length >= 2 && name.toLowerCase() !== 'none') {
          return name;
        }
      }

      // Then try from link title attribute
      const teamLink = $cell.find('a[href*="/fortnite/"]').filter((_, el) => {
        const href = $(el).attr('href') || '';
        // Filter out player links and reference links
        return !href.includes('index.php') && !href.includes('Portal:');
      }).first();

      if (teamLink.length) {
        const titleName = teamLink.attr('title')?.trim();
        if (titleName && titleName.length >= 2 && titleName.toLowerCase() !== 'none') {
          return titleName;
        }
      }

      // Fall back to text content
      let name = teamLink.text().trim();
      if (!name || name.length < 2) {
        // Try getting text without nested elements
        name = $cell.clone().children('small').remove().end().text().trim();
      }

      // Clean up the name (including non-breaking spaces)
      name = name.replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();

      // Skip empty, None, or dash values
      if (!name || name === '-' || name.toLowerCase() === 'none' || name === '—') {
        return undefined;
      }

      return name;
    };

    // Liquipedia uses div-based structure with divRow elements
    // Structure: div.divRow > div.divCell (Date, Name, OldTeam, Icon, NewTeam, Ref)
    $('div.divRow').each((_, row) => {
      if (transfers.length >= limit) return;

      const $row = $(row);
      // Skip header rows
      if ($row.hasClass('divHeaderRow')) return;

      const cells = $row.find('div.divCell');
      // Need at least Date, Name, OldTeam, Icon, NewTeam
      if (cells.length < 5) return;

      // Extract date from first cell (div.divCell.Date)
      const dateText = cells.filter('.Date').first().text().trim() || cells.eq(0).text().trim();
      // Handle YYYY-MM-DD format
      const dateMatch = dateText.match(/(\d{4})-(\d{2})-(\d{2})/);
      let transferDate: Date;
      if (dateMatch) {
        transferDate = new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`);
      } else {
        transferDate = new Date(dateText);
      }
      if (isNaN(transferDate.getTime())) return;

      // Check start date filter
      if (startDate && transferDate < startDate) return;

      // Extract player info from Name cell
      const playerCell = cells.filter('.Name').first();
      const playerLink = playerCell.find('a[href*="/fortnite/"]').first();
      let playerName = playerLink.text().trim();
      // If no link found, try getting text directly (skip flag images)
      if (!playerName) {
        playerName = playerCell.clone().children('span.flag').remove().end().text().trim();
      }
      if (!playerName) {
        playerName = playerCell.text().trim();
      }

      const playerWikiUrl = playerLink.attr('href')
        ? `${LIQUIPEDIA_BASE}${playerLink.attr('href')}`
        : undefined;

      if (!playerName || playerName.length > 50 || playerName.length < 2) return;

      // Extract Old team and New team from Team cells
      const oldCell = cells.filter('.OldTeam').first();
      const newCell = cells.filter('.NewTeam').first();

      const fromOrg = getOrgName(oldCell);
      const toOrg = getOrgName(newCell);

      // Determine transfer type
      let transferType: ScrapedTransfer['transferType'] = 'transfer';
      if (!fromOrg && toOrg) {
        transferType = 'join';
      } else if (fromOrg && !toOrg) {
        transferType = 'leave';
      } else if (fromOrg && toOrg) {
        transferType = 'transfer';
      } else {
        // Neither from nor to - skip
        return;
      }

      // Extract details/notes from Ref cell
      const refCell = cells.filter('.Ref').first();
      const details = refCell.length ? refCell.text().trim() : '';
      const hasRetired = details.toLowerCase().includes('retire');
      const hasReleased = details.toLowerCase().includes('release');
      if (hasRetired) transferType = 'retire';
      if (hasReleased) transferType = 'release';

      transfers.push({
        playerName,
        playerWikiUrl,
        fromOrg,
        toOrg,
        transferDate,
        transferType,
        details: details && details.length < 500 && details.length > 0 ? details : undefined,
      });
    });

    console.log(`Scraped ${transfers.length} transfers from Liquipedia`);
    return transfers;
  } catch (error: any) {
    console.error('Failed to scrape transfers:', error.message);
    return [];
  }
}

/**
 * Sync transfers to database
 * @param options.limit - Max transfers to sync
 * @param options.year - Year to sync (default: current year)
 * @param options.month - Month name to sync (default: current month)
 */
export async function syncTransfers(options?: { limit?: number; year?: number; month?: string }): Promise<number> {
  const { limit = 100, year, month } = options || {};

  const transfers = await scrapeTransfers({ limit, year, month });
  let synced = 0;

  for (const transfer of transfers) {
    try {
      // Try to find the player
      const player = await prisma.player.findFirst({
        where: {
          OR: [
            { currentIgn: { equals: transfer.playerName, mode: 'insensitive' } },
            { wikiUrl: transfer.playerWikiUrl },
          ],
        },
      });

      // Convert org names to slugs
      const fromSlug = transfer.fromOrg
        ? transfer.fromOrg.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        : undefined;
      const toSlug = transfer.toOrg
        ? transfer.toOrg.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        : undefined;

      // Check if orgs exist (create if not)
      if (fromSlug) {
        await prisma.organization.upsert({
          where: { slug: fromSlug },
          create: { slug: fromSlug, name: transfer.fromOrg! },
          update: {},
        });
      }
      if (toSlug) {
        await prisma.organization.upsert({
          where: { slug: toSlug },
          create: { slug: toSlug, name: transfer.toOrg! },
          update: {},
        });
      }

      // Check if this transfer already exists
      const existing = await prisma.playerTransfer.findFirst({
        where: {
          playerName: { equals: transfer.playerName, mode: 'insensitive' },
          transferDate: transfer.transferDate,
          fromOrgSlug: fromSlug || null,
          toOrgSlug: toSlug || null,
        },
      });

      if (!existing) {
        await prisma.playerTransfer.create({
          data: {
            playerId: player?.playerId,
            accountId: player?.epicAccountId || `wiki-${transfer.playerName}`,
            playerName: transfer.playerName,
            fromOrgSlug: fromSlug,
            toOrgSlug: toSlug,
            transferDate: transfer.transferDate,
            transferType: transfer.transferType,
            details: transfer.details,
          },
        });
        synced++;
      }
    } catch (error: any) {
      console.error(`Failed to sync transfer for ${transfer.playerName}:`, error.message);
    }
  }

  return synced;
}

/**
 * Get recent transfers
 */
export async function getRecentTransfers(options?: {
  limit?: number;
  offset?: number;
  orgSlug?: string;
}): Promise<any[]> {
  const { limit = 20, offset = 0, orgSlug } = options || {};

  const whereClause: any = {};
  if (orgSlug) {
    whereClause.OR = [{ fromOrgSlug: orgSlug }, { toOrgSlug: orgSlug }];
  }

  return await prisma.playerTransfer.findMany({
    where: whereClause,
    include: {
      player: true,
      fromOrg: true,
      toOrg: true,
    },
    orderBy: { transferDate: 'desc' },
    take: limit,
    skip: offset,
  });
}

export const orgService = {
  scrapeAllOrgs,
  scrapeOrgDetails,
  syncOrgsToDatabase,
  syncAllOrgsWithDetails,
  syncRosterToDatabase,
  scrapeTransfers,
  syncTransfers,
  getRecentTransfers,
  getOrg,
  getRosterCounts,
  listOrgs,
};
