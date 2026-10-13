import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DataConnection, Peer as PeerT } from 'peerjs';
import { applyAction, createDraft, draftTeam, type DraftAction, type DraftState } from '../../engine/draft';
import { draftSource } from '../../engine/season';
import { formatLakh } from '../../engine/money';
import { makeRng } from '../../engine/rng';
import { joinLink, keepAwake, peerOptions, roomPeerId, slim, type GuestMsg, type HostMsg, type LobbyView, type SeatInfo } from '../../online/net';
import { ConfirmDialog, TeamBadge, type Ask } from '../bits';
import { DraftView, SPEEDS, useAiTurns, type Speed } from '../DraftRoom';
import { Results } from '../Results';
import { saveHost, saveName, type HostSaved } from '../storage';
import { ShareLink } from './bits';

/** How long a friend can drop off on their own turn before the AI picks for them. */
const OFFLINE_GRACE_MS = 20000;

type Status = { kind: 'connecting' | 'ready' | 'retrying' | 'error'; text?: string };

export function HostRoom({ initial, onClose }: { initial: HostSaved; onClose: () => void }) {
  const [saved, setSavedState] = useState(initial);
  const savedRef = useRef(initial);
  const connsRef = useRef(new Map<string, DataConnection>());
  const namesRef = useRef(new Map<string, string>());
  const snapshotSent = useRef(new Set<string>());
  const rngRef = useRef(makeRng((Date.now() ^ initial.seasonSeed) >>> 0));
  const [online, setOnline] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>({ kind: 'connecting' });
  const [speed, setSpeed] = useState<Speed>('normal');
  const [paused, setPaused] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const closeAsk = useCallback(() => setAsk(null), []);

  const seatInfo = useCallback((s: HostSaved, live: Set<string>): Record<string, SeatInfo> => {
    const out: Record<string, SeatInfo> = { [s.hostSeat]: { name: `${s.hostName} (host)`, online: true } };
    for (const [code, who] of Object.entries(s.seats)) out[code] = { name: who.name, online: live.has(who.clientId) };
    return out;
  }, []);

  const lobbyView = useCallback((s: HostSaved, live: Set<string>): LobbyView => {
    const r = s.config.rules;
    return {
      hostName: s.hostName,
      rulesLine: `₹${r.purseCr} Cr purse · squads of ${r.squadMin}–${r.squadMax} · ${r.overseasMax} overseas`,
      seats: s.config.teams.map(({ def, human }) => {
        const who = s.seats[def.code];
        const isHost = def.code === s.hostSeat;
        return {
          code: def.code,
          name: def.name,
          color: def.color,
          human: human || isHost,
          taker: isHost ? `${s.hostName} (host)` : who?.name ?? null,
          online: isHost || (!!who && live.has(who.clientId)),
          isHost,
        };
      }),
    };
  }, []);

  const seatOf = (s: HostSaved, clientId: string) => Object.entries(s.seats).find(([, w]) => w.clientId === clientId)?.[0] ?? null;

  const send = (conn: DataConnection, msg: HostMsg) => {
    try {
      if (conn.open) void conn.send(msg);
    } catch {
      /* a dropped connection; it will be cleaned up on close */
    }
  };

  const sendView = useCallback(
    (clientId: string, conn: DataConnection) => {
      const s = savedRef.current;
      const live = new Set(connsRef.current.keys());
      const yourSeat = seatOf(s, clientId);
      if (!s.draft) return send(conn, { t: 'lobby', lobby: lobbyView(s, live), yourSeat });
      if (!snapshotSent.current.has(clientId)) {
        snapshotSent.current.add(clientId);
        return send(conn, { t: 'snapshot', draft: s.draft, seats: seatInfo(s, live), yourSeat, seasonSeed: s.seasonSeed });
      }
      send(conn, { t: 'update', draft: slim(s.draft), seats: seatInfo(s, live), seasonSeed: s.seasonSeed });
    },
    [lobbyView, seatInfo],
  );

  const broadcast = useCallback(() => {
    for (const [cid, conn] of connsRef.current) sendView(cid, conn);
  }, [sendView]);

  const commit = useCallback(
    (n: HostSaved) => {
      savedRef.current = n;
      setSavedState(n);
      saveHost(n);
      broadcast();
    },
    [broadcast],
  );

  const refreshOnline = useCallback(() => {
    setOnline([...connsRef.current.keys()]);
    broadcast();
  }, [broadcast]);

  const onGuest = useCallback(
    (conn: DataConnection, msg: GuestMsg, setId: (id: string) => void) => {
      const s = savedRef.current;
      if (msg.t === 'hello') {
        const name = String(msg.name || 'Friend').slice(0, 24);
        const old = connsRef.current.get(msg.clientId);
        if (old && old !== conn) old.close();
        connsRef.current.set(msg.clientId, conn);
        namesRef.current.set(msg.clientId, name);
        snapshotSent.current.delete(msg.clientId);
        setId(msg.clientId);
        const seat = seatOf(s, msg.clientId);
        if (seat && s.seats[seat].name !== name) commit({ ...s, seats: { ...s.seats, [seat]: { clientId: msg.clientId, name } } });
        refreshOnline();
        return;
      }
      const clientId = [...connsRef.current.entries()].find(([, c]) => c === conn)?.[0];
      if (!clientId) return;
      if (msg.t === 'claim') {
        if (s.draft) return send(conn, { t: 'notice', text: 'The draft has already started.' });
        const team = s.config.teams.find((t) => t.def.code === msg.team);
        const taken = s.seats[msg.team];
        if (!team || !team.human || msg.team === s.hostSeat || (taken && taken.clientId !== clientId))
          return send(conn, { t: 'notice', text: 'That team isn’t free any more.' });
        const seats = Object.fromEntries(Object.entries(s.seats).filter(([, w]) => w.clientId !== clientId));
        seats[msg.team] = { clientId, name: namesRef.current.get(clientId) ?? 'Friend' };
        commit({ ...s, seats });
        return;
      }
      if (msg.t === 'action') {
        if (!s.draft) return;
        const seat = seatOf(s, clientId);
        const a = msg.action;
        if (!seat || !('team' in a) || a.team !== seat) return;
        const n = applyAction(s.draft, a, rngRef.current);
        if (n !== s.draft) commit({ ...s, draft: n });
      }
    },
    [commit, refreshOnline],
  );

  const onGuestRef = useRef(onGuest);
  onGuestRef.current = onGuest;
  const refreshRef = useRef(refreshOnline);
  refreshRef.current = refreshOnline;

  // The room itself: register the room code with the PeerJS cloud and take connections.
  useEffect(() => {
    let dead = false;
    let peer: PeerT | null = null;
    let timer = 0;
    let tries = 0;
    const retry = (text: string) => {
      if (dead) return;
      setStatus({ kind: 'retrying', text });
      peer?.destroy();
      window.clearTimeout(timer);
      timer = window.setTimeout(start, Math.min(10000, 1500 * ++tries));
    };
    async function start() {
      const { default: Peer } = await import('peerjs');
      if (dead) return;
      const p = new Peer(roomPeerId(initial.code), peerOptions());
      peer = p;
      p.on('open', () => {
        tries = 0;
        setStatus({ kind: 'ready' });
      });
      p.on('connection', (conn) => {
        let id: string | null = null;
        conn.on('data', (d) => onGuestRef.current(conn, d as GuestMsg, (x) => (id = x)));
        const gone = () => {
          if (id && connsRef.current.get(id) === conn) {
            connsRef.current.delete(id);
            refreshRef.current();
          }
        };
        conn.on('close', gone);
        conn.on('error', gone);
      });
      p.on('disconnected', () => {
        if (!dead && !p.destroyed) {
          setStatus({ kind: 'retrying', text: 'Lost the relay; reconnecting…' });
          p.reconnect();
        }
      });
      p.on('error', (err) => {
        const type = (err as { type?: string }).type;
        if (type === 'peer-unavailable') return;
        if (type === 'unavailable-id') retry('Reclaiming the room code…');
        else if (type === 'browser-incompatible') setStatus({ kind: 'error', text: 'This browser can’t host online rooms. Try Chrome, Edge, Safari or Firefox.' });
        else retry('Can’t reach the relay; retrying…');
      });
    }
    void start();
    return () => {
      dead = true;
      window.clearTimeout(timer);
      peer?.destroy();
    };
  }, [initial.code]);

  // Keep the host's screen awake: the room lives in this tab.
  useEffect(() => {
    let release = () => {};
    void keepAwake().then((r) => (release = r));
    return () => release();
  }, []);

  const live = useMemo(() => new Set(online), [online]);
  const seats = useMemo(() => seatInfo(saved, live), [saved, live, seatInfo]);

  const dispatch = useCallback(
    (a: DraftAction) => {
      const s = savedRef.current;
      if (!s.draft) return;
      const n = applyAction(s.draft, a, rngRef.current);
      if (n !== s.draft) commit({ ...s, draft: n });
    },
    [commit],
  );

  const draft = saved.draft;
  const delayFor = useCallback(
    (code: string) => {
      const s = savedRef.current;
      if (!s.draft) return null;
      if (!draftTeam(s.draft, code).human) return SPEEDS[speed];
      if (code === s.hostSeat) return null;
      const who = s.seats[code];
      if (!who) return SPEEDS[speed];
      return live.has(who.clientId) ? null : OFFLINE_GRACE_MS;
    },
    [speed, live],
  );
  useAiTurns(draft ?? EMPTY, delayFor, paused || !draft, dispatch);

  const closeRoom = () => {
    for (const conn of connsRef.current.values()) send(conn, { t: 'closed' });
    window.setTimeout(() => {
      saveHost(null);
      onClose();
    }, 150);
  };
  const askClose = () =>
    setAsk({ message: 'Close this room? Everyone who joined is disconnected, and the draft is cleared.', yes: 'Close room', onYes: closeRoom });

  const bar = (
    <div className="room-bar">
      <span className="eyebrow">Room</span>
      <span className="room-code">{saved.code}</span>
      <span className={`dot ${status.kind === 'ready' ? '' : 'off'}`} aria-hidden="true" />
      <span className="grow">
        {status.kind === 'ready' ? `${online.length} friend${online.length === 1 ? '' : 's'} connected` : status.text ?? 'Opening the room…'}
      </span>
      <CopyButton text={joinLink(saved.code)} label="Copy invite link" />
      <button type="button" className="btn btn-small btn-danger" onClick={askClose}>
        Close room
      </button>
    </div>
  );

  if (draft?.finished)
    return (
      <>
        {bar}
        <Results
          state={draftSource(draft)}
          seasonSeed={saved.seasonSeed}
          onReplay={() => commit({ ...savedRef.current, seasonSeed: (Math.random() * 2 ** 32) >>> 0 })}
          onNew={closeRoom}
          newLabel="Close room"
        />
        <ConfirmDialog ask={ask} onClose={closeAsk} />
      </>
    );

  if (draft)
    return (
      <>
        <DraftView
          state={draft}
          mine={[saved.hostSeat]}
          authority
          dispatch={dispatch}
          paused={paused}
          setPaused={setPaused}
          speed={speed}
          setSpeed={setSpeed}
          seats={seats}
          topBar={bar}
        />
        <ConfirmDialog ask={ask} onClose={closeAsk} />
      </>
    );

  return <HostLobby saved={saved} status={status} live={live} commit={commit} onClose={askClose} ask={ask} closeAsk={closeAsk} setAsk={setAsk} snapshotSent={snapshotSent} />;
}

