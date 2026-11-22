import { bus } from './events';

export type Tool =
  | { type: 'place'; def: string; rot: number; movingId?: number }
  | { type: 'move' }
  | { type: 'sell' };

/** Transient interface state. Not saved. */
export const ui: {
  tool: Tool | null;
  selectedLot: number | null;
  selectedObject: { shopId: number; objectId: number } | null;
  selectedNpc: number | null;
} = { tool: null, selectedLot: null, selectedObject: null, selectedNpc: null };

export function setTool(tool: Tool | null): void {
  ui.tool = tool;
  bus.emit('tool:changed', tool);
}

export function selectLot(id: number | null): void {
  ui.selectedLot = id;
  if (id === null) selectObject(null);
  bus.emit('lot:selected', id);
}

export function selectObject(sel: { shopId: number; objectId: number } | null): void {
  ui.selectedObject = sel;
  bus.emit('object:selected', sel);
}

export function selectNpc(id: number | null): void {
  ui.selectedNpc = id;
  bus.emit('npc:selected', id);
}

export function resetUi(): void {
  ui.selectedNpc = null;
  ui.tool = null;
  ui.selectedLot = null;
  ui.selectedObject = null;
}
