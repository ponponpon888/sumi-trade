import { describe, expect, it } from "vitest";

import { auditRuntimeConfiguration } from "@/lib/runtime-config";

const COMPLETE_ENVIRONMENT: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  WALLET_ADDRESS: "0x0000000000000000000000000000000000000001",
  CRON_SECRET: "cron-secret-with-16-characters",
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "redis-token",
  DASHBOARD_PASSWORD: "dashboard-password-long",
  SAFETY_CONTROL_SECRET: "safety-secret-long",
  ETHEREUM_RPC_URL: "https://ethereum.example/rpc",
  SUMI_EMERGENCY_STOP: "false",
};

describe("runtime configuration audit", () => {
  it("passes without exposing environment values", () => {
    const result = auditRuntimeConfiguration(COMPLETE_ENVIRONMENT);

    expect(result.status).toBe("pass");
    expect(result.missingOrInvalid).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("dashboard-password-long");
    expect(JSON.stringify(result)).not.toContain("redis-token");
  });

  it("accepts the Vercel KV aliases for Redis", () => {
    const result = auditRuntimeConfiguration({
      ...COMPLETE_ENVIRONMENT,
      UPSTASH_REDIS_REST_URL: "",
      UPSTASH_REDIS_REST_TOKEN: "",
      KV_REST_API_URL: "https://example.upstash.io",
      KV_REST_API_TOKEN: "kv-token",
    });

    expect(result.storageConfigured).toBe(true);
    expect(result.status).toBe("pass");
  });

  it("blocks short secrets, invalid URLs, and invalid emergency-stop values", () => {
    const result = auditRuntimeConfiguration({
      ...COMPLETE_ENVIRONMENT,
      CRON_SECRET: "short",
      ETHEREUM_RPC_URL: "not-a-url",
      SUMI_EMERGENCY_STOP: "maybe",
    });

    expect(result.status).toBe("blocked");
    expect(result.missingOrInvalid).toEqual([
      "CRON_SECRET",
      "ETHEREUM_RPC_URL",
      "SUMI_EMERGENCY_STOP",
    ]);
  });
});
