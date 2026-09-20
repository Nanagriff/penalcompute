import { useState } from "react";
import { BUILD_DATE, ENGINE_VERSION, RULESET_VERSION, format, type CaseSpec, type Result } from "../engine";
import { DateFields } from "./fields";
import { emptyDate, type DateInput } from "./state";
import { reviewerToken, submitFeedback, type SendOutcome } from "./feedbackClient";

interface Props {
  spec: CaseSpec;
  result: Result;
}

const dateStr = (v: DateInput) => `${v.d.trim()}-${v.m.trim()}-${v.y.trim()}`;
const dateOk = (v: DateInput) => /^\d{1,2}$/.test(v.d.trim()) && /^\d{1,2}$/.test(v.m.trim()) && /^\d{1,4}$/.test(v.y.trim());

/** Task 4.2: "This answer is wrong". */
export function Feedback({ spec, result }: Props) {
  const [open, setOpen] = useState(false);
  const [lpd, setLpd] = useState<DateInput>(emptyDate());
  const [epd, setEpd] = useState<DateInput>(emptyDate());
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState<SendOutcome | "sending" | "invalid" | null>(null);

  const engineLpd = result.lpd ? format(result.lpd) : null;
  const engineEpd = result.epd ? format(result.epd) : result.dr ? format(result.dr) : null;

  async function send() {
    if (!dateOk(lpd) && !dateOk(epd)) {
      setStatus("invalid");
      return;
    }
    setStatus("sending");
    const outcome = await submitFeedback({
      reviewer_token: reviewerToken() || null,
      engine_version: ENGINE_VERSION,
      ruleset_version: RULESET_VERSION,
      build_date: BUILD_DATE,
      scenario: spec.scenario,
      inputs: { ...spec.inputs, policy: spec.policy ?? {} },
      engine_lpd: engineLpd,
      engine_epd: engineEpd,
      reviewer_lpd: dateOk(lpd) ? dateStr(lpd) : "",
      reviewer_epd: dateOk(epd) ? dateStr(epd) : "",
      comment: comment.slice(0, 2000),
    });
    setStatus(outcome);
  }

  if (status === "sent" || status === "queued") {
    return (
      <p className="chrome feedback-done" role="status">
        {status === "sent"
          ? "Reported: this answer is wrong. Your LPD and EPD have been recorded for review."
          : "Reported: this answer is wrong. You are offline, so it will be sent when the connection returns."}
      </p>
    );
  }

  return (
    <div className="chrome feedback">
      {!open ? (
        <button type="button" className="quiet" onClick={() => setOpen(true)}>This answer is wrong</button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          noValidate
        >
          <p>
            The engine gives LPD <b className="mono">{engineLpd ?? "none"}</b> and EPD{" "}
            <b className="mono">{engineEpd ?? "none"}</b>. Enter the dates from your own working.
            Only the abstract inputs, the two answers, the versions and your reason are sent.
          </p>
          <DateFields legend="Your LPD" value={lpd} onChange={setLpd} />
          <DateFields legend="Your EPD or D/R" value={epd} onChange={setEpd} />
          <label className="stack">
            <span>Why the engine is wrong, in your words. Do not include any case details.</span>
            <textarea rows={3} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
          </label>
          {status === "invalid" && <p className="flag" role="alert">Enter at least one of your dates as day, month, year.</p>}
          {status === "rejected" && <p className="flag" role="alert">The server refused the report. Nothing was stored.</p>}
          <div className="row">
            <button type="submit" disabled={status === "sending"}>
              {status === "sending" ? "Sending" : "Report this answer as wrong"}
            </button>
            <button type="button" className="quiet" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
