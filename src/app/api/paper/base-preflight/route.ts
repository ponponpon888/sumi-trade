import { BasePaperPreflightError, getBasePaperPreflight } from "@/lib/base-paper-preflight";
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
    return Response.json(await getBasePaperPreflight(amount === "500" ? 500 : 1000), { headers });
  } catch (error) {
    const known = error instanceof BasePaperPreflightError;
    return Response.json({
      mode: "paper",
      executionLocked: true,
      profitabilityVerified: false,
      readiness: "blocked",
      status: "unavailable",
      error: known ? error.code : "BASE_PREFLIGHT_UNAVAILABLE",
      sourceError: known ? error.sourceCode : null,
    }, { status: 503, headers });
  }
}
