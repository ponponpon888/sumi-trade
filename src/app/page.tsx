import { Dashboard } from "@/app/_components/dashboard";
import { getTradingDashboardData } from "@/lib/trading-engine";

export const dynamic = "force-dynamic";

async function loadDashboardData() {
  try {
    const data = await getTradingDashboardData();
    return { ok: true as const, ...data };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : "Unknown data error",
    };
  }
}

function SetupState({ message }: { message: string }) {
  return (
    <main className="setup-screen">
      <section className="setup-card">
        <span className="brand-mark">S</span>
        <span className="eyebrow">SUMI TRADE LAB / SETUP</span>
        <h1>公開ウォレットを設定してください。</h1>
        <p>{message}</p>
        <code>WALLET_ADDRESS=0x...</code>
        <small>秘密鍵・リカバリーフレーズは設定しません。</small>
      </section>
    </main>
  );
}

export default async function Home() {
  const result = await loadDashboardData();

  if (!result.ok) {
    return (
      <SetupState message={result.message} />
    );
  }

  return (
    <Dashboard
      snapshot={result.snapshot}
      chartModel={result.chartModel}
      plan={result.plan}
      journal={result.journal}
      trendScout={result.trendScout}
      safetyControl={result.safetyControl}
    />
  );
}
