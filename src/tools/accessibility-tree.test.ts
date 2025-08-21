import { expect } from "@std/expect";
import { accessibilityFilterTool } from "./accessibility-tree.ts";
import { connectPlaywrightMCP } from "./mcp/playwright-mcp.ts";
import { getVariable, resetVariables, setVariable } from "./variable.ts";
import { assertSnapshot } from "@std/testing/snapshot";

Deno.test.ignore("accessibility filter extracts heading and link from applitools snapshot", async (context) => {
  resetVariables();
  const mcp = await connectPlaywrightMCP({ headless: true });

  await mcp.callTool("browser_navigate", { url: "https://demo.applitools.com/" });
  await mcp.callTool("snapshotAndSave", { variable: "applitools_snapshot" });

  expect(getVariable("applitools_snapshot")).toBeDefined();

  const headingResult = await accessibilityFilterTool.execute!(
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

  const linkResult = await accessibilityFilterTool.execute!(
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

Deno.test("accessibility filter extracts Cloudbooking link from okta snapshot", async (context) => {
  resetVariables();
  setVariable("okta_snapshot", await Deno.readTextFile("./resources/okta-snapshot.yml"));

  const cloudbookingResult = await accessibilityFilterTool.execute!(
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

Deno.test("accessibility filter extract bookings from specified date from cloudbooking snapshot", async (context) => {
  resetVariables();
  setVariable("cloudbooking_snapshot", await Deno.readTextFile("./resources/cloudbooking-snapshot.yml"));

  const bookingsResult = await accessibilityFilterTool.execute!(
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
