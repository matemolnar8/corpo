import { logger } from "../src/log.ts";
// Simple server to host the eval viewer and expose results via HTTP
// Usage: deno run --allow-net --allow-read=./evals evals/server.ts

const root = new URL("./", import.meta.url);
const resultsDir = new URL("./results/", import.meta.url);

function contentType(pathname: string): string {
  if (pathname.endsWith(".html")) return "text/html; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (pathname.endsWith(".json")) return "application/json; charset=utf-8";
  if (pathname.endsWith(".jsonl")) return "application/x-ndjson; charset=utf-8";
  if (pathname.endsWith(".svg")) return "image/svg+xml";
  return "text/plain; charset=utf-8";
}

async function listResults() {
  try {
    const entries: { workflow: string; evalName: string; file: string; size: number }[] = [];
    for await (const entry of Deno.readDir(resultsDir)) {
      if (entry.isFile && entry.name.endsWith(".jsonl")) {
        const st = await Deno.stat(new URL(entry.name, resultsDir));
        const name = entry.name.replace(/\.jsonl$/i, "");
        const [workflow, evalName = "unknown"] = name.split(/__/, 2);
        entries.push({ workflow, evalName, file: entry.name, size: st.size });
      }
    }
    entries.sort((a, b) => a.workflow.localeCompare(b.workflow) || a.evalName.localeCompare(b.evalName));
    return {
      workflows: Array.from(new Set(entries.map((e) => e.workflow))),
      evals: Array.from(new Set(entries.map((e) => e.evalName))),
      files: entries,
    };
  } catch {
    return { workflows: [], evals: [], files: [] };
  }
}

async function readResults(name: string) {
  const fileUrl = new URL(`./${name}.jsonl`, resultsDir);
  try {
    const text = await Deno.readTextFile(fileUrl);
    const lines = text.split(/\n+/).filter(Boolean);
    const [workflow, evalName = "unknown"] = name.split(/__/, 2);
    const arr = lines.map((l) => {
      try {
        const obj = JSON.parse(l);
        if (obj && typeof obj === "object") {
          (obj as Record<string, unknown>).evalName = evalName;
          (obj as Record<string, unknown>).workflowFileBase = name;
          if (!(obj as Record<string, unknown>).workflowName) {
            (obj as Record<string, unknown>).workflowName = workflow;
          }
        }
        return obj;
      } catch {
        return null;
      }
    }).filter((v) => v !== null);
    return arr;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const pathname = url.pathname === "/" ? "/viewer.html" : url.pathname;

  if (pathname === "/api/list") {
    const body = await listResults();
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  }

  if (pathname.startsWith("/api/results/")) {
    const name = decodeURIComponent(pathname.replace("/api/results/", ""));
    const arr = await readResults(name);
    return new Response(JSON.stringify(arr), { headers: { "content-type": "application/json" } });
  }

  try {
    const fileUrl = new URL(`.${pathname}`, root);
    const file = await Deno.readFile(fileUrl);
    return new Response(file, { headers: { "content-type": contentType(pathname) } });
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return new Response("Not found", { status: 404 });
    }
    logger.error("EvalServer", err instanceof Error ? (err.stack || err.message) : String(err));
    return new Response("Internal Server Error", { status: 500 });
  }
});
