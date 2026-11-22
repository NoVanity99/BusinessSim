import { DAYS_PER_WEEK, MINUTES_PER_DAY, SECONDS_PER_GAME_MINUTE } from '../../core/constants';
import { bus } from '../../core/events';

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface TimeState {
  /** Total game minutes since the start of day 1 (fractional). */
  minutes: number;
  /** 0 = paused, otherwise 1, 2 or 4. */
  speed: number;
}

/** A new game starts at 07:00 on day 1 (a Monday). */
export function newTimeState(): TimeState {
  return { minutes: 7 * 60, speed: 1 };
}

export const dayOf = (t: TimeState): number => Math.floor(t.minutes / MINUTES_PER_DAY) + 1;
export const minuteOfDay = (t: TimeState): number => Math.floor(t.minutes) % MINUTES_PER_DAY;
export const hourOf = (t: TimeState): number => Math.floor(minuteOfDay(t) / 60);
/** Hour with fraction, e.g. 13.5 = 13:30. */
export const hourFloat = (t: TimeState): number => (t.minutes % MINUTES_PER_DAY) / 60;
export const weekdayOf = (t: TimeState): number => (dayOf(t) - 1) % DAYS_PER_WEEK;
export const weekOf = (t: TimeState): number => Math.floor((dayOf(t) - 1) / DAYS_PER_WEEK) + 1;
export const isWeekend = (t: TimeState): boolean => weekdayOf(t) >= 5;

export function clockText(t: TimeState): string {
  const m = minuteOfDay(t);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function dateText(t: TimeState): string {
  return `${DAY_NAMES[weekdayOf(t)]} · Day ${dayOf(t)} · Week ${weekOf(t)}`;
}

export function formatHour(h: number): string {
  return `${String(Math.floor(h) % 24).padStart(2, '0')}:00`;
}

/**
 * Advances the clock by real seconds and returns the game minutes that elapsed.
 * Emits minute/hour/day events for each boundary crossed.
 */
export function advanceClock(t: TimeState, realSeconds: number): number {
  if (t.speed <= 0) return 0;
  const delta = (realSeconds * t.speed) / SECONDS_PER_GAME_MINUTE;
  const before = Math.floor(t.minutes);
  t.minutes += delta;
  const after = Math.floor(t.minutes);
  for (let m = before + 1; m <= after; m++) {
    bus.emit('time:minute', m);
    if (m % 60 === 0) bus.emit('time:hour', Math.floor(m / 60) % 24);
    if (m % MINUTES_PER_DAY === 0) bus.emit('time:day', Math.floor(m / MINUTES_PER_DAY) + 1);
  }
  return delta;
}

export function setSpeed(t: TimeState, speed: number): void {
  t.speed = speed;
  bus.emit('time:speed', speed);
}

/**
 * Darkness from 0 (day) to 1 (deep night), used for the day/night tint.
 * Dawn 5-7, dusk 18.5-21.
 */
export function darkness(hour: number): number {
  if (hour >= 7 && hour <= 18.5) return 0;
  if (hour > 18.5 && hour < 21) return (hour - 18.5) / 2.5;
  if (hour >= 5 && hour < 7) return 1 - (hour - 5) / 2;
  return 1;
}
