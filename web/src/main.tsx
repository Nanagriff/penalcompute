import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/app.css";

function Root() {
  const [updateReady, setUpdateReady] = useState(false);
  const [reload, setReload] = useState<() => void>(() => () => window.location.reload());

  if (!__SINGLE_FILE__ && !Root.registered) {
    Root.registered = true;
    // registerType: "prompt": the new worker waits until the officer chooses to reload.
    import("virtual:pwa-register")
      .then(({ registerSW }) => {
        const update = registerSW({
          immediate: true,
          onNeedRefresh() {
            setReload(() => () => void update(true));
            setUpdateReady(true);
          },
        });
      })
      .catch(() => undefined);
  }

  return <App updateReady={updateReady} onReload={reload} />;
}
Root.registered = false;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
