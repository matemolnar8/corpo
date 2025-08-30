import type { EvalConfig } from "../eval_runner.ts";

export const config: EvalConfig = {
  workflowName: "is_my_computer_on",
  headless: true,
  verify: (result) => {
    const text = (result.finalText ?? "").toLowerCase();
    const ok = text.includes("yes") || text.includes("on");
    return ok ? { ok: true } : { ok: false, reason: `Unexpected final text: ${result.finalText}` };
  },
};

export default config;
