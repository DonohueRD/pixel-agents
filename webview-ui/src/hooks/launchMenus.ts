/**
 * The launch button's two menus as one pure state (useRosterLaunch drives it):
 * which menu is open (never both) and the roster pick the drawer is asking a
 * Directory for. DOM- and React-free, so the rules are Node-tested.
 */

/** Which of the launch button's two menus is open: never both. */
export type LaunchMenu = 'none' | 'drawer' | 'roster';

export interface LaunchMenusState {
  menu: LaunchMenu;
  /** The roster pick the open drawer is asking a Directory for (a palette
   *  index), or null; forgotten once the drawer shuts. */
  palette: number | null;
}

export const LAUNCH_MENUS_CLOSED: LaunchMenusState = { menu: 'none', palette: null };

export type LaunchMenusAction =
  /** The launch button (both shells): the plain drawer, any pick dropped. */
  | { type: 'openDrawer' }
  /** A roster pick: the drawer, asking where to launch that character. */
  | { type: 'pick'; palette: number }
  | { type: 'openRoster' }
  | { type: 'toggleRoster' }
  /** Shut `which` if it is the open one; the other menu is left alone. */
  | { type: 'close'; which: Exclude<LaunchMenu, 'none'> };

/** `menu` open instead; a pick only stands for the drawer it opened. */
const show = (state: LaunchMenusState, menu: LaunchMenu): LaunchMenusState =>
  menu === state.menu ? state : { menu, palette: menu === 'drawer' ? state.palette : null };

export function launchMenusReducer(
  state: LaunchMenusState,
  action: LaunchMenusAction,
): LaunchMenusState {
  switch (action.type) {
    case 'openDrawer':
      return state.menu === 'drawer' && state.palette === null
        ? state
        : { menu: 'drawer', palette: null };
    case 'pick':
      return { menu: 'drawer', palette: action.palette };
    case 'openRoster':
      return show(state, 'roster');
    case 'toggleRoster':
      return show(state, state.menu === 'roster' ? 'none' : 'roster');
    case 'close':
      return state.menu === action.which ? show(state, 'none') : state;
  }
}
