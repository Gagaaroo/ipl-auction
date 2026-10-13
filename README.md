# Auction Table

A small IPL squad-building game with three modes:

- **Real-price draft** (default): teams take turns picking current IPL players, and each pick costs that player's real 2026 price. Pick KL Rahul and ₹14 Cr comes off your purse; Venkatesh Iyer costs ₹7 Cr. With **challenges** on, you can spend a turn challenging another team's pick; challenged players are auctioned after the draft and their team can use an **RTM** card to match.
- **Secret draft**: everyone builds a squad at once, in secret. Players wanted by two or more teams go to a live RTM auction; whoever ranked him highest can match.
- **Classic auction**: live bidding against the clock, from base prices, with 610 players from the last three auctions.

Play solo against AI franchises, pass one phone round the room, or **play online**: create a room, send the link, and friends join from their own phones. You can also create an 11th team of your own. The squads then play out a simulated season.

It's Vite, React and TypeScript, with no backend. Everything runs in the browser, and the game in progress is saved to `localStorage`.

## Run it locally

```sh
npm install
npm run dev       # http://localhost:5173
npm test          # Vitest: engine, AI, XI picker, season sim
npm run build     # type-check + production build into dist/
npm run preview   # serve the production build
```

Node 20+ recommended.

## Project layout

```
src/
  data/players.json   the player pool — edit freely
  data/teams.ts       franchise names, short codes, primary colours
  engine/             plain TS game logic, no React
    money.ts          bid increments, ₹ formatting
    pool.ts           sets & tiers, real-squad retentions, CSV parser
    draft.ts          the real-price draft: snake order, picks, AI picking
    auction.ts        pure state transitions: bid, hammer, accelerated round
    ai.ts             AI valuation and bid timing, instant simulation
    xi.ts             best legal XI
    season.ts         league + final, points table with NRR, awards
    engine.test.ts    Vitest tests
  online/net.ts       online rooms: room codes, invite links, message types, PeerJS options
  ui/                 React screens (Setup, DraftRoom, AuctionRoom, Results, pages)
  ui/online/          HostRoom (lobby + runs the draft) and GuestRoom (join link)
```

## Editing `players.json`

`src/data/players.json` has a `meta` block and a `players` array. Each player looks like this:

```json
{
  "name": "Jasprit Bumrah",
  "role": "BOWL",
  "country": "IND",
  "overseas": false,
  "bat": 12,
  "bowl": 97,
  "overall": 97,
  "basePriceLakh": 200,
  "team2026": "MI",
  "history": [],
  "price2026Lakh": 1800,
  "priceHow": "retained"
}
```

| field           | meaning                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------- |
| `role`          | `BAT`, `BOWL`, `AR` (all-rounder) or `WK`                                                   |
| `overseas`      | counts against the overseas cap and the 4-per-XI limit                                      |
| `bat`, `bowl`   | 1–99 T20 ratings. These drive XI selection and the season sim                               |
| `overall`       | 1–99. This drives AI valuations, sets/tiers and the ball badge                              |
| `basePriceLakh` | opening price in lakh (100 L = ₹1 Cr)                                                       |
| `team2026`      | franchise code or `null`. In **Real squads** mode, that team starts with the player         |
| `price2026Lakh` | the player's IPL 2026 price in lakh: what he costs in the draft. `null` for players not in a 2026 squad, who are left out of the draft |
| `priceHow`      | where that price comes from: `retained`, `2025 auction`, `2025 replacement`, `traded` or `2026 auction` |
| `history`       | shown on the player card. Entries are `{year, result:"sold", team, priceLakh}` or `{year, result:"unsold", basePriceLakh}` |

The ratings are editorial estimates, so change whatever you disagree with. Save the file and the dev server reloads. Players rated **85+** open the auction as the Marquee set. Everyone else is grouped by role into tiers (76+, 68–75, 60–67, under 60).

**Real squads mode:** each IPL team in the auction keeps its best `squadSize − 6` players with a matching `team2026`, holding back two overseas slots. Their retention cost comes off the purse. It's based on rating and capped at 60% of the purse. Released and unattached players go into the pool.

**2026 prices** come from public reporting of the 2025 retentions, the 2025 mega auction (and 2025 replacement signings), the trades before the 2026 season, and the 2026 auction. Each franchise's 25 players add up to roughly its ₹120 Cr purse. If a price looks wrong, change `price2026Lakh`.

## CSV import

On the setup screen, **Import CSV…** can either add to the current pool (a matching name replaces that player) or replace it entirely. An imported list is kept in `localStorage` until you click "Go back to players.json".

The first row must be a header, and columns can come in any order:

