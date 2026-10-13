/**
 * The real-price games. Every current IPL player carries his 2026 contract price.
 *
 * Turn-based draft ('draft'): teams take turns (snake order) picking one player at a time,
 * and that price comes straight off the purse. With challenges on, a team may instead
 * challenge a player already in another squad; after the draft each challenged player
 * is auctioned among his challengers, and his team can use an RTM card to match.
 *
 * Secret draft ('secret'): every team builds a whole squad at once, in secret. On reveal,
 * a player only one team wanted is signed at his 2026 price; a player two or more teams
 * wanted goes to an RTM auction (the team that ranked him highest holds the RTM). Then a
 * short turn-based top-up round fills any gaps.
 */
import type { Player, PlayerRecord, Role, Rules, TeamDef, TeamState } from './types';
import { fairValueLakh, withIds } from './pool';
import { increment } from './money';
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

/** A team that passed on its turn. */
export interface DraftPass {
  round: number;
  team: string;
  /** How many picks had been made when it passed, to slot it into the log. */
  afterPick: number;
}

/** A team used its turn to challenge a player in another squad. */
export interface ChallengeEntry {
  round: number;
  team: string;
  playerId: string;
  owner: string;
  afterPick: number;
}

export type Phase = 'secret' | 'picking' | 'auction' | 'done';

/** One player under the hammer in an RTM auction. */
export interface RtmLot {
  playerId: string;
  kind: 'challenge' | 'clash';
  /** The team holding the right to match (in a challenge, the team that drafted him). */
  holder: string | null;
  /** What the holder already paid (challenges); 0 for clashes. */
  heldAtLakh: number;
  /** Teams allowed to bid. */
  bidders: string[];
  openLakh: number;
}

export interface AuctionPhase {
  lots: RtmLot[];
  index: number;
  bid: number | null;
  leader: string | null;
  /** 'bidding', then 'rtm' while the holder decides whether to match. */
  stage: 'bidding' | 'rtm';
  /** Bumped whenever the clock restarts; a hammer for an old clock is ignored. */
  seq: number;
  /** How long the current clock runs. */
  windowMs: number;
}

export interface AuctionResult {
  playerId: string;
  kind: 'challenge' | 'clash';
  holder: string | null;
  /** Who ends up with him (null: nobody, back to the pool). */
  to: string | null;
  priceLakh: number;
  rtm: boolean;
  /** Short human summary. */
  note: string;
}

export interface DraftState {
  kind: 'draft';
  version: 1;
  seed: number;
  rules: Rules;
  players: Record<string, Player>;
  teams: TeamState[];
  style: 'turns' | 'secret';
  phase: Phase;
  /** Round 1 picking order (team codes). Even rounds run in reverse. */
  order: string[];
  /** Player ids still on the board. */
  available: string[];
  picks: DraftPick[];
  passes: DraftPass[];
  /** Challenged players, in the order first challenged: who owns him and who wants him. */
  challenges: { playerId: string; owner: string; teams: string[] }[];
  challengeLog: ChallengeEntry[];
  /** Secret draft: each team's ranked list, and who has locked in. */
  secret: { lists: Record<string, string[]>; locked: string[] } | null;
  rtmLeft: Record<string, number>;
  auction: AuctionPhase | null;
  auctionLog: AuctionResult[];
  auctionDone: boolean;
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

export const OPEN_MS = 10000;
export const BID_MS = 7000;
export const RTM_MS = 20000;

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
  const secret = cfg.rules.game === 'secret';
  const cards = cfg.rules.rtmCards ?? 3;
  let state: DraftState = {
    kind: 'draft',
    version: 1,
    seed: cfg.seed,
    rules: cfg.rules,
    players,
    teams,
    style: secret ? 'secret' : 'turns',
    phase: secret ? 'secret' : 'picking',
    order: shuffle(teams.map((t) => t.code), rng),
    available,
    picks: [],
    passes: [],
    challenges: [],
    challengeLog: [],
    secret: secret ? { lists: {}, locked: [] } : null,
    rtmLeft: Object.fromEntries(teams.map((t) => [t.code, cards])),
    auction: null,
    auctionLog: [],
    auctionDone: false,
    round: 1,
    slot: 0,
    closed: [],
    reserveLakh: Number.isFinite(reserveLakh) ? reserveLakh : 20,
    finished: false,
  };
  if (secret) {
    // AI teams write their lists straight away.
    for (const t of teams) if (!t.human) state = lockList({ ...state, secret: { ...state.secret!, lists: { ...state.secret!.lists, [t.code]: aiWishlist(state, t.code, rng) } } }, t.code, rng);
    return state;
  }
  return settle(state, rng);
}

