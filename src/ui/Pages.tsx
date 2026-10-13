export function HowToPlay() {
  return (
    <article className="prose">
      <h1>How to play</h1>
      <p>
        You run an IPL franchise. Build a squad that can field a proper XI, don’t blow the purse on the first big name, and then watch
        your side play out a season. There are two ways to build it: the <b>real-price draft</b> (the default) and the <b>classic auction</b>.
      </p>

      <h2>The real-price draft</h2>
      <ul>
        <li>
          The pool is every player in an IPL 2026 squad, 250 of them. Each one costs exactly what his franchise pays him for 2026. KL Rahul
          costs ₹14 Cr (his 2025 auction price), Venkatesh Iyer ₹7 Cr (2026 auction), Virat Kohli ₹21 Cr (retention), Sanju Samson ₹18 Cr
          (his trade fee).
        </li>
        <li>
          Teams take turns picking one player each. The order is drawn at random and snakes: whoever picks last in round 1 picks first in
          round 2. When you pick a player, his price comes straight off your purse. There’s no bidding.
        </li>
        <li>
          The board shows who is on the clock, their purse and how much they can spend on this pick. You always keep enough back to fill
          your minimum squad with the cheapest players, so the game won’t let you strand yourself.
        </li>
        <li>
          Filter the player board by role or 2026 team, search by name, or sort by price, rating or best value. Tick “Only players I can
          take” to hide anyone you can’t afford or have no room for.
        </li>
        <li>
          <b>Skip my turn</b> passes without picking: you keep your money and the next team picks. <b>Auto-pick for me</b> lets the AI
          make your pick. <b>Finish my squad</b> stops you picking once you have your minimum squad.{' '}
          <b>Sim to the end</b> lets the AI finish the whole draft, your team included.
        </li>
        <li>AI teams pick on their own. Slow them down or speed them up with the AI speed setting, or pause them between your turns.</li>
      </ul>

      <h2>Setting up</h2>
      <ul>
        <li>
          Every team card has three buttons: <b>Out</b> (not in this auction), <b>AI</b> (the computer bids for it) and <b>You</b> (a human
          holds the paddle).
        </li>
        <li>
          Playing with friends on one phone? Mark several teams as <b>You</b> — each human team gets its own “Bid” button in the room.
        </li>
        <li>Squad size can be anything from 15 to 25 players (18 by default). The minimum squad can be set from 11 up to the squad size.</li>
        <li>Don’t fancy any of the ten? “Create your own” gives you an eleventh side with your own name, 2–4 letter code and colour.</li>
        <li>
          In the classic auction, <b>Real squads</b>: IPL teams keep their best 2026 players (squad size minus six, max overseas minus two), with a retention cost taken
          off their purse. Everyone else is in the pool. <b>Full auction</b>: all 610 players go under the hammer and every team starts empty.
        </li>
      </ul>

      <h2>Challenges and RTM (real-price draft)</h2>
      <ul>
        <li>
          With <b>Challenges and RTM</b> switched on, you can spend a turn to challenge a player already in another squad, instead of
          picking. He stays where he is for now.
        </li>
        <li>
          After the draft, every challenged player goes to a live auction. Bidding opens one step above what his team paid, and only his
          challengers can bid. When the hammer falls, his team can use an <b>RTM card</b> to match the top bid and keep him, paying the
          difference. If they let him go, they get back what they paid and the top bidder takes him.
        </li>
        <li>
          Each open challenge holds back a squad slot and the opening bid, so you can afford to bid when he comes up. A short top-up
          round after the auction lets anyone with room and money fill their squad.
        </li>
      </ul>

      <h2>The secret draft</h2>
      <ul>
        <li>
          Everyone builds a whole squad at the same time, in secret, at 2026 prices. Use ↑ and ↓ to rank your list. <b>Fill with AI
          picks</b> keeps your choices and fills the rest. Lock in when you’re happy. Playing on one phone? Each person gets a “pass the
          phone” screen so nobody peeks.
        </li>
        <li>
          On reveal, a player only one team chose joins that team at his 2026 price. A player two or more teams chose goes to a live RTM
          auction, opening at his 2026 price. The team that ranked him highest holds the RTM and can match the winning bid. If nobody
          else bids, that team signs him at his price.
        </li>
        <li>Lots between AI teams settle instantly; you only wait for the ones you’re in. Then a top-up round fills any gaps.</li>
        <li>RTM cards per team are a house rule: 0 to 6, or unlimited (3 by default).</li>
      </ul>

      <h2>Playing online with friends</h2>
      <ul>
        <li>
          On the setup screen, mark your own team as <b>You</b> (plus any teams your friends will play), then tap <b>Play online: get a
          link</b>. You get a six-letter room code and an invite link. Send it on WhatsApp or anywhere else.
        </li>
        <li>
          Friends open the link, type their name and tap <b>Take</b> on an open team. In the lobby you can switch any team between{' '}
          <b>Friend</b> and <b>AI</b>, or change your own team. When everyone is in, start the draft. Open seats nobody took are played by
          the AI.
        </li>
        <li>
          Everyone sees the same board live. Each person can only pick for their own team, on their own turn. Only the host can pause the
          AI, change its speed, sim or end the draft.
        </li>
        <li>
          The room runs in the host’s browser, so the host must keep that tab open (the game keeps the screen awake where it can). If a
          friend’s phone drops off, they just reopen the link and are back in their seat. If they’re away on their turn for 20 seconds,
          the AI picks for them.
        </li>
        <li>
          Connections go phone-to-phone through the free PeerJS service, with relay servers as a fallback. No account needed. On a few
          very strict networks (some office Wi-Fi) a friend may not be able to connect; switching to mobile data usually fixes it.
        </li>
      </ul>

      <h2>The classic auction</h2>
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
        <li>The <b>Up next</b> tab shows every set in running order (with lot numbers and how many sold) and the players still to come, filterable by role.</li>
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

      <h2>The season</h2>
      <ul>
        <li>
          Each team’s best legal XI is picked for you: one keeper, at least five bowling options, no more than four overseas. Best batters
          open, and the bowling options share the 20 overs (four each at most).
        </li>
        <li>
          Every match is played ball by ball, so there are real scorecards: runs, balls, fours, sixes, how each batter got out, bowling
          figures, extras, fall of wickets and a runs-per-over chart. Chasing sides speed up when the asking rate climbs.
        </li>
        <li>
          The season follows the IPL format: with 10 teams everyone plays 14 league games, then Qualifier 1 (1st v 2nd, winner to the
          final), the Eliminator (3rd v 4th), Qualifier 2 and the Final. Smaller leagues play everyone twice.
        </li>
        <li>
          <b>Player stats</b> has the Orange Cap (most runs) and Purple Cap (most wickets), plus top-10 tables for most sixes, most fours,
          highest scores, best bowling figures, strike rate, economy, fifties, catches, dot balls and Player of the Match awards.
          Playoffs count, as in the IPL.
        </li>
        <li>
          <b>Lineups</b> shows every team’s XI in batting order with what each player cost, plus the bench. <b>Replay season</b> plays it
          all again with the same squads.
        </li>
      </ul>

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
        Auction Table is a small, unofficial IPL squad-building game. Draft today’s IPL players at their real 2026 prices, or run a
        classic live auction. You can play alone against AI franchises, or pass one phone round the room with your friends. It runs
        entirely in your browser and needs no account. The only thing it stores is your current game, saved in this browser so a
        refresh doesn’t lose it.
      </p>
      <p>
        2026 prices come from public reporting of the 2025 retentions, the 2025 and 2026 auctions, 2025 replacement signings and the
        trades before the 2026 season. If one looks wrong, edit <code>price2026Lakh</code> in <code>players.json</code>.
      </p>
      <p>
        Player ratings are editorial T20 estimates and nothing official; argue about them freely. Teams appear only as their names and
        primary colours. There are no logos, and the game isn’t affiliated with the IPL, the BCCI or any franchise.
      </p>
      <p>
        Built with Vite, React and TypeScript, plus three Google Fonts. The gavel is synthesised with Web Audio.
      </p>

      <h2>Changelog</h2>
      <ul className="changelog">
        <li>
          <b>v2.3</b>: ball-by-ball matches with full scorecards, the IPL playoff format, Orange and Purple Caps, top-10 stat tables and team
          lineups.
        </li>
        <li>
          <b>v2.2</b>: the secret draft, challenges in the draft, and live RTM auctions.
        </li>
        <li>
          <b>v2.1</b>: online rooms with a shareable link, and Skip my turn.
        </li>
        <li>
          <b>v2.0</b>: the real-price draft. Pick current IPL players at their 2026 prices, in snake order. New green-baize look.
        </li>
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
