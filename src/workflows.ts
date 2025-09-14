import { join } from "@std/path";

export type WorkflowStep = {
  instruction: string;
  note?: string;
  reproduction: string;
};

export type Workflow = {
  name: string;
  description?: string;
  createdAt: string;
  steps: WorkflowStep[];
};

const WORKFLOW_DIR = join(Deno.cwd(), "workflows");

export async function ensureWorkflowDir(): Promise<string> {
  await Deno.mkdir(WORKFLOW_DIR, { recursive: true });
  return WORKFLOW_DIR;
}

export async function saveWorkflow(workflow: Workflow): Promise<string> {
  await ensureWorkflowDir();

  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(workflow, null, 2));
  const file = join(WORKFLOW_DIR, `${sanitize(workflow.name)}.json`);

  await Deno.writeFile(file, data);
  return file;
}

export async function loadWorkflow(name: string): Promise<Workflow> {
  const file = join(WORKFLOW_DIR, `${sanitize(name)}.json`);
  const rawData = await Deno.readFile(file);
  const jsonData = new TextDecoder().decode(rawData);

  return JSON.parse(jsonData) as Workflow;
}

export async function listWorkflows(): Promise<string[]> {
  await ensureWorkflowDir();
  const filesIterator = Deno.readDir(WORKFLOW_DIR);

  const files: string[] = [];
  for await (const file of filesIterator) {
    if (file.isFile && file.name.endsWith(".json")) {
      files.push(file.name.replace(/\.json$/, ""));
    }
  }

  return files;
}

function sanitize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
