import { describe, expect, it } from 'vitest';
import data from '../data/players.json';
import { IPL_TEAMS } from '../data/teams';
import type { AuctionState, Player, PlayerRecord, Rules } from './types';
import { increment, nextBidAmount, formatLakh } from './money';
import { DEFAULT_RULES, setSummaries, upcomingLots, bidBlock, canBid, createAuction, hammer, maxSpend, placeBid, team } from './auction';
import { aiPickBidder, simulateToEnd, valuation } from './ai';
import { acceleratedPrice, buildLots, parsePlayersCsv, withIds } from './pool';
import { bestXI } from './xi';
import { simulateSeason } from './season';
import { makeRng } from './rng';
import {
  applyAction,
  autoPick,
  challengeOpen,
  createDraft,
  currentLot,
  draftTeam,
  finishTeam,
  listTotals,
  makePick,
  onTheClock,
  ownerOf,
  pickBlock,
  priceOf,
  redactFor,
  runAi,
  skipTurn,
  type DraftState,
} from './draft';

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
    expect(s.teams.every((t) => t.squad.length === 0 && t.purseLakh === DEFAULT_RULES.purseCr * 100)).toBe(true);
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
    expect(rr.purseLakh).toBe(DEFAULT_RULES.purseCr * 100 - price);
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

