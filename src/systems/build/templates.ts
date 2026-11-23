import { bus, toast } from '../../core/events';
import { money } from '../../core/format';
import { session, type GameState } from '../../core/state';
import { FURNITURE } from '../../data';
import templatesJson from '../../data/templates.json';
import { footprint, type ShopState } from '../../entities/Shop';
import { assignSlot } from '../economy/stock';
import { readJson, writeJson } from '../save/storage';
import { buildCost, checkPlace, placeObject } from './build';
import { record, snapOf, type Op } from './history';

/**
 * Shop layouts that can be stamped onto another shop of the same kind: built-in starter
 * layouts, and ones the player saves. Saved templates are kept outside save games so they
 * carry over between companies.
 */
export interface TemplateItem {
  def: string;
  /** Tiles from the lot's back-left corner, for a lot facing south. */
  dx: number;
  dy: number;
  rot: number;
  products?: (string | null)[];
}

export interface Template {
  name: string;
  type: string;
  items: TemplateItem[];
  builtIn?: boolean;
}

const STORE_KEY = 'templates';
const BUILT_IN = templatesJson as unknown as Record<string, { name: string; items: TemplateItem[] }>;
let saved: Template[] = [];

export async function loadTemplates(): Promise<void> {
  saved = (await readJson<Template[]>(STORE_KEY)) ?? [];
}

export function templatesFor(type: string): Template[] {
  const starter = BUILT_IN[type];
  return [...(starter?.items ? [{ name: starter.name, type, items: starter.items, builtIn: true }] : []), ...saved.filter((t) => t.type === type)];
}

/** Where a template item lands on a particular lot (mirrored front to back if the lot faces north). */
function place(shop: ShopState, item: TemplateItem): { x: number; y: number; rot: number } {
  const lot = session.city.lots[shop.lotId];
  if (lot.front !== 'n') return { x: lot.x + item.dx, y: lot.y + item.dy, rot: item.rot };
  const rot = (item.rot + 2) % 4;
  const { w, h } = footprint(item.def, rot);
  return { x: lot.x + lot.w - item.dx - w, y: lot.y + lot.h - item.dy - h, rot };
}

/** Remember a shop's furniture and shelf assignments as a template. */
export function saveTemplate(shop: ShopState, name: string): Template {
  const lot = session.city.lots[shop.lotId];
  const items: TemplateItem[] = shop.objects
    .filter((o) => !FURNITURE[o.def].anywhere)
    .map((o) => {
      const { w, h } = footprint(o.def, o.rot);
      const south = lot.front !== 'n';
      return {
        def: o.def,
        dx: south ? o.x - lot.x : lot.x + lot.w - o.x - w,
        dy: south ? o.y - lot.y : lot.y + lot.h - o.y - h,
        rot: south ? o.rot : (o.rot + 2) % 4,
        products: o.slots?.map((sl) => sl.product),
      };
    });
  const t: Template = { name: name.trim() || `${shop.name} layout`, type: shop.type, items };
  saved = [...saved.filter((x) => !(x.type === t.type && x.name === t.name)), t];
  void writeJson(STORE_KEY, saved);
  toast(`Layout saved as "${t.name}" (${items.length} pieces).`, 'good');
  bus.emit('build:history', shop.id);
  return t;
}

export function deleteTemplate(t: Template): void {
  saved = saved.filter((x) => x !== t && !(x.type === t.type && x.name === t.name));
  void writeJson(STORE_KEY, saved);
}

/** What applying a template to this shop would build and cost, given what is already there. */
export function previewTemplate(s: GameState, shop: ShopState, t: Template): { fits: number; total: number; cost: number } {
  const lot = session.city.lots[shop.lotId];
  let fits = 0;
  let cost = 0;
  for (const item of t.items) {
    const p = place(shop, item);
    if (!checkPlace(shop, lot, item.def, p.x, p.y, p.rot).ok) continue;
    fits++;
    cost += buildCost(s, item.def);
  }
  return { fits, total: t.items.length, cost };
}

/** Build everything in a template that fits and can be paid for. One undo removes the lot. */
export function applyTemplate(s: GameState, shop: ShopState, t: Template): number {
  const lot = session.city.lots[shop.lotId];
  const ops: Op[] = [];
  let skipped = 0;
  for (const item of t.items) {
    const p = place(shop, item);
    const obj = checkPlace(shop, lot, item.def, p.x, p.y, p.rot).ok ? placeObject(s, shop, lot, item.def, p.x, p.y, p.rot) : null;
    if (!obj) {
      skipped++;
      continue;
    }
    item.products?.forEach((product, i) => product && assignSlot(shop, obj, i, product));
    ops.push({ t: 'place', obj: snapOf(obj), cost: buildCost(s, item.def) });
  }
  record(shop.id, { t: 'batch', ops, label: t.name });
  const spent = ops.reduce((a, o) => a + (o.t === 'place' ? o.cost : 0), 0);
  if (ops.length) toast(`${t.name}: built ${ops.length} piece${ops.length === 1 ? '' : 's'} for ${money(spent)}${skipped ? `; ${skipped} did not fit or could not be paid for` : ''}.`, skipped ? 'warn' : 'good');
  else toast(`${t.name}: nothing fits here.`, 'warn');
  return ops.length;
}
