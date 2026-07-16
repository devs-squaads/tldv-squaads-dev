import { describe, expect, test } from "bun:test";
import { resolveWorkerInternalPort } from "../../../worker/src/server/internalApiPort";

describe("resolveWorkerInternalPort", () => {
  test("prefers a valid PORT over WORKER_INTERNAL_PORT", () => {
    expect(resolveWorkerInternalPort({ WORKER_INTERNAL_PORT: "4100", PORT: "4200" })).toBe(4200);
  });

  test("uses WORKER_INTERNAL_PORT when PORT is missing or invalid", () => {
    expect(resolveWorkerInternalPort({ WORKER_INTERNAL_PORT: "4100" })).toBe(4100);
    expect(resolveWorkerInternalPort({ PORT: "invalid", WORKER_INTERNAL_PORT: "4300" })).toBe(4300);
  });

  test("falls back to 4000 when neither variable is valid", () => {
    expect(resolveWorkerInternalPort({})).toBe(4000);
    expect(resolveWorkerInternalPort({ WORKER_INTERNAL_PORT: "", PORT: "4.2e3" })).toBe(4000);
  });

  test("accepts trimmed ASCII decimal integers", () => {
    expect(resolveWorkerInternalPort({ WORKER_INTERNAL_PORT: "  4400\t" })).toBe(4400);
  });

  test("accepts only ports from 1 through 65535", () => {
    expect(resolveWorkerInternalPort({ WORKER_INTERNAL_PORT: "1" })).toBe(1);
    expect(resolveWorkerInternalPort({ WORKER_INTERNAL_PORT: "65535" })).toBe(65535);
    expect(resolveWorkerInternalPort({ WORKER_INTERNAL_PORT: "0", PORT: "5000" })).toBe(5000);
    expect(resolveWorkerInternalPort({ WORKER_INTERNAL_PORT: "65536", PORT: "5001" })).toBe(5001);
    expect(resolveWorkerInternalPort({ WORKER_INTERNAL_PORT: "-1", PORT: "5002" })).toBe(5002);
  });
});
