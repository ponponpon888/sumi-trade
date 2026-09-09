import { getWalletAddress } from "@/lib/config";
import {
  buildPaperConfidenceCsv,
  buildPaperOutcomeCsv,
  buildPaperRegimeCsv,
  buildPaperResearchJson,
  paperResearchExportFilename,
  parsePaperExportRequest,
} from "@/lib/paper-export";
import { getPaperJournalResearchExport } from "@/lib/paper-journal";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const selection = parsePaperExportRequest(request.url);
  if (!selection) {
    return Response.json(
      { ok: false, error: "Unsupported paper export format." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const { outcomes, journal } = await getPaperJournalResearchExport(
      getWalletAddress(),
    );
    const body =
      selection.dataset === "outcomes"
        ? buildPaperOutcomeCsv(outcomes)
        : selection.dataset === "confidence"
          ? buildPaperConfidenceCsv(journal.confidenceCalibrationByModel)
          : selection.dataset === "regimes"
            ? buildPaperRegimeCsv(journal.regimePerformance)
            : buildPaperResearchJson(outcomes, journal);

    return new Response(body, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${paperResearchExportFilename(selection)}"`,
        "Content-Type":
          selection.format === "json"
            ? "application/json; charset=utf-8"
            : "text/csv; charset=utf-8",
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
