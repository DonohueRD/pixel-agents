import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { CHAR_FRAME_W } from '../../../core/src/assets/constants.js';
import { DEFAULT_CHARACTER_PROFILES } from '../../../core/src/defaultCharacterProfiles.js';
import { useCast } from '../characters/castStore.js';
import { SpriteCanvas } from '../characters/ui/SpriteCanvas.js';
import {
  CHARACTER_ANIM_MS,
  LOADING_DESK_GAP,
  LOADING_WALK_SPAN,
  LOADING_WALK_STEP,
  LOADING_ZOOM,
} from '../constants.js';
import { useDevicePixelRatio } from '../hooks/useDevicePixelRatio.js';
import { prefersReducedMotion } from '../hooks/usePresence.js';

/** Sheet frames: the walk cycle, typing, reading (characters/sheet.ts order). */
const WALK = [0, 1, 2, 1];
const TYPE = [3, 4];
const READ = [5, 6];

/** A step counter ticking every `ms` (frozen when motion is reduced). */
function useTick(ms: number, still: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (still) return;
    const id = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [ms, still]);
  return tick;
}

/** Where the walker is on its path at a step (in sprite pixels): there and
 *  back, and which way it faces. */
function walkerAt(step: number): { x: number; facing: 'left' | 'right' } {
  const steps = Math.max(1, Math.floor(LOADING_WALK_SPAN / LOADING_WALK_STEP));
  const t = step % (2 * steps);
  return t < steps
    ? { x: t * LOADING_WALK_STEP, facing: 'right' }
    : { x: (2 * steps - t) * LOADING_WALK_STEP, facing: 'left' };
}

/** A character seated behind a desk (CSS-drawn: the furniture art arrives
 *  with the office), with a monitor at its side when it is typing. All sizes
 *  are whole sprite pixels (index.css .loading-desk). */
function Desk({
  px,
  monitor = false,
  children,
}: {
  /** CSS pixels per sprite pixel. */
  px: number;
  monitor?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="relative" style={{ '--px': `${px}px` } as CSSProperties}>
      {children}
      <div className="loading-desk" />
      {monitor && <div className="loading-monitor" />}
    </div>
  );
}

/**
 * The loading screen: while the office loads, a few of the default characters
 * get on with it — one typing, one reading, one pacing below them. Drawn from
 * the bundled wardrobe, so it needs nothing from the server; until the
 * wardrobe has decoded it is just the words.
 */
export function LoadingScene() {
  const { renderer } = useCast();
  const dpr = useDevicePixelRatio();
  const still = prefersReducedMotion();
  const walkStep = useTick(CHARACTER_ANIM_MS.walk, still);
  const typeStep = useTick(CHARACTER_ANIM_MS.type, still);
  const readStep = useTick(CHARACTER_ANIM_MS.read, still);
  const [typist, reader, walker] = DEFAULT_CHARACTER_PROFILES;
  const sheet = (p: (typeof DEFAULT_CHARACTER_PROFILES)[number] | undefined) =>
    p && renderer ? renderer.sheet(p) : null;
  const pace = walkerAt(walkStep);
  // The office's zoom rule: whole DEVICE pixels per sprite pixel, so the
  // characters are the size they are in the office at LOADING_ZOOM.
  const px = LOADING_ZOOM / dpr;

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-16">
      {renderer && (
        <div className="flex flex-col items-center gap-4" aria-hidden="true">
          <div className="flex" style={{ gap: LOADING_DESK_GAP * px }}>
            <Desk px={px} monitor>
              <SpriteCanvas
                sheet={sheet(typist)}
                view={{ kind: 'frame', facing: 'down', frame: TYPE[typeStep % TYPE.length] }}
                scale={px}
                dpr={dpr}
                className="block"
              />
            </Desk>
            <Desk px={px}>
              <SpriteCanvas
                sheet={sheet(reader)}
                view={{ kind: 'frame', facing: 'down', frame: READ[readStep % READ.length] }}
                scale={px}
                dpr={dpr}
                className="block"
              />
            </Desk>
          </div>
          <div style={{ width: (LOADING_WALK_SPAN + CHAR_FRAME_W) * px }}>
            {/* whole sprite pixels, so whole device pixels: it stays crisp */}
            <div className="relative" style={{ left: pace.x * px, width: 'fit-content' }}>
              <SpriteCanvas
                sheet={sheet(walker)}
                view={{ kind: 'frame', facing: pace.facing, frame: WALK[walkStep % WALK.length] }}
                scale={px}
                dpr={dpr}
                className="block"
              />
            </div>
          </div>
        </div>
      )}
      <span className="text-sm text-text-muted">Loading the office...</span>
    </div>
  );
}