/** Older saves predate passes, challenges and the secret draft. */
export function upgradeDraft(s: DraftState): DraftState {
  if (s.phase) return s.passes ? s : { ...s, passes: [] };
  return {
    ...s,
    rules: { ...s.rules, challenges: s.rules.challenges ?? false, rtmCards: s.rules.rtmCards ?? 0 },
    style: 'turns',
    phase: s.finished ? 'done' : 'picking',
    passes: s.passes ?? [],
    challenges: [],
    challengeLog: [],
    secret: null,
    rtmLeft: {},
    auction: null,
    auctionLog: [],
    auctionDone: true,
  };
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

/** The team whose turn it is to pick, or null outside the picking phase. */
export function onTheClock(state: DraftState): string | null {
  if (state.finished || state.phase !== 'picking') return null;
  return roundOrder(state)[state.slot] ?? null;
}

export function overseasIn(state: DraftState, t: TeamState): number {
  return t.squad.filter((e) => state.players[e.playerId]?.overseas).length;
}

/** Most a team can pay for its next player and still afford its minimum squad. */
export function draftMaxSpend(state: DraftState, t: TeamState): number {
  const stillNeeded = Math.max(0, state.rules.squadMin - (t.squad.length + 1));
  return t.purseLakh - stillNeeded * state.reserveLakh;
}

/** While picking, each open challenge holds back a squad slot and its opening bid, so the challenger can bid later. */
export function heldBack(state: DraftState, code: string): { slots: number; money: number } {
  if (state.style !== 'turns' || state.phase !== 'picking' || state.auctionDone) return { slots: 0, money: 0 };
  const mine = state.challenges.filter((c) => c.teams.includes(code));
  return { slots: mine.length, money: mine.reduce((n, c) => n + challengeOpen(state, c.playerId), 0) };
}

export type PickBlock = 'finished' | 'not-your-turn' | 'taken' | 'squad-full' | 'overseas-full' | 'purse';

/** Why a team can't take this player right now (ignoring whose turn it is unless `checkTurn`). */
export function pickBlock(state: DraftState, code: string, playerId: string, checkTurn = true): PickBlock | null {
  if (state.finished || state.phase !== 'picking') return 'finished';
  if (checkTurn && onTheClock(state) !== code) return 'not-your-turn';
  if (!state.available.includes(playerId)) return 'taken';
  const t = draftTeam(state, code);
  const p = state.players[playerId];
  const held = heldBack(state, code);
  if (t.squad.length + held.slots >= state.rules.squadMax) return 'squad-full';
  if (p.overseas && overseasIn(state, t) >= state.rules.overseasMax) return 'overseas-full';
  if (priceOf(p) > draftMaxSpend(state, t) - held.money) return 'purse';
  return null;
}

export function legalPicks(state: DraftState, code: string): Player[] {
  return state.available.filter((id) => pickBlock(state, code, id, false) === null).map((id) => state.players[id]);
}

/** Players nobody took. */
export function undrafted(state: DraftState): Player[] {
  return state.available.map((id) => state.players[id]);
}

export function ownerOf(state: DraftState, playerId: string): TeamState | null {
  return state.teams.find((t) => t.squad.some((e) => e.playerId === playerId)) ?? null;
}

export const rtmText = (n: number) => (n >= 99 ? 'unlimited' : String(n));

// ---------- picking phase ----------

function stepSlot(state: DraftState): DraftState {
  const n = state.order.length;
  return state.slot + 1 >= n ? { ...state, round: state.round + 1, slot: 0 } : { ...state, slot: state.slot + 1 };
}

/** Skip past teams that can't or won't pick; move on when nobody can. */
function settle(state: DraftState, rng: Rng): DraftState {
  let s = state;
  if (s.phase !== 'picking') return s;
  for (let guard = 0; guard < s.order.length * 2 + 2; guard++) {
    const closed = new Set(s.closed);
    for (const t of s.teams) {
      if (!closed.has(t.code) && (t.squad.length + heldBack(s, t.code).slots >= s.rules.squadMax || legalPicks(s, t.code).length === 0)) closed.add(t.code);
    }
    if (closed.size !== s.closed.length) s = { ...s, closed: [...closed] };
    if (closed.size >= s.teams.length || s.available.length === 0) return afterPicking(s, rng);
    const code = roundOrder(s)[s.slot];
    if (!closed.has(code)) return s;
    s = stepSlot(s);
  }
  return afterPicking(s, rng);
}

/** Picking is over: auction the challenged players (once), or finish. */
function afterPicking(s: DraftState, rng: Rng): DraftState {
  if (s.style === 'turns' && !s.auctionDone && s.challenges.length) {
    const lots: RtmLot[] = [];
    for (const c of s.challenges) {
      const owner = ownerOf(s, c.playerId);
      const entry = owner?.squad.find((e) => e.playerId === c.playerId);
      if (!owner || !entry) continue;
      lots.push({
        playerId: c.playerId,
        kind: 'challenge',
        holder: owner.code,
        heldAtLakh: entry.priceLakh,
        bidders: c.teams.filter((t) => t !== owner.code),
        openLakh: entry.priceLakh + increment(entry.priceLakh),
      });
    }
    lots.sort((a, b) => b.heldAtLakh - a.heldAtLakh);
    return startAuction(s, lots, rng);
  }
  return { ...s, phase: 'done', finished: true, auction: null };
}

export function makePick(state: DraftState, code: string, playerId: string, auto = false, rng: Rng = makeRng(state.seed)): DraftState {
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
    rng,
  );
}

