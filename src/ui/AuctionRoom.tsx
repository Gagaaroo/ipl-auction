import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AuctionState, LogEntry, Player, TeamState } from '../engine/types';
import { bidBlock, endAuction, hammer, nextBid, overseasCount, placeBid, remainingInSet, type BidBlock } from '../engine/auction';
import { AI_TICK_MS, aiPickBidder, simulateSet, simulateToEnd } from '../engine/ai';
import { formatLakh } from '../engine/money';
import { makeRng } from '../engine/rng';
import { BallRating, Board, ConfirmDialog, OS, ROLE_LABEL, Stat, TeamBadge, type Ask } from './bits';
import { playBid, playGavel } from './sound';
import { inkFor } from '../data/teams';
import { loadSound, saveSound } from './storage';

const BID_FLOOR_MS = 4000;
const BANNER_MS = 1500;
const LOOP_MS = 100;

interface Props {
  initial: AuctionState;
  initialRemainingMs: number;
  resumed: boolean;
  onSave: (s: AuctionState, remainingMs: number) => void;
  onDone: (s: AuctionState) => void;
}

const BLOCK_TEXT: Record<BidBlock, string> = {
  'no-lot': '—',
  holder: 'Your bid',
  'squad-full': 'Squad full',
  'overseas-full': 'Overseas full',
  purse: 'Can’t afford',
};

