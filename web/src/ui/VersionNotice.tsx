import { useEffect, useState } from "react";
import { BUILD_DATE, ENGINE_VERSION } from "../engine";

interface Remote {
  engine?: string;
  buildDate?: string;
}

/**
 * Task 3.5. If online, fetch /version.json and say so, quietly, when the
 * cached build is behind. Never block use. Also surfaces the service
 * worker's "new version ready" prompt (registerType: "prompt").
 */
export function VersionNotice({ updateReady, onReload }: { updateReady: boolean; onReload: () => void }) {
  const [remote, setRemote] = useState<Remote | null>(null);

  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    const ctrl = new AbortController();
    fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: "no-store", signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Remote | null) => j && setRemote(j))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, []);

  const behind = remote && (remote.buildDate !== BUILD_DATE || remote.engine !== ENGINE_VERSION);
  if (!behind && !updateReady) return null;
  return (
    <p className="chrome notice" role="status">
      {updateReady
        ? "A newer build is ready. "
        : `A newer build is available (built ${remote?.buildDate ?? "later"}, engine ${remote?.engine ?? "?"}). `}
      This one still works.{" "}
      <button type="button" className="link" onClick={onReload}>Reload to update</button>
    </p>
  );
}
