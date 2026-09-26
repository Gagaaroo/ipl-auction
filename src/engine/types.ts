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

export interface Rules {
  purseCr: number;
  squadMax: number;
  squadMin: number;
  overseasMax: number;
  overseasXI: number;
  clockSec: number;
  poolMode: PoolMode;
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
