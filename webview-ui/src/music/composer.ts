/**
 * The office radio's composer: writes one 8-bit tune as data, step by step,
 * for the four Game Boy channels (pulse lead, pulse harmony, wave bass, noise).
 * Pure and DOM-free: musicEngine.ts plays what this writes.
 *
 * Moods: Town (cheerful), Route (on the move), Lab (curious), Night (calm),
 * Orbit (floating), Rain (barely there, soft rain on the noise channel),
 * Dawn (warm morning) and Arcade (bouncy; never picked by Auto).
 *
 * A tune is an intro, a section plan like A A B A played twice (the second
 * pass varies the answer phrases and rests the melody in one section), and an
 * outro — about three minutes, then the radio picks the next one.
 */

export type MoodKey = 'town' | 'route' | 'lab' | 'night' | 'orbit' | 'rain' | 'dawn' | 'arcade';
export type MoodSetting = MoodKey | 'auto';
type Mode = 'ionian' | 'dorian' | 'mixolydian' | 'aeolian' | 'lydian';
type HarmStyle = 'arp8' | 'arp16' | 'echo' | 'thirds' | 'off' | 'pad';
type BassStyle = 'roots' | 'rootfifth' | 'pulse8' | 'walk' | 'long';
type DrumKit = 'none' | 'hats' | 'brush' | 'groove' | 'rain';
type Weighted<T> = Array<[T, number]>;

/** A pulse note: MIDI pitch, length in steps, GB volume 0-15, envelope
 *  (seconds per level down `es`, floor `ef`), duty index, vibrato. */
export interface PulseEvent {
  m: number;
  len: number;
  v: number;
  es: number;
  ef: number;
  duty: number;
  vib?: boolean;
}
export interface WaveEvent {
  m: number;
  len: number;
  /** Level 0-1. */
  v: number;
  /** Share of the length that sounds. */
  gate?: number;
}
export type NoiseKind = 'h' | 's' | 'k';
export interface NoiseEvent {
  k: NoiseKind;
  v: number;
}
export interface Step {
  pu1?: PulseEvent;
  pu2?: PulseEvent;
  wav?: WaveEvent;
  noi?: NoiseEvent;
}
export interface Song {
  seed: number;
  moodKey: MoodKey;
  /** The previous tune's root this one moved from (replaying the seed needs it). */
  prevRoot: number | null;
  root: number;
  modeName: string;
  bpm: number;
  stepDur: number;
  name: string;
  steps: Step[];
}

export interface Rng {
  (): number;
  int(lo: number, hi: number): number;
  pick<T>(arr: readonly T[]): T;
  chance(p: number): boolean;
  weighted<T>(list: Weighted<T>): T;
}

export function rng(seed: number): Rng {
  let a = seed >>> 0;
  const f = (() => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  f.int = (lo, hi) => lo + Math.floor(f() * (hi - lo + 1));
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  f.chance = (p) => f() < p;
  f.weighted = (list) => {
    let s = 0;
    for (const [, w] of list) s += w;
    let x = f() * s;
    for (const [v, w] of list) {
      x -= w;
      if (x < 0) return v;
    }
    return list[list.length - 1][0];
  };
  return f;
}

export const newSeed = (): number => (Math.random() * 4294967296) >>> 0;

const SCALES: Record<Mode, number[]> = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
};
const MODE_NAME: Record<Mode, string> = {
  ionian: 'major',
  dorian: 'dorian',
  mixolydian: 'mixolydian',
  aeolian: 'minor',
  lydian: 'lydian',
};
/** Chord progressions as scale degrees (0 = tonic). */
const PROGS: Record<Mode, number[][]> = {
  ionian: [
    [0, 5, 3, 4],
    [0, 3, 0, 4],
    [5, 3, 0, 4],
    [0, 2, 3, 4],
    [0, 3, 4, 0],
    [3, 4, 2, 5],
    [0, 4, 5, 3],
    [1, 4, 0, 5],
    [0, 5, 1, 4],
  ],
  mixolydian: [
    [0, 6, 3, 0],
    [0, 3, 6, 0],
    [0, 4, 6, 3],
    [0, 6, 0, 3],
  ],
  lydian: [
    [0, 1, 0, 1],
    [0, 1, 4, 1],
    [0, 1, 5, 4],
    [0, 2, 1, 4],
  ],
  dorian: [
    [0, 3, 0, 3],
    [0, 6, 3, 0],
    [0, 2, 3, 6],
    [0, 4, 6, 3],
    [0, 3, 6, 2],
  ],
  aeolian: [
    [0, 5, 6, 0],
    [0, 3, 4, 0],
    [0, 5, 2, 6],
    [0, 6, 5, 4],
    [0, 3, 5, 6],
  ],
};
const CADENCE: Record<Mode, [number, number]> = {
  ionian: [4, 0],
  mixolydian: [6, 0],
  lydian: [1, 0],
  dorian: [6, 0],
  aeolian: [6, 0],
};
const HALF: Record<Mode, number> = { ionian: 4, mixolydian: 4, lydian: 1, dorian: 3, aeolian: 4 };

