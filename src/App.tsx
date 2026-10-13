import { lazy, Suspense } from 'react';
import { useRoute } from './ui/router';
import { readJoinCode } from './online/net';
import { Play } from './ui/Play';
import { About, HowToPlay } from './ui/Pages';

const GuestRoom = lazy(() => import('./ui/online/GuestRoom').then((m) => ({ default: m.GuestRoom })));
const joinCode = readJoinCode();

export default function App() {
  const route = useRoute();
  const content =
    joinCode && route === 'play' ? (
      <Suspense fallback={<p className="status-line">Loading the room…</p>}>
        <GuestRoom code={joinCode} />
      </Suspense>
    ) : route === 'play' ? (
      <Play />
    ) : route === 'how' ? (
      <HowToPlay />
    ) : (
      <About />
    );
  return (
    <div className="site">
      <header className="top">
        <div>
          <a href="#play" className="wordmark">
            Auction Table
          </a>
          <span className="tagline">IPL 2026 · real prices · pick your XI</span>
        </div>
        <nav>
          <a href="#play" aria-current={route === 'play' ? 'page' : undefined}>
            Play
          </a>
          <a href="#how" aria-current={route === 'how' ? 'page' : undefined}>
            How to play
          </a>
          <a href="#about" aria-current={route === 'about' ? 'page' : undefined}>
            About
          </a>
        </nav>
      </header>
      <main>{content}</main>
      <footer className="foot">
        <span>made by a cricket nerd with too many spreadsheets · 2026</span>
        <span>Unofficial fan game. No logos, just colours.</span>
      </footer>
    </div>
  );
}
