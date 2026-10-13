/**
 * Ball-by-ball T20 simulation. Every delivery is a contest between one batter's
 * batting rating and one bowler's bowling rating, nudged by the phase of the
 * innings (powerplay, middle, death) and, in a chase, by the required rate.
 * The output is a full scorecard.
 */
import type { Player } from './types';
import { isBowlingOption } from './xi';
import type { Rng } from './rng';

export interface BatLine {
  playerId: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  out: boolean;
  /** "c Pant b Bumrah", "not out", … */
  how: string;
}

export interface BowlLine {
  playerId: string;
  /** Legal deliveries. */
  balls: number;
  runs: number;
  wickets: number;
  maidens: number;
  dots: number;
  wides: number;
  noBalls: number;
}

export interface FallOfWicket {
  score: number;
  wicket: number;
  /** Legal balls bowled when he fell. */
  ball: number;
  playerId: string;
}

export interface InningsCard {
  team: string;
  runs: number;
  wickets: number;
  /** Legal balls faced. */
  balls: number;
  extras: { wides: number; noBalls: number; byes: number; legByes: number };
  batting: BatLine[];
  didNotBat: string[];
  bowling: BowlLine[];
  fow: FallOfWicket[];
  /** Runs at the end of each over, for a run graph. */
  overs: number[];
}

export interface Catch {
  playerId: string;
  team: string;
}

export interface MatchCard {
  no: number;
  stage: 'league' | 'qualifier1' | 'eliminator' | 'qualifier2' | 'final';
  teams: [string, string];
  tossWinner: string;
  first: InningsCard;
  second: InningsCard;
  winner: string;
  /** "MI won by 24 runs", "CSK won by 6 wickets (8 balls left)". */
  result: string;
  tie: boolean;
  playerOfMatch: string;
  catches: Catch[];
}

export interface Side {
  code: string;
  xi: Player[];
}

export const ballsToOvers = (b: number) => `${Math.floor(b / 6)}${b % 6 ? `.${b % 6}` : ''}`;
export const oversText = (b: number) => `${Math.floor(b / 6)}.${b % 6}`;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function surname(p: Player) {
  const parts = p.name.split(' ');
  return parts.length > 1 ? parts.slice(1).join(' ') : p.name;
}

/** Best batters at the top; bowlers who can't bat at the bottom. */
export function battingOrder(xi: Player[]): Player[] {
  return [...xi].sort((a, b) => b.bat - a.bat);
}

/** Who bowls: the bowling options by quality, with part-timers if short. */
function attack(xi: Player[]): Player[] {
  const opts = xi.filter(isBowlingOption).sort((a, b) => b.bowl - a.bowl);
  const rest = xi.filter((p) => !opts.includes(p)).sort((a, b) => b.bowl - a.bowl);
  return [...opts, ...rest];
}

/** Choose this over's bowler: best for powerplay and death, spread the middle; max 4 overs, never two in a row. */
function pickBowler(bowlers: Player[], used: Map<string, number>, last: string | null, over: number): Player {
  const left = (p: Player) => 4 - (used.get(p.id) ?? 0);
  const remainingOvers = 20 - over;
  const top = bowlers.slice(0, Math.max(5, bowlers.filter(isBowlingOption).length));
  const can = top.filter((p) => left(p) > 0 && p.id !== last);
  // Someone who needs every other over from here on must bowl now.
  const forced = can.find((p) => 2 * left(p) - 1 >= remainingOvers);
  if (forced) return forced;
  if (can.length) {
    const death = over >= 16 || over < 2;
    if (death) return can[0];
    // Middle overs: whoever has most overs left, ties to the better bowler.
    return [...can].sort((a, b) => left(b) - left(a) || b.bowl - a.bowl)[0];
  }
  const part = bowlers.find((p) => left(p) > 0 && p.id !== last);
  return part ?? bowlers.find((p) => p.id !== last) ?? bowlers[0];
}

type Outcome = 'W' | 0 | 1 | 2 | 3 | 4 | 6 | 'wd' | 'nb' | 'lb' | 'b';

