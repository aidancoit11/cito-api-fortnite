import { prisma } from '../db/client.js';
import type { Player, PlayerIgnHistory } from '@prisma/client';

/**
 * Player Identity Service
 * Manages player identity across the system with stable UUIDs
 */

export interface PlayerWithHistory extends Player {
  ignHistory: PlayerIgnHistory[];
  currentOrg?: string | null;
  totalEarnings?: number;
}

/**
 * Find or create a player by IGN
 * If player exists with same IGN or wikiUrl, return existing
 * Otherwise create new player
 */
export async function findOrCreatePlayer(
  ign: string,
  options?: {
    wikiUrl?: string;
    realName?: string;
    nationality?: string;
    country?: string;
    birthDate?: Date;
    imageUrl?: string;
  }
): Promise<Player> {
  const { wikiUrl, realName, nationality, country, birthDate, imageUrl } = options || {};

  // First try to find by wikiUrl (most reliable identifier)
  if (wikiUrl) {
    const existingByWiki = await prisma.player.findFirst({
      where: { wikiUrl },
    });
    if (existingByWiki) {
      // Update IGN if it changed
      if (existingByWiki.currentIgn !== ign) {
        await updatePlayerIgn(existingByWiki.playerId, ign);
      }
      // Update missing fields
      const updateData: any = { lastUpdated: new Date() };
      if (imageUrl && !existingByWiki.imageUrl) updateData.imageUrl = imageUrl;
      if (country && !existingByWiki.country) updateData.country = country;
      if (birthDate && !existingByWiki.birthDate) updateData.birthDate = birthDate;
      if (nationality && !existingByWiki.nationality) updateData.nationality = nationality;
      if (realName && !existingByWiki.realName) updateData.realName = cleanRealName(realName);

      if (Object.keys(updateData).length > 1) {
        return await prisma.player.update({
          where: { playerId: existingByWiki.playerId },
          data: updateData,
        });
      }
      return existingByWiki;
    }
  }

  // Try to find by exact IGN match
  const existingByIgn = await prisma.player.findFirst({
    where: { currentIgn: ign },
  });
  if (existingByIgn) {
    // Update missing fields
    const updateData: any = { lastUpdated: new Date() };
    if (wikiUrl && !existingByIgn.wikiUrl) updateData.wikiUrl = wikiUrl;
    if (imageUrl && !existingByIgn.imageUrl) updateData.imageUrl = imageUrl;
    if (country && !existingByIgn.country) updateData.country = country;
    if (birthDate && !existingByIgn.birthDate) updateData.birthDate = birthDate;
    if (nationality && !existingByIgn.nationality) updateData.nationality = nationality;
    if (realName && !existingByIgn.realName) updateData.realName = cleanRealName(realName);

    if (Object.keys(updateData).length > 1) {
      return await prisma.player.update({
        where: { playerId: existingByIgn.playerId },
        data: updateData,
      });
    }
    return existingByIgn;
  }

  // Try case-insensitive IGN search
  const existingByIgnCaseInsensitive = await prisma.player.findFirst({
    where: {
      currentIgn: { equals: ign, mode: 'insensitive' },
    },
  });
  if (existingByIgnCaseInsensitive) {
    return existingByIgnCaseInsensitive;
  }

  // Check IGN history for name changes
  const historyMatch = await prisma.playerIgnHistory.findFirst({
    where: { ign: { equals: ign, mode: 'insensitive' } },
    include: { player: true },
  });
  if (historyMatch) {
    return historyMatch.player;
  }

  // Create new player
  const newPlayer = await prisma.player.create({
    data: {
      currentIgn: ign,
      realName: cleanRealName(realName),
      nationality,
      country,
      birthDate,
      wikiUrl,
      imageUrl,
      ignHistory: {
        create: {
          ign,
          usedFrom: new Date(),
        },
      },
    },
  });

  return newPlayer;
}

/**
 * Update a player's IGN (tracks history)
 */
