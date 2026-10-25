import { devicePixelsPerArtPixel } from '../components/ui/pixelSnap.js';
import { PIXEL_ICON_SCALE, USAGE_HEART_COLORS } from '../constants.js';
import { useDevicePixelRatio } from '../hooks/useDevicePixelRatio.js';

/** The heart: outlined, red, shaded on the right, a highlight top-left.
 *  Letters are USAGE_HEART_COLORS keys; '.' is clear. */
const HEART = [
  '..oo.oo..',
  '.orrordo.',
  'orwrrrrdo',
  'orrrrrrdo',
  '.orrrrdo.',
  '..orrdo..',
  '...odo...',
  '....o....',
];

/** The beat: the same heart one pixel bigger all round, drawn over it. */
const HEART_BEAT = [
  '..ooo.ooo..',
  '.orrrorrdo.',
  'orwrrrrrrdo',
  'orrrrrrrrdo',
  'orrrrrrrrdo',
  '.orrrrrrdo.',
  '..orrrrdo..',
  '...orrdo...',
  '....odo....',
  '.....o.....',
];

/** One SVG of pixel art in several colours, each art pixel a whole number of
 *  device pixels (like PixelIcon). */
function PixelArt({
  grid,
  unit,
  className,
  style,
}: {
  grid: string[];
  unit: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const cols = grid[0].length;
  const rects: React.ReactNode[] = [];
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x];
      let end = x + 1;
      while (row[end] === c) end++;
      if (c !== '.') {
        rects.push(
          <rect
            key={`${y}:${x}`}
            x={x}
            y={y}
            width={end - x}
            height={1}
            fill={USAGE_HEART_COLORS[c]}
          />,
        );
      }
      x = end;
    }
  });
  return (
    <svg
      width={cols * unit}
      height={grid.length * unit}
      viewBox={`0 0 ${cols} ${grid.length}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      className={`shrink-0 ${className ?? ''}`}
      style={style}
    >
      {rects}
    </svg>
  );
}

/** The usage bars' heart. With a period it beats lub-dub, once per period
 *  (the `.usage-heart-beat` keyframes): the bigger frame flashes over it, a
 *  swap of whole pixels, never a scale, and it takes no layout room. */
export function PixelHeart({ periodSec }: { periodSec: number | null }) {
  const dpr = useDevicePixelRatio();
  const unit = devicePixelsPerArtPixel(PIXEL_ICON_SCALE, dpr) / dpr;
  return (
    <span className="relative flex">
      <PixelArt grid={HEART} unit={unit} />
      {periodSec !== null && (
        <PixelArt
          grid={HEART_BEAT}
          unit={unit}
          className="absolute usage-heart-beat pointer-events-none"
          style={{ left: -unit, top: -unit, animationDuration: `${periodSec}s` }}
        />
      )}
    </span>
  );
}
