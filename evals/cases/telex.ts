import type { EvalConfig } from "../eval_runner.ts";

export const config: EvalConfig = {
  workflowName: "telex",
  headless: true,
  verify: (result) => {
    const text = result.finalText ?? "";
    const success = text.includes(
      "Idejönnek az emberek, isznak, drogoznak, és azt gondolják, az élet csak egy buli",
    );
    return success ? { ok: true } : { ok: false, reason: `Unexpected final text: ${result.finalText}` };
  },
};

export default config;
