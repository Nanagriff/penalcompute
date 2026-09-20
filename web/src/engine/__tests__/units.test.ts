/** Unit tests for the acceptance criteria of Tasks 2.1 to 2.8. */
import { describe, expect, it } from "vitest";
import {
  BUILD_DATE, Duration, ENGINE_VERSION, RULESET_VERSION, clampBack, dateDiff, format,
  isLeap, monthLen, oneThird, regDate, remissionFor, rollForward, rollForwardTrace,
  simple, subDays,
} from "../index";

describe("Task 2.1 calendar (R2.4)", () => {
  it("February under the true rule", () => {
    expect(monthLen(2, 1972)).toBe(29);
    expect(monthLen(2, 1973)).toBe(28);
    expect(monthLen(2, 1976)).toBe(29);
    expect(monthLen(2, 2000)).toBe(29);
    expect(monthLen(2, 1900)).toBe(28);
    expect(monthLen(2, 2100)).toBe(28);
  });
  it("February under the booklet's divide-by-4 rule", () => {
    expect(isLeap(1900, "divideBy4")).toBe(true);
    expect(isLeap(2100, "divideBy4")).toBe(true);
    expect(monthLen(2, 1900, "divideBy4")).toBe(29);
    expect(isLeap(1973, "divideBy4")).toBe(false);
  });
  it("the two rules agree for 1901-2099", () => {
    for (let y = 1901; y <= 2099; y++) expect(isLeap(y)).toBe(isLeap(y, "divideBy4"));
  });
});

describe("Task 2.2 regdate", () => {
  it("R4.2 rolls forward through the month named in the date, one month per step", () => {
    const trace = rollForwardTrace(regDate(106, 11, 2005)).map(format);
    expect(trace).toEqual(["106-11-2005", "76-12-2005", "45-1-2006", "14-2-2006"]);
    expect(format(rollForward(regDate(106, 11, 2005)))).toBe("14-2-2006");
  });
  it("R4.3 borrows the preceding month: 1-3-72 less 1 day is 29-2-72", () => {
    expect(format(subDays(regDate(1, 3, 72), 1))).toBe("29-2-72");
  });
  it("R4.4 / R4.5 clamps and renders the notional in brackets", () => {
    expect(format(clampBack(regDate(30, 2, 73)))).toBe("28(30)-2-73");
    expect(format(clampBack(regDate(28, 2, 73)))).toBe("28-2-73");
  });
  it("rejects non-integers (standing rule 3)", () => {
    expect(() => regDate(1.5, 1, 2000)).toThrow(TypeError);
    expect(() => new Duration(0.5)).toThrow(TypeError);
  });
});

describe("Task 2.3 duration", () => {
  it("R4.8 dateDiff borrows February 2007", () => {
    const served = dateDiff(regDate(10, 3, 2007), regDate(15, 12, 2006));
    expect(served.format()).toBe("2mths 23days");
    expect(Duration.of({ years: 2 }).sub(served).format()).toBe("1yr 9mths 7days");
  });
  it("R2.2 / R2.3 conversions", () => {
    expect(Duration.of({ weeks: 5, days: 2 }).days).toBe(37);
    expect(Duration.of({ years: 1, months: 2, days: 3 }).totalDays).toBe(423);
    expect(Duration.fromDays(423).format()).toBe("1yr 2mths 3days");
    expect(new Duration().format()).toBe("nil");
  });
  it("columns are right-aligned register cells", () => {
    expect(Duration.of({ days: 37 }).columns()).toBe("  37               ");
    expect(Duration.of({ years: 1, months: 2, days: 3 }).columns()).toBe("   3      2       1");
  });
});

describe("Task 2.4 remission", () => {
  it("R6.4 rounding on the integer remainder", () => {
    expect(oneThird(284)).toBe(95);
    expect(oneThird(100)).toBe(33);
    expect(oneThird(1766)).toBe(589);
    expect(oneThird(4411)).toBe(1470);
  });
  it("R6.7 a 100-day sentence keeps its remission in days", () => {
    const [rem, note] = remissionFor(Duration.of({ days: 100 }), "stealing");
    expect(rem.format()).toBe("33days");
    expect(rem.format()).not.toBe("1mth 3days");
    expect(note).toBe("one-third remission (R6.3)");
  });
  it("R6.7 a sentence in months takes it in months and days", () => {
    const [rem] = remissionFor(Duration.of({ months: 9, days: 14 }), "assault");
    expect(rem.format()).toBe("3mths 5days");
  });
  it("R6.1 / R6.2 thresholds", () => {
    expect(remissionFor(Duration.of({ days: 30 }))[0].totalDays).toBe(0);
    expect(remissionFor(Duration.of({ days: 31 }))[0].format()).toBe("1day");
    expect(remissionFor(Duration.of({ days: 41 }))[0].format()).toBe("11days");
    expect(remissionFor(Duration.of({ days: 42 }))[0].format()).toBe("14days");
    expect(remissionFor(Duration.of({ years: 3 }), "debt")[0].totalDays).toBe(0);
  });
});

describe("Task 2.5 compute render", () => {
  it("is character-identical to the Python render for 17-10-2006, 37 days, stealing", () => {
    const r = simple(regDate(17, 10, 2006), Duration.of({ weeks: 5, days: 2 }), "stealing");
    const python =
      "    17-10-2006   D/S\n" +
      "  37                  S\n" +
      "                 ----------------------------------\n" +
      "    54-10-2006   \n" +
      "            31   Oct\n" +
      "                 ----------------------------------\n" +
      "    23-11-2006   \n" +
      "             1   Grace\n" +
      "                 ----------------------------------\n" +
      "    22-11-2006   LPD\n" +
      "   7                  Rem on 37days\n" +
      "                 ----------------------------------\n" +
      "    15-11-2006   \n" +
      "             1   Add\n" +
      "                 ----------------------------------\n" +
      "    16-11-2006   EPD";
    expect(r.render()).toBe(python);
  });
});

describe("Task 2.8 version", () => {
  it("stamps the result and the rendered output", () => {
    const r = simple(regDate(17, 10, 2006), Duration.of({ days: 37 }), "stealing");
    expect(r.version).toEqual({ engine: ENGINE_VERSION, ruleset: RULESET_VERSION, buildDate: BUILD_DATE });
    expect(RULESET_VERSION).toBe("booklet-as-supplied-2026-09");
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    const out = r.renderStamped();
    expect(out.startsWith(r.render())).toBe(true);
    expect(out).toContain(ENGINE_VERSION);
    expect(out).toContain(RULESET_VERSION);
    expect(out).toContain(BUILD_DATE);
  });
});