function deliver(bat: Player, bowl: Player, over: number, wicketsDown: number, chase: { need: number; ballsLeft: number } | null, rng: Rng): Outcome {
  const d = (bat.bat - bowl.bowl) / 10; // roughly -6..+6
  const tail = bat.bat < 35 ? 1.7 : bat.bat < 50 ? 1.25 : 1;
  const powerplay = over < 6;
  const death = over >= 16;
  // How hard to go: phase, wickets in hand and (in a chase) the asking rate.
  let push = powerplay ? 0.15 : death ? 0.45 : 0;
  if (wicketsDown >= 7) push -= 0.2;
  if (chase) {
    const rrr = chase.ballsLeft > 0 ? (chase.need / chase.ballsLeft) * 6 : 36;
    push += clamp((rrr - 9) * 0.09, -0.35, 0.8);
  }
  const extra = rng();
  if (extra < 0.032) return 'wd';
  if (extra < 0.037) return 'nb';
  let pW = 0.045 * tail * (1 - d * 0.075) * (1 + push * 0.45) * (death ? 1.15 : 1);
  pW = clamp(pW, 0.012, 0.16);
  if (rng() < pW) return 'W';
  const w = {
    0: 0.34 * (1 - d * 0.05) * (1 - push * 0.25),
    1: 0.37 * (1 - push * 0.12),
    2: 0.075,
    3: 0.006,
    4: 0.13 * (1 + d * 0.06) * (1 + push * 0.35) * (powerplay ? 1.15 : 1),
    6: 0.068 * (1 + d * 0.11) * (1 + push * 0.7) * (death ? 1.25 : 1),
    lb: 0.012,
    b: 0.004,
  };
  const total = Object.values(w).reduce((a, b) => a + Math.max(0, b), 0);
  let r = rng() * total;
  for (const [k, v] of Object.entries(w)) {
    r -= Math.max(0, v);
    if (r <= 0) return (k === 'lb' || k === 'b' ? k : Number(k)) as Outcome;
  }
  return 1;
}

function dismissal(_bat: Player, bowler: Player, field: Player[], rng: Rng): { how: string; bowlerCredit: boolean; catcher: Player | null } {
  const r = rng();
  const keeper = field.find((p) => p.role === 'WK');
  const fielder = () => {
    const pool = field.filter((p) => p.id !== bowler.id);
    return pool[Math.floor(rng() * pool.length)] ?? bowler;
  };
  if (r < 0.6) {
    const c = rng() < 0.05 ? bowler : rng() < 0.18 && keeper ? keeper : fielder();
    if (c.id === bowler.id) return { how: `c & b ${surname(bowler)}`, bowlerCredit: true, catcher: c };
    return { how: `c ${c.role === 'WK' ? '†' : ''}${surname(c)} b ${surname(bowler)}`, bowlerCredit: true, catcher: c };
  }
  if (r < 0.78) return { how: `b ${surname(bowler)}`, bowlerCredit: true, catcher: null };
  if (r < 0.9) return { how: `lbw b ${surname(bowler)}`, bowlerCredit: true, catcher: null };
  if (r < 0.95 && keeper) return { how: `st †${surname(keeper)} b ${surname(bowler)}`, bowlerCredit: true, catcher: keeper };
  return { how: `run out (${surname(fielder())})`, bowlerCredit: false, catcher: null };
}