interface Mood {
  label: string;
  modes: Weighted<Mode>;
  bpm: [number, number];
  density: number;
  /** Bars per chord. */
  bpc: Weighted<number>;
  drums: number;
  kit: Weighted<DrumKit>;
  harm: Weighted<HarmStyle>;
  bass: Weighted<BassStyle>;
  /** Lead duty indices to pick from. */
  lead: number[];
}

export const MOODS: Record<MoodKey, Mood> = {
  town: {
    label: 'Town',
    modes: [
      ['ionian', 3],
      ['mixolydian', 1],
      ['lydian', 0.5],
    ],
    bpm: [88, 104],
    density: 0.5,
    bpc: [
      [1, 3],
      [2, 1],
    ],
    drums: 0.35,
    kit: [
      ['hats', 2],
      ['brush', 2],
    ],
    harm: [
      ['arp8', 3],
      ['thirds', 2],
      ['echo', 2],
      ['off', 2],
      ['pad', 1],
    ],
    bass: [
      ['roots', 2],
      ['rootfifth', 3],
      ['walk', 1.5],
      ['pulse8', 1],
    ],
    lead: [1, 2, 2],
  },
  route: {
    label: 'Route',
    modes: [
      ['ionian', 3],
      ['mixolydian', 2],
    ],
    bpm: [108, 122],
    density: 0.6,
    bpc: [[1, 1]],
    drums: 0.85,
    kit: [
      ['groove', 3],
      ['hats', 1],
    ],
    harm: [
      ['arp8', 2],
      ['arp16', 1],
      ['echo', 2],
      ['off', 2],
      ['thirds', 1.5],
    ],
    bass: [
      ['pulse8', 3],
      ['rootfifth', 2],
      ['walk', 1],
    ],
    lead: [2, 1, 2],
  },
  lab: {
    label: 'Lab',
    modes: [
      ['lydian', 2],
      ['ionian', 1],
      ['dorian', 1],
    ],
    bpm: [92, 108],
    density: 0.45,
    bpc: [
      [1, 2],
      [2, 1],
    ],
    drums: 0.5,
    kit: [
      ['hats', 2],
      ['brush', 1],
    ],
    harm: [
      ['arp16', 1],
      ['arp8', 3],
      ['echo', 2],
      ['off', 1],
    ],
    bass: [
      ['rootfifth', 2],
      ['pulse8', 1.5],
      ['roots', 1.5],
    ],
    lead: [0, 1],
  },
  night: {
    label: 'Night',
    modes: [
      ['dorian', 2],
      ['aeolian', 2],
      ['lydian', 0.7],
    ],
    bpm: [68, 82],
    density: 0.3,
    bpc: [
      [2, 3],
      [1, 1],
    ],
    drums: 0.15,
    kit: [['brush', 1]],
    harm: [
      ['pad', 3],
      ['arp8', 2],
      ['echo', 2],
    ],
    bass: [
      ['long', 3],
      ['roots', 2],
    ],
    lead: [0, 1, 1],
  },
  orbit: {
    label: 'Orbit',
    modes: [
      ['lydian', 3],
      ['ionian', 1],
      ['mixolydian', 1],
    ],
    bpm: [64, 76],
    density: 0.28,
    bpc: [
      [2, 3],
      [1, 1],
    ],
    drums: 0.1,
    kit: [['hats', 1]],
    harm: [
      ['arp8', 3],
      ['pad', 2],
      ['echo', 2],
    ],
    bass: [
      ['long', 3],
      ['roots', 1],
    ],
    lead: [0, 1],
  },
  rain: {
    label: 'Rain',
    modes: [
      ['aeolian', 2],
      ['dorian', 2],
      ['ionian', 0.5],
    ],
    bpm: [70, 82],
    density: 0.24,
    bpc: [
      [2, 2],
      [1, 1],
    ],
    drums: 1,
    kit: [['rain', 1]],
    harm: [
      ['pad', 3],
      ['echo', 1],
      ['arp8', 1],
    ],
    bass: [
      ['long', 3],
      ['roots', 1],
    ],
    lead: [1, 1, 0],
  },
  dawn: {
    label: 'Dawn',
    modes: [
      ['ionian', 3],
      ['lydian', 1.5],
      ['mixolydian', 0.5],
    ],
    bpm: [78, 92],
    density: 0.38,
    bpc: [
      [1, 2],
      [2, 2],
    ],
    drums: 0.3,
    kit: [
      ['brush', 2],
      ['hats', 1],
    ],
    harm: [
      ['pad', 2],
      ['arp8', 2],
      ['thirds', 2],
      ['echo', 1],
    ],
    bass: [
      ['long', 2],
      ['roots', 2],
      ['rootfifth', 1],
    ],
    lead: [1, 2],
  },
  arcade: {
    label: 'Arcade',
    modes: [
      ['ionian', 3],
      ['mixolydian', 2],
      ['dorian', 1],
    ],
    bpm: [116, 128],
    density: 0.68,
    bpc: [[1, 1]],
    drums: 0.95,
    kit: [
      ['groove', 3],
      ['hats', 1],
    ],
    harm: [
      ['arp16', 3],
      ['arp8', 2],
      ['off', 2],
      ['thirds', 1],
    ],
    bass: [
      ['pulse8', 3],
      ['walk', 2],
      ['rootfifth', 1],
    ],
    lead: [2, 1, 2],
  },
};
export const MOOD_KEYS: readonly MoodKey[] = [
  'town',
  'route',
  'lab',
  'night',
  'orbit',
  'rain',
  'dawn',
  'arcade',
];

