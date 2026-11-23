import { bus } from '../../core/events';
import { session } from '../../core/state';
import { ui } from '../../core/uiState';
import { NEIGHBORHOODS, SHOP_TYPES } from '../../data';
import { T } from '../../systems/city/generate';
import { rt } from '../../systems/ai/runtime';
import { h } from '../dom';
import { icon } from '../icons';

const GROUND: Record<number, string> = {
  [T.Road]: '#3b4252',
  [T.Crosswalk]: '#4a5263',
  [T.Sidewalk]: '#7d8698',
  [T.Grass]: '#3f7d4a',
  [T.Park]: '#4c9a58',
  [T.Path]: '#a39274',
  [T.Sand]: '#cdb98a',
  [T.Water]: '#2f6fa8',
  [T.Lot]: '#5b5446',
  [T.Building]: '#5a6274',
};

/**
 * A small map of the whole city in the corner: your businesses, rivals, where the crowds
 * are, and the part of the city on screen. Click or drag on it to move the camera.
 */
export function Minimap(): { el: HTMLElement; destroy(): void } {
  const { city } = session;
  const scale = Math.max(1, Math.floor(190 / city.w));
  const W = city.w * scale;
  const H = city.h * scale;

  // The ground never changes: paint it once.
  const base = document.createElement('canvas');
  base.width = W;
  base.height = H;
  const bctx = base.getContext('2d')!;
  for (let y = 0; y < city.h; y++) {
    for (let x = 0; x < city.w; x++) {
      bctx.fillStyle = GROUND[city.tiles[y * city.w + x]] ?? '#3f7d4a';
      bctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  // Districts as a faint wash so areas are recognisable.
  bctx.globalAlpha = 0.16;
  for (const lot of city.lots) {
    bctx.fillStyle = NEIGHBORHOODS[lot.district].color;
    bctx.fillRect(lot.x * scale, lot.y * scale, lot.w * scale, lot.h * scale);
  }
  bctx.globalAlpha = 1;

  const canvas = h('canvas', { width: W, height: H });
  const ctx = canvas.getContext('2d')!;
  let collapsed = false;

  const draw = (): void => {
    if (collapsed) return;
    const s = session.state;
    ctx.drawImage(base, 0, 0);
    // People, as a sprinkle of light dots.
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < rt.customers.length; i += 2) ctx.fillRect(Math.floor(rt.customers[i].x * scale), Math.floor(rt.customers[i].y * scale), 1, 1);
    const box = (lotId: number, fill: string, stroke: string): void => {
      const lot = city.lots[lotId];
      ctx.fillStyle = fill;
      ctx.fillRect(lot.x * scale, lot.y * scale, lot.w * scale, lot.h * scale);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(lot.x * scale + 0.5, lot.y * scale + 0.5, lot.w * scale - 1, lot.h * scale - 1);
    };
    for (const c of s.rivals) for (const sh of c.shops) box(sh.lotId, c.color, '#10141c');
    for (const f of s.franchises) box(f.lotId, '#2f9e7f', '#ffffff');
    for (const id of Object.keys(s.lots)) {
      const shop = s.shops.find((sh) => sh.lotId === +id);
      box(+id, shop ? SHOP_TYPES[shop.type].color : 'rgba(79,195,161,0.35)', +id === ui.selectedLot ? '#ffffff' : '#4fc3a1');
    }
    // What the camera can see.
    const v = ui.view;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(v.x * scale, v.y * scale, Math.max(4, v.w * scale), Math.max(4, v.h * scale));
  };

  const go = (ev: MouseEvent): void => {
    const r = canvas.getBoundingClientRect();
    bus.emit('camera:pan', { x: ((ev.clientX - r.left) / r.width) * city.w, y: ((ev.clientY - r.top) / r.height) * city.h });
    draw();
  };
  canvas.addEventListener('mousedown', (ev) => {
    go(ev);
    const move = (e: MouseEvent): void => go(e);
    const up = (): void => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });

  const toggle = h('button.mini-toggle', { tip: 'Show or hide the map (M)', onclick: () => setCollapsed(!collapsed) }, icon('map', 16));
  const el = h('div.minimap', toggle, canvas);
  function setCollapsed(v: boolean): void {
    collapsed = v;
    el.classList.toggle('collapsed', v);
    draw();
  }

  const timer = window.setInterval(draw, 250);
  const offs = [bus.on('minimap:toggle', () => setCollapsed(!collapsed)), bus.on('lot:changed', draw), bus.on('rivals:changed', draw)];
  draw();
  return {
    el,
    destroy: () => {
      clearInterval(timer);
      offs.forEach((off) => off());
    },
  };
}
