import { expect } from "@std/expect";
import { snapshotGetAndFilterTool } from "./snapshot-get-and-filter.ts";
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
