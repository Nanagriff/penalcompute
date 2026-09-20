/**
 * Policy switches (RULES.md section 9).
 *
 * Where the booklet is ambiguous the engine carries a switch here and the
 * result carries a flag. The engine never resolves an ambiguity silently.
 */

/** R2.4. "gregorian" is the true rule; "divideBy4" is the booklet's. */
export type LeapRule = "gregorian" | "divideBy4";

/** A1. Rule (h) says "original"; the p.12 worked example uses "residue". */
export type EscapeRemissionBase = "original" | "residue";

export interface Policy {
  readonly leapRule: LeapRule; // R2.4
  readonly monthEndPreservation: boolean; // R4.7, A4
  readonly escapeRemissionBase: EscapeRemissionBase; // A1
}

export const DEFAULT_POLICY: Policy = Object.freeze({
  leapRule: "gregorian",
  monthEndPreservation: true,
  escapeRemissionBase: "original",
});

export function policy(overrides: Partial<Policy> = {}): Policy {
  return Object.freeze({ ...DEFAULT_POLICY, ...overrides });
}
