import type { Player } from './types';

export interface XIResult {
  players: Player[];
  batting: number;
  bowling: number;
  rating: number;
  hasKeeper: boolean;
  bowlingOptions: number;
  overseas: number;
  /** How many made-up local players had to be drafted in because the squad was short. */
  fillers: number;
}

export const XI_RULES = { keepers: 1, bowlingOptions: 5 };

export function isBowlingOption(p: Player): boolean {
  return p.role === 'BOWL' || p.role === 'AR' || p.bowl >= 60;
}

const BAT_W = [1.2, 1.15, 1.1, 1.05, 1, 0.9, 0.8, 0.35, 0.25, 0.15, 0.1];
const BOWL_W = [1.2, 1.1, 1, 1, 0.9];

export function battingRating(xi: Player[]): number {
  const bats = xi.map((p) => p.bat).sort((a, b) => b - a);
  let s = 0, w = 0;
  BAT_W.forEach((wt, i) => { s += (bats[i] ?? 20) * wt; w += wt; });
  return s / w;
}

export function bowlingRating(xi: Player[]): number {
  const opts = xi.filter(isBowlingOption).map((p) => p.bowl).sort((a, b) => b - a);
  let s = 0, w = 0;
  BOWL_W.forEach((wt, i) => { s += (opts[i] ?? 30) * wt; w += wt; });
  const sixth = opts[5] ? Math.max(0, opts[5] - 55) * 0.05 : 0;
  return s / w + sixth;
}

function objective(xi: Player[]): number {
  const bat = battingRating(xi), bowl = bowlingRating(xi);
  const keeper = xi.some((p) => p.role === 'WK') ? 0 : 50;
  const missingBowl = Math.max(0, XI_RULES.bowlingOptions - xi.filter(isBowlingOption).length) * 20;
  return (bat + bowl) / 2 - keeper - missingBowl;
}

function filler(i: number): Player {
  const bowler = i % 2 === 0;
  return {
    id: `filler-${i}`,
    name: bowler ? 'Local net bowler' : 'Local club batter',
    role: bowler ? 'BOWL' : 'BAT',
    country: 'IND',
    overseas: false,
    bat: bowler ? 15 : 45,
    bowl: bowler ? 45 : 10,
    overall: 45,
    basePriceLakh: 20,
    team2026: null,
    history: [],
  };
}

/**
 * Best legal XI: at least one keeper, five bowling options and no more than
 * `maxOverseas` overseas players. Greedy start, then swap until nothing improves.
 */
export function bestXI(squad: Player[], maxOverseas = 4): XIResult {
  const pool = squad.slice();
  const usableOverseas = Math.min(maxOverseas, pool.filter((p) => p.overseas).length);
  let fillers = 0;
  while (pool.filter((p) => !p.overseas).length + usableOverseas < 11) pool.push(filler(fillers++));

  const sorted = pool.slice().sort((a, b) => Math.max(b.bat, b.bowl) - Math.max(a.bat, a.bowl));
  const xi: Player[] = [];
  const bench: Player[] = [];
  for (const p of sorted) {
    const os = xi.filter((x) => x.overseas).length;
    if (xi.length < 11 && (!p.overseas || os < maxOverseas)) xi.push(p);
    else bench.push(p);
  }

  let best = objective(xi);
  for (let pass = 0; pass < 60; pass++) {
    let improved = false;
    for (let i = 0; i < xi.length && !improved; i++) {
      for (let j = 0; j < bench.length && !improved; j++) {
        const trial = xi.slice();
        trial[i] = bench[j];
        if (trial.filter((x) => x.overseas).length > maxOverseas) continue;
        const score = objective(trial);
        if (score > best + 1e-9) {
          const out = xi[i];
          xi[i] = bench[j];
          bench[j] = out;
          best = score;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  const order = { WK: 1, BAT: 0, AR: 2, BOWL: 3 } as const;
  xi.sort((a, b) => order[a.role] - order[b.role] || b.bat - a.bat);
  const batting = battingRating(xi);
  const bowling = bowlingRating(xi);
  return {
    players: xi,
    batting: Math.round(batting * 10) / 10,
    bowling: Math.round(bowling * 10) / 10,
    rating: Math.round(((batting + bowling) / 2) * 10) / 10,
    hasKeeper: xi.some((p) => p.role === 'WK'),
    bowlingOptions: xi.filter(isBowlingOption).length,
    overseas: xi.filter((p) => p.overseas).length,
    fillers: xi.filter((p) => p.id.startsWith('filler-')).length,
  };
}
