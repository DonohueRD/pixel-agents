import { describe, expect, it } from 'vitest';

import { chooseMood, makeSong, MOOD_KEYS, parseSongCode, songCode } from '../src/music/composer.js';

describe('music composer', () => {
  it('writes the same tune from the same seed, mood and previous root', () => {
    const a = makeSong(1234, 'town', 55);
    const b = makeSong(1234, 'town', 55);
    expect(b.name).toBe(a.name);
    expect(JSON.stringify(b.steps)).toBe(JSON.stringify(a.steps));
  });

  it('writes playable tunes of a few minutes in every mood', () => {
    for (const mood of MOOD_KEYS) {
      for (let seed = 1; seed <= 40; seed++) {
        const song = makeSong(seed * 7919, mood, seed % 2 ? null : 54);
        const minutes = (song.steps.length * song.stepDur) / 60;
        expect(minutes).toBeGreaterThan(2);
        expect(minutes).toBeLessThan(5);
        expect(song.root).toBeGreaterThanOrEqual(50);
        expect(song.root).toBeLessThanOrEqual(58);
        let melodyNotes = 0;
        song.steps.forEach((step, i) => {
          for (const ch of ['pu1', 'pu2', 'wav'] as const) {
            const ev = step[ch];
            if (!ev) continue;
            expect(Number.isFinite(ev.m)).toBe(true);
            expect(ev.len).toBeGreaterThan(0);
            // Monophonic: a note never runs into the next note on its channel.
            for (let j = i + 1; j < i + ev.len; j++) expect(song.steps[j]?.[ch]).toBeUndefined();
          }
          if (step.pu1) melodyNotes++;
        });
        expect(melodyNotes).toBeGreaterThan(40);
      }
    }
  });

  it('keeps a picked mood, and Auto picks one of the moods', () => {
    expect(chooseMood('lab', 'town', 12)).toBe('lab');
    expect(MOOD_KEYS).toContain(chooseMood('auto', 'night', 23));
  });

  it('never picks Arcade on Auto, and leans toward Dawn in the morning', () => {
    const count = (hour: number) => {
      const n: Record<string, number> = {};
      for (let i = 0; i < 4000; i++) {
        const m = chooseMood('auto', 'town', hour);
        n[m] = (n[m] ?? 0) + 1;
      }
      return n;
    };
    const morning = count(8);
    const afternoon = count(15);
    expect(morning.arcade ?? 0).toBe(0);
    expect(afternoon.arcade ?? 0).toBe(0);
    expect(morning.dawn).toBeGreaterThan((afternoon.dawn ?? 0) * 4);
  });

  it('plays back the exact tune from its song code', () => {
    const song = makeSong(0xbeef42, 'night', 57); // a root reached through prevRoot
    const parsed = parseSongCode(songCode(song));
    expect(parsed).not.toBeNull();
    const again = makeSong(parsed!.seed, parsed!.moodKey, null, parsed!.root);
    expect(again.name).toBe(song.name);
    expect(again.root).toBe(song.root);
    expect(JSON.stringify(again.steps)).toBe(JSON.stringify(song.steps));
  });

  it('refuses what is not a song code', () => {
    for (const bad of ['', 'hello', 'DISCO-5-8F3A21C0', 'TOWN-9-8F3A21C0', 'TOWN-5-XYZ'])
      expect(parseSongCode(bad)).toBeNull();
    expect(parseSongCode(' town-0-ff ')).toEqual({ moodKey: 'town', root: 50, seed: 255 });
    // Typed from the screen, where 0 looks like o.
    expect(parseSongCode('NIGHT-o-CF53FFBo')).toEqual(parseSongCode('NIGHT-0-CF53FFB0'));
  });
});
