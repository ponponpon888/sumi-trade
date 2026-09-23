import {
  GAS_RESERVE_ETH,
  MIN_ELIGIBLE_LIQUIDITY_USD,
  MIN_ELIGIBLE_VOLUME_USD,
  MIN_THIN_LIQUIDITY_USD,
  MIN_THIN_VOLUME_USD,
  getWalletAddress,
} from "@/lib/config";
import {
  getBlockscoutPortfolio,
  getContractSafetyAssessments,
} from "@/lib/blockscout";
import { getTokenMarketLookups, type MarketLookup } from "@/lib/dexscreener";
import { getOnchainPreflightAssessments } from "@/lib/ethereum-preflight";
import { asFiniteNumber, unitsToNumber } from "@/lib/number";
import { getQuotePreflightAssessments } from "@/lib/kyberswap";
import {
  TOKEN_POLICIES,
  TOKEN_POLICY_BY_ADDRESS,
} from "@/lib/token-policy";
import type {
  DataSourceCheckResult,
  MarketData,
  PortfolioAsset,
  PortfolioSnapshot,
  Tradability,
} from "@/lib/types";

const WRAPPED_ETH_ADDRESS = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

export function classifyMarket(market: MarketData | null): {
  tradability: Tradability;
  reason: string;
} {
  if (!market || market.priceUsd === null) {
    return {
      tradability: "blocked",
      reason: "実売買に使える価格経路が見つかりません",
    };
  }

  if (
    market.liquidityUsd >= MIN_ELIGIBLE_LIQUIDITY_USD &&
    market.volume24hUsd >= MIN_ELIGIBLE_VOLUME_USD
  ) {
    return {
      tradability: "eligible",
      reason: "自動売買の最低流動性基準を通過",
    };
  }

  if (
    market.liquidityUsd >= MIN_THIN_LIQUIDITY_USD &&
    market.volume24hUsd >= MIN_THIN_VOLUME_USD
  ) {
    return {
      tradability: "thin",
      reason: "薄い市場のため実行前の売却見積もりが必須",
    };
  }

  return {
    tradability: "blocked",
    reason: "流動性または24時間取引量が基準未満",
  };
}

/** A response without a usable priced pair is a market fact, not a source failure. */
export function marketSourceCheck(lookup: MarketLookup | undefined): DataSourceCheckResult {
  if (!lookup) return { outcome: "source-unavailable", failureKind: "other" };
  if (lookup.status === "failed") {
    return { outcome: "source-unavailable", failureKind: lookup.failureKind };
  }
  if (lookup.status === "no-pair" || lookup.market.priceUsd === null) {
    return { outcome: "policy-blocked" };
  }
  return { outcome: "success" };
}

