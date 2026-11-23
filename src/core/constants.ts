/** Size of one map tile in world pixels. */
export const TILE = 32;
/** Real seconds per game minute at 1x speed (a full day takes 24 real minutes). */
export const SECONDS_PER_GAME_MINUTE = 1;
export const MINUTES_PER_DAY = 24 * 60;
export const DAYS_PER_WEEK = 7;
export const SPEEDS = [0, 1, 2, 4] as const;
/** Current save format. Raised by adding a step to src/systems/save/migrations.ts. */
export const SAVE_VERSION = 10;
