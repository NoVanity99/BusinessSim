import { createShop, placeObject } from '../systems/build/build';
import { rentLot } from '../systems/economy/property';
import { addToStorage, assignSlot, fillObject } from '../systems/economy/stock';
import { hire, refreshCandidates } from '../systems/staff/staff';
import { rt } from '../systems/ai/runtime';
import { session } from './state';

/**
 * Handles for automated tests and console tinkering (window.__dbg).
 * Nothing in the game itself depends on this.
 */
export const debugApi = { session, rt, createShop, placeObject, rentLot, addToStorage, assignSlot, fillObject, hire, refreshCandidates };
