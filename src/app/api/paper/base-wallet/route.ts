import { getDashboardAccess } from "@/lib/dashboard-auth";
import {
  BaseWalletObservationError,
  getBaseWalletObservation,
} from "@/lib/base-wallet-observation";

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

  if ([...new URL(request.url).searchParams.keys()].length > 0) {
    return Response.json({ error: "This endpoint does not accept query parameters." }, {
      status: 400,
      headers,
    });
  }

  try {
    return Response.json(await getBaseWalletObservation(), { headers });
  } catch (error) {
    return Response.json({
      mode: "paper",
      executionLocked: true,
      readiness: "blocked",
      status: "unavailable",
      error: error instanceof BaseWalletObservationError
        ? error.code
        : "BASE_WALLET_OBSERVATION_UNAVAILABLE",
    }, { status: 503, headers });
  }
}

