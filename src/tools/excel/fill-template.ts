import XlsxTemplate from "xlsx-template";
import * as path from "@std/path";
import { tool } from "ai";
import z from "zod";
import { logger, spinner, stringifySmall } from "../../log.ts";
import { getVariable } from "../variable.ts";

export type FillTemplateData = {
  [key: string]: string | number | boolean | FillTemplateData | FillTemplateData[];
};

export const fillTemplate = async ({
  template,
  data,
  outputFile,
  sheetName,
}: {
  template: string;
  data: FillTemplateData;
  outputFile: string;
  sheetName: string;
}) => {
  const file = await Deno.readFile(`templates/${template}.xlsx`);
  const xlsxTemplate = new XlsxTemplate(file);

  xlsxTemplate.substitute(sheetName, data);

  const output = xlsxTemplate.generate({ type: "nodebuffer" });

  const outputPath = `output/${outputFile}`;
  // Ensure directory exists and write to the exact provided path
  const dir = path.dirname(outputPath);
  if (dir && dir !== ".") {
    await Deno.mkdir(dir, { recursive: true });
  }
  await Deno.writeFile(outputPath, output);

  return { outputFile: outputPath };
};

// --- Tool wrapper ---

const excelFillInputSchema = z.object({
  template: z
    .string()
    .describe("Template name without extension. Reads templates/<template>.xlsx and templates/<template>.json"),
  definitionFile: z
    .string()
    .optional()
    .describe("Optional override for definition JSON path. Defaults to templates/<template>.json"),
  sheetName: z
    .string()
    .optional()
    .describe(
      "Worksheet name to substitute. If omitted and the definition has exactly one sheet, that one is used.",
    ),
  data: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Object with data to fill the template. Alternative to dataVariable/dataJson"),
  dataVariable: z
    .string()
    .optional()
    .describe("Name of a workflow variable holding JSON data to fill the template"),
  dataJson: z
    .string()
    .optional()
    .describe("JSON string with data to fill the template if not using dataVariable"),
  outputFile: z
    .string()
    .optional()
    .describe("Output .xlsx path. Defaults to output/<template>-<timestamp>.xlsx"),
});

const excelFillOutputSchema = z.object({
  success: z.boolean(),
  outputFile: z.string().optional(),
  reason: z.string().optional(),
});

type ExcelSectionDefinition = string | Record<string, string> | Array<Record<string, string>>;
type ExcelDefinition = Record<string, Record<string, ExcelSectionDefinition>>;

