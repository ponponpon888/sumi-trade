# Base small-capital paper preflight

## Scope

This first implementation is a pure, tested decision boundary in
`src/lib/small-capital-paper.ts`. It has no network, signer, wallet creation,
storage, environment-variable, or transaction side effects. It is deliberately
not connected to the existing Ethereum scanner, dashboard, cron, or live trading.
The existing Ethereum sizing, fixed 12% scenario and gas defaults are unchanged;
do not present this module as a completed migration of that pipeline.

Every result has `mode: paper`, `executionLocked: true` and
`profitabilityVerified: false`. `paper-ready` means only that this supplied
snapshot passes paper preflight, never that a real trade is authorized or safe.

## Fixed previously selected limits

- Base chain ID 8453 only; no bridges or other networks.
- Cumulative funding ceiling: JPY 10,000. Withdrawals do not reset deposits.
- Requested order ceiling: JPY 1,000. There is no wallet-balance/all-in mode.
- No implicit USD 10 minimum or portfolio percentage floor in this module.
- No fixed expected profit, fixed gas price, or extra AI/API calls.
- An explicit, positive exit reserve is required even for gas-sponsored quotes.

The proposal to use a whole wallet has not changed these limits. Raising them
requires a separate explicit budget decision and implementation review. SELL
sizing for appreciated positions is not implemented by this BUY paper planner;
it must not be treated as an exemption from the JPY 1,000 limit.

## Adapter contract

Callers provide a schema-validated snapshot from trusted server-side data, not a
browser's self-reported balances or fees. The TypeScript API is not a general
JSON validation boundary. Monetary values are nonnegative safe integer yen.
Conservatively floor available balances/minimum proceeds and ceil costs/exposure
when converting token units and fresh fiat prices. Keep token units as strings
and bind them to actual decimals and contracts in the adapter. Two quotes must
cover the exact requested amount and the reverse sale of the BUY minimum output.

The quote checks chain, wallet, recipient, token pair, amount, token units,
provider expiry and price-valuation freshness. The adapter must additionally
validate raw calldata, approvals, actual reverse token pair and recipient,
supported assets, provider minimums, gas asset availability and fee completeness.
Additional fee fields include only costs not already reflected in the quoted
minimum output. JPY-equivalent cash does not prove sufficient native gas exists.

The 10-second quote/valuation and 5-second balance age limits are conservative
paper implementation defaults, not live service guarantees. Future timestamps
are rejected. Quote expiry is independent of quote age. Live integration must
revalidate immediately before signing, including a fresh exit quote.

`maxRoundTripCostYen` and `exitReserveYen` are explicit paper-test inputs. Fixture
values (JPY 10 and 100) are not newly approved live limits. The estimated cost is
the nonnegative round-trip minimum-proceeds shortfall plus additional BUY/SELL
fees. This is not a profitability forecast or a guarantee of future sellability.

`committedPrincipalYen` includes open positions at entry cost and pending buys;
never reduce it using an unrealized price drop. Before calling the planner,
deduct existing pending debits from `liquidBalanceYen` and carry forward fee/loss
reserves in the authoritative ledger. This function reads values; it neither
verifies a ledger nor atomically reserves money. Calling it twice can yield the
same paper-ready answer. Never use that as permission to submit twice.

On any blocked input, the amount and numerical estimates are null. The planner
does not silently reduce a request and reuse a mismatched quote. Obtain a new
amount-specific quote for a different request.

## Before connecting or enabling real trading

1. Implement Base-specific, schema-validated balance, FX and two-way quote adapters.
2. Preserve unknown market data rather than treating missing values as zero.
3. Wire a separate Base paper ledger and surface paper-only results behind auth.
4. Implement atomic budget reservation, idempotency and unknown-submission recovery.
5. Prove signer-side restrictions independently; app validation is not custody security.
6. Verify authentication refresh, restart recovery, cancellation and emergency stop.
7. Agree live fee/loss limits, exit policy and funding separately. Keep execution locked.

## Verification

Run `npm test -- src/lib/small-capital-paper.test.ts`, then `npm run check` and
`npm run build`. Tests cover sub-USD-floor-sized yen plans, exact boundaries,
oversized/all-in requests, pending exposure, reserves, amount/recipient/chain
mismatches, missing and expired quotes, future timestamps, token-unit overflow,
invalid monetary values, emergency stop, and the immutable paper lock.
