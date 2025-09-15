import { expect } from "@std/expect";
import { snapshotFilterJsonTool, snapshotGetAndFilterTool } from "./snapshot.ts";
import { connectPlaywrightMCP } from "./mcp/playwright-mcp.ts";
import { getVariable, resetVariables, setVariable } from "./variable.ts";
import { assertSnapshot } from "@std/testing/snapshot";
import { setLogLevel } from "../log.ts";

setLogLevel("debug");

Deno.test("snapshot get and filter extracts heading and link from applitools snapshot", async (context) => {
  resetVariables();
  const mcp = await connectPlaywrightMCP({ headless: true });

  await mcp.callTool("browser_navigate", { url: "https://demo.applitools.com/" });
  await mcp.callTool("browser_snapshot_and_save", { variable: "applitools_snapshot" });

  expect(getVariable("applitools_snapshot")).toBeDefined();

  const headingResult = await snapshotGetAndFilterTool.execute!(
    {
      variable: "applitools_snapshot",
      filter: { role: "heading", text: { contains: "Login" } },
      includeSubtree: false,
      mode: "first",
    },
    { messages: [], toolCallId: crypto.randomUUID() },
  );
  const heading = headingResult as { success: boolean; count: number; yaml?: string };
  assertSnapshot(context, heading);

  const linkResult = await snapshotGetAndFilterTool.execute!(
    {
      variable: "applitools_snapshot",
      filter: { role: "link", text: { contains: "Sign in" } },
      includeSubtree: true,
      mode: "first",
    },
    { messages: [], toolCallId: crypto.randomUUID() },
  );
  const link = linkResult as { success: boolean; count: number; yaml?: string };
  assertSnapshot(context, link);

  await mcp.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 1000));
});

Deno.test("snapshot get and filter extracts Cloudbooking link from okta snapshot", async (context) => {
  resetVariables();
  setVariable("okta_snapshot", await Deno.readTextFile("./resources/okta-snapshot.yml"));

  const cloudbookingResult = await snapshotGetAndFilterTool.execute!(
    {
      variable: "okta_snapshot",
      filter: { role: "link", text: { contains: "Cloudbooking" } },
      includeSubtree: true,
      mode: "first",
    },
    { messages: [], toolCallId: crypto.randomUUID() },
  );

  assertSnapshot(context, cloudbookingResult);
});

Deno.test("snapshot get and filter extract bookings from specified date from cloudbooking snapshot", async (context) => {
  resetVariables();
  setVariable("cloudbooking_snapshot", await Deno.readTextFile("./resources/cloudbooking-snapshot.yml"));

  const bookingsResult = await snapshotGetAndFilterTool.execute!(
    {
      variable: "cloudbooking_snapshot",
      filter: { role: "row", text: { contains: "Jul 2025" } },
      includeSubtree: false,
      mode: "all",
    },
    { messages: [], toolCallId: crypto.randomUUID() },
  );

  assertSnapshot(context, bookingsResult);
});

Deno.test("snapshot get and filter enforces size limit and returns failure when too large", async () => {
  resetVariables();
  // Construct a synthetic large snapshot result by creating many similar nodes under a role
  const nodes: unknown[] = [];
  for (let i = 0; i < 2000; i++) {
    nodes.push('row "Item' + i + '"');
  }
  const yaml = `table:\n  - ${nodes.join("\n  - ")}`;
  setVariable("large_snapshot", yaml);

  const result = await snapshotGetAndFilterTool.execute!(
    {
      variable: "large_snapshot",
      filter: { role: "row" },
      includeSubtree: false,
      mode: "all",
    },
    { messages: [], toolCallId: crypto.randomUUID() },
  );

  const { success, reason } = result as { success: boolean; reason?: string };
  expect(success).toBe(false);
  expect(reason).toContain("Filtered result too large");
});

