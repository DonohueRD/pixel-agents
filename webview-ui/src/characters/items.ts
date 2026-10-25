/**
 * Wardrobe items as files and as new parts: one piece's sheet (its art plus the profile's
 * edits, uncoloured), read back as edits, or saved as a custom item every character can
 * wear. DOM-free; the view encodes and decodes the PNGs.
 */

import {
  type CharacterPixelEdits,
  type CharacterProfile,
  pixId,
} from '../../../core/src/characterProfiles.js';
import {
  isItemId,
  isItemPiece,
  type ItemPiece,
  type WardrobeItem,
} from '../../../core/src/wardrobeItems.js';
import type { CastState } from './cast.js';
import { rgbHex } from './color.js';
import type { CharacterRenderer } from './renderer.js';
import { cellAt, FRAME_COUNT, isOpaque } from './sheet.js';
import { editKey, layerOf, shownArt } from './slots.js';
import type { PartInfo } from './wardrobe.js';

const FRAME_PIXELS = 16 * 32;

/** A piece's sheet as this profile wears it, uncoloured (art plus edits); null when not worn. */
export function pieceSheet(
  r: CharacterRenderer,
  p: CharacterProfile,
  pix: string,
): Uint8ClampedArray | null {
  return r.layerBase(p, layerOf(pix))?.data ?? null;
}

/**
 * The edits that turn `base` (a piece's art) into `sheet`: every pixel that differs is
 * painted with the sheet's colour, or erased where the sheet is empty. Partly transparent
 * pixels count as solid (edits are opaque).
 */
export function editsFromSheet(
  base: Uint8ClampedArray | undefined,
  sheet: Uint8ClampedArray,
): CharacterPixelEdits {
  const cells: CharacterPixelEdits['cells'] = {};
  for (let f = 0; f < FRAME_COUNT; f++) {
    for (let i = 0; i < FRAME_PIXELS; i++) {
      const o = cellAt(f, i);
      const want = isOpaque(sheet[o + 3]) ? rgbHex(sheet[o], sheet[o + 1], sheet[o + 2]) : null;
      const has = base && isOpaque(base[o + 3]) ? rgbHex(base[o], base[o + 1], base[o + 2]) : null;
      if (want === has) continue;
      (cells[f] ??= {})[i] = want;
    }
  }
  return { cells };
}

/** Replace a piece's edits on a profile with the ones that make it look like `sheet`. */
export function importPieceSheet(
  r: CharacterRenderer,
  p: CharacterProfile,
  pix: string,
  sheet: Uint8ClampedArray,
): void {
  const art = shownArt(p, layerOf(pix));
  const edits = editsFromSheet(art ? r.wardrobe.art.get(art.path) : undefined, sheet);
  const key = editKey(p, pix);
  p.edits ??= {};
  if (Object.keys(edits.cells).length) p.edits[key] = edits;
  else delete p.edits[key];
}

/** The slot a piece can be saved from as an item, if any (hair, clothes, accessories). */
export const itemPieceOf = (pix: string): ItemPiece | null => (isItemPiece(pix) ? pix : null);

/** The built-in part a worn part stems from: itself, or a custom item's base. */
export function basePartOf(r: CharacterRenderer, piece: ItemPiece, id: string): string {
  if (!isItemId(id)) return id;
  return r.wardrobe.manifest.parts[piece]?.find((part) => part.id === id)?.base ?? id;
}

/** A fresh item id. Not crypto.randomUUID(): undefined on plain-http LAN origins. */
export const newItemId = (): string =>
  `custom_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * The item made from a profile's worn piece: its art and edits baked into one sheet (the
 * caller encodes `png`), started from the built-in part the worn one stems from.
 */
export function itemFrom(
  r: CharacterRenderer,
  p: CharacterProfile,
  piece: ItemPiece,
  label: string,
  png: string,
  id: string = newItemId(),
): WardrobeItem | null {
  const worn = p[piece];
  if (!worn) return null;
  return { id, piece, label: label.trim(), base: basePartOf(r, piece, worn), png };
}

/** Wear a new item in its slot; the edits that went into it leave the profile. */
export function wearNewItem(p: CharacterProfile, item: WardrobeItem): void {
  const piece = item.piece as ItemPiece;
  const worn = p[piece];
  if (worn && p.edits) delete p.edits[pixId(piece, worn)];
  p[piece] = item.id;
}

/**
 * The parts the Characters view offers in a slot: the built-in ones and the draft's items.
 * The renderer also holds saved items the draft deleted, since the office may still wear them.
 */
export function offeredParts(
  r: CharacterRenderer,
  cast: Pick<CastState, 'items' | 'draftItems'>,
  slot: string,
): PartInfo[] {
  const drafted = new Set((cast.draftItems ?? cast.items).map((i) => i.id));
  return (r.wardrobe.manifest.parts[slot] ?? []).filter((p) => !p.base || drafted.has(p.id));
}

/** A piece's name in the pixel editor: a custom item's own name, else the piece's. */
export function pieceName(r: CharacterRenderer, p: CharacterProfile, pix: string): string {
  const piece = itemPieceOf(pix);
  const worn = piece ? p[piece] : undefined;
  if (piece && isItemId(worn)) {
    const label = r.wardrobe.manifest.parts[piece]?.find((part) => part.id === worn)?.label;
    if (label) return label;
  }
  return layerOf(pix).label;
}
