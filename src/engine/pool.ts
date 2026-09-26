import type { Lot, Player, PlayerRecord, Role, Rules, SquadEntry } from './types';
import { type Rng, shuffle } from './rng';

/** What a player is "worth" in lakh at a ₹100 Cr purse, from rating alone. */
export function fairValueLakh(overall: number): number {
  const x = Math.max(0, Math.min(49, overall - 50)) / 45;
  return roundTo5(20 + Math.pow(x, 2.2) * 1600);
}

export function roundTo5(n: number): number {
  return Math.max(5, Math.round(n / 5) * 5);
}

export function baseSlab(overall: number): number {
  if (overall >= 85) return 200;
  if (overall >= 80) return 150;
  if (overall >= 76) return 100;
  if (overall >= 68) return 75;
  if (overall >= 62) return 50;
  return 30;
}

export function withIds(records: PlayerRecord[]): Player[] {
  const seen = new Map<string, number>();
  return records.map((r) => {
    const slug = r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const n = (seen.get(slug) ?? 0) + 1;
    seen.set(slug, n);
    return { ...r, id: n === 1 ? slug : `${slug}-${n}` };
  });
}

// ---------- sets ----------

const ROLE_ORDER: Role[] = ['BAT', 'AR', 'WK', 'BOWL'];
const ROLE_SET_NAME: Record<Role, string> = { BAT: 'Batters', AR: 'All-rounders', WK: 'Wicketkeepers', BOWL: 'Bowlers' };

export function tierOf(overall: number): number {
  if (overall >= 76) return 1;
  if (overall >= 68) return 2;
  if (overall >= 60) return 3;
  return 4;
}

export const MARQUEE_MIN = 85;
export const MARQUEE_MAX = 18;

/**
 * Marquee first, then Batters / All-rounders / Wicketkeepers / Bowlers,
 * cycling through tiers top-first (Batters 1, All-rounders 1, ... Bowlers 4).
 */
export function buildLots(pool: Player[], rng: Rng): Lot[] {
  const sorted = pool.slice().sort((a, b) => b.overall - a.overall);
  const marquee = sorted.filter((p) => p.overall >= MARQUEE_MIN).slice(0, MARQUEE_MAX);
  const marqueeIds = new Set(marquee.map((p) => p.id));
  const lots: Lot[] = [];
  const push = (players: Player[], setName: string) => {
    for (const p of shuffle(players, rng)) {
      lots.push({ playerId: p.id, setName, basePriceLakh: p.basePriceLakh, accelerated: false });
    }
  };
  push(marquee, 'Marquee');
  const rest = sorted.filter((p) => !marqueeIds.has(p.id));
  for (let tier = 1; tier <= 4; tier++) {
    for (const role of ROLE_ORDER) {
      const group = rest.filter((p) => p.role === role && tierOf(p.overall) === tier);
      if (group.length) push(group, `${ROLE_SET_NAME[role]} ${tier}`);
    }
  }
  return lots;
}

export function acceleratedPrice(baseLakh: number): number {
  return Math.max(10, Math.floor(baseLakh / 2 / 5) * 5);
}

// ---------- real squads ----------

export interface Retention {
  squads: Record<string, SquadEntry[]>;
  spentLakh: Record<string, number>;
  retainedIds: Set<string>;
}

/**
 * "Real squads": each IPL team in the auction keeps its best team2026 players,
 * leaving room to buy at least 6 more and 2 overseas. Retention costs come from
 * the rating curve, scaled down if they'd eat more than 60% of the purse.
 */
export function retainRealSquads(players: Player[], teamCodes: string[], rules: Rules): Retention {
  const purse = rules.purseCr * 100;
  const keepMax = Math.max(0, rules.squadMax - 6);
  const overseasKeepMax = Math.max(0, rules.overseasMax - 2);
  const squads: Record<string, SquadEntry[]> = {};
  const spentLakh: Record<string, number> = {};
  const retainedIds = new Set<string>();
  for (const code of teamCodes) {
    const own = players.filter((p) => p.team2026 === code).sort((a, b) => b.overall - a.overall);
    const kept: Player[] = [];
    let os = 0;
    for (const p of own) {
      if (kept.length >= keepMax) break;
      if (p.overseas && os >= overseasKeepMax) continue;
      if (p.overseas) os++;
      kept.push(p);
    }
    const scale = purse / 10000;
    let costs = kept.map((p) => fairValueLakh(p.overall) * scale);
    const total = costs.reduce((s, c) => s + c, 0);
    const cap = purse * 0.6;
    if (total > cap) costs = costs.map((c) => (c * cap) / total);
    squads[code] = kept.map((p, i) => ({ playerId: p.id, priceLakh: Math.max(5, Math.floor(costs[i] / 5) * 5), retained: true }));
    spentLakh[code] = squads[code].reduce((s, e) => s + e.priceLakh, 0);
    kept.forEach((p) => retainedIds.add(p.id));
  }
  return { squads, spentLakh, retainedIds };
}

// ---------- CSV import ----------

export const CSV_COLUMNS = ['name', 'role', 'country', 'overseas', 'bat', 'bowl', 'overall', 'basePriceLakh', 'team2026'];

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function computeOverall(role: Role, bat: number, bowl: number): number {
  const hi = Math.max(bat, bowl), lo = Math.min(bat, bowl);
  return role === 'AR' ? Math.min(99, Math.round(hi + lo * 0.06)) : hi;
}

export interface CsvResult {
  players: PlayerRecord[];
  errors: string[];
}

/** Parse the CSV format documented in the README. Only name, role, bat and bowl are required. */
export function parsePlayersCsv(text: string): CsvResult {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
  const errors: string[] = [];
  if (!lines.length) return { players: [], errors: ['File is empty'] };
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  for (const req of ['name', 'role', 'bat', 'bowl']) {
    if (col(req) < 0) errors.push(`Missing column "${req}"`);
  }
  if (errors.length) return { players: [], errors };
  const players: PlayerRecord[] = [];
  lines.slice(1).forEach((line, i) => {
    const cells = splitCsvLine(line);
    const get = (name: string) => (col(name) >= 0 ? cells[col(name)] ?? '' : '');
    const name = get('name');
    const role = get('role').toUpperCase() as Role;
    const bat = Number(get('bat'));
    const bowl = Number(get('bowl'));
    if (!name) return errors.push(`Row ${i + 2}: no name`);
    if (!['BAT', 'BOWL', 'AR', 'WK'].includes(role)) return errors.push(`Row ${i + 2}: role must be BAT, BOWL, AR or WK`);
    if (!Number.isFinite(bat) || !Number.isFinite(bowl)) return errors.push(`Row ${i + 2}: bat/bowl must be numbers`);
    const country = (get('country') || 'IND').toUpperCase();
    const osRaw = get('overseas').toLowerCase();
    const overseas = osRaw ? ['true', 'yes', 'y', '1'].includes(osRaw) : country !== 'IND';
    const overall = Number(get('overall')) || computeOverall(role, bat, bowl);
    const basePriceLakh = Number(get('basePriceLakh')) || baseSlab(overall);
    const team = get('team2026').toUpperCase();
    players.push({ name, role, country, overseas, bat, bowl, overall, basePriceLakh, team2026: team || null, history: [] });
  });
  return { players, errors };
}
