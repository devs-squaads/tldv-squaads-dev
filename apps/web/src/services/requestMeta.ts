import { NextRequest } from "next/server";

export function getRequestIp(req: NextRequest): string | null {
  const xForwardedFor = req.headers.get("x-forwarded-for");
  if (xForwardedFor) {
    const [first] = xForwardedFor.split(",");
    return first?.trim() || null;
  }

  const xRealIp = req.headers.get("x-real-ip");
  return xRealIp?.trim() || null;
}

export function getRequestUserAgent(req: NextRequest): string | null {
  return req.headers.get("user-agent");
}
