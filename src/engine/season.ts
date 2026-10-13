import type { AuctionState, GameMode, Player, Rules, TeamState } from './types';
import { bestXI, type XIResult } from './xi';
import { makeRng, shuffle, type Rng } from './rng';
import { battingOrder, playMatch, type InningsCard, type MatchCard } from './match';
import { unsoldPlayers } from './auction';
import { undrafted, type DraftState } from './draft';
import { fairValueLakh } from './pool';

export interface TableRow {
  code: string;
  played: number;
  won: number;
  lost: number;
  noResult: number;
  points: number;
  runsFor: number;
  ballsFaced: number;
  runsAgainst: number;
  ballsBowled: number;
  nrr: number;
  /** Last five results, newest last: 'W' or 'L'. */
  form: ('W' | 'L')[];
}

export interface SeasonResult {
  matches: MatchCard[];
  league: MatchCard[];
  playoffs: MatchCard[];
  table: TableRow[];
  final: MatchCard;
  champion: string;
  runnerUp: string;
  /** Everyone who played, including local fill-ins. */
  people: Record<string, Player>;
  /** Which team each player played for. */
  teamOf: Record<string, string>;
  /** Each team's XI in batting order. */
  lineups: Record<string, Player[]>;
}

/** Old-style strength summary, still used for awards and quick comparisons. */
export interface Strength {
  code: string;
  bat: number;
  bowl: number;
}

function emptyRow(code: string): TableRow {
  return { code, played: 0, won: 0, lost: 0, noResult: 0, points: 0, runsFor: 0, ballsFaced: 0, runsAgainst: 0, ballsBowled: 0, nrr: 0, form: [] };
}

/** All-out innings count as the full 20 overs for NRR, as in the real thing. */
function nrrBalls(i: InningsCard): number {
  return i.wickets === 10 ? 120 : i.balls;
}

/**
 * IPL-style league fixtures: up to 8 teams play everyone twice (14 games for 8).
 * With 9–11 teams everyone plays everyone once, plus a second game against a few
 * neighbours, so each team still plays 14 (as in the 10-team IPL).
 */
export function leagueFixtures(codes: string[], rng: Rng): [string, string][] {
  const n = codes.length;
  const out: [string, string][] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) out.push([codes[i], codes[j]]);
  if (n <= 8) {
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) out.push([codes[j], codes[i]]);
  } else {
    const extra = Math.max(0, 14 - (n - 1));
    const seen = new Set<string>();
    const add = (i: number, j: number) => {
      const key = [Math.min(i, j), Math.max(i, j)].join('-');
      if (i === j || seen.has(key)) return;
      seen.add(key);
      out.push([codes[j], codes[i]]);
    };
    for (let i = 0; i < n; i++) {
      for (let k = 1; k <= Math.floor(extra / 2); k++) add(i, (i + k) % n);
      if (extra % 2 === 1 && n % 2 === 0) add(i, (i + n / 2) % n);
    }
  }
  return shuffle(out, rng);
}

export function playSeason(results: TeamResult[], seed: number): SeasonResult {
  const rng = makeRng(seed);
  const sides = new Map(results.map((r) => [r.code, { code: r.code, xi: battingOrder(r.xi.players) }]));
  const people: Record<string, Player> = {};
  const teamOf: Record<string, string> = {};
  const lineups: Record<string, Player[]> = {};
  // Give local fill-ins team-specific ids so their stats don't merge across teams.
  for (const r of results) {
    for (const p of r.squad) people[p.id] = p;
    const s = sides.get(r.code)!;
    s.xi = s.xi.map((p) => (p.id.startsWith('filler-') ? { ...p, id: `${r.code}:${p.id}` } : p));
    lineups[r.code] = s.xi;
    for (const p of s.xi) {
      people[p.id] = p;
      teamOf[p.id] = r.code;
    }
    for (const p of r.squad) teamOf[p.id] = r.code;
  }

  const rows = new Map(results.map((r) => [r.code, emptyRow(r.code)]));
  const league: MatchCard[] = [];
  let no = 0;
  for (const [x, y] of leagueFixtures(results.map((r) => r.code), rng)) {
    const m = playMatch(sides.get(x)!, sides.get(y)!, ++no, 'league', rng);
    league.push(m);
    for (const [inn, opp] of [[m.first, m.second], [m.second, m.first]] as const) {
      const r = rows.get(inn.team)!;
      r.played++;
      r.runsFor += inn.runs;
      r.ballsFaced += nrrBalls(inn);
      r.runsAgainst += opp.runs;
      r.ballsBowled += nrrBalls(opp);
      const won = m.winner === inn.team;
      if (won) { r.won++; r.points += 2; } else r.lost++;
      r.form = [...r.form, won ? 'W' : 'L'].slice(-5) as ('W' | 'L')[];
    }
  }
  const table = [...rows.values()].map((r) => ({
    ...r,
    nrr: r.ballsFaced && r.ballsBowled ? Math.round(((r.runsFor / r.ballsFaced) * 6 - (r.runsAgainst / r.ballsBowled) * 6) * 1000) / 1000 : 0,
  }));
  table.sort((a, b) => b.points - a.points || b.nrr - a.nrr);

  const side = (c: string) => sides.get(c)!;
  const playoffs: MatchCard[] = [];
  let final: MatchCard;
  if (table.length >= 4) {
    const [t1, t2, t3, t4] = table.map((r) => r.code);
    const q1 = playMatch(side(t1), side(t2), ++no, 'qualifier1', rng);
    const el = playMatch(side(t3), side(t4), ++no, 'eliminator', rng);
    const q1Loser = q1.winner === t1 ? t2 : t1;
    const q2 = playMatch(side(q1Loser), side(el.winner), ++no, 'qualifier2', rng);
    final = playMatch(side(q1.winner), side(q2.winner), ++no, 'final', rng);
    playoffs.push(q1, el, q2, final);
  } else {
    final = playMatch(side(table[0].code), side(table[1].code), ++no, 'final', rng);
    playoffs.push(final);
  }
  const runnerUp = final.teams[0] === final.winner ? final.teams[1] : final.teams[0];
  return { matches: [...league, ...playoffs], league, playoffs, table, final, champion: final.winner, runnerUp, people, teamOf, lineups };
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
  /** Short line under the winner, ready to show. */
  detail: string;
}

