import type { MouseEvent as ReactMouseEvent } from 'react';
import { useEffect, useState } from 'react';

import {
  CONVERSATION_SIDEBAR_CLOSE_EASE,
  CONVERSATION_SIDEBAR_CLOSE_MS,
  CONVERSATION_SIDEBAR_CONTENT_DELAY_MS,
  CONVERSATION_SIDEBAR_CONTENT_SHIFT_PX,
  CONVERSATION_SIDEBAR_OPEN_EASE,
  CONVERSATION_SIDEBAR_OPEN_MS,
  TERMINAL_DRAWER_RESIZE_HANDLE_PX,
} from '../constants.js';
import { prefersReducedMotion } from '../hooks/usePresence.js';
import type { TerminalConnectionStatus } from '../terminal/terminalClient.js';
import { TerminalPaneStack } from './TerminalPaneStack.js';

interface TerminalDrawerProps {
  /** Agent ids with a live PTY, in open order. */
  agentIds: number[];
  /** The pane showing (useTerminalDrawer's resolution). */
  shownAgentId: number | null;
  isOpen: boolean;
  /** Open width in px (user-resizable). Ignored while collapsed. */
  widthPx: number;
  /** Mousedown on the left-edge drag handle; App owns the resize gesture. */
  onResizeStart: (e: ReactMouseEvent) => void;
  onStatusChange: (agentId: number, status: TerminalConnectionStatus | null) => void;
}

/**
 * Right-docked panel hosting one xterm tab per launched agent.
 *
 * Standalone only — App gates rendering on terminalAvailable, which the server
 * only ever reports over the WebSocket transport. VS Code keeps using its own
 * terminal panel.
 *
 * App draws the agent-card bar (AgentCardBar) just before it, over the
 * office's right edge; the panel opens to the bar's right. The cards double as
 * its tabs — clicking one selects that agent's pane — so the panel itself is
 * pure terminal with no chrome of its own beyond the resize handle; the
 * ribbon that hides it is the card bar's last item (TerminalHideRibbon).
 */
export function TerminalDrawer({
  agentIds,
  shownAgentId,
  isOpen,
  widthPx,
  onResizeStart,
  onStatusChange,
}: TerminalDrawerProps) {
  // The conversation sidebar's motion, mirrored to the right edge: `shown`
  // is the width target, `rendered` keeps the panes laid out (display:none
  // once shut — never unmounted: that would drop each xterm's scrollback and
  // force a reconnect on every toggle), `animating` says the width moves
  // with a transition — only while opening or closing, so a drag-resize or a
  // window resize follows the pointer instead of easing behind it.
  const [rendered, setRendered] = useState(false);
  const [shown, setShown] = useState(false);
  const [animating, setAnimating] = useState(false);
  const instant = prefersReducedMotion();

  useEffect(() => {
    if (isOpen) {
      setRendered(true);
      if (instant) {
        setShown(true);
        return;
      }
      setAnimating(true);
      // One frame at width 0 first, or there is nothing to animate from.
      let second = 0;
      const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => setShown(true));
      });
      return () => {
        cancelAnimationFrame(first);
        cancelAnimationFrame(second);
      };
    }
    setShown(false);
    if (instant) {
      setRendered(false);
      return;
    }
    setAnimating(true);
    // onTransitionEnd hides it when the slide ends; this is the backstop for
    // a transition that never runs (a hidden tab), not the timing.
    const timer = setTimeout(() => {
      setRendered(false);
      setAnimating(false);
    }, CONVERSATION_SIDEBAR_CLOSE_MS * 2);
    return () => clearTimeout(timer);
  }, [isOpen, instant]);

  if (agentIds.length === 0) return null;

  const width = !animating
    ? 'none'
    : shown
      ? `width ${CONVERSATION_SIDEBAR_OPEN_MS}ms ${CONVERSATION_SIDEBAR_OPEN_EASE}`
      : `width ${CONVERSATION_SIDEBAR_CLOSE_MS}ms ${CONVERSATION_SIDEBAR_CLOSE_EASE}`;
  const content =
    instant || !animating
      ? 'none'
      : shown
        ? `transform ${CONVERSATION_SIDEBAR_OPEN_MS}ms ${CONVERSATION_SIDEBAR_OPEN_EASE} ${CONVERSATION_SIDEBAR_CONTENT_DELAY_MS}ms, opacity ${CONVERSATION_SIDEBAR_OPEN_MS}ms ease-out ${CONVERSATION_SIDEBAR_CONTENT_DELAY_MS}ms`
        : `transform ${CONVERSATION_SIDEBAR_CLOSE_MS}ms ease-in, opacity ${CONVERSATION_SIDEBAR_CLOSE_MS / 2}ms ease-in`;

  return (
    // Opens to the right of the card bar (whose last item is the hide
    // ribbon, TerminalHideRibbon). The inner box animates its width and clips, with the panel pinned to its
    // left at its full width, so the panel slides out from behind the right
    // edge without the terminal re-fitting every frame. The overshoot shows
    // as a little more of the panel's background.
    <div className={`h-full shrink-0 ${rendered ? 'flex' : 'hidden'}`}>
      <div
        className="h-full flex justify-start overflow-hidden bg-bg border-l-2 border-border"
        style={{ width: shown ? widthPx : 0, transition: width }}
        onTransitionEnd={(e) => {
          if (e.target !== e.currentTarget || e.propertyName !== 'width') return;
          setAnimating(false);
          if (!isOpen) setRendered(false);
        }}
      >
        <div
          className="relative h-full shrink-0 flex flex-col"
          style={{
            // The clip box's 2px border is inside widthPx.
            width: widthPx - 2,
            transform: shown ? 'none' : `translateX(${CONVERSATION_SIDEBAR_CONTENT_SHIFT_PX}px)`,
            opacity: shown ? 1 : 0,
            transition: content,
          }}
        >
          {/* Drag handle over the left edge. App owns the gesture so it can
              resize the office region in lockstep. */}
          <div
            className="absolute top-0 left-0 bottom-0 z-40 cursor-col-resize hover:bg-accent"
            style={{ width: TERMINAL_DRAWER_RESIZE_HANDLE_PX }}
            onMouseDown={onResizeStart}
            title="Drag to resize"
          />

          <div className="relative flex-1 min-h-0 p-4">
            <TerminalPaneStack
              agentIds={agentIds}
              shownAgentId={shownAgentId}
              onStatusChange={onStatusChange}
              paneClassName="inset-4"
              keepHidden
            />
          </div>
        </div>
      </div>
    </div>
  );
}
