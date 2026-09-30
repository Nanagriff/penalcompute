import { useEffect, useState } from "react";
import {
  getDeferredPrompt, isStandalone, platform, promptInstall, readSnooze, snoozed, subscribe, wasInstalled, writeSnooze,
} from "./install";

type Mode = "native" | "ios" | null;

function decide(): Mode {
  if (__SINGLE_FILE__ || typeof window === "undefined") return null;
  if (isStandalone() || wasInstalled()) return null;
  if (snoozed(readSnooze(), Date.now())) return null;
  if (getDeferredPrompt()) return "native";
  if (platform(navigator.userAgent, navigator.maxTouchPoints) === "ios") return "ios";
  return null;
}

/**
 * A strip under the masthead inviting the officer to keep the tool on the
 * phone. Android gets the browser's own install dialog; iOS gets the two taps
 * it needs, since Safari has no install event.
 */
export function InstallPrompt() {
  const [mode, setMode] = useState<Mode>(decide);
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribe(() => setMode(decide())), []);

  if (!mode) return null;

  function notNow() {
    writeSnooze();
    setMode(null);
  }

  async function install() {
    setBusy(true);
    const ok = await promptInstall();
    setBusy(false);
    if (ok) setMode(null);
    else setMode(decide());
  }

  return (
    <aside className="chrome notice install" role="status" aria-label="Install this tool">
      <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width="40" height="40" className="install-icon" />
      <div className="install-text">
        {mode === "native" ? (
          <p>
            <b>Keep this tool on your phone.</b> It opens like an app from the home screen and works without a signal.
          </p>
        ) : (
          <p>
            <b>Keep this tool on your iPhone.</b> Tap <ShareGlyph /> <b>Share</b> at the bottom of Safari, then <b>Add to Home Screen</b>.
          </p>
        )}
      </div>
      <div className="install-actions">
        {mode === "native" && (
          <button type="button" className="install-button" onClick={install} disabled={busy}>
            {busy ? "Opening" : "Install"}
          </button>
        )}
        <button type="button" className="link" onClick={notNow}>Not now</button>
      </div>
    </aside>
  );
}

/** The iOS share glyph: a box with an arrow rising out of it. */
function ShareGlyph() {
  return (
    <svg className="share-glyph" viewBox="0 0 20 24" width="14" height="17" aria-hidden="true" focusable="false">
      <path d="M10 2 L10 14 M6 6 L10 2 L14 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 10 H3 V22 H17 V10 H14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
