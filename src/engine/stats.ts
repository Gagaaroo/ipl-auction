/** Season statistics in the IPL's own format: caps and top-10 tables. */
import type { MatchCard } from './match';
import type { SeasonResult } from './season';

export interface BatStats {
  playerId: string;
  team: string;
  matches: number;
  innings: number;
  notOuts: number;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  fifties: number;
  hundreds: number;
  highest: number;
  highestNotOut: boolean;
  ducks: number;
}

export interface BowlStats {
  playerId: string;
  team: string;
  matches: number;
  innings: number;
  balls: number;
  runs: number;
  wickets: number;
  dots: number;
  maidens: number;
  fourFors: number;
  fiveFors: number;
  best: { wickets: number; runs: number };
}

export interface InningsRecord {
  playerId: string;
  team: string;
  against: string;
  matchNo: number;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  notOut: boolean;
}

export interface SpellRecord {
  playerId: string;
  team: string;
  against: string;
  matchNo: number;
  wickets: number;
  runs: number;
  balls: number;
}

export interface SeasonStats {
  batting: BatStats[];
  bowling: BowlStats[];
  innings: InningsRecord[];
  spells: SpellRecord[];
  catches: { playerId: string; team: string; catches: number }[];
  potm: { playerId: string; team: string; awards: number }[];
  /** Matches played per player. */
  played: Record<string, number>;
}

export const avg = (runs: number, outs: number) => (outs ? runs / outs : runs);
export const strikeRate = (runs: number, balls: number) => (balls ? (runs / balls) * 100 : 0);
export const economy = (runs: number, balls: number) => (balls ? (runs / balls) * 6 : 0);

export function seasonStats(season: SeasonResult): SeasonStats {
  const bat = new Map<string, BatStats>();
  const bowl = new Map<string, BowlStats>();
  const innings: InningsRecord[] = [];
  const spells: SpellRecord[] = [];
  const catches = new Map<string, number>();
  const potm = new Map<string, number>();
  const played: Record<string, number> = {};
  const team = (id: string) => season.teamOf[id] ?? '';

  const each = (m: MatchCard) => {
    for (const code of m.teams) for (const p of season.lineups[code]) played[p.id] = (played[p.id] ?? 0) + 1;
    for (const inn of [m.first, m.second]) {
      const against = inn.team === m.teams[0] ? m.teams[1] : m.teams[0];
      for (const l of inn.batting) {
        const s = bat.get(l.playerId) ?? { playerId: l.playerId, team: team(l.playerId), matches: 0, innings: 0, notOuts: 0, runs: 0, balls: 0, fours: 0, sixes: 0, fifties: 0, hundreds: 0, highest: 0, highestNotOut: false, ducks: 0 };
        s.innings++;
        if (!l.out) s.notOuts++;
        s.runs += l.runs;
        s.balls += l.balls;
        s.fours += l.fours;
        s.sixes += l.sixes;
        if (l.runs >= 100) s.hundreds++;
        else if (l.runs >= 50) s.fifties++;
        if (l.out && l.runs === 0) s.ducks++;
        if (l.runs > s.highest || (l.runs === s.highest && !l.out)) {
          s.highest = l.runs;
          s.highestNotOut = !l.out;
        }
        bat.set(l.playerId, s);
        innings.push({ playerId: l.playerId, team: inn.team, against, matchNo: m.no, runs: l.runs, balls: l.balls, fours: l.fours, sixes: l.sixes, notOut: !l.out });
      }
      for (const b of inn.bowling) {
        const s = bowl.get(b.playerId) ?? { playerId: b.playerId, team: team(b.playerId), matches: 0, innings: 0, balls: 0, runs: 0, wickets: 0, dots: 0, maidens: 0, fourFors: 0, fiveFors: 0, best: { wickets: -1, runs: 0 } };
        s.innings++;
        s.balls += b.balls;
        s.runs += b.runs;
        s.wickets += b.wickets;
        s.dots += b.dots;
        s.maidens += b.maidens;
        if (b.wickets >= 5) s.fiveFors++;
        else if (b.wickets >= 4) s.fourFors++;
        if (b.wickets > s.best.wickets || (b.wickets === s.best.wickets && b.runs < s.best.runs)) s.best = { wickets: b.wickets, runs: b.runs };
        bowl.set(b.playerId, s);
        spells.push({ playerId: b.playerId, team: against, against: inn.team, matchNo: m.no, wickets: b.wickets, runs: b.runs, balls: b.balls });
      }
    }
    for (const c of m.catches) catches.set(c.playerId, (catches.get(c.playerId) ?? 0) + 1);
    potm.set(m.playerOfMatch, (potm.get(m.playerOfMatch) ?? 0) + 1);
  };
  season.matches.forEach(each);
  for (const s of bat.values()) s.matches = played[s.playerId] ?? s.innings;
  for (const s of bowl.values()) s.matches = played[s.playerId] ?? s.innings;
  return {
    batting: [...bat.values()],
    bowling: [...bowl.values()],
    innings,
    spells,
    catches: [...catches.entries()].map(([playerId, n]) => ({ playerId, team: team(playerId), catches: n })),
    potm: [...potm.entries()].map(([playerId, n]) => ({ playerId, team: team(playerId), awards: n })),
    played,
  };
}

