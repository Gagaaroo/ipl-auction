import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Player, Role, TeamState } from '../engine/types';
import {
  applyAction,
  draftMaxSpend,
  draftTeam,
  onTheClock,
  overseasIn,
  pickBlock,
  priceOf,
  roundOrder,
  type DraftAction,
  type DraftState,
  type PickBlock,
} from '../engine/draft';
import { formatLakh } from '../engine/money';
import { makeRng } from '../engine/rng';
import { BallRating, ConfirmDialog, OS, ROLE_LABEL, Stat, TeamBadge, type Ask } from './bits';
import { playGavel } from './sound';
import { loadSound, saveSound } from './storage';

interface Props {
  initial: DraftState;
  onChange: (s: DraftState) => void;
}

const BLOCK_TEXT: Record<PickBlock, string> = {
  finished: 'Draft over',
  'not-your-turn': 'Not your turn',
  taken: 'Taken',
  'squad-full': 'Squad full',
  'overseas-full': 'Overseas full',
  purse: 'Can’t afford',
};

const HOW: Record<string, string> = {
  retained: 'retained',
  '2025 auction': 'bought at the 2025 auction',
  '2025 replacement': '2025 replacement signing',
  traded: 'traded in for 2026',
  '2026 auction': 'bought at the 2026 auction',
};

export function priceStory(p: Player): string {
  const how = p.priceHow ? HOW[p.priceHow] ?? p.priceHow : null;
  if (p.price2026Lakh == null) return `Base price ${formatLakh(p.basePriceLakh)}`;
  return `${p.team2026 ?? ''} 2026 price${how ? `, ${how}` : ''}`.trim();
}

/** Who sits at an online team, for labels. */
export interface SeatInfo {
  name: string;
  online: boolean;
}

export interface DraftViewProps {
  state: DraftState;
  /** Teams this device may make moves for. */
  mine: string[];
  /** This device runs the draft: it can pause the AI, change its speed, sim or end. */
  authority: boolean;
  dispatch: (a: DraftAction) => void;
  paused?: boolean;
  setPaused?: (p: boolean) => void;
  speed?: Speed;
  setSpeed?: (s: Speed) => void;
  seats?: Record<string, SeatInfo>;
  /** Extra bar above the room, e.g. the online room status. */
  topBar?: ReactNode;
}

export const SPEEDS = { slow: 1600, normal: 850, fast: 250 } as const;
export type Speed = keyof typeof SPEEDS;

/**
 * On the machine that runs the draft: when the team on the clock is played by the AI
 * (or covered by it), make its pick after `delayFor(code)` ms. Null means a person picks.
 */
export function useAiTurns(state: DraftState, delayFor: (code: string) => number | null, paused: boolean, apply: (a: DraftAction) => void) {
  const code = onTheClock(state);
  const delay = code ? delayFor(code) : null;
  useEffect(() => {
    if (state.finished || !code || delay === null || paused) return;
    const id = window.setTimeout(() => apply({ type: 'auto', team: code }), delay);
    return () => window.clearTimeout(id);
  }, [state, code, delay, paused, apply]);
}

/** Single-device game: humans share this screen, AI teams pick by themselves. */
export function DraftRoom({ initial, onChange }: Props) {
  const [state, setState] = useState(initial);
  const stateRef = useRef(initial);
  const rngRef = useRef(makeRng((Date.now() ^ initial.seed) >>> 0));
  const [speed, setSpeed] = useState<Speed>('normal');
  const [paused, setPaused] = useState(false);

  const apply = useCallback(
    (a: DraftAction) => {
      const n = applyAction(stateRef.current, a, rngRef.current);
      if (n === stateRef.current) return;
      stateRef.current = n;
      setState(n);
      onChange(n);
    },
    [onChange],
  );

  useAiTurns(state, (c) => (draftTeam(state, c).human ? null : SPEEDS[speed]), paused, apply);
  const mine = useMemo(() => state.teams.filter((t) => t.human).map((t) => t.code), [state.teams]);

  return (
    <DraftView
      state={state}
      mine={mine}
      authority
      dispatch={apply}
      paused={paused}
      setPaused={setPaused}
      speed={speed}
      setSpeed={setSpeed}
    />
  );
}

