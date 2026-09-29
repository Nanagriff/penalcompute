/**
 * Usage counts. Each press of Compute is recorded as the kind of computation,
 * the time and the version: never a date, a sentence or any other input. The
 * server has no field that could hold one (api/main.py, UsageEvent).
 *
 * Counts made offline wait in localStorage and go out with the next one that
 * finds the network. A device is told apart from another by a random id made
 * in this browser; it says nothing about who is using it.
 *
 * Every failure here is silent. Counting must never get in the way of a
 * computation.
 */
import { BUILD_DATE, ENGINE_VERSION, RULESET_VERSION, type CaseSpec } from "../engine";

export interface UsageEvent {
  scenario: CaseSpec["scenario"];
  at: string;
  ok: boolean;
  offline: boolean;
  engine_version: string;
  ruleset_version: string;
  build_date: string;
}

const ENDPOINT = "/usage";
const QUEUE_KEY = "computation.usage.queue";
const DEVICE_KEY = "computation.usage.device";
const MAX_QUEUE = 500;
const BATCH = 100;

let sending = false;
let listening = false;
let memoryDevice: string | null = null;

function store(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readQueue(): UsageEvent[] {
  try {
    const raw = store()?.getItem(QUEUE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as UsageEvent[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(q: UsageEvent[]): void {
  try {
    const s = store();
    if (!s) return;
    if (q.length) s.setItem(QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE)));
    else s.removeItem(QUEUE_KEY);
  } catch {
    /* storage full or blocked: the count is lost, the computation is not */
  }
}

function randomId(): string {
  const c = typeof crypto === "undefined" ? undefined : crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function deviceId(): string {
  try {
    const s = store();
    const kept = s?.getItem(DEVICE_KEY);
    if (kept && /^[A-Za-z0-9-]{8,64}$/.test(kept)) return kept;
    const made = randomId();
    s?.setItem(DEVICE_KEY, made);
    if (s) return made;
  } catch {
    /* fall through to the id kept in memory */
  }
  memoryDevice = memoryDevice ?? randomId();
  return memoryDevice;
}

function installed(): boolean {
  try {
    return window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    return false;
  }
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** Send what is waiting, oldest first, a batch at a time. Stops at the first failure. */
export async function flushUsage(): Promise<void> {
  if (__SINGLE_FILE__ || sending || isOffline()) return;
  sending = true;
  try {
    for (;;) {
      const queue = readQueue();
      if (!queue.length) return;
      const batch = queue.slice(0, BATCH);
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: deviceId(), installed: installed(), events: batch }),
        keepalive: true,
      });
      // 422: the server will never take this batch, so drop it. Anything else that
      // is not a success (429, 5xx): keep it for the next attempt.
      if (!res.ok && res.status !== 422) return;
      writeQueue(readQueue().slice(batch.length));
    }
  } catch {
    /* no network after all: the queue is still in storage */
  } finally {
    sending = false;
  }
}

/** Record one press of Compute. `ok` is false when the engine refused the order. */
export function recordUse(scenario: CaseSpec["scenario"], ok: boolean): void {
  if (__SINGLE_FILE__) return;
  try {
    const event: UsageEvent = {
      scenario,
      at: new Date().toISOString().slice(0, 19) + "Z",
      ok,
      offline: isOffline(),
      engine_version: ENGINE_VERSION,
      ruleset_version: RULESET_VERSION,
      build_date: BUILD_DATE,
    };
    writeQueue([...readQueue(), event]);
    startUsage();
    void flushUsage();
  } catch {
    /* never in the way */
  }
}

/** Send anything left from an earlier offline session, now and whenever the network returns. */
export function startUsage(): void {
  if (__SINGLE_FILE__ || listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("online", () => void flushUsage());
  void flushUsage();
}
