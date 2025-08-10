import { promises as fs } from "node:fs";
import { join } from "node:path";

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

const WORKFLOW_DIR = join(process.cwd(), "workflows");

export async function ensureWorkflowDir(): Promise<string> {
  await fs.mkdir(WORKFLOW_DIR, { recursive: true });
  return WORKFLOW_DIR;
}

export async function saveWorkflow(workflow: Workflow): Promise<string> {
  await ensureWorkflowDir();
  const file = join(WORKFLOW_DIR, `${sanitize(workflow.name)}.json`);
  await fs.writeFile(file, JSON.stringify(workflow, null, 2), "utf8");
  return file;
}

export async function loadWorkflow(name: string): Promise<Workflow> {
  const file = join(WORKFLOW_DIR, `${sanitize(name)}.json`);
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw) as Workflow;
}

export async function listWorkflows(): Promise<string[]> {
  await ensureWorkflowDir();
  const files = await fs.readdir(WORKFLOW_DIR);
  return files
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

function sanitize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
