import type { AuctionState, PlayerRecord, Rules, TeamDef } from '../engine/types';
import { upgradeDraft, type DraftState } from '../engine/draft';

const KEYS = {
  auction: 'iat:auction:v1',
  draft: 'iat:draft:v1',
  host: 'iat:host:v1',
  guest: 'iat:guest:v1',
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

export interface SavedDraft {
  draft: DraftState;
  seasonSeed: number;
}

export const loadDraft = () => {
  const s = read<SavedDraft>(KEYS.draft);
  return s?.draft?.kind === 'draft' && s.draft.version === 1 ? { ...s, draft: upgradeDraft(s.draft) } : null;
};
export const saveDraft = (s: SavedDraft | null) => write(KEYS.draft, s);

export const loadSetup = <T,>() => read<T>(KEYS.setup);
export const saveSetup = (s: unknown) => write(KEYS.setup, s);

export const loadCustomPlayers = () => read<PlayerRecord[]>(KEYS.players);
export const saveCustomPlayers = (p: PlayerRecord[] | null) => write(KEYS.players, p);

export const loadSound = () => read<boolean>(KEYS.sound) ?? true;
export const saveSound = (on: boolean) => write(KEYS.sound, on);

// ---------- online rooms ----------

export interface HostSaved {
  code: string;
  hostName: string;
  /** The team the host plays. */
  hostSeat: string;
  config: { teams: { def: TeamDef; human: boolean }[]; rules: Rules; players: PlayerRecord[] };
  /** Friends who have taken a team: team code -> who. */
  seats: Record<string, { clientId: string; name: string }>;
  draft: DraftState | null;
  seasonSeed: number;
}

export const loadHost = () => {
  const s = read<HostSaved>(KEYS.host);
  return s?.code ? { ...s, draft: s.draft ? upgradeDraft(s.draft) : null } : null;
};
export const saveHost = (s: HostSaved | null) => write(KEYS.host, s);

export interface GuestSaved {
  code: string;
  clientId: string;
  name: string;
}
export const loadGuest = () => read<GuestSaved>(KEYS.guest);
export const saveGuest = (s: GuestSaved | null) => write(KEYS.guest, s);
export const loadName = () => read<string>('iat:name') ?? '';
export const saveName = (n: string) => write('iat:name', n);
