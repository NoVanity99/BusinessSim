export type CustomerState =
  | 'walk'         // strolling toward their own destination
  | 'toShop'       // heading for a shop door
  | 'browse'       // deciding what to do next
  | 'toShelf'      // walking to a shelf
  | 'pick'         // looking at a shelf
  | 'toQueue'      // walking to their place in a checkout line
  | 'queue'        // standing in line
  | 'awaitOrder'   // paid, waiting for food
  | 'toStation'    // walking to a machine, seat or attraction
  | 'using'        // using it
  | 'waitStation'  // everything is taken; waiting for one to free up
  | 'leave';       // done, heading off

/** One thing a customer intends to do during a visit. */
export type Step =
  | { t: 'buy'; product: string; done?: boolean }
  | { t: 'pay' }
  | { t: 'order'; items: string[] }
  | { t: 'use'; service: string; optional?: boolean };

export type ThoughtKind = 'good' | 'bad' | 'neutral';

export interface Thought {
  /** Game minute it occurred. */
  t: number;
  text: string;
  kind: ThoughtKind;
}

export interface CartLine {
  product: string;
  qty: number;
  price: number;
}

/** A pedestrian. Positions are in tile units (x + 0.5 is a tile centre). Not saved. */
export interface Customer {
  id: number;
  name: string;
  x: number;
  y: number;
  /** Small fixed offset so people sharing a tile do not overlap exactly. */
  ox: number;
  oy: number;
  look: number;
  state: CustomerState;
  /** Remaining tile indices to walk. */
  path: number[];
  /** Tile the customer is currently trying to reach, for re-pathing. */
  goal: number;
  /** Where they were going before any shop caught their eye. */
  dest: number;
  speed: number;
  /** Shop type they want to visit, or null for people just passing through. */
  need: string | null;
  /** What they plan to do in the shop, in order. */
  plan: Step[];
  step: number;
  cart: CartLine[];
  budget: number;
  /** Multiplier on how much markup they accept. */
  generosity: number;
  wealth: number;
  patience: number;
  waited: number;
  /** 0-100. */
  mood: number;
  thoughts: Thought[];
  shopId: number | null;
  /** Shops already visited or rejected on this trip. */
  seen: number[];
  /** Game minutes left on the current wait. */
  timer: number;
  shelfId: number;
  slotIndex: number;
  registerId: number;
  queueSlot: number;
  entered: boolean;
  /** Station (machine, seat, attraction) they hold a place on, or -1. */
  stationId: number;
  /** Seat taken while a long machine cycle runs, or -1. */
  seatId: number;
  /** Things used this visit, so guests try different attractions. */
  used: number[];
  bought: boolean;
  collector?: boolean;
}

export const cartTotal = (c: Customer): number => c.cart.reduce((a, l) => a + l.qty * l.price, 0);
export const cartUnits = (c: Customer): number => c.cart.reduce((a, l) => a + l.qty, 0);

export const STATE_LABEL: Record<CustomerState, string> = {
  walk: 'Walking',
  toShop: 'Heading to a shop',
  browse: 'Browsing',
  toShelf: 'Browsing',
  pick: 'Looking at a shelf',
  toQueue: 'Joining the queue',
  queue: 'Waiting in line',
  awaitOrder: 'Waiting for their order',
  toStation: 'Walking over',
  using: 'Enjoying themselves',
  waitStation: 'Waiting for a free spot',
  leave: 'Leaving',
};
