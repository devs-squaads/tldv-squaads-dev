import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EXTENSION_TRACKABLE_FRESHNESS_MS,
  EXTENSION_TRACKABLE_STATUSES,
} from "@meeting-bot/shared/domain/meetingStatus";

const repositorySource = readFileSync(
  join(import.meta.dir, "../../../../packages/shared/src/repositories/MeetingRepository.ts"),
  "utf8",
);

const trackableLookupSource = repositorySource.match(
  /static async findTrackableByUrlAndOwner[\s\S]*?return meeting \?\? null;\n  }/,
)?.[0];

describe("MeetingRepository trackable lookup contract", () => {
  it("uses a same-day freshness window that supports meetings longer than ten minutes", () => {
    expect(EXTENSION_TRACKABLE_FRESHNESS_MS).toBe(24 * 60 * 60 * 1000);
    expect(EXTENSION_TRACKABLE_FRESHNESS_MS).toBeGreaterThan(10 * 60 * 1000);
  });

  it("excludes arbitrarily old rows with an explicit creation-time lower bound", () => {
    expect(trackableLookupSource).toContain("gte(meetings.createdAt, createdAfter)");
  });

  it("keeps owner scoping and chooses the newest valid matching row", () => {
    expect(trackableLookupSource).toContain("eq(meetings.ownerId, ownerId)");
    expect(trackableLookupSource).toContain(".orderBy(desc(meetings.createdAt))");
    expect(trackableLookupSource?.indexOf(".orderBy(desc(meetings.createdAt))")).toBeLessThan(
      trackableLookupSource?.indexOf(".limit(1)") ?? -1,
    );
  });

  it("keeps transcription error recovery inside the trackable status set", () => {
    expect(EXTENSION_TRACKABLE_STATUSES).toContain("transcription_error");
    expect(trackableLookupSource).toContain("EXTENSION_TRACKABLE_STATUSES");
  });
});
