import { useCallback, useState } from 'react';
import type { AuctionState } from '../engine/types';
import { createAuction } from '../engine/auction';
import { createDraft, type DraftState } from '../engine/draft';
import { auctionSource, draftSource } from '../engine/season';
import { AuctionRoom } from './AuctionRoom';
import { DraftRoom } from './DraftRoom';
import { Results } from './Results';
import { Setup, type StartConfig } from './Setup';
import { loadAuction, loadDraft, saveAuction, saveDraft, type SavedAuction, type SavedDraft } from './storage';

const newSeed = () => (Math.random() * 2 ** 32) >>> 0;

export function Play() {
  const [draft, setDraft] = useState<SavedDraft | null>(loadDraft);
  const [saved, setSaved] = useState<SavedAuction | null>(() => (loadDraft() ? null : loadAuction()));
  const [resumed] = useState(() => saved !== null && !saved.auction.finished);
  const [roomKey, setRoomKey] = useState(0);

  const update = useCallback((s: SavedAuction | null) => {
    setSaved(s);
    saveAuction(s);
  }, []);

  const updateDraft = useCallback((s: SavedDraft | null) => {
    setDraft(s);
    saveDraft(s);
  }, []);

  const start = (cfg: StartConfig) => {
    if (cfg.rules.game === 'draft') {
      update(null);
      updateDraft({ draft: createDraft({ ...cfg, seed: newSeed() }), seasonSeed: newSeed() });
    } else {
      updateDraft(null);
      const auction = createAuction({ ...cfg, seed: newSeed() });
      update({ auction, remainingMs: 0, seasonSeed: newSeed() });
    }
    setRoomKey((k) => k + 1);
    window.scrollTo(0, 0);
  };

  // Called by the auction room many times a second: persist without re-rendering the page.
  const onSave = useCallback((auction: AuctionState, remainingMs: number) => {
    saveAuction({ auction, remainingMs, seasonSeed: loadAuction()?.seasonSeed ?? newSeed() });
  }, []);

  const onDone = useCallback((auction: AuctionState) => {
    const seasonSeed = loadAuction()?.seasonSeed ?? newSeed();
    update({ auction: { ...auction, finished: true, current: null }, remainingMs: 0, seasonSeed });
    window.scrollTo(0, 0);
  }, [update]);

  const onDraftChange = useCallback(
    (d: DraftState) => {
      const seasonSeed = loadDraft()?.seasonSeed ?? newSeed();
      if (d.finished) {
        updateDraft({ draft: d, seasonSeed });
        window.scrollTo(0, 0);
      } else saveDraft({ draft: d, seasonSeed });
    },
    [updateDraft],
  );

  if (draft) {
    if (draft.draft.finished)
      return (
        <Results
          state={draftSource(draft.draft)}
          seasonSeed={draft.seasonSeed}
          onReplay={() => updateDraft({ ...draft, seasonSeed: newSeed() })}
          onNew={() => updateDraft(null)}
        />
      );
    return <DraftRoom key={roomKey} initial={draft.draft} onChange={onDraftChange} />;
  }

  if (!saved) return <Setup onStart={start} />;

  if (saved.auction.finished)
    return (
      <Results
        state={auctionSource(saved.auction)}
        seasonSeed={saved.seasonSeed}
        onReplay={() => update({ ...saved, seasonSeed: newSeed() })}
        onNew={() => update(null)}
      />
    );

  return (
    <AuctionRoom
      key={roomKey}
      initial={saved.auction}
      initialRemainingMs={saved.remainingMs}
      resumed={resumed && roomKey === 0}
      onSave={onSave}
      onDone={onDone}
    />
  );
}
