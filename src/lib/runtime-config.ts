export const MINIMUM_SECRET_LENGTH = 16;

export interface RuntimeConfigurationAudit {
  status: "pass" | "blocked";
  walletAddressConfigured: boolean;
  cronSecretConfigured: boolean;
  storageConfigured: boolean;
  dashboardAuthConfigured: boolean;
  safetyControlConfigured: boolean;
  ethereumRpcConfigured: boolean;
  emergencyStopValueValid: boolean;
  missingOrInvalid: string[];
}

function nonEmpty(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function strongSecret(value: string | undefined): boolean {
  return (value?.trim().length ?? 0) >= MINIMUM_SECRET_LENGTH;
}

function validHttpUrl(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function auditRuntimeConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): RuntimeConfigurationAudit {
  const walletAddressConfigured = /^0x[0-9a-f]{40}$/i.test(
    environment.WALLET_ADDRESS?.trim() ?? "",
  );
  const cronSecretConfigured = strongSecret(environment.CRON_SECRET);
  const upstashConfigured =
    validHttpUrl(environment.UPSTASH_REDIS_REST_URL) &&
    nonEmpty(environment.UPSTASH_REDIS_REST_TOKEN);
  const kvConfigured =
    validHttpUrl(environment.KV_REST_API_URL) &&
    nonEmpty(environment.KV_REST_API_TOKEN);
  const storageConfigured = upstashConfigured || kvConfigured;
  const dashboardAuthConfigured = strongSecret(environment.DASHBOARD_PASSWORD);
  const safetyControlConfigured = strongSecret(
    environment.SAFETY_CONTROL_SECRET,
  );
  const ethereumRpcConfigured = validHttpUrl(environment.ETHEREUM_RPC_URL);
  const emergencyStopValue = environment.SUMI_EMERGENCY_STOP?.trim().toLowerCase();
  const emergencyStopValueValid =
    !emergencyStopValue ||
    ["1", "true", "on", "yes", "0", "false", "off", "no"].includes(
      emergencyStopValue,
    );
  const checks = {
    WALLET_ADDRESS: walletAddressConfigured,
    CRON_SECRET: cronSecretConfigured,
    REDIS_REST_CREDENTIALS: storageConfigured,
    DASHBOARD_PASSWORD: dashboardAuthConfigured,
    SAFETY_CONTROL_SECRET: safetyControlConfigured,
    ETHEREUM_RPC_URL: ethereumRpcConfigured,
    SUMI_EMERGENCY_STOP: emergencyStopValueValid,
  };
  const missingOrInvalid = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([key]) => key);

  return {
    status: missingOrInvalid.length === 0 ? "pass" : "blocked",
    walletAddressConfigured,
    cronSecretConfigured,
    storageConfigured,
    dashboardAuthConfigured,
    safetyControlConfigured,
    ethereumRpcConfigured,
    emergencyStopValueValid,
    missingOrInvalid,
  };
}
