import type { AuctionState, PlayerRecord } from '../engine/types';

const KEYS = {
  auction: 'iat:auction:v1',
  setup: 'iat:setup:v1',
  players: 'iat:players:v1',
  sound: 'iat:sound',
};

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the game still works, it just won't survive a refresh */
  }
}

export interface SavedAuction {
  auction: AuctionState;
  remainingMs: number;
  seasonSeed: number;
}

export const loadAuction = () => {
  const s = read<SavedAuction>(KEYS.auction);
  return s?.auction?.version === 1 ? s : null;
};
export const saveAuction = (s: SavedAuction | null) => write(KEYS.auction, s);

export const loadSetup = <T,>() => read<T>(KEYS.setup);
export const saveSetup = (s: unknown) => write(KEYS.setup, s);

export const loadCustomPlayers = () => read<PlayerRecord[]>(KEYS.players);
export const saveCustomPlayers = (p: PlayerRecord[] | null) => write(KEYS.players, p);

export const loadSound = () => read<boolean>(KEYS.sound) ?? true;
export const saveSound = (on: boolean) => write(KEYS.sound, on);
