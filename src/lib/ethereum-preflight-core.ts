import type { OnchainPreflightAssessment } from "@/lib/types";

export const MAX_ETHEREUM_BLOCK_AGE_SECONDS = 180;

export interface EthereumStateInput {
  rpcConfigured: boolean;
  chainId: number | null;
  blockNumber: number | null;
  blockTimestampSeconds: number | null;
  contractCode: string | null;
}

export function assessEthereumState(
  input: EthereumStateInput,
  nowSeconds = Math.floor(Date.now() / 1_000),
): OnchainPreflightAssessment {
  const checkedAt = new Date(nowSeconds * 1_000).toISOString();
  const blockAgeSeconds =
    input.blockTimestampSeconds === null
      ? null
      : nowSeconds - input.blockTimestampSeconds;
  const contractCodePresent =
    input.contractCode === null
      ? null
      : input.contractCode !== "0x" && input.contractCode !== "0x0";

  if (!input.rpcConfigured) {
    return {
      status: "unavailable",
      readOnly: true,
      chainId: null,
      blockNumber: null,
      blockTimestamp: null,
      blockAgeSeconds: null,
      contractCodePresent: null,
      checkedAt,
      reasons: ["ETHEREUM_RPC_URL未設定のためオンチェーン状態を確認できません"],
    };
  }

  if (
    input.chainId === null ||
    input.blockNumber === null ||
    input.blockTimestampSeconds === null ||
    input.contractCode === null
  ) {
    return {
      status: "unavailable",
      readOnly: true,
      chainId: input.chainId,
      blockNumber: input.blockNumber,
      blockTimestamp:
        input.blockTimestampSeconds === null
          ? null
          : new Date(input.blockTimestampSeconds * 1_000).toISOString(),
      blockAgeSeconds,
      contractCodePresent,
      checkedAt,
      reasons: ["Ethereum RPC応答が不完全なため新規BUYを停止"],
    };
  }

  const reasons: string[] = [];
  const confirmedBlockAgeSeconds = nowSeconds - input.blockTimestampSeconds;
  if (input.chainId !== 1) reasons.push(`Ethereum mainnetではありません（chainId ${input.chainId}）`);
  if (confirmedBlockAgeSeconds < -30) reasons.push("最新ブロック時刻が未来を示しています");
  if (confirmedBlockAgeSeconds > MAX_ETHEREUM_BLOCK_AGE_SECONDS) {
    reasons.push(`最新ブロックが${confirmedBlockAgeSeconds}秒遅延しています`);
  }
  if (!contractCodePresent) reasons.push("対象アドレスにコントラクトコードがありません");

  return {
    status: reasons.length === 0 ? "pass" : "blocked",
    readOnly: true,
    chainId: input.chainId,
    blockNumber: input.blockNumber,
    blockTimestamp: new Date(input.blockTimestampSeconds * 1_000).toISOString(),
    blockAgeSeconds: confirmedBlockAgeSeconds,
    contractCodePresent,
    checkedAt,
    reasons: reasons.length === 0
      ? ["mainnet・ブロック鮮度・コントラクトコードを読み取り専用で確認"]
      : reasons,
  };
}
