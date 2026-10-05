import { describe, expect, it } from "vitest";
import { runCase } from "../../engine";
import { initialState, toCaseSpec, type FormState } from "../state";

function parse(over: Partial<FormState>) {
  const p = toCaseSpec({ ...initialState(), ...over });
  if (!p.ok) throw new Error(p.errors.join("; "));
  return p.spec;
}

describe("single sentence form: custody, special remission, subsistence", () => {
  it("a debtor's daily rate is carried as whole pesewas and priced (notes Ex 22)", () => {
    const spec = parse({
      dateOfSentence: { d: "11", m: "2", y: "2008" },
      sentence: { days: "", weeks: "", months: "9", years: "" },
      offenceClass: "debt", subsistenceRate: "1.80",
    });
    expect(spec.inputs.subsistence_rate).toBe(180);
    const e = runCase(spec).expect;
    expect(e.dr).toBe("10-11-2008");
    expect(e.subsistence_days).toBe(274);
    expect(e.subsistence_amount).toBe("GH¢493.20");
  });
  it("the rate on the form starts at GH¢5.00 (notes P16 dates, 91 days)", () => {
    const spec = parse({
      dateOfSentence: { d: "10", m: "1", y: "2024" },
      sentence: { days: "", weeks: "", months: "3", years: "" },
      offenceClass: "debt",
    });
    expect(spec.inputs.subsistence_rate).toBe(500);
    const e = runCase(spec).expect;
    expect(e.subsistence_days).toBe(91);
    expect(e.subsistence_amount).toBe("GH¢455.00");
  });
  it("rejects a rate that is not an amount", () => {
    const p = toCaseSpec({
      ...initialState(), dateOfSentence: { d: "1", m: "1", y: "2024" },
      sentence: { days: "", weeks: "", months: "3", years: "" },
      offenceClass: "debt", subsistenceRate: "1,8",
    });
    expect(p.ok).toBe(false);
  });
  it("preventive custody earns one sixth after a year off (notes P6)", () => {
    const spec = parse({
      dateOfSentence: { d: "4", m: "3", y: "2016" },
      sentence: { days: "", weeks: "", months: "", years: "15" },
      offenceClass: "robbery", custody: "preventive",
    });
    const e = runCase(spec).expect;
    expect(e.epd).toBe("4-11-2028");
    expect(e.licence_period).toBe("2yrs 3mths 27days");
  });
  it("special remission comes off after the add-one line (notes Ex 20)", () => {
    const spec = parse({
      dateOfSentence: { d: "30", m: "11", y: "2005" },
      sentence: { days: "", weeks: "", months: "12", years: "" },
      offenceClass: "robbery", specialDays: "14",
    });
    expect(runCase(spec).expect.epd).toBe("16-7-2006");
  });
});
