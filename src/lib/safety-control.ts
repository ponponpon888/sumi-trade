import "server-only";

import { Redis } from "@upstash/redis";

import type {
  PortfolioRiskAssessment,
  SafetyControlSnapshot,
} from "@/lib/types";

const EMERGENCY_STOP_KEY = "sumi:safety:v1:emergency-stop";

type StoredEmergencyStop = {
  enabled: boolean;
  reason: string;
  updatedAt: string;
};

function redisConfiguration(): { url: string; token: string } | null {
  const url =
    process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    process.env.KV_REST_API_URL?.trim();
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ||
    process.env.KV_REST_API_TOKEN?.trim();
  return url && token ? { url, token } : null;
}

function getRedis(): Redis | null {
  const configuration = redisConfiguration();
  return configuration
    ? new Redis({ ...configuration, enableTelemetry: false })
    : null;
}

function isStoredEmergencyStop(value: unknown): value is StoredEmergencyStop {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<StoredEmergencyStop>;
  return (
    typeof state.enabled === "boolean" &&
    typeof state.reason === "string" &&
    typeof state.updatedAt === "string" &&
    Number.isFinite(Date.parse(state.updatedAt))
  );
}

export function environmentEmergencyStop(
  value = process.env.SUMI_EMERGENCY_STOP,
): boolean | null {
  if (!value?.trim()) return false;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(normalized)) return true;
  if (["0", "false", "off", "no"].includes(normalized)) return false;
  return null;
}

export function applySafetyControlToRisk(
  risk: PortfolioRiskAssessment,
  safety: SafetyControlSnapshot,
): PortfolioRiskAssessment {
  if (safety.status === "monitoring") return risk;
  return {
    ...risk,
    status: safety.status === "stopped" ? "blocked" : "unavailable",
    blockNewBuys: true,
    reasons: [safety.reason, ...risk.reasons],
  };
}

export async function getSafetyControlSnapshot(): Promise<SafetyControlSnapshot> {
  const environmentStop = environmentEmergencyStop();
  if (environmentStop === true) {
    return {
      status: "stopped",
      emergencyStop: true,
      source: "environment",
      executionLocked: true,
      reason: "環境変数の緊急停止が有効です。新規BUYを停止します。",
      updatedAt: null,
    };
  }
  if (environmentStop === null) {
    return {
      status: "unavailable",
      emergencyStop: true,
      source: "unavailable",
      executionLocked: true,
      reason: "SUMI_EMERGENCY_STOPの値が不正なためFail Closedです。",
      updatedAt: null,
    };
  }

  const redis = getRedis();
  if (!redis) {
    return {
      status: "unavailable",
      emergencyStop: true,
      source: "unavailable",
      executionLocked: true,
      reason: "永続緊急停止ストレージを確認できないためFail Closedです。",
      updatedAt: null,
    };
  }

  try {
    const stored = await redis.get<unknown>(EMERGENCY_STOP_KEY);
    if (stored === null) {
      return {
        status: "monitoring",
        emergencyStop: false,
        source: "redis",
        executionLocked: true,
        reason: "永続緊急停止は解除状態です。",
        updatedAt: null,
      };
    }
    if (!isStoredEmergencyStop(stored)) {
      throw new Error("Invalid emergency-stop state");
    }
    return {
      status: stored.enabled ? "stopped" : "monitoring",
      emergencyStop: stored.enabled,
      source: "redis",
      executionLocked: true,
      reason: stored.reason,
      updatedAt: stored.updatedAt,
    };
  } catch {
    return {
      status: "unavailable",
      emergencyStop: true,
      source: "unavailable",
      executionLocked: true,
      reason: "永続緊急停止の状態を取得できないためFail Closedです。",
      updatedAt: null,
    };
  }
}

export async function setPersistentEmergencyStop(
  enabled: boolean,
  reason: string,
): Promise<SafetyControlSnapshot> {
  const redis = getRedis();
  if (!redis) {
    throw new Error("Persistent safety storage is not configured.");
  }
  const state: StoredEmergencyStop = {
    enabled,
    reason: reason.trim(),
    updatedAt: new Date().toISOString(),
  };
  await redis.set(EMERGENCY_STOP_KEY, state);
  return {
    status: enabled ? "stopped" : "monitoring",
    emergencyStop: enabled,
    source: "redis",
    executionLocked: true,
    reason: state.reason,
    updatedAt: state.updatedAt,
  };
}
