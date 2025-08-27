import { blue, bold, cyan, gray, green, magenta, red, yellow } from "@std/fmt/colors";

export type LogLevel = "default" | "debug";

let currentLogLevel: LogLevel = "default";

export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLogLevel;
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    // Simple 32-bit hash
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return hash >>> 0; // ensure unsigned
}

const tagColors: Array<(s: string) => string> = [cyan, magenta, blue, green, yellow, gray];
export const TAG_COLOR_COUNT = tagColors.length;

export function computeTagColorIndex(tag: string): number {
  return hashString(tag) % tagColors.length;
}

function tagColor(tag: string): (s: string) => string {
  const idx = computeTagColorIndex(tag);
  return tagColors[idx] ?? gray;
}

function tagPrefix(tag: string): string {
  const color = tagColor(tag);
  return bold(color(`[${tag}]`));
}

export const logger = {
  info(tag: string, message: string) {
    console.log(`${tagPrefix(tag)} ${message}`);
  },
  success(tag: string, message: string) {
    console.log(`${tagPrefix(tag)} ${green(`✅ ${message}`)}`);
  },
  warn(tag: string, message: string) {
    console.log(`${tagPrefix(tag)} ${yellow(`⚠️ ${message}`)}`);
  },
  error(tag: string, message: string) {
    console.log(`${tagPrefix(tag)} ${red(`❌ ${message}`)}`);
  },
  debug(tag: string, message: string) {
    if (currentLogLevel === "debug") {
      console.log(`${tagPrefix(tag)} ${gray(message)}`);
    }
  },
} as const;

export function stringifySmall(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s.length > 500 ? s.slice(0, 500) + "…" : s;
  } catch {
    return String(v);
  }
}
