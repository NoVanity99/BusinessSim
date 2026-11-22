import { onSettingsChanged, settings } from '../../core/settings';

/**
 * All sound is synthesised with WebAudio, so the game ships with no audio files.
 * To use recordings instead, replace the bodies in SFX (or `music.start`) with
 * buffer playback; callers only know the names.
 */
let ctx: AudioContext | null = null;
let master: GainNode;
let sfxBus: GainNode;
let musicBus: GainNode;

function ensure(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  master = ctx.createGain();
  sfxBus = ctx.createGain();
  musicBus = ctx.createGain();
  sfxBus.connect(master);
  musicBus.connect(master);
  master.connect(ctx.destination);
  applyVolumes();
  return ctx;
}

function applyVolumes(): void {
  if (!ctx) return;
  master.gain.value = settings.masterVolume;
  sfxBus.gain.value = settings.sfxVolume;
  musicBus.gain.value = settings.musicVolume * 0.5;
}

/** Browsers start audio suspended until the user interacts; call once at boot. */
export function installAudio(): void {
  const unlock = (): void => {
    const c = ensure();
    if (c?.state === 'suspended') void c.resume();
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  onSettingsChanged(applyVolumes);
}

function tone(freq: number, start: number, dur: number, vol: number, type: OscillatorType = 'sine', slideTo?: number): void {
  if (!ctx) return;
  const t = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(vol, t + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(sfxBus);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(start: number, dur: number, vol: number, cutoff: number): void {
  if (!ctx) return;
  const t = ctx.currentTime + start;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  const gain = ctx.createGain();
  gain.gain.value = vol;
  src.connect(filter).connect(gain).connect(sfxBus);
  src.start(t);
}

const SFX = {
  /** Cash register: a drawer clunk and a two-note bell. */
  register: (v: number) => {
    noise(0, 0.06, 0.25 * v, 1800);
    tone(1320, 0.05, 0.25, 0.16 * v, 'triangle');
    tone(1760, 0.13, 0.4, 0.14 * v, 'triangle');
  },
  /** Shop door chime. */
  door: (v: number) => {
    tone(880, 0, 0.35, 0.09 * v);
    tone(660, 0.16, 0.5, 0.09 * v);
  },
  footstep: (v: number) => noise(0, 0.05, 0.1 * v, 500),
  click: (v: number) => tone(700, 0, 0.05, 0.08 * v, 'square'),
  place: (v: number) => {
    noise(0, 0.08, 0.3 * v, 700);
    tone(180, 0, 0.1, 0.18 * v, 'sine', 90);
  },
  sell: (v: number) => tone(520, 0, 0.14, 0.1 * v, 'triangle', 260),
  error: (v: number) => tone(160, 0, 0.18, 0.12 * v, 'sawtooth', 110),
  good: (v: number) => {
    tone(660, 0, 0.12, 0.1 * v, 'triangle');
    tone(990, 0.1, 0.22, 0.1 * v, 'triangle');
  },
  warn: (v: number) => {
    tone(440, 0, 0.14, 0.1 * v, 'triangle');
    tone(350, 0.14, 0.2, 0.1 * v, 'triangle');
  },
  delivery: (v: number) => {
    tone(300, 0, 0.12, 0.1 * v, 'square');
    tone(300, 0.2, 0.12, 0.1 * v, 'square');
  },
} as const;

export type SfxName = keyof typeof SFX;

const lastPlayed: Partial<Record<SfxName, number>> = {};

/** Play a sound effect. `volume` (0-1) lets callers fade sounds by distance or zoom. */
export function sfx(name: SfxName, volume = 1): void {
  const c = ensure();
  if (!c || c.state !== 'running' || volume <= 0.02) return;
  // Avoid a wall of identical sounds when many things happen in one frame.
  const now = c.currentTime;
  if (now - (lastPlayed[name] ?? -1) < 0.06) return;
  lastPlayed[name] = now;
  SFX[name](Math.min(1, volume));
}

/**
 * Background music hook. The built-in "track" is a quiet generative pad: slow chords
 * with a sparse melody. Swap `start` for file playback to use composed music.
 */
export const music = (() => {
  let timer: number | null = null;
  const CHORDS = [
    [220, 277.18, 329.63],
    [196, 246.94, 293.66],
    [174.61, 220, 261.63],
    [196, 246.94, 329.63],
  ];
  const SCALE = [440, 493.88, 554.37, 659.25, 739.99, 880];
  let step = 0;

  const bar = (): void => {
    const c = ensure();
    if (!c || c.state !== 'running' || settings.musicVolume <= 0) return;
    const t = c.currentTime;
    for (const f of CHORDS[step % CHORDS.length]) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.07, t + 1.5);
      gain.gain.linearRampToValueAtTime(0, t + 5.8);
      osc.connect(gain).connect(musicBus);
      osc.start(t);
      osc.stop(t + 6);
    }
    for (let i = 0; i < 3; i++) {
      if (Math.random() < 0.45) continue;
      const when = t + 1 + i * 1.5 + Math.random() * 0.4;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'triangle';
      osc.frequency.value = SCALE[Math.floor(Math.random() * SCALE.length)];
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(0.05, when + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 1.6);
      osc.connect(gain).connect(musicBus);
      osc.start(when);
      osc.stop(when + 1.7);
    }
    step++;
  };

  return {
    start(): void {
      if (timer !== null) return;
      bar();
      timer = window.setInterval(bar, 5500);
    },
    stop(): void {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
})();