export function DraftView({ state, mine, authority, dispatch, paused = false, setPaused, speed = 'normal', setSpeed, seats, topBar }: DraftViewProps) {
  const [sound, setSound] = useState(loadSound);
  const [ask, setAsk] = useState<Ask | null>(null);
  const closeAsk = useCallback(() => setAsk(null), []);
  const [selected, setSelected] = useState<string | null>(null);

  const code = onTheClock(state);
  const team = code ? draftTeam(state, code) : null;
  const myTurn = !!code && mine.includes(code);

  // The gavel, for every pick, wherever it was made.
  const pickCount = state.picks.length;
  const lastCount = useRef(pickCount);
  useEffect(() => {
    if (pickCount > lastCount.current && sound) playGavel(true);
    lastCount.current = pickCount;
  }, [pickCount, sound]);

  // Drop the selection once that player is gone.
  useEffect(() => {
    if (selected && !state.available.includes(selected)) setSelected(null);
  }, [state.available, selected]);

  const pick = (playerId: string) => {
    if (code && myTurn) dispatch({ type: 'pick', team: code, playerId });
  };

  const lastPick = state.picks[state.picks.length - 1];
  const anyHumans = state.teams.some((t) => t.human);

  return (
    <div className="room draft">
      <div className="room-main">
        {topBar}
        <div className="lot-meta">
          <span className="set-name">Round {state.round}</span>
          <span className="eyebrow">
            Pick {state.picks.length + 1} · {state.available.length} players left on the board
          </span>
        </div>

        <div className="lot">
          <ClockBoard state={state} team={team} myTurn={myTurn} lastPick={lastPick} paused={paused} seats={seats} />
          <SelectedPlate
            state={state}
            playerId={selected ?? (myTurn ? null : lastPick?.playerId ?? null)}
            code={myTurn ? code : null}
            onPick={pick}
            justPicked={!selected && !myTurn && !!lastPick}
          />
        </div>

        <div className="controls">
          {myTurn && (
            <>
              <button type="button" className="btn" onClick={() => dispatch({ type: 'auto', team: code! })}>
                Auto-pick for {team!.code}
              </button>
              <button
                type="button"
                className="btn"
                title="Pass without picking. You keep your money and the next team picks."
                onClick={() => dispatch({ type: 'skip', team: code! })}
              >
                Skip my turn
              </button>
              <button
                type="button"
                className="btn"
                disabled={team!.squad.length < state.rules.squadMin}
                title={`Allowed once you have ${state.rules.squadMin} players`}
                onClick={() =>
                  setAsk({
                    message: `Stop picking for ${team!.name}? You keep your ${team!.squad.length} players and ${formatLakh(team!.purseLakh)}.`,
                    yes: 'Finish squad',
                    onYes: () => dispatch({ type: 'finish', team: code! }),
                  })
                }
              >
                Finish my squad
              </button>
            </>
          )}
          {authority && setPaused && !myTurn && (
            <button type="button" className="btn" onClick={() => setPaused(!paused)} disabled={state.finished}>
              {paused ? '▶ Resume AI' : '❚❚ Pause AI'}
            </button>
          )}
          {authority && setSpeed && (
            <label className="speed">
              <span>AI speed</span>
              <select id="ai-speed" value={speed} onChange={(e) => setSpeed(e.target.value as Speed)}>
                <option value="slow">Slow</option>
                <option value="normal">Normal</option>
                <option value="fast">Fast</option>
              </select>
            </label>
          )}
          <button
            type="button"
            className="btn"
            aria-pressed={sound}
            onClick={() =>
              setSound((v) => {
                saveSound(!v);
                return !v;
              })
            }
          >
            {sound ? '🔊 Sound on' : '🔈 Sound off'}
          </button>
          {authority && (
            <>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  setAsk({
                    message: anyHumans ? 'Let the AI finish the draft? It will pick for every team, including people’s.' : 'Skip to the end of the draft?',
                    yes: 'Sim to the end',
                    onYes: () => dispatch({ type: 'sim' }),
                  })
                }
              >
                Sim to the end
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() =>
                  setAsk({
                    message: 'End the draft now? Every squad stays as it is.',
                    yes: 'End draft',
                    onYes: () => dispatch({ type: 'end' }),
                  })
                }
              >
                End draft
              </button>
            </>
          )}
        </div>

        <PlayerBoard state={state} code={myTurn ? code : null} selected={selected} onSelect={setSelected} onPick={pick} />
      </div>

      <DraftSide state={state} mine={mine} seats={seats} />
      <ConfirmDialog ask={ask} onClose={closeAsk} />
    </div>
  );
}

