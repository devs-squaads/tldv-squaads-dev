import { NextRequest, NextResponse } from "next/server";

export function assertPrivateApiAuthorized(req: NextRequest): NextResponse | null {
  const secret = process.env.API_ROUTE_SECRET;
  if (!secret) return null;

  const authHeader = req.headers.get("authorization");
  if (authHeader === `Bearer ${secret}`) return null;

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
