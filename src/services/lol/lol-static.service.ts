import axios from 'axios';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/client.js';

/**
 * LoL Static Data Service
 * Handles static game data from Riot's Data Dragon CDN
 * Base URL: https://ddragon.leagueoflegends.com
 */

const DDRAGON_BASE_URL = 'https://ddragon.leagueoflegends.com';

// Types
export interface DataDragonChampion {
  id: string;
  key: string;
  name: string;
  title: string;
  image: {
    full: string;
    sprite: string;
    group: string;
  };
  tags: string[];
  stats: Record<string, number>;
  info: {
    attack: number;
    defense: number;
    magic: number;
    difficulty: number;
  };
}

export interface DataDragonItem {
  name: string;
  description: string;
  plaintext?: string;
  image: {
    full: string;
  };
  gold: {
    base: number;
    purchasable: boolean;
    total: number;
    sell: number;
  };
  tags?: string[];
  stats?: Record<string, number>;
  into?: string[];
  from?: string[];
}

export interface LolChampionResult {
  championId: number;
  name: string;
  title: string | null;
  key: string;
  roles: string[] | null;
  imageUrl: string | null;
  splashUrl: string | null;
  releaseDate: Date | null;
  data: Record<string, unknown> | null;
}

export interface LolItemResult {
  itemId: number;
  name: string;
  description: string | null;
  plaintext: string | null;
  gold: number | null;
  imageUrl: string | null;
  tags: string[] | null;
  stats: Record<string, unknown> | null;
  isCompleted: boolean;
}

export interface LolPatchResult {
  patch: string;
  releaseDate: Date | null;
  highlightUrl: string | null;
  notesUrl: string | null;
  isCurrentPatch: boolean;
}

export interface LolRegion {
  id: string;
  name: string;
  shortName: string;
  platform: string;
}

export interface LolRole {
  id: string;
  name: string;
  alternateNames: string[];
}

// Static region data
const LOL_REGIONS: LolRegion[] = [
  { id: 'kr', name: 'Korea', shortName: 'KR', platform: 'KR' },
  { id: 'cn', name: 'China', shortName: 'CN', platform: 'CN' },
  { id: 'euw', name: 'Europe West', shortName: 'EUW', platform: 'EUW1' },
  { id: 'eune', name: 'Europe Nordic & East', shortName: 'EUNE', platform: 'EUN1' },
  { id: 'na', name: 'North America', shortName: 'NA', platform: 'NA1' },
  { id: 'br', name: 'Brazil', shortName: 'BR', platform: 'BR1' },
  { id: 'lan', name: 'Latin America North', shortName: 'LAN', platform: 'LA1' },
  { id: 'las', name: 'Latin America South', shortName: 'LAS', platform: 'LA2' },
  { id: 'oce', name: 'Oceania', shortName: 'OCE', platform: 'OC1' },
  { id: 'tr', name: 'Turkey', shortName: 'TR', platform: 'TR1' },
  { id: 'ru', name: 'Russia', shortName: 'RU', platform: 'RU' },
  { id: 'jp', name: 'Japan', shortName: 'JP', platform: 'JP1' },
  { id: 'sea', name: 'Southeast Asia', shortName: 'SEA', platform: 'SG2' },
  { id: 'tw', name: 'Taiwan', shortName: 'TW', platform: 'TW2' },
  { id: 'vn', name: 'Vietnam', shortName: 'VN', platform: 'VN2' },
  { id: 'ph', name: 'Philippines', shortName: 'PH', platform: 'PH2' },
  { id: 'th', name: 'Thailand', shortName: 'TH', platform: 'TH2' },
];

// Static role data
const LOL_ROLES: LolRole[] = [
  { id: 'top', name: 'Top', alternateNames: ['Top Lane', 'TOP', 'Toplane'] },
  { id: 'jungle', name: 'Jungle', alternateNames: ['JNG', 'JG', 'Jungler'] },
  { id: 'mid', name: 'Mid', alternateNames: ['Middle', 'MID', 'Mid Lane', 'Midlane'] },
  { id: 'adc', name: 'ADC', alternateNames: ['Bot', 'BOT', 'AD Carry', 'Marksman', 'Bottom'] },
  { id: 'support', name: 'Support', alternateNames: ['SUP', 'SUPP', 'Supporter'] },
];