export function AuctionRoom({ initial, initialRemainingMs, resumed, onSave, onDone }: Props) {
  const clockMs = Math.max(BID_FLOOR_MS, initial.rules.clockSec * 1000);
  const [state, setState] = useState(initial);
  const stateRef = useRef(initial);
  const remainingRef = useRef(initialRemainingMs > 0 ? initialRemainingMs : clockMs);
  const lastBidAtRef = useRef(performance.now());
  const aiAccumRef = useRef(0);
  const rngRef = useRef(makeRng(Date.now() >>> 0));
  const [paused, setPaused] = useState(resumed);
  const pausedRef = useRef(paused);
  const [banner, setBanner] = useState<{ entry: LogEntry; until: number } | null>(null);
  const bannerRef = useRef(banner);
  const [flash, setFlash] = useState<string | null>(null);
  const [sound, setSound] = useState(loadSound);
  const soundRef = useRef(sound);
  const [, setFrame] = useState(0);
  const lastSaveRef = useRef(0);

  const [ask, setAsk] = useState<Ask | null>(null);
  const askRef = useRef(ask);
  askRef.current = ask;
  const closeAsk = useCallback(() => setAsk(null), []);
  pausedRef.current = paused;
  bannerRef.current = banner;
  soundRef.current = sound;

  const save = useCallback((s: AuctionState, force = false) => {
    const now = performance.now();
    if (force || now - lastSaveRef.current > 1500) {
      lastSaveRef.current = now;
      onSave(s, remainingRef.current);
    }
  }, [onSave]);

  const commit = useCallback((s: AuctionState) => {
    stateRef.current = s;
    setState(s);
    save(s, true);
  }, [save]);

  const doneRef = useRef(false);
  const finish = useCallback((s: AuctionState) => {
    if (doneRef.current) return;
    doneRef.current = true;
    save(s, true);
    onDone(s);
  }, [save, onDone]);

  const bid = useCallback((code: string) => {
    if (pausedRef.current || askRef.current || bannerRef.current) return;
    const s = stateRef.current;
    const n = placeBid(s, code);
    if (n === s) return;
    remainingRef.current = Math.max(clockMs, BID_FLOOR_MS);
    lastBidAtRef.current = performance.now();
    commit(n);
    setFlash(code);
    if (soundRef.current) playBid();
  }, [clockMs, commit]);

  const bringHammerDown = useCallback(() => {
    const s = stateRef.current;
    if (!s.current) return;
    const next = hammer(s);
    const entry = next.log[s.log.length];
    if (soundRef.current) playGavel(entry?.kind === 'sold');
    remainingRef.current = clockMs;
    commit(next);
    if (entry) setBanner({ entry, until: performance.now() + BANNER_MS });
  }, [clockMs, commit]);

  // The room's heartbeat: run the clock, let the AI think, drop the hammer.
  useEffect(() => {
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      const s = stateRef.current;
      if (pausedRef.current || askRef.current) return;
      const b = bannerRef.current;
      if (b) {
        if (now >= b.until) {
          setBanner(null);
          remainingRef.current = clockMs;
          lastBidAtRef.current = now;
          if (s.finished) finish(s);
        }
        return;
      }
      if (!s.current) {
        if (s.finished) finish(s);
        return;
      }
      remainingRef.current -= dt;
      aiAccumRef.current += dt;
      while (aiAccumRef.current >= AI_TICK_MS) {
        aiAccumRef.current -= AI_TICK_MS;
        const who = aiPickBidder(stateRef.current, { remainingMs: remainingRef.current, sinceLastBidMs: now - lastBidAtRef.current }, rngRef.current);
        if (who) {
          bid(who);
          break;
        }
      }
      if (remainingRef.current <= 0) bringHammerDown();
      else save(stateRef.current);
      setFrame((f) => (f + 1) % 1e6);
    }, LOOP_MS);
    return () => window.clearInterval(id);
  }, [bid, bringHammerDown, clockMs, finish, save]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 600);
    return () => window.clearTimeout(t);
  }, [flash, state]);

  const humans = state.teams.filter((t) => t.human);

  // Space bids for the first human team; 1–9 for the nth human team.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (askRef.current || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'Space' && humans[0]) {
        e.preventDefault();
        bid(humans[0].code);
      } else if (/^Digit[1-9]$/.test(e.code)) {
        const t = humans[Number(e.code.slice(5)) - 1];
        if (t) bid(t.code);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bid, humans]);

  const cur = state.current;
  const shownId = banner ? banner.entry.playerId : cur?.lot.playerId;
  const shownPlayer = shownId ? state.players[shownId] : null;
  const shownSet = banner ? banner.entry.setName : cur?.lot.setName;
  const remaining = Math.max(0, remainingRef.current);
  const callState = banner
    ? banner.entry.kind === 'sold' ? 'Sold!' : 'Unsold'
    : paused ? 'Paused'
    : !cur ? '' : remaining <= 1000 ? 'Going twice…' : remaining <= 2000 ? 'Going once…' : cur.bidCount ? 'Bidding' : 'Open';
  const next = nextBid(state);
  const holder = cur?.holder ? state.teams.find((t) => t.code === cur.holder) : null;
  const lotNo = state.lotIndex + 1;
  const totalLots = state.queue.length;
  const orderedTeams = useMemo(() => [...state.teams].sort((a, b) => Number(b.human) - Number(a.human)), [state.teams]);

  const simSet = () => {
    if (!cur) return;
    const n = simulateSet(stateRef.current, rngRef.current);
    remainingRef.current = clockMs;
    lastBidAtRef.current = performance.now();
    commit(n);
    if (n.finished) finish(n);
  };
  const simEnd = () =>
    setAsk({
      message: 'Let the AI finish the auction? It will bid for every team, yours included, using the same logic as the AI sides.',
      yes: 'Sim to the end',
      onYes: () => {
        const n = simulateToEnd(stateRef.current, rngRef.current, true);
        commit(n);
        finish(n);
      },
    });
  const end = () =>
    setAsk({
      message: 'End the auction now? Anyone not yet sold stays unsold.',
      yes: 'End auction',
      onYes: () => {
        const n = endAuction(stateRef.current);
        commit(n);
        finish(n);
      },
    });

  return (
    <div className="room">
      <div className="room-main">
        <div className="lot-meta">
          <span>
            <b>{shownSet}</b>
            {state.round === 'accelerated' && <span className="tag">accelerated · half base</span>}
          </span>
          <span>
            Lot {Math.min(lotNo, totalLots)} of {totalLots}
            {cur && !banner ? ` · ${remainingInSet(state)} more in set` : ''}
          </span>
        </div>

        <div className="lot">
          {shownPlayer && <PlayerCard p={shownPlayer} baseLakh={banner ? undefined : cur?.lot.basePriceLakh} />}
          <div className="lot-side">
            <Board className={banner ? `board-${banner.entry.kind}` : ''}>
              {banner ? (
                banner.entry.kind === 'sold' ? (
                  <>
                    <div className="board-label">Sold to {state.teams.find((t) => t.code === (banner.entry as { team: string }).team)?.name}</div>
                    <div className="board-num">{formatLakh(banner.entry.priceLakh)}</div>
                  </>
                ) : (
                  <>
                    <div className="board-label">No bids</div>
                    <div className="board-num">UNSOLD</div>
                  </>
                )
              ) : (
                <>
                  <div className="board-label">{cur?.bidLakh != null ? 'Current bid' : 'Opening at'}</div>
                  <div className="board-num">{formatLakh(cur?.bidLakh ?? cur?.lot.basePriceLakh ?? 0)}</div>
                  <div className="board-holder">
                    {holder ? (
                      <>
                        <TeamBadge team={holder} size="sm" /> {holder.name}
                      </>
                    ) : (
                      'no bids yet'
                    )}
                  </div>
                </>
              )}
            </Board>
            <div className={`clock ${remaining <= 2000 && !banner ? 'clock-low' : ''}`}>
              <div className="clock-bar">
                <span style={{ width: `${banner ? 0 : (remaining / clockMs) * 100}%` }} />
              </div>
              <div className="clock-row">
                <b className="call">{callState}</b>
                {!banner && cur && <span>{(remaining / 1000).toFixed(1)}s</span>}
              </div>
            </div>
            {next !== null && !banner && <p className="next-bid">Next bid {formatLakh(next)}</p>}
          </div>
        </div>

        <div className="controls">
          <button type="button" className="btn" onClick={() => setPaused((p) => !p)}>
            {paused ? '▶ Resume' : '❚❚ Pause'}
          </button>
          <button type="button" className="btn" onClick={() => (remainingRef.current = Math.min(remainingRef.current, 1200))} disabled={!cur || !!banner || paused}>
            Bring the hammer down
          </button>
          <button
            type="button"
            className="btn"
            aria-pressed={sound}
            onClick={() => {
              setSound((v) => {
                saveSound(!v);
                return !v;
              });
            }}
          >
            {sound ? '🔊 Sound on' : '🔈 Sound off'}
          </button>
          <button type="button" className="btn" onClick={simSet} disabled={!cur || !!banner} title="AI settles the rest of this set instantly; humans pass">
            Skip set (AI only)
          </button>
          <button type="button" className="btn" onClick={simEnd} disabled={!cur}>
            Sim to the end
          </button>
          <button type="button" className="btn btn-danger" onClick={end}>
            End auction
          </button>
        </div>

        {paused && (
          <div className="paused-note">
            {resumed ? 'Welcome back — your auction was saved.' : 'Paused.'} <button type="button" className="linkish" onClick={() => setPaused(false)}>Resume</button>
          </div>
        )}

        <div className="paddles">
          {orderedTeams.map((t) => (
            <Paddle
              key={t.code}
              t={t}
              state={state}
              flashing={flash === t.code}
              holding={cur?.holder === t.code}
              hotkey={t.human ? humans.indexOf(t) : -1}
              onBid={() => bid(t.code)}
              disabled={paused || !!banner}
            />
          ))}
        </div>
      </div>

      <SidePanel state={state} />
      <ConfirmDialog ask={ask} onClose={closeAsk} />
    </div>
  );
}

