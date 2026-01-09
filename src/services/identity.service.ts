/**
 * Identity Service
 *
 * Handles player identity resolution across different data sources.
 * The core problem: Liquipedia data uses wikiUrl/IGN, Epic Games API uses accountId.
 * This service bridges these two identity systems.
 */

import { prisma } from '../db/client.js';
import type { Player } from '@prisma/client';

/**
 * Check if a string looks like an Epic account ID (32-char hex)
 */
export function isEpicAccountId(str: string): boolean {
  return /^[a-f0-9]{32}$/i.test(str);
}

/**
 * Check if a string is a UUID
 */
export function isUUID(str: string): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(str);
}

/**
 * Discover Epic accountId for a player by matching tournament appearances.
 * Uses the player's current IGN and IGN history to find matching tournament results.
 */
export async function discoverAccountIdForPlayer(playerId: string): Promise<string | null> {
  // Get player with IGN history
  const player = await prisma.player.findUnique({
    where: { playerId },
    include: { ignHistory: true },
  });

  if (!player) return null;
  if (player.epicAccountId) return player.epicAccountId; // Already has one

  // Collect all IGNs this player has used
  const allIgns = [
    player.currentIgn,
    ...player.ignHistory.map((h) => h.ign),
  ].filter(Boolean);

  if (allIgns.length === 0) return null;

  // Find tournament results matching any of their IGNs
  const results = await prisma.tournamentResult.findMany({
    where: {
      displayName: { in: allIgns, mode: 'insensitive' },
    },
    select: { accountId: true, displayName: true },
  });

  if (results.length === 0) return null;

  // Group by accountId and count occurrences
  const accountIdCounts = new Map<string, { count: number; names: Set<string> }>();
  for (const result of results) {
    // Skip placeholder accountIds (wiki-derived or player_rank format)
    if (result.accountId.startsWith('wiki-') || result.accountId.startsWith('player_')) {
      continue;
    }
    // Skip non-Epic accountIds (Epic IDs are 32-char hex)
    if (!isEpicAccountId(result.accountId)) {
      continue;
    }

    const existing = accountIdCounts.get(result.accountId);
    if (existing) {
      existing.count++;
      existing.names.add(result.displayName);
    } else {
      accountIdCounts.set(result.accountId, {
        count: 1,
        names: new Set([result.displayName]),
      });
    }
  }

  if (accountIdCounts.size === 0) return null;

  // Find the best match (most tournament appearances with this accountId)
  let bestAccountId: string | null = null;
  let bestCount = 0;

  for (const [accountId, data] of accountIdCounts) {
    if (data.count > bestCount) {
      bestCount = data.count;
      bestAccountId = accountId;
    }
  }

  // Require at least 2 tournament appearances for confidence
  if (bestCount < 2) {
    console.log(
      `[Identity] Low confidence for ${player.currentIgn}: only ${bestCount} appearance(s)`
    );
    // Still return it if we have only one result, but log it
  }

  return bestAccountId;
}

/**
 * Link an Epic accountId to a player record.
 * Also updates all TeamRoster and PlayerTransfer entries.
 */
export async function linkAccountIdToPlayer(
  playerId: string,
  accountId: string
): Promise<boolean> {
  // Check if this accountId is already linked to another player
  const existingPlayer = await prisma.player.findUnique({
    where: { epicAccountId: accountId },
  });

  if (existingPlayer && existingPlayer.playerId !== playerId) {
    console.warn(
      `[Identity] AccountId ${accountId} already linked to ${existingPlayer.currentIgn} (${existingPlayer.playerId})`
    );
    return false;
  }

  // Update player
  await prisma.player.update({
    where: { playerId },
    data: { epicAccountId: accountId },
  });

  // Update all roster entries for this player
  await prisma.teamRoster.updateMany({
    where: { playerId },
    data: { accountId },
  });

  // Update all transfer entries for this player
  await prisma.playerTransfer.updateMany({
    where: { playerId },
    data: { accountId },
  });

  return true;
}