```csv
name,role,country,overseas,bat,bowl,overall,basePriceLakh,team2026,price2026Lakh
Jasprit Bumrah,BOWL,IND,false,12,97,97,200,MI,1800
"Smith, Steve",BAT,AUS,true,76,10,76,100,,
Local Hero,AR,IND,,55,58,,,,
```

- **Required:** `name`, `role` (BAT/BOWL/AR/WK), `bat`, `bowl`
- `country` defaults to `IND`
- `overseas` accepts `true/false/yes/no/1/0`. If blank, anyone not from `IND` counts as overseas
- `overall` defaults to the higher of bat/bowl (all-rounders get a small bonus)
- `basePriceLakh` defaults to a slab from `overall`: 200 / 150 / 100 / 75 / 50 / 30
- `team2026` is optional (a franchise code, used by Real squads mode)
- `price2026Lakh` is optional. In the draft, only players with a price are in the pool; if nobody in the list has one, everyone is in and costs his base price
- Wrap a value in double quotes if it contains a comma. Bad rows are skipped and counted

## The real-price draft

- The picking order is drawn at random and snakes (1→10, then 10→1, …).
- A pick costs the player's `price2026Lakh`, taken straight off the purse. No bidding.
- A team can't make a pick that would leave it unable to fill its minimum squad at the cheapest price on the board (₹30 L).
- **Skip my turn** passes without picking (no money spent).
- A team stops when its squad is full, when nothing on the board is affordable, or when a human taps **Finish my squad** (after reaching the minimum squad).
- AI teams weigh rating, squad needs (keepers, bowlers…), overseas slots and what they can still afford, and they will stretch for genuine stars.

## Challenges, secret draft and RTM

- Every move goes through `applyAction()` in `src/engine/draft.ts`. A game moves through the phases `secret` → `picking` → `auction` → (top-up) `picking` → `done`.
- **Challenge**: on your turn, `challenge` a player in another squad. It holds back a slot and the opening bid (paid + one increment). After picking, each challenged player is a lot: only challengers bid, and the owner can match with an RTM card (paying the difference), or let him go and get a refund.
- **Secret**: `list-add` / `list-remove` / `list-move` / `list-auto` / `lock`. Once everyone locks, uncontested players sign at their 2026 price. Contested ones become lots that open at the 2026 price, and the highest-ranking chooser holds the RTM.
- The auction clock lives on the machine running the game: `hammer` carries the clock's `seq`, so a stale hammer is ignored. Lots between AI teams settle instantly.
- RTM cards: house rule `rtmCards` (0–6, 99 = unlimited, default 3). Online, guests only receive their own secret list (`redactFor`).

## Online rooms

The host's browser runs the draft. Friends connect straight to it over WebRTC, using the free [PeerJS](https://peerjs.com) cloud to find each other, plus its TURN relays when a direct connection isn't possible. There's no backend and no account.

- **Play online: get a link** creates a six-letter room. The host registers with PeerJS under `auction-table-v2-<code>`, and the invite link is `https://<site>/?join=<CODE>`.
- Guests send `hello`, `claim` and `action` messages. The host checks every action (only your own team, only on your turn), applies it, and broadcasts the new state. Guests get one full snapshot, then slim updates without the player list. See `src/online/net.ts`.
- If a guest drops, they reopen the link and are recognised by a client id kept in their browser. If they're away on their turn for 20 s, the AI picks for them.
- To test locally against your own PeerJS server, build with `VITE_PEER_HOST`, `VITE_PEER_PORT`, `VITE_PEER_SECURE=false` and optionally `VITE_PEER_ICE=none`.

## House rules (defaults)

- Purse: ₹120 Cr (choose 60/80/100/120). Squad: 18 (pick 15–25). Minimum squad: 11 (up to the squad size). Overseas cap: 8 (max 4 in an XI)
- Bid clock: 4 / 6 / 9 s. Every bid resets it to the full clock, which is never under 4 s
- Increments: +₹10 L below ₹1 Cr, +₹20 L to ₹2 Cr, +₹25 L to ₹5 Cr, +₹50 L to ₹10 Cr, then +₹1 Cr
- A team can't bid if that would leave it unable to fill the minimum squad at ₹20 L a slot
- Unsold players return once, at the end, at half their base price

## Deploying

`vercel.json` sets up a static Vite build (`npm run build` → `dist/`). There are no environment variables or server.

## Credits

Made by a cricket nerd with too many spreadsheets. To change that line, edit the footer in `src/App.tsx`. This is an unofficial fan game, not affiliated with the IPL, the BCCI or any franchise, and it uses team names and colours only, with no logos.
