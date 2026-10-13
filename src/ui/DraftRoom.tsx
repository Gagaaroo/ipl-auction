import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TeamState } from '../engine/types';
import {
  applyAction,
  challengeBlock,
  challengeOpen,
  draftMaxSpend,
  draftTeam,
  heldBack,
  onTheClock,
  overseasIn,
  ownerOf,
  pickBlock,
  priceOf,
  roundOrder,
  rtmText,
  type ChallengeBlock,
  type DraftAction,
  type DraftState,
  type PickBlock,
} from '../engine/draft';
import { formatLakh } from '../engine/money';
import { makeRng } from '../engine/rng';
import { ConfirmDialog, OS, TeamBadge, type Ask } from './bits';
import { PlayerPlate, PlayerTable } from './draftBits';
import { AuctionLogPanel, RtmStage, SecretView, useAuctionAuthority } from './RtmViews';
import { playGavel } from './sound';
import { loadSound, saveSound } from './storage';

export { priceStory } from './draftBits';

interface Props {
  initial: DraftState;
  onChange: (s: DraftState) => void;
}

const BLOCK_TEXT: Record<PickBlock, string> = {
  finished: 'Not now',
  'not-your-turn': 'Not your turn',
  taken: 'Taken',
  'squad-full': 'Squad full',
  'overseas-full': 'Overseas full',
  purse: 'Can’t afford',
};

const CHALLENGE_TEXT: Record<ChallengeBlock, string> = {
  off: '—',
  'not-your-turn': 'Not your turn',
  'not-owned': '—',
  'own-player': 'Yours',
  already: 'Challenged',
  'squad-full': 'No room',
  'overseas-full': 'Overseas full',
  purse: 'Can’t afford',
};

/** Who sits at an online team, for labels. */
export interface SeatInfo {
  name: string;
  online: boolean;
}

export interface DraftViewProps {
  state: DraftState;
  /** Teams this device may make moves for. */
  mine: string[];
  /** This device runs the game: it can pause the AI, change its speed, sim or end. */
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

/** Single-device game: humans share this screen, AI teams play by themselves. */
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
  useAuctionAuthority(state, apply, rngRef.current, paused);
  const mine = useMemo(() => state.teams.filter((t) => t.human).map((t) => t.code), [state.teams]);

  return <DraftView state={state} mine={mine} authority dispatch={apply} paused={paused} setPaused={setPaused} speed={speed} setSpeed={setSpeed} />;
}

export function DraftView({ state, mine, authority, dispatch, paused = false, setPaused, speed = 'normal', setSpeed, seats, topBar }: DraftViewProps) {
  const [sound, setSound] = useState(loadSound);
  const [ask, setAsk] = useState<Ask | null>(null);
  const closeAsk = useCallback(() => setAsk(null), []);

  // The gavel, for every pick and every settled lot, wherever it happened.
  const count = state.picks.length + state.auctionLog.length;
  const lastCount = useRef(count);
  useEffect(() => {
    if (count > lastCount.current && sound) playGavel(true);
    lastCount.current = count;
  }, [count, sound]);

  const anyHumans = state.teams.some((t) => t.human);
  const body =
    state.phase === 'secret' ? (
      <SecretView state={state} mine={mine} dispatch={dispatch} />
    ) : state.phase === 'auction' && state.auction ? (
      <RtmStage state={state} mine={mine} dispatch={dispatch} seats={seats} />
    ) : (
      <PickingBody state={state} mine={mine} dispatch={dispatch} paused={paused} seats={seats} setAsk={setAsk} />
    );

  return (
    <div className="room draft">
      <div className="room-main">
        {topBar}
        {body}
        <div className="controls room-tools">
          {authority && setPaused && state.phase !== 'secret' && (
            <button type="button" className="btn" onClick={() => setPaused(!paused)} disabled={state.finished}>
              {paused ? '▶ Resume' : '❚❚ Pause'}
            </button>
          )}
          {authority && setSpeed && state.phase === 'picking' && (
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
                    message: anyHumans ? 'Let the AI finish the game? It will decide for every team, including people’s.' : 'Skip to the end?',
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
                onClick={() => setAsk({ message: 'End the game now? Every squad stays as it is.', yes: 'End now', onYes: () => dispatch({ type: 'end' }) })}
              >
                End now
              </button>
            </>
          )}
        </div>
      </div>

      <DraftSide state={state} mine={mine} seats={seats} />
      <ConfirmDialog ask={ask} onClose={closeAsk} />
    </div>
  );
}

