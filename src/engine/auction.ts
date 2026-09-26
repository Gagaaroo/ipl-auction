import type { AuctionState, Lot, Player, PlayerRecord, Rules, TeamDef, TeamState } from './types';
import { MIN_SLOT_LAKH, nextBidAmount } from './money';
import { makeRng } from './rng';
import { acceleratedPrice, buildLots, retainRealSquads, withIds } from './pool';

export interface TeamEntry {
  def: TeamDef;
  human: boolean;
}

export interface AuctionConfig {
  rules: Rules;
  teams: TeamEntry[];
  players: PlayerRecord[];
  seed: number;
}

export const DEFAULT_RULES: Rules = {
  purseCr: 100,
  squadMax: 18,
  squadMin: 11,
  overseasMax: 8,
  overseasXI: 4,
  clockSec: 6,
  poolMode: 'real',
};

export function createAuction(cfg: AuctionConfig): AuctionState {
  const rng = makeRng(cfg.seed);
  const all = withIds(cfg.players);
  const players: Record<string, Player> = {};
  for (const p of all) players[p.id] = p;
  const purse = cfg.rules.purseCr * 100;

  const codes = cfg.teams.map((t) => t.def.code);
  const retention =
    cfg.rules.poolMode === 'real'
      ? retainRealSquads(all, codes.filter((c) => !cfg.teams.find((t) => t.def.code === c)?.def.custom), cfg.rules)
      : { squads: {}, spentLakh: {}, retainedIds: new Set<string>() };

  const teams: TeamState[] = cfg.teams.map((t) => ({
    ...t.def,
    human: t.human,
    aggression: Math.round((0.8 + rng() * 0.45) * 100) / 100,
    purseLakh: purse - (retention.spentLakh[t.def.code] ?? 0),
    squad: retention.squads[t.def.code] ?? [],
  }));

  const pool = all.filter((p) => !retention.retainedIds.has(p.id));
  const queue = buildLots(pool, rng);

  const state: AuctionState = {
    version: 1,
    seed: cfg.seed,
    rules: cfg.rules,
    players,
    teams,
    queue,
    lotIndex: -1,
    round: 'main',
    current: null,
    unsoldMain: [],
    log: [],
    finished: false,
  };
  return advance(state);
}

// ---------- queries ----------

export function team(state: AuctionState, code: string): TeamState {
  const t = state.teams.find((x) => x.code === code);
  if (!t) throw new Error(`Unknown team ${code}`);
  return t;
}

export function overseasCount(state: AuctionState, t: TeamState): number {
  return t.squad.filter((e) => state.players[e.playerId]?.overseas).length;
}

/** Most a team can spend on one player and still fill its minimum squad at ₹20 L a slot. */
export function maxSpend(t: TeamState, rules: Rules): number {
  const slotsStillNeeded = Math.max(0, rules.squadMin - (t.squad.length + 1));
  return t.purseLakh - slotsStillNeeded * MIN_SLOT_LAKH;
}

export function nextBid(state: AuctionState): number | null {
  if (!state.current) return null;
  return nextBidAmount(state.current.bidLakh, state.current.lot.basePriceLakh);
}

export type BidBlock = 'no-lot' | 'holder' | 'squad-full' | 'overseas-full' | 'purse';

export function bidBlock(state: AuctionState, code: string, amount = nextBid(state)): BidBlock | null {
  const cur = state.current;
  if (!cur || amount === null || state.finished) return 'no-lot';
  const t = team(state, code);
  if (cur.holder === code) return 'holder';
  if (t.squad.length >= state.rules.squadMax) return 'squad-full';
  if (state.players[cur.lot.playerId].overseas && overseasCount(state, t) >= state.rules.overseasMax) return 'overseas-full';
  if (amount > maxSpend(t, state.rules)) return 'purse';
  return null;
}

export function canBid(state: AuctionState, code: string, amount?: number): boolean {
  return bidBlock(state, code, amount) === null;
}

