// Batch eval runner: runs a specific eval across a hardcoded list of models by
// spawning the single-eval runner in a fresh Deno process per model.

// Edit this array to control which models are evaluated.
const MODELS: string[] = [
  "google/gemini-2.5-flash",
  "anthropic/claude-3.7-sonnet",
  "openai/gpt-4.1-mini",
  "openai/gpt-oss-120b",
  "openai/gpt-5-nano",
  "openai/gpt-5-mini",
  "deepseek/deepseek-chat-v3.1",
  "moonshotai/kimi-k2",
];

type ParsedArgs = {
  evalName: string;
  repeat: number;
};

function parseArgs(): ParsedArgs {
  const [evalName, ...rest] = Deno.args;
  if (!evalName) {
    console.error("Usage: deno task batch-eval <evalName> [--repeat=N]");
    Deno.exit(2);
  }

  const args = new Map<string, string>();
  for (const a of rest) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) args.set(m[1], m[2]);
  }

  const repeat = Math.max(1, Number.parseInt(args.get("repeat") ?? "1", 10) || 1);

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
  const { evalName, repeat } = parseArgs();

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
