import { useCallback, useState } from 'react';
import type { AuctionState } from '../engine/types';
import { createAuction } from '../engine/auction';
import { AuctionRoom } from './AuctionRoom';
import { Results } from './Results';
import { Setup, type StartConfig } from './Setup';
import { loadAuction, saveAuction, type SavedAuction } from './storage';

const newSeed = () => (Math.random() * 2 ** 32) >>> 0;

export function Play() {
  const [saved, setSaved] = useState<SavedAuction | null>(loadAuction);
  const [resumed] = useState(() => saved !== null && !saved.auction.finished);
  const [roomKey, setRoomKey] = useState(0);

  const update = useCallback((s: SavedAuction | null) => {
    setSaved(s);
    saveAuction(s);
  }, []);

  const start = (cfg: StartConfig) => {
    const auction = createAuction({ ...cfg, seed: newSeed() });
    update({ auction, remainingMs: 0, seasonSeed: newSeed() });
    setRoomKey((k) => k + 1);
    window.scrollTo(0, 0);
  };

  // Called by the room many times a second: persist without re-rendering the page.
  const onSave = useCallback((auction: AuctionState, remainingMs: number) => {
    saveAuction({ auction, remainingMs, seasonSeed: loadAuction()?.seasonSeed ?? newSeed() });
  }, []);

  const onDone = useCallback((auction: AuctionState) => {
    const seasonSeed = loadAuction()?.seasonSeed ?? newSeed();
    update({ auction: { ...auction, finished: true, current: null }, remainingMs: 0, seasonSeed });
    window.scrollTo(0, 0);
  }, [update]);

  if (!saved) return <Setup onStart={start} />;

  if (saved.auction.finished)
    return (
      <Results
        state={saved.auction}
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
