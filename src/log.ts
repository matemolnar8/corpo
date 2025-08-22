import { gray, green, red, yellow } from "@std/fmt/colors";

export type LogLevel = "default" | "debug";

let currentLogLevel: LogLevel = "default";

export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLogLevel;
}

function tagPrefix(tag: string): string {
  return gray(`[${tag}]`);
}

export const logger = {
  info(tag: string, message: string) {
    console.log(`${tagPrefix(tag)} ${message}`);
  },
  success(tag: string, message: string) {
    console.log(`${tagPrefix(tag)} ${green(message)}`);
  },
  warn(tag: string, message: string) {
    console.log(`${tagPrefix(tag)} ${yellow(message)}`);
  },
  error(tag: string, message: string) {
    console.log(`${tagPrefix(tag)} ${red(message)}`);
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
