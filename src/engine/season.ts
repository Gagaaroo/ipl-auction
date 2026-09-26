import type { AuctionState, Player } from './types';
import { bestXI, type XIResult } from './xi';
import { gauss, makeRng, type Rng } from './rng';
import { unsoldPlayers } from './auction';
import { fairValueLakh } from './pool';

export interface Innings {
  team: string;
  runs: number;
  wickets: number;
  balls: number;
}

export interface MatchResult {
  first: Innings;
  second: Innings;
  winner: string;
  summary: string;
}

export interface TableRow {
  code: string;
  played: number;
  won: number;
  lost: number;
  points: number;
  runsFor: number;
  ballsFaced: number;
  runsAgainst: number;
  ballsBowled: number;
  nrr: number;
}

export interface SeasonResult {
  matches: MatchResult[];
  table: TableRow[];
  final: MatchResult;
  champion: string;
}

export interface Strength {
  code: string;
  bat: number;
  bowl: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function potential(bat: number, oppBowl: number, rng: Rng) {
  const runs = Math.round(clamp(165 + (bat - oppBowl) * 1.8 + gauss(rng) * 20, 85, 265));
  const wickets = Math.round(clamp(6 + (oppBowl - bat) * 0.12 + gauss(rng) * 2, 1, 10));
  return { runs, wickets };
}

export function oversText(balls: number): string {
  return `${Math.floor(balls / 6)}.${balls % 6}`;
}

export function simulateMatch(a: Strength, b: Strength, rng: Rng): MatchResult {
  const [bat1, bat2] = rng() < 0.5 ? [a, b] : [b, a];
  const p1 = potential(bat1.bat, bat2.bowl, rng);
  const first: Innings = {
    team: bat1.code,
    runs: p1.runs,
    wickets: p1.wickets,
    balls: p1.wickets === 10 ? 96 + Math.floor(rng() * 24) : 120,
  };
  const target = first.runs + 1;
  const p2 = potential(bat2.bat, bat1.bowl, rng);
  let second: Innings;
  let winner: string;
  let summary: string;
  if (p2.runs >= target) {
    const wk = Math.min(9, Math.floor(p2.wickets * (target / p2.runs) * (0.4 + rng() * 0.6)));
    const balls = clamp(Math.round((120 * target) / p2.runs) - Math.floor(rng() * 4), 50, 120);
    second = { team: bat2.code, runs: target + (rng() < 0.2 ? Math.floor(rng() * 5) : 0), wickets: wk, balls };
    winner = bat2.code;
    summary = `${bat2.code} won by ${10 - wk} wicket${10 - wk === 1 ? '' : 's'}`;
  } else {
    second = { team: bat2.code, runs: p2.runs, wickets: p2.wickets, balls: p2.wickets === 10 ? 96 + Math.floor(rng() * 24) : 120 };
    if (p2.runs === first.runs) {
      winner = rng() < 0.5 ? bat1.code : bat2.code;
      summary = `Tied — ${winner} won the super over`;
    } else {
      winner = bat1.code;
      const m = first.runs - p2.runs;
      summary = `${bat1.code} won by ${m} run${m === 1 ? '' : 's'}`;
    }
  }
  return { first, second, winner, summary };
}

function emptyRow(code: string): TableRow {
  return { code, played: 0, won: 0, lost: 0, points: 0, runsFor: 0, ballsFaced: 0, runsAgainst: 0, ballsBowled: 0, nrr: 0 };
}

/** All-out innings count as the full 20 overs for NRR, as in the real thing. */
function nrrBalls(i: Innings): number {
  return i.wickets === 10 ? 120 : i.balls;
}

export function simulateSeason(teams: Strength[], seed: number): SeasonResult {
  const rng = makeRng(seed);
  const rows = new Map(teams.map((t) => [t.code, emptyRow(t.code)]));
  const legs = teams.length <= 5 ? 2 : 1;
  const matches: MatchResult[] = [];
  for (let leg = 0; leg < legs; leg++) {
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        const m = simulateMatch(teams[i], teams[j], rng);
        matches.push(m);
        for (const [inn, opp] of [[m.first, m.second], [m.second, m.first]] as const) {
          const r = rows.get(inn.team)!;
          r.played++;
          r.runsFor += inn.runs;
          r.ballsFaced += nrrBalls(inn);
          r.runsAgainst += opp.runs;
          r.ballsBowled += nrrBalls(opp);
          if (m.winner === inn.team) { r.won++; r.points += 2; } else r.lost++;
        }
      }
    }
  }
  const table = [...rows.values()].map((r) => ({
    ...r,
    nrr: Math.round(((r.runsFor / r.ballsFaced) * 6 - (r.runsAgainst / r.ballsBowled) * 6) * 1000) / 1000,
  }));
  table.sort((x, y) => y.points - x.points || y.nrr - x.nrr);
  const byCode = new Map(teams.map((t) => [t.code, t]));
  const final = simulateMatch(byCode.get(table[0].code)!, byCode.get(table[1].code)!, rng);
  return { matches, table, final, champion: final.winner };
}

// ---------- results & awards ----------

export interface TeamResult {
  code: string;
  squad: Player[];
  xi: XIResult;
}

export interface Award {
  title: string;
  player?: Player;
  team?: string;
  detail: string;
}

export function teamResults(state: AuctionState): TeamResult[] {
  return state.teams.map((t) => {
    const squad = t.squad.map((e) => state.players[e.playerId]);
    return { code: t.code, squad, xi: bestXI(squad, state.rules.overseasXI) };
  });
}

export function strengths(results: TeamResult[]): Strength[] {
  return results.map((r) => ({ code: r.code, bat: r.xi.batting, bowl: r.xi.bowling }));
}

export function awards(state: AuctionState, results: TeamResult[]): Award[] {
  const out: Award[] = [];
  const buys = state.log.flatMap((l) => (l.kind === 'sold' ? [l] : []));
  if (buys.length) {
    const top = buys.reduce((a, b) => (b.priceLakh > a.priceLakh ? b : a));
    out.push({ title: 'Costliest buy', player: state.players[top.playerId], team: top.team, detail: `${top.priceLakh}` });
    const scale = state.rules.purseCr / 100;
    // Biggest gap between what the rating says a player is worth and what was paid.
    const surplus = (l: (typeof buys)[number]) => fairValueLakh(state.players[l.playerId].overall) * scale - l.priceLakh;
    const steal = buys.reduce((a, b) => (surplus(b) > surplus(a) ? b : a));
    out.push({ title: 'Steal of the auction', player: state.players[steal.playerId], team: steal.team, detail: `${steal.priceLakh}` });
  }
  const strongest = results.reduce((a, b) => (b.xi.rating > a.xi.rating ? b : a));
  out.push({ title: 'Strongest XI', team: strongest.code, detail: `${strongest.xi.rating}` });
  const unsold = unsoldPlayers(state).sort((a, b) => b.overall - a.overall)[0];
  if (unsold) out.push({ title: 'Best unsold player', player: unsold, detail: `${unsold.overall}` });
  return out;
}
