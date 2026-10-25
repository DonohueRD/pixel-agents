/**
 * The cast: the character profiles agents are drawn from, as one store shared by the office
 * (which wears them, see officeSprites.ts) and the Characters view (which edits them).
 * DOM- and transport-free: castStore.ts wires the app's instance to the server.
 *
 * Editing works on a draft: the Characters view changes a working copy of the list, and
 * the office (and every other reader of `profiles`) keeps the saved one until the view
 * saves. A draft opens on the first change, select or add; it is dirty once it differs
 * from the list it started from (or was last saved as); save() sends it, discard() drops it.
 *
 * Sync with the server: a save sends the whole list under a fresh saveId, and the server
 * answers each save with characterProfilesLoaded carrying it, in order. An answer acks its save and every older one. While a save is in flight or pending,
 * other lists are stale (processed before ours, or about to be overwritten by it: last
 * writer wins) and are ignored; otherwise the server's list wins, and replaces ours (and the
 * undo history that led to it) when it differs. A refused save is answered with the list on
 * disk, so the view shows the truth.
 *
 * The custom wardrobe items (parts saved from the pixel editor) travel with the profiles:
 * they open with the draft, step with its undo history, and are sent with it on Save.
 */

import type { CharacterProfile } from '../../../core/src/characterProfiles.js';
import {
  MAX_CHARACTER_PROFILES,
  newCharacterId,
  pixId,
} from '../../../core/src/characterProfiles.js';
import type { WardrobeItem } from '../../../core/src/wardrobeItems.js';
import { CAST_HISTORY } from '../constants.js';
import { History } from './history.js';
import type { CharacterRenderer } from './renderer.js';

interface Snapshot {
  profiles: readonly CharacterProfile[];
  items: readonly WardrobeItem[];
  current: number;
}

export interface CastState {
  /** The saved list: what the office wears. */
  profiles: readonly CharacterProfile[];
  /** The Characters view's working copy, while one is open. */
  draft: readonly CharacterProfile[] | null;
  /** The saved custom wardrobe items. */
  items: readonly WardrobeItem[];
  /** The draft's items, while a draft is open. */
  draftItems: readonly WardrobeItem[] | null;
  /** The draft has changes the saved list doesn't. */
  dirty: boolean;
  /** The character being edited (an index into the draft, or the list when none). */
  current: number;
  /** Null until the wardrobe art is decoded. */
  renderer: CharacterRenderer | null;
  canUndo: boolean;
  canRedo: boolean;
}

export interface CastDeps {
  /** Send the list (and the items) to the server under `saveId`. */
  save: (profiles: CharacterProfile[], saveId: string, items: WardrobeItem[]) => void;
  /** Milliseconds, for grouping undo steps. */
  now?: () => number;
}

/** A save's id. Not crypto.randomUUID(): undefined on plain-http LAN origins (no secure context). */
const newSaveId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const sameList = (a: readonly unknown[], b: readonly unknown[]) =>
  a === b || JSON.stringify(a) === JSON.stringify(b);

export class CastStore {
  private state: CastState = {
    profiles: [],
    draft: null,
    items: [],
    draftItems: null,
    dirty: false,
    current: 0,
    renderer: null,
    canUndo: false,
    canRedo: false,
  };
  private readonly listeners = new Set<() => void>();
  private readonly history = new History<Snapshot>(CAST_HISTORY);
  /** Saves sent and not yet answered, oldest first. */
  private inFlight: string[] = [];
  /** What the open draft started from (or was last saved as): undoing back to it is clean. */
  private base: readonly CharacterProfile[] | null = null;
  private baseItems: readonly WardrobeItem[] | null = null;
  private readonly deps: CastDeps;

