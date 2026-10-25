import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { Directory, DirectoryConversations } from '../../core/src/messages.js';
import type { HookProvider } from '../../core/src/provider.js';
import type { AgentStateStore } from './agentStateStore.js';
import {
  CONVERSATION_LOOKS_MAX,
  CONVERSATIONS_FILE_NAME,
  CONVERSATIONS_PER_DIRECTORY,
  NEW_CONVERSATION_TITLE,
  PIXEL_AGENTS_DIR,
} from './constants.js';
import { writeJsonAtomic } from './jsonFileWatcher.js';

/**
 * The sidebar's recent conversations: each Directory's newest transcripts,
 * titled the way the coding agent titles them, with the character their agent
 * wore so a resume brings that character back to its seat.
 *
 * The transcripts are the coding agent's (found through the provider); what
 * this module adds is the look, which only the office knows. It is recorded
 * per session in ~/.pixel-agents/conversations.json whenever the office saves
 * its seats — an agent's seat is only known to the office — so it outlives the
 * agent, and the newest CONVERSATION_LOOKS_MAX are kept.
 */

export interface ConversationLook {
  palette: number;
  repeat: number;
  seatId?: string;
  /** When it was last recorded (ms), for pruning. */
  at: number;
}

type Looks = Record<string, ConversationLook>;

function looksPath(): string {
  return path.join(os.homedir(), PIXEL_AGENTS_DIR, CONVERSATIONS_FILE_NAME);
}

function readLooks(): Looks {
  try {
    const raw = JSON.parse(fs.readFileSync(looksPath(), 'utf-8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const looks: Looks = {};
    for (const [sessionId, look] of Object.entries(raw as Record<string, unknown>)) {
      const l = look as Partial<ConversationLook> | null;
      if (!l || !Number.isInteger(l.palette) || !Number.isInteger(l.repeat)) continue;
      looks[sessionId] = {
        palette: l.palette!,
        repeat: l.repeat!,
        seatId: typeof l.seatId === 'string' ? l.seatId : undefined,
        at: typeof l.at === 'number' ? l.at : 0,
      };
    }
    return looks;
  } catch {
    return {};
  }
}

/**
 * Renumber the remembered looks after the character list changed (see characterRemap.ts):
 * a look whose character was deleted is forgotten.
 */
export function remapConversationLooks(remap: (palette: number) => number | undefined): void {
  const looks = readLooks();
  let changed = false;
  for (const [sessionId, look] of Object.entries(looks)) {
    const next = remap(look.palette);
    if (next === look.palette) continue;
    changed = true;
    if (next === undefined) delete looks[sessionId];
    else look.palette = next;
  }
  if (!changed) return;
  try {
    writeJsonAtomic(looksPath(), looks);
  } catch (err) {
    console.error('[Pixel Agents] Failed to save conversation looks:', err);
  }
}

/** The look a session's agent last had, if the office ever saw it. */
export function conversationLook(sessionId: string): ConversationLook | undefined {
  return readLooks()[sessionId];
}

/**
 * Remember what the agents in `seats` (a saveAgentSeats payload, keyed by
 * agent id) wear and where they sit, under their session ids. Writes only
 * when something changed: the office saves its seats often.
 */
export function recordConversationLooks(
  store: AgentStateStore,
  seats: Record<string, { seatId?: string }>,
): void {
  const looks = readLooks();
  let changed = false;
  const now = Date.now();
  for (const [idStr, meta] of Object.entries(seats)) {
    const agent = store.get(Number(idStr));
    if (!agent?.sessionId || agent.palette === undefined) continue;
    const before = looks[agent.sessionId];
    const look: ConversationLook = {
      palette: agent.palette,
      repeat: agent.repeat ?? 0,
      seatId: typeof meta.seatId === 'string' ? meta.seatId : before?.seatId,
      at: now,
    };
    if (
      before &&
      before.palette === look.palette &&
      before.repeat === look.repeat &&
      before.seatId === look.seatId
    ) {
      continue;
    }
    looks[agent.sessionId] = look;
    changed = true;
  }
  if (!changed) return;
  const kept = Object.entries(looks)
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, CONVERSATION_LOOKS_MAX);
  try {
    writeJsonAtomic(looksPath(), Object.fromEntries(kept));
  } catch (err) {
    console.error('[Pixel Agents] Failed to save conversation looks:', err);
  }
}

/** Where a Directory's sessions are filed (the provider knows the CLI's rule,
 *  e.g. a Directory reached through a symlink filed under the resolved path). */
function sessionDirsFor(provider: HookProvider, directoryPath: string): string[] {
  return provider.getSessionDirs?.(directoryPath) ?? [];
}

/** A session's transcript in the Directory at `directoryPath`, if it exists. */
export function findTranscript(
  provider: HookProvider,
  directoryPath: string,
  sessionId: string,
): string | undefined {
  return sessionDirsFor(provider, directoryPath)
    .map((dir) => path.join(dir, `${sessionId}.jsonl`))
    .find((file) => fs.existsSync(file));
}

/** An agent in the office, as the list needs it: which one runs a session
 *  and what it wears. */
export interface LiveSession {
  agentId: number;
  palette?: number;
  repeat?: number;
}

/**
 * Each Directory's conversations, newest first: every one an agent in the
 * office is running (with its id and what it wears now; titled "New
 * conversation" until the coding agent titles it), then its newest past ones,
 * at most CONVERSATIONS_PER_DIRECTORY, leaving out any without a title (a
 * session that never got a prompt).
 */
export function listConversations(
  directories: readonly Directory[],
  provider: HookProvider,
  live: ReadonlyMap<string, LiveSession>,
): DirectoryConversations[] {
  const looks = readLooks();
  return directories.map((directory) => {
    const conversations: DirectoryConversations['conversations'] = [];
    let past = 0;
    const files = sessionDirsFor(provider, directory.path)
      .flatMap(transcriptsIn)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const file of files) {
      const sessionId = path.basename(file.path, '.jsonl');
      const running = live.get(sessionId);
      if (!running && past >= CONVERSATIONS_PER_DIRECTORY) continue;
      const title = provider.conversationTitle?.(file.path) ?? (running && NEW_CONVERSATION_TITLE);
      if (!title) continue;
      const look = running ?? looks[sessionId];
      conversations.push({
        sessionId,
        title,
        updatedAt: file.mtimeMs,
        palette: look?.palette,
        repeat: look?.repeat,
        agentId: running?.agentId,
      });
      if (!running) past++;
    }
    return { name: directory.name, path: directory.path, conversations };
  });
}

/** A project dir's transcripts. */
function transcriptsIn(projectDir: string): { path: string; mtimeMs: number }[] {
  let names: string[];
  try {
    names = fs.readdirSync(projectDir);
  } catch {
    return [];
  }
  const files: { path: string; mtimeMs: number }[] = [];
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const file = path.join(projectDir, name);
    try {
      const stat = fs.statSync(file);
      if (stat.isFile()) files.push({ path: file, mtimeMs: stat.mtimeMs });
    } catch {
      // Gone between the listing and the stat.
    }
  }
  return files;
}