/** Auto mode's base pull toward each mood. Arcade is never picked on its own. */
const AUTO_WEIGHT: Record<MoodKey, number> = {
  town: 2,
  route: 2,
  lab: 1.5,
  night: 1,
  orbit: 1.2,
  rain: 1,
  dawn: 1,
  arcade: 0,
};
const CALM: ReadonlySet<MoodKey> = new Set(['night', 'orbit', 'rain']);
const FORMS = [
  ['A', 'A', 'B', 'A'],
  ['A', 'B', 'A', 'B'],
  ['A', 'B', 'A', 'C'],
  ['A', 'B', 'B', 'A'],
  ['A', 'A', 'B', 'B'],
];

/** The next tune's mood: the setting, or on Auto a drift from the last one
 *  (rarely the same again, calm leading to calm) that leans toward Night late
 *  and Dawn in the morning. */
export function chooseMood(setting: MoodSetting, prev: MoodKey | null, hour: number): MoodKey {
  if (setting !== 'auto') return setting;
  const w = { ...AUTO_WEIGHT };
  if (prev) {
    w[prev] *= 0.6;
    if (CALM.has(prev)) {
      for (const k of CALM) w[k] *= 1.5;
      w.route *= 0.4;
    }
  }
  w.night *= hour >= 20 || hour < 7 ? 4 : 0.4;
  w.dawn *= hour >= 6 && hour < 10 ? 4 : 0.25;
  return rng(newSeed()).weighted(Object.entries(w) as Weighted<MoodKey>);
}

const degToMidi = (deg: number, base: number, scale: number[]): number =>
  base + Math.floor(deg / 7) * 12 + scale[((deg % 7) + 7) % 7];
const isChordTone = (deg: number, ch: number): boolean => {
  const k = (((deg - ch) % 7) + 7) % 7;
  return k === 0 || k === 2 || k === 4;
};
function snap(deg: number, ch: number, r: Rng): number {
  if (isChordTone(deg, ch)) return deg;
  for (const k of r.chance(0.5) ? [1, -1, 2, -2] : [-1, 1, -2, 2])
    if (isChordTone(deg + k, ch)) return deg + k;
  return deg;
}
/** Keeps chord roots in a compact low range. */
const low = (c: number): number => (c >= 4 ? c - 7 : c);

interface Hit {
  start: number;
  len: number;
}
interface MelodyNote extends Hit {
  deg: number;
  final?: boolean;
}

const BUSY_CELLS: Weighted<number[]> = [
  [[2, 2], 3],
  [[3, 1], 2],
  [[1, 1, 2], 1],
  [[2, 1, 1], 1],
  [[-2, 1, 1], 1],
  [[-1, 1, 2], 0.6],
];
const CALM_CELLS: Weighted<number[]> = [
  [[4], 3],
  [[-4], 1.6],
  [[2, -2], 1.2],
  [[-2, 2], 1.4],
  [[8], 1.5],
  [[6, 2], 1],
  [[-4, 4], 0.4],
];
function genRhythm(r: Rng, steps: number, density: number): Hit[] {
  const notes: Hit[] = [];
  let pos = 0;
  while (pos < steps) {
    const left = steps - pos;
    let cell: number[];
    do {
      cell = r.weighted(r.chance(density) ? BUSY_CELLS : CALM_CELLS);
    } while (cell.reduce((s, d) => s + Math.abs(d), 0) > left);
    for (const d of cell) {
      if (d > 0) notes.push({ start: pos, len: d });
      pos += Math.abs(d);
    }
  }
  return notes;
}
const CONTOUR_STEPS: Weighted<number> = [
  [1, 4],
  [-1, 4],
  [2, 2.2],
  [-2, 2.2],
  [0, 1.2],
  [3, 0.7],
  [-3, 0.7],
  [4, 0.3],
  [-4, 0.35],
];
function genContour(r: Rng, n: number): number[] {
  const c = [0];
  let d = 0;
  for (let i = 1; i < n; i++) {
    d += r.weighted(CONTOUR_STEPS);
    if (d > 5) d -= 2;
    if (d < -5) d += 2;
    c.push(d);
  }
  return c;
}
function realize(
  r: Rng,
  rhythm: Hit[],
  contour: number[],
  start: number,
  chordAt: (step: number) => number,
  offset: number,
): MelodyNote[] {
  return rhythm.map((n, i) => {
    const st = offset + n.start;
    const ch = chordAt(st);
    let d = start + contour[i % contour.length];
    if (st % 8 === 0 || n.len >= 4) d = snap(d, ch, r);
    else if (!isChordTone(d, ch) && r.chance(0.35)) d = snap(d, ch, r);
    while (d > 9) d -= 7;
    while (d < -3) d += 7;
    return { start: st, len: n.len, deg: d };
  });
}

