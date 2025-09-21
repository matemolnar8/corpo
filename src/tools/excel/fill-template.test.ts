import { expect } from "@std/expect";
import { excelFillTemplateTool, excelGetDefinitionTool, fillTemplate } from "./fill-template.ts";
// import { setVariable } from "../variable.ts";

Deno.test("fillTemplate", async () => {
  const template = "commuting";
  const data = {
    bookings: [{
      day: "2025-01-01",
      distance: 120,
      cost: 3600,
      empty: "",
    }, {
      day: "2025-01-02",
      distance: 120,
      cost: 3600,
      empty: "",
    }, {
      day: "2025-01-03",
      distance: 120,
      cost: 3600,
      empty: "",
    }],
  };
  await fillTemplate({ template, data, outputFile: "output/commuting-test.xlsx", sheetName: "Sheet 1" });
});

Deno.test("excel_fill_template infers definition and sheet, accepts inline object", async () => {
  const template = "commuting";
  const data = {
    bookings: [
      { day: "2025-01-10", distance: 10, cost: 300, empty: "" },
      { day: "2025-01-11", distance: 12, cost: 360, empty: "" },
    ],
  } as const;

  const res = await excelFillTemplateTool.execute!({
    template,
    data: data as unknown as Record<string, unknown>,
    outputFile: "output/commuting-test.xlsx",
  }, { messages: [], toolCallId: crypto.randomUUID() });

  expect((res as { success: boolean }).success).toBe(true);
});

Deno.test("excel_get_definition returns definition and example skeleton", async () => {
  const template = "commuting";
  const res = await excelGetDefinitionTool.execute!({ template }, { messages: [], toolCallId: crypto.randomUUID() });
  const out = res as unknown as {
    success: boolean;
    definitionJson?: string;
    exampleDataJson?: string;
    exampleDataBySheetJson?: string;
  };
  expect(out.success).toBe(true);
  expect(typeof out.definitionJson).toBe("string");
  expect(typeof out.exampleDataBySheetJson).toBe("string");
});
