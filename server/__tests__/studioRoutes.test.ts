import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { budgetBlock, kickoffPrompt } from '../src/studioRoutes.js';

describe('studioRoutes helpers', () => {
  afterEach(() => {
    delete process.env.STUDIO_LAUNCH_NOT_BEFORE;
  });

  it('allows launches with no lock and no date', () => {
    expect(budgetBlock(Date.now(), path.join(os.tmpdir(), 'no-such-lock'))).toBeNull();
  });

  it('blocks while the lock file exists', () => {
    const lock = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-')), 'lock');
    fs.writeFileSync(lock, '');
    expect(budgetBlock(Date.now(), lock)).toContain('budget lock');
  });

  it('blocks before STUDIO_LAUNCH_NOT_BEFORE and allows after', () => {
    process.env.STUDIO_LAUNCH_NOT_BEFORE = '2026-10-29T09:00:00Z';
    const none = path.join(os.tmpdir(), 'no-such-lock');
    expect(budgetBlock(Date.parse('2026-10-28T00:00:00Z'), none)).toContain('blocked until');
    expect(budgetBlock(Date.parse('2026-10-30T00:00:00Z'), none)).toBeNull();
  });

  it('turns a promptFile into a short kickoff', () => {
    expect(kickoffPrompt(undefined, 'Y:/a.md')).toContain('Read Y:/a.md');
    expect(kickoffPrompt('hi')).toBe('hi');
    expect(kickoffPrompt()).toBeUndefined();
  });
});
