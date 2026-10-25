import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  type CharacterProfile,
  characterRemap,
  parseCharacterProfiles,
} from '../../core/src/characterProfiles.js';
import { DEFAULT_CHARACTER_PROFILES } from '../../core/src/defaultCharacterProfiles.js';
import type { AgentLook, CharacterProfilesLoaded } from '../../core/src/messages.js';
import { parseWardrobeItems, type WardrobeItem } from '../../core/src/wardrobeItems.js';
import type { AgentStateStore } from './agentStateStore.js';
import { type PaletteRemap, remapAgentLooks } from './characterRemap.js';
import {
  CHARACTER_PROFILES_FILE_NAME,
  PIXEL_AGENTS_DIR,
  WARDROBE_ITEMS_FILE_NAME,
} from './constants.js';
import { type JsonFileWatcher, watchJsonFile, writeJsonAtomic } from './jsonFileWatcher.js';

/**
 * ~/.pixel-agents/characters.json: the character profiles agents are drawn from, shared by
 * both surfaces like layout.json. Absent (or unreadable) means the six default profiles.
 * Beside it, wardrobe-items.json: the custom wardrobe items (parts saved from the pixel
 * editor) the profiles may wear. Absent means none. The two travel together: one save
 * message, one loaded message.
 *
 * This module is the one owner of both for both surfaces: it caches them (the palette
 * count reads the cache), persists saves, answers the client messages, and watches the
 * files for changes another process makes. Surfaces supply only their channels.
 */
function getCharacterProfilesPath(): string {
  return path.join(os.homedir(), PIXEL_AGENTS_DIR, CHARACTER_PROFILES_FILE_NAME);
}

function getWardrobeItemsPath(): string {
  return path.join(os.homedir(), PIXEL_AGENTS_DIR, WARDROBE_ITEMS_FILE_NAME);
}

/** The list for one file path. Keyed by path so a different $HOME (tests) re-reads. */
let cache: { filePath: string; profiles: CharacterProfile[] } | null = null;
let itemsCache: { filePath: string; items: WardrobeItem[] } | null = null;

