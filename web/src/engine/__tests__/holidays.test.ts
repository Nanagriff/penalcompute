/** Task 2.9: the release-day layer (R9.1). */
import { describe, expect, it } from "vitest";
import { CALENDAR_CONFIRMED_THROUGH, dischargeDate, easter, holidays, regDate } from "../index";

describe("Task 2.9 holidays", () => {
  it("Easter", () => {
    expect(easter(2024).toISOString().slice(0, 10)).toBe("2024-03-31");
    expect(easter(2025).toISOString().slice(0, 10)).toBe("2025-04-20");
    expect(easter(2026).toISOString().slice(0, 10)).toBe("2026-04-05");
  });
  it("fixed, movable and observed holidays for 2025", () => {
    const h = holidays(2025);
    expect(h.get("2025-01-01")).toBe("New Year's Day");
    expect(h.get("2025-04-18")).toBe("Good Friday");
    expect(h.get("2025-04-21")).toBe("Easter Monday");
    expect(h.get("2025-12-05")).toBe("Farmers' Day");
    expect(h.get("2025-03-06")).toBe("Independence Day");
    // 21 Sep 2025 is a Sunday: observed Monday 22nd
    expect(h.get("2025-09-22")).toBe("Kwame Nkrumah Memorial Day (observed)");
    // Constitution Day did not exist in 2010
    expect(holidays(2010).has("2010-01-07")).toBe(false);
  });
  it("a release on 25 December moves to the day before (R9.1)", () => {
    const r = dischargeDate(regDate(25, 12, 2025));
    if ("error" in r) throw new Error(r.error);
    expect(r.direction).toBe("backward (R9.1)");
    expect(r.reason).toBe("Christmas Day");
    expect(r.discharge).toBe("2025-12-24");
    expect(r.weekday).toBe("Wednesday");
    expect(r.movedDays).toBe(1);
    expect(r.provisional).toBe(false);
  });
  it("a Sunday moves to the Saturday, and a Saturday does not move (R9.1)", () => {
    const sun = dischargeDate(regDate(16, 11, 2025));
    if ("error" in sun) throw new Error(sun.error);
    expect(sun.reason).toBe("Sunday");
    expect(sun.discharge).toBe("2025-11-15");
    expect(sun.weekday).toBe("Saturday");
    const sat = dischargeDate(regDate(15, 11, 2025));
    if ("error" in sat) throw new Error(sat.error);
    expect(sat.movedDays).toBe(0);
  });
  it("Christmas then Boxing Day: keeps stepping back to the 24th", () => {
    const r = dischargeDate(regDate(26, 12, 2025));
    if ("error" in r) throw new Error(r.error);
    expect(r.reason).toBe("Boxing Day");
    expect(r.discharge).toBe("2025-12-24");
    expect(r.movedDays).toBe(2);
  });
  it("a holiday observed on Monday after a Sunday moves back to the Saturday", () => {
    // 21 Sep 2025 is a Sunday holiday, observed Monday 22nd
    const r = dischargeDate(regDate(22, 9, 2025));
    if ("error" in r) throw new Error(r.error);
    expect(r.discharge).toBe("2025-09-20");
    expect(r.movedDays).toBe(2);
  });
  it("a date beyond the confirmed calendar is provisional", () => {
    const r = dischargeDate(regDate(3, 3, 2031));
    if ("error" in r) throw new Error(r.error);
    expect(r.provisional).toBe(true);
    expect(r.note).toContain(String(CALENDAR_CONFIRMED_THROUGH));
    expect(r.note).toContain("Eid");
  });
  it("an ordinary day does not move", () => {
    const r = dischargeDate(regDate(16, 11, 2006));
    if ("error" in r) throw new Error(r.error);
    expect(r.discharge).toBe("2006-11-16");
    expect(r.movedDays).toBe(0);
    expect(r.reason).toBeNull();
  });
  it("two-digit years are read as 19xx, as the booklet writes them", () => {
    const r = dischargeDate(regDate(1, 2, 72));
    if ("error" in r) throw new Error(r.error);
    expect(r.computed).toBe("1972-02-01");
  });
  it("an impossible date is an error, not a silent normalisation", () => {
    expect(dischargeDate(regDate(30, 2, 2007))).toEqual({ error: "30-2-2007 is not a real date" });
  });
});
