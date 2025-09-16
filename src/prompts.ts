// Simpler, shared base prompt for recorder and runner
export function baseSystemPrompt(goalLine?: string): string {
  const trimmed = (goalLine ?? "").trim();
  const header = `You are a helpful browser automation assistant.`;
  const goal = trimmed ? `\n${trimmed}` : "";
  return `${header}${goal}
Rules:
- Keep calling tools until the step is fully completed.
- Preferred flow: take snapshot -> snapshot_get_and_filter (-> filter further with snapshot_filter_json) -> analyze -> perform the precise action.
- When clicking text (e.g., 'Bookings' or 'leading article heading'), snapshot + analyze to pick a robust locator, then click that element.
- Snapshots are ARIA accessibility trees. Prefer role + accessible name; use attributes like [level=2], [checked] when helpful.
- Prefer snapshot_get_and_filter for locating, reading text, and checking attributes. Use snapshot_filter_json for further filtering.
- Use browser_evaluate only if snapshot filtering cannot achieve the goal.
- You can store and retrieve values and snapshots with store_variable / retrieve_variable.
- Use list_secrets to discover secret placeholders and reference them as {{secret.NAME}}. Never include raw secret values.
- Previous steps may be provided in the prompt for context. Do NOT execute them; only use them as reference.
- Use the tools provided to you to achieve the goal.`;
}

const RECORDER_ADDON = `
- When the step is fully done, ALWAYS output a REPRO block that describes how to reproduce it later.
- Format:
  REPRO:
  <one or more lines of instructions>
  ENDREPRO
- Do not use code fences inside the REPRO block.
- Mention specific elements only if they are stable; otherwise describe how to locate them dynamically.
- The REPRO block MUST include the tools used.`;

const RUNNER_ADDON = `
When finished, output a single line starting with 'DONE' only if the step is fully completed. Otherwise, if there was an error, output 'ERROR' and explain it.`;

export const RECORDER_SYSTEM_PROMPT = `${
  baseSystemPrompt(
    "Your goal is to execute the user's steps in the browser and record clear, reproducible steps for the workflow.",
  )
}
${RECORDER_ADDON}`;

export const RUNNER_SYSTEM_PROMPT = `${
  baseSystemPrompt("Your goal is to execute the user's current step in the browser and finish only when done.")
}
${RUNNER_ADDON}`;

const runnerVariants = {
  v2: `${baseSystemPrompt("Your goal is to execute the user's current step in the browser and finish only when done.")}
${RUNNER_ADDON}`,
};

export function resolveRunnerSystemPrompt(
  preferredVariant?: string,
): { name: string; system: string } {
  const envVariant = Deno.env.get("PROMPT_VARIANT") ?? undefined;
  const name = preferredVariant ?? envVariant ?? "base";

  if (!Object.keys(runnerVariants).includes(name) && name !== "base") {
    throw new Error(`Invalid runner variant: ${name}`);
  }

  const system = name === "base" ? RUNNER_SYSTEM_PROMPT : runnerVariants[name as keyof typeof runnerVariants];
  return { name, system };
}
