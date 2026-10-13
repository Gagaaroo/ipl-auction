import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Player, Role } from '../engine/types';
import { priceOf, type DraftState } from '../engine/draft';
import { formatLakh } from '../engine/money';
import { BallRating, OS, ROLE_LABEL, Stat } from './bits';

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

export interface PlateAction {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}

/** The ivory name plate for one player. */
export function PlayerPlate({
  p,
  chips,
  price,
  priceNote,
  actions = [],
  scrollOnChange = false,
}: {
  p: Player | null;
  chips?: ReactNode;
  price?: number;
  priceNote?: string;
  actions?: PlateAction[];
  /** On a phone the plate sits above the list: bring it into view when the player changes. */
  scrollOnChange?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!scrollOnChange || !p || !el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) {
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
    }
  }, [p, scrollOnChange]);
  if (!p)
    return (
      <article className="plate plate-empty" ref={ref}>
        <p className="plate-hint">{priceNote ?? 'Tap a player on the board below to see him here.'}</p>
      </article>
    );
  return (
    <article className="plate" ref={ref}>
      <div className="chips-row">
        <span className="chip">{ROLE_LABEL[p.role]}</span>
        <span className={`chip ${p.overseas ? 'chip-os' : ''}`}>{p.overseas ? `${p.country} · overseas` : 'India'}</span>
        {chips}
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
        <span className="price-big">{formatLakh(price ?? priceOf(p))}</span>
        <span className="price-story">{priceNote ?? priceStory(p)}</span>
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
      {actions.map((a, i) => (
        <button key={a.label} type="button" className={`btn ${i === 0 ? 'btn-big pick-btn' : 'plate-alt'}`} disabled={a.disabled} onClick={a.onClick}>
          {a.label}
        </button>
      ))}
    </article>
  );
}

export interface RowAction {
  label: string;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  /** Shown as pressed (e.g. already in your list). */
  on?: boolean;
}

const ROLE_FILTERS: (Role | 'ALL')[] = ['ALL', 'BAT', 'WK', 'AR', 'BOWL'];
type Sort = 'price' | 'rating' | 'value' | 'name';
const PAGE = 60;

/** A searchable, sortable table of players with one action button per row. */
export function PlayerTable({
  players,
  priceFor = priceOf,
  selected,
  onSelect,
  action,
  extra,
  canFilter,
  canFilterLabel,
}: {
  players: Player[];
  priceFor?: (p: Player) => number;
  selected: string | null;
  onSelect: (id: string) => void;
  action?: (p: Player) => RowAction | null;
  /** An extra column, e.g. who owns him. */
  extra?: { head: string; cell: (p: Player) => ReactNode };
  /** Optional "only what I can do" filter. */
  canFilter?: (p: Player) => boolean;
  canFilterLabel?: string;
}) {
  const [role, setRole] = useState<Role | 'ALL'>('ALL');
  const [sort, setSort] = useState<Sort>('price');
  const [query, setQuery] = useState('');
  const [team2026, setTeam2026] = useState('ALL');
  const [onlyCan, setOnlyCan] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const q = useDeferredValue(query.trim().toLowerCase());

  const rows = useMemo(() => {
    let list = players.slice();
    if (role !== 'ALL') list = list.filter((p) => p.role === role);
    if (team2026 !== 'ALL') list = list.filter((p) => p.team2026 === team2026);
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q));
    if (onlyCan && canFilter) list = list.filter(canFilter);
    const by: Record<Sort, (a: Player, b: Player) => number> = {
      price: (a, b) => priceFor(b) - priceFor(a) || b.overall - a.overall,
      rating: (a, b) => b.overall - a.overall || priceFor(a) - priceFor(b),
      value: (a, b) => b.overall / Math.sqrt(priceFor(b)) - a.overall / Math.sqrt(priceFor(a)),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return list.sort(by[sort]);
  }, [players, role, team2026, q, onlyCan, canFilter, sort, priceFor]);

  const realTeams = useMemo(() => [...new Set(players.map((p) => p.team2026).filter(Boolean))].sort() as string[], [players]);

  return (
    <>
      <div className="board-tools">
        <div className="chips" role="group" aria-label="Filter by role">
          {ROLE_FILTERS.map((r) => (
            <button key={r} type="button" className={role === r ? 'on' : ''} aria-pressed={role === r} onClick={() => setRole(r)}>
              {r === 'ALL' ? 'All' : r}
            </button>
          ))}
        </div>
        <input type="search" placeholder="Search players" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search players" />
        <select value={team2026} onChange={(e) => setTeam2026(e.target.value)} aria-label="2026 team">
          <option value="ALL">All 2026 teams</option>
          {realTeams.map((t) => (
            <option key={t} value={t}>
              Now at {t}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
          <option value="price">Price, high first</option>
          <option value="rating">Rating, high first</option>
          <option value="value">Best value</option>
          <option value="name">Name</option>
        </select>
        {canFilter && (
          <label className="check">
            <input type="checkbox" checked={onlyCan} onChange={(e) => setOnlyCan(e.target.checked)} /> {canFilterLabel}
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
                <th className="hide-sm">{extra ? extra.head : 'Now at'}</th>
                <th>Ovr</th>
                <th className="hide-sm">Bat / Bowl</th>
                <th>Price</th>
                <th aria-label="Action" />
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((p) => {
                const a = action?.(p);
                return (
                  <tr key={p.id} className={selected === p.id ? 'sel' : ''} onClick={() => onSelect(p.id)}>
                    <td>
                      <span className={`role role-${p.role}`}>{p.role}</span> <span className="pn">{p.name}</span> {p.overseas && <OS />}
                    </td>
                    <td className="hide-sm muted">{extra ? extra.cell(p) : p.team2026 ?? '—'}</td>
                    <td>
                      <span className="ovr">{p.overall}</span>
                    </td>
                    <td className="hide-sm muted num">
                      {p.bat} / {p.bowl}
                    </td>
                    <td className="price num">{formatLakh(priceFor(p))}</td>
                    <td>
                      {a && (
                        <button
                          type="button"
                          className={`btn btn-small pick-small ${a.on ? 'is-on' : ''}`}
                          disabled={a.disabled}
                          title={a.title}
                          onClick={(e) => {
                            e.stopPropagation();
                            a.onClick();
                          }}
                        >
                          {a.label}
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
    </>
  );
}

/** Milliseconds left on a clock that (re)starts whenever `seq` changes. */
export function useCountdown(seq: number | null, windowMs: number): number {
  const [now, setNow] = useState(() => performance.now());
  const startRef = useRef({ seq, at: performance.now() });
  if (startRef.current.seq !== seq) startRef.current = { seq, at: performance.now() };
  useEffect(() => {
    if (seq === null) return;
    const id = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(id);
  }, [seq]);
  return seq === null ? 0 : Math.max(0, windowMs - (now - startRef.current.at));
}

export type { DraftState };
