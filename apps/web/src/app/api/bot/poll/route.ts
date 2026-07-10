import { NextResponse } from "next/server";
import { requestWorkerAutoJoinPoll } from "@/services/workerRecoveryClient";

export const dynamic = "force-dynamic";

export async function GET() {
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