/** Everything the results screen needs, from either an auction or a draft. */
export interface ResultSource {
  mode: GameMode;
  teams: TeamState[];
  players: Record<string, Player>;
  rules: Rules;
  /** Every player bought or picked, with what was paid. */
  buys: { playerId: string; team: string; priceLakh: number }[];
  /** Players nobody took. */
  leftover: Player[];
}

export function auctionSource(state: AuctionState): ResultSource {
  return {
    mode: 'auction',
    teams: state.teams,
    players: state.players,
    rules: state.rules,
    buys: state.log.flatMap((l) => (l.kind === 'sold' ? [{ playerId: l.playerId, team: l.team, priceLakh: l.priceLakh }] : [])),
    leftover: unsoldPlayers(state),
  };
}

export function draftSource(state: DraftState): ResultSource {
  return {
    mode: 'draft',
    teams: state.teams,
    players: state.players,
    rules: state.rules,
    // From the final squads: RTM auctions can move players and change what was paid.
    buys: state.teams.flatMap((t) => t.squad.map((e) => ({ playerId: e.playerId, team: t.code, priceLakh: e.priceLakh }))),
    leftover: undrafted(state),
  };
}

export function teamResults(src: Pick<ResultSource, 'teams' | 'players' | 'rules'>): TeamResult[] {
  return src.teams.map((t) => {
    const squad = t.squad.map((e) => src.players[e.playerId]);
    return { code: t.code, squad, xi: bestXI(squad, src.rules.overseasXI) };
  });
}

export function strengths(results: TeamResult[]): Strength[] {
  return results.map((r) => ({ code: r.code, bat: r.xi.batting, bowl: r.xi.bowling }));
}

const money = (lakh: number) => (lakh >= 100 ? `₹${+(lakh / 100).toFixed(2)} Cr` : `₹${lakh} L`);

export function awards(src: ResultSource, results: TeamResult[]): Award[] {
  const out: Award[] = [];
  const draft = src.mode === 'draft';
  if (src.buys.length) {
    const top = src.buys.reduce((a, b) => (b.priceLakh > a.priceLakh ? b : a));
    out.push({
      title: draft ? 'Costliest pick' : 'Costliest buy',
      player: src.players[top.playerId],
      team: top.team,
      detail: `${money(top.priceLakh)} to ${top.team}`,
    });
    const scale = src.rules.purseCr / 100;
    // Biggest gap between what the rating says a player is worth and what was paid.
    const surplus = (l: (typeof src.buys)[number]) => fairValueLakh(src.players[l.playerId].overall) * scale - l.priceLakh;
    const steal = src.buys.reduce((a, b) => (surplus(b) > surplus(a) ? b : a));
    out.push({
      title: draft ? 'Best value pick' : 'Steal of the auction',
      player: src.players[steal.playerId],
      team: steal.team,
      detail: `${money(steal.priceLakh)} to ${steal.team}`,
    });
  }
  const strongest = results.reduce((a, b) => (b.xi.rating > a.xi.rating ? b : a));
  out.push({ title: 'Strongest XI', team: strongest.code, detail: `XI rating ${strongest.xi.rating}` });
  const left = [...src.leftover].sort((a, b) => b.overall - a.overall)[0];
  if (left)
    out.push({
      title: draft ? 'Best player nobody picked' : 'Best unsold player',
      player: left,
      detail: draft ? `Overall ${left.overall}, ${money(left.price2026Lakh ?? left.basePriceLakh)} was too rich` : `Overall ${left.overall}, nobody bit`,
    });
  return out;
}
