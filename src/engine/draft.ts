/**
 * The real-price draft. Every current IPL player carries his 2026 contract price.
 * Teams take turns (snake order) picking one player at a time, and that price
 * comes straight off the picking team's purse. No bidding.
 */
import type { Player, PlayerRecord, Role, Rules, TeamDef, TeamState } from './types';
import { withIds } from './pool';
import { hashString, makeRng, shuffle, type Rng } from './rng';

export interface DraftTeamEntry {
  def: TeamDef;
  human: boolean;
}

export interface DraftPick {
  pickNo: number;
  round: number;
  team: string;
  playerId: string;
  priceLakh: number;
  /** Picked by the computer on a human team's behalf. */
  auto: boolean;
}

export interface DraftState {
  kind: 'draft';
  version: 1;
  seed: number;
  rules: Rules;
  players: Record<string, Player>;
  teams: TeamState[];
  /** Round 1 picking order (team codes). Even rounds run in reverse. */
  order: string[];
  /** Player ids still on the board. */
  available: string[];
  picks: DraftPick[];
  round: number;
  /** Position within this round's order. */
  slot: number;
  /** Teams that have stopped picking: squad full, out of money, or chose to finish. */
  closed: string[];
  /** Money held back per still-needed minimum-squad slot: the cheapest price on the board at the start. */
  reserveLakh: number;
  finished: boolean;
}

export interface DraftConfig {
  rules: Rules;
  teams: DraftTeamEntry[];
  players: PlayerRecord[];
  seed: number;
}

/** What a pick costs: the real 2026 price, or the base price for imported players without one. */
export function priceOf(p: Pick<PlayerRecord, 'price2026Lakh' | 'basePriceLakh'>): number {
  return p.price2026Lakh ?? p.basePriceLakh;
}

/** Current IPL players (those with a 2026 price). An imported list with no prices uses everyone. */
export function draftPool<T extends PlayerRecord>(players: T[]): T[] {
  const priced = players.filter((p) => p.price2026Lakh != null);
  return priced.length ? priced : players;
}

export function createDraft(cfg: DraftConfig): DraftState {
  const rng = makeRng(cfg.seed);
  const pool = withIds(draftPool(cfg.players));
  const players: Record<string, Player> = {};
  for (const p of pool) players[p.id] = p;
  const purse = cfg.rules.purseCr * 100;
  const teams: TeamState[] = cfg.teams.map((t) => ({
    ...t.def,
    human: t.human,
    aggression: Math.round((0.85 + rng() * 0.3) * 100) / 100,
    purseLakh: purse,
    squad: [],
  }));
  const available = pool
    .slice()
    .sort((a, b) => priceOf(b) - priceOf(a) || b.overall - a.overall)
    .map((p) => p.id);
  const reserveLakh = Math.min(...pool.map(priceOf));
  const state: DraftState = {
    kind: 'draft',
    version: 1,
    seed: cfg.seed,
    rules: cfg.rules,
    players,
    teams,
    order: shuffle(teams.map((t) => t.code), rng),
    available,
    picks: [],
    round: 1,
    slot: 0,
    closed: [],
    reserveLakh: Number.isFinite(reserveLakh) ? reserveLakh : 20,
    finished: false,
  };
  return settle(state);
}

// ---------- queries ----------

export function roundOrder(state: DraftState, round = state.round): string[] {
  return round % 2 === 1 ? state.order : [...state.order].reverse();
}

export function draftTeam(state: DraftState, code: string): TeamState {
  const t = state.teams.find((x) => x.code === code);
  if (!t) throw new Error(`Unknown team ${code}`);
  return t;
}

/** The team whose turn it is, or null once the draft is over. */
export function onTheClock(state: DraftState): string | null {
  if (state.finished) return null;
  return roundOrder(state)[state.slot] ?? null;
}

export function overseasIn(state: DraftState, t: TeamState): number {
  return t.squad.filter((e) => state.players[e.playerId]?.overseas).length;
}

/** Most a team can pay for its next pick and still afford its minimum squad. */
export function draftMaxSpend(state: DraftState, t: TeamState): number {
  const stillNeeded = Math.max(0, state.rules.squadMin - (t.squad.length + 1));
  return t.purseLakh - stillNeeded * state.reserveLakh;
}

export type PickBlock = 'finished' | 'not-your-turn' | 'taken' | 'squad-full' | 'overseas-full' | 'purse';

/** Why a team can't take this player right now (ignoring whose turn it is unless `checkTurn`). */
export function pickBlock(state: DraftState, code: string, playerId: string, checkTurn = true): PickBlock | null {
  if (state.finished) return 'finished';
  if (checkTurn && onTheClock(state) !== code) return 'not-your-turn';
  if (!state.available.includes(playerId)) return 'taken';
  const t = draftTeam(state, code);
  const p = state.players[playerId];
  if (t.squad.length >= state.rules.squadMax) return 'squad-full';
  if (p.overseas && overseasIn(state, t) >= state.rules.overseasMax) return 'overseas-full';
  if (priceOf(p) > draftMaxSpend(state, t)) return 'purse';
  return null;
}

export function legalPicks(state: DraftState, code: string): Player[] {
  return state.available.filter((id) => pickBlock(state, code, id, false) === null).map((id) => state.players[id]);
}

/** Players nobody picked. */
export function undrafted(state: DraftState): Player[] {
  return state.available.map((id) => state.players[id]);
}

// ---------- transitions (pure) ----------

function stepSlot(state: DraftState): DraftState {
  const n = state.order.length;
  return state.slot + 1 >= n ? { ...state, round: state.round + 1, slot: 0 } : { ...state, slot: state.slot + 1 };
}

