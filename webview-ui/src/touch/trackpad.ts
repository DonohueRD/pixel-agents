/**
 * The key bar's trackpad key: press, hold and slide to send arrow keys, one
 * per `step` px of travel, retracing when the finger backs up. The first
 * axis to cover a full step wins the press: from then on only that axis
 * sends keys (both ways along it), so a sideways slide that drifts a little
 * up never jumps to the line above. Pure, for the Node test runner.
 */

export type TrackpadArrow = 'up' | 'down' | 'left' | 'right';

export interface TrackpadState {
  /** The locked axis; null until the finger has covered a full step. */
  axis: 'x' | 'y' | null;
  /** Steps already sent along each axis (signed: right / down positive). */
  sentX: number;
  sentY: number;
}

export const TRACKPAD_IDLE: TrackpadState = { axis: null, sentX: 0, sentY: 0 };

/** The arrows a finger now `dx`, `dy` px from where it pressed should send. */
export function trackpadMove(
  state: TrackpadState,
  dx: number,
  dy: number,
  step: number,
): { state: TrackpadState; keys: TrackpadArrow[] } {
  let axis = state.axis;
  if (axis === null) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) < step) return { state, keys: [] };
    axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
  }
  const keys: TrackpadArrow[] = [];
  let { sentX, sentY } = state;
  if (axis === 'x') {
    const target = Math.trunc(dx / step);
    for (; sentX < target; sentX++) keys.push('right');
    for (; sentX > target; sentX--) keys.push('left');
  } else {
    const target = Math.trunc(dy / step);
    for (; sentY < target; sentY++) keys.push('down');
    for (; sentY > target; sentY--) keys.push('up');
  }
  return { state: { axis, sentX, sentY }, keys };
}