interface Section {
  chords: number[];
  prog: number[];
  R: Hit[];
  C: number[];
  s0: number;
  density: number;
  isB: boolean;
  harm: HarmStyle;
  bass: BassStyle;
  duty: number;
  drums1: DrumKit;
  drums2: DrumKit;
  seedA: number;
  seedB: number;
}

function makeSection(
  r: Rng,
  o: { mood: Mood; mode: Mode; bpc: number; isB: boolean; avoid: number[] | null },
): Section {
  const list = PROGS[o.mode];
  let prog: number[];
  do {
    prog = r.pick(list);
  } while (prog === o.avoid && list.length > 1);
  let chords: number[] = [];
  for (const c of prog) for (let k = 0; k < o.bpc; k++) chords.push(c);
  while (chords.length < 8) chords = chords.concat(chords);
  chords = chords.slice(0, 8);
  if (o.isB) chords[7] = HALF[o.mode];
  else [chords[6], chords[7]] = CADENCE[o.mode];
  const density = Math.min(
    0.85,
    Math.max(0.15, o.mood.density + (o.isB ? r.pick([-0.1, 0, 0.1]) : 0)),
  );
  let R: Hit[] = [];
  for (let i = 0; i < 24; i++) {
    R = genRhythm(r, 32, density);
    if (R.length >= 3 && R.length <= 11) break;
  }
  const C = genContour(r, R.length + 4);
  const s0 = snap(r.pick([2, 4, 4, 7]), chords[0], r);
  const pickKit = () => r.weighted(o.mood.kit);
  return {
    chords,
    prog,
    R,
    C,
    s0,
    density,
    isB: o.isB,
    harm: r.weighted(o.mood.harm),
    bass: r.weighted(o.mood.bass),
    duty: r.pick(o.mood.lead),
    drums1: r.chance(o.mood.drums * 0.55) ? pickKit() : 'none',
    drums2: r.chance(o.mood.drums) ? pickKit() : 'none',
    seedA: r.int(1, 2 ** 31),
    seedB: r.int(1, 2 ** 31),
  };
}

/** One 8-bar phrase: statement, answer, statement, cadence. */
function buildMelody(sec: Section, variant: number): MelodyNote[] {
  const r = rng(variant ? sec.seedB : sec.seedA);
  const chordAt = (st: number) => sec.chords[Math.min(7, Math.floor(st / 16))];
  const notes: MelodyNote[] = [];
  notes.push(...realize(r, sec.R, sec.C, sec.s0, chordAt, 0));
  let R1 = sec.R;
  let C1 = sec.C.slice();
  if (r.chance(variant ? 0.45 : 0.3)) {
    R1 = genRhythm(r, 32, sec.density);
    C1 = genContour(r, R1.length + 4);
  } else {
    const sh = r.pick([-2, -1, 1, 2]);
    for (let i = Math.floor(R1.length / 2); i < C1.length; i++) C1[i] += sh;
  }
  notes.push(...realize(r, R1, C1, sec.s0 + r.pick([-1, 0, 1]), chordAt, 32));
  notes.push(...realize(r, sec.R, sec.C, sec.s0, chordAt, 64));
  const Rc = sec.R.filter((n) => n.start < 12).map((n) => ({
    start: n.start,
    len: Math.min(n.len, 12 - n.start),
  }));
  notes.push(...realize(r, Rc, sec.C, sec.s0, chordAt, 96));
  const prev = notes.length ? notes[notes.length - 1].deg : sec.s0;
  const last = sec.chords[7];
  let cands = [-3, -1, 0, 2, 4, 5, 7, 9].filter((d) => isChordTone(d, last));
  if (!sec.isB && !r.chance(0.25)) cands = [0, 7];
  const target = cands.reduce(
    (b, d) => (Math.abs(d - prev) < Math.abs(b - prev) ? d : b),
    cands[0],
  );
  const st = r.pick([112, 112, 108]);
  notes.push({ start: st, len: 128 - st - r.pick([0, 2, 4]), deg: target, final: true });
  return notes;
}

