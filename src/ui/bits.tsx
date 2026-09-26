import { useEffect, type CSSProperties, type ReactNode } from 'react';
import type { Player, TeamDef } from '../engine/types';
import { inkFor } from '../data/teams';
import { formatLakh } from '../engine/money';

export function TeamBadge({ team, size = 'md' }: { team: Pick<TeamDef, 'code' | 'color'>; size?: 'sm' | 'md' | 'lg' }) {
  const style: CSSProperties = { background: team.color, color: inkFor(team.color) };
  return (
    <span className={`badge badge-${size}`} style={style} aria-hidden="true">
      {team.code}
    </span>
  );
}

/** Overall rating on a hand-drawn cricket ball. */
export function BallRating({ value, size = 44 }: { value: number; size?: number }) {
  return (
    <svg className="ball" width={size} height={size} viewBox="0 0 44 44" role="img" aria-label={`Overall ${value}`}>
      <circle cx="22" cy="22" r="20" fill="var(--ball)" stroke="var(--ink)" strokeWidth="2" />
      <path d="M12 6 C 17 15, 17 29, 12 38" fill="none" stroke="#f3e6d0" strokeWidth="1.2" strokeDasharray="1.6 2.2" />
      <path d="M32 6 C 27 15, 27 29, 32 38" fill="none" stroke="#f3e6d0" strokeWidth="1.2" strokeDasharray="1.6 2.2" />
      <text x="22" y="27.5" textAnchor="middle" className="ball-num">
        {value}
      </text>
    </svg>
  );
}

export function Stat({ label, value, max = 99 }: { label: string; value: number; max?: number }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-bar">
        <span style={{ width: `${(value / max) * 100}%` }} />
      </span>
      <span className="stat-num">{value}</span>
    </div>
  );
}

export const ROLE_LABEL: Record<Player['role'], string> = { BAT: 'Batter', BOWL: 'Bowler', AR: 'All-rounder', WK: 'Keeper' };

export function OS() {
  return <span className="os" title="Overseas">✈</span>;
}

export function Rupees({ lakh }: { lakh: number }) {
  return <>{formatLakh(lakh)}</>;
}

export function Board({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`board ${className}`}>{children}</div>;
}

export interface Ask {
  message: string;
  yes: string;
  onYes: () => void;
}

/** In-page confirmation. Browser confirm() is blocked in some embeds, so the game never relies on it. */
export function ConfirmDialog({ ask, onClose }: { ask: Ask | null; onClose: () => void }) {
  useEffect(() => {
    if (!ask) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ask, onClose]);
  if (!ask) return null;
  return (
    <div className="scrim" onClick={onClose}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-msg" onClick={(e) => e.stopPropagation()}>
        <p id="dialog-msg">{ask.message}</p>
        <div className="row wrap">
          <button
            type="button"
            className="btn btn-big"
            autoFocus
            onClick={() => {
              onClose();
              ask.onYes();
            }}
          >
            {ask.yes}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
