import { useMemo, useRef, useState } from 'react';
import type { PlayerRecord, Rules, TeamDef } from '../engine/types';
import { DEFAULT_RULES, type TeamEntry } from '../engine/auction';
import { parsePlayersCsv } from '../engine/pool';
import { IPL_TEAMS } from '../data/teams';
import defaultData from '../data/players.json';
import { TeamBadge } from './bits';
import { loadCustomPlayers, loadSetup, saveCustomPlayers, saveSetup } from './storage';

type Slot = 'off' | 'ai' | 'human';

interface SetupPrefs {
  slots: Record<string, Slot>;
  custom: TeamDef | null;
  rules: Rules;
}

const DEFAULT_PLAYERS = defaultData.players as PlayerRecord[];

function defaultPrefs(): SetupPrefs {
  return {
    slots: Object.fromEntries(IPL_TEAMS.map((t) => [t.code, 'ai' as Slot])),
    custom: null,
    rules: DEFAULT_RULES,
  };
}

export interface StartConfig {
  teams: TeamEntry[];
  rules: Rules;
  players: PlayerRecord[];
}

export function Setup({ onStart }: { onStart: (cfg: StartConfig) => void }) {
  const [prefs, setPrefsRaw] = useState<SetupPrefs>(() => {
    const saved = loadSetup<SetupPrefs>();
    return saved ? { ...defaultPrefs(), ...saved, rules: { ...DEFAULT_RULES, ...saved.rules } } : defaultPrefs();
  });
  const setPrefs = (fn: (p: SetupPrefs) => SetupPrefs) =>
    setPrefsRaw((p) => {
      const n = fn(p);
      saveSetup(n);
      return n;
    });

  const [customPlayers, setCustomPlayers] = useState<PlayerRecord[] | null>(loadCustomPlayers);
  const players = customPlayers ?? DEFAULT_PLAYERS;

  const allTeams: TeamDef[] = prefs.custom ? [...IPL_TEAMS, prefs.custom] : IPL_TEAMS;
  const slotOf = (code: string): Slot => prefs.slots[code] ?? 'off';
  const included = allTeams.filter((t) => slotOf(t.code) !== 'off');
  const humans = included.filter((t) => slotOf(t.code) === 'human');

  const setSlot = (code: string, slot: Slot) => setPrefs((p) => ({ ...p, slots: { ...p.slots, [code]: slot } }));
  const setRule = <K extends keyof Rules>(k: K, v: Rules[K]) => setPrefs((p) => ({ ...p, rules: { ...p.rules, [k]: v } }));

  /** Grow or shrink the field by switching AI teams on/off; human teams are never dropped. */
  const setCount = (n: number) =>
    setPrefs((p) => {
      const slots = { ...p.slots };
      const order = p.custom ? [...IPL_TEAMS, p.custom] : IPL_TEAMS;
      let count = order.filter((t) => (slots[t.code] ?? 'off') !== 'off').length;
      for (const t of [...order].reverse()) {
        if (count <= n) break;
        if (slots[t.code] === 'ai') { slots[t.code] = 'off'; count--; }
      }
      for (const t of order) {
        if (count >= n) break;
        if ((slots[t.code] ?? 'off') === 'off') { slots[t.code] = 'ai'; count++; }
      }
      return { ...p, slots };
    });

  const rules = prefs.rules;
  const problems = useMemo(() => {
    const out: string[] = [];
    if (included.length < 2) out.push('At least two teams need to take part.');
    if (rules.squadMin > rules.squadMax) out.push('Minimum squad can’t be bigger than the squad size.');
    if (rules.squadMin < 11) out.push('Minimum squad must be at least 11 — you need a team to play.');
    if (rules.squadMin * 20 > rules.purseCr * 100) out.push('That purse can’t even fill the minimum squad.');
    if (players.length < included.length * 11) out.push('Not enough players in the pool for that many teams.');
    return out;
  }, [included.length, rules, players.length]);

  const start = () => {
    if (problems.length) return;
    onStart({
      teams: included.map((def) => ({ def, human: slotOf(def.code) === 'human' })),
      rules,
      players,
    });
  };

  return (
    <div className="setup">
      <section className="panel">
        <h2>1. Pick your team</h2>
        <p className="hint">
          Tap <b>You</b> on the team you want to run. Passing the phone round? Give each friend a team — everything left on{' '}
          <b>AI</b> bids by itself.
        </p>
        <div className="team-grid">
          {IPL_TEAMS.map((t) => (
            <TeamCard key={t.code} team={t} slot={slotOf(t.code)} onSlot={(s) => setSlot(t.code, s)} />
          ))}
          {prefs.custom ? (
            <TeamCard
              team={prefs.custom}
              slot={slotOf(prefs.custom.code)}
              onSlot={(s) => setSlot(prefs.custom!.code, s)}
              onRemove={() =>
                setPrefs((p) => {
                  const slots = { ...p.slots };
                  delete slots[p.custom!.code];
                  return { ...p, custom: null, slots };
                })
              }
            />
          ) : (
            <CreateTeamCard
              onCreate={(def) =>
                setPrefs((p) => {
                  const slots = { ...p.slots, [def.code]: 'human' as Slot };
                  // Default field is your team plus nine others, so rest the last AI side.
                  const aiCodes = IPL_TEAMS.map((t) => t.code).filter((c) => slots[c] === 'ai');
                  const total = Object.values(slots).filter((s) => s !== 'off').length;
                  if (total > 10 && aiCodes.length) slots[aiCodes[aiCodes.length - 1]] = 'off';
                  return { ...p, custom: def, slots };
                })
              }
            />
          )}
        </div>
        <div className="row count-row">
          <span>Teams in the auction</span>
          <div className="stepper">
            <button type="button" onClick={() => setCount(included.length - 1)} disabled={included.length <= 2} aria-label="Fewer teams">
              −
            </button>
            <b>{included.length}</b>
            <button type="button" onClick={() => setCount(included.length + 1)} disabled={included.length >= allTeams.length} aria-label="More teams">
              +
            </button>
          </div>
          <span className="hint">
            {humans.length === 0 ? 'Nobody human — you’ll just watch the AI.' : humans.length === 1 ? `You’re ${humans[0].name}.` : `${humans.length} humans, pass-and-play.`}
          </span>
        </div>
      </section>

      <section className="panel">
        <h2>2. House rules</h2>
        <div className="rules">
          <label>
            Purse per team
            <select value={rules.purseCr} onChange={(e) => setRule('purseCr', Number(e.target.value))}>
              {[60, 80, 100, 120].map((v) => (
                <option key={v} value={v}>₹{v} Cr</option>
              ))}
            </select>
          </label>
          <label>
            Squad size
            <input type="number" min={11} max={30} value={rules.squadMax} onChange={(e) => setRule('squadMax', clampInt(e.target.value, 11, 30))} />
          </label>
          <label>
            Minimum squad
            <input type="number" min={11} max={30} value={rules.squadMin} onChange={(e) => setRule('squadMin', clampInt(e.target.value, 11, 30))} />
          </label>
          <label>
            Overseas cap
            <input type="number" min={0} max={30} value={rules.overseasMax} onChange={(e) => setRule('overseasMax', clampInt(e.target.value, 0, 30))} />
            <small>max {rules.overseasXI} in a playing XI</small>
          </label>
          <label>
            Bid clock
            <select value={rules.clockSec} onChange={(e) => setRule('clockSec', Number(e.target.value))}>
              {[4, 6, 9].map((v) => (
                <option key={v} value={v}>{v} seconds</option>
              ))}
            </select>
          </label>
        </div>
        <fieldset className="radio-row">
          <legend>Player pool</legend>
          <label>
            <input type="radio" checked={rules.poolMode === 'real'} onChange={() => setRule('poolMode', 'real')} /> <b>Real squads</b> — IPL teams keep
            their best {Math.max(0, rules.squadMax - 6)} 2026 players, the rest go under the hammer
          </label>
          <label>
            <input type="radio" checked={rules.poolMode === 'full'} onChange={() => setRule('poolMode', 'full')} /> <b>Full auction</b> — every player
            goes into the pool, everyone starts empty
          </label>
        </fieldset>
        <button type="button" className="linkish" onClick={() => setPrefs((p) => ({ ...p, rules: DEFAULT_RULES }))}>
          Reset house rules
        </button>
      </section>

      <section className="panel">
        <h2>3. Players</h2>
        <CsvImport
          count={players.length}
          isCustom={customPlayers !== null}
          onImport={(ps) => {
            setCustomPlayers(ps);
            saveCustomPlayers(ps);
          }}
          onReset={() => {
            setCustomPlayers(null);
            saveCustomPlayers(null);
          }}
          current={players}
        />
      </section>

      <div className="start-row">
        {problems.length > 0 && (
          <ul className="problems">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <button type="button" className="btn btn-big" onClick={start} disabled={problems.length > 0}>
          Open the auction →
        </button>
      </div>
    </div>
  );
}

function clampInt(v: string, lo: number, hi: number) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}

function TeamCard({ team, slot, onSlot, onRemove }: { team: TeamDef; slot: Slot; onSlot: (s: Slot) => void; onRemove?: () => void }) {
  return (
    <div className={`team-card slot-${slot}`} style={{ ['--team' as string]: team.color }}>
      <div className="team-card-head">
        <TeamBadge team={team} size="lg" />
        <span className="team-card-name">{team.name}</span>
      </div>
      <div className="seg" role="radiogroup" aria-label={`${team.name} is`}>
        {(['off', 'ai', 'human'] as Slot[]).map((s) => (
          <button key={s} type="button" role="radio" aria-checked={slot === s} className={slot === s ? 'on' : ''} onClick={() => onSlot(s)}>
            {s === 'off' ? 'Out' : s === 'ai' ? 'AI' : 'You'}
          </button>
        ))}
      </div>
      {onRemove && (
        <button type="button" className="linkish small" onClick={onRemove}>
          delete team
        </button>
      )}
    </div>
  );
}

const TAKEN = new Set(IPL_TEAMS.map((t) => t.code));

function CreateTeamCard({ onCreate }: { onCreate: (t: TeamDef) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [color, setColor] = useState('#2f5d3a');
  const err =
    name.trim().length < 2 ? 'Give it a name' : !/^[A-Z]{2,4}$/.test(code) ? 'Short code: 2–4 letters' : TAKEN.has(code) ? 'That code belongs to an IPL side' : null;

  if (!open)
    return (
      <button type="button" className="team-card create" onClick={() => setOpen(true)}>
        <span className="plus">+</span>
        <span>Create your own</span>
      </button>
    );
  return (
    <form
      className="team-card create-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!err) onCreate({ code, name: name.trim(), color, custom: true });
      }}
    >
      <div className="team-card-head">
        <TeamBadge team={{ code: code || '???', color }} size="lg" />
        <input aria-label="Team name" placeholder="Team name" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="row">
        <input
          aria-label="Short code"
          className="code-input"
          placeholder="CODE"
          value={code}
          maxLength={4}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
        />
        <input aria-label="Team colour" type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        <button type="submit" className="btn btn-small" disabled={!!err}>
          Add
        </button>
      </div>
      <small className="hint">{err ?? 'Looks good.'}</small>
    </form>
  );
}