function readFromDisk(filePath: string): CharacterProfile[] {
  try {
    if (fs.existsSync(filePath)) {
      const profiles = parseCharacterProfiles(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
      if (profiles) return profiles;
      console.warn('[Pixel Agents] Ignoring malformed characters.json');
    }
  } catch (err) {
    console.error('[Pixel Agents] Failed to read character profiles:', err);
  }
  return structuredClone([...DEFAULT_CHARACTER_PROFILES]);
}

function readItemsFromDisk(filePath: string): WardrobeItem[] {
  try {
    if (fs.existsSync(filePath)) {
      const items = parseWardrobeItems(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
      if (items) return items;
      console.warn('[Pixel Agents] Ignoring malformed wardrobe-items.json');
    }
  } catch (err) {
    console.error('[Pixel Agents] Failed to read wardrobe items:', err);
  }
  return [];
}

/** The saved profiles, or the defaults. Read from disk once, then served from the cache. */
export function getCharacterProfiles(): CharacterProfile[] {
  const filePath = getCharacterProfilesPath();
  if (cache?.filePath !== filePath) cache = { filePath, profiles: readFromDisk(filePath) };
  return cache.profiles;
}

/** The saved custom wardrobe items (none when absent). Read once, then served from the cache. */
export function getWardrobeItems(): WardrobeItem[] {
  const filePath = getWardrobeItemsPath();
  if (itemsCache?.filePath !== filePath) {
    itemsCache = { filePath, items: readItemsFromDisk(filePath) };
  }
  return itemsCache.items;
}

/**
 * Validate and persist a client's profiles, and its items when it sent some (atomic tmp +
 * rename each; the items first, so the profiles never land wearing items that didn't).
 * Returns what is saved now (the very objects written, so a current-format list comes back
 * unchanged) and how the characters moved, or null when either payload is invalid or a
 * write failed (the caches are untouched by a refused payload).
 */
function saveCharacterProfiles(
  value: unknown,
  itemsValue: unknown,
): { profiles: CharacterProfile[]; items: WardrobeItem[]; remap: PaletteRemap | null } | null {
  const profiles = parseCharacterProfiles(value);
  if (!profiles) return null;
  const remap = characterRemap(getCharacterProfiles(), profiles);
  const items = itemsValue === undefined ? getWardrobeItems() : parseWardrobeItems(itemsValue);
  if (!items) return null;
  try {
    if (itemsValue !== undefined) {
      const itemsPath = getWardrobeItemsPath();
      writeJsonAtomic(itemsPath, items);
      itemsCache = { filePath: itemsPath, items };
    }
    const filePath = getCharacterProfilesPath();
    writeJsonAtomic(filePath, profiles);
    cache = { filePath, profiles };
  } catch (err) {
    console.error('[Pixel Agents] Failed to write character profiles:', err);
    return null;
  }
  return { profiles, items, remap };
}

/**
 * The list as the protocol message, built only here so every path sends the same shape: the
 * list on disk, without a saveId for the initial load or an external change, with one to
 * answer a save that was refused (here, or by a host's read-only gate); or a saved list,
 * answering its save. The items always go with it.
 */
export function characterProfilesLoadedMessage(
  saveId?: string,
  profiles: CharacterProfile[] = getCharacterProfiles(),
  items: WardrobeItem[] = getWardrobeItems(),
  agentLooks: AgentLook[] = [],
) {
  return {
    type: 'characterProfilesLoaded',
    profiles,
    items,
    ...(agentLooks.length > 0 && { agentLooks }),
    ...(saveId !== undefined && { saveId }),
  } satisfies CharacterProfilesLoaded;
}

type ProfilesMessage = ReturnType<typeof characterProfilesLoadedMessage>;

/** What a host must supply to dispatch the character-profile client messages. */
export interface CharacterProfilesMessageDeps {
  /** Fan a saved list out to every connected office. */
  broadcast: (message: ProfilesMessage) => void;
  /** Point-to-point reply to the client whose save was refused. */
  reply: (message: ProfilesMessage) => void;
  /** This process's agents, renumbered when a save moves characters. */
  store: AgentStateStore;
}

/**
 * Handle `saveCharacterProfiles`, shared by both hosts.
 *
 * Every save is answered with `characterProfilesLoaded` carrying its saveId: a save that
 * persisted is broadcast to everyone (the sender learns it landed, the others get the new
 * cast); a refused one is answered to the sender alone with the list still on disk, so the
 * client learns the truth instead of believing an edit that was dropped.
 *
 * A save that inserts, deletes or moves characters renumbers what named them by index
 * (characterRemap.ts): the agents' new looks ride the broadcast, so the office swaps list
 * and looks in one go.
 */
export function handleCharacterProfilesClientMessage(
  msg: { profiles?: unknown; items?: unknown; saveId?: unknown },
  deps: CharacterProfilesMessageDeps,
): void {
  // Unvalidated off the wire: the profiles and items are parsed here, and the saveId
  // (required by the protocol) is tolerated when missing so an older client still saves.
  const saveId = typeof msg.saveId === 'string' ? msg.saveId : undefined;
  const saved = saveCharacterProfiles(msg.profiles, msg.items);
  if (!saved) {
    deps.reply(characterProfilesLoadedMessage(saveId));
    return;
  }
  const looks = saved.remap ? remapAgentLooks(deps.store, saved.remap) : [];
  deps.broadcast(characterProfilesLoadedMessage(saveId, saved.profiles, saved.items, looks));
}

/**
 * Follow characters.json and wardrobe-items.json for changes another process makes
 * (another window, the other surface, a hand edit): re-read, update the cache, and hand
 * the new list to `broadcast`. A file that no longer validates is ignored (the cached
 * one stays). When characters moved, this process's agents are renumbered. Dispose on
 * shutdown.
 */
export function watchCharacterProfiles(
  broadcast: (message: ProfilesMessage) => void,
  store: AgentStateStore,
): JsonFileWatcher {
  const filePath = getCharacterProfilesPath();
  const profilesWatcher = watchJsonFile(filePath, 'character profiles', (value) => {
    const profiles = parseCharacterProfiles(value);
    if (!profiles) {
      console.warn('[Pixel Agents] Ignoring malformed characters.json change');
      return;
    }
    const remap = characterRemap(getCharacterProfiles(), profiles);
    cache = { filePath, profiles };
    const looks = remap ? remapAgentLooks(store, remap) : [];
    broadcast(characterProfilesLoadedMessage(undefined, profiles, undefined, looks));
  });
  const itemsPath = getWardrobeItemsPath();
  const itemsWatcher = watchJsonFile(itemsPath, 'wardrobe items', (value) => {
    const items = parseWardrobeItems(value);
    if (!items) {
      console.warn('[Pixel Agents] Ignoring malformed wardrobe-items.json change');
      return;
    }
    itemsCache = { filePath: itemsPath, items };
    broadcast(characterProfilesLoadedMessage(undefined, undefined, items));
  });
  return {
    dispose() {
      profilesWatcher.dispose();
      itemsWatcher.dispose();
    },
  };
}
