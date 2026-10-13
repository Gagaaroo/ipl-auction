/**
 * Online rooms. The host's browser runs the draft; friends connect straight to it
 * over WebRTC, using the free PeerJS cloud to find each other (and its relay
 * servers when a direct connection isn't possible). No backend of our own.
 */
import type { PeerOptions } from 'peerjs';
import type { DraftAction, DraftState } from '../engine/draft';

import type { SeatInfo } from '../ui/DraftRoom';
export type { SeatInfo };

/** One team in the lobby, as everyone sees it. */
export interface SeatView {
  code: string;
  name: string;
  color: string;
  /** A person plays this team (host or a friend); otherwise the AI. */
  human: boolean;
  /** Who has taken it, if anyone. */
  taker: string | null;
  online: boolean;
  isHost: boolean;
}

export interface LobbyView {
  hostName: string;
  seats: SeatView[];
  rulesLine: string;
}

export type GuestMsg =
  | { t: 'hello'; clientId: string; name: string }
  | { t: 'claim'; team: string }
  | { t: 'action'; action: DraftAction };

export type HostMsg =
  | { t: 'lobby'; lobby: LobbyView; yourSeat: string | null }
  | { t: 'snapshot'; draft: DraftState; seats: Record<string, SeatInfo>; yourSeat: string | null; seasonSeed: number }
  | { t: 'update'; draft: Omit<DraftState, 'players'>; seats: Record<string, SeatInfo>; seasonSeed: number }
  | { t: 'notice'; text: string }
  | { t: 'closed' };

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

export function newClientId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export const isRoomCode = (s: string | null | undefined): s is string => !!s && /^[A-HJ-NP-Z2-9]{6}$/.test(s);

/** The host registers under this id, so the room code alone is enough to find it. */
export const roomPeerId = (code: string) => `auction-table-v2-${code.toLowerCase()}`;

export function joinLink(code: string): string {
  const u = new URL(window.location.href);
  u.search = `?join=${code}`;
  u.hash = '';
  return u.toString();
}

export function readJoinCode(): string | null {
  const c = new URLSearchParams(window.location.search).get('join')?.toUpperCase();
  return isRoomCode(c) ? c : null;
}

export function leaveJoinLink() {
  const u = new URL(window.location.href);
  u.search = '';
  u.hash = '#play';
  window.location.assign(u.toString());
}

/** The public PeerJS cloud by default; a local PeerJS server when VITE_PEER_HOST is set (for testing). */
export function peerOptions(): PeerOptions {
  const env = import.meta.env;
  const o: PeerOptions = { debug: 0 };
  if (env.VITE_PEER_HOST) {
    o.host = env.VITE_PEER_HOST;
    o.port = Number(env.VITE_PEER_PORT || 443);
    o.path = env.VITE_PEER_PATH || '/';
    o.secure = env.VITE_PEER_SECURE !== 'false';
  }
  if (env.VITE_PEER_ICE === 'none') o.config = { iceServers: [] };
  return o;
}

/** Updates leave out the (unchanging) player list to stay small. */
export function slim(d: DraftState): Omit<DraftState, 'players'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { players, ...rest } = d;
  return rest;
}

/** Keep the screen awake while hosting (the room lives in this tab). */
export async function keepAwake(): Promise<() => void> {
  try {
    const lock = await (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request(
      'screen',
    );
    return () => void lock?.release().catch(() => {});
  } catch {
    return () => {};
  }
}
