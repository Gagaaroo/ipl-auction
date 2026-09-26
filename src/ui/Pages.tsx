export function HowToPlay() {
  return (
    <article className="prose">
      <h1>How to play</h1>
      <p>
        You run an IPL franchise at the auction table. Build a squad that can field a proper XI, don’t blow the purse on the first shiny
        name, and then watch your side play out a season.
      </p>

      <h2>Setting up</h2>
      <ul>
        <li>
          Every team card has three buttons: <b>Out</b> (not in this auction), <b>AI</b> (the computer bids for it) and <b>You</b> (a human
          holds the paddle).
        </li>
        <li>
          Playing with friends on one phone? Mark several teams as <b>You</b> — each human team gets its own “Bid” button in the room.
        </li>
        <li>Don’t fancy any of the ten? “Create your own” gives you an eleventh side with your own name, 2–4 letter code and colour.</li>
        <li>
          <b>Real squads</b>: IPL teams keep their best 2026 players (squad size minus six, max overseas minus two), with a retention cost taken
          off their purse. Everyone else is in the pool. <b>Full auction</b>: all 610 players go under the hammer and every team starts empty.
        </li>
      </ul>

      <h2>In the room</h2>
      <ul>
        <li>Players come up in sets: Marquee first, then Batters, All-rounders, Wicketkeepers and Bowlers, top tier first.</li>
        <li>
          The first bid is the base price. After that the price climbs in fixed steps: +₹10 L below ₹1 Cr, +₹20 L to ₹2 Cr, +₹25 L to ₹5 Cr,
          +₹50 L to ₹10 Cr, then +₹1 Cr.
        </li>
        <li>
          Every bid puts the clock back up to its full length (and never less than 4 seconds). When it runs low you’ll hear “Going once…
          going twice…” and then the gavel.
        </li>
        <li>
          You can’t bid if it would leave you unable to fill your minimum squad at ₹20 L a head, if your squad is full, or if you’ve hit the
          overseas cap.
        </li>
        <li>Anyone who goes unsold comes back once, at the end, in an accelerated round at half their base price.</li>
        <li>
          Keys: <kbd>space</kbd> bids for the first human team, <kbd>2</kbd>–<kbd>9</kbd> for the others.
        </li>
        <li>
          <b>Bring the hammer down</b> hurries the clock to “going twice” — the AI can still sneak in a late bid. <b>Skip set</b> lets the AI
          settle the rest of the current set instantly if you’re not interested. <b>Sim to the end</b> lets the AI finish the whole auction, bidding for your team too.
        </li>
        <li>Refresh by accident? The auction is saved in your browser and picks up where you left it, paused.</li>
      </ul>

      <h2>The AI teams</h2>
      <p>
        Each AI side prices a player from his rating, how badly it needs that role (no keeper yet? it will pay), and how healthy its purse is.
        Every team has its own appetite for risk, and its own slightly different opinion of each player, so they won’t all behave the same.
        They also keep money back to finish their squads, and they tend to pounce late when the clock is low.
      </p>

      <h2>Results</h2>
      <p>
        Each team’s best legal XI is picked for you: one keeper, at least five bowling options, no more than four overseas. It is rated on
        batting and bowling, and then a league plus a final is simulated, with a points table and net run rate. Hit <b>Replay season</b> to
        roll the dice again with the same squads.
      </p>

      <h2 id="csv">Importing players from CSV</h2>
      <p>On the setup screen, “Import CSV…” reads a file with a header row. Columns (in any order):</p>
      <pre>
{`name,role,country,overseas,bat,bowl,overall,basePriceLakh,team2026
Jasprit Bumrah,BOWL,IND,false,12,97,97,200,MI
"Smith, Steve",BAT,AUS,true,76,10,76,100,`}
      </pre>
      <p>
        Only <code>name</code>, <code>role</code> (BAT, BOWL, AR or WK), <code>bat</code> and <code>bowl</code> are required. Missing{' '}
        <code>overseas</code> means “not from IND”; missing <code>overall</code> is worked out from bat and bowl; missing base price comes from
        a rating slab. Choose “add / update” to merge with the current list (same name replaces) or “replace everyone”.
      </p>
    </article>
  );
}

export function About() {
  return (
    <article className="prose">
      <h1>About</h1>
      <p>
        The Auction Table is a small, unofficial IPL-style auction game. You can play it alone against nine AI franchises, or pass one
        phone round the room with your friends. It runs entirely in your browser and needs no account. The only thing it stores is
        your current auction, saved in this browser so a refresh doesn’t lose it.
      </p>
      <p>
        Player ratings are editorial T20 estimates and nothing official; argue about them freely. Teams appear only as their names and
        primary colours. There are no logos, and the game isn’t affiliated with the IPL, the BCCI or any franchise.
      </p>
      <p>
        Built with Vite, React and TypeScript, plus two Google Fonts. The gavel is synthesised with Web Audio.
      </p>

      <h2>Changelog</h2>
      <ul className="changelog">
        <li>
          <b>v1.0</b> — first public version: real squads or full auction, AI bidders with their own personalities, pass-and-play, best XIs,
          season sim with NRR, awards.
        </li>
        <li>
          <b>v0.9</b> — CSV import, accelerated round for unsold players.
        </li>
        <li>
          <b>v0.1</b> — a spreadsheet and too many arguments about who’s worth ₹20 Cr.
        </li>
      </ul>
    </article>
  );
}
