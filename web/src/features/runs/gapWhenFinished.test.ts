import { describe, expect, it } from "vitest";
import { gapWhenFinished } from "./gapWhenFinished";

const history = [
  { run_id: 1, time: 11.0, finished_at: "2026-11-03T10:00:00Z" },
  { run_id: 2, time: 10.5, finished_at: "2026-11-04T10:00:00Z" },
  { run_id: 3, time: 10.2, finished_at: "2026-11-05T10:00:00Z" },
];

describe("gapWhenFinished", () => {
  it("is what a new record took off the one it beat", () => {
    const gap = gapWhenFinished(
      { id: 3, time: 10.2, finished_at: "2026-11-05T10:00:00Z" },
      history,
    );
    expect(gap).toBeCloseTo(-0.3);
  });

  it("is how far behind the record standing at the time a run was", () => {
    const gap = gapWhenFinished(
      { id: 9, time: 10.6, finished_at: "2026-11-04T12:00:00Z" },
      history,
    );
    expect(gap).toBeCloseTo(0.1);
  });

  it("is new for the board's first record, which beat nothing", () => {
    expect(
      gapWhenFinished(
        { id: 1, time: 11.0, finished_at: "2026-11-03T10:00:00Z" },
        history,
      ),
    ).toBe("new");
  });

  it("is null for a run the history doesn't place", () => {
    expect(
      gapWhenFinished(
        { id: 99, time: 12.0, finished_at: "2026-11-01T10:00:00Z" },
        history,
      ),
    ).toBeNull();
  });
});
