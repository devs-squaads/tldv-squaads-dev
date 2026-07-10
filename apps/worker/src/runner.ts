import { claimNextMeeting, processClaimedMeeting } from "@/services/meetingWorkerService";
import { startInternalApiServer } from "@/server/internalApiServer";
import { autoJoinPollAndEnqueue } from "@/services/autoJoinService";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const internalApiServer = await startInternalApiServer();
  const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS || 5000);
  const autoJoinPollIntervalMs = Number(process.env.AUTO_JOIN_POLL_INTERVAL_MS || 60000);
  let nextAutoJoinAt = 0;
  const reportEveryCycles = Number(process.env.WORKER_REPORT_EVERY_CYCLES || 12);
  const maxConcurrent = Number(process.env.WORKER_MAX_CONCURRENT || 5);

  let cycle = 0;
  let idleCycles = 0;
  let processedTotal = 0;
  let errorsTotal = 0;

  // Track meetings being processed in parallel
  const activeTasks = new Map<string, Promise<void>>();

  console.log(`[worker] Started. Poll interval: ${pollIntervalMs}ms, max concurrent: ${maxConcurrent}`);

  let running = true;
  process.on("SIGINT", () => {
    console.log("[worker] SIGINT received. Stopping loop.");
    running = false;
    void internalApiServer.stop();
  });
  process.on("SIGTERM", () => {
    console.log("[worker] SIGTERM received. Stopping loop.");
    running = false;
    void internalApiServer.stop();
  });

  while (running) {
    cycle += 1;

    // Auto-join calendar polling (OAuth users auto-enable, legacy needs env var)
    if (Date.now() >= nextAutoJoinAt) {
      nextAutoJoinAt = Date.now() + autoJoinPollIntervalMs;
      try {
        const autoJoinResult = await autoJoinPollAndEnqueue();
        if (autoJoinResult.polled > 0 || autoJoinResult.enqueued > 0) {
          console.log(
            `[auto-join] polled=${autoJoinResult.polled} enqueued=${autoJoinResult.enqueued}`
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown auto-join error";
        console.error("[auto-join] Poll error:", message);
      }
    }

    // If at capacity, wait and retry
    if (activeTasks.size >= maxConcurrent) {
      console.log(`[worker] At capacity (${activeTasks.size}/${maxConcurrent}). Waiting for a free worker slot...`);
      await sleep(pollIntervalMs);
      continue;
    }

    try {
      // Quick DB operation: claim next pending meeting
      const claimed = await claimNextMeeting();

      if (claimed) {
        idleCycles = 0;
        console.log(`[worker] Claimed meeting ${claimed.id} (active: ${activeTasks.size + 1}/${maxConcurrent})`);

        // Launch processing in background (don't await)
        const task = processClaimedMeeting(claimed)
          .then((result) => {
            if (result.processed) processedTotal += 1;
          })
          .catch((err) => {
            errorsTotal += 1;
            const msg = err instanceof Error ? err.message : "Unknown error";
            console.error(`[worker] Task error for meeting ${claimed.id}:`, msg);
          })
          .finally(() => {
            activeTasks.delete(claimed.id);
          });

        activeTasks.set(claimed.id, task);

        // Brief pause before trying to claim another
        await sleep(500);
      } else {
        idleCycles += 1;
        await sleep(pollIntervalMs);
      }
    } catch (error) {
      errorsTotal += 1;
      const message = error instanceof Error ? error.message : "Unknown worker loop error";
      console.error("[worker] Loop error:", message);
      await sleep(pollIntervalMs);
    }

    if (cycle % reportEveryCycles === 0) {
      console.log(
        `[worker] heartbeat cycle=${cycle} processed=${processedTotal} errors=${errorsTotal} idle=${idleCycles} active=${activeTasks.size}`
      );
    }
  }

  // Wait for active tasks before exiting
  if (activeTasks.size > 0) {
    console.log(`[worker] Waiting for ${activeTasks.size} active tasks to finish...`);
    await Promise.allSettled(activeTasks.values());
  }

  await internalApiServer.stop();
  console.log(`[worker] Stopped. cycles=${cycle} processed=${processedTotal} errors=${errorsTotal}`);
}

void main();
