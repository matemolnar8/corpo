import type { EvalConfig } from "../eval_runner.ts";

export const config: EvalConfig = {
  workflowName: "telex",
  headless: true,
  verify: (result) => {
    const text = result.finalText ?? "";
    const success = text.includes(
      "Méregdrága hibákat okozhat a rosszul megválasztott motorolaj az utóbbi 15 év benzines autóiban",
    );
    return success ? { ok: true } : { ok: false, reason: `Unexpected final text: ${result.finalText}` };
  },
};

export default config;