function playInnings(batting: Side, bowling: Side, target: number | null, rng: Rng, catches: Catch[]): InningsCard {
  const order = battingOrder(batting.xi);
  const bowlers = attack(bowling.xi);
  const lines = new Map<string, BatLine>();
  const bl = new Map<string, BowlLine>();
  const line = (p: Player) => {
    if (!lines.has(p.id)) lines.set(p.id, { playerId: p.id, runs: 0, balls: 0, fours: 0, sixes: 0, out: false, how: 'not out' });
    return lines.get(p.id)!;
  };
  const bline = (p: Player) => {
    if (!bl.has(p.id)) bl.set(p.id, { playerId: p.id, balls: 0, runs: 0, wickets: 0, maidens: 0, dots: 0, wides: 0, noBalls: 0 });
    return bl.get(p.id)!;
  };
  const extras = { wides: 0, noBalls: 0, byes: 0, legByes: 0 };
  const fow: FallOfWicket[] = [];
  const overs: number[] = [];
  let runs = 0, wkts = 0, legal = 0;
  let striker = 0, nonStriker = 1, next = 2;
  line(order[0]);
  line(order[1]);
  const used = new Map<string, number>();
  let last: string | null = null;
  const done = () => wkts >= 10 || legal >= 120 || (target !== null && runs >= target);

  for (let over = 0; over < 20 && !done(); over++) {
    const bowler = pickBowler(bowlers, used, last, over);
    used.set(bowler.id, (used.get(bowler.id) ?? 0) + 1);
    last = bowler.id;
    const b = bline(bowler);
    let overRuns = 0;
    let legalThisOver = 0;
    while (legalThisOver < 6 && !done()) {
      const bat = order[striker];
      const chase = target !== null ? { need: target - runs, ballsLeft: 120 - legal } : null;
      const o = deliver(bat, bowler, over, wkts, chase, rng);
      if (o === 'wd' || o === 'nb') {
        runs += 1;
        overRuns += 1;
        b.runs += 1;
        if (o === 'wd') { extras.wides++; b.wides++; } else { extras.noBalls++; b.noBalls++; }
        continue;
      }
      legal++;
      legalThisOver++;
      b.balls++;
      const L = line(bat);
      L.balls++;
      if (o === 'W') {
        const d = dismissal(bat, bowler, bowling.xi, rng);
        L.out = true;
        L.how = d.how;
        if (d.bowlerCredit) b.wickets++;
        if (d.catcher && d.how.startsWith('c')) catches.push({ playerId: d.catcher.id, team: bowling.code });
        if (d.how.startsWith('st')) catches.push({ playerId: d.catcher!.id, team: bowling.code });
        b.dots++;
        wkts++;
        fow.push({ score: runs, wicket: wkts, ball: legal, playerId: bat.id });
        if (wkts < 10 && next < order.length) {
          striker = next++;
          line(order[striker]);
        }
      } else if (o === 'lb' || o === 'b') {
        runs += 1;
        overRuns += 1;
        if (o === 'lb') extras.legByes++; else extras.byes++;
        b.dots++;
        [striker, nonStriker] = [nonStriker, striker];
      } else {
        runs += o;
        overRuns += o;
        b.runs += o;
        L.runs += o;
        if (o === 4) L.fours++;
        if (o === 6) L.sixes++;
        if (o === 0) b.dots++;
        if (o % 2 === 1) [striker, nonStriker] = [nonStriker, striker];
      }
    }
    if (overRuns === 0 && legalThisOver === 6) b.maidens++;
    overs.push(runs);
    [striker, nonStriker] = [nonStriker, striker];
  }

  const batted = new Set(lines.keys());
  return {
    team: batting.code,
    runs,
    wickets: wkts,
    balls: legal,
    extras,
    batting: order.filter((p) => batted.has(p.id)).map((p) => lines.get(p.id)!),
    didNotBat: order.filter((p) => !batted.has(p.id)).map((p) => p.id),
    bowling: [...bl.values()],
    fow,
    overs,
  };
}

/** Player of the match: biggest all-round impact, a little extra for the winners. */
function playerOfMatch(m: Omit<MatchCard, 'playerOfMatch'>): string {
  const score = new Map<string, number>();
  const add = (id: string, v: number) => score.set(id, (score.get(id) ?? 0) + v);
  for (const inn of [m.first, m.second]) {
    const bowlingTeam = inn.team === m.teams[0] ? m.teams[1] : m.teams[0];
    for (const b of inn.batting) add(b.playerId, (b.runs + b.fours + b.sixes * 2 + (b.balls > 8 ? (b.runs / b.balls - 1.3) * 12 : 0)) * (inn.team === m.winner ? 1.2 : 1));
    for (const b of inn.bowling) {
      const econ = b.balls ? (b.runs / b.balls) * 6 : 12;
      add(b.playerId, (b.wickets * 25 + b.dots * 1 + (b.balls >= 12 ? (8.5 - econ) * 4 : 0)) * (bowlingTeam === m.winner ? 1.2 : 1));
    }
  }
  for (const c of m.catches) add(c.playerId, 8);
  return [...score.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? m.first.batting[0].playerId;
}

export function playMatch(a: Side, b: Side, no: number, stage: MatchCard['stage'], rng: Rng): MatchCard {
  const tossWinner = rng() < 0.5 ? a.code : b.code;
  // Most captains chase.
  const bowlFirst = rng() < 0.7;
  const [first, second] = (tossWinner === a.code) !== bowlFirst ? [a, b] : [b, a];
  const catches: Catch[] = [];
  const i1 = playInnings(first, second, null, rng, catches);
  const i2 = playInnings(second, first, i1.runs + 1, rng, catches);
  let winner: string;
  let result: string;
  let tie = false;
  if (i2.runs > i1.runs) {
    winner = second.code;
    const w = 10 - i2.wickets;
    const left = 120 - i2.balls;
    result = `${winner} won by ${w} wicket${w === 1 ? '' : 's'}${left > 0 ? ` (${left} ball${left === 1 ? '' : 's'} left)` : ''}`;
  } else if (i2.runs < i1.runs) {
    winner = first.code;
    const r = i1.runs - i2.runs;
    result = `${winner} won by ${r} run${r === 1 ? '' : 's'}`;
  } else {
    tie = true;
    winner = rng() < 0.5 ? first.code : second.code;
    result = `Match tied · ${winner} won the Super Over`;
  }
  const base = { no, stage, teams: [a.code, b.code] as [string, string], tossWinner, first: i1, second: i2, winner, result, tie, catches };
  return { ...base, playerOfMatch: playerOfMatch(base) };
}
