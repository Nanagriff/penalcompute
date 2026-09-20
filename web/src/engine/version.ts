/**
 * Version stamps. Every result and every feedback payload carries all three.
 * BUILD_DATE is injected by Vite's `define` at build time; in Node or a test
 * run it falls back to "dev".
 */
declare const __BUILD_DATE__: string | undefined;

export const ENGINE_VERSION = "1.0.0";
export const RULESET_VERSION = "booklet-as-supplied-2026-09";
export const BUILD_DATE: string = typeof __BUILD_DATE__ === "string" ? __BUILD_DATE__ : "dev";

export interface VersionStamp {
  readonly engine: string;
  readonly ruleset: string;
  readonly buildDate: string;
}

export const VERSION: VersionStamp = Object.freeze({
  engine: ENGINE_VERSION,
  ruleset: RULESET_VERSION,
  buildDate: BUILD_DATE,
});

export function versionLine(): string {
  return `engine ${ENGINE_VERSION} · rules ${RULESET_VERSION} · build ${BUILD_DATE}`;
}
