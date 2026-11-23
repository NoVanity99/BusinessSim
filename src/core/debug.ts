import { createShop, placeObject } from '../systems/build/build';
import { rentLot } from '../systems/economy/property';
import { addToStorage, assignSlot, fillObject } from '../systems/economy/stock';
import { hire, refreshCandidates } from '../systems/staff/staff';
import { rt } from '../systems/ai/runtime';
import { eventsDaily, eventsHourly } from '../systems/events/events';
import { addXp } from '../systems/progress/level';
import { updateAi } from '../systems/ai/customers';
import { updateVehicles } from '../systems/ai/vehicles';
import { updateStaff } from '../systems/staff/agents';
import { sendCrook } from '../systems/ai/customers';
import { rivalsDaily } from '../systems/rivals/rivals';
import { bus } from './events';
import { settings } from './settings';
import { session } from './state';
import { selectLot, selectNpc } from './uiState';

/**
 * Handles for automated tests and console tinkering (window.__dbg).
 * Nothing in the game itself depends on this.
 */
export const debugApi = { session, bus, settings, rt, createShop, placeObject, rentLot, addToStorage, assignSlot, fillObject, hire, refreshCandidates, eventsDaily, eventsHourly, addXp, selectLot, selectNpc, updateAi, updateVehicles, updateStaff, sendCrook, rivalsDaily };