/** Skip past teams that can't or won't pick; finish when nobody can. */
function settle(state: DraftState): DraftState {
  let s = state;
  for (let guard = 0; guard < s.order.length * 2 + 2; guard++) {
    if (s.finished) return s;
    const closed = new Set(s.closed);
    for (const t of s.teams) {
      if (!closed.has(t.code) && (t.squad.length >= s.rules.squadMax || legalPicks(s, t.code).length === 0)) closed.add(t.code);
    }
    if (closed.size !== s.closed.length) s = { ...s, closed: [...closed] };
    if (closed.size >= s.teams.length || s.available.length === 0) return { ...s, finished: true };
    const code = roundOrder(s)[s.slot];
    if (!closed.has(code)) return s;
    s = stepSlot(s);
  }
  return { ...s, finished: true };
}

export function makePick(state: DraftState, code: string, playerId: string, auto = false): DraftState {
  if (pickBlock(state, code, playerId) !== null) return state;
  const price = priceOf(state.players[playerId]);
  const teams = state.teams.map((t) =>
    t.code === code ? { ...t, purseLakh: t.purseLakh - price, squad: [...t.squad, { playerId, priceLakh: price }] } : t,
  );
  const pick: DraftPick = { pickNo: state.picks.length + 1, round: state.round, team: code, playerId, priceLakh: price, auto };
  return settle(
    stepSlot({
      ...state,
      teams,
      available: state.available.filter((id) => id !== playerId),
      picks: [...state.picks, pick],
    }),
  );
}

/** A team stops picking (allowed once it has its minimum squad). */
export function finishTeam(state: DraftState, code: string): DraftState {
  if (state.closed.includes(code) || state.finished) return state;
  const t = draftTeam(state, code);
  if (t.squad.length < state.rules.squadMin) return state;
  const s = { ...state, closed: [...state.closed, code] };
  return settle(onTheClock(state) === code ? stepSlot(s) : s);
}

export function endDraft(state: DraftState): DraftState {
  return { ...state, finished: true };
}

// ---------- the AI ----------

/** Roughly how an 18-man squad is built; scaled to the chosen squad size. */
const ROLE_SHARE: Record<Role, number> = { WK: 2 / 18, BAT: 5 / 18, AR: 4 / 18, BOWL: 7 / 18 };

function roleNeed(state: DraftState, t: TeamState, role: Role): number {
  const have = t.squad.filter((e) => state.players[e.playerId].role === role).length;
  const target = Math.max(1, Math.round(ROLE_SHARE[role] * state.rules.squadMax));
  if (role === 'WK' && have === 0) return t.squad.length >= 3 ? 1.5 : 1.15;
  if (have < Math.ceil(target / 2)) return 1.25;
  if (have < target) return 1.05;
  if (have === target) return 0.6;
  return 0.35;
}

/** A fixed ±12% personal opinion of each player per team, so AIs disagree without flip-flopping. */
function opinion(seed: number, team: string, playerId: string): number {
  return 0.88 + ((hashString(`${seed}:${team}:${playerId}`) % 1000) / 1000) * 0.24;
}

/** How much a team wants a player, before thinking about money. */
function worth(p: Player): number {
  return Math.pow(Math.max(1, p.overall - 45), 1.7);
}

export function aiScore(state: DraftState, t: TeamState, p: Player): number {
  const slotsLeft = Math.max(1, state.rules.squadMax - t.squad.length);
  const reserveForMin = Math.max(0, state.rules.squadMin - t.squad.length - 1) * state.reserveLakh;
  const perSlot = Math.max(state.reserveLakh, (t.purseLakh - reserveForMin) / slotsLeft);
  const ratio = priceOf(p) / perSlot;
  // Happy to pay up to ~1.8× the per-slot budget for a decent player (more if bold),
  // and stretches much further for genuine stars. Past that, it hurts.
  const star = 1 + Math.max(0, p.overall - 78) / 6;
  const comfort = 1.8 * t.aggression * star;
  const money = ratio <= comfort ? 1 : Math.pow(comfort / ratio, 1.6);
  const os = overseasIn(state, t);
  const overseas = p.overseas ? (os >= 5 ? 0.45 : os >= 4 ? 0.75 : 1) : 1;
  return worth(p) * roleNeed(state, t, p.role) * money * overseas * opinion(state.seed, t.code, p.id);
}

export function aiChoice(state: DraftState, code: string, rng: Rng): string | null {
  const t = draftTeam(state, code);
  const options = legalPicks(state, code);
  if (!options.length) return null;
  const scored = options.map((p) => ({ p, s: aiScore(state, t, p) * (0.94 + rng() * 0.12) }));
  scored.sort((a, b) => b.s - a.s);
  return scored[0].p.id;
}

/** The team on the clock picks with the AI's judgement (also used for "auto-pick for me"). */
export function autoPick(state: DraftState, rng: Rng): DraftState {
  const code = onTheClock(state);
  if (!code) return state;
  const id = aiChoice(state, code, rng);
  if (!id) return settle({ ...state, closed: [...state.closed, code] });
  return makePick(state, code, id, draftTeam(state, code).human);
}

/** Run AI picks until a human is on the clock (or for everyone, if `includeHumans`), or the draft ends. */
export function runAi(state: DraftState, rng: Rng, includeHumans = false): DraftState {
  let s = state;
  for (let guard = 0; guard < 5000 && !s.finished; guard++) {
    const code = onTheClock(s)!;
    if (!includeHumans && draftTeam(s, code).human) break;
    s = autoPick(s, rng);
  }
  return s;
}
