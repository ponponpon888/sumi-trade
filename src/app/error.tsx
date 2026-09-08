"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="setup-screen">
      <section className="setup-card">
        <span className="brand-mark">S</span>
        <span className="eyebrow">DATA INTERRUPTED</span>
        <h1>市場データを取得できませんでした。</h1>
        <p>資産には触れていません。時間を置いて公開データだけ再取得できます。</p>
        <button className="button button-accent" onClick={reset}>再試行</button>
      </section>
    </main>
  );
}
