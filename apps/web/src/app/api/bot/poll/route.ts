import { NextRequest, NextResponse } from "next/server";
import { requestWorkerAutoJoinPoll } from "@/services/workerRecoveryClient";
import { assertPrivateApiAuthorized } from "@/services/privateApiAuth";

export const dynamic = "force-dynamic";

/**
 * Disparador manual/por cron del ciclo de auto-join del worker (spec 015).
 * Antes era anónimo: cualquiera en internet podía provocar que el bot se uniera a reuniones.
 * Se exige el `API_ROUTE_SECRET` compartido, igual que el resto de rutas internas.
 */
export async function GET(request: NextRequest) {
  const unauthorized = assertPrivateApiAuthorized(request);
  if (unauthorized) return unauthorized;

  try {
    const result = await requestWorkerAutoJoinPoll();

    if (!result.success) {
      return NextResponse.json({ error: result.error || "Worker auto-join poll failed" }, { status: 400 });
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      polled: result.polled,
      enqueued: result.enqueued,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown polling error";
    console.error("Poll Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
