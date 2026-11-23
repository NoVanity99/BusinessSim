/**
 * Facts about the character looks that game logic needs. Kept apart from the art code so
 * the simulation (and the headless tests) can use them without loading any images.
 * actorArt.ts draws the looks to match.
 */
export const LOOK_COUNT = 72;
/** Source characters in the art pack; look index modulo this picks one. Index 3 is the hard-hat worker. */
export const LOOK_BASES = 6;

export type AgeGroup = 'child' | 'adult' | 'senior';

/** One in six looks is a child, one in seven a senior; the worker is always an adult. */
export function ageOfLook(look: number): AgeGroup {
  const base = look % LOOK_BASES;
  if (base !== 3 && look % 6 === 4) return 'child';
  if (look % 7 === 5) return 'senior';
  return 'adult';
}

const all = Array.from({ length: LOOK_COUNT }, (_v, i) => i);
export const CHILD_LOOKS = all.filter((l) => ageOfLook(l) === 'child');
export const ADULT_LOOKS = all.filter((l) => ageOfLook(l) !== 'child');
