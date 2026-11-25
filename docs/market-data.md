# Market data - what Promethe has, and what it does not

## Sources of truth

Promethe has **no live or delayed market data provider**. There is no
market-data API key, no websocket feed, no polling of an external quote
service, and no vendor contract of any kind. Every price candle in the
app comes from one place only:

- **User CSV imports** (`POST /api/v1/charts/candles/import`, see
  `src/server/charts.ts` `importCandles`). The user uploads a CSV of
  OHLCV rows for one instrument and one timeframe, declares the
  timezone of the wall-clock timestamps, and the rows are stored in
  `price_candles` (UTC). The price chart, the replay player and the
  trades-grid mini charts all read from that table - nothing else.

Candles are therefore **imported historical data**, and the UI says so:

- The price chart shows "Imported CSV candles · {first} → {last} ·
  {count} bars" under every chart that has candles.
- When no candles exist for a trade window, the chart says so and
  offers the CSV import - it never renders a fake or empty chart as if
  it were live.
- A window that holds more than 6,000 bars shows only the most recent
  ones and says so ("Showing only the most recent 6,000 bars...").
- The import result reports exact accounting: imported + duplicates
  skipped + invalid rows = rows in the file. Invalid rows (unparseable
  time, non-numeric or OHLC-inconsistent values) are rejected, never
  stored.

## CSV import rules

- **Timezones**: timestamps are interpreted in the declared timezone
  (IANA name or fixed +HH:MM) and converted to UTC. The conversion is
  resolved twice per row so a wall-clock time just after a DST change
  lands on the right side of the transition (see
  `parseCandleRowInTimezone` in `src/lib/charts/price.ts`). Rows with
  an explicit ISO offset (Z or ±HH:MM) ignore the declared timezone.
- **Duplicates**: same instrument + timeframe + open time, inside one
  file or already stored - skipped, counted, never double-stored
  (unique index on `price_candles`).
- **Order**: rows may arrive in any order; storage and reads are
  chronological (queries order by `openTime`).
- **Gaps**: missing bars stay missing. The chart shows a coverage
  banner when the stored candles do not cover the trade, and reports
  the first/last covered candle. Gaps are not interpolated.
- **Validation**: a row is rejected when its time is unparseable, any
  OHLC value is missing, non-numeric or ≤ 0, when high is not the
  highest / low is not the lowest, or when volume is negative.
- **Budgets**: 50,000 rows per import, 250,000 rows per
  instrument + timeframe (oldest pruned first), and rows older than
  365 days that fall outside every trade window (±5 days) are pruned.

## Benchmarks

The benchmark comparison (`src/lib/charts/benchmark.ts`) compares the
realized equity curve (closed trades only, ending at the last trade
exit) against:

- a fixed % per period or fixed R per period (computed, not market
  data), or
- a **custom series imported by the user as CSV** (`date,value`),
  e.g. an index history or a funded-account target.

The comparison only covers the **overlap** of the two curves: it
starts at the later of the two starts and ends at the earlier of the
two ends. A benchmark that runs past the last trade is cut off instead
of being compared against flat, extrapolated equity. The compared
window is shown under the chart, and "Periods compared" counts only
periods where both sides were observed. Custom series must have
strictly increasing dates and positive values (enforced by
`benchmarkInputSchema`).

## Reports

Monthly and performance reports are computed from the user's own
closed trades only. The PDF exports are built from the exact payload
the screen shows - no figure is recomputed for the PDF, so the two
always agree. The "Cumulative P&L curve" in the monthly PDF is
cumulative net P&L, not an equity curve: deposits, withdrawals and open
positions are excluded by construction, and the PDF labels it as such.

## What a live or delayed provider would need (not built)

Adding a real market feed is a decision of its own, not a hidden
default. Before any provider is wired in, these must be settled and
shown in the UI:

- provider and plan (costs, licence, rate limits, symbols covered),
- latency and nature of the data (live, delayed by N minutes,
  end-of-day),
- which surfaces use it (price chart, replay, mini charts) and which
  stay on imported candles,
- a source label on every surface that uses it, so imported and live
  data are never mixed without saying so,
- storage and retention (the current 250k-row budget assumes
  user-paced imports, not a continuous feed).

Until that decision is made, treat every candle in Promethe as
imported history.
