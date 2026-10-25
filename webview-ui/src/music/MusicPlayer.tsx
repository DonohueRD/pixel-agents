import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { Button } from '../components/ui/Button.js';
import { PixelIcon } from '../components/ui/PixelIcon.js';
import { PixelText } from '../components/ui/PixelText.js';
import {
  MUSIC_FLICK_MAX_AGE_MS,
  MUSIC_FLICK_PX_PER_MS,
  MUSIC_PLAYER_BOTTOM_PX,
  MUSIC_PLAYER_WIDTH_PX,
  MUSIC_SHEET_EASE,
  MUSIC_SHEET_SETTLE_MS,
  MUSIC_VERSION_GAP_PX,
  MUSIC_VISUALIZER_BARS,
  MUSIC_VISUALIZER_HEIGHT_PX,
  MUSIC_VOLUME_SLIDER_HEIGHT_PX,
} from '../constants.js';
import { writeClipboardText } from '../terminal/clipboard.js';
import { findTouch, withinTapSlop } from '../touch/touchPrimitives.js';
import { MOOD_KEYS, MOODS, type MoodSetting } from './moods.js';
import { officeRadio } from './musicEngine.js';
import { keyLabel, songCode } from './songCode.js';

const MOOD_OPTIONS: MoodSetting[] = ['auto', ...MOOD_KEYS];
const moodName = (m: MoodSetting) => (m === 'auto' ? 'Auto' : MOODS[m].label);
/** Bar heights move in whole steps of this many px (pixel look). */
const BAR_STEP_PX = 2;

/** Closes a popover on a press outside `ref` or on Escape, while `open`. */
function useDismiss(open: boolean, ref: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, ref, close]);
}

/** Bars of the mix's loudness, low notes left, redrawn every frame while playing. */
function Visualizer({ playing }: { playing: boolean }) {
  const barsRef = useRef<Array<HTMLDivElement | null>>([]);
  useEffect(() => {
    const bands = new Array<number>(MUSIC_VISUALIZER_BARS).fill(0);
    let raf = 0;
    const draw = () => {
      officeRadio.readBands(bands);
      bands.forEach((level, i) => {
        const el = barsRef.current[i];
        if (!el) return;
        const px = Math.max(
          BAR_STEP_PX,
          Math.round((level * MUSIC_VISUALIZER_HEIGHT_PX) / BAR_STEP_PX) * BAR_STEP_PX,
        );
        el.style.height = `${px}px`;
      });
      if (playing) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  return (
    <div
      className="flex items-end gap-2 shrink-0"
      style={{ height: MUSIC_VISUALIZER_HEIGHT_PX }}
      aria-hidden="true"
    >
      {Array.from({ length: MUSIC_VISUALIZER_BARS }, (_, i) => (
        <div
          key={i}
          ref={(el) => {
            barsRef.current[i] = el;
          }}
          className="w-4 bg-accent-bright"
          style={{ height: BAR_STEP_PX }}
        />
      ))}
    </div>
  );
}

/** The speaker button: a press mutes; hovering (or a tap, on touch) shows a
 *  vertical volume slider above it. */
function VolumeControl({ volume }: { volume: number }) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const lastPointer = useRef<string>('mouse');
  useDismiss(pinned, rootRef, () => setPinned(false));
  const pct = Math.round(volume * 100);

  const setFromY = (clientY: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r) return;
    officeRadio.setVolume(Math.min(1, Math.max(0, (r.bottom - clientY) / r.height)));
  };

  return (
    <div
      ref={rootRef}
      className="relative shrink-0"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {(hovered || pinned) && (
        // Padding below the panel bridges the gap, so the pointer can travel up to it.
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 pb-6">
          <div className="pixel-panel px-8 py-8 flex flex-col items-center gap-8">
            <PixelText text={`${pct}`} className="text-2xs text-text-muted" />
            <div
              ref={trackRef}
              role="slider"
              tabIndex={0}
              aria-label="Music volume"
              aria-orientation="vertical"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              className="relative w-12 border-2 border-border bg-bg-dark cursor-pointer touch-none"
              style={{ height: MUSIC_VOLUME_SLIDER_HEIGHT_PX }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                setFromY(e.clientY);
              }}
              onPointerMove={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) setFromY(e.clientY);
              }}
              onKeyDown={(e) => {
                const step = e.key === 'ArrowUp' ? 0.05 : e.key === 'ArrowDown' ? -0.05 : 0;
                if (!step) return;
                e.preventDefault();
                officeRadio.setVolume(volume + step);
              }}
            >
              <div
                className="absolute left-0 right-0 bottom-0 bg-accent"
                style={{ height: `${pct}%` }}
              />
              <div
                className="absolute -left-4 -right-4 h-6 bg-text border-2 border-border shadow-pixel"
                style={{ bottom: `calc(${pct}% - 3px)` }}
              />
            </div>
          </div>
        </div>
      )}
      <Button
        size="icon_lg"
        variant="ghost"
        className="w-28! h-32!"
        onPointerDown={(e) => {
          lastPointer.current = e.pointerType;
        }}
        onClick={() => {
          // Touch has no hover: a tap shows the slider instead of muting.
          if (lastPointer.current === 'touch') setPinned((v) => !v);
          else officeRadio.toggleMute();
        }}
        aria-label={volume > 0 ? 'Mute music' : 'Unmute music'}
        title={volume > 0 ? 'Mute' : 'Unmute'}
      >
        <PixelIcon name={volume > 0 ? 'speaker' : 'speakerMuted'} />
      </Button>
    </div>
  );
}

