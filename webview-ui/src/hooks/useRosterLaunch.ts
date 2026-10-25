import { useEffect, useRef, useState } from 'react';

import { castStore, useCast } from '../characters/castStore.js';
import { characterLabel, newProfile } from '../characters/profiles.js';
import type { RosterPick } from '../components/LaunchDrawer.js';

/** Which of the launch button's two menus is open: never both. */
type LaunchMenu = 'none' | 'drawer' | 'roster';

/** Shut `which` if it is the open one; the other menu is left alone. */
const shut =
  (which: Exclude<LaunchMenu, 'none'>) =>
  (menu: LaunchMenu): LaunchMenu =>
    menu === which ? 'none' : menu;

interface RosterLaunchInputs {
  /** Whether agents can be launched here; when not, a pick edits instead. */
  canLaunch: boolean;
  /** Opens the Characters view (on the cast's current character). Absent
   *  hides the roster arrow, and takes an open roster with it. */
  onOpenCharacters?: () => void;
  /**
   * What the launch button does to a roster pick when it opens (or re-opens)
   * the drawer. Desktop keeps it: a + press over a drawer the pick opened pins
   * that drawer, still asking where to launch the pick. The phone drops it:
   * its + always opens the plain drawer. A per-shell choice, kept as it shipped.
   */
  launchButtonKeepsPick: boolean;
  /** Whether Escape closes the drawer (desktop yes; the phone's drawer has
   *  no Escape). Escape always closes the roster. */
  escapeClosesDrawer: boolean;
}

/**
 * The launch button's menus, shared by the phone's card bar and the desktop
 * toolbar: its Directory drawer and, behind the roster arrow, the roster. At
 * most one is open. A pick closes the roster and opens the drawer, whose
 * launch then wears that character (`palette`, forgotten once the drawer
 * closes); editing and `+ New` open the Characters view on that character.
 * A press outside the open menu closes it (the drawer's boundary is
 * `launchRef`, the shell's launch button wrapper; the roster's is the roster
 * and its arrow), and so does Escape (the drawer's only where
 * `escapeClosesDrawer`).
 */
export function useRosterLaunch({
  canLaunch,
  onOpenCharacters,
  launchButtonKeepsPick,
  escapeClosesDrawer,
}: RosterLaunchInputs) {
  const cast = useCast();
  const [menu, setMenu] = useState<LaunchMenu>('none');
  const [palette, setPalette] = useState<number | null>(null);
  const rosterRef = useRef<HTMLDivElement>(null);
  /** The roster arrow: its own press toggles, so it is not "outside". */
  const buttonRef = useRef<HTMLButtonElement>(null);
  /** The launch button and its drawer: a press outside closes the drawer. */
  const launchRef = useRef<HTMLDivElement>(null);

  // The pick only stands for the drawer it opened: forgotten the render after
  // the drawer shuts.
  useEffect(() => {
    if (menu !== 'drawer') setPalette(null);
  }, [menu]);

  // The arrow goes away (no Characters view to edit in); take the roster with it.
  useEffect(() => {
    if (!onOpenCharacters) setMenu(shut('roster'));
  }, [onOpenCharacters]);

  useEffect(() => {
    if (menu === 'none') return;
    const close = () => setMenu(shut(menu));
    const outside = (target: EventTarget | null) =>
      menu === 'drawer'
        ? !!launchRef.current && !launchRef.current.contains(target as Node)
        : !(
            target instanceof Node &&
            (rosterRef.current?.contains(target) || buttonRef.current?.contains(target))
          );
    const handlePress = (e: PointerEvent) => {
      if (outside(e.target)) close();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (menu === 'roster' || escapeClosesDrawer)) close();
    };
    document.addEventListener('pointerdown', handlePress);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handlePress);
      document.removeEventListener('keydown', handleKey);
    };
  }, [menu, escapeClosesDrawer]);

  const closeRoster = () => setMenu(shut('roster'));
  const edit = (index: number) => {
    closeRoster();
    castStore.select(index);
    onOpenCharacters?.();
  };

  return {
    isDrawerOpen: menu === 'drawer',
    isRosterOpen: menu === 'roster',
    rosterRef,
    buttonRef,
    launchRef,
    /** The pick the open drawer is asking a Directory for, if any (LaunchDrawer's `pick`). */
    pendingPick:
      palette !== null
        ? ({
            palette,
            heading: `Launch ${characterLabel(cast.profiles[palette], palette)} in`,
          } satisfies RosterPick)
        : undefined,
    /** The launch button (and desktop's hover over it): open the drawer, the
     *  pick kept or dropped as the shell chose (`launchButtonKeepsPick`). */
    openDrawer: () => {
      if (!launchButtonKeepsPick) setPalette(null);
      setMenu('drawer');
    },
    /** Shut the drawer (a launch, `+ Directory`, the pencil, the pointer leaving). */
    closeDrawer: () => setMenu(shut('drawer')),
    openRoster: () => setMenu('roster'),
    closeRoster,
    /** The phone's arrow: open the roster (shutting the drawer), or shut it. */
    toggleRoster: () => setMenu((m) => (m === 'roster' ? 'none' : 'roster')),
    pick: (index: number) => {
      // Nowhere to launch: the pick can only mean editing it.
      if (!canLaunch) {
        edit(index);
        return;
      }
      // The launch it leads to moves it to the front of every office's
      // roster (the server records it).
      setPalette(index);
      setMenu('drawer');
    },
    edit,
    addNew: () => {
      closeRoster();
      // add() selects the new character, so the view opens on it.
      if (castStore.add([newProfile()])) onOpenCharacters?.();
    },
  };
}