/** The team on the clock passes: no pick this turn, no money spent, next team up. */
export function skipTurn(state: DraftState, code: string, rng: Rng = makeRng(state.seed)): DraftState {
  if (onTheClock(state) !== code) return state;
  const pass: DraftPass = { round: state.round, team: code, afterPick: state.picks.length };
  return settle(stepSlot({ ...state, passes: [...state.passes, pass] }), rng);
}

/** A team stops picking (allowed once it has its minimum squad). */
export function finishTeam(state: DraftState, code: string, rng: Rng = makeRng(state.seed)): DraftState {
  if (state.phase !== 'picking' || state.closed.includes(code)) return state;
  const t = draftTeam(state, code);
  if (t.squad.length < state.rules.squadMin) return state;
  const s = { ...state, closed: [...state.closed, code] };
  return settle(onTheClock(state) === code ? stepSlot(s) : s, rng);
}

export type ChallengeBlock = 'off' | 'not-your-turn' | 'not-owned' | 'own-player' | 'already' | 'squad-full' | 'overseas-full' | 'purse';

/** The opening bid if this player is challenged: what his team paid, plus one step. */
export function challengeOpen(state: DraftState, playerId: string): number {
  const owner = ownerOf(state, playerId);
  const paid = owner?.squad.find((e) => e.playerId === playerId)?.priceLakh ?? priceOf(state.players[playerId]);
  return paid + increment(paid);
}

export function challengeBlock(state: DraftState, code: string, playerId: string, checkTurn = true): ChallengeBlock | null {
  if (state.style !== 'turns' || !state.rules.challenges || state.phase !== 'picking') return 'off';
  if (checkTurn && onTheClock(state) !== code) return 'not-your-turn';
  const owner = ownerOf(state, playerId);
  if (!owner) return 'not-owned';
  if (owner.code === code) return 'own-player';
  if (state.challenges.some((c) => c.playerId === playerId && c.teams.includes(code))) return 'already';
  const t = draftTeam(state, code);
  const held = heldBack(state, code);
  if (t.squad.length + held.slots >= state.rules.squadMax) return 'squad-full';
  if (state.players[playerId].overseas && overseasIn(state, t) >= state.rules.overseasMax) return 'overseas-full';
  if (challengeOpen(state, playerId) > draftMaxSpend(state, t) - held.money) return 'purse';
  return null;
}

/** Use this turn to challenge a player in another squad. He's auctioned after the draft. */
export function challenge(state: DraftState, code: string, playerId: string, rng: Rng = makeRng(state.seed)): DraftState {
  if (challengeBlock(state, code, playerId) !== null) return state;
  const owner = ownerOf(state, playerId)!;
  const existing = state.challenges.find((c) => c.playerId === playerId);
  const challenges = existing
    ? state.challenges.map((c) => (c.playerId === playerId ? { ...c, teams: [...c.teams, code] } : c))
    : [...state.challenges, { playerId, owner: owner.code, teams: [code] }];
  const entry: ChallengeEntry = { round: state.round, team: code, playerId, owner: owner.code, afterPick: state.picks.length };
  return settle(stepSlot({ ...state, challenges, challengeLog: [...state.challengeLog, entry] }), rng);
}

// ---------- secret draft ----------

export interface ListTotals {
  count: number;
  spend: number;
  overseas: number;
}

export function listTotals(state: DraftState, code: string): ListTotals {
  const ids = state.secret?.lists[code] ?? [];
  return {
    count: ids.length,
    spend: ids.reduce((n, id) => n + priceOf(state.players[id]), 0),
    overseas: ids.filter((id) => state.players[id].overseas).length,
  };
}

export type ListBlock = 'locked' | 'in-list' | 'squad-full' | 'overseas-full' | 'purse' | 'off';