/** The settings panel: mood, and the song code to share a tune or play one. */
function SettingsPanel({ mood, code }: { mood: MoodSetting; code: string }) {
  const [copied, setCopied] = useState(false);
  const [entry, setEntry] = useState('');
  const [invalid, setInvalid] = useState(false);

  useEffect(() => setCopied(false), [code]);

  const play = () => {
    if (officeRadio.playCode(entry)) {
      setEntry('');
      setInvalid(false);
    } else setInvalid(true);
  };

  return (
    <div className="pixel-panel p-8 flex flex-col gap-8">
      <span className="text-xs text-text-muted leading-none">Mood</span>
      <div className="flex flex-wrap gap-4">
        {MOOD_OPTIONS.map((m) => (
          <Button
            key={m}
            size="sm"
            variant={mood === m ? 'active' : 'default'}
            onClick={() => officeRadio.setMood(m)}
            aria-pressed={mood === m}
          >
            {moodName(m)}
          </Button>
        ))}
      </div>

      <span className="text-xs text-text-muted leading-none mt-4">Song code</span>
      <div className="flex items-center gap-6">
        <span className="flex-1 min-w-0 truncate text-sm text-text select-all" title={code}>
          {code}
        </span>
        <Button
          size="sm"
          onClick={() => {
            void writeClipboardText(code).then((ok) => setCopied(ok));
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <form
        className="flex items-center gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          play();
        }}
      >
        <input
          value={entry}
          onChange={(e) => {
            setEntry(e.target.value);
            setInvalid(false);
          }}
          placeholder="Paste a song code"
          aria-label="Song code to play"
          aria-invalid={invalid}
          className={`flex-1 min-w-0 bg-bg-dark border-2 ${invalid ? 'border-danger' : 'border-border'} px-6 py-2 text-sm text-text rounded-none outline-none focus:border-accent`}
        />
        <Button size="sm" type="submit" disabled={!entry.trim()}>
          Play
        </Button>
      </form>
      {invalid && (
        <span className="text-2xs text-danger leading-none">
          Not a song code. They look like TOWN-5-8F3A21C0.
        </span>
      )}

      <div className="flex items-center justify-between gap-8 mt-4">
        <span className="text-2xs text-text-muted leading-tight">Bring it back from Settings.</span>
        <Button size="sm" onClick={() => officeRadio.setHidden(true)}>
          Hide player
        </Button>
      </div>
    </div>
  );
}

