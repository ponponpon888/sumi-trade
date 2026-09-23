import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getDashboardAccess } from "@/lib/dashboard-auth";

export function proxy(request: NextRequest) {
  const access = getDashboardAccess(request.headers.get("authorization"));
  if (access === "allowed") return NextResponse.next();

  if (access === "locked") {
    return new NextResponse("Dashboard access is locked until authentication is configured.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "Cache-Control": "no-store",
      "WWW-Authenticate": 'Basic realm="SUMI TRADE LAB", charset="UTF-8"',
    },
  });
}

export const config = {
  matcher: [
    "/((?!api/cron/scan|api/cron/base-cost|api/health|api/safety/emergency-stop|robots\\.txt|_next/static|_next/image|favicon\\.ico).*)",
  ],
};