function ensureArrayOfObjects(value: unknown, context: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    throw new Error(`${context} must be an array`);
  }
  const arr: Array<Record<string, unknown>> = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${context} must contain objects`);
    }
    arr.push(item as Record<string, unknown>);
  }
  return arr;
}

function isAllowedScalarValue(value: unknown): boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null ||
    value === undefined
  );
}

function validateDataAgainstDefinition(args: {
  definition: ExcelDefinition;
  sheetName: string;
  data: Record<string, unknown>;
}): void {
  const { definition, sheetName, data } = args;
  const sheetDef = definition[sheetName];
  if (!sheetDef || typeof sheetDef !== "object") {
    throw new Error(`Sheet '${sheetName}' not found in definition`);
  }

  for (const [sectionName, sectionDefinition] of Object.entries(sheetDef)) {
    const sectionValue = (data as Record<string, unknown>)[sectionName];

    // Scalar section: definition is a string description
    if (typeof sectionDefinition === "string") {
      if (!isAllowedScalarValue(sectionValue)) {
        throw new Error(
          `data.${sectionName} must be a scalar (string | number | boolean | null | undefined)`,
        );
      }
      continue;
    }

    // Array section: definition is an array (usually length 1) describing fields of each row
    let fieldsObject: Record<string, string> | undefined;
    if (Array.isArray(sectionDefinition)) {
      if (sectionDefinition.length === 0) {
        // No fields described; allow empty arrays only
        if (sectionValue === undefined) continue;
        const rows = ensureArrayOfObjects(sectionValue, `data.${sectionName}`);
        if (rows.length > 0) {
          throw new Error(`'${sectionName}' has no described fields but rows were provided`);
        }
        continue;
      }
      fieldsObject = sectionDefinition[0] || {};
    } else if (sectionDefinition && typeof sectionDefinition === "object") {
      // Be permissive: if object provided directly, treat as row fields
      fieldsObject = sectionDefinition as Record<string, string>;
    }

    const rows = ensureArrayOfObjects(sectionValue, `data.${sectionName}`);
    const requiredFieldNames = Object.keys(fieldsObject || {});
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      for (const f of requiredFieldNames) {
        if (!(f in row)) {
          throw new Error(`Row ${i} of '${sectionName}' is missing field '${f}'`);
        }
        const v = row[f];
        if (!isAllowedScalarValue(v)) {
          throw new Error(
            `Row ${i} of '${sectionName}' field '${f}' must be string | number | boolean | null | undefined`,
          );
        }
      }
    }
  }
}

export const excelFillTemplateTool = tool({
  description:
    "Fill an XLSX template using a JSON definition and provided data. Automatically reads templates/<template>.xlsx and templates/<template>.json (unless overridden), validates data shape, then writes an output .xlsx.",
  inputSchema: excelFillInputSchema,
  outputSchema: excelFillOutputSchema,
  execute: async ({ template, definitionFile, sheetName, data, dataVariable, dataJson, outputFile }) => {
    spinner.addText("Running excel_fill_template...");
    try {
      const __start = Date.now();
      const __argsPreview = stringifySmall({
        template,
        definitionFile,
        sheetName,
        hasData: !!data,
        dataVariable,
        hasDataJson: !!dataJson,
        outputFile,
      });
      logger.info("Tool", `📊 excel_fill_template: template='${template}', sheet='${sheetName}'`);
      logger.debug("Tool", `excel_fill_template args: ${__argsPreview}`);

      // Resolve data source: prefer inline object, then JSON string, then variable
      let dataParsed: unknown = data;
      if (dataParsed === undefined) {
        let rawDataText: string | undefined;
        if (dataJson && dataJson.trim().length > 0) {
          rawDataText = dataJson;
        } else if (dataVariable) {
          const v = getVariable(dataVariable);
          if (!v) {
            return { success: false, reason: `Variable '${dataVariable}' not found` } as const;
          }
          rawDataText = v;
        } else {
          return { success: false, reason: "Provide data (data), dataJson, or dataVariable" } as const;
        }

        try {
          dataParsed = JSON.parse(rawDataText);
        } catch (err) {
          return { success: false, reason: `Failed to parse data JSON: ${(err as Error).message}` } as const;
        }
      }
      if (!dataParsed || typeof dataParsed !== "object" || Array.isArray(dataParsed)) {
        return { success: false, reason: "Data must be an object" } as const;
      }

      let definitionParsed: unknown;
      try {
        const definitionPath = definitionFile || `templates/${template}.json`;
        const defRaw = await Deno.readTextFile(definitionPath);
        definitionParsed = JSON.parse(defRaw);
      } catch (err) {
        return {
          success: false,
          reason: `Failed to load or parse definition file: ${(err as Error).message}`,
        } as const;
      }

      try {
        // Resolve sheet name: provided or infer if single sheet
        let effectiveSheet = sheetName;
        const defObj = definitionParsed as ExcelDefinition;
        if (!effectiveSheet) {
          const sheetNames = Object.keys(defObj);
          if (sheetNames.length === 1) {
            effectiveSheet = sheetNames[0];
          } else {
            return {
              success: false,
              reason: `Multiple sheets in definition; specify sheetName. Available sheets: ${sheetNames.join(", ")}`,
            } as const;
          }
        }

        validateDataAgainstDefinition({
          definition: defObj,
          sheetName: effectiveSheet!,
          data: dataParsed as Record<string, unknown>,
        });
      } catch (err) {
        return { success: false, reason: (err as Error).message } as const;
      }

      const outPath = outputFile || `output/${template}-${Date.now()}.xlsx`;
      try {
        // Use effective sheet name determined above (sheetName may be undefined)
        const defObj = definitionParsed as ExcelDefinition;
        let effectiveSheet = sheetName;
        if (!effectiveSheet) {
          const sheetNames = Object.keys(defObj);
          effectiveSheet = sheetNames.length === 1 ? sheetNames[0] : undefined;
        }
        await fillTemplate({
          template,
          sheetName: effectiveSheet as string,
          data: dataParsed as FillTemplateData,
          outputFile: outPath,
        });
      } catch (err) {
        return { success: false, reason: `Template fill failed: ${(err as Error).message}` } as const;
      }

      const __dur = Date.now() - __start;
      logger.info("Tool", `📊 excel_fill_template: wrote '${outPath}' in ${__dur}ms`);
      return { success: true, outputFile: outPath } as const;
    } finally {
      spinner.removeText();
    }
  },
});

// --- Definition helper tool ---

const excelGetDefinitionInputSchema = z.object({
  template: z
    .string()
    .describe("Template name without extension. Reads templates/<template>.json"),
  definitionFile: z
    .string()
    .optional()
    .describe("Optional override for definition JSON path. Defaults to templates/<template>.json"),
  sheetName: z
    .string()
    .optional()
    .describe("Optional sheet to generate example data for; if omitted and single-sheet, that one is used."),
});

const excelGetDefinitionOutputSchema = z.object({
  success: z.boolean(),
  template: z.string().optional(),
  sheets: z.array(z.string()).optional(),
  definitionJson: z.string().optional(),
  fieldsBySheetJson: z.string().optional(),
  exampleDataJson: z.string().optional(),
  exampleDataBySheetJson: z.string().optional(),
  reason: z.string().optional(),
});

function buildExampleSkeletonForSheet(definition: ExcelDefinition, sheet: string): Record<string, unknown> {
  const sheetDef = definition[sheet] || {};
  const data: Record<string, unknown> = {};
  for (const [sectionName, sectionDefinition] of Object.entries(sheetDef)) {
    if (typeof sectionDefinition === "string") {
      // Scalar example
      data[sectionName] = "";
    } else if (Array.isArray(sectionDefinition)) {
      const first = sectionDefinition[0] || {};
      const row: Record<string, unknown> = {};
      for (const fieldName of Object.keys(first)) {
        row[fieldName] = "";
      }
      data[sectionName] = [row];
    } else if (sectionDefinition && typeof sectionDefinition === "object") {
      const row: Record<string, unknown> = {};
      for (const fieldName of Object.keys(sectionDefinition)) {
        row[fieldName] = "";
      }
      data[sectionName] = [row];
    }
  }
  return data;
}

export const excelGetDefinitionTool = tool({
  description:
    "Get the JSON definition for an XLSX template and a minimal example data skeleton the model can start from.",
  inputSchema: excelGetDefinitionInputSchema,
  outputSchema: excelGetDefinitionOutputSchema,
  execute: async ({ template, definitionFile, sheetName }) => {
    spinner.addText("Running excel_get_definition...");
    try {
      const path = definitionFile || `templates/${template}.json`;
      let defObj: ExcelDefinition;
      try {
        const raw = await Deno.readTextFile(path);
        defObj = JSON.parse(raw) as ExcelDefinition;
      } catch (err) {
        return { success: false, reason: `Failed to read definition: ${(err as Error).message}` } as const;
      }

      const sheets = Object.keys(defObj);
      const fieldsBySheet: Record<string, Record<string, ExcelSectionDefinition>> = {};
      for (const s of sheets) fieldsBySheet[s] = defObj[s] || {};

      // Decide which sheet to produce example for
      let effectiveSheet = sheetName;
      if (!effectiveSheet && sheets.length === 1) effectiveSheet = sheets[0];

      const definitionJson = JSON.stringify(defObj, null, 2);
      const fieldsBySheetJson = JSON.stringify(fieldsBySheet, null, 2);

      let exampleDataJson: string | undefined = undefined;
      if (effectiveSheet) {
        exampleDataJson = JSON.stringify(buildExampleSkeletonForSheet(defObj, effectiveSheet), null, 2);
      }

      const exampleDataBySheet: Record<string, unknown> = {};
      for (const s of sheets) exampleDataBySheet[s] = buildExampleSkeletonForSheet(defObj, s);
      const exampleDataBySheetJson = JSON.stringify(exampleDataBySheet, null, 2);

      logger.info("Tool", `📄 excel_get_definition: template='${template}', sheets=${sheets.length}`);
      return {
        success: true,
        template,
        sheets,
        definitionJson,
        fieldsBySheetJson,
        exampleDataJson,
        exampleDataBySheetJson,
      } as const;
    } finally {
      spinner.removeText();
    }
  },
});
