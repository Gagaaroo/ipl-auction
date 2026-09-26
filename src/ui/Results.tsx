import { useMemo } from 'react';
import type { AuctionState } from '../engine/types';
import { awards, oversText, simulateSeason, strengths, teamResults, type MatchResult } from '../engine/season';
import { formatLakh } from '../engine/money';
import { BallRating, Board, OS, TeamBadge } from './bits';

interface Props {
  state: AuctionState;
  seasonSeed: number;
  onReplay: () => void;
  onNew: () => void;
}

export function Results({ state, seasonSeed, onReplay, onNew }: Props) {
  const results = useMemo(() => teamResults(state), [state]);
  const season = useMemo(() => simulateSeason(strengths(results), seasonSeed), [results, seasonSeed]);
  const prizes = useMemo(() => awards(state, results), [state, results]);
  const teamOf = (code: string) => state.teams.find((t) => t.code === code)!;
  const champ = teamOf(season.champion);
  const priceOf = (id: string) => {
    for (const t of state.teams) {
      const e = t.squad.find((x) => x.playerId === id);
      if (e) return e.retained ? 'kept' : formatLakh(e.priceLakh);
    }
    return '';
  };

  return (
    <div className="results">
      <Board className="champ">
        <div className="board-label">Champions</div>
        <div className="board-num champ-name">
          <TeamBadge team={champ} size="lg" /> {champ.name}
        </div>
        <div className="board-holder">Final: {finalLine(season.final)}</div>
      </Board>

      <div className="row wrap gap">
        <button type="button" className="btn btn-big" onClick={onReplay}>
          ↻ Replay season
        </button>
        <button type="button" className="btn" onClick={onNew}>
          New auction
        </button>
      </div>

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
              <p className="muted">
                {a.title === 'Strongest XI' && `XI rating ${a.detail}`}
                {(a.title === 'Costliest buy' || a.title === 'Steal of the auction') && `${formatLakh(Number(a.detail))} to ${a.team}`}
                {a.title === 'Best unsold player' && `Overall ${a.detail}, nobody bit`}
              </p>
            </div>
          ))}
        </div>
      </section>

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
                <th>Pts</th>
                <th>NRR</th>
              </tr>
            </thead>
            <tbody>
              {season.table.map((r, i) => (
                <tr key={r.code} className={i < 2 ? 'qualified' : ''}>
                  <td>{i + 1}</td>
                  <td>
                    <TeamBadge team={teamOf(r.code)} size="sm" /> <span className="hide-sm">{teamOf(r.code).name}</span>
                  </td>
                  <td>{r.played}</td>
                  <td>{r.won}</td>
                  <td>{r.lost}</td>
                  <td>
                    <b>{r.points}</b>
                  </td>
                  <td>{(r.nrr >= 0 ? '+' : '') + r.nrr.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">Top two go to the final. Ties on points split by net run rate.</p>
        <details>
          <summary>All {season.matches.length} league matches</summary>
          <ol className="matches">
            {season.matches.map((m, i) => (
              <li key={i}>{finalLine(m)}</li>
            ))}
          </ol>
        </details>
      </section>

      <section className="panel">
        <h2>Best XIs</h2>
        <p className="hint">One keeper, at least five bowling options, no more than {state.rules.overseasXI} overseas. Rated out of 99.</p>
        <div className="xis">
          {[...results]
            .sort((a, b) => b.xi.rating - a.xi.rating)
            .map((r) => {
              const t = teamOf(r.code);
              const spent = t.squad.reduce((s, e) => s + e.priceLakh, 0);
              return (
                <details key={r.code} className="xi" style={{ ['--team' as string]: t.color }}>
                  <summary>
                    <TeamBadge team={t} />
                    <span className="grow">{t.name}</span>
                    <span className="xi-nums">
                      <span title="Batting">Bat {r.xi.batting}</span>
                      <span title="Bowling">Bowl {r.xi.bowling}</span>
                      <b title="XI rating">{r.xi.rating}</b>
                    </span>
                  </summary>
                  <p className="muted small">
                    Squad of {r.squad.length} · spent {formatLakh(spent)} · {formatLakh(t.purseLakh)} left
                    {!r.xi.hasKeeper && ' · ⚠ no keeper'}
                    {r.xi.bowlingOptions < 5 && ` · ⚠ only ${r.xi.bowlingOptions} bowling options`}
                    {r.xi.fillers > 0 && ` · ⚠ ${r.xi.fillers} local fill-in${r.xi.fillers > 1 ? 's' : ''}`}
                  </p>
                  <ol className="xi-list">
                    {r.xi.players.map((p) => (
                      <li key={p.id}>
                        <span className={`role role-${p.role}`}>{p.role}</span>
                        <span className="grow">
                          {p.name} {p.overseas && <OS />}
                        </span>
                        <span className="muted small">
                          {p.bat}/{p.bowl}
                        </span>
                        <span className="price">{priceOf(p.id)}</span>
                      </li>
                    ))}
                  </ol>
                </details>
              );
            })}
        </div>
      </section>
    </div>
  );
}

function score(i: MatchResult['first']) {
  return `${i.team} ${i.runs}${i.wickets < 10 ? `/${i.wickets}` : ''} (${oversText(i.balls)})`;
}

function finalLine(m: MatchResult) {
  return `${score(m.first)} v ${score(m.second)} — ${m.summary}`;
}