/**
 * Fetch available patch versions from Data Dragon
 */
async function fetchVersions(): Promise<string[]> {
  try {
    const response = await axios.get<string[]>(`${DDRAGON_BASE_URL}/api/versions.json`, {
      timeout: 30000,
    });
    return response.data;
  } catch (error: any) {
    console.error('[LolStaticService] Error fetching versions:', error.message);
    throw new Error(`Failed to fetch versions: ${error.message}`);
  }
}

/**
 * Sync champion data from Data Dragon to database
 */
export async function syncChampions(version?: string): Promise<number> {
  try {
    // Get latest version if not specified
    const versions = await fetchVersions();
    const targetVersion = version || versions[0];

    console.log(`[LolStaticService] Syncing champions for patch ${targetVersion}...`);

    const response = await axios.get<{
      data: Record<string, DataDragonChampion>;
    }>(`${DDRAGON_BASE_URL}/cdn/${targetVersion}/data/en_US/champion.json`, {
      timeout: 30000,
    });

    const champions = response.data.data;
    let syncedCount = 0;

    for (const [, champion] of Object.entries(champions)) {
      const championId = parseInt(champion.key, 10);
      const imageUrl = `${DDRAGON_BASE_URL}/cdn/${targetVersion}/img/champion/${champion.image.full}`;
      const splashUrl = `${DDRAGON_BASE_URL}/cdn/img/champion/splash/${champion.id}_0.jpg`;

      await prisma.lolChampion.upsert({
        where: { championId },
        create: {
          championId,
          name: champion.name,
          title: champion.title,
          key: champion.id,
          roles: champion.tags,
          imageUrl,
          splashUrl,
          data: {
            stats: champion.stats,
            info: champion.info,
          },
          lastUpdated: new Date(),
        },
        update: {
          name: champion.name,
          title: champion.title,
          roles: champion.tags,
          imageUrl,
          splashUrl,
          data: {
            stats: champion.stats,
            info: champion.info,
          },
          lastUpdated: new Date(),
        },
      });

      syncedCount++;
    }

    console.log(`[LolStaticService] Synced ${syncedCount} champions`);
    return syncedCount;
  } catch (error: any) {
    console.error('[LolStaticService] Error syncing champions:', error.message);
    throw new Error(`Failed to sync champions: ${error.message}`);
  }
}

/**
 * Sync item data from Data Dragon to database
 */
export async function syncItems(version?: string): Promise<number> {
  try {
    // Get latest version if not specified
    const versions = await fetchVersions();
    const targetVersion = version || versions[0];

    console.log(`[LolStaticService] Syncing items for patch ${targetVersion}...`);

    const response = await axios.get<{
      data: Record<string, DataDragonItem>;
    }>(`${DDRAGON_BASE_URL}/cdn/${targetVersion}/data/en_US/item.json`, {
      timeout: 30000,
    });

    const items = response.data.data;
    let syncedCount = 0;

    for (const [itemIdStr, item] of Object.entries(items)) {
      const itemId = parseInt(itemIdStr, 10);
      const imageUrl = `${DDRAGON_BASE_URL}/cdn/${targetVersion}/img/item/${item.image.full}`;

      // Determine if item is a completed item (no 'into' field and has 'from' field)
      const isCompleted = !item.into && !!item.from && item.from.length > 0;

      await prisma.lolItem.upsert({
        where: { itemId },
        create: {
          itemId,
          name: item.name,
          description: item.description,
          plaintext: item.plaintext?.slice(0, 500) || null,
          gold: item.gold?.total || null,
          imageUrl,
          tags: item.tags || [],
          stats: item.stats || Prisma.JsonNull,
          isCompleted,
          lastUpdated: new Date(),
        },
        update: {
          name: item.name,
          description: item.description,
          plaintext: item.plaintext?.slice(0, 500) || null,
          gold: item.gold?.total || null,
          imageUrl,
          tags: item.tags || [],
          stats: item.stats || Prisma.JsonNull,
          isCompleted,
          lastUpdated: new Date(),
        },
      });

      syncedCount++;
    }

    console.log(`[LolStaticService] Synced ${syncedCount} items`);
    return syncedCount;
  } catch (error: any) {
    console.error('[LolStaticService] Error syncing items:', error.message);
    throw new Error(`Failed to sync items: ${error.message}`);
  }
}

