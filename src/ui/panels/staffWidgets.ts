import { EMPLOYEES } from '../../data';
import type { Candidate } from '../../entities/Employee';
import { skill } from '../../systems/staff/staff';
import { h } from '../dom';

const SKILL_TIPS = {
  speed: 'Speed: how fast they work.',
  friendliness: 'Friendliness: how customers feel after dealing with them.',
  reliability: 'Reliability: how rarely they miss a shift.',
} as const;

/** Three small bars for speed, friendliness and reliability. */
export function skillBars(p: Candidate): HTMLElement {
  return h(
    'div.skills',
    ...(['speed', 'friendliness', 'reliability'] as const).map((k) => {
      const v = skill(p, k);
      return h('div.skill', { tip: `${SKILL_TIPS[k]}\n${v} / 10` }, h('span', k[0].toUpperCase()), h('div.meter', h('div', { style: { width: `${v * 10}%`, background: v >= 7 ? 'var(--accent)' : v >= 4 ? 'var(--info)' : 'var(--warn)' } })));
    }),
  );
}

export function traitTags(p: Candidate): HTMLElement[] {
  return p.traits
    .filter((t) => !EMPLOYEES.traits[t].hidden)
    .map((t) => h('span.trait', { tip: EMPLOYEES.traits[t].description }, EMPLOYEES.traits[t].name));
}

export function roleTag(role: string): HTMLElement {
  const r = EMPLOYEES.roles[role];
  return h('span.tag', { style: { background: r.color }, tip: r.description }, r.name);
}