  constructor(deps: CastDeps) {
    this.deps = deps;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = () => this.state;

  private set(patch: Partial<CastState>): void {
    const draft = patch.draft !== undefined ? patch.draft : this.state.draft;
    const draftItems = patch.draftItems !== undefined ? patch.draftItems : this.state.draftItems;
    this.state = {
      ...this.state,
      ...patch,
      dirty: !!draft && (draft !== this.base || draftItems !== this.baseItems),
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
    };
    for (const listener of this.listeners) listener();
  }

  setRenderer(renderer: CharacterRenderer): void {
    this.set({ renderer });
  }

  // ── From the server ──────────────────────────────────────

  /**
   * A characterProfilesLoaded: the saved list (null when it didn't validate), the saveId
   * it answers, if any, and the saved items (undefined: an older server, keep ours).
   */
  receiveProfiles(
    profiles: CharacterProfile[] | null,
    saveId?: string,
    items: readonly WardrobeItem[] = this.state.items,
  ): void {
    const acked = saveId ? this.inFlight.indexOf(saveId) : -1;
    if (acked >= 0) this.inFlight.splice(0, acked + 1);
    if (!profiles || this.inFlight.length) return;
    // our own echo
    if (sameList(profiles, this.state.profiles) && sameList(items, this.state.items)) return;
    if (this.state.draft && this.state.dirty) {
      // unsaved changes stay: saving them overwrites this list (last writer wins)
      this.set({ profiles, items });
      return;
    }
    this.history.clear();
    if (this.state.draft) {
      this.base = profiles;
      this.baseItems = items;
    }
    this.set({
      profiles,
      items,
      draft: this.state.draft ? profiles : null,
      draftItems: this.state.draft ? items : null,
      current: Math.min(this.state.current, Math.max(0, profiles.length - 1)),
    });
  }

  /**
   * The connection came back: saves still in flight may never be answered, so send the
   * saved list again (the server's answers to the lost ones can't arrive any more).
   */
  resendInFlight(): void {
    if (!this.inFlight.length) return;
    this.inFlight = [];
    this.send();
  }

  // ── Edits ────────────────────────────────────────────────

  /** A press began (pointer down in the view): the next change starts an undo step. */
  beginStep(): void {
    this.history.beginStep();
  }

  /** The press ended. */
  endStep(): void {
    this.history.endStep();
  }

  /** The list being edited: the draft, opened from the saved list when there is none. */
  private editing(): readonly CharacterProfile[] {
    if (this.state.draft) return this.state.draft;
    this.base = this.state.profiles;
    this.baseItems = this.state.items;
    this.history.clear();
    this.state = { ...this.state, draft: this.state.profiles, draftItems: this.state.items };
    return this.state.profiles;
  }

  /** The items being edited (the draft's). */
  private editingItems(): readonly WardrobeItem[] {
    this.editing();
    return this.state.draftItems ?? this.state.items;
  }

  select(index: number): void {
    const list = this.editing();
    if (index < 0 || index >= list.length) return;
    this.set({ current: index });
  }

  /** Change the current profile through a draft copy. `frame`: the editor frame, for undo. */
  update(change: (draft: CharacterProfile) => void, frame: number | null = null): void {
    this.updateAt(this.state.current, change, frame);
  }

  updateAt(index: number, change: (draft: CharacterProfile) => void, frame: number | null = null) {
    const list = this.editing();
    const draft = structuredClone(list[index]);
    if (!draft) return;
    change(draft);
    const profiles = [...list];
    profiles[index] = draft;
    this.commit({ profiles, items: this.editingItems(), current: this.state.current }, frame);
  }

  /**
   * Add a custom item, and change the current profile in the same undo step (to wear it).
   * False when the wardrobe already holds MAX items.
   */
  addItem(item: WardrobeItem, change: (draft: CharacterProfile) => void, max: number): boolean {
    const items = this.editingItems();
    if (items.length >= max) return false;
    const list = this.editing();
    const draft = structuredClone(list[this.state.current]);
    if (!draft) return false;
    change(draft);
    const profiles = [...list];
    profiles[this.state.current] = draft;
    this.commit({ profiles, items: [...items, item], current: this.state.current });
    return true;
  }

  /** Delete a custom item: every character wearing it takes it off (and loses its edits on it). */
  removeItem(id: string): void {
    const items = this.editingItems();
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const slot = item.piece as keyof CharacterProfile;
    const editKey = pixId(item.piece, id);
    const profiles = this.editing().map((p) => {
      if (p[slot] !== id && !p.edits?.[editKey]) return p;
      const copy = structuredClone(p);
      if (copy[slot] === id) delete copy[slot];
      if (copy.edits) delete copy.edits[editKey];
      return copy;
    });
    this.commit({
      profiles,
      items: items.filter((i) => i !== item),
      current: this.state.current,
    });
  }

  /**
   * Insert profiles (at the end by default) and select the last one added. Each gets a new
   * id (a duplicate or a loaded config carries someone else's). The cast holds at most
   * MAX_CHARACTER_PROFILES: returns how many fit (the rest are dropped).
   */
  add(added: CharacterProfile[], at?: number): number {
    const list = this.editing();
    at ??= list.length;
    const fits = added
      .slice(0, Math.max(0, MAX_CHARACTER_PROFILES - list.length))
      .map((p) => ({ ...p, id: newCharacterId() }));
    if (!fits.length) return 0;
    const profiles = [...list];
    profiles.splice(at, 0, ...fits);
    this.commit({ profiles, items: this.editingItems(), current: at + fits.length - 1 });
    return fits.length;
  }

  remove(index: number): void {
    const list = this.editing();
    if (list.length < 2) return;
    const profiles = list.filter((_, i) => i !== index);
    this.commit({
      profiles,
      items: this.editingItems(),
      current: Math.min(this.state.current, profiles.length - 1),
    });
  }

  private commit(next: Snapshot, frame: number | null = null): void {
    this.history.record(this.snapshot(), frame, this.now());
    this.set({ draft: next.profiles, draftItems: next.items, current: next.current });
  }

  /** Step back; returns the editor frame the undone change was made on. */
  undo(): number | null {
    return this.restore(this.history.undo(this.snapshot()));
  }

  redo(): number | null {
    return this.restore(this.history.redo(this.snapshot()));
  }

  private snapshot(): Snapshot {
    return {
      profiles: this.editing(),
      items: this.editingItems(),
      current: this.state.current,
    };
  }

  private restore(entry: { state: Snapshot; frame: number | null } | null): number | null {
    if (!entry) return null;
    const { profiles, items, current } = entry.state;
    this.set({
      draft: profiles,
      draftItems: items,
      current: Math.min(current, profiles.length - 1),
    });
    return entry.frame;
  }

  // ── Saving ───────────────────────────────────────────────

  /** Save the draft: it becomes the list the office wears, and is sent to the server. */
  save(): void {
    const { draft, draftItems } = this.state;
    if (!draft || !this.state.dirty) return;
    const items = draftItems ?? this.state.items;
    this.base = draft;
    this.baseItems = items;
    this.set({ profiles: draft, items });
    this.send();
  }

  /** Drop the draft and its history: the saved list stands. */
  discard(): void {
    if (!this.state.draft) return;
    this.base = null;
    this.baseItems = null;
    this.history.clear();
    const { profiles } = this.state;
    this.set({
      draft: null,
      draftItems: null,
      current: Math.min(this.state.current, Math.max(0, profiles.length - 1)),
    });
  }

  private send(): void {
    const saveId = newSaveId();
    this.inFlight.push(saveId);
    this.deps.save([...this.state.profiles], saveId, [...this.state.items]);
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : performance.now();
  }
}
