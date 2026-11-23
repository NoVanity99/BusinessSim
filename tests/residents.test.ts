import { describe, expect, it } from 'vitest';
import { session } from '../src/core/state';
import { PERSONAS } from '../src/data';
import { appetite, chooseShop, isRegular, needLevel, regularsOf, shopRating, shopUtility } from '../src/systems/ai/residents';
import { rt } from '../src/systems/ai/runtime';
import { hire } from '../src/systems/staff/staff';
import { openShop, run, setClock, startGame, stockShelves } from './helpers';

function stockedStore() {
  const s = startGame();
  const shop = openShop('convenience', [['shelf', 1, 1, 0], ['shelf', 3, 1, 0], ['fridge', 5, 1, 0], ['register', 1, 5, 3]], { chips: 4000, candy: 4000, bread: 4000, noodles: 4000, soda: 4000, water: 4000 }, 'downtown');
  stockShelves(shop, [['chips', 'candy'], ['bread', 'noodles'], ['soda', 'water']]);
  s.ownerAt = { shopId: shop.id, objectId: shop.objects[3].id };
  for (const role of ['stocker', 'stocker']) {
    s.candidates.push({ id: s.nextPersonId++, name: `Test ${role}`, role, skills: { speed: 9, friendliness: 6, reliability: 10 }, traits: [], wage: 12, look: 1 });
    hire(s, s.candidates[s.candidates.length - 1].id, shop.id)!.shift = [0, 24];
  }
  shop.hours = [0, 24];
  return { s, shop };
}

describe('residents', () => {
  it('populates the city with a mix of personas', () => {
    const s = startGame();
    expect(s.residents.length).toBe(PERSONAS.residents);
    const personas = new Set(s.residents.map((r) => r.persona));
    expect(personas.size).toBeGreaterThanOrEqual(7);
    expect(personas.has('tourist')).toBe(false);
  });

  it('needs build up over time and reset when met', () => {
    const s = startGame();
    const r = s.residents[0];
    r.met.hunger = s.time.minutes;
    const fresh = needLevel(s, r, 'hunger');
    s.time.minutes += 12 * 60;
    expect(needLevel(s, r, 'hunger')).toBeGreaterThan(fresh);
  });

  it('prefers shops remembered fondly and shuns ones that let them down', () => {
    const { s, shop } = stockedStore();
    const r = s.residents.find((x) => x.persona === 'regular')!;
    const neutral = shopUtility(s, r, r.persona, shop, r.home);
    r.memory[shop.id] = { visits: 4, score: 0.9, lastDay: 1 };
    expect(shopUtility(s, r, r.persona, shop, r.home)).toBeGreaterThan(neutral + 1);
    r.memory[shop.id] = { visits: 2, score: -0.8, lastDay: 1 };
    expect(shopUtility(s, r, r.persona, shop, r.home)).toBeLessThan(neutral - 2);
    // With that grudge they almost never choose it over going elsewhere.
    let chosen = 0;
    for (let i = 0; i < 300; i++) if (chooseShop(s, r, r.persona, 'convenience', r.home).shop) chosen++;
    expect(chosen).toBeLessThan(40);
  });

  it('raising prices makes a shop less attractive, most of all to bargain hunters', () => {
    const { s, shop } = stockedStore();
    const hunter = s.residents.find((x) => x.persona === 'bargain')!;
    const commuter = s.residents.find((x) => x.persona === 'commuter')!;
    const before = [shopUtility(s, hunter, 'bargain', shop, hunter.home), shopUtility(s, commuter, 'commuter', shop, commuter.home)];
    for (const p of Object.keys(shop.prices)) shop.prices[p] *= 1.3;
    const drop = [before[0] - shopUtility(s, hunter, 'bargain', shop, hunter.home), before[1] - shopUtility(s, commuter, 'commuter', shop, commuter.home)];
    expect(drop[0]).toBeGreaterThan(drop[1]);
    expect(drop[1]).toBeGreaterThan(0);
  });

  it('weather and hour change appetite', () => {
    const s = startGame();
    setClock(13);
    const lunch = appetite(s, null, 'regular', 'fastfood');
    setClock(3);
    expect(appetite(s, null, 'regular', 'fastfood')).toBeLessThan(lunch);
    setClock(13);
    const fine = appetite(s, null, 'regular', 'funpark');
    s.weather.kind = 'rain';
    expect(appetite(s, null, 'regular', 'funpark')).toBeLessThan(fine);
  });

  it('over several days people form memories, post reviews and become regulars', () => {
    const { s, shop } = stockedStore();
    setClock(7);
    run(4 * 24 * 60);
    const remembered = s.residents.filter((r) => (r.memory[shop.id]?.visits ?? 0) > 0);
    expect(remembered.length).toBeGreaterThan(60);
    expect(remembered.some((r) => r.memory[shop.id].visits >= 2)).toBe(true);
    expect(shop.reviews.length).toBeGreaterThan(3);
    expect(shopRating(shop)).toBeGreaterThan(1);
    expect(regularsOf(s, shop.id)).toBe(s.residents.filter((r) => isRegular(r.memory[shop.id])).length);
    // Word of mouth: some people have an opinion without ever having been in.
    expect(s.residents.some((r) => r.memory[shop.id] && r.memory[shop.id].visits === 0 && r.memory[shop.id].score !== 0)).toBe(true);
    // Nobody is counted as out once they have gone home.
    expect(rt.out.size).toBeLessThanOrEqual(rt.customers.length);
    expect(session.state.residents.length).toBe(PERSONAS.residents);
  });

  it('families shop in groups and tourists have no memory', () => {
    const { s } = stockedStore();
    setClock(11);
    run(6 * 60);
    const seenGroups = rt.customers.some((c) => c.companions.length > 0);
    const tourists = rt.customers.filter((c) => c.persona === 'tourist');
    expect(seenGroups).toBe(true);
    expect(tourists.length).toBeGreaterThan(0);
    expect(tourists.every((c) => c.residentId === -1)).toBe(true);
    expect(s.residents.every((r) => r.persona !== 'tourist')).toBe(true);
  });
});
