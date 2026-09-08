const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const DEFAULT_WALLET_ADDRESS =
  "0x00000000000000000000000000000000000000d1";

function boundedEnvironmentNumber(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

export const GAS_RESERVE_ETH = 0.005;
export const MIN_ELIGIBLE_LIQUIDITY_USD = 150_000;
export const MIN_ELIGIBLE_VOLUME_USD = 5_000;
export const MIN_THIN_LIQUIDITY_USD = 25_000;
export const MIN_THIN_VOLUME_USD = 250;
export const CHART_CANDLE_LIMIT = 720;
export const MAX_CHART_ASSETS = 5;
export const ESTIMATED_SWAP_GAS_USD = boundedEnvironmentNumber(
  "ESTIMATED_SWAP_GAS_USD",
  4,
  0,
  100,
);
export const ESTIMATED_SLIPPAGE_PERCENT = boundedEnvironmentNumber(
  "ESTIMATED_SLIPPAGE_PERCENT",
  0.35,
  0,
  10,
);
export const MAX_PRICE_IMPACT_PERCENT = boundedEnvironmentNumber(
  "MAX_PRICE_IMPACT_PERCENT",
  1.5,
  0.1,
  10,
);
export const PREFLIGHT_QUOTE_USD = boundedEnvironmentNumber(
  "PREFLIGHT_QUOTE_USD",
  50,
  10,
  1_000,
);
export const MAX_PREFLIGHT_ROUND_TRIP_LOSS_PERCENT = boundedEnvironmentNumber(
  "MAX_PREFLIGHT_ROUND_TRIP_LOSS_PERCENT",
  5,
  0.5,
  25,
);
export const RISK_PER_TRADE_PERCENT = boundedEnvironmentNumber(
  "RISK_PER_TRADE_PERCENT",
  1,
  0.1,
  5,
);
export const MAX_POSITION_PERCENT = boundedEnvironmentNumber(
  "MAX_POSITION_PERCENT",
  20,
  1,
  100,
);

export const BLOCKSCOUT_ORIGIN =
  process.env.BLOCKSCOUT_ORIGIN ?? "https://eth.blockscout.com";
export const DEXSCREENER_ORIGIN =
  process.env.DEXSCREENER_ORIGIN ?? "https://api.dexscreener.com";
export const GECKOTERMINAL_ORIGIN =
  process.env.GECKOTERMINAL_ORIGIN ?? "https://api.geckoterminal.com/api/v2";
export const KYBERSWAP_ORIGIN =
  process.env.KYBERSWAP_ORIGIN ?? "https://aggregator-api.kyberswap.com";

export function getWalletAddress(): string {
  const address = process.env.WALLET_ADDRESS?.trim() || DEFAULT_WALLET_ADDRESS;

  if (!address || !EVM_ADDRESS_PATTERN.test(address)) {
    throw new Error(
      "WALLET_ADDRESS must be a valid public EVM address. Never use a private key.",
    );
  }

  return address;
}
