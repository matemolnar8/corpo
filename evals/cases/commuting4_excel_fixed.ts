import type { EvalConfig } from "../eval_runner.ts";
import * as path from "@std/path";
import * as XLSX from "xlsx";

const days = [11, 12, 13, 14, 25, 27, 28];

async function findLatestCommutingOutput(): Promise<string | undefined> {
  const outputDir = path.fromFileUrl(new URL("../../output/", import.meta.url));
  try {
    const entries: Array<{ name: string; path: string; mtime: number }> = [];
    for await (const entry of Deno.readDir(outputDir)) {
      if (entry.isFile && /commuting.*\.xlsx$/i.test(entry.name)) {
        const fullPath = path.join(outputDir, entry.name);
        const info = await Deno.stat(fullPath);
        entries.push({ name: entry.name, path: fullPath, mtime: info.mtime?.getTime() ?? 0 });
      }
    }
    entries.sort((a, b) => b.mtime - a.mtime);
    return entries[0]?.path;
  } catch {
    return undefined;
  }
}

export const config: EvalConfig = {
  workflowName: "commuting4_excel_fixed",
  headless: true,
  verify: async () => {
    const xlsxPath = await findLatestCommutingOutput();
    if (!xlsxPath) return { ok: false, reason: "No commuting .xlsx output file found" } as const;

    let ok = false;
    try {
      const bytes = await Deno.readFile(xlsxPath);
      const wb = XLSX.read(bytes, { type: "buffer" });
      const sheetName = wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      const text = csv.toLowerCase();
      ok = days.every((day) => text.includes(`2025-08-${day}`));
    } catch (err) {
      return { ok: false, reason: `Failed to read xlsx: ${(err as Error).message}` } as const;
    }

    return ok ? { ok: true } : { ok: false, reason: "Expected days not found in Excel output" };
  },
};

export default config;
