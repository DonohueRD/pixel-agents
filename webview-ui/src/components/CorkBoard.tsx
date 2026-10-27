import { CORK_PIN_COLORS, CORK_PIN_FALLBACK_COLOR } from '../constants.js';
import type { StudioInboxItem } from '../hooks/useStudioInbox.js';
import { Modal } from './ui/Modal.js';

interface CorkBoardProps {
  isOpen: boolean;
  onClose: () => void;
  items: StudioInboxItem[];
}

const formatTime = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export function CorkBoard({ isOpen, onClose, items }: CorkBoardProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Cork board">
      <div className="w-[min(560px,90vw)] max-h-[60vh] overflow-y-auto">
        {items.length === 0 ? (
          <p className="text-text-muted p-4">Nothing waiting. The desk is clear.</p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-2">
            {items.map((item) => (
              <li key={item.id} className="cork-note relative p-3 pt-5 shadow-pixel">
                <span
                  aria-hidden
                  className="absolute -top-2 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full border border-black/40"
                  style={{ background: CORK_PIN_COLORS[item.type] ?? CORK_PIN_FALLBACK_COLOR }}
                />
                <div className="text-xs uppercase tracking-wide text-black/60">
                  {item.dept ?? item.type}
                  {item.who ? ` · ${item.who}` : ''}
                </div>
                <div className="text-sm text-black mt-1 break-words">{item.title}</div>
                <div className="text-xs text-black/50 mt-2">{formatTime(item.t)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
