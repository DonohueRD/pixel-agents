import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { restoredAgentInit } from '../src/agentPersistence.js';
import type { BackgroundSpawns } from '../src/backgroundSpawns.js';
import { stillRunningSpawns } from '../src/backgroundSpawns.js';

const launch = (toolId: string, taskId: string) =>
  JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          tool_use_id: toolId,
          type: 'tool_result',
          content: [
            { type: 'text', text: `Async agent launched successfully. agentId: ${taskId}` },
          ],
        },
      ],
    },
  });

const notice = (inner: string) =>
  JSON.stringify({
    type: 'queue-operation',
    operation: 'enqueue',
    content: `<task-notification>\n${inner}\n<status>completed</status>\n</task-notification>`,
  });

describe('stillRunningSpawns: a restored lead drops spawns that finished before the last save', () => {
  let dir: string;
  let file: string;
  const write = (...lines: string[]) => fs.writeFileSync(file, lines.join('\n') + '\n');

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-spawns-'));
    file = path.join(dir, 'lead.jsonl');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('drops a spawn whose completion is in the transcript, keeps one still running', () => {
    write(
      launch('toolu_a', 'task-a'),
      launch('toolu_b', 'task-b'),
      notice('<task-id>task-a</task-id>\n<tool-use-id>toolu_a</tool-use-id>'),
    );
    const spawns: BackgroundSpawns = new Map([
      ['toolu_a', { taskId: 'task-a' }],
      ['toolu_b', { taskId: 'task-b' }],
    ]);
    expect([...stillRunningSpawns(spawns, file).keys()]).toEqual(['toolu_b']);
  });

  it('a crash notice naming only the task id ends it', () => {
    write(launch('toolu_a', 'task-a'), notice('<task-id>task-a</task-id>'));
    expect(stillRunningSpawns(new Map([['toolu_a', { taskId: 'task-a' }]]), file).size).toBe(0);
  });

  it('a notice from before the launch is not its end (a revived agent reuses its task id)', () => {
    write(
      launch('toolu_first', 'task-a'),
      notice('<task-id>task-a</task-id>\n<tool-use-id>toolu_first</tool-use-id>'),
      launch('toolu_revive', 'task-a'),
    );
    const spawns: BackgroundSpawns = new Map([['toolu_revive', { taskId: 'task-a' }]]);
    expect([...stillRunningSpawns(spawns, file).keys()]).toEqual(['toolu_revive']);
  });

  it('keeps every spawn when the transcript cannot be read', () => {
    const spawns: BackgroundSpawns = new Map([['toolu_a', { taskId: 'task-a' }]]);
    expect(stillRunningSpawns(spawns, path.join(dir, 'missing.jsonl'))).toBe(spawns);
  });

  it('restoredAgentInit applies it', () => {
    write(launch('toolu_a', 'task-a'), notice('<tool-use-id>toolu_a</tool-use-id>'));
    const init = restoredAgentInit({
      id: 6,
      sessionId: 'lead',
      terminalName: '',
      jsonlFile: file,
      projectDir: dir,
      backgroundSpawns: [{ toolId: 'toolu_a', taskId: 'task-a' }],
    });
    expect(init.backgroundSpawns?.size).toBe(0);
  });
});
