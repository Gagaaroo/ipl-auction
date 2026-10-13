import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Player, TeamState } from '../engine/types';
import { awards, playSeason, teamResults, type ResultSource, type SeasonResult, type TableRow, type TeamResult } from '../engine/season';
import { ballsToOvers, type InningsCard, type MatchCard } from '../engine/match';
import { avg, economy, leaders, seasonStats, strikeRate, type SeasonStats } from '../engine/stats';
import { formatLakh } from '../engine/money';
import { inkFor } from '../data/teams';
import { BallRating, ConfirmDialog, OS, TeamBadge, type Ask } from './bits';

interface Props {
  state: ResultSource;
  seasonSeed: number;
  /** Hidden for online guests: only the host replays or starts again. */
  onReplay?: () => void;
  onNew?: () => void;
  newLabel?: string;
}

type Tab = 'summary' | 'matches' | 'stats' | 'lineups';

const STAGE_LABEL: Record<MatchCard['stage'], string> = {
  league: 'League',
  qualifier1: 'Qualifier 1',
  eliminator: 'Eliminator',
  qualifier2: 'Qualifier 2',
  final: 'Final',
};

export function Results({ state, seasonSeed, onReplay, onNew, newLabel }: Props) {
  const results = useMemo(() => teamResults(state), [state]);
  const season = useMemo(() => playSeason(results, seasonSeed), [results, seasonSeed]);
  const stats = useMemo(() => seasonStats(season), [season]);
  const prizes = useMemo(() => awards(state, results), [state, results]);
  const teams = useMemo(() => new Map(state.teams.map((t) => [t.code, t])), [state.teams]);
  const teamOf = useCallback((code: string) => teams.get(code)!, [teams]);
  const [tab, setTab] = useState<Tab>('summary');
  const [open, setOpen] = useState<MatchCard | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const closeAsk = useCallback(() => setAsk(null), []);
  const closeCard = useCallback(() => setOpen(null), []);
  const word = state.mode === 'auction' ? 'auction' : 'draft';
  const champ = teamOf(season.champion);
  const orange = leaders.orange(stats)[0];
  const purple = leaders.purple(stats)[0];
  const name = (id: string) => season.people[id]?.name ?? state.players[id]?.name ?? id;
  const potmTeam = season.teamOf[season.final.playerOfMatch] ?? season.champion;

  return (
    <div className="results">
      <div className="board champ" style={{ ['--team' as string]: champ.color }}>
        <div className="board-label">IPL champions</div>
        <div className="board-num champ-name">
          <TeamBadge team={champ} size="lg" /> {champ.name}
        </div>
        <div className="board-holder">
          Final: {innLine(season.final.first)} v {innLine(season.final.second)} · {season.final.result}
        </div>
        <div className="caps-strip">
          {orange && <Cap kind="orange" label="Orange Cap" who={name(orange.playerId)} team={teamOf(orange.team)} value={`${orange.runs} runs`} />}
          {purple && <Cap kind="purple" label="Purple Cap" who={name(purple.playerId)} team={teamOf(purple.team)} value={`${purple.wickets} wickets`} />}
          <Cap kind="potm" label="Player of the final" who={name(season.final.playerOfMatch)} team={teamOf(potmTeam)} value="" />
        </div>
      </div>

      {(onReplay || onNew) && (
        <div className="row wrap gap">
          {onReplay && (
            <button type="button" className="btn btn-big" onClick={onReplay}>
              ↻ Replay season
            </button>
          )}
          {onNew && (
            <button
              type="button"
              className="btn"
              onClick={() =>
                setAsk({
                  message: newLabel ? `${newLabel}? These results will be cleared for everyone.` : `Start a new ${word}? These results will be cleared.`,
                  yes: newLabel ?? `New ${word}`,
                  onYes: onNew,
                })
              }
            >
              {newLabel ?? `New ${word}`}
            </button>
          )}
        </div>
      )}

      <div className="tabs result-tabs" role="tablist">
        {(['summary', 'matches', 'stats', 'lineups'] as Tab[]).map((t) => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === 'summary' ? 'Table & awards' : t === 'matches' ? `Matches (${season.matches.length})` : t === 'stats' ? 'Player stats' : 'Lineups'}
          </button>
        ))}
      </div>

      {tab === 'summary' && (
        <>
          <section className="panel">
            <h2>Playoffs</h2>
            <div className="match-grid">
              {season.playoffs.map((m) => (
                <MatchTile key={m.no} m={m} teamOf={teamOf} name={name} onOpen={() => setOpen(m)} />
              ))}
            </div>
          </section>
          <PointsTable table={season.table} teamOf={teamOf} qualify={season.playoffs.length > 1 ? 4 : 2} />
          <section className="panel">
            <h2>Awards</h2>
            <div className="awards">
              {prizes.map((a) => (
                <div key={a.title} className="award">
                  <h3>{a.title}</h3>
                  {a.player && (
                    <p className="award-main">
                      <BallRating value={a.player.overall} size={32} /> {a.player.name}
                    </p>
                  )}
                  {a.team && !a.player && (
                    <p className="award-main">
                      <TeamBadge team={teamOf(a.team)} /> {teamOf(a.team).name}
                    </p>
                  )}
                  <p className="muted">{a.detail}</p>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {tab === 'matches' && <MatchList season={season} teamOf={teamOf} name={name} onOpen={setOpen} />}
      {tab === 'stats' && <StatsTab stats={stats} season={season} teamOf={teamOf} name={name} />}
      {tab === 'lineups' && <Lineups results={results} season={season} state={state} teamOf={teamOf} />}

      {open && <Scorecard m={open} season={season} teamOf={teamOf} name={name} onClose={closeCard} />}
      <ConfirmDialog ask={ask} onClose={closeAsk} />
    </div>
  );
}

function innLine(i: InningsCard) {
  return `${i.team} ${i.runs}${i.wickets < 10 ? `/${i.wickets}` : ''} (${ballsToOvers(i.balls)})`;
}

function Cap({ kind, label, who, team, value }: { kind: 'orange' | 'purple' | 'potm'; label: string; who: string; team: TeamState; value: string }) {
  return (
    <div className={`cap cap-${kind}`}>
      <span className="cap-label">{label}</span>
      <span className="cap-who">
        <TeamBadge team={team} size="sm" /> {who}
      </span>
      {value && <span className="cap-val">{value}</span>}
    </div>
  );
}

function PointsTable({ table, teamOf, qualify }: { table: TableRow[]; teamOf: (c: string) => TeamState; qualify: number }) {
  return (
    <section className="panel">
      <h2>Points table</h2>
      <div className="table-wrap">
        <table className="points">
          <thead>
            <tr>
              <th>#</th>
              <th>Team</th>
              <th>P</th>
              <th>W</th>
              <th>L</th>
              <th>NRR</th>
              <th className="hide-sm">For</th>
              <th className="hide-sm">Against</th>
              <th className="hide-sm">Form</th>
              <th>Pts</th>
            </tr>
          </thead>
          <tbody>
            {table.map((r, i) => {
              const t = teamOf(r.code);
              return (
                <tr key={r.code} className={i < qualify ? 'qualified' : ''} style={{ ['--team' as string]: t.color }}>
                  <td>{i + 1}</td>
                  <td className="pt-team">
                    <TeamBadge team={t} size="sm" /> <span className="hide-sm">{t.name}</span>
                    {i < qualify && <span className="q-tag">Q</span>}
                  </td>
                  <td>{r.played}</td>
                  <td>{r.won}</td>
                  <td>{r.lost}</td>
                  <td>{(r.nrr >= 0 ? '+' : '') + r.nrr.toFixed(3)}</td>
                  <td className="muted hide-sm">
                    {r.runsFor}/{ballsToOvers(r.ballsFaced)}
                  </td>
                  <td className="muted hide-sm">
                    {r.runsAgainst}/{ballsToOvers(r.ballsBowled)}
                  </td>
                  <td className="hide-sm">
                    <span className="form">
                      {r.form.map((f, k) => (
                        <span key={k} className={`form-${f}`}>
                          {f}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td>
                    <b>{r.points}</b>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">
        Top {qualify} reach the playoffs
        {qualify === 4 ? ': 1st v 2nd in Qualifier 1 (winner to the final), 3rd v 4th in the Eliminator, then Qualifier 2' : ''}. Ties on points are
        split by net run rate.
      </p>
    </section>
  );
}

function MatchTile({ m, teamOf, name, onOpen }: { m: MatchCard; teamOf: (c: string) => TeamState; name: (id: string) => string; onOpen: () => void }) {
  return (
    <button type="button" className={`match-tile stage-${m.stage}`} onClick={onOpen} aria-label={`Scorecard: match ${m.no}, ${m.result}`}>
      <span className="mt-head">
        <span>{m.stage === 'league' ? `Match ${m.no}` : STAGE_LABEL[m.stage]}</span>
        <span className="mt-potm">★ {name(m.playerOfMatch)}</span>
      </span>
      {[m.first, m.second].map((inn) => {
        const t = teamOf(inn.team);
        const won = m.winner === inn.team;
        return (
          <span key={inn.team} className={`mt-row ${won ? 'won' : ''}`} style={{ ['--team' as string]: t.color, ['--team-ink' as string]: inkFor(t.color) }}>
            <span className="mt-code">{t.code}</span>
            <span className="mt-name">{t.name}</span>
            <span className="mt-score">
              {inn.runs}
              {inn.wickets < 10 ? `/${inn.wickets}` : ''}
              <small>({ballsToOvers(inn.balls)})</small>
            </span>
          </span>
        );
      })}
      <span className="mt-result">{m.result}</span>
    </button>
  );
}

function MatchList({ season, teamOf, name, onOpen }: { season: SeasonResult; teamOf: (c: string) => TeamState; name: (id: string) => string; onOpen: (m: MatchCard) => void }) {
  const [team, setTeam] = useState('ALL');
  const codes = season.table.map((r) => r.code);
  const show = (m: MatchCard) => team === 'ALL' || m.teams.includes(team);
  return (
    <>
      <div className="chips match-filter" role="group" aria-label="Show matches for">
        <button type="button" className={team === 'ALL' ? 'on' : ''} onClick={() => setTeam('ALL')}>
          All teams
        </button>
        {codes.map((c) => (
          <button key={c} type="button" className={`team-chip ${team === c ? 'on' : ''}`} onClick={() => setTeam(c)} style={{ ['--team' as string]: teamOf(c).color }}>
            {c}
          </button>
        ))}
      </div>
      {season.playoffs.some(show) && (
        <section className="panel">
          <h2>Playoffs</h2>
          <div className="match-grid">
            {season.playoffs.filter(show).map((m) => (
              <MatchTile key={m.no} m={m} teamOf={teamOf} name={name} onOpen={() => onOpen(m)} />
            ))}
          </div>
        </section>
      )}
      <section className="panel">
        <h2>League · {season.league.filter(show).length} matches</h2>
        <p className="hint">Tap a match for the full scorecard.</p>
        <div className="match-grid">
          {season.league.filter(show).map((m) => (
            <MatchTile key={m.no} m={m} teamOf={teamOf} name={name} onOpen={() => onOpen(m)} />
          ))}
        </div>
      </section>
    </>
  );
}

function Scorecard({ m, season, teamOf, name, onClose }: { m: MatchCard; season: SeasonResult; teamOf: (c: string) => TeamState; name: (id: string) => string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  const decided = m.tossWinner === m.first.team ? 'chose to bat' : 'chose to field';
  return (
    <div className="scrim sheet-scrim" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`Scorecard, match ${m.no}`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <div>
            <div className="eyebrow">{m.stage === 'league' ? `Match ${m.no} · League` : STAGE_LABEL[m.stage]}</div>
            <h2>
              {teamOf(m.teams[0]).name} v {teamOf(m.teams[1]).name}
            </h2>
            <p className="small-note">
              Toss: {m.tossWinner}, {decided} · Player of the match: <b>{name(m.playerOfMatch)}</b> ({season.teamOf[m.playerOfMatch]})
            </p>
          </div>
          <button type="button" className="btn btn-small" onClick={onClose} autoFocus>
            Close ✕
          </button>
        </div>
        <div className="sheet-result" style={{ ['--team' as string]: teamOf(m.winner).color }}>
          {m.result}
        </div>
        <OverBars m={m} teamOf={teamOf} />
        {[m.first, m.second].map((inn, i) => (
          <InningsBlock key={inn.team} inn={inn} team={teamOf(inn.team)} name={name} target={i === 1 ? m.first.runs + 1 : null} />
        ))}
      </div>
    </div>
  );
}

/** Runs in each over, both innings side by side, in team colours. */
function OverBars({ m, teamOf }: { m: MatchCard; teamOf: (c: string) => TeamState }) {
  const per = (inn: InningsCard) => inn.overs.map((r, i) => r - (inn.overs[i - 1] ?? 0));
  const a = per(m.first);
  const b = per(m.second);
  const max = Math.max(12, ...a, ...b);
  const c1 = teamOf(m.first.team).color;
  const c2 = teamOf(m.second.team).color;
  return (
    <div className="manhattan" aria-label="Runs per over">
      <div className="mh-legend">
        <span style={{ ['--team' as string]: c1 }}>{m.first.team}</span>
        <span style={{ ['--team' as string]: c2 }}>{m.second.team}</span>
        <span className="muted">runs per over</span>
      </div>
      <div className="mh-bars">
        {Array.from({ length: 20 }, (_, i) => (
          <div key={i} className="mh-over" title={`Over ${i + 1}: ${a[i] ?? '–'} / ${b[i] ?? '–'}`}>
            <span className="mh-pair">
              <span style={{ height: `${((a[i] ?? 0) / max) * 100}%`, background: c1 }} />
              <span style={{ height: `${((b[i] ?? 0) / max) * 100}%`, background: c2 }} />
            </span>
            <span className="mh-n">{i + 1}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function InningsBlock({ inn, team, name, target }: { inn: InningsCard; team: TeamState; name: (id: string) => string; target: number | null }) {
  const ex = inn.extras;
  const extras = ex.wides + ex.noBalls + ex.byes + ex.legByes;
  const rr = inn.balls ? ((inn.runs / inn.balls) * 6).toFixed(2) : '0.00';
  return (
    <section className="innings">
      <div className="inn-head" style={{ background: team.color, color: inkFor(team.color) }}>
        <span className="inn-team">{team.name}</span>
        <span className="inn-score">
          {inn.runs}
          {inn.wickets < 10 ? `/${inn.wickets}` : ' all out'} <small>({ballsToOvers(inn.balls)} ov, RR {rr})</small>
        </span>
      </div>
      {target && <p className="small-note inn-target">Target {target}</p>}
      <div className="table-wrap">
        <table className="card-table">
          <thead>
            <tr>
              <th>Batter</th>
              <th className="hide-sm" />
              <th>R</th>
              <th>B</th>
              <th>4s</th>
              <th>6s</th>
              <th>SR</th>
            </tr>
          </thead>
          <tbody>
            {inn.batting.map((b) => (
              <tr key={b.playerId} className={b.runs >= 50 ? 'big' : ''}>
                <td>
                  <b>{name(b.playerId)}</b>
                  <span className="how show-sm">{b.how}</span>
                </td>
                <td className="hide-sm how">{b.how}</td>
                <td>
                  <b>{b.runs}</b>
                  {!b.out && '*'}
                </td>
                <td>{b.balls}</td>
                <td>{b.fours}</td>
                <td>{b.sixes}</td>
                <td>{strikeRate(b.runs, b.balls).toFixed(1)}</td>
              </tr>
            ))}
            <tr className="sub">
              <td colSpan={2}>Extras</td>
              <td colSpan={5}>
                {extras} <span className="muted">(b {ex.byes}, lb {ex.legByes}, w {ex.wides}, nb {ex.noBalls})</span>
              </td>
            </tr>
            <tr className="sub total">
              <td colSpan={2}>Total</td>
              <td colSpan={5}>
                <b>
                  {inn.runs}
                  {inn.wickets < 10 ? `/${inn.wickets}` : ' all out'}
                </b>{' '}
                <span className="muted">({ballsToOvers(inn.balls)} overs)</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {inn.didNotBat.length > 0 && (
        <p className="small-note">
          <b>Did not bat:</b> {inn.didNotBat.map(name).join(', ')}
        </p>
      )}
      {inn.fow.length > 0 && (
        <p className="small-note">
          <b>Fall of wickets:</b> {inn.fow.map((f) => `${f.score}-${f.wicket} (${name(f.playerId)}, ${ballsToOvers(f.ball)})`).join(', ')}
        </p>
      )}
      <div className="table-wrap">
        <table className="card-table">
          <thead>
            <tr>
              <th>Bowler</th>
              <th>O</th>
              <th>M</th>
              <th>R</th>
              <th>W</th>
              <th>Econ</th>
              <th>0s</th>
              <th className="hide-sm">WD</th>
              <th className="hide-sm">NB</th>
            </tr>
          </thead>
          <tbody>
            {inn.bowling.map((b) => (
              <tr key={b.playerId} className={b.wickets >= 3 ? 'big' : ''}>
                <td>
                  <b>{name(b.playerId)}</b>
                </td>
                <td>{ballsToOvers(b.balls)}</td>
                <td>{b.maidens}</td>
                <td>{b.runs}</td>
                <td>
                  <b>{b.wickets}</b>
                </td>
                <td>{economy(b.runs, b.balls).toFixed(2)}</td>
                <td>{b.dots}</td>
                <td className="hide-sm">{b.wides}</td>
                <td className="hide-sm">{b.noBalls}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------- stats ----------

type BoardId = 'orange' | 'purple' | 'sixes' | 'fours' | 'highest' | 'bestBowling' | 'strikeRate' | 'economy' | 'fifties' | 'catches' | 'dots' | 'potm';

const BOARDS: { id: BoardId; label: string; chip: string }[] = [
  { id: 'orange', label: 'Most runs (Orange Cap)', chip: 'Most runs' },
  { id: 'purple', label: 'Most wickets (Purple Cap)', chip: 'Most wickets' },
  { id: 'sixes', label: 'Most sixes', chip: 'Most 6s' },
  { id: 'fours', label: 'Most fours', chip: 'Most 4s' },
  { id: 'highest', label: 'Highest scores', chip: 'Highest scores' },
  { id: 'bestBowling', label: 'Best bowling figures', chip: 'Best bowling' },
  { id: 'strikeRate', label: 'Best batting strike rate', chip: 'Best SR' },
  { id: 'economy', label: 'Best economy', chip: 'Best economy' },
  { id: 'fifties', label: 'Most fifties', chip: 'Most 50s' },
  { id: 'catches', label: 'Most catches', chip: 'Most catches' },
  { id: 'dots', label: 'Most dot balls', chip: 'Most dots' },
  { id: 'potm', label: 'Most Player of the Match awards', chip: 'Player of the match' },
];

function StatsTab({ stats, season, teamOf, name }: { stats: SeasonStats; season: SeasonResult; teamOf: (c: string) => TeamState; name: (id: string) => string }) {
  const [board, setBoard] = useState<BoardId>('orange');
  const games = Math.max(...season.table.map((r) => r.played));
  const minBalls = Math.max(30, games * 6);
  const minBowl = Math.max(36, games * 6);
  const who = (id: string, team: string) => (
    <span className="lb-player">
      <TeamBadge team={teamOf(team)} size="sm" /> <b>{name(id)}</b>
    </span>
  );

  let head: string[] = [];
  let rows: ReactNode[][] = [];
  switch (board) {
    case 'orange':
      head = ['Player', 'Runs', 'Mat', 'Inns', 'NO', 'HS', 'Avg', 'BF', 'SR', '100', '50', '4s', '6s'];
      rows = leaders.orange(stats).map((b) => [
        who(b.playerId, b.team), b.runs, b.matches, b.innings, b.notOuts, `${b.highest}${b.highestNotOut ? '*' : ''}`,
        avg(b.runs, b.innings - b.notOuts).toFixed(2), b.balls, strikeRate(b.runs, b.balls).toFixed(2), b.hundreds, b.fifties, b.fours, b.sixes,
      ]);
      break;
    case 'purple':
      head = ['Player', 'Wkts', 'Mat', 'Inns', 'Ov', 'Runs', 'BBI', 'Avg', 'Econ', 'SR', '4w', '5w'];
      rows = leaders.purple(stats).map((b) => [
        who(b.playerId, b.team), b.wickets, b.matches, b.innings, ballsToOvers(b.balls), b.runs, `${b.best.wickets}/${b.best.runs}`,
        (b.runs / Math.max(1, b.wickets)).toFixed(2), economy(b.runs, b.balls).toFixed(2), (b.balls / Math.max(1, b.wickets)).toFixed(1), b.fourFors, b.fiveFors,
      ]);
      break;
    case 'sixes':
      head = ['Player', '6s', 'Mat', 'Inns', 'Runs', 'SR'];
      rows = leaders.sixes(stats).map((b) => [who(b.playerId, b.team), b.sixes, b.matches, b.innings, b.runs, strikeRate(b.runs, b.balls).toFixed(2)]);
      break;
    case 'fours':
      head = ['Player', '4s', 'Mat', 'Inns', 'Runs', 'SR'];
      rows = leaders.fours(stats).map((b) => [who(b.playerId, b.team), b.fours, b.matches, b.innings, b.runs, strikeRate(b.runs, b.balls).toFixed(2)]);
      break;
    case 'highest':
      head = ['Player', 'Score', 'Balls', '4s', '6s', 'SR', 'Against', 'Match'];
      rows = leaders.highest(stats).map((i) => [
        who(i.playerId, i.team), `${i.runs}${i.notOut ? '*' : ''}`, i.balls, i.fours, i.sixes, strikeRate(i.runs, i.balls).toFixed(2), `v ${i.against}`, i.matchNo,
      ]);
      break;
    case 'bestBowling':
      head = ['Player', 'Figures', 'Overs', 'Econ', 'Against', 'Match'];
      rows = leaders.bestBowling(stats).map((x) => [who(x.playerId, x.team), `${x.wickets}/${x.runs}`, ballsToOvers(x.balls), economy(x.runs, x.balls).toFixed(2), `v ${x.against}`, x.matchNo]);
      break;
    case 'strikeRate':
      head = ['Player', 'SR', 'Runs', 'Balls', '4s', '6s'];
      rows = leaders.strikeRate(stats, minBalls).map((b) => [who(b.playerId, b.team), strikeRate(b.runs, b.balls).toFixed(2), b.runs, b.balls, b.fours, b.sixes]);
      break;
    case 'economy':
      head = ['Player', 'Econ', 'Overs', 'Runs', 'Wkts', 'Dots'];
      rows = leaders.economy(stats, minBowl).map((b) => [who(b.playerId, b.team), economy(b.runs, b.balls).toFixed(2), ballsToOvers(b.balls), b.runs, b.wickets, b.dots]);
      break;
    case 'fifties':
      head = ['Player', '50s', '100s', 'Runs', 'HS', 'SR'];
      rows = leaders.fifties(stats).map((b) => [who(b.playerId, b.team), b.fifties, b.hundreds, b.runs, `${b.highest}${b.highestNotOut ? '*' : ''}`, strikeRate(b.runs, b.balls).toFixed(2)]);
      break;
    case 'catches':
      head = ['Player', 'Catches', 'Mat'];
      rows = leaders.catches(stats).map((c) => [who(c.playerId, c.team), c.catches, stats.played[c.playerId] ?? '–']);
      break;
    case 'dots':
      head = ['Player', 'Dots', 'Overs', 'Wkts', 'Econ'];
      rows = leaders.dots(stats).map((b) => [who(b.playerId, b.team), b.dots, ballsToOvers(b.balls), b.wickets, economy(b.runs, b.balls).toFixed(2)]);
      break;
    case 'potm':
      head = ['Player', 'Awards', 'Mat'];
      rows = leaders.potm(stats).map((c) => [who(c.playerId, c.team), c.awards, stats.played[c.playerId] ?? '–']);
      break;
  }

  const orange = leaders.orange(stats).slice(0, 3);
  const purple = leaders.purple(stats).slice(0, 3);
  const accent = board === 'orange' ? 'lb-orange' : board === 'purple' ? 'lb-purple' : '';

  return (
    <>
      <div className="cap-cards">
        <div className="cap-card cap-orange">
          <span className="cap-label">Orange Cap · most runs</span>
          {orange.map((b, i) => (
            <span key={b.playerId} className={`cap-line ${i === 0 ? 'lead' : ''}`}>
              <span className="lot-no">{i + 1}</span>
              <TeamBadge team={teamOf(b.team)} size="sm" /> <span className="grow">{name(b.playerId)}</span> <b>{b.runs}</b>
            </span>
          ))}
        </div>
        <div className="cap-card cap-purple">
          <span className="cap-label">Purple Cap · most wickets</span>
          {purple.map((b, i) => (
            <span key={b.playerId} className={`cap-line ${i === 0 ? 'lead' : ''}`}>
              <span className="lot-no">{i + 1}</span>
              <TeamBadge team={teamOf(b.team)} size="sm" /> <span className="grow">{name(b.playerId)}</span> <b>{b.wickets}</b>
            </span>
          ))}
        </div>
      </div>
      <section className={`panel ${accent}`}>
        <div className="lb-head">
          <h2>{BOARDS.find((b) => b.id === board)!.label}</h2>
          <span className="eyebrow">Top 10</span>
        </div>
        <div className="chips stat-chips" role="group" aria-label="Statistic">
          {BOARDS.map((b) => (
            <button key={b.id} type="button" className={board === b.id ? 'on' : ''} aria-pressed={board === b.id} onClick={() => setBoard(b.id)}>
              {b.chip}
            </button>
          ))}
        </div>
        {(board === 'strikeRate' || board === 'economy') && (
          <p className="hint">Minimum {board === 'strikeRate' ? `${minBalls} balls faced` : `${minBowl / 6} overs bowled`}.</p>
        )}
        <div className="table-wrap">
          <table className="stat-table">
            <thead>
              <tr>
                <th>Pos</th>
                {head.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={i === 0 ? 'lead' : ''}>
                  <td>{i + 1}</td>
                  {r.map((c, k) => (
                    <td key={k} className={k === 1 ? 'key' : ''}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">Includes playoff matches, as the IPL does.</p>
      </section>
    </>
  );
}

// ---------- lineups ----------

function Lineups({ results, season, state, teamOf }: { results: TeamResult[]; season: SeasonResult; state: ResultSource; teamOf: (c: string) => TeamState }) {
  const priceOf = (code: string, id: string) => teamOf(code).squad.find((e) => e.playerId === id)?.priceLakh;
  const order = season.table.map((r) => r.code);
  return (
    <>
      <div className="lineups">
        {order.map((code) => {
          const t = teamOf(code);
          const r = results.find((x) => x.code === code)!;
          const xi = season.lineups[code];
          const xiIds = new Set(r.xi.players.map((p) => p.id));
          const bench = r.squad.filter((p) => !xiIds.has(p.id)).sort((a, b) => b.overall - a.overall);
          const spent = t.squad.reduce((n, e) => n + e.priceLakh, 0);
          return (
            <section key={code} className="lineup" style={{ ['--team' as string]: t.color }}>
              <header className="lineup-head" style={{ background: t.color, color: inkFor(t.color) }}>
                <span className="lineup-code">{t.code}</span>
                <span className="lineup-name">{t.name}</span>
                <span className="lineup-rating" title="XI rating">
                  {r.xi.rating}
                </span>
              </header>
              <p className="lineup-meta">
                Bat {r.xi.batting} · Bowl {r.xi.bowling} · squad {r.squad.length} · spent {formatLakh(spent)} · {formatLakh(t.purseLakh)} left
              </p>
              <ol className="lineup-xi">
                {xi.map((p: Player, i: number) => {
                  const price = priceOf(code, p.id);
                  return (
                    <li key={p.id}>
                      <span className="lot-no">{i + 1}</span>
                      <span className={`role role-${p.role}`}>{p.role}</span>
                      <span className="grow">
                        {p.name}
                        {p.role === 'WK' && ' †'} {p.overseas && <OS />}
                      </span>
                      <span className="muted num">{p.overall}</span>
                      <span className="price">{price !== undefined ? formatLakh(price) : '—'}</span>
                    </li>
                  );
                })}
              </ol>
              {bench.length > 0 && (
                <p className="lineup-bench">
                  <b>Bench:</b> {bench.map((p) => p.name).join(', ')}
                </p>
              )}
              {r.xi.fillers > 0 && (
                <p className="lineup-bench warn">
                  {r.xi.fillers} local fill-in{r.xi.fillers > 1 ? 's' : ''} in the XI: squad too short.
                </p>
              )}
            </section>
          );
        })}
      </div>
      <p className="hint">
        Batting order is best batter first. † keeper, ✈ overseas. {state.mode === 'auction' ? 'Prices are what each team paid at the auction.' : 'Prices are what each team paid.'}
      </p>
    </>
  );
}
