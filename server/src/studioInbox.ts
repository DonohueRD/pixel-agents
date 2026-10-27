/**
 * Polls the studio inbox (the rinkside-ops dashboard) and hands each snapshot
 * to the office. Runs in the host (extension host or standalone server), not the
 * webview: the dashboard sends no CORS headers, so a webview origin cannot read it.
 */

export interface StudioInboxItem {
  id: number;
  type: string;
  title: string;
  who?: string;
  dept?: string;
  t: string;
}

/** Override with PIXEL_AGENTS_INBOX_URL (e.g. for a dashboard on another host). */
const DEFAULT_INBOX_URL = 'http://hueyserver:8099';
const POLL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 5_000;

let lastSnapshot: StudioInboxItem[] | null = null;

/** Most recent poll result, so a newly connected client needn't wait for the next tick. */
export const getLastInboxSnapshot = (): StudioInboxItem[] | null => lastSnapshot;

type RawEvent = Record<string, unknown>;

const pickString = (event: RawEvent, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = event[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
};

const toItem = (event: RawEvent): StudioInboxItem | null => {
  if (typeof event.id !== 'number' || typeof event.type !== 'string') return null;
  const ticket = pickString(event, ['ticket']);
  const title =
    pickString(event, ['title', 'summary', 'text', 'message', 'subject']) ?? ticket ?? event.type;
  return {
    id: event.id,
    type: event.type,
    title,
    who: pickString(event, ['who']),
    dept: pickString(event, ['dept']),
    t: pickString(event, ['t']) ?? '',
  };
};

/** Starts polling. `onSnapshot` gets every poll's result, empty lists included,
 *  so a reconnected webview gets the current state on the next tick. Returns a
 *  stop function. */
export function startStudioInboxPoller(onSnapshot: (items: StudioInboxItem[]) => void): () => void {
  const base = process.env.PIXEL_AGENTS_INBOX_URL ?? DEFAULT_INBOX_URL;
  let warned = false;

  const poll = async () => {
    try {
      // peek=1 leaves the CEO's cursor alone: the board shows what is unread,
      // and reading it here must not mark anything as seen.
      const res = await fetch(`${base}/api/inbox?peek=1`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { events?: RawEvent[] };
      const items = (body.events ?? []).map(toItem).filter((i): i is StudioInboxItem => i !== null);
      lastSnapshot = items;
      onSnapshot(items);
      warned = false;
    } catch (err) {
      // Dashboard offline is normal (the NAS sleeps); say so once, not every 30 s.
      if (!warned) {
        console.warn(`[Pixel Agents] studio inbox unavailable at ${base}:`, err);
        warned = true;
      }
    }
  };

  void poll();
  const timer = setInterval(() => void poll(), POLL_MS);
  return () => clearInterval(timer);
}
