import { parseArgs } from "@std/cli/parse-args";

// Edit this array to control which models are evaluated.
const MODELS: string[] = [
  "openai/gpt-oss-20b",
  "google/gemini-2.5-flash",
  "anthropic/claude-4-sonnet",
  "anthropic/claude-3.5-haiku",
  "openai/gpt-4.1-mini",
  "openai/gpt-oss-120b",
  "openai/o4-mini",
  "openai/gpt-5-mini",
];

type ParsedArgs = { evalName: string; repeat: number };

function parseBatchArgs(): ParsedArgs {
  const parsed = parseArgs(Deno.args, { string: ["repeat"], alias: { r: "repeat" } });
  const evalName = (parsed._[0] as string | undefined) ?? undefined;
  if (!evalName) {
    console.error("Usage: deno task batch-eval <evalName> [--repeat=N]");
    Deno.exit(2);
  }
  const repeat = Math.max(1, Number.parseInt((parsed.repeat as string | undefined) ?? "1", 10) || 1);
  return { evalName, repeat };
}

async function runEvalOnceForModel(evalName: string, modelId: string, repeat: number): Promise<number> {
  const evalRunnerPath = new URL("./eval_runner.ts", import.meta.url).pathname;

  const denoArgs = [
    "run",
    "--env-file",
    "--allow-net",
    "--allow-env",
    "--allow-run=npx",
    "--allow-read=./workflows,./secrets.json,./evals",
    "--allow-write=./workflows,./evals",
    evalRunnerPath,
    evalName,
    `--repeat=${repeat}`,
  ];

  const command = new Deno.Command(Deno.execPath(), {
    args: denoArgs,
    stdout: "inherit",
    stderr: "inherit",
    env: { ...Deno.env.toObject(), MODEL_ID: modelId },
  });

  const child = command.spawn();
  const status = await child.status;
  return status.success ? 0 : status.code;
}

if (import.meta.main) {
  const { evalName, repeat } = parseBatchArgs();

  let anyFail = false;
  for (const model of MODELS) {
    console.log("");
    console.log("============================================================");
    console.log(`Running eval '${evalName}' with model '${model}' (repeat=${repeat})`);
    console.log("============================================================");
    const code = await runEvalOnceForModel(evalName, model, repeat);
    if (code !== 0) anyFail = true;
  }

  if (anyFail) Deno.exit(1);
}
