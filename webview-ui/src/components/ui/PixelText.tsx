import type { CSSProperties } from 'react';

import { PIXEL_ICON_SCALE } from '../../constants.js';
import { useDevicePixelRatio } from '../../hooks/useDevicePixelRatio.js';
import { GLYPH_HEIGHT, glyphRects, splitLabel } from './pixelFont.js';
import { devicePixelsPerArtPixel } from './pixelSnap.js';

/**
 * Text whose numbers are drawn in the 3×5 pixel font (pixelFont.ts) and whose
 * words stay in the UI font at the inherited size, all in the text colour.
 * Each glyph pixel covers a whole number of device pixels, like PixelIcon.
 */
export function PixelText({
  text,
  scale = PIXEL_ICON_SCALE,
  shadow = false,
  className = '',
  style,
}: {
  text: string;
  /** CSS pixels per glyph pixel. Whole numbers only. */
  scale?: number;
  /** A hard dark shadow under the glyphs, for text drawn over the office. */
  shadow?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const dpr = useDevicePixelRatio();
  const unit = devicePixelsPerArtPixel(scale, dpr) / dpr;
  return (
    <span className={`inline-flex items-center whitespace-nowrap ${className}`} style={style}>
      {splitLabel(text).map((part, i) => {
        if (!part.glyphs) {
          return (
            <span key={i} className="leading-none whitespace-pre" aria-hidden="true">
              {part.text}
            </span>
          );
        }
        const { rects, width } = glyphRects(part.text);
        return (
          <svg
            key={i}
            width={width * unit}
            height={GLYPH_HEIGHT * unit}
            viewBox={`0 0 ${width} ${GLYPH_HEIGHT}`}
            fill="currentColor"
            shapeRendering="crispEdges"
            aria-hidden="true"
            className={`shrink-0 ${shadow ? 'pixel-glyphs-shadow' : ''}`}
          >
            {rects.map(([x, y, w]) => (
              <rect key={`${x}:${y}`} x={x} y={y} width={w} height={1} />
            ))}
          </svg>
        );
      })}
      <span className="sr-only">{text}</span>
    </span>
  );
}
