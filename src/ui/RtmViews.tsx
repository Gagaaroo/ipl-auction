import { useEffect, useState } from 'react';
import {
  aiBidder,
  canLock,
  canMatch,
  currentLot,
  draftTeam,
  listBlock,
  listTotals,
  lotBidBlock,
  nextLotBid,
  overseasIn,
  priceOf,
  rtmText,
  type BidBlock,
  type DraftAction,
  type DraftState,
  type ListBlock,
} from '../engine/draft';
import { formatLakh } from '../engine/money';
import type { Rng } from '../engine/rng';
import { inkFor } from '../data/teams';
import { TeamBadge } from './bits';
import { PlayerPlate, PlayerTable, useCountdown } from './draftBits';
import type { SeatInfo } from './DraftRoom';

/**
 * On the machine that runs the game: run the RTM auction clock (hammer when it
 * runs out) and let AI teams bid at human-ish moments.
 */
export function useAuctionAuthority(state: DraftState, apply: (a: DraftAction) => void, rng: Rng, paused: boolean) {
  const a = state.phase === 'auction' ? state.auction : null;
  const seq = a?.seq ?? null;
  const windowMs = a?.windowMs ?? 0;
  const stage = a?.stage;
  useEffect(() => {
    if (seq === null || paused) return;
    const id = window.setTimeout(() => apply({ type: 'hammer', seq }), windowMs);
    return () => window.clearTimeout(id);
  }, [seq, windowMs, paused, apply]);
  useEffect(() => {
    if (seq === null || paused || stage !== 'bidding') return;
    const who = aiBidder(state, rng);
    if (!who) return;
    const delay = 900 + rng() * Math.max(600, Math.min(3200, windowMs - 2200));
    const id = window.setTimeout(() => apply({ type: 'ai-bid', team: who }), delay);
    return () => window.clearTimeout(id);
    // Only re-plan when the clock restarts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq, paused, stage]);
}

// ---------- secret draft ----------

const LIST_TEXT: Record<ListBlock, string> = {
  locked: 'Locked',
  'in-list': 'In list',
  'squad-full': 'List full',
  'overseas-full': 'Overseas full',
  purse: 'Over budget',
  off: '—',
};

export function SecretView({ state, mine, dispatch }: { state: DraftState; mine: string[]; dispatch: (a: DraftAction) => void }) {
  const locked = new Set(state.secret?.locked ?? []);
  const open = mine.filter((c) => !locked.has(c));
  const [who, setWho] = useState<string | null>(open[0] ?? null);
  const [shown, setShown] = useState(open.length <= 1);
  const [selected, setSelected] = useState<string | null>(null);
  const code = who && open.includes(who) ? who : open[0] ?? null;

  useEffect(() => {
    // After one person locks in on a shared phone, hide the next list until they're ready.
    if (who && !open.includes(who)) {
      setWho(open[0] ?? null);
      setShown(open.length <= 1 && mine.length <= 1);
    }
  }, [open, who, mine.length]);

  const waiting = state.teams.filter((t) => !locked.has(t.code));
  const status = (
    <div className="lock-strip">
      <span className="eyebrow">
        Locked in: {locked.size} of {state.teams.length}
      </span>
      {state.teams.map((t) => (
        <span key={t.code} className={`lock-chip ${locked.has(t.code) ? 'on' : ''}`} title={locked.has(t.code) ? 'Locked in' : 'Still building'}>
          <TeamBadge team={t} size="sm" />
          {locked.has(t.code) ? '✓' : '…'}
        </span>
      ))}
    </div>
  );

  if (!code)
    return (
      <section className="panel">
        <h2>Squad locked in</h2>
        <p>
          Waiting for {waiting.length} team{waiting.length === 1 ? '' : 's'}: {waiting.map((t) => t.code).join(', ')}. When everyone has locked
          in, the lists are revealed. Anyone wanted by more than one team goes to an RTM auction.
        </p>
        {status}
      </section>
    );

  const team = draftTeam(state, code);
  if (!shown)
    return (
      <section className="panel handoff" style={{ ['--team' as string]: team.color }}>
        <div className="eyebrow">Secret squads · pass the phone</div>
        <h2>
          <TeamBadge team={team} size="lg" /> {team.name}, your turn to build
        </h2>
        <p className="hint">Everyone else, look away. Your list stays hidden until every team has locked in.</p>
        <button type="button" className="btn btn-big" onClick={() => setShown(true)}>
          Show my board
        </button>
        {status}
      </section>
    );

  const list = state.secret?.lists[code] ?? [];
  const tot = listTotals(state, code);
  const r = state.rules;
  const budget = team.purseLakh;
  const pct = Math.min(100, (tot.spend / budget) * 100);
  const sel = selected ? state.players[selected] : null;
  const inList = (id: string) => list.includes(id);
  const block = (id: string) => listBlock(state, code, id);

  return (
    <>
      {status}
      <div className="secret-grid">
        <section className="panel secret-list" style={{ ['--team' as string]: team.color }}>
          <div className="eyebrow">Your secret squad</div>
          <h2 className="secret-head">
            <TeamBadge team={team} /> {team.name}
            {mine.length > 1 && open.length > 1 && (
              <select aria-label="Building for" value={code} onChange={(e) => { setWho(e.target.value); setShown(false); }}>
                {open.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </h2>
          <div className="budget">
            <div className="budget-bar">
              <span style={{ width: `${pct}%` }} />
            </div>
            <div className="budget-nums">
              <span>
                <b>{formatLakh(tot.spend)}</b> of {formatLakh(budget)}
              </span>
              <span>
                {tot.count}/{r.squadMax} players · min {r.squadMin}
              </span>
              <span>
                {tot.overseas}/{r.overseasMax} overseas
              </span>
            </div>
          </div>
          <p className="hint">
            Order matters: if another team wants the same player, whoever ranked him higher holds the RTM. You have {rtmText(state.rtmLeft[code] ?? 0)} RTM
            card{(state.rtmLeft[code] ?? 0) === 1 ? '' : 's'}.
          </p>
          {list.length === 0 ? (
            <p className="muted">Add players from the board. Nobody sees this list until the reveal.</p>
          ) : (
            <ol className="rank-list">
              {list.map((id, i) => {
                const p = state.players[id];
                return (
                  <li key={id}>
                    <span className="lot-no">{i + 1}</span>
                    <span className={`role role-${p.role}`}>{p.role}</span>
                    <button type="button" className="linkish grow rank-name" onClick={() => setSelected(id)}>
                      {p.name}
                    </button>
                    <span className="price">{formatLakh(priceOf(p))}</span>
                    <span className="rank-btns">
                      <button type="button" aria-label={`Move ${p.name} up`} disabled={i === 0} onClick={() => dispatch({ type: 'list-move', team: code, playerId: id, dir: -1 })}>
                        ↑
                      </button>
                      <button type="button" aria-label={`Move ${p.name} down`} disabled={i === list.length - 1} onClick={() => dispatch({ type: 'list-move', team: code, playerId: id, dir: 1 })}>
                        ↓
                      </button>
                      <button type="button" aria-label={`Remove ${p.name}`} onClick={() => dispatch({ type: 'list-remove', team: code, playerId: id })}>
                        ✕
                      </button>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          <div className="secret-actions">
            <button type="button" className="btn" onClick={() => dispatch({ type: 'list-auto', team: code })}>
              Fill with AI picks
            </button>
            <button type="button" className="btn btn-big" disabled={!canLock(state, code)} onClick={() => dispatch({ type: 'lock', team: code })}>
              {tot.count < r.squadMin ? `Need ${r.squadMin - tot.count} more` : 'Lock in my squad'}
            </button>
          </div>
        </section>
        <PlayerPlate
          p={sel}
          scrollOnChange
          priceNote={sel ? undefined : 'Tap a player to see him here, then add him to your list.'}
          actions={
            sel
              ? inList(sel.id)
                ? [{ label: 'Remove from my list', onClick: () => dispatch({ type: 'list-remove', team: code, playerId: sel.id }) }]
                : [{ label: block(sel.id) ? LIST_TEXT[block(sel.id)!] : `Add for ${formatLakh(priceOf(sel))}`, disabled: !!block(sel.id), onClick: () => dispatch({ type: 'list-add', team: code, playerId: sel.id }) }]
              : []
          }
        />
      </div>
      <section className="board-list">
        <PlayerTable
          players={state.available.map((id) => state.players[id])}
          selected={selected}
          onSelect={setSelected}
          canFilter={(p) => !block(p.id)}
          canFilterLabel="Only players I can add"
          action={(p) =>
            inList(p.id)
              ? { label: '✓', on: true, title: 'In your list: tap to remove', onClick: () => dispatch({ type: 'list-remove', team: code, playerId: p.id }) }
              : { label: block(p.id) ? '—' : 'Add', disabled: !!block(p.id), title: block(p.id) ? LIST_TEXT[block(p.id)!] : 'Add to your list', onClick: () => dispatch({ type: 'list-add', team: code, playerId: p.id }) }
          }
        />
      </section>
    </>
  );
}

// ---------- RTM auction ----------

const BID_TEXT: Record<BidBlock, string> = {
  'no-lot': '—',
  'not-bidder': 'Not in this one',
  leading: 'Leading',
  'squad-full': 'Squad full',
  'overseas-full': 'Overseas full',
  purse: 'Can’t afford',
  'rtm-stage': 'RTM call',
};

export function RtmStage({ state, mine, dispatch, seats }: { state: DraftState; mine: string[]; dispatch: (a: DraftAction) => void; seats?: Record<string, SeatInfo> }) {
  const a = state.auction!;
  const lot = currentLot(state)!;
  const p = state.players[lot.playerId];
  const next = nextLotBid(state);
  const remaining = useCountdown(a.seq, a.windowMs);
  const holder = lot.holder ? draftTeam(state, lot.holder) : null;
  const leader = a.leader ? draftTeam(state, a.leader) : null;
  const hot = remaining <= 2500;
  const rtmCall = a.stage === 'rtm';
  const myHolder = !!holder && mine.includes(holder.code);
  const name = (c: string) => seats?.[c]?.name ?? c;
  const upcoming = a.lots.slice(a.index + 1, a.index + 7);
  const done = [...state.auctionLog].reverse().slice(0, 8);
  const callText = rtmCall
    ? `${holder?.code} deciding on RTM`
    : !a.leader
      ? remaining > 6000 ? 'Open for bids' : 'Any bids?'
      : remaining <= 1500 ? 'Going twice…' : remaining <= 3500 ? 'Going once…' : 'Bidding';

  const why =
    lot.kind === 'challenge'
      ? `${holder?.code} drafted him for ${formatLakh(lot.heldAtLakh)}. Challenged by ${lot.bidders.join(', ')}.`
      : `Wanted by ${[lot.holder, ...lot.bidders].join(', ')} in their secret squads.`;

  return (
    <>
      <div className="lot-meta">
        <span className="set-name">RTM auction</span>
        <span className="eyebrow">
          Lot {a.index + 1} of {a.lots.length} · {lot.kind === 'challenge' ? 'challenged player' : 'contested player'}
        </span>
      </div>
      <div className="lot">
        <div className={`bidboard ${rtmCall && myHolder ? 'my-turn' : ''}`} style={leader ? { ['--team' as string]: leader.color } : undefined}>
          <div className="eyebrow">{a.bid === null ? 'Opening bid' : 'Current bid'}</div>
          <div className="board-num">{formatLakh(a.bid ?? lot.openLakh)}</div>
          <div className="board-holder">
            {leader ? (
              <>
                <TeamBadge team={leader} size="sm" /> {leader.name}
              </>
            ) : (
              <span className="muted">No bids yet</span>
            )}
          </div>
          <div className={`clock ${hot ? 'clock-low' : ''}`}>
            <div className="clock-bar">
              <span style={{ width: `${(remaining / a.windowMs) * 100}%` }} />
            </div>
            <div className="clock-row">
              <span className="call">{callText}</span>
              <span>{(remaining / 1000).toFixed(1)}s</span>
            </div>
          </div>
          {holder && (
            <div className="rtm-line">
              <span className="rtm-tag">RTM</span> {holder.code} holds the right to match · {rtmText(state.rtmLeft[holder.code] ?? 0)} card
              {(state.rtmLeft[holder.code] ?? 0) === 1 ? '' : 's'} left
            </div>
          )}
          <p className="muted small-note">{why}</p>
        </div>
        <PlayerPlate p={p} price={a.bid ?? lot.openLakh} priceNote={`2026 price ${formatLakh(priceOf(p))}`} />
      </div>

      {rtmCall && holder && (
        <div className={`rtm-call ${myHolder ? 'mine' : ''}`} style={{ ['--team' as string]: holder.color }}>
          {myHolder ? (
            <>
              <p>
                <b>{leader?.name}</b> won the bidding at <b>{formatLakh(a.bid!)}</b>. Use an RTM card to keep {p.name} for {formatLakh(a.bid!)}?
                {lot.kind === 'challenge' && ` You paid ${formatLakh(lot.heldAtLakh)}, so it costs ${formatLakh(a.bid! - lot.heldAtLakh)} more.`}
              </p>
              <div className="row wrap">
                <button type="button" className="btn btn-big" disabled={!canMatch(state, lot, a.bid!)} onClick={() => dispatch({ type: 'rtm', team: holder.code, use: true })}>
                  Use RTM · {formatLakh(a.bid!)}
                </button>
                <button type="button" className="btn" onClick={() => dispatch({ type: 'rtm', team: holder.code, use: false })}>
                  Let him go
                </button>
              </div>
            </>
          ) : (
            <p>
              <TeamBadge team={holder} size="sm" /> {name(holder.code)} is deciding whether to use RTM at {formatLakh(a.bid!)}…
            </p>
          )}
        </div>
      )}

      <div className="paddles">
        {lot.bidders.map((c) => {
          const t = draftTeam(state, c);
          const block = lotBidBlock(state, c);
          const isMine = mine.includes(c);
          return (
            <div key={c} className={`paddle ${a.leader === c ? 'holding' : ''} ${isMine ? 'human' : ''}`} style={{ ['--team' as string]: t.color }}>
              <div className="paddle-head">
                <TeamBadge team={t} />
                <span className="paddle-name">{seats?.[c]?.name ?? t.name}</span>
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
                    {overseasIn(state, t)}/{state.rules.overseasMax}
                  </dd>
                </div>
              </dl>
              {isMine && (
                <button type="button" className="btn bid-btn" style={{ color: inkFor(t.color) }} disabled={block !== null} onClick={() => dispatch({ type: 'bid', team: c })}>
                  {block === null && next !== null ? `Bid ${formatLakh(next)}` : BID_TEXT[block ?? 'no-lot']}
                </button>
              )}
              {a.leader === c && <span className="paddle-up">paddle up</span>}
            </div>
          );
        })}
      </div>

      <div className="rtm-lists">
        {upcoming.length > 0 && (
          <section className="panel">
            <h3>Still to come</h3>
            <ul className="squad-list">
              {upcoming.map((l) => (
                <li key={l.playerId}>
                  <span className={`role role-${state.players[l.playerId].role}`}>{state.players[l.playerId].role}</span>
                  <span className="grow">
                    {state.players[l.playerId].name}
                    <span className="lot-teams">{[l.holder, ...l.bidders].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="price">{formatLakh(l.openLakh)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {done.length > 0 && <AuctionLogPanel state={state} rows={done} title="Settled" />}
      </div>
    </>
  );
}

export function AuctionLogPanel({ state, rows, title }: { state: DraftState; rows: DraftState['auctionLog']; title: string }) {
  return (
    <section className="panel">
      <h3>{title}</h3>
      <ul className="squad-list">
        {rows.map((r, i) => {
          const to = r.to ? state.teams.find((t) => t.code === r.to) : null;
          return (
            <li key={`${r.playerId}-${i}`}>
              {to ? <TeamBadge team={to} size="sm" /> : <span className="badge badge-sm badge-none">—</span>}
              <span className="grow">
                {state.players[r.playerId].name}
                <span className="muted small"> · {r.note}</span>
              </span>
              {r.rtm && <span className="rtm-tag">RTM</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
