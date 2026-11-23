// Generates the placeholder app icon: build/icon.ico (16, 32, 48 and 256 px) and build/icon.png.
// Run with `npm run icon`. To use real art, replace build/icon.ico with your own
// multi-size .ico (it must include a 256x256 image) and delete this script.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

/** Draw the icon at a given size and return RGBA bytes: a green rounded tile with a shop front. */
function draw(size) {
  const px = new Uint8Array(size * size * 4);
  const set = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  const s = size / 64;
  const inRound = (x, y, x0, y0, x1, y1, rad) => {
    if (x < x0 || y < y0 || x >= x1 || y >= y1) return false;
    const cx = x < x0 + rad ? x0 + rad : x >= x1 - rad ? x1 - rad - 1 : x;
    const cy = y < y0 + rad ? y0 + rad : y >= y1 - rad ? y1 - rad - 1 : y;
    return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad;
  };
  const bg = [79, 195, 161];
  const dark = [16, 20, 28];
  const wall = [232, 237, 245];
  const awningA = [217, 83, 79];
  const awningB = [242, 242, 242];
  const door = [58, 71, 96];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / s;
      const v = y / s;
      if (!inRound(x, y, 0, 0, size, size, 12 * s)) continue;
      let c = bg;
      if (u >= 12 && u < 52 && v >= 26 && v < 52) c = wall;             // shop wall
      if (u >= 10 && u < 54 && v >= 16 && v < 28) c = Math.floor((u - 10) / 5.5) % 2 ? awningB : awningA; // awning
      if (u >= 27 && u < 37 && v >= 36 && v < 52) c = door;             // door
      if (u >= 15 && u < 24 && v >= 33 && v < 43) c = [159, 208, 240];  // window
      if (u >= 40 && u < 49 && v >= 33 && v < 43) c = [159, 208, 240];  // window
      if (u >= 8 && u < 56 && v >= 52 && v < 55) c = dark;              // pavement line
      set(x, y, c);
    }
  }
  return px;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function png(size, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Classic icon image: a 32-bit BMP without its file header, rows bottom-up, plus an (empty) AND mask. */
function bmpEntry(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // colour image + mask
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = ((size - 1 - y) * size + x) * 4;
      const dst = (y * size + x) * 4;
      pixels[dst] = rgba[src + 2];
      pixels[dst + 1] = rgba[src + 1];
      pixels[dst + 2] = rgba[src];
      pixels[dst + 3] = rgba[src + 3];
    }
  }
  const maskRow = Math.ceil(size / 32) * 4;
  return Buffer.concat([header, pixels, Buffer.alloc(maskRow * size)]);
}

const sizes = [16, 32, 48, 256];
// Small sizes as BMP for old tooling; 256 as PNG, which is how Windows expects it.
const images = sizes.map((n) => (n === 256 ? png(n, draw(n)) : bmpEntry(n, draw(n))));
const dir = Buffer.alloc(6 + 16 * sizes.length);
dir.writeUInt16LE(1, 2);
dir.writeUInt16LE(sizes.length, 4);
let offset = dir.length;
sizes.forEach((n, i) => {
  const e = 6 + i * 16;
  dir[e] = n === 256 ? 0 : n;
  dir[e + 1] = n === 256 ? 0 : n;
  dir.writeUInt16LE(1, e + 4);
  dir.writeUInt16LE(32, e + 6);
  dir.writeUInt32LE(images[i].length, e + 8);
  dir.writeUInt32LE(offset, e + 12);
  offset += images[i].length;
});

mkdirSync('build', { recursive: true });
writeFileSync('build/icon.ico', Buffer.concat([dir, ...images]));
writeFileSync('build/icon.png', png(512, draw(512)));
console.log('Wrote build/icon.ico and build/icon.png');