// Tune names: a retro sci-fi city whose office has drifted into orbit.
const STARS = [
  'Nova',
  'Vega',
  'Lyra',
  'Kepler',
  'Orion',
  'Tycho',
  'Halley',
  'Juno',
  'Cygnus',
  'Aster',
  'Nimbus',
  'Polaris',
  'Echo',
  'Helix',
  'Zephyr',
];
const TOWN_ADJ = [
  'Neon',
  'Pastel',
  'Chrome',
  'Sunny',
  'Pixel',
  'Velvet',
  'Lucky',
  'Mint',
  'Cosmo',
  'Lumen',
  'Solar',
  'Retro',
  'Candy',
  'Halcyon',
  'Cobalt',
  'Amber',
];
const TOWN_PLACES = [
  'Plaza',
  'Atrium',
  'Lobby',
  'Arcade',
  'Commons',
  'Café',
  'Concourse',
  'Promenade',
  'Terrace',
  'Breakroom',
  'Market',
  'Hub',
  'Courtyard',
  'Lounge',
  'Greenhouse',
];
const ROUTE_WAYS = [
  'Monorail',
  'Skyway',
  'Data Highway',
  'Hyperlane',
  'Elevator',
  'Tram Line',
  'Shuttle Run',
  'Fiber Tunnel',
  'Conveyor',
  'Maglev',
  'Overpass',
  'Service Duct',
  'Air Lock',
  'Starlane',
];
const ROUTE_TO = [
  'Orbit',
  'the Mainframe',
  'the Top Floor',
  'Sector 9',
  'the Stars',
  'the Next Level',
  'Moonbase',
  'the Core',
  'the Archive',
  'Lobby Zero',
  'the Edge',
  'Headquarters',
];
const LAB_PLACES = [
  'Mainframe',
  'Reactor',
  'Holo Lab',
  'Cryo Vault',
  'Server Spire',
  'Signal Room',
  'Data Core',
  'Clone Bay',
  'Circuit Garden',
  'Prototype Bay',
  'Copy Chamber',
  'Logic Gate',
  'Memory Bank',
  'Plasma Lab',
  'Robot Workshop',
  'Synth Lab',
];
const LAB_TAGS = [
  'Protocol',
  'Build',
  'Unit',
  'Module',
  'Firmware',
  'Experiment',
  'Program',
  'Patch',
];
const NIGHT_PLACES = [
  'Moonbase Lobby',
  'Starlit Server Room',
  'Empty Concourse',
  'Orbital Breakroom',
  'Silent Mainframe',
  'Dim Arcade',
  'Sleeping Spire',
  'Last Shuttle',
  'Night Tram',
  'Observation Deck',
  'Quiet Terminal',
  'Rooftop Antenna',
  'Vending Machine Glow',
  'Blue Monitor',
];
const NIGHT_MODES = [
  'Standby',
  'Sleep Mode',
  'Low Power',
  'Screensaver',
  'Night Cycle',
  'Idle Loop',
  'Dim Mode',
  'Starlight Mode',
];
const NIGHT_OF = [
  'Stars',
  'Satellites',
  'Fireflies',
  'Monitors',
  'Neon',
  'Static',
  'Comets',
  'Moonlight',
];

const ORBIT_PLACES = [
  'Space Station',
  'Satellite',
  'Docking Bay',
  'Solar Array',
  'Zero-G Lounge',
  'Ring Station',
  'Star Elevator',
  'Comet Trail',
  'Lunar Office',
  'Orbital Atrium',
  'Gravity Well',
  'Launch Window',
];
const RAIN_ON = [
  'Skylight',
  'Monorail',
  'Dome',
  'Neon Sign',
  'Window',
  'Rooftop Antenna',
  'Concourse',
  'Glass Tower',
  'Solar Panels',
  'Arcade Awning',
];
const RAIN_WEATHER = ['Drizzle', 'Rain', 'Mist', 'Showers', 'Fog', 'Downpour'];
const RAIN_PLACES = [
  'Wet Neon',
  'Umbrella Lobby',
  'Puddle Plaza',
  'Foggy Terminal',
  'Rainy Breakroom',
  'Misty Concourse',
  'Dripping Mainframe',
  'Storm Window',
];
const DAWN_WORDS = [
  'Boot Sequence',
  'Morning Shift',
  'Coffee Protocol',
  'First Shuttle',
  'Wake-Up Call',
  'Power On',
  'Daybreak Terminal',
  'Early Tram',
  'Sunrise Lobby',
  'Morning Briefing',
];
const ARCADE_WORDS = [
  'Insert Coin',
  'High Score',
  'Bonus Round',
  'Power-Up',
  'Extra Life',
  'Warp Zone',
  'Boss Rush',
  'Combo Breaker',
  'Player Two',
  'Press Start',
];

const letter = (r: Rng) => String.fromCharCode(65 + r.int(0, 25));

