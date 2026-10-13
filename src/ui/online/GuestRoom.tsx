import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { DataConnection, Peer as PeerT } from 'peerjs';
import type { DraftAction, DraftState } from '../../engine/draft';
import { draftSource } from '../../engine/season';
import { leaveJoinLink, newClientId, peerOptions, roomPeerId, type GuestMsg, type HostMsg, type LobbyView, type SeatInfo } from '../../online/net';
import { TeamBadge } from '../bits';
import { DraftView } from '../DraftRoom';
import { Results } from '../Results';
import { loadGuest, loadName, saveGuest, saveName } from '../storage';

type Conn = 'connecting' | 'live' | 'reconnecting' | 'notfound' | 'closed' | 'error';

export function GuestRoom({ code }: { code: string }) {
  const [name, setName] = useState(() => {
    const g = loadGuest();
    return g?.code === code ? g.name : loadName();
  });
  const [joined, setJoined] = useState(() => loadGuest()?.code === code);
  const clientId = useRef((() => {
    const g = loadGuest();
    return g?.code === code ? g.clientId : newClientId();
  })());

  const join = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim().slice(0, 24);
    if (!n) return;
    saveName(n);
    saveGuest({ code, clientId: clientId.current, name: n });
    setName(n);
    setJoined(true);
  };

  if (!joined)
    return (
      <div className="online-grid">
        <section className="panel">
          <div className="eyebrow">You’ve been invited to an IPL draft</div>
          <div className="big-code">{code}</div>
          <p className="hint">
            Pick current IPL players at their real 2026 prices against your friends. Type your name, then choose one of the open teams.
          </p>
          <form className="name-form" onSubmit={join}>
            <input id="guest-name" autoFocus placeholder="Your name" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} aria-label="Your name" />
            <button type="submit" className="btn btn-big" disabled={!name.trim()}>
              Join room →
            </button>
          </form>
        </section>
      </div>
    );

  return <GuestLive code={code} clientId={clientId.current} name={name} />;
}

