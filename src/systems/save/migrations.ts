import { emptyStats } from '../../entities/Shop';

/**
 * Save-file migrations.
 *
 * Every change to the shape of saved data gets ONE entry here that upgrades a save from
 * the previous version to the next. Saves are upgraded step by step, so a save from any
 * older release still loads. Rules:
 *   - Never edit a migration that has shipped; add a new one.
 *   - A migration must cope with missing fields (use ??=), because it may run on data
 *     written by any build that reported the previous version number.
 *   - Bump SAVE_VERSION to the highest `to` below.
 *   - Add or extend a fixture in tests/fixtures and a case in tests/save.test.ts.
 */
export interface Migration {
  /** The version this step produces. It upgrades from `to - 1`. */
  to: number;
  /** What changed, for the log and for whoever reads this next. */
  name: string;
  // Old saves are untyped by nature: each step knows only what it is fixing.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  up(state: any): void;
}

export const MIGRATIONS: Migration[] = [
  {
    to: 2,
    name: 'Fill fields added during 1.0 development; add per-shop daily history',
    up(s) {
      // Builds before 1.0.0 all reported version 1 while fields were still being added,
      // so make sure everything 1.0.0 relies on is present.
      s.shops ??= [];
      s.orders ??= [];
      s.staff ??= [];
      s.candidates ??= [];
      s.nextPersonId ??= 1;
      s.upgrades ??= {};
      s.xp ??= 0;
      s.level ??= 1;
      s.loans ??= [];
      s.nextLoanId ??= 1;
      s.events ??= [];
      s.news ??= [];
      s.won ??= false;
      s.bankrupt ??= false;
      s.ownerAt ??= null;
      for (const shop of s.shops) {
        shop.dirt ??= 0;
        shop.autoReorder ??= true;
        shop.today = { ...emptyStats(), ...shop.today };
        shop.yesterday = { ...emptyStats(), ...shop.yesterday };
        // New in save version 2: closed days, oldest first, for dashboards and charts.
        // Yesterday is the only past day a version-1 save knows about.
        if (!shop.history) {
          const y = shop.yesterday;
          const day = Math.floor((s.time?.minutes ?? 0) / 1440);
          shop.history = y.customers || y.revenue || y.costs ? [{ day, ...y }] : [];
        }
      }
    },
  },
  {
    to: 3,
    name: 'Add weather; widen the range of character looks',
    up(s) {
      s.weather ??= { kind: 'sunny', until: 0 };
      // Look ids used to run 0-23 over discs; they now index 72 drawn people. Old ids stay valid.
    },
  },
  {
    to: 4,
    name: 'Add residents (people with memory) and shop reviews',
    up(s) {
      // Residents are generated when the simulation starts, since they need the city map.
      s.residents ??= [];
      for (const shop of s.shops ?? []) shop.reviews ??= [];
    },
  },
  {
    to: 5,
    name: 'Add rival companies; the old "rival nearby" event is replaced by real rival shops',
    up(s) {
      // Companies are created when the simulation starts.
      s.rivals ??= [];
      s.nextRivalShopId ??= 1;
      s.offers ??= [];
      s.events = (s.events ?? []).filter((e: { type: string }) => e.type !== 'rival');
    },
  },
  {
    to: 6,
    name: 'Add lifetime statistics and achievements',
    up(s) {
      s.stats ??= {};
      s.achievements ??= {};
    },
  },
  {
    to: 7,
    name: 'Add advertising campaigns; holidays now follow the calendar',
    up(s) {
      s.campaigns ??= [];
      // Old holiday markers are recreated from the calendar on load.
      s.events = (s.events ?? []).filter((e: { type: string }) => e.type !== 'holiday');
    },
  },
  {
    to: 8,
    name: 'Add supplier contracts and franchises',
    up(s) {
      s.contracts ??= [];
      s.nextContractId ??= 1;
      s.franchises ??= [];
      s.franchiseOffers ??= [];
      s.nextFranchiseId ??= 1;
    },
  },
  {
    to: 9,
    name: 'Add the property market, investors, insurance, the company index and the owner',
    up(s) {
      s.propertyIndex ??= {};
      s.propertyHistory ??= [];
      s.investors ??= [];
      s.investorOffers ??= [];
      s.nextOfferId ??= 1;
      s.insurance ??= {};
      s.companyIndex ??= [];
      s.player ??= { energy: 100, home: 'studio', car: 'none', visited: [], visitDay: 0 };
    },
  },
];

export const LATEST_SAVE_VERSION = MIGRATIONS.reduce((v, m) => Math.max(v, m.to), 1);

export class SaveTooNewError extends Error {
  constructor(public readonly found: number) {
    super(`This save was made by a newer version of the game (save format ${found}, this game reads up to ${LATEST_SAVE_VERSION}). Update the game to load it.`);
  }
}

/**
 * Upgrade saved state in place to the current version.
 * Returns the names of the steps that ran (empty if the save was already current).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function migrateState(state: any, fromVersion: number): string[] {
  const from = Number.isFinite(fromVersion) && fromVersion >= 1 ? Math.floor(fromVersion) : 1;
  if (from > LATEST_SAVE_VERSION) throw new SaveTooNewError(from);
  const applied: string[] = [];
  for (const m of [...MIGRATIONS].sort((a, b) => a.to - b.to)) {
    if (m.to <= from) continue;
    m.up(state);
    applied.push(`v${m.to}: ${m.name}`);
  }
  state.version = LATEST_SAVE_VERSION;
  return applied;
}