/** Each mood's name patterns, weighted. */
const NAME_PATTERNS: Record<MoodKey, Array<[(r: Rng) => string, number]>> = {
  town: [
    [(r) => `${r.pick(TOWN_ADJ)} ${r.pick(TOWN_PLACES)}`, 3],
    [(r) => `${r.pick(STARS)} ${r.pick(TOWN_PLACES)}`, 2],
    [(r) => `${r.pick(STARS)} City`, 1],
    [(r) => `Floor ${r.int(2, 99)} ${r.pick(TOWN_PLACES)}`, 1],
  ],
  route: [
    [(r) => `Route ${r.int(1, 99)}`, 1],
    [(r) => `${r.pick(ROUTE_WAYS)} to ${r.pick(ROUTE_TO)}`, 3],
    [(r) => `${r.pick(ROUTE_WAYS)} ${r.int(1, 99)}`, 1],
    [(r) => `Sector ${r.int(1, 12)}-${letter(r)}`, 1],
    [(r) => `${r.pick(STARS)} ${r.pick(ROUTE_WAYS)}`, 2],
  ],
  lab: [
    [(r) => `${r.pick(LAB_PLACES)} ${letter(r)}`, 2],
    [(r) => `${r.pick(LAB_TAGS)} ${r.int(1, 99)}`, 1],
    [(r) => `${r.pick(LAB_PLACES)} ${r.int(2, 9)}.${r.int(0, 9)}`, 1],
    [(r) => `The ${r.pick(LAB_PLACES)}`, 2],
  ],
  night: [
    [(r) => r.pick(NIGHT_PLACES), 3],
    [(r) => r.pick(NIGHT_MODES), 1],
    [(r) => `${r.pick(NIGHT_PLACES)}, ${r.int(1, 4)} AM`, 2],
    [(r) => `City of ${r.pick(NIGHT_OF)}`, 2],
    [(r) => `${r.pick(NIGHT_MODES)}: ${r.pick(STARS)}`, 1],
    [(r) => `${r.pick(STARS)} After Dark`, 1],
  ],
  orbit: [
    [(r) => r.pick(ORBIT_PLACES), 2],
    [(r) => `${r.pick(STARS)} Station`, 1],
    [(r) => `Drifting Past ${r.pick(STARS)}`, 2],
    [(r) => `Low Orbit ${letter(r)}`, 1],
    [(r) => `${r.pick(ORBIT_PLACES)} ${r.pick(STARS)}`, 2],
  ],
  rain: [
    [(r) => `Rain on the ${r.pick(RAIN_ON)}`, 3],
    [(r) => `${r.pick(RAIN_WEATHER)} Over ${r.pick(STARS)}`, 2],
    [(r) => `${r.pick(STARS)} in the Rain`, 1],
    [(r) => r.pick(RAIN_PLACES), 2],
    [(r) => `${r.pick(RAIN_WEATHER)} on Floor ${r.int(2, 99)}`, 1],
  ],
  dawn: [
    [(r) => r.pick(DAWN_WORDS), 2],
    [(r) => `First Light on ${r.pick(STARS)}`, 2],
    [(r) => `${r.pick(STARS)} Sunrise`, 1],
    [(r) => `Good Morning, ${r.pick(STARS)}`, 1],
    [(r) => `Sunrise Over Sector ${r.int(1, 12)}`, 1],
  ],
  arcade: [
    [(r) => r.pick(ARCADE_WORDS), 2],
    [(r) => `Stage ${r.int(1, 9)}-${r.int(1, 4)}`, 2],
    [(r) => `${r.pick(STARS)} Zone`, 2],
    [(r) => `${r.pick(TOWN_ADJ)} Galaxy`, 1],
    [(r) => `Level ${r.int(1, 99)}`, 1],
  ],
};

function tuneName(r: Rng, mood: MoodKey): string {
  return r.weighted(NAME_PATTERNS[mood])(r);
}

interface Block {
  kind: 'intro' | 'sec' | 'outro' | 'rest';
  bars: number;
  startBar: number;
  sec?: string;
  pass?: number;
  breather?: boolean;
}

/** Writes one tune. The same seed, mood and root give the same tune: the
 *  root comes from the previous tune's (`prevRoot`), or is pinned by `root`
 *  (a shared song code). */