export function listBlock(state: DraftState, code: string, playerId: string): ListBlock | null {
  if (state.phase !== 'secret' || !state.secret) return 'off';
  if (state.secret.locked.includes(code)) return 'locked';
  const list = state.secret.lists[code] ?? [];
  if (list.includes(playerId)) return 'in-list';
  const tot = listTotals(state, code);
  const p = state.players[playerId];
  if (tot.count >= state.rules.squadMax) return 'squad-full';
  if (p.overseas && tot.overseas >= state.rules.overseasMax) return 'overseas-full';
  const stillNeeded = Math.max(0, state.rules.squadMin - (tot.count + 1));
  if (tot.spend + priceOf(p) > draftTeam(state, code).purseLakh - stillNeeded * state.reserveLakh) return 'purse';
  return null;
}

function setList(state: DraftState, code: string, list: string[]): DraftState {
  return { ...state, secret: { ...state.secret!, lists: { ...state.secret!.lists, [code]: list } } };
}

export function listAdd(state: DraftState, code: string, playerId: string): DraftState {
  if (listBlock(state, code, playerId) !== null) return state;
  return setList(state, code, [...(state.secret!.lists[code] ?? []), playerId]);
}

export function listRemove(state: DraftState, code: string, playerId: string): DraftState {
  if (state.phase !== 'secret' || !state.secret || state.secret.locked.includes(code)) return state;
  return setList(state, code, (state.secret.lists[code] ?? []).filter((id) => id !== playerId));
}

