export interface Skills {
  /** 1-10 each. */
  speed: number;
  friendliness: number;
  reliability: number;
}

/** Someone on the job market. */
export interface Candidate {
  id: number;
  name: string;
  role: string;
  skills: Skills;
  traits: string[];
  /** Hourly wage they ask for. */
  wage: number;
  look: number;
}

export interface Employee extends Candidate {
  shopId: number | null;
  /** Object id of the station they are assigned to, or null to choose automatically. */
  stationId: number | null;
  /** Working hours [from, to). */
  shift: [number, number];
  /** 0-100. */
  energy: number;
  morale: number;
  /** What the market would pay someone like them; the yardstick for whether their wage feels fair. */
  fairWage: number;
  hoursWorked: number;
  /** Day number they are off sick, if any. */
  absentDay: number;
  hiredDay: number;
}

export function shiftLength(shift: [number, number]): number {
  const [from, to] = shift;
  return to > from ? to - from : 24 - from + to;
}

export function inShift(shift: [number, number], hour: number): boolean {
  const [from, to] = shift;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}
