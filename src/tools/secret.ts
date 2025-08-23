import { logger, stringifySmall } from "../log.ts";
import { tool } from "ai";
import z from "zod";

const secrets = new Map<string, string>();

export function resetSecrets(): void {
  secrets.clear();
}

export function setSecret(name: string, value: string): void {
  secrets.set(name, value);
}

export function getSecret(name: string): string | undefined {
  return secrets.get(name);
}

export function listSecretNames(): string[] {
  return Array.from(secrets.keys());
}

async function loadJsonFileIfExists(path: string): Promise<Record<string, string> | null> {
  try {
    const stat = await Deno.stat(path);
    if (!stat.isFile) return null;
  } catch {
    return null;
  }

  try {
    const data = await Deno.readTextFile(path);
    const parsed = JSON.parse(data) as unknown;
    if (parsed && typeof parsed === "object") {
      const result: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "string") {
          result[k] = v;
        }
      }
      return result;
    }
  } catch (err) {
    logger.warn("Secrets", `Failed to load secrets file '${path}': ${String(err)}`);
  }
  return null;
}

export async function loadSecrets(): Promise<void> {
  resetSecrets();

  const fromProject = await loadJsonFileIfExists("secrets.json");
  if (fromProject) {
    for (const [k, v] of Object.entries(fromProject)) setSecret(k, v);
    logger.info("Secrets", `Loaded ${Object.keys(fromProject).length} secrets from ./secrets.json`);
  }

  logger.debug("Secrets", `Active secret names: ${listSecretNames().join(", ") || "<none>"}`);
}

// Replace placeholders like: {{secret.NAME}}
const SECRET_PLACEHOLDER = /\{\{\s*secret\.([A-Za-z0-9_-]+)\s*\}\}/g;

// Replace any occurrences of secret values in an arbitrary value (objects, arrays, strings)
// with their corresponding placeholders (e.g., actual value -> {{secret.NAME}}).
// Also tracks which secrets were used while replacing placeholders in args.
export function replaceSecretsInArgsWithTracking<T>(value: T): { value: T; usedSecretNames: string[] } {
  const used = new Set<string>();

  const visit = (v: unknown): unknown => {
    if (typeof v === "string") {
      const missing: string[] = [];
      const replaced = v.replace(SECRET_PLACEHOLDER, (_m, p1: string) => {
        const s = getSecret(p1);
        if (typeof s === "string") {
          used.add(p1);
          return s;
        }
        missing.push(p1);
        return _m; // keep placeholder for now
      });
      if (missing.length > 0) {
        throw new Error(`Missing secret(s): ${missing.join(", ")}`);
      }
      return replaced;
    }
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, vv] of Object.entries(v)) out[k] = visit(vv);
      return out;
    }
    return v;
  };

  const replacedValue = visit(value) as T;
  return { value: replacedValue, usedSecretNames: Array.from(used) };
}

// Replace only the provided secret names in the result structure with their placeholders.
export function replaceSecretsInResultAllowed<T>(value: T, allowedSecretNames: ReadonlyArray<string>): T {
  const escapeRegExp = (input: string): string => input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const allowedSet = new Set(allowedSecretNames);

  const replacements = Array.from(secrets.entries())
    .filter(([name, val]) => allowedSet.has(name) && typeof val === "string" && val.length > 0)
    .map(([name, val]) => ({ name, value: val as string, placeholder: `{{secret.${name}}}` }))
    .sort((a, b) => b.value.length - a.value.length);

  const visit = (v: unknown): unknown => {
    if (typeof v === "string") {
      let out = v;
      for (const rep of replacements) {
        const pattern = new RegExp(escapeRegExp(rep.value), "g");
        out = out.replace(pattern, rep.placeholder);
      }
      return out;
    }
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, vv] of Object.entries(v)) out[k] = visit(vv);
      return out;
    }
    return v;
  };

  return visit(value) as T;
}

export const listSecretsTool = tool({
  description: "List available secret placeholders for use in tool calls",
  inputSchema: z.object({}),
  outputSchema: z.object({ placeholders: z.array(z.string()) }),
  execute: () => {
    const names = listSecretNames();
    const placeholders = names.map((n) => `{{secret.${n}}}`);
    const output = { placeholders } as const;
    logger.debug("Tool", `list_secrets result: ${stringifySmall({ count: placeholders.length })}`);
    return output;
  },
});
