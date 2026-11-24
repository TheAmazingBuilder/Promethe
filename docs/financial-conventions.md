# Financial conventions

The single source of truth for how Promethe computes and labels money,
R multiples, FX conversions, drawdown, rounding, and position sizing.
Every rule below is implemented in `src/lib/trading/calculate.ts`
(the pure calculation engine), `src/lib/tools/fx.ts`,
`src/lib/tools/multi-tp.ts`, `src/lib/tools/exposure.ts`,
`src/lib/analytics/engine.ts`, and `src/server/trades.ts`
(`computeDerived`, the server-side recomputation of stored trades).
If the UI or a new feature disagrees with this document, the document
wins — fix the code, not the document. (Verification report MD §3.)

## 1. Net vs gross P&L

- `netPnl = grossPnl − (commission + swap + fees)`.
- Commission, swap, and fees are **signed costs in the account
  currency**: positive = cost, negative = credit.
- `grossPnl` is **always the price-derived calculated gross**
  (entry/exit, lots, contract size, FX conversion) — even on
  `MANUAL` / `BROKER` lines, where `netPnl` is the manual/broker
  value entered by the user (or their broker) instead of the
  calculated one.
- There is **no `manualNetPnl` column**: for a `MANUAL` / `BROKER`
  trade the stored `netPnl` **is** the manual/broker value. A
  `MANUAL` trade therefore always requires its manual value at
  create, on switch to `MANUAL`, and on close
  (`MANUAL_PNL_REQUIRED`); the value is carried through edits and
  closes instead of being re-derived.
- For `MANUAL` / `BROKER` lines, **`gross − net` is NOT the costs**
  and must never be shown as costs. The stored
  commission/swap/fees are the user-entered cost fields and are not
  reconciled against the manual net. (A manual net can even exceed
  the calculated gross — e.g. a broker credit — which makes
  `gross − net` negative.)
- In the multi-TP tool, each tier's net P&L is its gross minus its
  **pro-rata share of the total costs** (shared by allocation).
  A P&L shown without costs must be labelled **"P&L (gross)"**,
  never bare "P&L".

## 2. R conventions

- The bare term **"R multiple"** — stored `Trade.rMultiple`,
  `previewTrade().rMultiple`, and `realizedRR` — is **net-based**:
  `rMultiple = netPnl / initial risk`, where `netPnl` is the final
  net P&L (the manual value when `pnlSource` is `MANUAL` or
  `BROKER`, otherwise gross − costs) and the initial risk is the
  entry-vs-stop distance in account currency
  (`|entry − SL| × lots × contractSize × conversion rate`).
- `realizedRR` **is** the net R: `computeDerived` stores the same
  value in both fields (`realizedRR == rMultiple`).
- The price-only value (`grossPnl / initial risk`, before costs)
  is kept separately as **`grossRMultiple`** and must always be
  labelled **"R multiple (gross)"** — never bare "R multiple".
  The P&L simulator shows both, with distinct labels:
  "R multiple (net)" and "R multiple (gross)".
- `rMultiple` / `realizedRR` are **null when the risk is 0 or
  unknown** — never divide by zero, never present a guessed R.
  That covers: no stop loss, SL == entry, SL on the wrong side,
  and a cross-currency trade whose quote→account rate cannot be
  resolved (account-currency risk is then unknown).
- **Planned R:R** (`plannedRR`) is directional and price-based:
  `|TP − entry| / |entry − SL|`. A take-profit on the wrong side
  of the entry, a TP equal to the entry, a missing stop, or a
  stop on the wrong side all give `plannedRR = null` — never a
  positive ratio from `abs()`. The client (`calcPlannedRR`) and
  the server (`computeDerived`) use the same function, so the same
  inputs give the same `plannedRR` (stored rounded to 6 decimal
  places). A wrong-side TP/SL is rejected at the API with
  `422 VALIDATION` (`tradeLevelIssues`: `TP_WRONG_SIDE`,
  `TP_EQUALS_ENTRY`, `SL_WRONG_SIDE`, `SL_EQUALS_ENTRY`) and is
  never stored.
- Result classification is R-aware and net-based:
  `WIN` / `LOSS` / `BREAKEVEN`, where breakeven is
  `|R| ≤ 0.1` or `netPnl == 0` (`classifyResult`, default
  threshold `0.1R`).