export function makeSong(
  seed: number,
  moodKey: MoodKey,
  prevRoot: number | null,
  pinnedRoot?: number,
): Song {
  const r = rng(seed);
  const mood = MOODS[moodKey];
  const mode = r.weighted(mood.modes);
  const scale = SCALES[mode];
  let root = prevRoot == null ? r.int(50, 58) : prevRoot + r.pick([-5, -3, -2, 0, 2, 3, 5]);
  root = 50 + ((((root - 50) % 9) + 9) % 9); // D3..A#3
  if (pinnedRoot !== undefined) root = pinnedRoot; // after the draw, so the rest is the same
  const bpm = r.int(mood.bpm[0], mood.bpm[1]);
  const bpc = r.weighted(mood.bpc);
  const form = r.pick(FORMS);
  const secs: Record<string, Section> = {};
  let prev: number[] | null = null;
  for (const L of [...new Set(form)]) {
    secs[L] = makeSection(r, { mood, mode, bpc, isB: L !== 'A', avoid: prev });
    prev = secs[L].prog;
  }

  const breatherAt = 1 + r.int(0, form.length - 2);
  const blocks: Block[] = [{ kind: 'intro', bars: 2, startBar: 0 }];
  form.forEach((L) => blocks.push({ kind: 'sec', sec: L, pass: 1, bars: 8, startBar: 0 }));
  form.forEach((L, i) =>
    blocks.push({ kind: 'sec', sec: L, pass: 2, bars: 8, startBar: 0, breather: i === breatherAt }),
  );
  blocks.push({ kind: 'outro', bars: 2, startBar: 0 }, { kind: 'rest', bars: 1, startBar: 0 });
  let bar = 0;
  for (const b of blocks) {
    b.startBar = bar;
    bar += b.bars;
  }

  const S: Step[] = Array.from({ length: bar * 16 }, () => ({}));
  const put = <K extends keyof Step>(i: number, ch: K, ev: NonNullable<Step[K]>) => {
    if (i >= 0 && i < S.length) S[i][ch] = ev;
  };
  const lead = (d: number) => degToMidi(d, root + 12, scale);
  const bassM = (d: number) => degToMidi(d, root - 12, scale);

  const renderHarm = (
    base: number,
    style: HarmStyle,
    chords: number[],
    melody: MelodyNote[],
    louder: boolean,
  ) => {
    const v = louder ? 1 : 0;
    if (style === 'arp8' || style === 'arp16') {
      const pat = r.pick([
        [0, 1, 2, 3],
        [0, 1, 2, 1],
        [0, 2, 1, 2],
        [3, 2, 1, 0],
        [0, 1, 2, 1, 3, 2, 1, 2],
      ]);
      const step = style === 'arp8' ? 2 : 1;
      chords.forEach((c, b) => {
        const cd = low(c);
        const tones = [cd, cd + 2, cd + 4, cd + 7];
        for (let s = 0, k = 0; s < 16; s += step, k++)
          put(base + b * 16 + s, 'pu2', {
            m: lead(tones[pat[k % pat.length]]),
            len: step,
            v: (step === 1 ? 4 : 5) + v,
            es: 0.035,
            ef: 1,
            duty: 0,
          });
      });
    } else if (style === 'echo') {
      for (const n of melody)
        if (n.start + 3 < 128)
          put(base + n.start + 3, 'pu2', {
            m: lead(n.deg),
            len: Math.max(1, n.len - 1),
            v: 5,
            es: 0.06,
            ef: 2,
            duty: 1,
          });
    } else if (style === 'thirds') {
      for (const n of melody)
        put(base + n.start, 'pu2', {
          m: lead(n.deg - 2),
          len: n.len,
          v: 6,
          es: 0.07,
          ef: 3,
          duty: 1,
        });
    } else if (style === 'off') {
      chords.forEach((c, b) => {
        const cd = low(c);
        [2, 6, 10, 14].forEach((s, k) =>
          put(base + b * 16 + s, 'pu2', {
            m: lead(cd + (k % 2 ? 4 : 2)),
            len: 1,
            v: 6 + v,
            es: 0.03,
            ef: 0,
            duty: 0,
          }),
        );
      });
    } else {
      for (let b = 0; b < chords.length; b++) {
        const c = chords[b];
        const hold = b % 2 === 0 && chords[b + 1] === c;
        put(base + b * 16, 'pu2', {
          m: lead(low(c) + 2),
          len: hold ? 32 : 16,
          v: 7 + v,
          es: 0.3,
          ef: 2,
          duty: 1,
        });
        if (hold) b++;
      }
    }
  };

  const renderBass = (base: number, style: BassStyle, chords: number[], nextFirst: number) => {
    for (let b = 0; b < chords.length; b++) {
      const c = chords[b];
      const cd = low(c);
      const nd = low(chords[b + 1] ?? nextFirst);
      const at = base + b * 16;
      if (style === 'roots') {
        put(at, 'wav', { m: bassM(cd), len: 6, v: 1 });
        put(at + 8, 'wav', { m: bassM(r.chance(0.4) ? cd - 3 : cd), len: 6, v: 0.8 });
      } else if (style === 'rootfifth') {
        [cd, cd + 4, cd, cd + 4].forEach((d, k) =>
          put(at + k * 4, 'wav', { m: bassM(d), len: 3, v: k % 2 ? 0.7 : 1 }),
        );
      } else if (style === 'pulse8') {
        for (let s = 0; s < 16; s += 2)
          put(at + s, 'wav', {
            m: bassM(cd) + ((s / 2) % 4 === 2 ? 12 : 0),
            len: 2,
            gate: 0.6,
            v: s % 4 === 0 ? 1 : 0.6,
          });
      } else if (style === 'walk') {
        const ap = nd < cd + 4 ? nd + 1 : nd - 1;
        [cd, cd + 2, cd + 4, ap].forEach((d, k) =>
          put(at + k * 4, 'wav', { m: bassM(d), len: 3, v: k ? 0.75 : 1 }),
        );
      } else {
        const hold = b % 2 === 0 && chords[b + 1] === c;
        put(at, 'wav', { m: bassM(cd), len: hold ? 30 : 14, v: 1 });
        if (hold) b++;
      }
    }
  };

  const renderDrums = (base: number, kit: DrumKit, bars: number, fill: boolean) => {
    if (kit === 'none') return;
    for (let b = 0; b < bars; b++) {
      const at = base + b * 16;
      if (kit === 'hats')
        for (let s = 0; s < 16; s += 2) put(at + s, 'noi', { k: 'h', v: s % 4 === 0 ? 0.55 : 0.3 });
      if (kit === 'brush') {
        for (const [s, v] of [
          [0, 0.5],
          [6, 0.3],
          [8, 0.5],
          [14, 0.3],
        ])
          put(at + s, 'noi', { k: 'h', v });
        if (b % 2) put(at + 12, 'noi', { k: 's', v: 0.3 });
      }
      if (kit === 'groove') {
        for (const s of [2, 6, 10, 14]) put(at + s, 'noi', { k: 'h', v: 0.35 });
        put(at, 'noi', { k: 'k', v: 0.7 });
        put(at + 8, 'noi', { k: 'k', v: 0.55 });
        put(at + 4, 'noi', { k: 's', v: 0.4 });
        put(at + 12, 'noi', { k: 's', v: 0.4 });
      }
      if (kit === 'rain')
        // Soft ticks scattered at random: rain on the window, never a beat.
        for (let s = 0; s < 16; s++)
          if (r.chance(0.3)) put(at + s, 'noi', { k: 'h', v: 0.06 + r() * 0.12 });
      if (fill && b === bars - 1 && kit !== 'hats' && kit !== 'rain') {
        put(at + 13, 'noi', { k: 's', v: 0.25 });
        put(at + 14, 'noi', { k: 's', v: 0.32 });
        put(at + 15, 'noi', { k: 's', v: 0.4 });
      }
    }
  };

  const first = secs[form[0]];
  blocks.forEach((blk, bi) => {
    const base = blk.startBar * 16;
    if (blk.kind === 'intro') {
      const style = first.harm === 'echo' || first.harm === 'thirds' ? 'arp8' : first.harm;
      renderHarm(base, style, first.chords.slice(0, 2), [], false);
      renderBass(base, first.bass, first.chords.slice(0, 2), first.chords[2]);
    } else if (blk.kind === 'sec' && blk.sec) {
      const sec = secs[blk.sec];
      const pass = blk.pass ?? 1;
      const melody = blk.breather ? [] : buildMelody(sec, pass - 1);
      const duty = pass === 2 && r.chance(0.35) ? r.pick([0, 1, 2]) : sec.duty;
      for (const n of melody)
        put(base + n.start, 'pu1', {
          m: lead(n.deg),
          len: n.len,
          v: n.final ? 10 : 11,
          es: n.final ? 0.16 : n.len >= 6 ? 0.12 : 0.05,
          ef: n.len >= 6 ? 6 : 4,
          duty,
          vib: n.len >= 5,
        });
      let style = pass === 2 && r.chance(0.35) ? r.weighted(mood.harm) : sec.harm;
      if (blk.breather) style = r.pick<HarmStyle>(['pad', 'arp8']);
      if (!melody.length && (style === 'echo' || style === 'thirds')) style = 'arp8';
      renderHarm(base, style, sec.chords, melody, !!blk.breather);
      const nextBlk = blocks[bi + 1];
      const nextFirst = nextBlk?.kind === 'sec' && nextBlk.sec ? secs[nextBlk.sec].chords[0] : 0;
      renderBass(
        base,
        pass === 2 && r.chance(0.25) ? r.weighted(mood.bass) : sec.bass,
        sec.chords,
        nextFirst,
      );
      renderDrums(
        base,
        pass === 1 ? sec.drums1 : sec.drums2,
        8,
        !nextBlk || nextBlk.kind === 'sec',
      );
    } else if (blk.kind === 'outro') {
      put(base, 'wav', { m: bassM(0), len: 28, v: 1 });
      put(base, 'pu2', { m: lead(2), len: 28, v: 6, es: 0.3, ef: 0, duty: 1 });
      put(base, 'pu1', {
        m: lead(first.s0 > 3 ? 7 : 0),
        len: 28,
        v: 9,
        es: 0.22,
        ef: 0,
        duty: first.duty,
        vib: true,
      });
    }
  });

  // Each channel is monophonic: a new note cuts the previous one.
  for (const ch of ['pu1', 'pu2', 'wav'] as const) {
    let last = -1;
    for (let i = 0; i < S.length; i++) {
      const ev = S[i][ch];
      if (!ev) continue;
      const prevEv = last >= 0 ? S[last][ch] : undefined;
      if (prevEv) prevEv.len = Math.min(prevEv.len, i - last);
      last = i;
    }
  }

  return {
    seed,
    moodKey,
    prevRoot,
    root,
    modeName: MODE_NAME[mode],
    bpm,
    stepDur: 60 / bpm / 4,
    name: tuneName(r, moodKey),
    steps: S,
  };
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** "D mixolydian" */
export const keyLabel = (song: Song): string => `${NOTE_NAMES[song.root % 12]} ${song.modeName}`;

/** The lowest and highest tune roots (MIDI): D3..A#3. */
const ROOT_MIN = 50;
const ROOT_MAX = 58;

/** A tune as a short shareable code: mood, key and seed, "TOWN-5-8F3A21C0". */
export const songCode = (song: Song): string =>
  `${song.moodKey.toUpperCase()}-${song.root - ROOT_MIN}-${song.seed.toString(16).toUpperCase().padStart(8, '0')}`;

/** Reads a song code back; null when it isn't one. */
export function parseSongCode(
  code: string,
): { moodKey: MoodKey; root: number; seed: number } | null {
  // The UI font draws 0 like an o: read a typed o as the 0 it meant.
  const m = /^\s*([a-z]+)-([\do])-([0-9a-fo]{1,8})\s*$/i.exec(code);
  if (!m) return null;
  const moodKey = m[1].toLowerCase() as MoodKey;
  const root = ROOT_MIN + Number(m[2].replace(/o/i, '0'));
  if (!MOOD_KEYS.includes(moodKey) || root > ROOT_MAX) return null;
  return { moodKey, root, seed: parseInt(m[3].replace(/o/gi, '0'), 16) >>> 0 };
}
