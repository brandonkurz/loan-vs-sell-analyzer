# Loan vs. Sell-to-Cover Analyzer

A focused companion to the RSU Settlement calculator, built for **Diversifi Capital**.
It zeroes in on three questions for a single-trigger RSU settlement:

1. **Why does borrowing beat (or lose to) selling shares to cover the tax?**
2. **Short-term vs. long-term hold** — what does waiting for long-term rates actually buy, net of extra interest?
3. **Monthly cash-flow** of carrying the loan (with optional capitalizing interest).

## Run it

No build step, no dependencies. Double-click **`start.command`**, or open `index.html`
in any browser. Serves on `http://127.0.0.1:8766/` (a different port from the main RSU
calculator, so both can run at once).

## Files

| File | Purpose |
|------|---------|
| `index.html` | Markup / structure |
| `styles.css` | Brand theme + print layout |
| `app.js` | Model (`compute()`), rendering, schedule, sensitivity |
| `serve.py` | No-cache local server (port 8766) |
| `start.command` | Double-click launcher |

## The model

Inputs mirror the source spreadsheet: RSUs, current price, a settlement (ordinary) tax
rate, short- and long-term gains rates, SOFR + spread (= borrowing rate), short/long hold
periods, and a future stock price.

- **Tax at settlement** = gross RSU value × settlement rate.
- **Sell-to-Cover** sells `ceil(tax / price)` shares now; the rest are sold later at the future price.
- **Borrow-to-Cover** keeps every share, sells later, and repays `loan + interest`.
- **Interest** = loan × borrowing rate over the hold (simple, or compounding if capitalizing).
- **Gains** are taxed at the short-term (ordinary) rate inside 12 months, long-term rate at 12+.
- **Breakeven price** is solved analytically: the future price where borrowing's retained
  upside exactly offsets the interest (and short-term tax, if applicable).

Outputs: a 4-column matrix (Sell/Borrow × ST/LT), a "why borrowing wins" waterfall, a
short-vs-long-term panel, a month-by-month debt schedule, and a future-price sensitivity
table with the breakeven.

### Reconciliation with the source sheet

With the source inputs (104,035 sh, $61.55, future $80, 4.13%, simple interest) the model
reproduces the spreadsheet's take-home figures within rounding (Borrow-LT ≈ $4.555M). The
settlement rate defaults to **48.69%** to match the sheet's tax-due of ~$3.12M; set it equal
to your short-term rate if you prefer one consistent ordinary rate.

One deliberate improvement: the source compared long-term borrowing against a *short-term-taxed*
sell-to-cover. Here each horizon compares like-for-like (LT borrow vs. LT sell), which is the
cleaner apples-to-apples advantage.

## Important

Simplified illustration, **not tax or investment advice.** Ignores AMT, capital-loss offsets
below basis, dividends, margin-call risk, and withholding mechanics. Private-company shares
aren't freely sellable and future tender prices aren't guaranteed. Confirm with a CPA.
