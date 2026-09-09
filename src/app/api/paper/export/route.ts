import { getWalletAddress } from "@/lib/config";
import {
  buildPaperConfidenceCsv,
  createPaperExportContext,
  buildPaperDataQualityCsv,
  buildPaperSourceImpactCsv,
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
    const asOf = new Date();
    const { outcomes, journal } = await getPaperJournalResearchExport(
      getWalletAddress(),
      asOf.getTime(),
    );
    const context = createPaperExportContext(asOf, journal.analyticsWindowDays);
    const render = {
      outcomes: () => buildPaperOutcomeCsv(outcomes, context),
      confidence: () => buildPaperConfidenceCsv(journal.confidenceCalibrationByModel, context),
      regimes: () => buildPaperRegimeCsv(journal.regimePerformance, context),
      "data-quality": () => buildPaperDataQualityCsv(journal.dataQualityPerformance, context),
      "source-impact": () => buildPaperSourceImpactCsv(journal.sourceQualityImpact, context),
      "source-reasons": () => buildPaperSourceImpactCsv(journal.sourceReasonImpact, context),
      research: () => buildPaperResearchJson(outcomes, journal, asOf),
    };
    const body = render[selection.dataset]();

    return new Response(body, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${paperResearchExportFilename(selection, asOf)}"`,
        "Content-Type":
          selection.format === "json"
            ? "application/json; charset=utf-8"
            : "text/csv; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "X-Sumi-Export-As-Of": context.asOf,
        "X-Sumi-Window-Start": context.windowStart,
        "X-Sumi-Window-End": context.windowEnd,
        "X-Sumi-Window-Time-Basis": context.timeBasis,
      },
    });
  } catch {
    return Response.json(
      { ok: false, error: "Paper journal export is unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
