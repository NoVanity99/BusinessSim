import type { GameState } from '../../core/state';
import { EVENTS, SEASONS, type HolidayDef, type SeasonDef } from '../../data';
import { dayOf } from '../time/clock';

/** Days in a year: four seasons. */
export const YEAR_DAYS = SEASONS.daysPerSeason * SEASONS.seasons.length;

/** 1-based day of the year for a day number. */
export const dayOfYear = (day: number): number => ((day - 1) % YEAR_DAYS) + 1;
export const yearOf = (day: number): number => Math.floor((day - 1) / YEAR_DAYS) + 1;

export const seasonOnDay = (day: number): SeasonDef => SEASONS.seasons[Math.floor((dayOfYear(day) - 1) / SEASONS.daysPerSeason)];
export const seasonOf = (s: GameState): SeasonDef => seasonOnDay(dayOf(s.time));

/** Day within the current season, 1-based. */
export const dayOfSeason = (s: GameState): number => ((dayOfYear(dayOf(s.time)) - 1) % SEASONS.daysPerSeason) + 1;

/** Holidays that fall on a day of the game. */
export const holidaysOn = (day: number): HolidayDef[] => EVENTS.holidays.filter((h) => h.day === dayOfYear(day));

/** The next holiday after today that is worth planning for (not the weekly market), with days to go. */
export function nextHoliday(s: GameState): { holiday: HolidayDef; inDays: number } | null {
  const today = dayOf(s.time);
  for (let d = 1; d <= YEAR_DAYS; d++) {
    const h = holidaysOn(today + d).find((x) => Object.keys(x.demand).length > 0);
    if (h) return { holiday: h, inDays: d };
  }
  return null;
}

/** How much more (or less) people want a kind of shop because of the season and any holiday today. */
export function calendarDemand(s: GameState, shopType: string): number {
  let m = seasonOf(s).demand[shopType] ?? 1;
  for (const h of holidaysOn(dayOf(s.time))) m *= h.demand[shopType] ?? 1;
  return m;
}

/** Seasonal appetite for a product: coats in winter, sunscreen in summer. */
export const seasonProductBoost = (s: GameState, product: string): number => seasonOf(s).products[product] ?? 1;

/** How many people are out, from the season and any holiday. */
export function calendarCrowd(s: GameState): number {
  let m = seasonOf(s).crowd;
  for (const h of holidaysOn(dayOf(s.time))) m *= h.crowd;
  return m;
}

/** On sale days shoppers are choosier about price. */
export const calendarPriceSense = (s: GameState): number => holidaysOn(dayOf(s.time)).reduce((m, h) => m * (h.priceSense ?? 1), 1);