## 3. FX policy

- **Resolution order** (`resolveConversionRateDetailed`,
  `resolveFxRate`): an explicitly provided manual rate always
  wins; otherwise the stored `FxRate` table is resolved — direct
  rate, or its inverse, or triangulation through one intermediate
  currency (USD first, then the other majors). A triangulated
  rate reports the **oldest leg's date** as its freshness date,
  and the legs used are returned as the `path`
  (e.g. `EUR->USD->XAU`) so the UI can show how the rate was
  derived.
- **Missing rate blocks sizing, estimates P&L.**
  - Position sizing: when quote ≠ account currency and no rate
    can be resolved, sizing is rejected
    (`MISSING_CONVERSION_RATE`). A missing rate is never silently
    treated as 1:1.
  - P&L (`calcPnL`): `isEstimate` is true **only** when quote ≠
    account currency **and** no conversion rate could be resolved
    (manual or stored) — the amounts are then shown unconverted,
    i.e. estimated. A valid applied rate, manual or stored, makes
    the conversion exact given that rate, so `isEstimate` is
    false.
  - Position sizing (`calcPositionSize`) deliberately differs:
    its `isEstimate` stays true whenever an FX conversion was
    applied, because a sized position depends on the rate holding
    until execution.
- **Inverted pair:** a stored pair recorded in either orientation
  is corrected by inversion (`resolveFxRate` / the sizing path).
  A manual rate typed as a currency pair is corrected the same
  way when its orientation is known (account→quote is inverted
  to 1/rate); when the pair names neither direction the sizing
  is rejected (`INVALID_CONVERSION_RATE_PAIR`). A bare manual
  rate with no pair keeps its documented contract: it **is** the
  quote→account rate.
- **Stale rates** (`FX_RATE_STALE_AFTER_DAYS = 7`,
  `isFxRateStale` in `src/lib/tools/fx.ts`): a stored rate is
  stale when it is **older than 7 days** — and the helper also
  flags a rate with **no (or invalid) date** as stale, since its
  freshness cannot be checked. Stale is a **flag, never a block**:
  the rate is still applied, and the UI warns (the currency
  converter shows the stale warning with the rate date, or the
  "undated" variant when the rate carries no date).
  - A **manual rate is never "stale"** in the sizing path: it
    was just typed, so `rateStale` is false — but it is
    **undated** (`rateSource = MANUAL`, `rateDate = null`), which
    the UI labels as such ("manual", "undated"), never as fresh.
  - A stored rate shows its `FxRate.rateDate` and its source
    (`MANUAL` | `CSV`).
- **Exposure:** when an FX conversion is unavailable, notionals
  **and** open risk are **nulled** — never estimated at 1:1.
  Aggregates that mix in an unknown leg are null too (never a
  partial sum presented as a total).

## 4. Drawdown — P&L-curve only

- Every "drawdown" in the app is a **cumulative trade-P&L
  drawdown**, labelled **"Max P&L drawdown"** (and
  "Current P&L drawdown", "Max P&L drawdown (%)"), and the curve
  is the **"Cumulative P&L curve"**. Never "equity drawdown" or
  "equity curve" — except for real prop-firm limits, which keep
  their plain "Max drawdown" label because they are a different
  thing (a rule limit, not a computed series).
- Definition (`computeEquityCurve`, `computeTradeStats` in
  `src/lib/analytics/engine.ts`): from **closed trades only**,
  in exit-time order, `cumulative P&L` is the running sum of
  `netPnl`; the curve is `initialBalance + cumulative P&L`;
  drawdown at each point is `peak − current`, and "Max P&L
  drawdown" is the largest peak-to-trough of that cumulative
  P&L. `maxDrawdownPercent` is the largest drawdown as a % of
  its own peak, tracked independently of the largest cash
  drawdown, and stays **null until cumulative P&L has made a
  positive peak** (with `initialBalance = 0` and an all-losing
  series there is no meaningful percentage).
- **Deposits, withdrawals, bonuses, and adjustments
  (`CashTransaction`) never enter this computation** — they are
  not inputs to the engine. Shifting the starting balance only
  moves the curve level; peak-to-trough is unchanged. Open
  positions contribute nothing: callers pass **closed trades
  only** (their floating P&L is unknown without live prices).