const TOP = 10;

export const leaders = {
  /** Orange Cap: most runs (ties: better strike rate). */
  orange: (s: SeasonStats) => [...s.batting].sort((a, b) => b.runs - a.runs || strikeRate(b.runs, b.balls) - strikeRate(a.runs, a.balls)).slice(0, TOP),
  /** Purple Cap: most wickets (ties: better economy). */
  purple: (s: SeasonStats) =>
    [...s.bowling].filter((b) => b.wickets > 0).sort((a, b) => b.wickets - a.wickets || economy(a.runs, a.balls) - economy(b.runs, b.balls)).slice(0, TOP),
  sixes: (s: SeasonStats) => [...s.batting].filter((b) => b.sixes > 0).sort((a, b) => b.sixes - a.sixes || b.runs - a.runs).slice(0, TOP),
  fours: (s: SeasonStats) => [...s.batting].filter((b) => b.fours > 0).sort((a, b) => b.fours - a.fours || b.runs - a.runs).slice(0, TOP),
  highest: (s: SeasonStats) => [...s.innings].sort((a, b) => b.runs - a.runs || a.balls - b.balls).slice(0, TOP),
  bestBowling: (s: SeasonStats) => [...s.spells].filter((x) => x.wickets > 0).sort((a, b) => b.wickets - a.wickets || a.runs - b.runs).slice(0, TOP),
  /** Best strike rate, with a minimum of balls faced (scaled to the season length). */
  strikeRate: (s: SeasonStats, minBalls: number) =>
    [...s.batting].filter((b) => b.balls >= minBalls).sort((a, b) => strikeRate(b.runs, b.balls) - strikeRate(a.runs, a.balls)).slice(0, TOP),
  /** Best economy, with a minimum number of overs. */
  economy: (s: SeasonStats, minBalls: number) =>
    [...s.bowling].filter((b) => b.balls >= minBalls).sort((a, b) => economy(a.runs, a.balls) - economy(b.runs, b.balls)).slice(0, TOP),
  fifties: (s: SeasonStats) =>
    [...s.batting].filter((b) => b.fifties + b.hundreds > 0).sort((a, b) => b.fifties + b.hundreds - (a.fifties + a.hundreds) || b.runs - a.runs).slice(0, TOP),
  catches: (s: SeasonStats) => [...s.catches].sort((a, b) => b.catches - a.catches).slice(0, TOP),
  dots: (s: SeasonStats) => [...s.bowling].sort((a, b) => b.dots - a.dots).slice(0, TOP),
  potm: (s: SeasonStats) => [...s.potm].sort((a, b) => b.awards - a.awards).slice(0, TOP),
};