const EMPTY = { finished: true } as DraftState;

function HostLobby({
  saved,
  status,
  live,
  commit,
  onClose,
  ask,
  closeAsk,
  setAsk,
  snapshotSent,
}: {
  saved: HostSaved;
  status: Status;
  live: Set<string>;
  commit: (s: HostSaved) => void;
  onClose: () => void;
  ask: Ask | null;
  closeAsk: () => void;
  setAsk: (a: Ask) => void;
  snapshotSent: { current: Set<string> };
}) {
  const r = saved.config.rules;
  const teams = saved.config.teams;
  const open = teams.filter((t) => t.human && t.def.code !== saved.hostSeat && !saved.seats[t.def.code]);
  const friends = Object.values(saved.seats);

  const setHuman = (code: string, human: boolean) => {
    const seats = { ...saved.seats };
    if (!human) delete seats[code];
    commit({ ...saved, seats, config: { ...saved.config, teams: teams.map((t) => (t.def.code === code ? { ...t, human } : t)) } });
  };

  const start = () => {
    const go = () => {
      snapshotSent.current.clear();
      const draft = createDraft({
        rules: r,
        players: saved.config.players,
        seed: (Math.random() * 2 ** 32) >>> 0,
        teams: teams.map((t) => ({ def: t.def, human: t.def.code === saved.hostSeat || !!saved.seats[t.def.code] })),
      });
      commit({ ...saved, draft });
    };
    if (open.length)
      setAsk({
        message: `${open.length} open seat${open.length === 1 ? '' : 's'} (${open.map((t) => t.def.code).join(', ')}) will be played by the AI. Start anyway?`,
        yes: 'Start the draft',
        onYes: go,
      });
    else go();
  };

  return (
    <div className="online-grid">
      <section className="panel">
        <div className="eyebrow">Your online room</div>
        <div className="big-code">{saved.code}</div>
        <p className="hint">
          Send this link to your friends. They open it, type their name and take one of the open teams. You start the draft when everyone
          is in. Keep this tab open: the room runs here.
        </p>
        <ShareLink code={saved.code} />
        <p className={`status-line ${status.kind === 'error' ? 'bad' : ''}`}>
          <span className={`dot ${status.kind === 'ready' ? '' : 'off'}`} /> {status.kind === 'ready' ? 'Room open. Waiting for friends.' : status.text ?? 'Opening the room…'}
        </p>
        <label className="rules" style={{ display: 'block' }}>
          <span className="eyebrow">Your name</span>
          <input
            id="host-name"
            value={saved.hostName}
            maxLength={24}
            onChange={(e) => {
              saveName(e.target.value);
              commit({ ...saved, hostName: e.target.value || 'Host' });
            }}
          />
        </label>
        <p className="hint">{`₹${r.purseCr} Cr purse · squads of ${r.squadMin}–${r.squadMax} · ${r.overseasMax} overseas · real 2026 prices`}</p>
        <div className="start-buttons">
          <button type="button" className="btn" onClick={onClose}>
            Close room
          </button>
          <button type="button" className="btn btn-big" onClick={start}>
            Start the draft →
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Who’s at the table</h2>
        <p className="hint">
          {friends.length} friend{friends.length === 1 ? '' : 's'} joined · {open.length} open seat{open.length === 1 ? '' : 's'}. Switch a team to{' '}
          <b>Friend</b> to open a seat for someone, or <b>AI</b> to let the computer run it.
        </p>
        <ul className="seat-list">
          {teams.map(({ def, human }) => {
            const isHost = def.code === saved.hostSeat;
            const who = saved.seats[def.code];
            return (
              <li key={def.code} className={isHost ? 'mine' : ''} style={{ ['--team' as string]: def.color }}>
                <TeamBadge team={def} size="sm" />
                <span className="who">
                  <b>{isHost ? `${saved.hostName} (you)` : who ? who.name : human ? 'Open seat' : 'AI'}</b>
                  <span>
                    {def.name}
                    {who && (live.has(who.clientId) ? ' · connected' : ' · offline')}
                    {!isHost && human && !who && ' · waiting for a friend'}
                  </span>
                </span>
                {who && <span className={`dot ${live.has(who.clientId) ? '' : 'off'}`} />}
                {!isHost && (
                  <div className="seg seg-2" role="radiogroup" aria-label={`${def.name} is played by`}>
                    <button type="button" role="radio" aria-checked={human} className={human ? 'on' : ''} onClick={() => setHuman(def.code, true)}>
                      Friend
                    </button>
                    <button type="button" role="radio" aria-checked={!human} className={!human ? 'on' : ''} onClick={() => setHuman(def.code, false)}>
                      AI
                    </button>
                  </div>
                )}
                {isHost && (
                  <select
                    aria-label="Your team"
                    value={saved.hostSeat}
                    onChange={(e) => commit({ ...saved, hostSeat: e.target.value, config: { ...saved.config, teams: teams.map((t) => (t.def.code === e.target.value ? { ...t, human: true } : t)) } })}
                  >
                    {teams
                      .filter((t) => !saved.seats[t.def.code])
                      .map((t) => (
                        <option key={t.def.code} value={t.def.code}>
                          {t.def.code}
                        </option>
                      ))}
                  </select>
                )}
              </li>
            );
          })}
        </ul>
        <p className="hint">Purse per team {formatLakh(r.purseCr * 100)}. If a friend drops off on their turn, the AI picks for them after 20 seconds.</p>
      </section>
      <ConfirmDialog ask={ask} onClose={closeAsk} />
    </div>
  );
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-small"
      onClick={() => {
        navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setDone(true);
            window.setTimeout(() => setDone(false), 1600);
          })
          .catch(() => {});
      }}
    >
      {done ? 'Copied' : label}
    </button>
  );
}

export type { DraftState };
