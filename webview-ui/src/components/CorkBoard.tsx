import { useState } from 'react';

import { CORK_PIN_COLORS, CORK_PIN_FALLBACK_COLOR } from '../constants.js';
import type { StudioInboxItem } from '../hooks/useStudioInbox.js';
import { useStudioApprovals } from '../hooks/useStudioInbox.js';
import { transport } from '../transport/index.js';
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

type Decision = 'approved' | 'rejected' | 'changes';

function ApprovalNote({ approval }: { approval: ReturnType<typeof useStudioApprovals>[number] }) {
  const [reason, setReason] = useState('');
  const [sent, setSent] = useState(false);
  const decide = (decision: Decision) => {
    transport.send({ type: 'decideApproval', id: approval.id, decision, reason });
    setSent(true);
  };
  const needsReason = reason.trim().length === 0;
  const btn = 'px-2 py-1 text-xs border border-black/40 disabled:opacity-40';
  return (
    <li className="cork-note relative p-3 pt-5 shadow-pixel sm:col-span-2">
      <div className="text-xs uppercase tracking-wide text-black/60">
        Needs your approval{approval.dept ? ` · ${approval.dept}` : ''}
      </div>
      <div className="text-sm text-black mt-1 break-words">{approval.title}</div>
      {approval.evidence?.[0] && (
        <div className="text-xs text-black/60 mt-1 break-words line-clamp-3">
          {approval.evidence[0]}
        </div>
      )}
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (needed to reject or ask for changes)"
        className="w-full mt-2 px-2 py-1 text-xs text-black bg-white/60 border border-black/30"
      />
      <div className="flex gap-2 mt-2">
        <button disabled={sent} onClick={() => decide('approved')} className={btn}>
          Approve
        </button>
        <button disabled={sent || needsReason} onClick={() => decide('changes')} className={btn}>
          Changes
        </button>
        <button disabled={sent || needsReason} onClick={() => decide('rejected')} className={btn}>
          Reject
        </button>
      </div>
    </li>
  );
}

export function CorkBoard({ isOpen, onClose, items }: CorkBoardProps) {
  const approvals = useStudioApprovals();
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Cork board">
      <div className="w-[min(560px,90vw)] max-h-[60vh] overflow-y-auto">
        {items.length === 0 && approvals.length === 0 ? (
          <p className="text-text-muted p-4">Nothing waiting. The desk is clear.</p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-2">
            {approvals.map((approval) => (
              <ApprovalNote key={approval.id} approval={approval} />
            ))}
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
