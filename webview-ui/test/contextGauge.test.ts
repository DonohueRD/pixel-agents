import { describe, expect, it } from 'vitest';

import {
  CONTEXT_GAUGE_COLOR_OK,
  CONTEXT_GAUGE_COLOR_RED,
  CONTEXT_GAUGE_COLOR_YELLOW,
} from '../src/constants.js';
import { contextColor, contextLeft } from '../src/office/contextGauge.js';

describe('contextColor', () => {
  it("steps like the user's status line: green under 33% used, yellow to 66%, red past it", () => {
    expect(contextColor(0.1)).toBe(CONTEXT_GAUGE_COLOR_OK);
    expect(contextColor(0.33)).toBe(CONTEXT_GAUGE_COLOR_YELLOW);
    expect(contextColor(0.66)).toBe(CONTEXT_GAUGE_COLOR_YELLOW);
    expect(contextColor(0.67)).toBe(CONTEXT_GAUGE_COLOR_RED);
  });
});

describe('contextLeft', () => {
  it('is the share left, never below empty', () => {
    expect(contextLeft(0)).toBe(1);
    expect(contextLeft(0.25)).toBe(0.75);
    expect(contextLeft(1)).toBe(0);
    expect(contextLeft(1.2)).toBe(0);
  });
});
