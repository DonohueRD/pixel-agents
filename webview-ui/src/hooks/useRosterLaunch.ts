import { useEffect, useRef, useState } from 'react';

import { castStore, useCast } from '../characters/castStore.js';
import { characterLabel, newProfile } from '../characters/profiles.js';
import type { RosterPick } from '../components/LaunchDrawer.js';

interface RosterLaunchInputs {
  /** Whether agents can be launched here; when not, a pick edits instead. */
  canLaunch: boolean;
  /** Opens the Characters view (on the cast's current character). */
  onOpenCharacters?: () => void;
  /** Whether the launch button's Directory drawer is open. */
  isDrawerOpen: boolean;
  openDrawer: () => void;
}

/**
 * The roster's launch flow, shared by the phone's card bar and the desktop
 * toolbar: the Agents button opens the roster; a pick closes it and opens
 * the launch drawer, whose launch then wears that character (`palette`,
 * forgotten when the drawer closes); editing and `+ New` open the Characters
 * view on that character. A press outside the roster (and its button) or
 * Escape closes it.
 */
export function useRosterLaunch({
  canLaunch,
  onOpenCharacters,
  isDrawerOpen,
  openDrawer,
}: RosterLaunchInputs) {
  const cast = useCast();
  const [isRosterOpen, setIsRosterOpen] = useState(false);
  const [palette, setPalette] = useState<number | null>(null);
  const rosterRef = useRef<HTMLDivElement>(null);
  /** The Agents button: its own press toggles, so it is not "outside". */
  const buttonRef = useRef<HTMLButtonElement>(null);

  // The pick only stands for the drawer it opened, and the two never show
  // together (desktop's drawer also opens on hover).
  useEffect(() => {
    if (isDrawerOpen) setIsRosterOpen(false);
    else setPalette(null);
  }, [isDrawerOpen]);

  useEffect(() => {
    if (!isRosterOpen) return;
    const inside = (target: EventTarget | null) =>
      target instanceof Node &&
      (rosterRef.current?.contains(target) || buttonRef.current?.contains(target));
    const handlePress = (e: PointerEvent) => {
      if (!inside(e.target)) setIsRosterOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsRosterOpen(false);
    };
    document.addEventListener('pointerdown', handlePress);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handlePress);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isRosterOpen]);

  const edit = (index: number) => {
    setIsRosterOpen(false);
    castStore.select(index);
    onOpenCharacters?.();
  };

  return {
    isRosterOpen,
    setRosterOpen: setIsRosterOpen,
    rosterRef,
    buttonRef,
    /** The pick the open drawer is asking a Directory for, if any (LaunchDrawer's `pick`). */
    pendingPick:
      palette !== null
        ? ({
            palette,
            heading: `Launch ${characterLabel(cast.profiles[palette], palette)} in`,
          } satisfies RosterPick)
        : undefined,
    /** Forget the pick (a plain launch-button press). */
    clearPick: () => setPalette(null),
    pick: (index: number) => {
      setIsRosterOpen(false);
      // Nowhere to launch: the pick can only mean editing it.
      if (!canLaunch) {
        edit(index);
        return;
      }
      // The launch it leads to moves it to the front of every office's
      // roster (the server records it).
      setPalette(index);
      openDrawer();
    },
    edit,
    addNew: () => {
      setIsRosterOpen(false);
      // add() selects the new character, so the view opens on it.
      if (castStore.add([newProfile()])) onOpenCharacters?.();
    },
  };
}
