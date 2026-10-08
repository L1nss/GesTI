import { describe, expect, it } from "vitest";
import { keepWithinRetention, retentionCutoff } from "./retention.js";

describe("three-month data retention", () => {
  it("uses calendar months and removes records older than the cutoff", () => {
    const now = new Date("2026-10-07T12:00:00.000Z");
    const cutoff = retentionCutoff(now);
    expect(new Date(cutoff).toISOString()).toBe("2026-07-07T12:00:00.000Z");
    expect(keepWithinRetention([
      { id: "old", created_at: "2026-07-06T23:59:59.000Z" },
      { id: "fresh", created_at: "2026-07-07T12:00:00.000Z" },
    ], now).map((record) => record.id)).toEqual(["fresh"]);
  });

  it("preserves legacy records whose age cannot be determined", () => {
    expect(keepWithinRetention([{ id: "legacy" }], new Date("2026-10-07T12:00:00Z"))).toEqual([{ id: "legacy" }]);
  });

  it("clamps month-end dates instead of rolling into a later month", () => {
    expect(new Date(retentionCutoff(new Date("2026-05-31T12:00:00.000Z"))).toISOString()).toBe("2026-02-28T12:00:00.000Z");
  });
});
