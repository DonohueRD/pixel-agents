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

export interface StudioApproval {
  id: string;
  title: string;
  dept?: string;
  who?: string;
  evidence?: string[];
  rollback?: string;
}

export interface StudioSnapshot {
  items: StudioInboxItem[];
  approvals: StudioApproval[];
}

let lastSnapshot: StudioSnapshot | null = null;
let pollNow: (() => Promise<void>) | null = null;

/** Most recent poll result, so a newly connected client needn't wait for the next tick. */
export const getLastInboxSnapshot = (): StudioSnapshot | null => lastSnapshot;

const inboxBase = (): string => process.env.PIXEL_AGENTS_INBOX_URL ?? DEFAULT_INBOX_URL;

const toApproval = (raw: RawEvent): StudioApproval | null => {
  if (typeof raw.id !== 'string' || raw.status !== 'pending') return null;
  return {
    id: raw.id,
    title: pickString(raw, ['title']) ?? raw.id,
    dept: pickString(raw, ['dept']),
    who: pickString(raw, ['who']),
    evidence: Array.isArray(raw.evidence)
      ? raw.evidence.filter((e): e is string => typeof e === 'string')
      : undefined,
    rollback: pickString(raw, ['rollback']),
  };
};

/** Record the Chairman's decision on the dashboard, then refresh the feed. Throws with the dashboard's message on failure. */
export async function decideApproval(
  id: string,
  decision: 'approved' | 'rejected' | 'changes',
  reason?: string,
): Promise<void> {
  const res = await fetch(`${inboxBase()}/api/approvals/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify({ decision, reason: reason ?? '', who: 'chairman' }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  await pollNow?.();
}

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
export function startStudioInboxPoller(onSnapshot: (snapshot: StudioSnapshot) => void): () => void {
  const base = inboxBase();
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

      // Pending approvals live in the dashboard state, not the event inbox.
      let approvals: StudioApproval[] = [];
      try {
        const st = await fetch(`${base}/api/state`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (st.ok) {
          const state = (await st.json()) as { approvals?: RawEvent[] };
          approvals = (state.approvals ?? [])
            .map(toApproval)
            .filter((a): a is StudioApproval => a !== null);
        }
      } catch {
        /* approvals are best-effort; the inbox still shows */
      }

      lastSnapshot = { items, approvals };
      onSnapshot(lastSnapshot);
      warned = false;
    } catch (err) {
      // Dashboard offline is normal (the NAS sleeps); say so once, not every 30 s.
      if (!warned) {
        console.warn(`[Pixel Agents] studio inbox unavailable at ${base}:`, err);
        warned = true;
      }
    }
  };

  pollNow = poll;
  void poll();
  const timer = setInterval(() => void poll(), POLL_MS);
  return () => {
    clearInterval(timer);
    if (pollNow === poll) pollNow = null;
  };
}
