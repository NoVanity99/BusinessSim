import { bus } from '../../core/events';
import { calendarCrowd, calendarDemand, seasonOf, seasonProductBoost } from './seasons';
import { rand } from '../../core/rng';
import type { GameState } from '../../core/state';
import { WEATHER, type WeatherDef } from '../../data';
import { hourOf } from '../time/clock';

export type WeatherKind = keyof typeof WEATHER.kinds;

/** Saved with the game. */
export interface WeatherState {
  kind: string;
  /** Game minute at which the weather is next rolled. */
  until: number;
}

export const newWeatherState = (): WeatherState => ({ kind: 'sunny', until: 0 });

export const weatherDef = (s: GameState): WeatherDef => WEATHER.kinds[s.weather.kind] ?? WEATHER.kinds.sunny;

/** How many people are out, relative to a fine day. */
export const weatherCrowd = (s: GameState): number => weatherDef(s).crowd * calendarCrowd(s);

/** Demand multiplier for one kind of business in this weather. */
export const weatherDemand = (s: GameState, shopType: string): number => (weatherDef(s).demand[shopType] ?? 1) * calendarDemand(s, shopType);

/** Extra appetite for particular products (ice cream in a heatwave). */
export const weatherProductBoost = (s: GameState, product: string): number => (weatherDef(s).products?.[product] ?? 1) * seasonProductBoost(s, product);

/** Pick the next spell of weather. Hot spells only start by day; odds come from data. */
export function rollWeather(s: GameState): void {
  const hour = hourOf(s.time);
  // The season sets the odds: snow in winter, heatwaves in summer.
  const season = seasonOf(s).weather;
  const options = Object.entries(WEATHER.kinds)
    .filter(([, d]) => !d.dayOnly || (hour >= 9 && hour < 17))
    .map(([id, d]) => [id, { ...d, weight: d.weight * (season[id] ?? 1) }] as [string, WeatherDef])
    .filter(([, d]) => d.weight > 0);
  // Staying as it is counts double, so the weather has spells rather than flickering.
  let r = rand.next() * options.reduce((a, [id, d]) => a + d.weight * (id === s.weather.kind ? 2 : 1), 0);
  let next = options[0][0];
  for (const [id, d] of options) {
    r -= d.weight * (id === s.weather.kind ? 2 : 1);
    if (r <= 0) {
      next = id;
      break;
    }
  }
  const changed = next !== s.weather.kind;
  s.weather = { kind: next, until: s.time.minutes + rand.range(WEATHER.minHours, WEATHER.maxHours) * 60 };
  if (changed) {
    bus.emit('weather:changed', next);
    const d = WEATHER.kinds[next];
    // Only weather that changes business is worth interrupting for.
    if (Object.keys(d.demand).length) bus.emit('toast', { text: `${d.icon} ${d.name}. ${d.description}`, kind: 'info' });
  }
}

/** Call once a game hour. */
export function weatherHourly(s: GameState): void {
  if (s.time.minutes >= s.weather.until) rollWeather(s);
}
