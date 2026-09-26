import type { AuctionState, Player, Role, TeamState } from './types';
import { canBid, hammer, maxSpend, nextBid, overseasCount, placeBid } from './auction';
import { fairValueLakh, roundTo5 } from './pool';
import { hashString, shuffle, type Rng } from './rng';

const ROLE_TARGET: Record<Role, number> = { WK: 2, BAT: 5, AR: 4, BOWL: 6 };

export function roleNeed(state: AuctionState, t: TeamState, role: Role): number {
  const scale = state.rules.squadMax / 17;
  const target = Math.max(1, Math.round(ROLE_TARGET[role] * scale));
  const have = t.squad.filter((e) => state.players[e.playerId]?.role === role).length;
  if (role === 'WK' && have === 0) return 1.45;
  if (have < target / 2) return 1.3;
  if (have < target) return 1.1;
  if (have === target) return 0.7;
  return 0.4;
}

export function purseHealth(state: AuctionState, t: TeamState): number {
  const slotsLeft = Math.max(1, state.rules.squadMax - t.squad.length);
  const perSlotNow = t.purseLakh / slotsLeft;
  const perSlotStart = (state.rules.purseCr * 100) / state.rules.squadMax;
  return Math.min(1.6, Math.max(0.45, Math.pow(perSlotNow / perSlotStart, 0.6)));
}

/** A fixed ±15% personal opinion of each player per team, so AIs disagree but don't flip-flop. */
function opinion(t: TeamState, p: Player, seed: number): number {
  return 0.85 + (hashString(`${seed}:${t.code}:${p.id}`) % 1000) / 1000 * 0.3;
}

/** The most this AI team would pay for this player right now, in lakh. */
export function valuation(state: AuctionState, t: TeamState, p: Player): number {
  const scale = state.rules.purseCr / 100;
  let v = fairValueLakh(p.overall) * scale;
  v *= roleNeed(state, t, p.role);
  v *= purseHealth(state, t);
  const osLeft = state.rules.overseasMax - overseasCount(state, t);
  if (p.overseas && osLeft <= 1) v *= 0.6;
  v *= opinion(t, p, state.seed);
  v *= t.aggression;
  // A team short of its minimum squad will happily take a useful player at base.
  if (t.squad.length < state.rules.squadMin && p.overall >= 58) v = Math.max(v, state.current?.lot.basePriceLakh ?? 0);
  return Math.min(roundTo5(v), spendingCap(state, t));
}

/**
 * AIs keep a plan: never more than 28% of the starting purse on one player,
 * and keep ~₹50 L (at a ₹100 Cr purse) for every slot up to a 15-man core.
 */
export function spendingCap(state: AuctionState, t: TeamState): number {
  const scale = state.rules.purseCr / 100;
  const core = Math.min(state.rules.squadMax, state.rules.squadMin + 4);
  const reserve = Math.max(0, core - (t.squad.length + 1)) * 50 * scale;
  return Math.min(maxSpend(t, state.rules), t.purseLakh - reserve, state.rules.purseCr * 100 * 0.28);
}

export function aiWants(state: AuctionState, t: TeamState, autopilotHumans = false): boolean {
  const cur = state.current;
  const amount = nextBid(state);
  if ((t.human && !autopilotHumans) || !cur || amount === null || !canBid(state, t.code, amount)) return false;
  return valuation(state, t, state.players[cur.lot.playerId]) >= amount;
}

export interface Timing {
  remainingMs: number;
  sinceLastBidMs: number;
}

export const AI_TICK_MS = 250;
const MIN_REACTION_MS = 450;

/**
 * Called every AI_TICK_MS by the auction room. Returns which AI team (if any)
 * raises its paddle this tick. Bids are sparse early and bunch up as the clock
 * runs down, like a real room.
 */
export function aiPickBidder(state: AuctionState, timing: Timing, rng: Rng): string | null {
  if (timing.sinceLastBidMs < MIN_REACTION_MS) return null;
  const cur = state.current;
  const amount = nextBid(state);
  if (!cur || amount === null) return null;
  const p = state.players[cur.lot.playerId];
  const keen = state.teams
    .filter((t) => aiWants(state, t))
    .map((t) => ({ t, headroom: valuation(state, t, p) / amount }));
  if (!keen.length) return null;
  const late = timing.remainingMs < 1500;
  const opening = cur.bidCount === 0;
  const order = shuffle(keen, rng);
  for (const { t, headroom } of order) {
    let prob = late ? 0.45 : opening ? 0.08 : 0.1;
    prob *= Math.min(1.6, Math.max(0.7, headroom));
    prob *= t.aggression;
    if (rng() < prob) return t.code;
  }
  return null;
}

/**
 * Resolve the current lot instantly. Human teams pass, unless `autopilotHumans`
 * is set, in which case the AI bids on their behalf with the same logic.
 */
export function simulateLot(state: AuctionState, rng: Rng, autopilotHumans = false): AuctionState {
  let s = state;
  for (let guard = 0; guard < 500; guard++) {
    const keen = s.teams.filter((t) => aiWants(s, t, autopilotHumans));
    if (!keen.length) break;
    const pick = keen[Math.floor(rng() * keen.length)];
    s = placeBid(s, pick.code);
  }
  return hammer(s);
}

/** Resolve lots instantly until the set changes (or the auction ends). */
export function simulateSet(state: AuctionState, rng: Rng): AuctionState {
  const setName = state.current?.lot.setName;
  let s = state;
  while (s.current && !s.finished && s.current.lot.setName === setName) s = simulateLot(s, rng);
  return s;
}

export function simulateToEnd(state: AuctionState, rng: Rng, autopilotHumans = false): AuctionState {
  let s = state;
  while (s.current && !s.finished) s = simulateLot(s, rng, autopilotHumans);
  return s;
}
