import { describe, expect, it } from "bun:test";
import { scheduleNextAnimationFrame } from "../../../../web/src/components/ui/animationLoop";

describe("scheduleNextAnimationFrame", () => {
  it("runs the current callback when the scheduled frame executes", () => {
    let scheduledFrame: FrameRequestCallback | undefined;
    let calls = 0;

    const frameId = scheduleNextAnimationFrame(
      (callback) => {
        scheduledFrame = callback;
        return 42;
      },
      () => () => {
        calls += 1;
      },
    );

    scheduledFrame?.(0);

    expect(frameId).toBe(42);
    expect(calls).toBe(1);
  });

  it("uses the latest callback instead of a stale animation closure", () => {
    let scheduledFrame: FrameRequestCallback | undefined;
    let currentCallback = () => "initial";
    let result = "";

    scheduleNextAnimationFrame(
      (callback) => {
        scheduledFrame = callback;
        return 1;
      },
      () => currentCallback,
    );
    currentCallback = () => {
      result = "latest";
      return result;
    };

    scheduledFrame?.(0);

    expect(result).toBe("latest");
  });
});
