export type Role = 'BAT' | 'BOWL' | 'AR' | 'WK';

export type HistoryEntry =
  | { year: number; result: 'sold'; team: string; priceLakh: number }
  | { year: number; result: 'unsold'; basePriceLakh: number };

/** A player exactly as stored in players.json (or imported from CSV). */
export interface PlayerRecord {
  name: string;
  role: Role;
  country: string;
  overseas: boolean;
  bat: number;
  bowl: number;
  overall: number;
  basePriceLakh: number;
  team2026: string | null;
  history: HistoryEntry[];
  /** IPL 2026 contract price in lakh: what a draft pick costs. Null for players outside a 2026 squad. */
  price2026Lakh?: number | null;
  /** How he came by that price: 'retained', '2025 auction', '2025 replacement', 'traded' or '2026 auction'. */
  priceHow?: string | null;
}

export interface Player extends PlayerRecord {
  id: string;
}

export interface TeamDef {
  code: string;
  name: string;
  color: string;
  custom?: boolean;
}

export type PoolMode = 'real' | 'full';

/**
 * 'draft': take turns picking current IPL players at their real 2026 price (optionally challenging other teams' picks).
 * 'secret': everyone builds a squad in secret at 2026 prices; players wanted by two or more teams go to an RTM auction.
 * 'auction': the classic live auction.
 */
export type GameMode = 'draft' | 'secret' | 'auction';

export interface Rules {
  purseCr: number;
  squadMax: number;
  squadMin: number;
  overseasMax: number;
  overseasXI: number;
  clockSec: number;
  poolMode: PoolMode;
  game: GameMode;
  /** Draft only: on your turn you may challenge a player already in another squad; he is auctioned after the draft. */
  challenges: boolean;
  /** Right-to-match cards per team in the RTM auctions. 99 means unlimited. */
  rtmCards: number;
}

export interface SquadEntry {
  playerId: string;
  priceLakh: number;
  retained?: boolean;
}

export interface TeamState extends TeamDef {
  human: boolean;
  /** 0.8 (cautious) .. 1.25 (reckless). Only used for AI teams. */
  aggression: number;
  purseLakh: number;
  squad: SquadEntry[];
}

export interface Lot {
  playerId: string;
  setName: string;
  basePriceLakh: number;
  accelerated: boolean;
}

export interface CurrentLot {
  lot: Lot;
  bidLakh: number | null;
  holder: string | null;
  bidCount: number;
}

export type LogEntry =
  | { kind: 'sold'; playerId: string; team: string; priceLakh: number; setName: string; accelerated: boolean }
  | { kind: 'unsold'; playerId: string; setName: string; accelerated: boolean };

export interface AuctionState {
  version: 1;
  seed: number;
  rules: Rules;
  players: Record<string, Player>;
  teams: TeamState[];
  queue: Lot[];
  lotIndex: number;
  round: 'main' | 'accelerated';
  current: CurrentLot | null;
  /** Players who went unsold in the main round, waiting for the accelerated round. */
  unsoldMain: string[];
  log: LogEntry[];
  finished: boolean;
}
