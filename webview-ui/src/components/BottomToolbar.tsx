import { useEffect, useRef, useState } from 'react';

import { ROSTER_ARROW_WIDTH_PX, ROSTER_HOVER_CLOSE_DELAY_MS } from '../constants.js';
import type { Directory } from '../hooks/useExtensionMessages.js';
import { popClass, usePresence } from '../hooks/usePresence.js';
import { useRosterLaunch } from '../hooks/useRosterLaunch.js';
import { isBrowserRuntime } from '../runtime.js';
import { CharacterRow } from './CharacterPicker.js';
import { LaunchDrawer } from './LaunchDrawer.js';
import { Button } from './ui/Button.js';
import { PixelIcon } from './ui/PixelIcon.js';

interface BottomToolbarProps {
  isEditMode: boolean;
  onToggleEditMode: () => void;
  isSettingsOpen: boolean;
  onToggleSettings: () => void;
  /** The Characters view is open (the button shows active). */
  isCharactersOpen: boolean;
  /** Opens the Characters view: editing a roster card, or its `+ New`. */
  onOpenCharacters: () => void;
  directories: Directory[];
  /** Drawer's pinned `+ Directory` row — opens the Directory modal empty. */
  onAddDirectory: () => void;
  /** Pencil on a user-defined row — opens the modal pre-filled. */
  onEditDirectory: (directory: Directory) => void;
  /** Standalone: server has a working PTY, so agents can be launched here. */
  terminalAvailable: boolean;
  /** Why the terminal is off (shown on the disabled button's tooltip). */
  terminalUnavailableReason: string | null;
  /** A Directory picked from the + drawer: launch into it (wearing `palette`
   *  when a character was picked first). */
  onLaunch: (directory: Directory, palette?: number) => void;
}

/** Every toolbar button's height: the labelled ones' natural height (26 px
 *  text + padding) rounded to whole pixels, so the + can be an exact square. */
const ROW_HEIGHT = 'h-52';
/** The + launch button: a square as tall as its row, the + centred (the
 *  phone's + card, MobileAgentBar). */
const LAUNCH_SQUARE = 'size-52 flex items-center justify-center border-2 rounded-none select-none';