function PickingBody({
  state,
  mine,
  dispatch,
  paused,
  seats,
  setAsk,
}: {
  state: DraftState;
  mine: string[];
  dispatch: (a: DraftAction) => void;
  paused: boolean;
  seats?: Record<string, SeatInfo>;
  setAsk: (a: Ask) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<'free' | 'challenge'>('free');
  const code = onTheClock(state);
  const team = code ? draftTeam(state, code) : null;
  const myTurn = !!code && mine.includes(code);
  const challengesOn = state.style === 'turns' && state.rules.challenges && !state.auctionDone;
  const topUp = state.auctionDone;

  const lastPick = state.picks[state.picks.length - 1];
  const sel = selected ? state.players[selected] : null;
  const selOwner = sel ? ownerOf(state, sel.id) : null;
  const shownId = selected ?? (myTurn ? null : lastPick?.playerId ?? null);
  const shown = shownId ? state.players[shownId] : null;

  const challenged = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of state.challenges) m.set(c.playerId, c.teams);
    return m;
  }, [state.challenges]);

  const plateActions = () => {
    if (!sel || !myTurn || !code) return [];
    if (state.available.includes(sel.id)) {
      const b = pickBlock(state, code, sel.id);
      return [{ label: b === null ? `Pick for ${formatLakh(priceOf(sel))}` : BLOCK_TEXT[b], disabled: b !== null, onClick: () => dispatch({ type: 'pick', team: code, playerId: sel.id }) }];
    }
    if (challengesOn && selOwner && selOwner.code !== code) {
      const b = challengeBlock(state, code, sel.id);
      return [
        {
          label: b === null ? `Challenge · opens at ${formatLakh(challengeOpen(state, sel.id))}` : CHALLENGE_TEXT[b],
          disabled: b !== null,
          onClick: () => dispatch({ type: 'challenge', team: code, playerId: sel.id }),
        },
      ];
    }
    return [];
  };

  const owned = useMemo(() => state.teams.flatMap((t) => (mine.includes(t.code) ? [] : t.squad.map((e) => state.players[e.playerId]))), [state.teams, state.players, mine]);
  const held = code ? heldBack(state, code) : { slots: 0, money: 0 };

  return (
    <>
      <div className="lot-meta">
        <span className="set-name">{topUp ? 'Top-up round' : `Round ${state.round}`}</span>
        <span className="eyebrow">
          Pick {state.picks.length + 1} · {state.available.length} players left on the board
          {challengesOn && state.challenges.length > 0 && ` · ${state.challenges.length} challenged`}
        </span>
      </div>
      {topUp && (
        <p className="note">
          The auction is done. Teams with room and money left now fill their squads, one pick at a time, from the players nobody took.
        </p>
      )}

      <div className="lot">
        <ClockBoard state={state} team={team} myTurn={myTurn} lastPick={lastPick} paused={paused} seats={seats} />
        <PlayerPlate
          p={shown}
          scrollOnChange={myTurn && !!selected}
          priceNote={shown ? undefined : myTurn ? 'Tap a player on the board below to see him here, then pick him.' : 'Waiting for the first pick.'}
          chips={
            <>
              {!selected && !myTurn && lastPick && shownId === lastPick.playerId && <span className="chip chip-picked">Picked by {lastPick.team}</span>}
              {shown && selOwner && selected && <span className="chip">In {selOwner.code}</span>}
              {shown && challenged.get(shown.id) && <span className="chip chip-picked">Challenged by {challenged.get(shown.id)!.join(', ')}</span>}
            </>
          }
          actions={plateActions()}
        />
      </div>

      {myTurn && (
        <div className="controls">
          <button type="button" className="btn" onClick={() => dispatch({ type: 'auto', team: code! })}>
            Auto-pick for {team!.code}
          </button>
          <button type="button" className="btn" title="Pass without picking. You keep your money and the next team picks." onClick={() => dispatch({ type: 'skip', team: code! })}>
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
          {held.slots > 0 && (
            <span className="muted small-note">
              Held back for your {held.slots} challenge{held.slots === 1 ? '' : 's'}: {held.slots} slot{held.slots === 1 ? '' : 's'} and {formatLakh(held.money)}
            </span>
          )}
        </div>
      )}

      <section className="board-list" aria-label="Players">
        {challengesOn && (
          <div className="tabs tabs-2 board-tabs" role="tablist">
            <button role="tab" type="button" aria-selected={tab === 'free'} onClick={() => setTab('free')}>
              Available ({state.available.length})
            </button>
            <button role="tab" type="button" aria-selected={tab === 'challenge'} onClick={() => setTab('challenge')}>
              Challenge a drafted player
            </button>
          </div>
        )}
        {tab === 'challenge' && challengesOn ? (
          <>
            <p className="hint">
              Use your turn to challenge a player in another squad. He stays there for now. After the draft he goes to auction, opening one step
              above what his team paid. Only challengers can bid, and his team can use an RTM card to match the top bid. Each challenge holds back
              a squad slot and the opening bid until then.
            </p>
            <PlayerTable
              players={owned}
              priceFor={(p) => challengeOpen(state, p.id)}
              selected={selected}
              onSelect={setSelected}
              extra={{
                head: 'In squad',
                cell: (p) => (
                  <>
                    {ownerOf(state, p.id)?.code}
                    {challenged.get(p.id) && <span className="tag">challenged</span>}
                  </>
                ),
              }}
              canFilter={code && myTurn ? (p) => challengeBlock(state, code, p.id) === null : undefined}
              canFilterLabel={`Only players ${code} can challenge`}
              action={(p) => {
                if (!myTurn || !code) return null;
                const b = challengeBlock(state, code, p.id);
                return { label: b === null ? 'Challenge' : CHALLENGE_TEXT[b], disabled: b !== null, title: `Opens at ${formatLakh(challengeOpen(state, p.id))}`, onClick: () => dispatch({ type: 'challenge', team: code, playerId: p.id }) };
              }}
            />
          </>
        ) : (
          <PlayerTable
            players={state.available.map((id) => state.players[id])}
            selected={selected}
            onSelect={setSelected}
            canFilter={code && myTurn ? (p) => pickBlock(state, code, p.id) === null : undefined}
            canFilterLabel={`Only players ${code} can take`}
            action={(p) => {
              if (!myTurn || !code) return null;
              const b = pickBlock(state, code, p.id);
              return { label: b === null ? 'Pick' : b === 'purse' ? '₹✗' : '—', disabled: b !== null, title: b ? BLOCK_TEXT[b] : `Pick ${p.name}`, onClick: () => dispatch({ type: 'pick', team: code, playerId: p.id }) };
            }}
          />
        )}
      </section>
    </>
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
  const lastChal = state.challengeLog[state.challengeLog.length - 1];
  const recent =
    lastChal && lastChal.afterPick === state.picks.length && (!lastPass || lastPass.afterPick < lastChal.afterPick || state.passes.length === 0)
      ? { team: lastChal.team, text: `challenged for ${state.players[lastChal.playerId].name} (${lastChal.owner})` }
      : lastPass && lastPass.afterPick === state.picks.length
        ? { team: lastPass.team, text: 'skipped their turn' }
        : null;
  const label = !team
    ? 'Picking complete'
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
            <dd className="digits-sm">{formatLakh(Math.max(0, draftMaxSpend(state, team) - heldBack(state, team.code).money))}</dd>
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
      {recent && (
        <div className="last-pick">
          <span className="eyebrow">Just now</span>
          <span>
            <TeamBadge team={teamOf(recent.team)} size="sm" /> {recent.text}
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

function DraftSide({ state, mine, seats }: { state: DraftState; mine: string[]; seats?: Record<string, SeatInfo> }) {
  const [tab, setTab] = useState<'teams' | 'picks'>('teams');
  const first = mine[0] ?? state.teams[0].code;
  const [code, setCode] = useState(first);
  const t = state.teams.find((x) => x.code === code) ?? state.teams[0];
  const closed = new Set(state.closed);
  type Row =
    | { kind: 'pick'; at: number; pk: DraftState['picks'][number] }
    | { kind: 'pass'; at: number; team: string; i: number }
    | { kind: 'challenge'; at: number; team: string; playerId: string; owner: string; i: number };
  const log = useMemo(() => {
    const rows: Row[] = state.picks.map((pk) => ({ kind: 'pick', at: pk.pickNo - 1 + 0.5, pk }));
    state.passes.forEach((ps, i) => rows.push({ kind: 'pass', at: ps.afterPick + 0.25 + i * 1e-6, team: ps.team, i }));
    state.challengeLog.forEach((c, i) => rows.push({ kind: 'challenge', at: c.afterPick + 0.25 + i * 1e-6, team: c.team, playerId: c.playerId, owner: c.owner, i }));
    return rows.sort((a, b) => b.at - a.at).slice(0, 150);
  }, [state.picks, state.passes, state.challengeLog]);
  const who = (x: TeamState) =>
    mine.includes(x.code) && (seats || mine.length === 1) ? 'you' : seats?.[x.code]?.name ?? (x.human ? 'person' : null);
  const secret = state.phase === 'secret';
  const showRtm = state.style === 'secret' || state.rules.challenges;

  return (
    <aside className="side">
      <div className="tabs tabs-2" role="tablist">
        <button role="tab" type="button" aria-selected={tab === 'teams'} onClick={() => setTab('teams')}>
          Squads
        </button>
        <button role="tab" type="button" aria-selected={tab === 'picks'} onClick={() => setTab('picks')}>
          Log ({state.picks.length + state.auctionLog.length})
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
                    {showRtm && <span className="rtm-mini" title="RTM cards left">RTM {rtmText(state.rtmLeft[x.code] ?? 0)}</span>}
                    <span className="num">{x.squad.length}</span>
                    <span className="num price">{formatLakh(x.purseLakh)}</span>
                    {closed.has(x.code) && state.phase === 'picking' && <span className="tag">done</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <h3 className="squad-head">
            {t.name} <span className="muted small">spent {formatLakh(t.squad.reduce((s, e) => s + e.priceLakh, 0))}</span>
          </h3>
          {secret ? (
            <p className="muted">Squads are secret until every team locks in.</p>
          ) : t.squad.length === 0 ? (
            <p className="muted">No players yet.</p>
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
                      {state.challenges.some((c) => c.playerId === p.id) && state.phase === 'picking' && !state.auctionDone && <span className="tag">challenged</span>}
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
          {state.auctionLog.length > 0 && <AuctionLogPanel state={state} rows={[...state.auctionLog].reverse()} title="RTM auction" />}
          {log.length === 0 && state.auctionLog.length === 0 && <p className="muted">Nothing yet.</p>}
          <ol className="log-list">
            {log.map((r) => {
              if (r.kind === 'pass' || r.kind === 'challenge') {
                const by = state.teams.find((x) => x.code === r.team)!;
                return (
                  <li key={`${r.kind}-${r.i}`} className="unsold">
                    <span className="lot-no">–</span>
                    <TeamBadge team={by} size="sm" />
                    <span className="grow">{r.kind === 'pass' ? 'skipped their turn' : `challenged ${r.owner} for ${state.players[r.playerId].name}`}</span>
                  </li>
                );
              }
              const pk = r.pk;
              const by = state.teams.find((x) => x.code === pk.team)!;
              return (
                <li key={pk.pickNo}>
                  <span className="lot-no">{pk.round === 0 ? '•' : pk.pickNo}</span>
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
