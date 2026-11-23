import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { SAVE_VERSION } from '../src/core/constants';
import { session } from '../src/core/state';
import { LATEST_SAVE_VERSION, MIGRATIONS, migrateState, SaveTooNewError } from '../src/systems/save/migrations';
import { listSaves, loadGameDetailed, saveGame } from '../src/systems/save/saves';
import { bootSimulation, openShop, run, startGame, stockShelves } from './helpers';

// A save written by the released 1.0.0 build: four businesses, staff, a loan, an upgrade, two closed days.
const fixtureV1 = (): { version: number; meta: unknown; state: Record<string, any> } => JSON.parse(readFileSync(new URL('./fixtures/save-v1.json', import.meta.url), 'utf8'));

beforeEach(() => localStorage.clear());

describe('save migrations', () => {
  it('has one step per version with no gaps', () => {
    const versions = MIGRATIONS.map((m) => m.to).sort((a, b) => a - b);
    expect(versions).toEqual(versions.map((_v, i) => i + 2));
    expect(LATEST_SAVE_VERSION).toBe(SAVE_VERSION);
  });

  it('upgrades a 1.0.0 save without losing anything', () => {
    const file = fixtureV1();
    const before = structuredClone(file.state);
    const applied = migrateState(file.state, file.version);
    expect(applied.length).toBe(SAVE_VERSION - 1);
    expect(file.state.version).toBe(SAVE_VERSION);
    expect(file.state.money).toBe(before.money);
    expect(file.state.shops.map((s: any) => s.type)).toEqual(before.shops.map((s: any) => s.type));
    expect(file.state.staff.length).toBe(before.staff.length);
    expect(file.state.loans).toEqual(before.loans);
    expect(file.state.upgrades).toEqual(before.upgrades);
    expect(file.state.finance.history.length).toBe(before.finance.history.length);
    for (const shop of file.state.shops) {
      expect(Array.isArray(shop.history)).toBe(true);
      expect(shop.objects.length).toBe(before.shops.find((b: any) => b.id === shop.id).objects.length);
    }
  });

  it('is safe to run on a save that is already current', () => {
    const file = fixtureV1();
    migrateState(file.state, file.version);
    const once = structuredClone(file.state);
    expect(migrateState(file.state, SAVE_VERSION)).toEqual([]);
    expect(file.state).toEqual(once);
  });

  it('refuses a save from a newer game', () => {
    expect(() => migrateState({}, SAVE_VERSION + 1)).toThrow(SaveTooNewError);
  });
});

describe('loading and saving', () => {
  it('loads the 1.0.0 save, keeps a backup of the original, and the game runs on it', async () => {
    localStorage.setItem('businesssim:save_slot1', JSON.stringify(fixtureV1()));
    const result = await loadGameDetailed('slot1');
    expect(result.ok).toBe(true);
    expect(JSON.parse(localStorage.getItem('businesssim:backup_slot1_v1')!).version).toBe(1);

    const s = session.state;
    const revenueBefore = s.shops.reduce((a, sh) => a + sh.today.revenue, 0);
    const day = Math.floor(s.time.minutes / 1440);
    bootSimulation();
    run(26 * 60); // through a midnight, so daily closing runs on migrated data
    expect(Math.floor(s.time.minutes / 1440)).toBeGreaterThan(day);
    expect(s.shops.every((sh) => sh.history.length >= 1)).toBe(true);
    expect(s.shops.reduce((a, sh) => a + sh.today.revenue + sh.yesterday.revenue, 0)).toBeGreaterThan(revenueBefore);
    expect(Number.isFinite(s.money)).toBe(true);
  });

  it('gives a clear reason when a save is too new or missing', async () => {
    const file = fixtureV1();
    file.version = SAVE_VERSION + 5;
    localStorage.setItem('businesssim:save_slot2', JSON.stringify(file));
    const tooNew = await loadGameDetailed('slot2');
    expect(tooNew.ok).toBe(false);
    expect(!tooNew.ok && tooNew.reason).toMatch(/newer version/);
    expect((await loadGameDetailed('slot3')).ok).toBe(false);
  });

  it('round-trips a running game', async () => {
    const s = startGame();
    const shop = openShop('convenience', [['shelf', 1, 1, 0], ['register', 1, 5, 3]], { chips: 60, candy: 60 });
    stockShelves(shop, [['chips', 'candy']]);
    s.ownerAt = { shopId: shop.id, objectId: shop.objects[1].id };
    run(180);
    await saveGame('slot4', true);
    const saved = structuredClone(s);
    expect((await listSaves()).map((m) => m.slot)).toContain('slot4');
    expect((await loadGameDetailed('slot4')).ok).toBe(true);
    expect(session.state).toEqual(saved);
  });
});
