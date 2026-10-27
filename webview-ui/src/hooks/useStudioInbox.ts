import { useEffect, useSyncExternalStore } from 'react';

import type { ServerMessage } from '../../../core/src/messages.js';
import { transport } from '../transport/index.js';

type StudioInboxMessage = Extract<ServerMessage, { type: 'studioInboxUpdated' }>;
export type StudioInboxItem = StudioInboxMessage['items'][number];
export type StudioApproval = NonNullable<StudioInboxMessage['approvals']>[number];

// Module-level store: one feed, read by the Board and by every Head's dot.
let currentItems: StudioInboxItem[] = [];
let currentApprovals: StudioApproval[] = [];
const listeners = new Set<() => void>();

const subscribeItems = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const readItems = (): StudioInboxItem[] => currentItems;
const readApprovals = (): StudioApproval[] => currentApprovals;

/** Subscribes the store to the host's `studioInboxUpdated` feed. Call once, from the app root. */
export function useStudioInboxFeed(): void {
  useEffect(() => {
    return transport.onMessage((msg) => {
      if (msg.type !== 'studioInboxUpdated') return;
      // Each host message replaces the list, so an empty list clears the board.
      currentItems = msg.items;
      currentApprovals = msg.approvals ?? [];
      listeners.forEach((listener) => listener());
    });
  }, []);
}

/** Items waiting on the studio inbox. Re-renders when the host sends a new list. */
export function useStudioItems(): StudioInboxItem[] {
  return useSyncExternalStore(subscribeItems, readItems);
}

/** Chairman approvals still pending on the dashboard. */
export function useStudioApprovals(): StudioApproval[] {
  return useSyncExternalStore(subscribeItems, readApprovals);
}