function ClockBoard({
  state,
  team,
  myTurn,
  lastPick,
  paused,
  seats,
}: {
  state: DraftState;
  team: TeamState | null;
  myTurn: boolean;
  lastPick?: DraftState['picks'][number];
  paused: boolean;
  seats?: Record<string, SeatInfo>;
}) {
  const upNext = useMemo(() => {
    // The next few teams to pick, skipping anyone who has stopped.
    const out: string[] = [];
    const closed = new Set(state.closed);
    let r = state.round, i = state.slot + 1;
    for (let guard = 0; guard < state.order.length * 3 && out.length < 4; guard++) {
      const o = roundOrder(state, r);
      if (i >= o.length) { r++; i = 0; continue; }
      if (!closed.has(o[i])) out.push(o[i]);
      i++;
    }
    return out;
  }, [state]);
  const teamOf = (c: string) => state.teams.find((t) => t.code === c)!;
  const lastBy = lastPick ? teamOf(lastPick.team) : null;
  const seat = team ? seats?.[team.code] : undefined;
  const lastPass = state.passes[state.passes.length - 1];
  const passedJustNow = lastPass && lastPass.afterPick === state.picks.length && (!lastPick || state.passes.length > 0);
  const label = !team
    ? 'Draft complete'
    : myTurn
      ? 'Your pick'
      : seat
        ? `${seat.name}${seat.online ? '' : ' (offline: AI covering)'} is picking`
        : team.human
          ? 'Pass the phone'
          : paused
            ? 'Paused'
            : 'On the clock';

  return (
    <div className={`bidboard ${myTurn ? 'my-turn' : ''}`} style={team ? { ['--team' as string]: team.color } : undefined}>
      <div className="eyebrow">{label}</div>
      <div className="clock-team">
        {team && <TeamBadge team={team} size="lg" />}
        <span>{team ? team.name : 'All squads are done'}</span>
      </div>
      {team && (
        <dl className="board-stats">
          <div>
            <dt>Purse</dt>
            <dd className="digits-sm">{formatLakh(team.purseLakh)}</dd>
          </div>
          <div>
            <dt>Can spend</dt>
            <dd className="digits-sm">{formatLakh(Math.max(0, draftMaxSpend(state, team)))}</dd>
          </div>
          <div>
            <dt>Squad</dt>
            <dd className="digits-sm">
              {team.squad.length}/{state.rules.squadMax}
            </dd>
          </div>
          <div>
            <dt>Overseas</dt>
            <dd className="digits-sm">
              {overseasIn(state, team)}/{state.rules.overseasMax}
            </dd>
          </div>
        </dl>
      )}
      {team && !myTurn && !paused && (!team.human || (seat && !seat.online)) && <div className="thinking">{team.code} is picking…</div>}
      {passedJustNow && (
        <div className="last-pick">
          <span className="eyebrow">Just now</span>
          <span>
            <TeamBadge team={teamOf(lastPass.team)} size="sm" /> skipped their turn
          </span>
        </div>
      )}
      {lastPick && lastBy && (
        <div className="last-pick">
          <span className="eyebrow">Last pick</span>
          <span>
            <TeamBadge team={lastBy} size="sm" /> {state.players[lastPick.playerId].name} · <b>{formatLakh(lastPick.priceLakh)}</b>
            {lastPick.auto && <span className="tag">auto</span>}
          </span>
        </div>
      )}
      {upNext.length > 0 && (
        <div className="up-next-teams">
          <span className="eyebrow">Then</span>
          {upNext.map((c, i) => (
            <TeamBadge key={`${c}-${i}`} team={teamOf(c)} size="sm" />
          ))}
          <span className="muted small">{state.round % 2 === 0 ? '(snake: reversed this round)' : ''}</span>
        </div>
      )}
    </div>
  );
}

