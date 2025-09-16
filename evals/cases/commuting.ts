import type { EvalConfig } from "../eval_runner.ts";

const days = [11, 12, 13, 14, 25, 27, 28];

export const config: EvalConfig = {
  workflowName: "commuting4_fixed",
  headless: true,
  verify: (result) => {
    const text = (result.finalText ?? "").toLowerCase();
    const ok = days.every((day) => text.includes(day.toString()));
    return ok ? { ok: true } : { ok: false, reason: `Unexpected final text: ${result.finalText}` };
  },
};

export default config;