function PlayerCard({ p, baseLakh }: { p: Player; baseLakh?: number }) {
  return (
    <article className="player-card">
      <div className="player-head">
        <BallRating value={p.overall} size={60} />
        <div>
          <h2 className="player-name">{p.name}</h2>
          <p className="player-sub">
            {ROLE_LABEL[p.role]} · {p.country} {p.overseas && <OS />}
            {p.team2026 && <span className="muted"> · 2026: {p.team2026}</span>}
          </p>
        </div>
      </div>
      <Stat label="Bat" value={p.bat} />
      <Stat label="Bowl" value={p.bowl} />
      {baseLakh !== undefined && <p className="base">Base price {formatLakh(baseLakh)}</p>}
      {p.history.length > 0 && (
        <ul className="history">
          {p.history.map((h) => (
            <li key={h.year}>
              <b>{h.year}</b> {h.result === 'sold' ? `sold to ${h.team} for ${formatLakh(h.priceLakh)}` : `unsold at ${formatLakh(h.basePriceLakh)}`}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function Paddle({
  t,
  state,
  flashing,
  holding,
  hotkey,
  onBid,
  disabled,
}: {
  t: TeamState;
  state: AuctionState;
  flashing: boolean;
  holding: boolean;
  hotkey: number;
  onBid: () => void;
  disabled: boolean;
}) {
  const block = bidBlock(state, t.code);
  const next = nextBid(state);
  return (
    <div className={`paddle ${holding ? 'holding' : ''} ${flashing ? 'flash' : ''} ${t.human ? 'human' : ''}`} style={{ ['--team' as string]: t.color }}>
      <div className="paddle-head">
        <TeamBadge team={t} />
        <span className="paddle-name">{t.name}</span>
        {!t.human && <span className="tag">AI</span>}
      </div>
      <dl className="paddle-stats">
        <div>
          <dt>Purse</dt>
          <dd>{formatLakh(t.purseLakh)}</dd>
        </div>
        <div>
          <dt>Squad</dt>
          <dd>
            {t.squad.length}/{state.rules.squadMax}
          </dd>
        </div>
        <div>
          <dt>Overseas</dt>
          <dd>
            {overseasCount(state, t)}/{state.rules.overseasMax}
          </dd>
        </div>
      </dl>
      {t.human && (
        <button type="button" className="btn bid-btn" style={{ color: inkFor(t.color) }} onClick={onBid} disabled={disabled || block !== null}>
          {block === null && next !== null ? `Bid ${formatLakh(next)}` : BLOCK_TEXT[block ?? 'no-lot']}
          {hotkey >= 0 && <kbd>{hotkey === 0 ? 'space' : hotkey + 1}</kbd>}
        </button>
      )}
      {holding && <span className="paddle-up">paddle up</span>}
    </div>
  );
}

function SidePanel({ state }: { state: AuctionState }) {
  const [tab, setTab] = useState<'squads' | 'log'>('squads');
  const firstHuman = state.teams.find((t) => t.human)?.code ?? state.teams[0].code;
  const [code, setCode] = useState(firstHuman);
  const t = state.teams.find((x) => x.code === code) ?? state.teams[0];
  const log = [...state.log].reverse().slice(0, 80);

  return (
    <aside className="side">
      <div className="tabs" role="tablist">
        <button role="tab" type="button" aria-selected={tab === 'squads'} onClick={() => setTab('squads')}>
          Squads
        </button>
        <button role="tab" type="button" aria-selected={tab === 'log'} onClick={() => setTab('log')}>
          Log ({state.log.filter((l) => l.kind === 'sold').length} sold)
        </button>
      </div>
      {tab === 'squads' ? (
        <div className="side-body">
          <select value={t.code} onChange={(e) => setCode(e.target.value)} aria-label="Team">
            {state.teams.map((x) => (
              <option key={x.code} value={x.code}>
                {x.code} — {x.name}
              </option>
            ))}
          </select>
          <p className="muted small">
            {t.squad.length} players · {formatLakh(t.purseLakh)} left
          </p>
          {t.squad.length === 0 ? (
            <p className="muted">Nobody yet.</p>
          ) : (
            <ul className="squad-list">
              {[...t.squad]
                .map((e) => ({ e, p: state.players[e.playerId] }))
                .sort((a, b) => b.p.overall - a.p.overall)
                .map(({ e, p }) => (
                  <li key={e.playerId}>
                    <span className={`role role-${p.role}`}>{p.role}</span>
                    <span className="grow">
                      {p.name} {p.overseas && <OS />}
                    </span>
                    <span className="muted">{p.overall}</span>
                    <span className="price">{e.retained ? 'kept' : formatLakh(e.priceLakh)}</span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="side-body">
          {log.length === 0 && <p className="muted">The hammer hasn’t fallen yet.</p>}
          <ul className="log-list">
            {log.map((l, i) => {
              const p = state.players[l.playerId];
              return l.kind === 'sold' ? (
                <li key={state.log.length - i}>
                  <TeamBadge team={state.teams.find((x) => x.code === l.team)!} size="sm" />
                  <span className="grow">{p.name}</span>
                  <span className="price">{formatLakh(l.priceLakh)}</span>
                </li>
              ) : (
                <li key={state.log.length - i} className="unsold">
                  <span className="badge badge-sm badge-none">—</span>
                  <span className="grow">{p.name}</span>
                  <span className="muted">unsold</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </aside>
  );
}
