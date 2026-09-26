import { describe, expect, it } from 'vitest';
import data from '../data/players.json';
import { IPL_TEAMS } from '../data/teams';
import type { AuctionState, Player, PlayerRecord, Rules } from './types';
import { increment, nextBidAmount, formatLakh } from './money';
import { DEFAULT_RULES, bidBlock, canBid, createAuction, hammer, maxSpend, nextBid, placeBid, team } from './auction';
import { aiPickBidder, simulateToEnd, valuation } from './ai';
import { acceleratedPrice, buildLots, parsePlayersCsv, withIds } from './pool';
import { bestXI } from './xi';
import { simulateSeason } from './season';
import { makeRng } from './rng';

const players = data.players as PlayerRecord[];

function newAuction(rules: Partial<Rules> = {}, humans: string[] = ['MI'], seed = 42): AuctionState {
  return createAuction({
    rules: { ...DEFAULT_RULES, ...rules },
    teams: IPL_TEAMS.map((def) => ({ def, human: humans.includes(def.code) })),
    players,
    seed,
  });
}

function mk(name: string, role: Player['role'], bat: number, bowl: number, overseas = false): Player {
  return { id: name, name, role, country: overseas ? 'AUS' : 'IND', overseas, bat, bowl, overall: Math.max(bat, bowl), basePriceLakh: 30, team2026: null, history: [] };
}

describe('money', () => {
  it('uses the house increment slabs', () => {
    expect(increment(20)).toBe(10);
    expect(increment(90)).toBe(10);
    expect(increment(100)).toBe(20);
    expect(increment(180)).toBe(20);
    expect(increment(200)).toBe(25);
    expect(increment(475)).toBe(25);
    expect(increment(500)).toBe(50);
    expect(increment(950)).toBe(50);
    expect(increment(1000)).toBe(100);
  });
  it('opens at base price', () => {
    expect(nextBidAmount(null, 75)).toBe(75);
    expect(nextBidAmount(75, 75)).toBe(85);
  });
  it('formats rupees', () => {
    expect(formatLakh(20)).toBe('₹20 L');
    expect(formatLakh(200)).toBe('₹2 Cr');
    expect(formatLakh(1175)).toBe('₹11.75 Cr');
  });
});

describe('player pool', () => {
  it('loads all 610 players', () => {
    expect(players.length).toBe(data.meta.count);
  });
  it('orders sets marquee first, top tier first', () => {
    const lots = buildLots(withIds(players), makeRng(1));
    expect(lots[0].setName).toBe('Marquee');
    const names = [...new Set(lots.map((l) => l.setName))];
    expect(names.slice(0, 5)).toEqual(['Marquee', 'Batters 1', 'All-rounders 1', 'Wicketkeepers 1', 'Bowlers 1']);
    expect(lots.length).toBe(players.length);
  });
  it('halves base price in the accelerated round', () => {
    expect(acceleratedPrice(200)).toBe(100);
    expect(acceleratedPrice(75)).toBe(35);
    expect(acceleratedPrice(30)).toBe(15);
  });
  it('parses CSV with defaults and reports bad rows', () => {
    const csv = 'name,role,country,bat,bowl\n"Smith, Jr",BAT,AUS,80,10\nNobody,XYZ,IND,1,1\n';
    const { players: ps, errors } = parsePlayersCsv(csv);
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ name: 'Smith, Jr', overseas: true, overall: 80, basePriceLakh: 150 });
    expect(errors[0]).toMatch(/Row 3/);
  });
});

describe('auction engine', () => {
  it('real squads mode retains players and leaves room to buy', () => {
    const s = newAuction({ poolMode: 'real' });
    const csk = team(s, 'CSK');
    expect(csk.squad.length).toBe(12);
    expect(csk.purseLakh).toBeGreaterThanOrEqual(4000);
    expect(s.queue.some((l) => l.playerId === csk.squad[0].playerId)).toBe(false);
  });
  it('full auction puts everyone in the pool', () => {
    const s = newAuction({ poolMode: 'full' });
    expect(s.teams.every((t) => t.squad.length === 0 && t.purseLakh === 10000)).toBe(true);
    expect(s.queue.length).toBe(players.length);
  });
  it('bids climb by increments and the holder cannot bid again', () => {
    let s = newAuction({ poolMode: 'full' });
    const base = s.current!.lot.basePriceLakh;
    s = placeBid(s, 'MI');
    expect(s.current!.bidLakh).toBe(base);
    expect(bidBlock(s, 'MI')).toBe('holder');
    s = placeBid(s, 'CSK');
    expect(s.current!.bidLakh).toBe(base + increment(base));
  });
  it('sells to the holder and deducts purse', () => {
    let s = newAuction({ poolMode: 'full' });
    const id = s.current!.lot.playerId;
    s = placeBid(s, 'RR');
    const price = s.current!.bidLakh!;
    s = hammer(s);
    const rr = team(s, 'RR');
    expect(rr.squad.map((e) => e.playerId)).toContain(id);
    expect(rr.purseLakh).toBe(10000 - price);
    expect(s.log.at(-1)).toMatchObject({ kind: 'sold', team: 'RR' });
  });
  it('blocks a bid that would leave too little to fill the minimum squad', () => {
    const s = newAuction({ poolMode: 'full', purseCr: 60 });
    const t = team(s, 'KKR');
    // Needs 10 more after this one at ₹20 L each = ₹2 Cr reserve.
    expect(maxSpend(t, s.rules)).toBe(6000 - 200);
    expect(canBid(s, 'KKR', 5900)).toBe(false);
    expect(canBid(s, 'KKR', 5800)).toBe(true);
  });
  it('unsold players come back in an accelerated round at half price', () => {
    let s = newAuction({ poolMode: 'full' });
    const first = s.current!.lot;
    s = hammer(s); // nobody bid
    expect(s.unsoldMain).toContain(first.playerId);
    // Skip to the end of the main queue.
    while (s.round === 'main' && !s.finished) s = hammer(s);
    expect(s.round).toBe('accelerated');
    const again = s.queue.find((l) => l.accelerated && l.playerId === first.playerId)!;
    expect(again.basePriceLakh).toBe(acceleratedPrice(first.basePriceLakh));
  });
});

