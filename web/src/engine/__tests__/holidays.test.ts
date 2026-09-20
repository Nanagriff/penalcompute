/** Task 2.9: the working-day layer and its asymmetry (A6, R7.4). */
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
  it("an EPD on 25 December moves FORWARD to the 27th or later", () => {
    const r = dischargeDate(regDate(25, 12, 2025), false);
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.direction).toBe("forward (EPD)");
    expect(r.reason).toBe("Christmas Day");
    expect(r.discharge >= "2025-12-27").toBe(true);
    expect(r.discharge).toBe("2025-12-29"); // 26 Boxing Day, 27/28 weekend
    expect(r.weekday).toBe("Monday");
    expect(r.movedDays).toBe(4);
    expect(r.provisional).toBe(false);
  });
  it("an LPD on 25 December moves BACKWARD to the 24th or earlier (R7.4)", () => {
    const r = dischargeDate(regDate(25, 12, 2025), true);
    if ("error" in r) throw new Error(r.error);
    expect(r.direction).toBe("backward (LPD, R7.4)");
    expect(r.discharge <= "2025-12-24").toBe(true);
    expect(r.discharge).toBe("2025-12-24");
    expect(r.movedDays).toBe(1);
  });
  it("a date beyond the confirmed calendar is provisional", () => {
    const r = dischargeDate(regDate(3, 3, 2031), false);
    if ("error" in r) throw new Error(r.error);
    expect(r.provisional).toBe(true);
    expect(r.note).toContain(String(CALENDAR_CONFIRMED_THROUGH));
    expect(r.note).toContain("Eid");
  });
  it("a working day does not move", () => {
    const r = dischargeDate(regDate(16, 11, 2006), false);
    if ("error" in r) throw new Error(r.error);
    expect(r.discharge).toBe("2006-11-16");
    expect(r.movedDays).toBe(0);
    expect(r.reason).toBeNull();
  });
  it("two-digit years are read as 19xx, as the booklet writes them", () => {
    const r = dischargeDate(regDate(1, 2, 72), false);
    if ("error" in r) throw new Error(r.error);
    expect(r.computed).toBe("1972-02-01");
  });
  it("an impossible date is an error, not a silent normalisation", () => {
    expect(dischargeDate(regDate(30, 2, 2007), false)).toEqual({ error: "30-2-2007 is not a real date" });
  });
});