/**
 * Sync patch versions from Data Dragon to database
 */
export async function syncPatches(): Promise<number> {
  try {
    console.log('[LolStaticService] Syncing patches...');

    const versions = await fetchVersions();

    // Mark all existing patches as not current
    await prisma.lolPatch.updateMany({
      where: { isCurrentPatch: true },
      data: { isCurrentPatch: false },
    });

    let syncedCount = 0;

    // Sync top 50 versions (recent patches)
    const recentVersions = versions.slice(0, 50);

    for (let i = 0; i < recentVersions.length; i++) {
      const patch = recentVersions[i];
      if (!patch) continue;
      const isCurrentPatch = i === 0;

      // Generate URLs for patch notes
      const patchForUrl = patch.replace(/\./g, '-');
      const notesUrl = `https://www.leagueoflegends.com/en-us/news/game-updates/patch-${patchForUrl}-notes/`;

      await prisma.lolPatch.upsert({
        where: { patch },
        create: {
          patch,
          notesUrl,
          isCurrentPatch,
          lastUpdated: new Date(),
        },
        update: {
          notesUrl,
          isCurrentPatch,
          lastUpdated: new Date(),
        },
      });

      syncedCount++;
    }

    console.log(`[LolStaticService] Synced ${syncedCount} patches`);
    return syncedCount;
  } catch (error: any) {
    console.error('[LolStaticService] Error syncing patches:', error.message);
    throw new Error(`Failed to sync patches: ${error.message}`);
  }
}

/**
 * Get all champions from database
 */
export async function getChampions(options?: {
  role?: string;
  limit?: number;
  offset?: number;
}): Promise<LolChampionResult[]> {
  const { role, limit = 200, offset = 0 } = options || {};

  try {
    const where: any = {};

    if (role) {
      where.roles = {
        array_contains: [role],
      };
    }

    const champions = await prisma.lolChampion.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { name: 'asc' },
    });

    return champions.map((c) => ({
      championId: c.championId,
      name: c.name,
      title: c.title,
      key: c.key,
      roles: c.roles as string[] | null,
      imageUrl: c.imageUrl,
      splashUrl: c.splashUrl,
      releaseDate: c.releaseDate,
      data: c.data as Record<string, unknown> | null,
    }));
  } catch (error: any) {
    console.error('[LolStaticService] Error getting champions:', error.message);
    throw new Error(`Failed to get champions: ${error.message}`);
  }
}

/**
 * Get a single champion by ID or key
 */
export async function getChampionById(id: string | number): Promise<LolChampionResult | null> {
  try {
    let champion;

    if (typeof id === 'number' || !isNaN(Number(id))) {
      // Search by champion ID
      champion = await prisma.lolChampion.findUnique({
        where: { championId: Number(id) },
      });
    } else {
      // Search by key (champion name like "Aatrox")
      champion = await prisma.lolChampion.findUnique({
        where: { key: id },
      });

      // If not found by key, try case-insensitive name search
      if (!champion) {
        champion = await prisma.lolChampion.findFirst({
          where: {
            OR: [
              { key: { equals: id, mode: 'insensitive' } },
              { name: { equals: id, mode: 'insensitive' } },
            ],
          },
        });
      }
    }

    if (!champion) return null;

    return {
      championId: champion.championId,
      name: champion.name,
      title: champion.title,
      key: champion.key,
      roles: champion.roles as string[] | null,
      imageUrl: champion.imageUrl,
      splashUrl: champion.splashUrl,
      releaseDate: champion.releaseDate,
      data: champion.data as Record<string, unknown> | null,
    };
  } catch (error: any) {
    console.error('[LolStaticService] Error getting champion:', error.message);
    throw new Error(`Failed to get champion: ${error.message}`);
  }
}

/**
 * Get all items from database
 */
