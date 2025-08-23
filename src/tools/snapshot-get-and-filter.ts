import { tool } from "ai";
import z from "zod";
import { parse } from "@std/yaml";
import { getVariable, setVariable } from "./variable.ts";
import { logger } from "../log.ts";

type TextMatch =
  | { equals: string }
  | { contains: string }
  | { regex: string; flags?: string };

type AccessibilityNode = {
  role: string;
  text?: string;
  attributes: Record<string, string>;
  children: AccessibilityNode[];
  rawDescriptor: string;
};

function parseDescriptor(descriptor: string): {
  role: string;
  text?: string;
  attributes: Record<string, string>;
} {
  const attributes: Record<string, string> = {};

  const roleMatch = descriptor.match(/^(\w+)/);
  const role = roleMatch ? roleMatch[1] : "generic";

  const textMatch = descriptor.match(/\s+"([^"]+)"/);
  const text = textMatch ? textMatch[1] : "";

  const attrRegex = /\[([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = attrRegex.exec(descriptor)) !== null) {
    const part = m[1];
    const eqIndex = part.indexOf("=");
    if (eqIndex === -1) {
      // flag attribute like [checked]
      attributes[part.trim()] = "true";
    } else {
      const key = part.slice(0, eqIndex).trim();
      const rawVal = part.slice(eqIndex + 1).trim();
      const val = rawVal;
      attributes[key] = val.toString();
    }
  }

  return { role, text, attributes };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDescriptorObject(obj: Record<string, unknown>): boolean {
  const keys = Object.keys(obj);
  if (keys.length !== 1) return false;
  const onlyKey = keys[0];
  return !onlyKey.startsWith("/") && Array.isArray(obj[onlyKey]);
}

function buildNodes(input: unknown): AccessibilityNode[] {
  if (typeof input === "string") {
    const parsed = parseDescriptor(input);
    return [
      {
        role: parsed.role,
        text: parsed.text,
        attributes: parsed.attributes,
        children: [],
        rawDescriptor: input,
      },
    ];
  }

  if (Array.isArray(input)) {
    const nodes: AccessibilityNode[] = [];
    for (const item of input) {
      nodes.push(...buildNodes(item));
    }
    return nodes;
  }

  if (isPlainObject(input)) {
    if (isDescriptorObject(input)) {
      const [descriptor, value] = Object.entries(input)[0] as [string, unknown];
      const parsed = parseDescriptor(descriptor);
      const children = Array.isArray(value) ? buildNodes(value) : [];
      return [
        {
          role: parsed.role,
          text: parsed.text,
          attributes: parsed.attributes,
          children,
          rawDescriptor: descriptor,
        },
      ];
    }

    // Property object (e.g., {"/url": "#"}) or unknown; ignore for now
    return [];
  }

  return [];
}

function textMatches(candidate: string | undefined, matcher?: TextMatch): boolean {
  if (!matcher) return true;
  if (candidate == null) return false;
  if ("equals" in matcher) return candidate.toLowerCase().trim() === matcher.equals.toLowerCase().trim();
  if ("contains" in matcher) return candidate.toLowerCase().trim().includes(matcher.contains.toLowerCase().trim());
  if ("regex" in matcher) {
    const re = new RegExp(matcher.regex, matcher.flags);
    return re.test(candidate.toLowerCase().trim());
  }
  return false;
}

function attributesMatch(
  candidate: Record<string, string>,
  required?: Record<string, string>,
): boolean {
  if (!required) return true;
  for (const [k, v] of Object.entries(required)) {
    if (!(k in candidate)) return false;
    if (candidate[k].toLowerCase().trim() !== v.toLowerCase().trim()) return false;
  }
  return true;
}

function findMatches(
  nodes: AccessibilityNode[],
  filter: {
    role?: string | string[];
    text?: TextMatch;
    attributes?: Record<string, string>;
    includeSubtree: boolean;
    mode: "first" | "all";
    maxResults?: number;
  },
): AccessibilityNode[] {
  const roles = Array.isArray(filter.role) ? new Set(filter.role) : filter.role ? new Set([filter.role]) : undefined;
  const results: AccessibilityNode[] = [];

  const visit = (node: AccessibilityNode) => {
    if (
      (!roles || roles.has(node.role)) &&
      textMatches(node.text, filter.text) &&
      attributesMatch(node.attributes, filter.attributes)
    ) {
      const copy: AccessibilityNode = {
        role: node.role,
        text: node.text,
        attributes: { ...node.attributes },
        children: filter.includeSubtree ? node.children.map(cloneNode) : [],
        rawDescriptor: node.rawDescriptor,
      };
      results.push(copy);
      if (filter.mode === "first") return true;
      if (filter.maxResults && results.length >= filter.maxResults) return true;
    }

    for (const child of node.children) {
      const stop = visit(child);
      if (stop) return true;
    }
    return false;
  };

  for (const n of nodes) {
    const stop = visit(n);
    if (stop) break;
  }

  return results;
}

function cloneNode(node: AccessibilityNode): AccessibilityNode {
  return {
    role: node.role,
    text: node.text,
    attributes: { ...node.attributes },
    children: node.children.map(cloneNode),
    rawDescriptor: node.rawDescriptor,
  };
}

export const snapshotGetAndFilterInputSchema = z.object({
  variable: z.string().describe("Name of the variable that holds the YAML accessibility snapshot"),
  filter: z
    .object({
      role: z.union([z.string(), z.array(z.string())]).optional()
        .describe("Filter by accessibility role (e.g., 'table', 'link', 'row')"),
      text: z
        .union([
          z.object({ equals: z.string() }),
          z.object({ contains: z.string() }),
          z.object({ regex: z.string(), flags: z.string().optional() }),
        ])
        .optional()
        .describe(
          "Filter by accessible name/text using equals, contains, or regex.",
        ),
      attributes: z
        .record(z.string(), z.string())
        .optional()
        .describe("Match descriptor attributes like level=4, cursor=pointer"),
    })
    .default({})
    .describe("Filter by accessibility role/text/attributes. Make sure to use the most specific filter possible."),
  includeSubtree: z.boolean().default(false).describe(
    "Include the full subtree of matched nodes. Expensive, should be used when absolutely necessary.",
  ),
  mode: z.enum(["first", "all"]).default("all").describe("Return only the first match or all matches"),
  maxResults: z.number().int().positive().optional().describe("Limit the number of returned matches"),
  storeInVariable: z.string().optional().describe("If provided, store the YAML result in this variable name"),
});

export const snapshotGetAndFilterOutputSchema = z.object({
  success: z.boolean(),
  count: z.number().int().nonnegative(),
  json: z.string().optional(),
  reason: z.string().optional(),
});

export const snapshotGetAndFilterTool = tool({
  description:
    "Parse an accessibility YAML snapshot from a variable and return a filtered subtree by role/text/attributes. Only works when snapshots are saved with the browser_snapshot_and_save tool.",
  inputSchema: snapshotGetAndFilterInputSchema,
  outputSchema: snapshotGetAndFilterOutputSchema,
  execute: ({ variable, filter, includeSubtree, mode, maxResults, storeInVariable }) => {
    const MAX_JSON_CHARS = 30_000;
    // Start log
    let __argsStr = "";
    try {
      __argsStr = JSON.stringify({ variable, filter, includeSubtree, mode, maxResults, storeInVariable });
    } catch {
      __argsStr = String({ variable, filter, includeSubtree, mode, maxResults, storeInVariable });
    }
    logger.debug("Tool", `snapshot_get_and_filter args: ${__argsStr}`);
    const raw = getVariable(variable);
    if (!raw) {
      logger.debug(
        "Tool",
        `snapshot_get_and_filter result: ${
          JSON.stringify({ success: false, count: 0, reason: `Variable '${variable}' not found` })
        }`,
      );
      return { success: false, count: 0, reason: `Variable '${variable}' not found` };
    }

    let parsed: unknown;
    try {
      parsed = parse(raw);
    } catch (err) {
      logger.debug(
        "Tool",
        `snapshot_get_and_filter result: ${
          JSON.stringify({ success: false, count: 0, reason: `Failed to parse YAML: ${(err as Error).message}` })
        }`,
      );
      return { success: false, count: 0, reason: `Failed to parse YAML: ${(err as Error).message}` };
    }

    const rootNodes = buildNodes(parsed);
    const matches = findMatches(rootNodes, {
      role: filter.role,
      text: filter.text,
      attributes: filter.attributes,
      includeSubtree,
      mode,
      maxResults,
    });

    const json = JSON.stringify(matches, null, 2);

    // Enforce size limit to encourage narrower filters
    if (json.length > MAX_JSON_CHARS) {
      const reason = `Filtered result too large (${json.length} > ${MAX_JSON_CHARS} chars). ` +
        "Narrow your filter: restrict 'role'/'text'/'attributes', avoid 'includeSubtree' unless required, or set 'maxResults'.";
      logger.debug(
        "Tool",
        `snapshot_get_and_filter result: ${JSON.stringify({ success: false, count: matches.length, reason })}`,
      );
      return { success: false, count: matches.length, reason };
    }

    if (storeInVariable) {
      setVariable(storeInVariable, json);
    }
    logger.debug(
      "Tool",
      `snapshot_get_and_filter result: ${JSON.stringify({ success: true, count: matches.length, json })}`,
    );
    return { success: true, count: matches.length, json };
  },
});
