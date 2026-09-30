/**
 * "Install this tool" support.
 *
 * Android (Chrome, Edge, Samsung Internet) fires `beforeinstallprompt` once the
 * manifest and service worker pass its checks; we keep that event and call its
 * prompt() when the officer presses Install. iOS never fires it: the only way
 * onto the home screen is Share, then Add to Home Screen, so on iOS we show
 * those two steps instead. Nothing is shown once the app is already installed,
 * or for two weeks after "Not now".
 */

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type Platform = "ios" | "android" | "other";

/** iPadOS 13+ reports itself as a Macintosh; the touch points give it away. */
export function platform(userAgent: string, maxTouchPoints = 0): Platform {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  return "other";
}

export const SNOOZE_KEY = "install-prompt-dismissed";
export const SNOOZE_DAYS = 14;

/** True when "Not now" was pressed within the last SNOOZE_DAYS. Bad or missing values mean not snoozed. */
export function snoozed(stored: string | null, now: number): boolean {
  if (!stored) return false;
  const at = Number(stored);
  if (!Number.isFinite(at)) return false;
  return now - at < SNOOZE_DAYS * 86_400_000;
}

export function isStandalone(): boolean {
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
    return (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

export function readSnooze(): string | null {
  try {
    return localStorage.getItem(SNOOZE_KEY);
  } catch {
    return null;
  }
}

export function writeSnooze(now = Date.now()): void {
  try {
    localStorage.setItem(SNOOZE_KEY, String(now));
  } catch {
    /* private mode or full storage: the prompt simply shows again next visit */
  }
}

// The event usually fires before React has mounted, so it is caught here at
// module load and handed to whichever component subscribes later.
let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach((fn) => fn());

export function captureInstallPrompt(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    notify();
  });
}

export function getDeferredPrompt(): BeforeInstallPromptEvent | null {
  return deferred;
}

export function wasInstalled(): boolean {
  return installed;
}

export function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/** Show the native prompt. Resolves true if the officer accepted. */
export async function promptInstall(): Promise<boolean> {
  const ev = deferred;
  if (!ev) return false;
  deferred = null;
  notify();
  try {
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    return outcome === "accepted";
  } catch {
    return false;
  }
}
