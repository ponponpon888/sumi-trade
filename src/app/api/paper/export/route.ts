import { getWalletAddress } from "@/lib/config";
import {
  buildPaperOutcomeCsv,
  paperOutcomeExportFilename,
} from "@/lib/paper-export";
import { getPaperJournalExportOutcomes } from "@/lib/paper-journal";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const outcomes = await getPaperJournalExportOutcomes(getWalletAddress());
    return new Response(buildPaperOutcomeCsv(outcomes), {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${paperOutcomeExportFilename()}"`,
        "Content-Type": "text/csv; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json(
      { ok: false, error: "Paper journal export is unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
