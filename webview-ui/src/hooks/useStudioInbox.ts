import { useEffect, useState } from 'react';

import type { ServerMessage } from '../../../core/src/messages.js';
import { transport } from '../transport/index.js';

type StudioInboxMessage = Extract<ServerMessage, { type: 'studioInboxUpdated' }>;
export type StudioInboxItem = StudioInboxMessage['items'][number];

/** Items waiting on the studio inbox, as last reported by the host. Each host
 *  message replaces the list, so an empty list clears the board. */
export function useStudioInbox(): StudioInboxItem[] {
  const [items, setItems] = useState<StudioInboxItem[]>([]);

  useEffect(() => {
    return transport.onMessage((msg) => {
      if (msg.type === 'studioInboxUpdated') {
        setItems(msg.items);
      }
    });
  }, []);

  return items;
}
