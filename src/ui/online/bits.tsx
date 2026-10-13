import { useState } from 'react';
import { joinLink } from '../../online/net';

/** The invite link, with Copy and (on phones) the system Share sheet. */
export function ShareLink({ code }: { code: string }) {
  const link = joinLink(code);
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  return (
    <div className="share-box">
      <input id="invite-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
      <button
        type="button"
        className="btn"
        onClick={() =>
          navigator.clipboard
            ?.writeText(link)
            .then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            })
            .catch(() => (document.getElementById('invite-link') as HTMLInputElement | null)?.select())
        }
      >
        {copied ? 'Copied' : 'Copy link'}
      </button>
      {canShare && (
        <button
          type="button"
          className="btn"
          onClick={() => navigator.share({ title: 'Auction Table', text: `Join my IPL draft. Room ${code}`, url: link }).catch(() => {})}
        >
          Share…
        </button>
      )}
    </div>
  );
}
