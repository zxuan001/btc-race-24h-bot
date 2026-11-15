# btc-race-24h bot — Capitulation Bounce

A long-only cbBTC/USDC bot for the make.fun competition
`btc-race-24h-20261115-0828` ("Race a BTC trading bot live for 24 hours").

## Strategy

On 1-minute bars BTC's returns are close to unpredictable minute to minute,
but a sharp multi-hour sell-off is usually followed by a snap-back bounce
once sellers exhaust themselves. This bot does nothing for most of the day —
cash earns nothing and a falling market punishes holders — and only steps in
after a deep drop, and only once the price has already started to turn back
up. It rides the bounce with a tight trailing stop and exits at the first
sign of fading.

- **Tier A (full size):** close at least 260 bps under its close 120 bars
  ago, and at least 40 bps above its close 10 bars ago.
- **Tier B (half size):** close at least 120 bps under its close 60 bars
  ago, and at least 40 bps above its close 10 bars ago.
- **Top-up:** while holding a half-size probe, a Tier A signal buys the rest
  of the cash, so the bounce is ridden at full size. A dip whose 120-bar
  drop is 220–259 bps therefore enters as a probe first and is topped up
  only if the drop deepens to 260 bps while the bounce holds.
- **Exit:** sell everything when the close falls 60 bps under the highest
  close seen since entry (trailing stop on closes).
- **Cooldown:** after any exit, no new entry for 60 bars, so a waterfall
  cannot be bought twice in a row.

Every decision is exact integer arithmetic on the closes the harness sent:
no floats, no clock, no randomness, so two runs agree bar for bar. Orders
fill at the next bar's open; `max_slippage_bps` is 300, so a one-minute move
past 3% off the close rejects the order rather than chasing it.

## Local dev grade

From the kit directory:

```
node cli/makefun.mjs grade-local --kit . --bot /path/to/this/repo --driver process
```

Result on the frozen 24h dev window (verified with grade-local, process
driver; the L1 regrade reproduced byte for byte):

- **Net PnL: +35.93 USDC** (dev gate needs > $0)
- 5 trades, win rate 0.50, max drawdown 0.88%, exposure 7.2%, Sharpe 0.046
- Fees $1.21; at 2x fees net PnL +$34.69
- Guardrails met; 0 rejected orders

For comparison, on the same window: buy-and-hold −$44.01, momentum −$40.92,
ema-cross −$134.95, adx-momentum −$86.60, rsi-bollinger −$57.37,
hold-cash $0.00 (fails the guardrails: no trades).

The two round trips on dev: a half-size probe that roughly broke even
(−$1.8 after fees) and a capitulation bounce, entered as a half-size probe
near the intraday low and topped up to full size 5 bars later, about 30 bps
cheaper, once the 120-bar drop deepened to 279 bps — then sold near the
bounce high (about +$37.7 for that trip).

## Honest limits

- The dev profit comes mostly from one V-shaped bounce (a ~4% drop into the
  intraday low, then a ~4.5% recovery). A race window with no sharp drop
  will see few or no trades from this bot; a race window that keeps falling
  with no bounce will see small half-size losses.
- The parameters were chosen on the dev window, but the full-size threshold
  sits in the middle of a plateau, not on a spike: DROP_A 250–270 bps all
  give the identical +$35.93 (260 is the plateau centre), 220–240 bps give
  +$33.06, and even 280 bps — where Tier A never fires and the bounce is
  ridden at half size only — still clears the gate at +$16.52. Neighbouring
  changes in the other direction are all worse (trail 80/100 bps, confirm
  20/30 bps — the last two lose money), so the 260 bps threshold is the
  robust pick of the sweep, not a tuned peak. It is still one day of data,
  and no backtest guarantees the race day.
- The bot never shorts, never uses leverage, and never holds more than one
  position; its worst drawdown on dev was 1.2%, far under the 25%
  guardrail.

## Files

- `main.ts` — the bot (entry point, run with `node main.ts`).
- `vendor/makefun-bars.ts` — the kit's SDK shim, copied byte for byte.
- `README.md`, `LICENSE` (MIT), `.gitignore`.