describe('AI', () => {
  it('values stars above squad players and rookies', () => {
    const s = newAuction({ poolMode: 'full' });
    const t = team(s, 'CSK');
    const byName = (n: string) => Object.values(s.players).find((p) => p.name === n)!;
    expect(valuation(s, t, byName('Jasprit Bumrah'))).toBeGreaterThan(valuation(s, t, byName('Harshal Patel')));
    expect(valuation(s, t, byName('Harshal Patel'))).toBeGreaterThan(valuation(s, t, byName('Yajas Sharma')));
  });
  it('waits a human-like beat after a bid', () => {
    const s = newAuction({ poolMode: 'full' });
    expect(aiPickBidder(s, { remainingMs: 3000, sinceLastBidMs: 100 }, makeRng(1))).toBeNull();
  });
  it('runs a full auction to a sane finish', () => {
    const s = simulateToEnd(newAuction({ poolMode: 'full' }, []), makeRng(7));
    expect(s.finished).toBe(true);
    for (const t of s.teams) {
      expect(t.purseLakh).toBeGreaterThanOrEqual(0);
      expect(t.squad.length).toBeGreaterThanOrEqual(s.rules.squadMin);
      expect(t.squad.length).toBeLessThanOrEqual(s.rules.squadMax);
      const os = t.squad.filter((e) => s.players[e.playerId].overseas).length;
      expect(os).toBeLessThanOrEqual(s.rules.overseasMax);
    }
  });
});

describe('best XI', () => {
  it('picks a keeper, five bowling options and at most four overseas', () => {
    const squad = [
      mk('WK1', 'WK', 70, 5), mk('WK2', 'WK', 60, 5),
      ...Array.from({ length: 6 }, (_, i) => mk(`OSBAT${i}`, 'BAT', 90 - i, 10, true)),
      ...Array.from({ length: 4 }, (_, i) => mk(`BAT${i}`, 'BAT', 75 - i, 10)),
      ...Array.from({ length: 5 }, (_, i) => mk(`BOWL${i}`, 'BOWL', 10, 70 - i)),
    ];
    const xi = bestXI(squad, 4);
    expect(xi.players).toHaveLength(11);
    expect(xi.hasKeeper).toBe(true);
    expect(xi.bowlingOptions).toBeGreaterThanOrEqual(5);
    expect(xi.overseas).toBeLessThanOrEqual(4);
  });
  it('drafts fillers when the squad is short', () => {
    const xi = bestXI([mk('A', 'WK', 60, 5), mk('B', 'BOWL', 5, 60)], 4);
    expect(xi.players).toHaveLength(11);
    expect(xi.fillers).toBe(9);
  });
});

describe('season', () => {
  it('plays everyone, awards 2 points a win and crowns a finalist', () => {
    const teams = ['A', 'B', 'C', 'D'].map((code, i) => ({ code, bat: 60 + i * 5, bowl: 60 + i * 5 }));
    const s = simulateSeason(teams, 3);
    expect(s.matches).toHaveLength(12); // 4 teams, double round robin
    expect(s.table.reduce((n, r) => n + r.points, 0)).toBe(24);
    expect([s.table[0].code, s.table[1].code]).toContain(s.champion);
    expect(s.table.every((r) => Number.isFinite(r.nrr))).toBe(true);
  });
  it('is deterministic for a seed', () => {
    const teams = [{ code: 'A', bat: 70, bowl: 70 }, { code: 'B', bat: 70, bowl: 70 }];
    expect(simulateSeason(teams, 9)).toEqual(simulateSeason(teams, 9));
  });
});
