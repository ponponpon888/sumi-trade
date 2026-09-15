import { BasePaperQuoteError, getBasePaperQuote } from "@/lib/base-paper-quote";
import { getDashboardAccess } from "@/lib/dashboard-auth";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request) {
  const access = getDashboardAccess(request.headers.get("authorization"));
  if (access !== "allowed") {
    return Response.json({ error: "Dashboard authentication required." }, {
      status: access === "locked" ? 503 : 401,
      headers: { ...headers, "WWW-Authenticate": 'Basic realm="SUMI TRADE LAB", charset="UTF-8"' },
    });
  }
  const params = new URL(request.url).searchParams;
  const amount = params.get("amountYen");
  if ((amount !== "500" && amount !== "1000") ||
      params.getAll("amountYen").length !== 1 ||
      [...params.keys()].some((key) => key !== "amountYen")) {
    return Response.json({ error: "Specify amountYen=500 or amountYen=1000 only." }, { status: 400, headers });
  }
  try {
    return Response.json(await getBasePaperQuote(amount === "500" ? 500 : 1000), { headers });
  } catch (error) {
    return Response.json({
      mode: "paper", executionLocked: true, readiness: "blocked",
      status: "unavailable", totalCostYen: null,
      error: error instanceof BasePaperQuoteError ? error.code : "QUOTE_UNAVAILABLE",
    }, { status: 503, headers });
  }
}
