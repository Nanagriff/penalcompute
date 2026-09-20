import { useState } from "react";
import { runCase, type CaseOutcome, type CaseSpec, versionLine } from "./engine";
import { Form } from "./ui/Form";
import { ResultView } from "./ui/ResultView";
import { VersionNotice } from "./ui/VersionNotice";
import { initialState, toCaseSpec, type FormState } from "./ui/state";

interface Computed {
  spec: CaseSpec;
  outcome: CaseOutcome;
  sex: string;
}

export function App({ updateReady, onReload }: { updateReady: boolean; onReload: () => void }) {
  const [state, setState] = useState<FormState>(initialState);
  const [errors, setErrors] = useState<string[]>([]);
  const [computed, setComputed] = useState<Computed | null>(null);

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
      setComputed({ spec: parsed.spec, outcome, sex: parsed.sex });
    } catch (e) {
      setErrors([e instanceof Error ? e.message : String(e)]);
      setComputed(null);
    }
  }

  function clear() {
    setState(initialState());
    setErrors([]);
    setComputed(null);
  }

  return (
    <main>
      <header className="chrome">
        <h1>Sentence computation</h1>
        <p className="sub">Ghana Prisons Service register working, line by line. Offline once loaded.</p>
      </header>
      <VersionNotice updateReady={updateReady} onReload={onReload} />
      <Form state={state} onChange={(s) => { setState(s); }} onCompute={compute} onClear={clear} errors={errors} />
      {computed && <ResultView spec={computed.spec} outcome={computed.outcome} sex={computed.sex} />}
      <footer className="chrome">
        <p>{versionLine()}</p>
        <p>
          Every line carries its rule number from RULES.md. Where the booklet gives two answers the
          engine shows both and flags it; it never resolves an ambiguity silently.
        </p>
      </footer>
    </main>
  );
}
