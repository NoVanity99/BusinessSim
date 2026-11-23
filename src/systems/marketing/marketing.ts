import { bus, toast } from '../../core/events';
import { clamp, money } from '../../core/format';
import { rand } from '../../core/rng';
import { type GameState } from '../../core/state';
import { DIFFICULTIES, MARKETING, SHOP_TYPES, type CampaignDef } from '../../data';
import type { ShopState } from '../../entities/Shop';
import { tryPay } from '../economy/finance';
import { dayOf } from '../time/clock';

/** An advertising campaign that is running. Saved with the game. */
export interface Campaign {
  type: string;
  /** The shop it promotes, or 0 for the whole company. */
  shopId: number;
  /** Last day it runs. */
  untilDay: number;
}

export const campaignDef = (c: Campaign): CampaignDef => MARKETING.campaigns[c.type];
export const campaignCost = (s: GameState, type: string): number => Math.round((MARKETING.campaigns[type].cost * DIFFICULTIES[s.difficulty].costMult) / 10) * 10;

/** Campaigns promoting a shop right now: its own and any company-wide ones. */
export const campaignsFor = (s: GameState, shop: ShopState): Campaign[] => s.campaigns.filter((c) => (c.shopId === shop.id || c.shopId === 0) && MARKETING.campaigns[c.type]);

export const isRunning = (s: GameState, type: string, shopId: number): Campaign | undefined => s.campaigns.find((c) => c.type === type && c.shopId === shopId);

/** How much advertising is lifting interest in a shop. Campaigns stack, each adding its own lift. */
export function adDemand(s: GameState, shop: ShopState): number {
  let m = 1;
  for (const c of campaignsFor(s, shop)) m += campaignDef(c).demand - 1;
  return m;
}

/** Share knocked off prices for customers of this shop by coupons. */
export const couponCut = (s: GameState, shop: ShopState): number => campaignsFor(s, shop).reduce((a, c) => Math.max(a, campaignDef(c).priceCut ?? 0), 0);

/** How much more a good visit counts toward loyalty while a loyalty scheme runs. */
export const loyaltyBoost = (s: GameState, shop: ShopState): number => campaignsFor(s, shop).reduce((a, c) => Math.max(a, campaignDef(c).loyalty ?? 1), 1);

export function startCampaign(s: GameState, type: string, shop: ShopState | null): boolean {
  const def = MARKETING.campaigns[type];
  const shopId = def.scope === 'company' ? 0 : shop?.id ?? -1;
  if (!def || shopId < 0 || s.level < def.unlockLevel || isRunning(s, type, shopId)) return false;
  const cost = campaignCost(s, type);
  if (!tryPay(s, cost, 'marketing')) {
    toast(`You need ${money(cost)} for ${def.name.toLowerCase()}.`, 'bad');
    return false;
  }
  if (shop && shopId) shop.today.costs += cost;
  s.campaigns.push({ type, shopId, untilDay: dayOf(s.time) + def.days - 1 });
  toast(`${def.name} booked${shopId ? ` for ${shop!.name}` : ' for every shop'}: ${def.days} days.`, 'good');
  // The first day's audience hears about it straight away.
  spread(s, s.campaigns[s.campaigns.length - 1]);
  bus.emit('marketing:changed');
  return true;
}

/** One day of a campaign reaching people: some residents come to think a little better of the shops it promotes. */
function spread(s: GameState, c: Campaign): void {
  const def = campaignDef(c);
  if (!def.reach || !s.residents.length) return;
  const shops = s.shops.filter((sh) => (c.shopId === 0 || sh.id === c.shopId) && SHOP_TYPES[sh.type].demand > 0);
  if (!shops.length) return;
  const audience = def.personas ? s.residents.filter((r) => def.personas!.includes(r.persona)) : s.residents;
  const n = Math.round(s.residents.length * def.reach);
  for (let i = 0; i < n && audience.length; i++) {
    const r = rand.pick(audience);
    const shop = rand.pick(shops);
    const m = (r.memory[shop.id] ??= { visits: 0, score: 0, lastDay: 0 });
    // Adverts make people curious; they do not change the mind of someone who has been let down.
    if (m.score > -0.3) m.score = clamp(m.score + 0.12, -1, 0.6);
  }
}

/** Start of day: finished campaigns end, the rest reach more people. */
export function marketingDaily(s: GameState): void {
  const day = dayOf(s.time);
  const ended = s.campaigns.filter((c) => c.untilDay < day || !MARKETING.campaigns[c.type] || (c.shopId !== 0 && !s.shops.some((sh) => sh.id === c.shopId)));
  s.campaigns = s.campaigns.filter((c) => !ended.includes(c));
  for (const c of ended) {
    const shop = s.shops.find((sh) => sh.id === c.shopId);
    if (MARKETING.campaigns[c.type] && (shop || c.shopId === 0)) toast(`${campaignDef(c).name} has finished${shop ? ` at ${shop.name}` : ''}.`, 'info');
  }
  for (const c of s.campaigns) spread(s, c);
  if (ended.length) bus.emit('marketing:changed');
}