function anyoneCouldBid(state: AuctionState, lot: Lot): boolean {
  const p = state.players[lot.playerId];
  return state.teams.some(
    (t) =>
      t.squad.length < state.rules.squadMax &&
      (!p.overseas || overseasCount(state, t) < state.rules.overseasMax) &&
      lot.basePriceLakh <= maxSpend(t, state.rules),
  );
}

export function allSquadsFull(state: AuctionState): boolean {
  return state.teams.every((t) => t.squad.length >= state.rules.squadMax);
}

// ---------- transitions (all pure: return a new state) ----------

export function placeBid(state: AuctionState, code: string): AuctionState {
  const amount = nextBid(state);
  if (amount === null || !canBid(state, code, amount)) return state;
  const cur = state.current!;
  return { ...state, current: { ...cur, bidLakh: amount, holder: code, bidCount: cur.bidCount + 1 } };
}

/** Bring the hammer down on the current lot: sold to the holder, or unsold. Then move on. */
export function hammer(state: AuctionState): AuctionState {
  const cur = state.current;
  if (!cur) return state;
  let next: AuctionState;
  if (cur.holder && cur.bidLakh !== null) {
    const price = cur.bidLakh;
    const teams = state.teams.map((t) =>
      t.code === cur.holder
        ? { ...t, purseLakh: t.purseLakh - price, squad: [...t.squad, { playerId: cur.lot.playerId, priceLakh: price }] }
        : t,
    );
    next = {
      ...state,
      teams,
      log: [...state.log, { kind: 'sold', playerId: cur.lot.playerId, team: cur.holder, priceLakh: price, setName: cur.lot.setName, accelerated: cur.lot.accelerated }],
    };
  } else {
    next = markUnsold(state, cur.lot);
  }
  return advance({ ...next, current: null });
}

function markUnsold(state: AuctionState, lot: Lot): AuctionState {
  return {
    ...state,
    unsoldMain: lot.accelerated ? state.unsoldMain : [...state.unsoldMain, lot.playerId],
    log: [...state.log, { kind: 'unsold', playerId: lot.playerId, setName: lot.setName, accelerated: lot.accelerated }],
  };
}

/** Move to the next lot nobody is locked out of; start the accelerated round; or finish. */
export function advance(state: AuctionState): AuctionState {
  let s = state;
  for (;;) {
    if (allSquadsFull(s)) return { ...s, current: null, finished: true };
    const idx = s.lotIndex + 1;
    if (idx >= s.queue.length) {
      if (s.round === 'main' && s.unsoldMain.length) {
        const accel: Lot[] = s.unsoldMain.map((id) => {
          const p = s.players[id];
          return { playerId: id, setName: 'Accelerated', basePriceLakh: acceleratedPrice(p.basePriceLakh), accelerated: true };
        });
        s = { ...s, round: 'accelerated', queue: [...s.queue, ...accel], unsoldMain: [] };
        continue;
      }
      return { ...s, current: null, lotIndex: idx, finished: true };
    }
    const lot = s.queue[idx];
    s = { ...s, lotIndex: idx };
    if (!anyoneCouldBid(s, lot)) {
      s = markUnsold(s, lot);
      continue;
    }
    return { ...s, current: { lot, bidLakh: null, holder: null, bidCount: 0 } };
  }
}

export function endAuction(state: AuctionState): AuctionState {
  return { ...state, current: null, finished: true };
}

/** Everyone in the pool who never found a team. */
export function unsoldPlayers(state: AuctionState): Player[] {
  const owned = new Set(state.teams.flatMap((t) => t.squad.map((e) => e.playerId)));
  const inPool = new Set(state.queue.map((l) => l.playerId));
  return [...inPool].filter((id) => !owned.has(id)).map((id) => state.players[id]);
}

export function remainingInSet(state: AuctionState): number {
  const cur = state.current;
  if (!cur) return 0;
  let n = 0;
  for (let i = state.lotIndex + 1; i < state.queue.length && state.queue[i].setName === cur.lot.setName; i++) n++;
  return n;
}
