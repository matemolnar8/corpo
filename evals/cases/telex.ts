import type { EvalConfig } from "../eval_runner.ts";

export const config: EvalConfig = {
  workflowName: "telex",
  headless: true,
  verify: (result) => {
    const text = result.finalText ?? "";
    const success = text.includes(
      "Mesteri trollkodással mutatta meg, hogyan kell harcolni Trump ellen",
    );
    return success ? { ok: true } : { ok: false, reason: `Unexpected final text: ${result.finalText}` };
  },
};

export default config;
