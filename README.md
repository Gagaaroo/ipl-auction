# The Auction Table

A small IPL-style player auction game. Play it solo against AI franchises, or pass one phone round the room and give each friend a team. The squads you build then play out a simulated season.

It's Vite, React and TypeScript, with no backend. Everything runs in the browser, and the in-progress auction is saved to `localStorage`.

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
    auction.ts        pure state transitions: bid, hammer, accelerated round
    ai.ts             AI valuation and bid timing, instant simulation
    xi.ts             best legal XI
    season.ts         league + final, points table with NRR, awards
    engine.test.ts    Vitest tests
  ui/                 React screens (Setup, AuctionRoom, Results, pages)
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
  "history": [{ "year": 2025, "result": "sold", "team": "GT", "priceLakh": 1575 }]
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
| `history`       | shown on the player card. Entries are `{year, result:"sold", team, priceLakh}` or `{year, result:"unsold", basePriceLakh}` |

The ratings are editorial estimates, so change whatever you disagree with. Save the file and the dev server reloads. Players rated **85+** open the auction as the Marquee set. Everyone else is grouped by role into tiers (76+, 68–75, 60–67, under 60).

**Real squads mode:** each IPL team in the auction keeps its best `squadSize − 6` players with a matching `team2026`, holding back two overseas slots. Their retention cost comes off the purse. It's based on rating and capped at 60% of the purse. Released and unattached players go into the pool.

## CSV import

On the setup screen, **Import CSV…** can either add to the current pool (a matching name replaces that player) or replace it entirely. An imported list is kept in `localStorage` until you click "Go back to players.json".

The first row must be a header, and columns can come in any order:

```csv
name,role,country,overseas,bat,bowl,overall,basePriceLakh,team2026
Jasprit Bumrah,BOWL,IND,false,12,97,97,200,MI
"Smith, Steve",BAT,AUS,true,76,10,76,100,
Local Hero,AR,IND,,55,58,,,
```

- **Required:** `name`, `role` (BAT/BOWL/AR/WK), `bat`, `bowl`
- `country` defaults to `IND`
- `overseas` accepts `true/false/yes/no/1/0`. If blank, anyone not from `IND` counts as overseas
- `overall` defaults to the higher of bat/bowl (all-rounders get a small bonus)
- `basePriceLakh` defaults to a slab from `overall`: 200 / 150 / 100 / 75 / 50 / 30
- `team2026` is optional (a franchise code, used by Real squads mode)
- Wrap a value in double quotes if it contains a comma. Bad rows are skipped and counted

## House rules (defaults)

- Purse: ₹100 Cr (choose 60/80/100/120). Squad: 18 (pick 15–25). Minimum squad: 11 (up to the squad size). Overseas cap: 8 (max 4 in an XI)
- Bid clock: 4 / 6 / 9 s. Every bid resets it to the full clock, which is never under 4 s
- Increments: +₹10 L below ₹1 Cr, +₹20 L to ₹2 Cr, +₹25 L to ₹5 Cr, +₹50 L to ₹10 Cr, then +₹1 Cr
- A team can't bid if that would leave it unable to fill the minimum squad at ₹20 L a slot
- Unsold players return once, at the end, at half their base price

## Deploying

`vercel.json` sets up a static Vite build (`npm run build` → `dist/`). There are no environment variables or server.

## Credits

Made by a cricket nerd with too many spreadsheets. To change that line, edit the footer in `src/App.tsx`. This is an unofficial fan game, not affiliated with the IPL, the BCCI or any franchise, and it uses team names and colours only, with no logos.