function GuestLive({ code, clientId, name }: { code: string; clientId: string; name: string }) {
  const [conn, setConn] = useState<Conn>('connecting');
  const [lobby, setLobby] = useState<LobbyView | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [seats, setSeats] = useState<Record<string, SeatInfo>>({});
  const [yourSeat, setYourSeat] = useState<string | null>(null);
  const [seasonSeed, setSeasonSeed] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const playersRef = useRef<DraftState['players'] | null>(null);
  const closedRef = useRef(false);

  const onMsg = useCallback((msg: HostMsg) => {
    switch (msg.t) {
      case 'lobby':
        setLobby(msg.lobby);
        setYourSeat(msg.yourSeat);
        setDraft(null);
        break;
      case 'snapshot':
        playersRef.current = msg.draft.players;
        setDraft(msg.draft);
        setSeats(msg.seats);
        setYourSeat(msg.yourSeat);
        setSeasonSeed(msg.seasonSeed);
        break;
      case 'update':
        if (!playersRef.current) return;
        setDraft({ ...(msg.draft as DraftState), players: playersRef.current });
        setSeats(msg.seats);
        setSeasonSeed(msg.seasonSeed);
        break;
      case 'notice':
        setNotice(msg.text);
        window.setTimeout(() => setNotice(null), 4000);
        break;
      case 'closed':
        closedRef.current = true;
        setConn('closed');
        break;
    }
  }, []);

  useEffect(() => {
    let dead = false;
    let peer: PeerT | null = null;
    let timer = 0;
    const later = (fn: () => void, ms: number) => {
      window.clearTimeout(timer);
      if (!dead && !closedRef.current) timer = window.setTimeout(fn, ms);
    };
    const connect = () => {
      if (dead || !peer || peer.destroyed || closedRef.current) return;
      if (peer.disconnected) {
        peer.reconnect();
        return;
      }
      const c = peer.connect(roomPeerId(code), { reliable: true });
      connRef.current = c;
      c.on('open', () => {
        setConn('live');
        const hello: GuestMsg = { t: 'hello', clientId, name };
        void c.send(hello);
      });
      c.on('data', (d) => onMsg(d as HostMsg));
      const lost = () => {
        if (connRef.current !== c || dead || closedRef.current) return;
        setConn('reconnecting');
        later(connect, 2500);
      };
      c.on('close', lost);
      c.on('error', lost);
    };
    async function start() {
      const { default: Peer } = await import('peerjs');
      if (dead) return;
      const p = new Peer(peerOptions());
      peer = p;
      p.on('open', connect);
      p.on('disconnected', () => later(() => !p.destroyed && p.reconnect(), 2000));
      p.on('error', (err) => {
        const type = (err as { type?: string }).type;
        if (type === 'peer-unavailable') {
          setConn((c) => (c === 'connecting' || c === 'notfound' ? 'notfound' : 'reconnecting'));
          later(connect, 4000);
        } else if (type === 'browser-incompatible') setConn('error');
        else {
          setConn('reconnecting');
          later(() => {
            p.destroy();
            void start();
          }, 4000);
        }
      });
    }
    void start();
    return () => {
      dead = true;
      window.clearTimeout(timer);
      peer?.destroy();
    };
  }, [code, clientId, name, onMsg]);

  const send = (msg: GuestMsg) => {
    const c = connRef.current;
    if (c?.open) void c.send(msg);
  };
  const dispatch = (action: DraftAction) => send({ t: 'action', action });

  const leave = () => {
    saveGuest(null);
    connRef.current?.close();
    leaveJoinLink();
  };

  const statusText: Record<Conn, string> = {
    connecting: 'Connecting to the room…',
    live: 'Connected',
    reconnecting: 'Connection dropped. Reconnecting…',
    notfound: 'Can’t find this room. The host may not have opened it yet, or their screen went off. Still trying…',
    closed: 'The host closed this room.',
    error: 'This browser can’t join online rooms. Try Chrome, Safari, Edge or Firefox.',
  };

  const bar = (
    <div className="room-bar">
      <span className="eyebrow">Room</span>
      <span className="room-code">{code}</span>
      <span className={`dot ${conn === 'live' ? '' : 'off'}`} aria-hidden="true" />
      <span className="grow">
        {conn === 'live' ? `Playing as ${name}${yourSeat ? ` · ${yourSeat}` : ''}` : statusText[conn]}
        {notice && ` · ${notice}`}
      </span>
      <button type="button" className="btn btn-small" onClick={leave}>
        Leave
      </button>
    </div>
  );

  if (conn === 'closed' || conn === 'error')
    return (
      <section className="panel">
        <h2>{conn === 'closed' ? 'Room closed' : 'Can’t join here'}</h2>
        <p>{statusText[conn]}</p>
        <button type="button" className="btn btn-big" onClick={leave}>
          Play on your own →
        </button>
      </section>
    );

  if (draft?.finished)
    return (
      <>
        {bar}
        <Results state={draftSource(draft)} seasonSeed={seasonSeed} />
      </>
    );

  if (draft)
    return <DraftView state={draft} mine={yourSeat ? [yourSeat] : []} authority={false} dispatch={dispatch} seats={seats} topBar={bar} />;

  return (
    <>
      {bar}
      <div className="online-grid">
        <section className="panel">
          <h2>{lobby ? `${lobby.hostName}’s draft` : 'Joining…'}</h2>
          {lobby ? (
            <>
              <p className="hint">{lobby.rulesLine} · real 2026 prices</p>
              <p>
                {yourSeat ? (
                  <>
                    You’re playing as <b>{lobby.seats.find((s) => s.code === yourSeat)?.name}</b>. Waiting for {lobby.hostName} to start the
                    draft.
                  </>
                ) : (
                  'Choose an open team to play.'
                )}
              </p>
            </>
          ) : (
            <p className="status-line">{statusText[conn]}</p>
          )}
        </section>
        {lobby && (
          <section className="panel">
            <h2>Teams</h2>
            <ul className="seat-list">
              {lobby.seats.map((s) => {
                const mine = s.code === yourSeat;
                const open = s.human && !s.taker;
                return (
                  <li key={s.code} className={mine ? 'mine' : ''} style={{ ['--team' as string]: s.color }}>
                    <TeamBadge team={s} size="sm" />
                    <span className="who">
                      <b>{mine ? `${name} (you)` : s.taker ?? (open ? 'Open seat' : 'AI')}</b>
                      <span>{s.name}</span>
                    </span>
                    {s.taker && !mine && <span className={`dot ${s.online ? '' : 'off'}`} />}
                    {open && (
                      <button type="button" className="btn btn-small pick-small" onClick={() => send({ t: 'claim', team: s.code })}>
                        Take
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