interface SheetDrag {
  id: number;
  x0: number;
  y0: number;
  /** Where the player stood when the finger landed: 0 out, `travel` tucked away. */
  base: number;
  travel: number;
  /** null until the finger leaves the tap slop; then whether it moves up/down. */
  vertical: boolean | null;
  lastY: number;
  lastT: number;
  vy: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Phone: the player as a sheet that follows one finger, up from the hint or
 * down from the player, then settles open or shut on release: a flick goes the
 * way it was thrown, a slow drag the way of the half it was let go in.
 */
function usePlayerSheet(shown: boolean, settle: (open: boolean) => void, measure: () => number) {
  const [pos, setPos] = useState<{ offset: number; travel: number } | null>(null);
  const drag = useRef<SheetDrag | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    // Leave the volume slider and text fields their own drags.
    const el = e.target as HTMLElement;
    if (drag.current || el.closest('[role="slider"], input')) return;
    const t = e.changedTouches[0];
    const travel = measure();
    drag.current = {
      id: t.identifier,
      x0: t.clientX,
      y0: t.clientY,
      base: shown ? 0 : travel,
      travel,
      vertical: null,
      lastY: t.clientY,
      lastT: e.timeStamp,
      vy: 0,
    };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const d = drag.current;
    const t = d && findTouch(e.changedTouches, d.id);
    if (!d || !t) return;
    const dx = t.clientX - d.x0;
    const dy = t.clientY - d.y0;
    if (d.vertical === null) {
      if (withinTapSlop(dx, dy)) return;
      d.vertical = Math.abs(dy) > Math.abs(dx);
    }
    if (!d.vertical) return;
    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.vy = (t.clientY - d.lastY) / dt;
    d.lastY = t.clientY;
    d.lastT = e.timeStamp;
    setPos({ offset: clamp(d.base + dy, 0, d.travel), travel: d.travel });
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const d = drag.current;
    const t = d && findTouch(e.changedTouches, d.id);
    if (!d || !t) return;
    drag.current = null;
    if (d.vertical) {
      const at = clamp(d.base + t.clientY - d.y0, 0, d.travel);
      const vy = e.timeStamp - d.lastT > MUSIC_FLICK_MAX_AGE_MS ? 0 : d.vy;
      settle(
        vy < -MUSIC_FLICK_PX_PER_MS ? true : vy > MUSIC_FLICK_PX_PER_MS ? false : at < d.travel / 2,
      );
    }
    setPos(null);
  };
  const onTouchCancel = () => {
    drag.current = null;
    setPos(null);
  };
  return { pos, handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel } };
}

/**
 * The office radio, bottom-right of the office: play/pause, skip, the tune
 * playing with its progress, a bar visualizer, volume (hover for the
 * slider) and a settings panel (mood, song code, hide). On a phone it is
 * centred and tucked below the office's foot behind a muted hint; it follows
 * a finger up from the hint and back down, and a tap elsewhere tucks it away.
 * Never plays on its own — browsers only start audio from a click.
 */