/** Move a player up or down your list: higher means you'd rather hold the RTM on him. */
export function listMove(state: DraftState, code: string, playerId: string, dir: -1 | 1): DraftState {
  if (state.phase !== 'secret' || !state.secret || state.secret.locked.includes(code)) return state;
  const list = [...(state.secret.lists[code] ?? [])];
  const i = list.indexOf(playerId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return state;
  [list[i], list[j]] = [list[j], list[i]];
  return setList(state, code, list);
}

export function canLock(state: DraftState, code: string): boolean {
  return state.phase === 'secret' && !!state.secret && !state.secret.locked.includes(code) && listTotals(state, code).count >= state.rules.squadMin;
}

export function lockList(state: DraftState, code: string, rng: Rng = makeRng(state.seed)): DraftState {
  if (!canLock(state, code)) return state;
  const s = { ...state, secret: { ...state.secret!, locked: [...state.secret!.locked, code] } };
  return s.secret.locked.length >= s.teams.length ? reveal(s, rng) : s;
}

/** Everyone has locked in: sign the uncontested players, auction the clashes. */
function reveal(state: DraftState, rng: Rng): DraftState {
  const lists = state.secret!.lists;
  const wanted = new Map<string, { team: string; rank: number }[]>();
  for (const t of state.teams) (lists[t.code] ?? []).forEach((id, rank) => wanted.set(id, [...(wanted.get(id) ?? []), { team: t.code, rank }]));
  let teams = state.teams;
  const picks = [...state.picks];
  const lots: RtmLot[] = [];
  const taken = new Set<string>();
  // Highest price first, so the stars are signed (or fought over) before the rest.
  const ids = [...wanted.keys()].sort((a, b) => priceOf(state.players[b]) - priceOf(state.players[a]));
  for (const id of ids) {
    const who = wanted.get(id)!;
    const price = priceOf(state.players[id]);
    taken.add(id);
    if (who.length === 1) {
      const code = who[0].team;
      teams = teams.map((t) => (t.code === code ? { ...t, purseLakh: t.purseLakh - price, squad: [...t.squad, { playerId: id, priceLakh: price }] } : t));
      picks.push({ pickNo: picks.length + 1, round: 0, team: code, playerId: id, priceLakh: price, auto: false });
    } else {
      // Whoever ranked him highest holds the RTM; ties go by a coin toss fixed by the seed.
      const sorted = [...who].sort((a, b) => a.rank - b.rank || (hashString(`${state.seed}:${id}:${a.team}`) % 997) - (hashString(`${state.seed}:${id}:${b.team}`) % 997));
      lots.push({ playerId: id, kind: 'clash', holder: sorted[0].team, heldAtLakh: 0, bidders: sorted.slice(1).map((w) => w.team), openLakh: price });
    }
  }
  const s: DraftState = { ...state, teams, picks, available: state.available.filter((id) => !taken.has(id)) };
  return startAuction(s, lots, rng);
}

/** An AI's list for the secret draft: a squad it would build alone, best first, starting from `start`. */
export function aiWishlist(state: DraftState, code: string, rng: Rng, start: string[] = []): string[] {
  const startCost = start.reduce((n, id) => n + priceOf(state.players[id]), 0);
  let tmp: DraftState = {
    ...state,
    phase: 'picking',
    finished: false,
    available: state.available.filter((id) => !start.includes(id)),
    teams: state.teams.map((t) =>
      t.code === code ? { ...t, squad: start.map((id) => ({ playerId: id, priceLakh: priceOf(state.players[id]) })), purseLakh: t.purseLakh - startCost } : t,
    ),
  };
  const out: string[] = [...start];
  for (let i = start.length; i < state.rules.squadMax; i++) {
    const id = aiChoice(tmp, code, rng);
    if (!id) break;
    const price = priceOf(tmp.players[id]);
    out.push(id);
    tmp = {
      ...tmp,
      available: tmp.available.filter((x) => x !== id),
      teams: tmp.teams.map((t) => (t.code === code ? { ...t, purseLakh: t.purseLakh - price, squad: [...t.squad, { playerId: id, priceLakh: price }] } : t)),
    };
  }
  return out;
}

// ---------- RTM auctions ----------

function startAuction(s: DraftState, lots: RtmLot[], rng: Rng): DraftState {
  const a: AuctionPhase = { lots, index: -1, bid: null, leader: null, stage: 'bidding', seq: (s.auction?.seq ?? 0) + 1, windowMs: OPEN_MS };
  return nextLot({ ...s, phase: 'auction', finished: false, auction: a }, rng);
}

export function currentLot(s: DraftState): RtmLot | null {
  return s.phase === 'auction' && s.auction ? s.auction.lots[s.auction.index] ?? null : null;
}

export function nextLotBid(s: DraftState): number | null {
  const lot = currentLot(s);
  if (!lot || !s.auction) return null;
  return s.auction.bid === null ? lot.openLakh : s.auction.bid + increment(s.auction.bid);
}

export type BidBlock = 'no-lot' | 'not-bidder' | 'leading' | 'squad-full' | 'overseas-full' | 'purse' | 'rtm-stage';

export function lotBidBlock(s: DraftState, code: string, amount = nextLotBid(s)): BidBlock | null {
  const lot = currentLot(s);
  if (!lot || amount === null || !s.auction) return 'no-lot';
  if (s.auction.stage !== 'bidding') return 'rtm-stage';
  if (!lot.bidders.includes(code)) return 'not-bidder';
  if (s.auction.leader === code) return 'leading';
  const t = draftTeam(s, code);
  if (t.squad.length >= s.rules.squadMax) return 'squad-full';
  if (s.players[lot.playerId].overseas && overseasIn(s, t) >= s.rules.overseasMax) return 'overseas-full';
  if (amount > draftMaxSpend(s, t)) return 'purse';
  return null;
}

/** Can the holder match `price` with an RTM card? */
export function canMatch(s: DraftState, lot: RtmLot, price: number): boolean {
  if (!lot.holder || (s.rtmLeft[lot.holder] ?? 0) <= 0) return false;
  const t = draftTeam(s, lot.holder);
  if (lot.kind === 'challenge') return t.purseLakh + lot.heldAtLakh >= price;
  if (t.squad.length >= s.rules.squadMax) return false;
  if (s.players[lot.playerId].overseas && overseasIn(s, t) >= s.rules.overseasMax) return false;
  return draftMaxSpend(s, t) >= price;
}

function holderTakesAtOpen(s: DraftState, lot: RtmLot): boolean {
  if (!lot.holder || lot.kind !== 'clash') return false;
  const t = draftTeam(s, lot.holder);
  if (t.squad.length >= s.rules.squadMax) return false;
  if (s.players[lot.playerId].overseas && overseasIn(s, t) >= s.rules.overseasMax) return false;
  return draftMaxSpend(s, t) >= lot.openLakh;
}

const fmt = (l: number) => (l >= 100 ? `₹${+(l / 100).toFixed(2)} Cr` : `₹${l} L`);

/** Settle the lot on the block: `winner` gets him at `price` (or nobody, if null). */
function settleLot(s: DraftState, winner: string | null, price: number, viaRtm: boolean, note: string, rng: Rng): DraftState {
  const lot = currentLot(s)!;
  const id = lot.playerId;
  let teams = s.teams;
  let available = s.available;
  let rtmLeft = s.rtmLeft;
  if (viaRtm && lot.holder) rtmLeft = { ...rtmLeft, [lot.holder]: (rtmLeft[lot.holder] ?? 0) - 1 };
  if (lot.kind === 'challenge') {
    if (winner && winner !== lot.holder) {
      teams = teams.map((t) =>
        t.code === lot.holder
          ? { ...t, purseLakh: t.purseLakh + lot.heldAtLakh, squad: t.squad.filter((e) => e.playerId !== id) }
          : t.code === winner
            ? { ...t, purseLakh: t.purseLakh - price, squad: [...t.squad, { playerId: id, priceLakh: price }] }
            : t,
      );
    } else if (winner === lot.holder && price !== lot.heldAtLakh) {
      teams = teams.map((t) =>
        t.code === lot.holder
          ? { ...t, purseLakh: t.purseLakh - (price - lot.heldAtLakh), squad: t.squad.map((e) => (e.playerId === id ? { ...e, priceLakh: price } : e)) }
          : t,
      );
    }
  } else if (winner) {
    teams = teams.map((t) => (t.code === winner ? { ...t, purseLakh: t.purseLakh - price, squad: [...t.squad, { playerId: id, priceLakh: price }] } : t));
  } else {
    available = [...available, id].sort((a, b) => priceOf(s.players[b]) - priceOf(s.players[a]));
  }
  const result: AuctionResult = { playerId: id, kind: lot.kind, holder: lot.holder, to: lot.kind === 'challenge' && !winner ? lot.holder : winner, priceLakh: price, rtm: viaRtm, note };
  return nextLot({ ...s, teams, available, rtmLeft, auctionLog: [...s.auctionLog, result] }, rng);
}

function noBids(s: DraftState, rng: Rng): DraftState {
  const lot = currentLot(s)!;
  if (lot.kind === 'challenge') return settleLot(s, lot.holder, lot.heldAtLakh, false, `No bids: stays with ${lot.holder} at ${fmt(lot.heldAtLakh)}`, rng);
  if (holderTakesAtOpen(s, lot)) return settleLot(s, lot.holder, lot.openLakh, false, `No other bids: ${lot.holder} signs him at ${fmt(lot.openLakh)}`, rng);
  return settleLot(s, null, 0, false, 'Nobody could take him: back in the pool', rng);
}

/** Hand the lot to the leader, or to the holder via RTM. */
function award(s: DraftState, useRtm: boolean, rng: Rng): DraftState {
  const lot = currentLot(s)!;
  const a = s.auction!;
  const price = a.bid!;
  if (useRtm && lot.holder && canMatch(s, lot, price)) return settleLot(s, lot.holder, price, true, `${lot.holder} used RTM to match ${fmt(price)}`, rng);
  return settleLot(s, a.leader, price, false, `Sold to ${a.leader} for ${fmt(price)}`, rng);
}

function humanInLot(s: DraftState, lot: RtmLot): boolean {
  const teams = [lot.holder, ...lot.bidders].filter(Boolean) as string[];
  return teams.some((c) => draftTeam(s, c).human);
}

/** Move to the next lot. Lots involving only AI teams are settled instantly. */
function nextLot(s: DraftState, rng: Rng): DraftState {
  let st = s;
  for (let guard = 0; guard < 1000; guard++) {
    const a = st.auction!;
    const index = a.index + 1;
    if (index >= a.lots.length) return endAuctionPhase(st, rng);
    st = { ...st, auction: { ...a, index, bid: null, leader: null, stage: 'bidding', seq: a.seq + 1, windowMs: OPEN_MS } };
    const lot = a.lots[index];
    const anyone = lot.bidders.some((c) => lotBidBlock(st, c) === null);
    if (!anyone) return noBids(st, rng);
    if (!humanInLot(st, lot)) return autoSettle(st, rng);
    return st;
  }
  return endAuctionPhase(st, rng);
}

function endAuctionPhase(s: DraftState, rng: Rng): DraftState {
  // Top-up round: a quick snake draft for anyone with room and money left.
  const round = s.style === 'secret' ? 1 : s.round + 1;
  return settle({ ...s, auction: null, auctionDone: true, phase: 'picking', round, slot: 0, closed: [] }, rng);
}

export function placeLotBid(s: DraftState, code: string): DraftState {
  const amount = nextLotBid(s);
  if (amount === null || lotBidBlock(s, code, amount) !== null) return s;
  const a = s.auction!;
  return { ...s, auction: { ...a, bid: amount, leader: code, seq: a.seq + 1, windowMs: BID_MS } };
}

/** The clock ran out (only counts for the clock that is running now). */
export function hammerLot(s: DraftState, seq: number, rng: Rng): DraftState {
  const a = s.auction;
  const lot = currentLot(s);
  if (!a || !lot || a.seq !== seq) return s;
  if (a.stage === 'rtm') return award(s, false, rng);
  if (a.leader === null) return noBids(s, rng);
  if (lot.holder && canMatch(s, lot, a.bid!)) {
    if (draftTeam(s, lot.holder).human) return { ...s, auction: { ...a, stage: 'rtm', seq: a.seq + 1, windowMs: RTM_MS } };
    return award(s, aiWantsRtm(s, lot, a.bid!), rng);
  }
  return award(s, false, rng);
}

export function decideRtm(s: DraftState, code: string, use: boolean, rng: Rng): DraftState {
  const lot = currentLot(s);
  if (!lot || s.auction?.stage !== 'rtm' || lot.holder !== code) return s;
  return award(s, use, rng);
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

export function aiScore(state: DraftState, t: TeamState, p: Player, price = priceOf(p)): number {
  const slotsLeft = Math.max(1, state.rules.squadMax - t.squad.length);
  const reserveForMin = Math.max(0, state.rules.squadMin - t.squad.length - 1) * state.reserveLakh;
  const perSlot = Math.max(state.reserveLakh, (t.purseLakh - reserveForMin) / slotsLeft);
  const ratio = price / perSlot;
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

/** The most an AI team would pay for a player in an RTM auction. */
export function aiWillingness(s: DraftState, code: string, p: Player): number {
  const t = draftTeam(s, code);
  const fair = fairValueLakh(p.overall) * (s.rules.purseCr / 100);
  const base = Math.max(priceOf(p), fair);
  const need = Math.sqrt(roleNeed(s, t, p.role));
  return Math.min(draftMaxSpend(s, t) + (ownerOf(s, p.id)?.code === code ? priceOf(p) : 0), base * need * t.aggression * opinion(s.seed, code, p.id));
}

function aiWantsRtm(s: DraftState, lot: RtmLot, price: number): boolean {
  if (!lot.holder) return false;
  return price <= aiWillingness(s, lot.holder, s.players[lot.playerId]) * 1.1;
}

/** An AI bidder ready to raise in a live RTM auction, if any. */
export function aiBidder(s: DraftState, rng: Rng, includeHumans = false): string | null {
  const lot = currentLot(s);
  const amount = nextLotBid(s);
  if (!lot || amount === null || s.auction?.stage !== 'bidding') return null;
  const p = s.players[lot.playerId];
  const keen = lot.bidders.filter(
    (c) => (includeHumans || !draftTeam(s, c).human) && lotBidBlock(s, c, amount) === null && aiWillingness(s, c, p) >= amount,
  );
  return keen.length ? keen[Math.floor(rng() * keen.length)] : null;
}

/** Settle the lot on the block with the AI deciding for everyone (AI-only lots and "sim to the end"). */
function autoSettle(s: DraftState, rng: Rng): DraftState {
  let st = s;
  for (let guard = 0; guard < 500; guard++) {
    if (st.auction?.stage === 'rtm') {
      const lot = currentLot(st)!;
      return award(st, aiWantsRtm(st, lot, st.auction.bid!), rng);
    }
    const who = aiBidder(st, rng, true);
    if (!who) return autoHammer(st, rng);
    st = placeLotBid(st, who);
  }
  return autoHammer(st, rng);
}

/** Hammer with an AI deciding any RTM, even for a human holder. */
function autoHammer(s: DraftState, rng: Rng): DraftState {
  const a = s.auction!;
  const lot = currentLot(s)!;
  if (a.leader === null) return noBids(s, rng);
  if (lot.holder && canMatch(s, lot, a.bid!)) return award(s, aiWantsRtm(s, lot, a.bid!), rng);
  return award(s, false, rng);
}

/** An AI team on the clock in a challenge draft sometimes goes after a star in another squad. */
function aiChallengeTarget(s: DraftState, code: string, bestFree: number, rng: Rng): string | null {
  if (s.style !== 'turns' || !s.rules.challenges) return null;
  if (s.challengeLog.filter((c) => c.team === code).length >= 1) return null;
  const t = draftTeam(s, code);
  let best: { id: string; score: number } | null = null;
  for (const other of s.teams) {
    if (other.code === code) continue;
    for (const e of other.squad) {
      const p = s.players[e.playerId];
      if (p.overall < 83 || challengeBlock(s, code, p.id) !== null) continue;
      if ((s.challenges.find((c) => c.playerId === p.id)?.teams.length ?? 0) >= 2) continue;
      const score = aiScore(s, t, p, challengeOpen(s, p.id) * 1.15);
      if (!best || score > best.score) best = { id: p.id, score };
    }
  }
  return best && best.score > bestFree * 1.5 && rng() < 0.35 ? best.id : null;
}

/** The team on the clock picks with the AI's judgement (also used for "auto-pick for me"). */
export function autoPick(state: DraftState, rng: Rng): DraftState {
  const code = onTheClock(state);
  if (!code) return state;
  const id = aiChoice(state, code, rng);
  const t = draftTeam(state, code);
  if (!t.human) {
    const bestFree = id ? aiScore(state, t, state.players[id]) : 0;
    const target = aiChallengeTarget(state, code, bestFree, rng);
    if (target) return challenge(state, code, target, rng);
  }
  if (!id) return settle({ ...state, closed: [...state.closed, code] }, rng);
  return makePick(state, code, id, t.human, rng);
}

/** Run the AI until a person has a decision to make (or for everyone, if `includeHumans`), or the game ends. */
export function runAi(state: DraftState, rng: Rng, includeHumans = false): DraftState {
  let s = state;
  for (let guard = 0; guard < 5000 && !s.finished; guard++) {
    if (s.phase === 'secret') {
      if (!includeHumans) break;
      for (const t of s.teams) {
        if (s.phase !== 'secret' || s.secret!.locked.includes(t.code)) continue;
        if (listTotals(s, t.code).count < s.rules.squadMin) {
          let list = s.secret!.lists[t.code] ?? [];
          for (const id of aiWishlist({ ...s, teams: s.teams.map((x) => (x.code === t.code ? { ...x, squad: [] } : x)) }, t.code, rng)) {
            if (list.includes(id)) continue;
            const n = listAdd(s, t.code, id);
            if (n !== s) { s = n; list = s.secret!.lists[t.code]; }
          }
        }
        s = lockList(s, t.code, rng);
      }
      if (s.phase === 'secret') break;
      continue;
    }
    if (s.phase === 'auction') {
      if (!includeHumans) break;
      s = autoSettle(s, rng);
      continue;
    }
    const code = onTheClock(s);
    if (!code) break;
    if (!includeHumans && draftTeam(s, code).human) break;
    s = autoPick(s, rng);
  }
  return s;
}

export function endDraft(state: DraftState): DraftState {
  // Players still waiting in an auction go back to the pool (a challenged player stays put).
  const pending = state.auction ? state.auction.lots.slice(state.auction.index).filter((l) => l.kind === 'clash').map((l) => l.playerId) : [];
  return { ...state, available: [...state.available, ...pending], auction: null, phase: 'done', finished: true };
}

// ---------- one entry point for every move (local, host or remote guest) ----------

export type DraftAction =
  | { type: 'pick'; team: string; playerId: string }
  | { type: 'skip'; team: string }
  | { type: 'finish'; team: string }
  | { type: 'auto'; team: string }
  | { type: 'challenge'; team: string; playerId: string }
  | { type: 'list-add'; team: string; playerId: string }
  | { type: 'list-remove'; team: string; playerId: string }
  | { type: 'list-move'; team: string; playerId: string; dir: -1 | 1 }
  | { type: 'list-auto'; team: string }
  | { type: 'lock'; team: string }
  | { type: 'bid'; team: string }
  | { type: 'rtm'; team: string; use: boolean }
  | { type: 'ai-bid'; team: string }
  | { type: 'hammer'; seq: number }
  | { type: 'sim' }
  | { type: 'end' };

/** Actions a remote player may send for their own team. */
export const PLAYER_ACTIONS = new Set(['pick', 'skip', 'finish', 'auto', 'challenge', 'list-add', 'list-remove', 'list-move', 'list-auto', 'lock', 'bid', 'rtm']);

/** Apply a move if it is legal right now; otherwise return the state unchanged. */
export function applyAction(state: DraftState, a: DraftAction, rng: Rng): DraftState {
  switch (a.type) {
    case 'pick':
      return makePick(state, a.team, a.playerId, false, rng);
    case 'skip':
      return skipTurn(state, a.team, rng);
    case 'finish':
      return finishTeam(state, a.team, rng);
    case 'auto':
      return onTheClock(state) === a.team ? autoPick(state, rng) : state;
    case 'challenge':
      return challenge(state, a.team, a.playerId, rng);
    case 'list-add':
      return listAdd(state, a.team, a.playerId);
    case 'list-remove':
      return listRemove(state, a.team, a.playerId);
    case 'list-move':
      return listMove(state, a.team, a.playerId, a.dir);
    case 'list-auto': {
      // Keep the players already chosen and fill the rest of the list the way the AI would.
      if (state.phase !== 'secret' || state.secret?.locked.includes(a.team)) return state;
      const start = state.secret?.lists[a.team] ?? [];
      return setList(state, a.team, aiWishlist(state, a.team, rng, start));
    }
    case 'lock':
      return lockList(state, a.team, rng);
    case 'bid':
    case 'ai-bid':
      return placeLotBid(state, a.team);
    case 'rtm':
      return decideRtm(state, a.team, a.use, rng);
    case 'hammer':
      return hammerLot(state, a.seq, rng);
    case 'sim':
      return runAi(state, rng, true);
    case 'end':
      return endDraft(state);
  }
}

/** What a remote player may see: in the secret phase, only their own list. */
export function redactFor(s: DraftState, seat: string | null): DraftState {
  if (s.phase !== 'secret' || !s.secret) return s;
  const lists = seat && s.secret.lists[seat] ? { [seat]: s.secret.lists[seat] } : {};
  return { ...s, secret: { ...s.secret, lists } };
}
