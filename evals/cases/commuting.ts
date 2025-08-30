import type { EvalConfig } from "../eval_runner.ts";

const days = [3, 7, 9, 10, 14, 16, 17, 21, 23, 24, 28, 29, 30, 31];

export const config: EvalConfig = {
  workflowName: "commuting_202507",
  headless: false,
  verify: (result) => {
    const text = (result.finalText ?? "").toLowerCase();
    const ok = days.every((day) => text.includes(day.toString()));
    return ok ? { ok: true } : { ok: false, reason: `Unexpected final text: ${result.finalText}` };
  },
};

export default config;