function CsvImport({
  count,
  isCustom,
  current,
  onImport,
  onReset,
}: {
  count: number;
  isCustom: boolean;
  current: PlayerRecord[];
  onImport: (p: PlayerRecord[]) => void;
  onReset: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'replace' | 'add'>('add');
  const [msg, setMsg] = useState<string | null>(null);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const { players, errors } = parsePlayersCsv(await f.text());
    if (!players.length) {
      setMsg(`Nothing imported. ${errors.slice(0, 3).join(' · ')}`);
      return;
    }
    let next = players;
    if (mode === 'add') {
      const names = new Set(players.map((p) => p.name.toLowerCase()));
      next = [...current.filter((p) => !names.has(p.name.toLowerCase())), ...players];
    }
    onImport(next);
    setMsg(`Imported ${players.length} player${players.length === 1 ? '' : 's'}${errors.length ? ` (skipped ${errors.length} bad row${errors.length === 1 ? '' : 's'})` : ''}.`);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="csv">
      <p>
        <b>{count}</b> players in the pool{isCustom ? ' (your imported list)' : ', from players.json'}.
        {isCustom && (
          <>
            {' '}
            <button type="button" className="linkish" onClick={onReset}>
              Go back to players.json
            </button>
          </>
        )}
      </p>
      <div className="row wrap">
        <label className="btn btn-small file-btn">
          Import CSV…
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <label>
          <input type="radio" checked={mode === 'add'} onChange={() => setMode('add')} /> add / update
        </label>
        <label>
          <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} /> replace everyone
        </label>
      </div>
      <p className="hint">
        Columns: <code>name,role,country,overseas,bat,bowl,overall,basePriceLakh,team2026</code> — only name, role, bat and bowl are required. See{' '}
        <a href="#/how">How to play</a>.
      </p>
      {msg && <p className="note">{msg}</p>}
    </div>
  );
}