export async function getPortfolioSnapshot(): Promise<PortfolioSnapshot> {
  const walletAddress = getWalletAddress();
  const { account, tokenBalances } = await getBlockscoutPortfolio(walletAddress);
  const ethPrice = asFiniteNumber(account.exchange_rate) ?? 0;
  const rawBalanceByAddress = new Map(
    tokenBalances.map((balance) => [
      balance.token.address_hash.toLowerCase(),
      balance,
    ]),
  );

  const heldPolicies = TOKEN_POLICIES.filter((policy) =>
    rawBalanceByAddress.has(policy.contractAddress.toLowerCase()),
  );
  const heldAddresses = heldPolicies.map((policy) => policy.contractAddress);
  const [marketLookups, safetyByAddress, preflightByAddress, onchainByAddress] = await Promise.all([
    getTokenMarketLookups([...heldAddresses, WRAPPED_ETH_ADDRESS]),
    getContractSafetyAssessments(heldAddresses),
    getQuotePreflightAssessments(heldAddresses, ethPrice),
    getOnchainPreflightAssessments(heldAddresses),
  ]);
  const markets = new Map(
    [...marketLookups].map(([address, lookup]) => [
      address,
      lookup.status === "found" ? lookup.market : null,
    ]),
  );
  const marketChecks = new Map<PortfolioAsset, DataSourceCheckResult>();

  const assets: PortfolioAsset[] = heldPolicies.map((policy) => {
    const normalizedAddress = policy.contractAddress.toLowerCase();
    const rawBalance = rawBalanceByAddress.get(normalizedAddress);
    if (!rawBalance) {
      throw new Error(`Balance disappeared while reading ${policy.symbol}.`);
    }

    const amount = unitsToNumber(
      rawBalance.value,
      Number(rawBalance.token.decimals),
    );
    const market = markets.get(normalizedAddress) ?? null;
    const fallbackPrice = asFiniteNumber(rawBalance.token.exchange_rate);
    const priceUsd = market?.priceUsd ?? fallbackPrice;
    const classification = classifyMarket(market);

    const asset: PortfolioAsset = {
      symbol: policy.symbol,
      name: policy.label,
      contractAddress: policy.contractAddress,
      amount,
      priceUsd,
      valueUsd: priceUsd === null ? 0 : amount * priceUsd,
      liquidityUsd: market?.liquidityUsd ?? null,
      volume24hUsd: market?.volume24hUsd ?? null,
      priceChange24h: market?.priceChange24h ?? null,
      tradability: classification.tradability,
      reason: classification.reason,
      pairUrl: market?.pairUrl ?? null,
      pairAddress: market?.pairAddress ?? null,
      dexId: market?.dexId ?? null,
      contractSafety: safetyByAddress.get(normalizedAddress) ?? null,
      quotePreflight: preflightByAddress.get(normalizedAddress) ?? null,
      onchainPreflight: onchainByAddress.get(normalizedAddress) ?? null,
      orderFlow: market?.orderFlow ?? null,
    };
    marketChecks.set(asset, marketSourceCheck(marketLookups.get(normalizedAddress)));
    return asset;
  });

  const gasBalanceEth = unitsToNumber(account.coin_balance, 18);
  const gasBalanceUsd = gasBalanceEth * ethPrice;
  const ethMarket = markets.get(WRAPPED_ETH_ADDRESS) ?? null;
  const ethAsset: PortfolioAsset = {
    symbol: "ETH",
    name: "Ethereum / gas reserve",
    contractAddress: null,
    amount: gasBalanceEth,
    priceUsd: ethPrice,
    valueUsd: gasBalanceUsd,
    liquidityUsd: ethMarket?.liquidityUsd ?? null,
    volume24hUsd: ethMarket?.volume24hUsd ?? null,
    priceChange24h: ethMarket?.priceChange24h ?? null,
    tradability: "gas",
    reason: `${GAS_RESERVE_ETH} ETHを決済用に固定`,
    pairUrl: ethMarket?.pairUrl ?? null,
    pairAddress: ethMarket?.pairAddress ?? null,
    dexId: ethMarket?.dexId ?? null,
    contractSafety: null,
    quotePreflight: null,
    onchainPreflight: null,
    orderFlow: ethMarket?.orderFlow ?? null,
  };
  marketChecks.set(ethAsset, marketSourceCheck(marketLookups.get(WRAPPED_ETH_ADDRESS)));
  assets.push(ethAsset);

  assets.sort((left, right) => right.valueUsd - left.valueUsd);

  const totalUsd = assets.reduce((total, asset) => total + asset.valueUsd, 0);
  const tradeableUsd = assets
    .filter(
      (asset) =>
        ["eligible", "thin"].includes(asset.tradability) &&
        asset.contractSafety?.status === "pass" &&
        asset.quotePreflight?.status === "pass" &&
        asset.onchainPreflight?.status === "pass",
    )
    .reduce((total, asset) => total + asset.valueUsd, 0);
  const blockedUsd = assets
    .filter(
      (asset) =>
        asset.tradability === "blocked" ||
        (asset.contractSafety !== null && asset.contractSafety.status !== "pass") ||
        (asset.quotePreflight !== null && asset.quotePreflight.status !== "pass") ||
        (asset.onchainPreflight !== null && asset.onchainPreflight.status !== "pass"),
    )
    .reduce((total, asset) => total + asset.valueUsd, 0);
  const ignoredTokenCount = tokenBalances.filter(
    (balance) =>
      !TOKEN_POLICY_BY_ADDRESS.has(balance.token.address_hash.toLowerCase()),
  ).length;

  const warnings: string[] = [];
  if (gasBalanceEth < GAS_RESERVE_ETH) {
    warnings.push("ガス用ETHが最低残高を下回っています。実行は禁止されます。");
  }
  if (blockedUsd > 0) {
    warnings.push("表示価格があっても売買基準を満たさない資産があります。");
  }
  if (ignoredTokenCount > 0) {
    warnings.push(
      `${ignoredTokenCount}件の未承認トークンを検出し、すべて操作対象から除外しました。`,
    );
  }
  const contractBlockedCount = assets.filter(
    (asset) =>
      asset.contractSafety !== null && asset.contractSafety.status !== "pass",
  ).length;
  if (contractBlockedCount > 0) {
    warnings.push(
      `${contractBlockedCount}銘柄はコントラクト安全確認が未完了のため、新規BUYを停止しました。`,
    );
  }
  const preflightBlockedCount = assets.filter(
    (asset) =>
      asset.quotePreflight !== null && asset.quotePreflight.status !== "pass",
  ).length;
  if (preflightBlockedCount > 0) {
    warnings.push(
      `${preflightBlockedCount}銘柄はBUY／SELL双方向見積を通過できず、新規BUYを停止しました。`,
    );
  }
  const onchainBlockedCount = assets.filter(
    (asset) =>
      asset.onchainPreflight !== null && asset.onchainPreflight.status !== "pass",
  ).length;
  if (onchainBlockedCount > 0) {
    warnings.push(
      `${onchainBlockedCount}銘柄はオンチェーン状態確認を通過できず、新規BUYを停止しました。`,
    );
  }

  return {
    walletAddress,
    generatedAt: new Date().toISOString(),
    source: "blockscout+dexscreener",
    totalUsd,
    tradeableUsd,
    blockedUsd,
    gasBalanceEth,
    gasBalanceUsd,
    gasReserveEth: GAS_RESERVE_ETH,
    assets,
    ignoredTokenCount,
    warnings,
    sourceChecks: {
      // Same targets as the dexscreener quality count: assets with a positive amount.
      dexscreener: assets
        .filter((asset) => asset.amount > 0)
        .map((asset) => marketChecks.get(asset) ?? marketSourceCheck(undefined)),
    },
  };
}
