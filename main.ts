// Capitulation-bounce bot for cbBTC/USDC, 1-minute bars.
//
// The idea, in one paragraph: on a 1-minute chart BTC's returns are close to
// unpredictable minute to minute, but a sharp multi-hour sell-off is usually
// followed by a snap-back bounce once sellers exhaust themselves. This bot
// does nothing for most of the day — cash earns nothing and a falling market
// punishes holders — and only steps in after a deep drop, and only once the
// price has already started to turn back up. It then rides the bounce with a
// tight trailing stop and gets out at the first sign of fading. A shallower
// dip earns a half-size probe; if the 120-bar drop then reaches 260 bps
// while the bounce still holds, the probe is topped up to full size. On the
// dev window that staging bought the second half about 30 bps cheaper than
// an immediate full-size entry would have, and capped exposure at half size
// while the dip was still extending. Every decision is exact integer
// arithmetic on the closes the harness sent: no floats, no clock, no
// randomness, so two runs agree bar for bar.
//
//   - Tier A (full size): the close is at least 260 bps under its close 120
//     bars ago, and at least 40 bps above its close 10 bars ago.
//   - Tier B (half size): the close is at least 120 bps under its close 60
//     bars ago, and at least 40 bps above its close 10 bars ago.
//   - Top-up: while holding a half-size probe, a Tier A signal buys the rest
//     of the cash, so the bounce is ridden at full size.
//   - Exit: sell everything when the close falls 60 bps under the highest
//     close seen since the entry (a trailing stop on closes).
//   - Cooldown: after any exit, no new entry for 60 bars, so a waterfall
//     cannot be bought twice in a row.
//
// A buy decided on bar k fills at bar k+1's open; the signal therefore has
// to survive one bar of lag, which is why the entry needs the bounce to
// already show on the close it is decided on. max_slippage_bps is 300: a
// one-minute move past 3% off the close would reject the order rather than
// chase it, and on this data such a move does not occur.

import { runBars, type BarsState, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

/** Full-size entry: the 120-bar drop, in bps. Staged: a dip that is deep
 *  on the 60-bar view but not yet this deep enters as a half-size probe
 *  first, and is topped up to full size only if the 120-bar drop reaches
 *  this level while the bounce still holds. */
const DROP_A_BPS = 260n;
/** Half-size entry: the 60-bar drop, in bps. */
const DROP_B_BPS = 120n;
/** The 10-bar bounce that confirms the turn, in bps. */
const CONFIRM_BPS = 40n;
/** Trailing stop from the peak close since entry, in bps. */
const TRAIL_BPS = 60n;
/** Bars to wait after an exit before a new entry. */
const COOLDOWN_BARS = 60;
/** Orders never chase a fill more than this past the close they were decided on. */
const MAX_SLIPPAGE_BPS = 300;

const LOOKBACK_A = 120;
const LOOKBACK_B = 60;
const CONFIRM_BARS = 10;

/** The closes the harness has sent, one per batch (null before the first bar). */
const closes: (bigint | null)[] = [];
/** Highest close since the current entry (0 while flat). */
let peak = 0n;
/** The seq of the last exit decision (-1e9 while none). */
let lastExitSeq = -1_000_000_000;

/** True when `now` is at least `bps` basis points under `then` (exact, no division). */
function downAtLeast(now: bigint, then: bigint, bps: bigint): boolean {
  return now * 10_000n <= then * (10_000n - bps);
}

/** True when `now` is at least `bps` basis points above `then` (exact, no division). */
function upAtLeast(now: bigint, then: bigint, bps: bigint): boolean {
  return now * 10_000n >= then * (10_000n + bps);
}

/** The close `bars` batches ago, or null when the history is that short. */
function closeBack(bars: number): bigint | null {
  const i = closes.length - 1 - bars;
  if (i < 0) return null;
  return closes[i] ?? null;
}

await runBars({
  onBatch(state: BarsState) {
    const close = state.close(SYMBOL);
    closes.push(close);
    if (close === null || state.warmingUp) return [];

    const held = state.positions.get(SYMBOL);
    const closeA = closeBack(LOOKBACK_A);
    const closeB = closeBack(LOOKBACK_B);
    const closeC = closeBack(CONFIRM_BARS);

    // --- exits: trailing stop on the peak close since entry -----------------
    if (held !== undefined) {
      if (close > peak) peak = close;
      const fell = peak > 0n && (peak - close) * 10_000n >= peak * TRAIL_BPS;
      if (fell) {
        peak = 0n;
        lastExitSeq = state.seq;
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies OrderInput];
      }
      // Holding a half-size probe: a Tier A signal tops it up to full size.
      const value = state.value(SYMBOL, held.qty);
      const half = value * 10_000n < (state.equity * 7_500n) / 1n;
      if (half && closeA !== null && closeC !== null && downAtLeast(close, closeA, DROP_A_BPS) && upAtLeast(close, closeC, CONFIRM_BPS)) {
        if (state.cash >= BigInt(state.hello.fees.min_notional_quote_units)) {
          peak = close > peak ? close : peak;
          return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies OrderInput];
        }
      }
      return [];
    }

    // --- entries (flat): cooldown, then Tier A, then Tier B -----------------
    peak = 0n;
    if (state.seq - lastExitSeq < COOLDOWN_BARS) return [];
    if (closeA !== null && closeC !== null && downAtLeast(close, closeA, DROP_A_BPS) && upAtLeast(close, closeC, CONFIRM_BPS)) {
      peak = close;
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies OrderInput];
    }
    if (closeB !== null && closeC !== null && downAtLeast(close, closeB, DROP_B_BPS) && upAtLeast(close, closeC, CONFIRM_BPS)) {
      const half = state.cash / 2n;
      if (half < BigInt(state.hello.fees.min_notional_quote_units)) return [];
      peak = close;
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: half, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies OrderInput];
    }
    return [];
  },
});