export async function updatePlayerIgn(playerId: string, newIgn: string): Promise<Player> {
  const player = await prisma.player.findUnique({
    where: { playerId },
    include: { ignHistory: { orderBy: { usedFrom: 'desc' } } },
  });

  if (!player) {
    throw new Error(`Player not found: ${playerId}`);
  }

  // If IGN is the same, no update needed
  if (player.currentIgn === newIgn) {
    return player;
  }

  // Close out the current IGN history entry
  const currentHistory = player.ignHistory[0];
  if (currentHistory && !currentHistory.usedUntil) {
    await prisma.playerIgnHistory.update({
      where: { id: currentHistory.id },
      data: { usedUntil: new Date() },
    });
  }

  // Create new IGN history entry and update current
  return await prisma.player.update({
    where: { playerId },
    data: {
      currentIgn: newIgn,
      lastUpdated: new Date(),
      ignHistory: {
        create: {
          ign: newIgn,
          usedFrom: new Date(),
        },
      },
    },
  });
}

/**
 * Link a player to their Epic Games account
 */
export async function linkEpicAccount(playerId: string, epicAccountId: string): Promise<Player> {
  // Check if another player already has this Epic account
  const existing = await prisma.player.findUnique({
    where: { epicAccountId },
  });

  if (existing && existing.playerId !== playerId) {
    // Merge players - keep the one with more data
    // For now, just update the epic account link
    console.warn(`Epic account ${epicAccountId} already linked to player ${existing.playerId}`);
    return existing;
  }

  return await prisma.player.update({
    where: { playerId },
    data: {
      epicAccountId,
      lastUpdated: new Date(),
    },
  });
}

/**
 * Get player with full history
 */
export async function getPlayer(playerId: string): Promise<PlayerWithHistory | null> {
  const player = await prisma.player.findUnique({
    where: { playerId },
    include: {
      ignHistory: { orderBy: { usedFrom: 'desc' } },
      rosterHistory: {
        where: { isActive: true },
        orderBy: { joinDate: 'desc' },
        include: { organization: true },
      },
      earningsSummary: true,
    },
  });

  if (!player) return null;

  return {
    ...player,
    currentOrg: player.rosterHistory[0]?.orgSlug || null,
    totalEarnings: player.earningsSummary?.totalEarnings
      ? Number(player.earningsSummary.totalEarnings)
      : 0,
  };
}

/**
 * Get player by IGN
 */
export async function getPlayerByIgn(ign: string): Promise<Player | null> {
  // Try exact match first
  const exact = await prisma.player.findFirst({
    where: { currentIgn: ign },
  });
  if (exact) return exact;

  // Try case-insensitive
  const caseInsensitive = await prisma.player.findFirst({
    where: { currentIgn: { equals: ign, mode: 'insensitive' } },
  });
  if (caseInsensitive) return caseInsensitive;

  // Check history
  const history = await prisma.playerIgnHistory.findFirst({
    where: { ign: { equals: ign, mode: 'insensitive' } },
    include: { player: true },
  });
  return history?.player || null;
}

/**
 * Get player by Epic Account ID
 */
export async function getPlayerByEpicId(epicAccountId: string): Promise<Player | null> {
  return await prisma.player.findUnique({
    where: { epicAccountId },
  });
}

/**
 * Search players by IGN (fuzzy match)
 */
export async function searchPlayers(
  query: string,
  options?: { limit?: number; offset?: number }
): Promise<Player[]> {
  const { limit = 20, offset = 0 } = options || {};

  return await prisma.player.findMany({
    where: {
      OR: [
        { currentIgn: { contains: query, mode: 'insensitive' } },
        { realName: { contains: query, mode: 'insensitive' } },
      ],
    },
    take: limit,
    skip: offset,
    orderBy: { currentIgn: 'asc' },
  });
}

/**
 * Clean up real name (fix duplicated names like "(Thomas Mulligan)Thomas Mulligan")
 */
function cleanRealName(name?: string | null): string | null {
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
 * Get all players for an organization
 */
export async function getPlayersForOrg(
  orgSlug: string,
  options?: { status?: 'current' | 'former' | 'all' }
): Promise<Player[]> {
  const { status = 'current' } = options || {};

  const whereClause: any = { orgSlug };
  if (status !== 'all') {
    whereClause.status = status;
  }

  const rosters = await prisma.teamRoster.findMany({
    where: whereClause,
    include: { player: true },
    orderBy: { joinDate: 'desc' },
  });

  return rosters
    .filter((r) => r.player)
    .map((r) => r.player!);
}

export const playerService = {
  findOrCreatePlayer,
  updatePlayerIgn,
  linkEpicAccount,
  getPlayer,
  getPlayerByIgn,
  getPlayerByEpicId,
  searchPlayers,
  getPlayersForOrg,
};
