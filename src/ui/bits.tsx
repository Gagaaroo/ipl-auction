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
      <defs>
        <radialGradient id="ballShade" cx="35%" cy="30%" r="70%">
          <stop offset="0" stopColor="#e8504f" />
          <stop offset="0.45" stopColor="#cf2a2e" />
          <stop offset="1" stopColor="#8f1619" />
        </radialGradient>
      </defs>
      <circle cx="22" cy="22" r="21" fill="url(#ballShade)" />
      <path d="M14 4 C 19 14, 19 30, 14 40" fill="none" stroke="rgba(255,240,230,0.6)" strokeWidth="1.3" strokeDasharray="1.6 2.2" />
      <path d="M30 4 C 25 14, 25 30, 30 40" fill="none" stroke="rgba(255,240,230,0.6)" strokeWidth="1.3" strokeDasharray="1.6 2.2" />
      <text x="22" y="28" textAnchor="middle" className="ball-num">
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