/**
 * Find a player by Epic accountId
 */
export async function findPlayerByAccountId(accountId: string): Promise<Player | null> {
  // Direct lookup
  const player = await prisma.player.findUnique({
    where: { epicAccountId: accountId },
  });

  if (player) return player;

  // Check TournamentResult.data for linkedPlayerId
  const result = await prisma.tournamentResult.findFirst({
    where: { accountId },
    select: { data: true },
  });

  if (result?.data && typeof result.data === 'object') {
    const data = result.data as { linkedPlayerId?: string };
    if (data.linkedPlayerId) {
      return await prisma.player.findUnique({
        where: { playerId: data.linkedPlayerId },
      });
    }
  }

  return null;
}

/**
 * Find a player by IGN (case-insensitive, checks history)
 */
export async function findPlayerByIgn(ign: string): Promise<Player | null> {
  // Try exact match first
  let player = await prisma.player.findFirst({
    where: { currentIgn: { equals: ign, mode: 'insensitive' } },
  });

  if (player) return player;

  // Check IGN history
  const history = await prisma.playerIgnHistory.findFirst({
    where: { ign: { equals: ign, mode: 'insensitive' } },
    include: { player: true },
  });

  return history?.player || null;
}

/**
 * Resolve player identity from any identifier.
 * Tries multiple lookup strategies in order of reliability.
 */
export async function resolvePlayerIdentity(identifier: string): Promise<Player | null> {
  // 1. Try Epic accountId (32-char hex) - most reliable
  if (isEpicAccountId(identifier)) {
    const player = await findPlayerByAccountId(identifier);
    if (player) return player;
  }

  // 2. Try playerId (UUID)
  if (isUUID(identifier)) {
    const player = await prisma.player.findUnique({
      where: { playerId: identifier },
    });
    if (player) return player;
  }

  // 3. Try wikiUrl (if it looks like a URL)
  if (identifier.includes('liquipedia.net') || identifier.startsWith('/fortnite/')) {
    const url = identifier.startsWith('http')
      ? identifier
      : `https://liquipedia.net${identifier}`;
    const player = await prisma.player.findFirst({
      where: { wikiUrl: url },
    });
    if (player) return player;
  }

  // 4. Try IGN (current and history)
  return await findPlayerByIgn(identifier);
}

/**
 * Update a player's IGN and track the change in history
 */
export async function updatePlayerIgn(
  playerId: string,
  newIgn: string
): Promise<void> {
  const player = await prisma.player.findUnique({
    where: { playerId },
  });

  if (!player) return;
  if (player.currentIgn.toLowerCase() === newIgn.toLowerCase()) return;

  // Close the current IGN history entry
  await prisma.playerIgnHistory.updateMany({
    where: {
      playerId,
      usedUntil: null,
    },
    data: {
      usedUntil: new Date(),
    },
  });

  // Create new IGN history entry
  await prisma.playerIgnHistory.create({
    data: {
      id: `${playerId}-${Date.now()}`,
      playerId,
      ign: newIgn,
      usedFrom: new Date(),
    },
  });

  // Update current IGN
  await prisma.player.update({
    where: { playerId },
    data: {
      currentIgn: newIgn,
      lastUpdated: new Date(),
    },
  });

  console.log(`[Identity] Updated IGN: ${player.currentIgn} -> ${newIgn}`);
}

/**
 * Batch discover accountIds for multiple players
 */
export async function batchDiscoverAccountIds(
  playerIds: string[]
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  for (const playerId of playerIds) {
    const accountId = await discoverAccountIdForPlayer(playerId);
    if (accountId) {
      results.set(playerId, accountId);
    }
  }

  return results;
}

export const identityService = {
  isEpicAccountId,
  isUUID,
  discoverAccountIdForPlayer,
  linkAccountIdToPlayer,
  findPlayerByAccountId,
  findPlayerByIgn,
  resolvePlayerIdentity,
  updatePlayerIgn,
  batchDiscoverAccountIds,
};
