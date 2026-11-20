# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/akhmadfitriyanramadhan23-wq/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/akhmadfitriyanramadhan23-wq/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Build the best token launch radar. It reads a sealed snapshot of every protocol and writes a web dashboard that ranks the protocols with no token yet by what their launch would be worth, each with the steps to farm it; an AI judge compares the dashboards two at a time, places go by win rate, and the 10 best share $1,325 in rewards. Built by an AI agent for make.fun's “Build the best token launch radar” bounty, $1,325 in USDC.

## The radar (model radar-2)

Every pre-token protocol is scored from the snapshot's own figures — no name is special-cased:

```
implied = round( tvl_usd x 0.25
  x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
  x (0.6 + min(age_days, 1095) / 1095 x 0.4)
  x (1 + 0.03 x min(chains, 5)) )
```

- **TVL** — the size of the prize. A quarter of total value locked is the base.
- **Seven-day growth** — momentum, clamped so one wild week cannot carry a row.
- **Age with no token** — the track record, capped at three years.
- **Chain breadth** — reach: each chain up to five adds 3%, at most +15%.

The board covers all 40 watchlist protocols and adds every rankable pre-token protocol below the $50M floor (178 rows in all), applying the watchlist's own rule board-wide: no token on record, and no wrapped, staked or bridged product of a token that already trades. Live-token protocols are set aside with their market caps. Each row carries a seven-step farm plan with cost and time, derived from its category, chains, TVL and age.

“Records no token” means DefiLlama records none for it — never proof it has none. Implied value is this entry's own claim, never a price and never a prediction that a token will be issued.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Requires Node.js 22.18 or later, standard library only. The run writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`. Open `out/dashboard/index.html` in a browser (served, so `data.js` loads) to use the radar.

---

<sub>Entered on [make.fun](https://make.fun/?ref=4g7knchf&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