function SelectedPlate({
  state,
  playerId,
  code,
  onPick,
  justPicked,
}: {
  state: DraftState;
  playerId: string | null;
  code: string | null;
  onPick: (id: string) => void;
  justPicked: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  // On a phone the plate sits above the list: bring it into view when you choose someone.
  useEffect(() => {
    const el = ref.current;
    if (!code || !playerId || !el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) {
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
    }
  }, [playerId, code]);
  if (!playerId)
    return (
      <article className="plate plate-empty" ref={ref}>
        <p className="plate-hint">
          {code ? 'Tap a player on the board below to see him here, then pick him.' : 'Waiting for the first pick.'}
        </p>
      </article>
    );
  const p = state.players[playerId];
  const block = code ? pickBlock(state, code, playerId) : null;
  const owner = state.teams.find((t) => t.squad.some((e) => e.playerId === playerId));
  return (
    <article className="plate" ref={ref}>
      <div className="chips-row">
        <span className="chip">{ROLE_LABEL[p.role]}</span>
        <span className={`chip ${p.overseas ? 'chip-os' : ''}`}>{p.overseas ? `${p.country} · overseas` : 'India'}</span>
        {justPicked && owner && <span className="chip chip-picked">Picked by {owner.code}</span>}
      </div>
      <div className="plate-main">
        <h2 className="pname">{p.name}</h2>
        <BallRating value={p.overall} size={70} />
      </div>
      <div className="plate-stats">
        <Stat label="Bat" value={p.bat} />
        <Stat label="Bowl" value={p.bowl} />
      </div>
      <p className="plate-price">
        <span className="price-big">{formatLakh(priceOf(p))}</span>
        <span className="price-story">{priceStory(p)}</span>
      </p>
      {p.history.length > 0 && (
        <ul className="history">
          {p.history.map((h) => (
            <li key={h.year}>
              <b>{h.year}</b> {h.result === 'sold' ? `sold to ${h.team} for ${formatLakh(h.priceLakh)}` : `unsold at ${formatLakh(h.basePriceLakh)}`}
            </li>
          ))}
        </ul>
      )}
      {code && !owner && (
        <button type="button" className="btn btn-big pick-btn" disabled={block !== null} onClick={() => onPick(playerId)}>
          {block === null ? `Pick for ${formatLakh(priceOf(p))}` : BLOCK_TEXT[block]}
        </button>
      )}
    </article>
  );
}

const ROLE_FILTERS: (Role | 'ALL')[] = ['ALL', 'BAT', 'WK', 'AR', 'BOWL'];
type Sort = 'price' | 'rating' | 'value' | 'name';
const PAGE = 60;

function PlayerBoard({
  state,
  code,
  selected,
  onSelect,
  onPick,
}: {
  state: DraftState;
  code: string | null;
  selected: string | null;
  onSelect: (id: string) => void;
  onPick: (id: string) => void;
}) {
  const [role, setRole] = useState<Role | 'ALL'>('ALL');
  const [sort, setSort] = useState<Sort>('price');
  const [query, setQuery] = useState('');
  const [team2026, setTeam2026] = useState('ALL');
  const [affordable, setAffordable] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const q = useDeferredValue(query.trim().toLowerCase());

  const rows = useMemo(() => {
    let list = state.available.map((id) => state.players[id]);
    if (role !== 'ALL') list = list.filter((p) => p.role === role);
    if (team2026 !== 'ALL') list = list.filter((p) => p.team2026 === team2026);
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q));
    if (affordable && code) list = list.filter((p) => pickBlock(state, code, p.id) === null);
    const by: Record<Sort, (a: Player, b: Player) => number> = {
      price: (a, b) => priceOf(b) - priceOf(a) || b.overall - a.overall,
      rating: (a, b) => b.overall - a.overall || priceOf(a) - priceOf(b),
      value: (a, b) => b.overall / Math.sqrt(priceOf(b)) - a.overall / Math.sqrt(priceOf(a)),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return list.sort(by[sort]);
  }, [state, role, team2026, q, affordable, code, sort]);

  const realTeams = useMemo(() => [...new Set(Object.values(state.players).map((p) => p.team2026).filter(Boolean))].sort() as string[], [state.players]);

  return (
    <section className="board-list" aria-label="Players still available">
      <div className="board-tools">
        <div className="chips" role="group" aria-label="Filter by role">
          {ROLE_FILTERS.map((r) => (
            <button key={r} type="button" className={role === r ? 'on' : ''} aria-pressed={role === r} onClick={() => setRole(r)}>
              {r === 'ALL' ? 'All' : r}
            </button>
          ))}
        </div>
        <input id="player-search" type="search" placeholder="Search players" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search players" />
        <select id="player-team" value={team2026} onChange={(e) => setTeam2026(e.target.value)} aria-label="2026 team">
          <option value="ALL">All 2026 teams</option>
          {realTeams.map((t) => (
            <option key={t} value={t}>
              Now at {t}
            </option>
          ))}
        </select>
        <select id="player-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
          <option value="price">Price, high first</option>
          <option value="rating">Rating, high first</option>
          <option value="value">Best value</option>
          <option value="name">Name</option>
        </select>
        {code && (
          <label className="check">
            <input id="only-affordable" type="checkbox" checked={affordable} onChange={(e) => setAffordable(e.target.checked)} /> Only players {code} can take
          </label>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="muted">Nobody matches.</p>
      ) : (
        <div className="table-wrap">
          <table className="players">
            <thead>
              <tr>
                <th>Player</th>
                <th className="hide-sm">Now at</th>
                <th>Ovr</th>
                <th className="hide-sm">Bat / Bowl</th>
                <th>Price</th>
                <th aria-label="Pick" />
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((p) => {
                const block = code ? pickBlock(state, code, p.id) : 'not-your-turn';
                return (
                  <tr key={p.id} className={selected === p.id ? 'sel' : ''} onClick={() => onSelect(p.id)}>
                    <td>
                      <span className={`role role-${p.role}`}>{p.role}</span> <span className="pn">{p.name}</span> {p.overseas && <OS />}
                    </td>
                    <td className="hide-sm muted">{p.team2026 ?? '—'}</td>
                    <td>
                      <span className="ovr">{p.overall}</span>
                    </td>
                    <td className="hide-sm muted num">
                      {p.bat} / {p.bowl}
                    </td>
                    <td className="price num">{formatLakh(priceOf(p))}</td>
                    <td>
                      {code && (
                        <button
                          type="button"
                          className="btn btn-small pick-small"
                          disabled={block !== null}
                          title={block ? BLOCK_TEXT[block] : `Pick ${p.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onPick(p.id);
                          }}
                        >
                          {block === null ? 'Pick' : block === 'purse' ? '₹✗' : '—'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > limit && (
        <button type="button" className="btn btn-small show-all" onClick={() => setLimit((l) => l + PAGE * 3)}>
          Show more ({rows.length - limit} left)
        </button>
      )}
    </section>
  );
}

function DraftSide({ state, mine, seats }: { state: DraftState; mine: string[]; seats?: Record<string, SeatInfo> }) {
  const [tab, setTab] = useState<'teams' | 'picks'>('teams');
  const first = mine[0] ?? state.teams[0].code;
  const [code, setCode] = useState(first);
  const t = state.teams.find((x) => x.code === code) ?? state.teams[0];
  const closed = new Set(state.closed);
  type Row = { kind: 'pick'; pk: DraftState['picks'][number] } | { kind: 'pass'; ps: DraftState['passes'][number]; i: number };
  const log = useMemo(() => {
    const rows: Row[] = state.picks.map((pk) => ({ kind: 'pick', pk }));
    state.passes.forEach((ps, i) => rows.push({ kind: 'pass', ps, i }));
    const at = (r: Row) => (r.kind === 'pick' ? r.pk.pickNo - 1 + 0.5 : r.ps.afterPick + 0.25 + r.i * 1e-6);
    return rows.sort((a, b) => at(b) - at(a)).slice(0, 150);
  }, [state.picks, state.passes]);
  const who = (x: TeamState) => (mine.includes(x.code) && seats ? 'you' : seats?.[x.code]?.name ?? (x.human ? 'human' : null));

  return (
    <aside className="side">
      <div className="tabs tabs-2" role="tablist">
        <button role="tab" type="button" aria-selected={tab === 'teams'} onClick={() => setTab('teams')}>
          Squads
        </button>
        <button role="tab" type="button" aria-selected={tab === 'picks'} onClick={() => setTab('picks')}>
          Picks ({state.picks.length})
        </button>
      </div>
      {tab === 'teams' ? (
        <div className="side-body">
          <ul className="team-strip">
            {state.teams.map((x) => {
              const w = who(x);
              const seat = seats?.[x.code];
              return (
                <li key={x.code}>
                  <button type="button" className={x.code === t.code ? 'on' : ''} onClick={() => setCode(x.code)} style={{ ['--team' as string]: x.color }}>
                    <TeamBadge team={x} size="sm" />
                    <span className="grow seat-name">
                      {w ?? 'AI'}
                      {seat && !seat.online && <span className="tag">offline</span>}
                    </span>
                    <span className="num">{x.squad.length}</span>
                    <span className="num price">{formatLakh(x.purseLakh)}</span>
                    {closed.has(x.code) && <span className="tag">done</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <h3 className="squad-head">
            {t.name} <span className="muted small">spent {formatLakh(t.squad.reduce((s, e) => s + e.priceLakh, 0))}</span>
          </h3>
          {t.squad.length === 0 ? (
            <p className="muted">No picks yet.</p>
          ) : (
            <ul className="squad-list">
              {[...t.squad]
                .map((e) => ({ e, p: state.players[e.playerId] }))
                .sort((a, b) => b.e.priceLakh - a.e.priceLakh)
                .map(({ e, p }) => (
                  <li key={e.playerId}>
                    <span className={`role role-${p.role}`}>{p.role}</span>
                    <span className="grow">
                      {p.name} {p.overseas && <OS />}
                    </span>
                    <span className="muted num">{p.overall}</span>
                    <span className="price">{formatLakh(e.priceLakh)}</span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="side-body">
          {log.length === 0 && <p className="muted">No picks yet.</p>}
          <ol className="log-list">
            {log.map((r) => {
              if (r.kind === 'pass') {
                const by = state.teams.find((x) => x.code === r.ps.team)!;
                return (
                  <li key={`pass-${r.i}`} className="unsold">
                    <span className="lot-no">–</span>
                    <TeamBadge team={by} size="sm" />
                    <span className="grow">skipped their turn</span>
                  </li>
                );
              }
              const pk = r.pk;
              const by = state.teams.find((x) => x.code === pk.team)!;
              return (
                <li key={pk.pickNo}>
                  <span className="lot-no">{pk.pickNo}</span>
                  <TeamBadge team={by} size="sm" />
                  <span className="grow">{state.players[pk.playerId].name}</span>
                  <span className="price">{formatLakh(pk.priceLakh)}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </aside>
  );
}