export function MusicPlayer({ mobile }: { mobile: boolean }) {
  const radio = useSyncExternalStore(officeRadio.subscribe, officeRadio.getState);
  const [open, setOpen] = useState(false);
  // Phone only: whether the player is out (it starts tucked away each load).
  const [shown, setShown] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useDismiss(open, rootRef, () => setOpen(false));
  const settle = useCallback((out: boolean) => {
    if (!out) setOpen(false);
    setShown(out);
  }, []);
  const tuckAway = useCallback(() => settle(false), [settle]);
  useDismiss(mobile && shown, rootRef, tuckAway);
  const sheet = usePlayerSheet(
    shown,
    settle,
    () => (rootRef.current?.offsetHeight ?? 0) + MUSIC_PLAYER_BOTTOM_PX,
  );
  // How far out the player is (0 tucked away or hidden, 1 out), shared with
  // the version label through CSS variables so it rides above the player.
  const barRef = useRef<HTMLDivElement>(null);
  const { pos } = sheet;
  const reveal = radio.hidden ? 0 : !mobile ? 1 : pos ? 1 - pos.offset / pos.travel : Number(shown);
  const dragging = pos !== null;
  useLayoutEffect(() => {
    const h = barRef.current?.offsetHeight ?? 0;
    const root = document.documentElement.style;
    root.setProperty('--music-lift', `${Math.round(reveal * (h + MUSIC_VERSION_GAP_PX))}px`);
    root.setProperty('--music-settle', dragging ? '0ms' : `${MUSIC_SHEET_SETTLE_MS}ms`);
  }, [reveal, dragging]);
  useEffect(
    () => () => {
      document.documentElement.style.removeProperty('--music-lift');
      document.documentElement.style.removeProperty('--music-settle');
    },
    [],
  );

  const { song } = radio;
  if (radio.hidden) return null;

  const body = (
    <>
      {open && <SettingsPanel mood={radio.mood} code={songCode(song)} />}

      <div ref={barRef} className="pixel-panel relative flex items-center gap-6 px-6 py-4">
        <Button
          size="icon_lg"
          variant={radio.playing ? 'active' : 'default'}
          className="w-32! h-32! shrink-0"
          onClick={() => void officeRadio.toggle()}
          aria-label={radio.playing ? 'Pause music' : 'Play music'}
          title={radio.playing ? 'Pause music' : 'Play music'}
        >
          <PixelIcon name={radio.playing ? 'pause' : 'next'} />
        </Button>
        <Button
          size="icon_lg"
          className="w-32! h-32! shrink-0"
          onClick={() => officeRadio.skip()}
          aria-label="Next tune"
          title="Next tune"
        >
          <PixelIcon name="skip" />
        </Button>
        <div className="flex-1 min-w-0 flex flex-col gap-2 leading-none ml-2">
          <span className="text-xs text-text truncate" title={song.name}>
            <PixelText text={song.name} />
          </span>
          <span className="text-2xs text-text-muted truncate">
            {MOODS[song.moodKey].label} · {keyLabel(song)}
          </span>
        </div>
        <Visualizer playing={radio.playing} />
        <VolumeControl volume={radio.volume} />
        <Button
          size="icon_lg"
          variant="ghost"
          className="w-28! h-32! shrink-0"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Music settings"
          title="Mood and song code"
        >
          <PixelIcon name="settings" />
        </Button>
        {/* The tune's progress, along the panel's foot. */}
        <div className="absolute left-0 right-0 bottom-0 h-2 bg-bg-dark" aria-hidden="true">
          <div className="h-full bg-accent" style={{ width: `${radio.progress * 100}%` }} />
        </div>
      </div>
    </>
  );

  if (!mobile) {
    return (
      <div
        ref={rootRef}
        className="absolute right-10 z-30 flex flex-col items-stretch gap-4"
        style={{
          bottom: MUSIC_PLAYER_BOTTOM_PX,
          width: MUSIC_PLAYER_WIDTH_PX,
          maxWidth: 'calc(100% - 20px)',
        }}
      >
        {body}
      </div>
    );
  }

  // Phone: below the office's foot (clipped there) until shown or dragged.
  const y = pos ? `${pos.offset}px` : shown ? '0px' : `calc(100% + ${MUSIC_PLAYER_BOTTOM_PX}px)`;
  const hidden = pos ? pos.offset / pos.travel : shown ? 0 : 1;
  const ease = `${MUSIC_SHEET_SETTLE_MS}ms ${MUSIC_SHEET_EASE}`;
  return (
    <div className="absolute inset-0 z-30 overflow-hidden pointer-events-none">
      <button
        type="button"
        {...sheet.handlers}
        onClick={() => settle(true)}
        aria-label="Show music player"
        tabIndex={shown ? -1 : 0}
        className={`absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 px-16 py-6 text-2xs text-text-muted select-none touch-none bg-transparent border-0 ${shown ? '' : 'pointer-events-auto'}`}
        style={{
          bottom: MUSIC_PLAYER_BOTTOM_PX,
          opacity: 0.6 * hidden,
          transition: pos ? 'none' : `opacity ${ease}`,
        }}
      >
        <span className="flex rotate-180">
          <PixelIcon name="down" scale={1} />
        </span>
        <span className="whitespace-nowrap leading-none">Swipe up for music</span>
      </button>
      <div
        ref={rootRef}
        {...sheet.handlers}
        inert={!shown && !pos}
        className="absolute left-1/2 flex flex-col items-stretch gap-4 pointer-events-auto touch-none"
        style={{
          bottom: MUSIC_PLAYER_BOTTOM_PX,
          width: MUSIC_PLAYER_WIDTH_PX,
          maxWidth: 'calc(100% - 20px)',
          transform: `translate(-50%, ${y})`,
          transition: pos ? 'none' : `transform ${ease}`,
        }}
      >
        {body}
      </div>
    </div>
  );
}