describe('running order', () => {
  it('lists sets in order with lot positions and status', () => {
    let s = newAuction({ poolMode: 'full' });
    let sets = setSummaries(s);
    expect(sets[0]).toMatchObject({ name: 'Marquee', firstLot: 1, status: 'current' });
    expect(sets[1].firstLot).toBe(sets[0].lastLot + 1);
    expect(sets.slice(1).every((x) => x.status === 'upcoming')).toBe(true);
    expect(sets.reduce((n, x) => n + x.total, 0)).toBe(s.queue.length);
    // Get through the marquee set with no bids.
    while (s.current?.lot.setName === 'Marquee') s = hammer(s);
    sets = setSummaries(s);
    expect(sets[0]).toMatchObject({ status: 'done', unsold: sets[0].total });
    expect(sets[1].status).toBe('current');
  });
  it('lists upcoming players after the one on the block', () => {
    const s = newAuction({ poolMode: 'full' });
    const next = upcomingLots(s);
    expect(next).toHaveLength(s.queue.length - 1);
    expect(next[0].lotNumber).toBe(2);
    expect(next[0].lot).toBe(s.queue[1]);
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
  it('autopilot drafts for human teams when simulating to the end', () => {
    const s = simulateToEnd(newAuction({ poolMode: 'full' }, ['MI']), makeRng(3), true);
    expect(team(s, 'MI').squad.length).toBeGreaterThanOrEqual(s.rules.squadMin);
  });
  it.each([15, 25])('handles a squad size of %i', (squadMax) => {
    const s = simulateToEnd(newAuction({ poolMode: 'real', squadMax }, []), makeRng(11));
    for (const t of s.teams) {
      expect(t.squad.length).toBeLessThanOrEqual(squadMax);
      expect(t.squad.length).toBeGreaterThanOrEqual(s.rules.squadMin);
    }
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

describe('real-price draft', () => {
  const rules: Rules = { ...DEFAULT_RULES, game: 'draft' };
  const newDraft = (humans: string[] = [], r: Partial<Rules> = {}, seed = 7) =>
    createDraft({ rules: { ...rules, ...r }, teams: IPL_TEAMS.map((def) => ({ def, human: humans.includes(def.code) })), players, seed });
  const byName = (s: DraftState, name: string) => Object.values(s.players).find((p) => p.name === name)!;

  it('pools only current IPL players, each at his 2026 price', () => {
    const s = newDraft();
    expect(s.available.length).toBe(250);
    expect(priceOf(byName(s, 'KL Rahul'))).toBe(1400);
    expect(priceOf(byName(s, 'Venkatesh Iyer'))).toBe(700);
    expect(priceOf(byName(s, 'Virat Kohli'))).toBe(2100);
  });

  it('takes the real price off the purse and moves the turn on, snaking each round', () => {
    let s = newDraft(IPL_TEAMS.map((t) => t.code));
    const first = onTheClock(s)!;
    const rahul = byName(s, 'KL Rahul');
    s = makePick(s, first, rahul.id);
    expect(draftTeam(s, first).purseLakh).toBe(120 * 100 - 1400);
    expect(s.available).not.toContain(rahul.id);
    expect(onTheClock(s)).toBe(s.order[1]);
    // Someone else can't take him now.
    expect(pickBlock(s, onTheClock(s)!, rahul.id)).toBe('taken');
    // Finish round 1: the last team in round 1 opens round 2.
    for (let i = 1; i < s.order.length; i++) s = autoPick(s, makeRng(i));
    expect(s.round).toBe(2);
    expect(onTheClock(s)).toBe(s.order[s.order.length - 1]);
  });

  it('blocks picks out of turn, over budget and past the overseas cap', () => {
    let s = newDraft(['MI', 'CSK'], { purseCr: 20, squadMin: 11 });
    const code = onTheClock(s)!;
    const other = s.order.find((c) => c !== code)!;
    const cheap = s.available.map((id) => s.players[id]).find((p) => priceOf(p) === 30 && !p.overseas)!;
    expect(pickBlock(s, other, cheap.id)).toBe('not-your-turn');
    // ₹20 Cr less ₹30 L x 10 still-needed slots leaves ₹17 Cr: Kohli at ₹21 Cr is out of reach.
    expect(pickBlock(s, code, byName(s, 'Virat Kohli').id)).toBe('purse');
    s = { ...s, rules: { ...s.rules, overseasMax: 0 } };
    expect(pickBlock(s, code, byName(s, 'Travis Head').id)).toBe('overseas-full');
  });

  it('lets a team finish once it has its minimum squad', () => {
    let s = newDraft(['MI']);
    expect(finishTeam(s, 'MI')).toBe(s);
    s = runAi(s, makeRng(1), true);
    expect(s.finished).toBe(true);
  });

  it('runs an all-AI draft to the end with legal, affordable squads', () => {
    for (const r of [{}, { purseCr: 60, squadMax: 15 }, { purseCr: 100, squadMax: 25, squadMin: 18 }]) {
      const s = runAi(newDraft([], r), makeRng(3), true);
      expect(s.finished).toBe(true);
      for (const t of s.teams) {
        expect(t.purseLakh).toBeGreaterThanOrEqual(0);
        expect(t.squad.length).toBeLessThanOrEqual(s.rules.squadMax);
        expect(t.squad.length).toBeGreaterThanOrEqual(11);
        expect(t.squad.filter((e) => s.players[e.playerId].overseas).length).toBeLessThanOrEqual(s.rules.overseasMax);
        expect(bestXI(t.squad.map((e) => s.players[e.playerId])).hasKeeper).toBe(true);
      }
      // Money is conserved: what every squad cost plus what's left is the starting purses.
      const spent = s.teams.reduce((n, t) => n + t.squad.reduce((m, e) => m + e.priceLakh, 0), 0);
      expect(spent + s.teams.reduce((n, t) => n + t.purseLakh, 0)).toBe(s.teams.length * s.rules.purseCr * 100);
    }
  });

  it('stops for humans and only auto-picks for them when asked', () => {
    let s = runAi(newDraft(['RCB']), makeRng(5));
    expect(onTheClock(s)).toBe('RCB');
    s = autoPick(s, makeRng(6));
    expect(s.picks[s.picks.length - 1]).toMatchObject({ team: 'RCB', auto: true });
  });

  it('lets the team on the clock skip its turn, keeping its money', () => {
    let s = newDraft(IPL_TEAMS.map((t) => t.code));
    const first = onTheClock(s)!;
    const other = s.order[1];
    expect(skipTurn(s, other)).toBe(s); // not their turn
    s = skipTurn(s, first);
    expect(draftTeam(s, first).purseLakh).toBe(120 * 100);
    expect(draftTeam(s, first).squad.length).toBe(0);
    expect(s.passes).toEqual([{ round: 1, team: first, afterPick: 0 }]);
    expect(onTheClock(s)).toBe(other);
    expect(s.picks.length).toBe(0);
  });

  it('only applies actions for the team on the clock', () => {
    const s = newDraft(IPL_TEAMS.map((t) => t.code));
    const notUp = s.order[2];
    const id = s.available[0];
    expect(applyAction(s, { type: 'pick', team: notUp, playerId: id }, makeRng(1))).toBe(s);
    expect(applyAction(s, { type: 'auto', team: notUp }, makeRng(1))).toBe(s);
    expect(applyAction(s, { type: 'skip', team: notUp }, makeRng(1))).toBe(s);
    expect(applyAction(s, { type: 'pick', team: onTheClock(s)!, playerId: id }, makeRng(1)).picks.length).toBe(1);
  });
});

describe('challenges and RTM', () => {
  const teams = (humans: string[]) => IPL_TEAMS.map((def) => ({ def, human: humans.includes(def.code) }));
  const rng = makeRng(11);

  it('lets a team challenge another squad’s player, then auctions him with an RTM for his team', () => {
    // Everyone is a person here, so only the challenges we make happen (auto-pick never challenges for people).
    let s = createDraft({ rules: { ...DEFAULT_RULES, game: 'draft', challenges: true, rtmCards: 1, squadMax: 15 }, teams: teams(IPL_TEAMS.map((t) => t.code)), players, seed: 4 });
    // Play until MI is up and CSK owns somebody.
    for (let g = 0; g < 400 && !(onTheClock(s) === 'MI' && draftTeam(s, 'CSK').squad.length > 0); g++) s = applyAction(s, { type: 'auto', team: onTheClock(s)! }, rng);
    expect(onTheClock(s)).toBe('MI');
    const target = draftTeam(s, 'CSK').squad[0];
    const open = challengeOpen(s, target.playerId);
    expect(open).toBeGreaterThan(target.priceLakh);
    s = applyAction(s, { type: 'challenge', team: 'MI', playerId: target.playerId }, rng);
    expect(s.challenges[0]).toMatchObject({ playerId: target.playerId, owner: 'CSK', teams: ['MI'] });
    // The challenge holds a slot and the opening bid back from MI.
    expect(onTheClock(s)).not.toBe('MI');
    // Finish the picking with the AI for everyone except the auction.
    for (let g = 0; g < 2000 && s.phase === 'picking'; g++) s = applyAction(s, { type: 'auto', team: onTheClock(s)! }, rng);
    expect(s.phase).toBe('auction');
    let lot = currentLot(s)!;
    while (lot.playerId !== target.playerId) {
      s = applyAction(s, { type: 'hammer', seq: s.auction!.seq }, rng);
      lot = currentLot(s)!;
    }
    expect(lot).toMatchObject({ kind: 'challenge', holder: 'CSK', bidders: ['MI'], openLakh: open });
    s = applyAction(s, { type: 'bid', team: 'MI' }, rng);
    expect(s.auction!.bid).toBe(open);
    // Clock runs out: CSK (a person) gets the RTM call.
    s = applyAction(s, { type: 'hammer', seq: s.auction!.seq }, rng);
    expect(s.auction!.stage).toBe('rtm');
    const cskPurse = draftTeam(s, 'CSK').purseLakh;
    s = applyAction(s, { type: 'rtm', team: 'CSK', use: true }, rng);
    expect(ownerOf(s, target.playerId)?.code).toBe('CSK');
    expect(draftTeam(s, 'CSK').purseLakh).toBe(cskPurse - (open - target.priceLakh));
    expect(s.rtmLeft.CSK).toBe(0);
    expect(s.auctionLog.find((r) => r.playerId === target.playerId)).toMatchObject({ rtm: true, to: 'CSK', priceLakh: open });
  });

  it('moves the player and refunds his old team when the RTM is declined', () => {
    let s = createDraft({ rules: { ...DEFAULT_RULES, game: 'draft', challenges: true, rtmCards: 3, squadMax: 15 }, teams: teams(IPL_TEAMS.map((t) => t.code)), players, seed: 4 });
    for (let g = 0; g < 400 && !(onTheClock(s) === 'MI' && draftTeam(s, 'CSK').squad.length > 0); g++) s = applyAction(s, { type: 'auto', team: onTheClock(s)! }, rng);
    const target = draftTeam(s, 'CSK').squad[0];
    s = applyAction(s, { type: 'challenge', team: 'MI', playerId: target.playerId }, rng);
    for (let g = 0; g < 2000 && s.phase === 'picking'; g++) s = applyAction(s, { type: 'auto', team: onTheClock(s)! }, rng);
    while (currentLot(s)!.playerId !== target.playerId) s = applyAction(s, { type: 'hammer', seq: s.auction!.seq }, rng);
    s = applyAction(s, { type: 'bid', team: 'MI' }, rng);
    const bid = s.auction!.bid!;
    const before = { csk: draftTeam(s, 'CSK').purseLakh, mi: draftTeam(s, 'MI').purseLakh };
    s = applyAction(s, { type: 'hammer', seq: s.auction!.seq }, rng);
    // CSK gets the RTM call if it can afford to match; either way it lets him go here.
    if (s.auction?.stage === 'rtm') s = applyAction(s, { type: 'rtm', team: 'CSK', use: false }, rng);
    expect(ownerOf(s, target.playerId)?.code).toBe('MI');
    expect(draftTeam(s, 'CSK').purseLakh).toBe(before.csk + target.priceLakh);
    expect(draftTeam(s, 'MI').purseLakh).toBe(before.mi - bid);
  });

  it('runs a secret draft: lists stay private, clashes are auctioned, everyone ends with one owner per player', () => {
    let s = createDraft({ rules: { ...DEFAULT_RULES, game: 'secret' }, teams: teams(['MI']), players, seed: 8 });
    expect(s.phase).toBe('secret');
    expect(s.secret!.locked.length).toBe(9); // the AI teams lock in at once
    const bumrah = Object.values(s.players).find((p) => p.name === 'Jasprit Bumrah')!;
    s = applyAction(s, { type: 'list-add', team: 'MI', playerId: bumrah.id }, rng);
    expect(listTotals(s, 'MI')).toMatchObject({ count: 1, spend: priceOf(bumrah) });
    expect(applyAction(s, { type: 'lock', team: 'MI' }, rng)).toBe(s); // not enough players yet
    // A guest only sees their own list.
    expect(Object.keys(redactFor(s, 'MI').secret!.lists)).toEqual(['MI']);
    s = applyAction(s, { type: 'list-auto', team: 'MI' }, rng);
    expect(listTotals(s, 'MI').count).toBeGreaterThanOrEqual(s.rules.squadMin);
    s = applyAction(s, { type: 'lock', team: 'MI' }, rng);
    expect(s.phase === 'auction' || s.phase === 'picking').toBe(true);
    s = runAi(s, rng, true);
    expect(s.finished).toBe(true);
    const seen = new Set<string>();
    for (const t of s.teams) for (const e of t.squad) {
      expect(seen.has(e.playerId)).toBe(false);
      seen.add(e.playerId);
    }
    expect(s.auctionLog.length).toBeGreaterThan(0);
    expect(s.teams.every((t) => t.purseLakh >= 0)).toBe(true);
  });
});