- **No true equity/balance drawdown exists yet.** One would need
  per-account `initialBalance` plus dated cash flows merged
  with trade P&L in every caller (analytics, dashboard, reports,
  mentor, share) plus a complete equity series.
  `AccountEquitySnapshot` cannot supply that series: it is
  **EA-heartbeat-only and sparse** (15-minute cadence, 30-day
  retention). That wiring is deliberately out of scope for Lot 1.

## 5. Rounding

- All financial math uses **decimal.js** (`src/lib/trading/dec.ts`):
  **precision 28, `ROUND_HALF_UP`**. Never JS floats for
  money, prices, lots, or pips. Prisma interop passes strings
  for exact round-trips.
- **Lots are rounded down to the volume step** (`floorToStep`,
  anchored on the broker's minimum lots — the minimum itself is
  always a valid volume; each subsequent volume adds one lot
  step). Rounding down never risks more than requested. The
  same minimum-anchored stepping applies to multi-TP tier lots.
- Stored derived values are rounded to **6 decimal places**:
  `plannedRR` and `rMultiple` / `realizedRR` (and `riskPercent`).
  Longer decimals would be truncated by storage affinity, so the
  rounding happens before storage.

## 6. Sizing guards

- **Risk basis** (`riskBasis`): `BALANCE` (default) sizes the
  risk % on `accountBalance`. `EQUITY` sizes it on the entered
  `accountEquity` — live equity is **not** available to the
  calculator (`AccountEquitySnapshot` is EA-heartbeat-only and
  sparse), so the caller must supply the current equity value.
  When it is missing or invalid the sizing is rejected with
  `EQUITY_UNAVAILABLE` — **never a silent fallback to balance**.
- **Costs:** when estimated costs (commission + swap + fees,
  account currency) are provided (> 0), the position is sized
  on `riskAmount − costs`, so risk taken plus costs stays within
  the requested budget (`costsDeducted` on the result reports
  what was taken off). When absent/zero the sizing is explicitly
  **before costs** — costs are never silently added. Costs
  greater than or equal to the whole budget reject the sizing
  (`COSTS_EXCEED_RISK`).
- **Maximum risk:** `MAX_RISK_PERCENT = 100` — risking more than
  100% of the basis (balance or equity) in one trade is rejected
  (`RISK_PERCENT_TOO_HIGH`), in percent mode and in
  fixed-amount mode alike.
- **Max-lots cap:** when the computed size exceeds `maxLots`
  the result is still valid (a tradable size is returned) but
  `capped` is true — the UI must show the cap. A capped size is
  never presented as the size the risk budget asked for.
- **Tick value:** taken from the instrument preset where
  available — an explicit per-lot `tickValue` wins, otherwise
  `tickSize × contractSize × lots`. Most presets carry no tick
  data at all (only XAUUSD, XAGUSD, and USOIL define a
  `tickSize`); when neither exists the tick value is **null**
  (`tickDataMissing`), and the caller must label that honestly
  instead of showing a zero tick value.
- **Insufficient risk:** when the risk budget cannot buy even
  the minimum lots the sizing is rejected
  (`INSUFFICIENT_RISK`), never rounded up to the minimum.
- The 37 instrument presets in the instruments browser are
  **static reference data** — hard-coded presets shipped with
  the app, with no live feed or external source behind them.
  Pip/tick sizes follow the broker convention noted in the
  browser and can differ per broker.

## 7. Tool scenarios

- Tool-scenario payloads (`src/lib/tools/scenario-payloads.ts`)
  round-trip every field the calculator shows: multi-TP keeps
  the FX rate and the risk mode on load, risk-reward keeps the
  currency, position-size keeps the rate / risk basis / equity /
  costs, and the P&L simulator keeps the manual rate and the
  account currency. Parse is forgiving (unknown or mistyped
  fields are dropped, never thrown on). Scenario kinds are
  plain strings — `POSITION_SIZE` and `PNL_SIMULATOR` need no
  migration. The P&L simulator scenario save stores the same
  fields its loader restores, so a saved scenario replays
  exactly.
