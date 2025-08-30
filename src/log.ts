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
    Deno.stdout.writeSync(new TextEncoder().encode(`\r${tagPrefix(tag)} ${message}\n`));
  },
  success(tag: string, message: string) {
    Deno.stdout.writeSync(new TextEncoder().encode(`\r${tagPrefix(tag)} ${green(`✅ ${message}`)}\n`));
  },
  warn(tag: string, message: string) {
    Deno.stdout.writeSync(new TextEncoder().encode(`\r${tagPrefix(tag)} ${yellow(`⚠️ ${message}`)}\n`));
  },
  error(tag: string, message: string) {
    Deno.stdout.writeSync(new TextEncoder().encode(`\r${tagPrefix(tag)} ${red(`❌ ${message}`)}\n`));
  },
  debug(tag: string, message: string) {
    if (currentLogLevel === "debug") {
      Deno.stdout.writeSync(new TextEncoder().encode(`\r${tagPrefix(tag)} ${gray(message)}\n`));
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

export function createSpinner() {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

  let i = 0;
  let interval: number | null = null;
  let textQueue: string[] = [];
  let running = false;
  return {
    start() {
      running = true;
      textQueue = [];
      this.write();
      this.resume();
    },
    addText(text: string) {
      textQueue.unshift(text);
      if (running) {
        this.write();
      } else {
        logger.warn("Spinner", "Attempted to update spinner while it is not running; update queued.");
      }
    },
    removeText() {
      textQueue.shift();
    },
    pause() {
      if (interval) {
        clearInterval(interval);
      }
    },
    write() {
      if (!running) {
        return;
      }
      const text = textQueue.at(0) ?? "";
      return Deno.stdout.writeSync(new TextEncoder().encode(`\x1b[2K\r${frames[i++ % frames.length]} ${text}`));
    },
    resume() {
      if (!running) {
        return;
      }
      interval = setInterval(() => {
        this.write();
      }, 100);
    },
    stop() {
      if (interval) {
        clearInterval(interval);
      }
      Deno.stdout.writeSync(new TextEncoder().encode("\x1b[2K\r"));
      running = false;
    },
  };
}

export const spinner = createSpinner();
