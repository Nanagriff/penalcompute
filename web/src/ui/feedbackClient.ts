/**
 * Feedback transport (Tasks 4.2, 4.3). One in-memory queue, one retry when
 * the browser comes back online. Nothing is persisted. The payload carries
 * abstract inputs only.
 */
import type { CaseSpec } from "../engine";

export interface FeedbackPayload {
  reviewer_token: string | null;
  engine_version: string;
  ruleset_version: string;
  build_date: string;
  scenario: CaseSpec["scenario"];
  inputs: Record<string, unknown>;
  engine_lpd: string | null;
  engine_epd: string | null;
  reviewer_lpd: string;
  reviewer_epd: string;
  comment: string;
}

export type SendOutcome = "sent" | "queued" | "rejected";

const ENDPOINT = "/feedback";
let token: string | null = null;
const queue: FeedbackPayload[] = [];
let retryArmed = false;

/** Task 4.3: ?r=<token> in the URL, kept in memory for the session only. */
export function reviewerToken(): string | null {
  if (token !== null) return token;
  try {
    const r = new URLSearchParams(window.location.search).get("r");
    token = r && /^[A-Za-z0-9_-]{1,64}$/.test(r) ? r : "";
  } catch {
    token = "";
  }
  return token;
}

async function post(p: FeedbackPayload): Promise<SendOutcome> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p),
  });
  if (res.ok) return "sent";
  if (res.status >= 400 && res.status < 500) return "rejected";
  throw new Error(`HTTP ${res.status}`);
}

function armRetry() {
  if (retryArmed) return;
  retryArmed = true;
  window.addEventListener(
    "online",
    () => {
      retryArmed = false;
      const pending = queue.splice(0);
      for (const p of pending) void post(p).catch(() => undefined); // retry once, then drop
    },
    { once: true },
  );
}

export async function submitFeedback(p: FeedbackPayload): Promise<SendOutcome> {
  try {
    return await post(p);
  } catch {
    queue.push(p);
    armRetry();
    return "queued";
  }
}
