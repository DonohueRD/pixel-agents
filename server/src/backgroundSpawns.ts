import * as fs from 'fs';

import type { PersistedAgent } from '../../core/src/schemas.js';

/**
 * A lead's live background spawns, keyed by the tool id they run under: the
 * spawn call's, or the SendMessage call's for an agent revived after a crash.
 * The value carries the agent (task) id the CLI gave the spawn, when it said
 * one — completion notices and transcript names may use it instead of the
 * tool id. A spawn is live exactly while it is in the map.
 */
export type BackgroundSpawns = Map<string, { taskId?: string }>;

/** The tool id of the live spawn the CLI knows as `taskId`, if any. */
export function spawnToolIdOfTask(spawns: BackgroundSpawns, taskId: string): string | undefined {
  for (const [toolId, spawn] of spawns) {
    if (spawn.taskId === taskId) return toolId;
  }
  return undefined;
}

/** The persisted form: omitted when there is nothing live. */
export function persistBackgroundSpawns(
  spawns: BackgroundSpawns,
): PersistedAgent['backgroundSpawns'] {
  if (spawns.size === 0) return undefined;
  return [...spawns].map(([toolId, { taskId }]) => (taskId ? { toolId, taskId } : { toolId }));
}

/** Rebuild the map from what was persisted, including the bare tool-id list
 *  releases up to v1.5.x wrote. */
export function restoreBackgroundSpawns(p: PersistedAgent): BackgroundSpawns {
  const spawns: BackgroundSpawns = new Map();
  for (const toolId of p.backgroundAgentToolIds ?? []) spawns.set(toolId, {});
  for (const { toolId, taskId } of p.backgroundSpawns ?? []) spawns.set(toolId, { taskId });
  return spawns;
}

/** The live spawns a completion notice (a queue-operation's content) names,
 *  by spawn tool id or by task (agent) id. Ids it names that aren't live are
 *  ignored. */
export function completedSpawnToolIds(spawns: BackgroundSpawns, content: string): Set<string> {
  const done = new Set<string>();
  for (const m of content.matchAll(/<tool-use-id>(.*?)<\/tool-use-id>/g)) {
    if (spawns.has(m[1])) done.add(m[1]);
  }
  for (const m of content.matchAll(/<task-id>(.*?)<\/task-id>/g)) {
    const toolId = spawnToolIdOfTask(spawns, m[1]);
    if (toolId) done.add(toolId);
  }
  return done;
}

/**
 * The persisted spawns that are still live: those whose completion notice is
 * not in the lead's transcript. A spawn's completion is handled in memory as
 * it lands, but a restart before the next save brings the spawn back, and the
 * restored agent reads its transcript from the end, past the notice, so the
 * spawn would never finish. A notice only counts after the spawn's launch: an
 * agent revived later reuses its task id, and an older notice is not its end.
 * An unreadable transcript keeps every spawn.
 */
export function stillRunningSpawns(spawns: BackgroundSpawns, jsonlFile: string): BackgroundSpawns {
  if (spawns.size === 0) return spawns;
  let text: string;
  try {
    text = fs.readFileSync(jsonlFile, 'utf-8');
  } catch {
    return spawns;
  }
  const live: BackgroundSpawns = new Map();
  const launched = new Set<string>();
  for (const line of text.split('\n')) {
    if (line.includes('"queue-operation"')) {
      let record: { type?: unknown; operation?: unknown; content?: unknown };
      try {
        record = JSON.parse(line) as typeof record;
      } catch {
        continue;
      }
      if (record.operation !== 'enqueue' || typeof record.content !== 'string') continue;
      for (const toolId of completedSpawnToolIds(live, record.content)) live.delete(toolId);
      continue;
    }
    for (const [toolId, spawn] of spawns) {
      if (!launched.has(toolId) && line.includes(`"tool_use_id":"${toolId}"`)) {
        launched.add(toolId);
        live.set(toolId, spawn);
      }
    }
  }
  // A spawn whose launch isn't in this transcript: nothing here can end it.
  for (const [toolId, spawn] of spawns) if (!launched.has(toolId)) live.set(toolId, spawn);
  return live;
}