export async function getItems(options?: {
  completedOnly?: boolean;
  tag?: string;
  limit?: number;
  offset?: number;
}): Promise<LolItemResult[]> {
  const { completedOnly, tag, limit = 500, offset = 0 } = options || {};

  try {
    const where: any = {};

    if (completedOnly) {
      where.isCompleted = true;
    }

    if (tag) {
      where.tags = {
        array_contains: [tag],
      };
    }

    const items = await prisma.lolItem.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { name: 'asc' },
    });

    return items.map((i) => ({
      itemId: i.itemId,
      name: i.name,
      description: i.description,
      plaintext: i.plaintext,
      gold: i.gold,
      imageUrl: i.imageUrl,
      tags: i.tags as string[] | null,
      stats: i.stats as Record<string, unknown> | null,
      isCompleted: i.isCompleted,
    }));
  } catch (error: any) {
    console.error('[LolStaticService] Error getting items:', error.message);
    throw new Error(`Failed to get items: ${error.message}`);
  }
}

/**
 * Get a single item by ID
 */
export async function getItemById(id: number): Promise<LolItemResult | null> {
  try {
    const item = await prisma.lolItem.findUnique({
      where: { itemId: id },
    });

    if (!item) return null;

    return {
      itemId: item.itemId,
      name: item.name,
      description: item.description,
      plaintext: item.plaintext,
      gold: item.gold,
      imageUrl: item.imageUrl,
      tags: item.tags as string[] | null,
      stats: item.stats as Record<string, unknown> | null,
      isCompleted: item.isCompleted,
    };
  } catch (error: any) {
    console.error('[LolStaticService] Error getting item:', error.message);
    throw new Error(`Failed to get item: ${error.message}`);
  }
}

/**
 * Get all patches from database
 */
export async function getPatches(options?: {
  limit?: number;
  offset?: number;
}): Promise<LolPatchResult[]> {
  const { limit = 50, offset = 0 } = options || {};

  try {
    const patches = await prisma.lolPatch.findMany({
      take: limit,
      skip: offset,
      orderBy: { patch: 'desc' },
    });

    return patches.map((p) => ({
      patch: p.patch,
      releaseDate: p.releaseDate,
      highlightUrl: p.highlightUrl,
      notesUrl: p.notesUrl,
      isCurrentPatch: p.isCurrentPatch,
    }));
  } catch (error: any) {
    console.error('[LolStaticService] Error getting patches:', error.message);
    throw new Error(`Failed to get patches: ${error.message}`);
  }
}

/**
 * Get the current patch version
 */
export async function getCurrentPatch(): Promise<LolPatchResult | null> {
  try {
    // First try to get from database
    let patch = await prisma.lolPatch.findFirst({
      where: { isCurrentPatch: true },
    });

    // If not found in database, fetch from Data Dragon
    if (!patch) {
      const versions = await fetchVersions();
      const currentVersion = versions[0];
      if (currentVersion) {
        // Try to find this version in database
        patch = await prisma.lolPatch.findUnique({
          where: { patch: currentVersion },
        });

        // If still not found, return minimal data
        if (!patch) {
          return {
            patch: currentVersion,
            releaseDate: null,
            highlightUrl: null,
            notesUrl: null,
            isCurrentPatch: true,
          };
        }
      }
    }

    if (!patch) return null;

    return {
      patch: patch.patch,
      releaseDate: patch.releaseDate,
      highlightUrl: patch.highlightUrl,
      notesUrl: patch.notesUrl,
      isCurrentPatch: patch.isCurrentPatch,
    };
  } catch (error: any) {
    console.error('[LolStaticService] Error getting current patch:', error.message);
    throw new Error(`Failed to get current patch: ${error.message}`);
  }
}

/**
 * Get list of regions
 */
export function getRegions(): LolRegion[] {
  return LOL_REGIONS;
}

/**
 * Get list of roles
 */
export function getRoles(): LolRole[] {
  return LOL_ROLES;
}

// Export as service object
export const lolStaticService = {
  syncChampions,
  syncItems,
  syncPatches,
  getChampions,
  getChampionById,
  getItems,
  getItemById,
  getPatches,
  getCurrentPatch,
  getRegions,
  getRoles,
};
