import { expect } from "@std/expect";
import { computeTagColorIndex, TAG_COLOR_COUNT } from "./log.ts";

Deno.test("computeTagColorIndex is deterministic", () => {
  const tags = ["MCP", "Runner", "Tool", "Recorder", "Secrets", "Core", "Custom-Tag-123"];
  for (const t of tags) {
    const first = computeTagColorIndex(t);
    const second = computeTagColorIndex(t);
    expect(first).toBe(second);
  }
});

Deno.test("computeTagColorIndex stays within color range", () => {
  const samples = [
    "a",
    "zz",
    "some-long-tag-name-🚀",
    "another_tag_name",
    "TOOL",
    "tool",
    "Secrets",
  ];
  for (const s of samples) {
    const idx = computeTagColorIndex(s);
    expect(idx >= 0 && idx < TAG_COLOR_COUNT).toBe(true);
  }
});
