import { useEffect, useRef, useState } from "react";
import { runCase, type CaseOutcome, type CaseSpec } from "./engine";
import { Form } from "./ui/Form";
import { ResultView } from "./ui/ResultView";
import { VersionNotice } from "./ui/VersionNotice";
import { InstallPrompt } from "./ui/InstallPrompt";
import { initialState, toCaseSpec, type FormState, type Recorded } from "./ui/state";
import { recordUse, startUsage } from "./ui/usageClient";

interface Computed {
  spec: CaseSpec;
  outcome: CaseOutcome;
  sex: string;
  recorded: Recorded;
}

export function App({ updateReady, onReload }: { updateReady: boolean; onReload: () => void }) {
  const [state, setState] = useState<FormState>(initialState);
  const [errors, setErrors] = useState<string[]>([]);
  const [computed, setComputed] = useState<Computed | null>(null);
  const [runs, setRuns] = useState(0);
  const resultRef = useRef<HTMLDivElement>(null);

  function compute() {
    const parsed = toCaseSpec(state);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      setComputed(null);
      return;
    }
    try {
      const outcome = runCase(parsed.spec);
      setErrors([]);
      setComputed({ spec: parsed.spec, outcome, sex: parsed.sex, recorded: parsed.recorded });
      setRuns((n) => n + 1);
      recordUse(parsed.spec.scenario, true);
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)]);
      setComputed(null);
      recordUse(parsed.spec.scenario, false);
    }
  }

  // Counts made while offline in an earlier session go out once the network is there.
  useEffect(() => {
    startUsage();
  }, []);

  // On a phone the form fills the screen, so bring the working into view once it exists.
  useEffect(() => {
    if (runs === 0 || !resultRef.current) return;
    if (window.matchMedia("(min-width: 60rem)").matches) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    resultRef.current.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, [runs]);

  function clear() {
    setState(initialState());
    setErrors([]);
    setComputed(null);
  }

  return (
    <>
      <header className="chrome masthead">
        <div className="wrap">
          <p className="service">Ghana Prisons Service</p>
          <h1>Sentence computation</h1>
          <p className="sub">
            The system works with computational rules behind it.
            It works offline once loaded.
          </p>
        </div>
      </header>
      <main>
        <VersionNotice updateReady={updateReady} onReload={onReload} />
        <InstallPrompt />
        <div className="columns">
          <Form state={state} onChange={(s) => { setState(s); }} onCompute={compute} onClear={clear} errors={errors} />
          <div className={computed ? "output sheet" : "output sheet is-empty"} ref={resultRef}>
            {computed ? (
              <ResultView key={runs} spec={computed.spec} outcome={computed.outcome} sex={computed.sex} recorded={computed.recorded} />
            ) : (
              <div className="chrome empty">
                <h2 className="sheet-title">How to use</h2>
                <ol>
                  <li>Choose the type of order.</li>
                  <li>Enter the date of sentence as written on the warrant.</li>
                  <li>Enter the sentence and choose the offence class.</li>
                  <li>Press <b>Compute</b>.</li>
                </ol>
                <p>
                  The working is shown step by step, so that the receptionist can verify it
                  against their own computation.
                </p>
                <p>
                  It can be printed, in case it needs to be attached to the Form 88.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
      <footer className="chrome">
        <div className="wrap">
          <p className="credit">Developed by Officer Cadet Course Intake 36</p>
          <p>
            Nothing typed here leaves this device unless you report an answer as wrong.
            The kind of computation and the version are counted, to show how the tool is used.
          </p>
        </div>
      </footer>
    </>
  );
}
