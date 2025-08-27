export const PLAYWRIGHT_ALLOWED_TOOL_NAMES: ReadonlyArray<string> = [
  "browser_navigate",
  "browser_navigate_back",
  "browser_click",
  "browser_type",
  "browser_wait_for",
  "browser_select_option",
  "browser_tabs",
  "browser_evaluate",
  "browser_fill_form",
  "browser_handle_dialog",
  "browser_hover",
  "browser_press_key",
];

export type PlaywrightToolName = (typeof PLAYWRIGHT_ALLOWED_TOOL_NAMES)[number];

export function isPlaywrightToolName(name: string): name is PlaywrightToolName {
  return PLAYWRIGHT_ALLOWED_TOOL_NAMES.includes(name);
}

export type PlaywrightDescriptionOverride = string | { mode: "replace" | "append"; text: string };

export const PLAYWRIGHT_TOOL_DESCRIPTION_OVERRIDES: Readonly<
  Record<PlaywrightToolName, PlaywrightDescriptionOverride>
> = {
  browser_navigate: {
    mode: "append",
    text: "Prefer this for opening URLs; do not use to click links. Provide an absolute URL.",
  },
  browser_click: {
    mode: "append",
    text:
      "Identify the element via role/text/stable attributes; avoid brittle selectors. Use after confirming presence with snapshot_get_and_filter or wait_for.",
  },
  browser_type: {
    mode: "append",
    text:
      "Ensure the input is visible and enabled first; specify the target unambiguously and the exact text to enter.",
  },
  browser_wait_for: {
    mode: "append",
    text:
      "Use to synchronize before actions; prefer waiting for specific text to appear or disappear over arbitrary delays.",
  },
  browser_select_option: {
    mode: "append",
    text: "Provide the dropdown locator and the value/label to select; confirm the dropdown exists before selecting.",
  },
  browser_tab_list: {
    mode: "append",
    text: "Use before switching tabs to discover indices and URLs.",
  },
  browser_tab_select: {
    mode: "append",
    text: "Use an index from browser_tab_list; switch tabs only when necessary for the step.",
  },
  browser_evaluate: {
    mode: "append",
    text: "Prefer higher-level tools first; keep code minimal and side-effect free; return concise results.",
  },
};
