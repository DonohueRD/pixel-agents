import type { CSSProperties } from 'react';

import { PIXEL_ICON_SCALE } from '../../constants.js';
import { useDevicePixelRatio } from '../../hooks/useDevicePixelRatio.js';
import type { PixelIconName } from './pixelIcons.js';
import { ICONS } from './pixelIcons.js';
import { devicePixelsPerArtPixel } from './pixelSnap.js';

export type { PixelIconName } from './pixelIcons.js';

/** One row's lit pixels merged into horizontal runs: fewer rects, no seams. */
function runs(row: string): Array<[start: number, length: number]> {
  const out: Array<[number, number]> = [];
  let start = -1;
  for (let x = 0; x <= row.length; x++) {
    const lit = row[x] === '#';
    if (lit && start < 0) start = x;
    if (!lit && start >= 0) {
      out.push([start, x - start]);
      start = -1;
    }
  }
  return out;
}

/**
 * A pixel-art icon in the text colour. Each icon pixel covers a whole number
 * of device pixels (`scale` CSS px, rounded down when the display or browser
 * zoom makes that fractional), so its rows and columns all come out equal
 * (pixelSnap.ts).
 */
export function PixelIcon({
  name,
  scale = PIXEL_ICON_SCALE,
  className = '',
  style,
}: {
  name: PixelIconName;
  /** CSS pixels per icon pixel. Whole numbers only: 1 is one step smaller. */
  scale?: number;
  className?: string;
  /** Whole-pixel transforms only (a nudge), so the icon stays crisp. */
  style?: CSSProperties;
}) {
  const grid = ICONS[name];
  const cols = Math.max(...grid.map((row) => row.length));
  const dpr = useDevicePixelRatio();
  const unit = devicePixelsPerArtPixel(scale, dpr) / dpr;

  return (
    <svg
      width={cols * unit}
      height={grid.length * unit}
      viewBox={`0 0 ${cols} ${grid.length}`}
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
      style={style}
    >
      {grid.flatMap((row, y) =>
        runs(row).map(([x, w]) => <rect key={`${y}:${x}`} x={x} y={y} width={w} height={1} />),
      )}
    </svg>
  );
}
