import type { EvalConfig } from "../eval_runner.ts";

export const config: EvalConfig = {
  workflowName: "telex",
  headless: true,
  verify: (result) => {
    const text = result.finalText ?? "";
    const success = text.includes(
      "Nem biztos, hogy érdemes a mobilos adatokra hivatkozva dicsekedni arról, hányan nézték a tűzijátékot",
    );
    return success ? { ok: true } : { ok: false, reason: `Unexpected final text: ${result.finalText}` };
  },
};

export default config;