export function BottomToolbar({
  isEditMode,
  onToggleEditMode,
  isSettingsOpen,
  onToggleSettings,
  isCharactersOpen,
  onOpenCharacters,
  directories,
  onAddDirectory,
  onEditDirectory,
  terminalAvailable,
  terminalUnavailableReason,
  onLaunch,
}: BottomToolbarProps) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const launchRef = useRef<HTMLDivElement>(null);

  // Close the launch drawer on outside press (the dropdown convention here)
  // or Escape.
  useEffect(() => {
    if (!isDrawerOpen) return;
    const handlePress = (e: PointerEvent) => {
      if (launchRef.current && !launchRef.current.contains(e.target as Node)) {
        setIsDrawerOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsDrawerOpen(false);
    };
    document.addEventListener('pointerdown', handlePress);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handlePress);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isDrawerOpen]);

  // A plain press never launches: it opens the drawer, and the launch happens
  // from a Directory row. Hovering opens it too, and leaving shuts it again;
  // a press pins it open until a press elsewhere, Escape, or a second press
  // on the + (the press that follows a hover pins rather than shuts).
  const drawerPinned = useRef(false);
  const handleAgentClick = () => {
    if (isDrawerOpen && drawerPinned.current) {
      setIsDrawerOpen(false);
      return;
    }
    drawerPinned.current = true;
    setIsDrawerOpen(true);
  };
  const hoverDrawer = () => {
    if (isDrawerOpen) return;
    drawerPinned.current = false;
    setIsDrawerOpen(true);
  };

  // Standalone can launch agents whenever the server has a working PTY. When it
  // doesn't, show the button disabled with the reason rather than hiding it —
  // silently missing UI reads as a bug, and the cause (a native module that
  // couldn't install) is not something a user would otherwise ever discover.
  const canLaunch = !isBrowserRuntime || terminalAvailable;
  const showUnavailable = isBrowserRuntime && !terminalAvailable;

  // The arrow beside the + opens the roster above the toolbar: a pick opens the + button's
  // drawer for that character (the phone's flow, minus the slide).
  const roster = useRosterLaunch({
    canLaunch,
    onOpenCharacters,
    isDrawerOpen,
    openDrawer: () => setIsDrawerOpen(true),
  });

  const handleDirectorySelect = (directory: Directory, palette?: number) => {
    setIsDrawerOpen(false);
    onLaunch(directory, palette);
  };

  const rosterPanel = usePresence(roster.isRosterOpen);

  // Hovering the arrow opens the roster, as hovering the + opens its drawer;
  // it shuts a moment after the pointer leaves both the arrow and the roster.
  // A press pins it open (the press that follows a hover must not shut it),
  // and a second press shuts it.
  const rosterPinned = useRef(false);
  const rosterCloseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keepRoster = () => clearTimeout(rosterCloseTimer.current);
  const leaveRoster = () => {
    keepRoster();
    if (rosterPinned.current) return;
    rosterCloseTimer.current = setTimeout(
      () => roster.setRosterOpen(false),
      ROSTER_HOVER_CLOSE_DELAY_MS,
    );
  };
  const hoverRoster = () => {
    keepRoster();
    if (roster.isRosterOpen) return;
    rosterPinned.current = false;
    setIsDrawerOpen(false);
    roster.setRosterOpen(true);
  };
  const pressRoster = () => {
    keepRoster();
    setIsDrawerOpen(false);
    if (roster.isRosterOpen && rosterPinned.current) {
      roster.setRosterOpen(false);
      return;
    }
    rosterPinned.current = true;
    roster.setRosterOpen(true);
  };
  useEffect(() => () => clearTimeout(rosterCloseTimer.current), []);

  return (
    // Bottom-left. The terminal panel docks on the right edge, so it never
    // reaches these buttons and no lift is needed. The column spans the
    // office so the roster above the toolbar can use its width; it passes
    // presses through everywhere but its panels.
    <div className="absolute left-10 right-10 bottom-10 z-20 flex flex-col items-start gap-4 pointer-events-none">
      {rosterPanel.mounted && (
        <div
          ref={roster.rosterRef}
          data-testid="character-picker"
          className={`pointer-events-auto max-w-full pixel-panel p-4 ${popClass(rosterPanel.closing)}`}
          onMouseEnter={keepRoster}
          onMouseLeave={leaveRoster}
        >
          <CharacterRow
            onPick={roster.pick}
            onEdit={roster.edit}
            onNew={roster.addNew}
            isOpen={roster.isRosterOpen}
            // A scrollbar above and below the cards, drawn like the sidebar's.
            className="quiet-scrollbar-x pb-4"
            edgeScrollbars={{ rowClassName: 'fade-stagger' }}
          />
        </div>
      )}
      <div className="pointer-events-auto flex items-center gap-4 pixel-panel p-4">
        {/* The + and, right of it, the roster's arrow: one card, two buttons,
            as on the phone's bar. The arrow points up while the roster is
            shut and turns down while it is open; a press toggles it. */}
        <div className="flex shrink-0">
          {showUnavailable && (
            <button
              type="button"
              disabled
              title={terminalUnavailableReason ?? 'Terminal unavailable on this server.'}
              aria-label="New agent"
              className={`${LAUNCH_SQUARE} bg-btn-bg border-border text-text-muted cursor-default opacity-(--btn-disabled-opacity)`}
            >
              <PixelIcon name="plus" />
            </button>
          )}
          {canLaunch && (
            <div
              ref={launchRef}
              className="relative"
              // Hover is the desktop secondary gesture (long-press is the mobile
              // one): it opens the drawer without committing to a launch.
              onMouseEnter={hoverDrawer}
              // A drawer the roster opened is a question waiting for an answer
              // (where to launch the picked character): the pointer wandering
              // off doesn't cancel it, only a press outside or Escape does.
              onMouseLeave={() => {
                if (!roster.pendingPick && !drawerPinned.current) setIsDrawerOpen(false);
              }}
            >
              <button
                type="button"
                onClick={handleAgentClick}
                aria-label="New agent"
                title="Launch agent"
                className={`${LAUNCH_SQUARE} press-juice border-accent text-white cursor-pointer ${isDrawerOpen ? 'bg-accent-bright' : 'bg-accent hover:bg-accent-bright'}`}
              >
                {/* A quarter turn while its drawer is open (a + looks the
                    same either way, so it rests crisp). */}
                <span
                  className={`flex transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${isDrawerOpen ? 'rotate-90' : ''}`}
                >
                  <PixelIcon name="plus" />
                </span>
              </button>
              <LaunchDrawer
                isOpen={isDrawerOpen}
                directories={directories}
                pick={roster.pendingPick}
                onSelect={handleDirectorySelect}
                onAddDirectory={() => {
                  setIsDrawerOpen(false);
                  onAddDirectory();
                }}
                onEditDirectory={(directory) => {
                  setIsDrawerOpen(false);
                  onEditDirectory(directory);
                }}
              />
            </div>
          )}
          <button
            ref={roster.buttonRef}
            type="button"
            onClick={pressRoster}
            onMouseEnter={hoverRoster}
            onMouseLeave={leaveRoster}
            aria-label="Roster"
            aria-expanded={roster.isRosterOpen}
            title={
              roster.isRosterOpen
                ? 'Hide roster'
                : 'Launch an agent as one of your characters, or edit them'
            }
            // Enabled even when nothing can launch: a pick then edits.
            style={{ width: ROSTER_ARROW_WIDTH_PX }}
            className={`h-52 press-juice flex items-center justify-center border-2 border-l-bg/40 rounded-none select-none cursor-pointer ${
              canLaunch
                ? `border-accent text-white ${roster.isRosterOpen || isCharactersOpen ? 'bg-accent-bright' : 'bg-accent hover:bg-accent-bright'}`
                : 'bg-btn-bg border-border text-text-muted'
            }`}
          >
            <span
              className={`flex transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${roster.isRosterOpen ? '' : 'rotate-180'}`}
            >
              <PixelIcon name="down" scale={1} />
            </span>
          </button>
        </div>
        <Button
          variant={isEditMode ? 'active' : 'default'}
          onClick={onToggleEditMode}
          title="Edit office layout"
          className={`${ROW_HEIGHT} press-juice`}
          icon="layout"
        >
          Layout
        </Button>
        <Button
          variant={isSettingsOpen ? 'active' : 'default'}
          onClick={onToggleSettings}
          title="Settings"
          className={`${ROW_HEIGHT} press-juice`}
          icon="settings"
        >
          Settings
        </Button>
      </div>
    </div>
  );
}