Deno.test("snapshot_filter_json narrows previously stored JSON from snapshot_get_and_filter", async () => {
  resetVariables();

  // Build a small synthetic YAML snapshot and filter it once to JSON
  const yaml = `table:\n  - row "Item A" [kind=a]\n  - row "Item B" [kind=b]\n  - row "Another A" [kind=a]`;
  setVariable("synthetic_yaml", yaml);

  await snapshotGetAndFilterTool.execute!(
    {
      variable: "synthetic_yaml",
      filter: { role: "row" },
      includeSubtree: false,
      mode: "all",
      storeInVariable: "rows_json",
    },
    { messages: [], toolCallId: crypto.randomUUID() },
  );

  const firstJson = getVariable("rows_json");
  expect(firstJson).toBeDefined();
  const firstParsed = JSON.parse(firstJson!);
  expect(Array.isArray(firstParsed)).toBe(true);
  expect(firstParsed.length).toBe(3);

  // Re-filter that JSON for items whose text contains 'Item'
  const second = await snapshotFilterJsonTool.execute!(
    {
      variable: "rows_json",
      filter: { text: { contains: "Item" } },
      includeSubtree: false,
      mode: "all",
      storeInVariable: "items_only_json",
    },
    { messages: [], toolCallId: crypto.randomUUID() },
  );

  const { success, count } = second as { success: boolean; count: number };
  expect(success).toBe(true);
  expect(count).toBe(2);

  const itemsOnly = getVariable("items_only_json");
  expect(itemsOnly).toBeDefined();
  const parsedItems = JSON.parse(itemsOnly!);
  expect(parsedItems.every((n: { text?: string }) => String(n.text ?? "").includes("Item"))).toBe(true);
});

Deno.test("snapshot_filter_json supports chained filtering", async () => {
  resetVariables();

  // Synthetic snapshot with two attributes kinds
  const yaml = `table:\n  - row "Item A" [kind=a]\n  - row "Item B" [kind=b]\n  - row "Another A" [kind=a]`;
  setVariable("synthetic_yaml2", yaml);

  // First pass: get all rows as JSON
  await snapshotGetAndFilterTool.execute!(
    {
      variable: "synthetic_yaml2",
      filter: { role: "row" },
      includeSubtree: false,
      mode: "all",
      storeInVariable: "rows_json2",
    },
    { messages: [], toolCallId: crypto.randomUUID() },
  );

  // Second pass: keep only items whose text contains 'Item'
  await snapshotFilterJsonTool.execute!(
    {
      variable: "rows_json2",
      filter: { text: { contains: "Item" } },
      includeSubtree: false,
      mode: "all",
      storeInVariable: "items_only_json2",
    },
    { messages: [], toolCallId: crypto.randomUUID() },
  );

  // Third pass (chained): from those, keep only kind=a
  const third = await snapshotFilterJsonTool.execute!(
    {
      variable: "items_only_json2",
      filter: { attributes: { kind: "a" } },
      includeSubtree: false,
      mode: "all",
      storeInVariable: "items_kind_a_json2",
    },
    { messages: [], toolCallId: crypto.randomUUID() },
  );

  const { success, count } = third as { success: boolean; count: number };
  expect(success).toBe(true);
  expect(count).toBe(1);

  const finalJson = getVariable("items_kind_a_json2");
  expect(finalJson).toBeDefined();
  const finalParsed = JSON.parse(finalJson!);
  expect(Array.isArray(finalParsed)).toBe(true);
  expect(finalParsed.length).toBe(1);
  expect(finalParsed[0].attributes.kind).toBe("a");
  expect(String(finalParsed[0].text ?? "")).toContain("Item");
});

Deno.test("snapshot_filter_json supports regex text filtering with flags", async () => {
  resetVariables();

  // Build a small synthetic YAML snapshot and filter it once to JSON
  const yaml = `table:\n  - row "Item A"\n  - row "item b"\n  - row "Misc"`;
  setVariable("synthetic_yaml_regex", yaml);

  await snapshotGetAndFilterTool.execute!(
    {
      variable: "synthetic_yaml_regex",
      filter: { role: "row" },
      includeSubtree: false,
      mode: "all",
      storeInVariable: "rows_json_regex",
    },
    { messages: [], toolCallId: crypto.randomUUID() },
  );

  // Re-filter with a case-insensitive regex that should match both 'Item A' and 'item b'
  const second = await snapshotFilterJsonTool.execute!(
    {
      variable: "rows_json_regex",
      filter: { text: { regex: "^item [ab]$", flags: "i" } },
      includeSubtree: false,
      mode: "all",
      storeInVariable: "regex_items_only_json",
    },
    { messages: [], toolCallId: crypto.randomUUID() },
  );

  const { success, count } = second as { success: boolean; count: number };
  expect(success).toBe(true);
  expect(count).toBe(2);

  const regexItemsOnly = getVariable("regex_items_only_json");
  expect(regexItemsOnly).toBeDefined();
  const parsed = JSON.parse(regexItemsOnly!);
  expect(Array.isArray(parsed)).toBe(true);
  expect(parsed.length).toBe(2);
  const texts = parsed.map((n: { text?: string }) => String(n.text ?? ""));
  expect(texts).toContain("Item A");
  expect(texts).toContain("item b");
});
