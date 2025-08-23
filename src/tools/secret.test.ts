import { expect } from "@std/expect";
import { listSecretsTool, loadSecrets, replaceSecretsInArgs, resetSecrets, setSecret } from "./secret.ts";

Deno.test("replaceSecretsInArgs replaces placeholders recursively", () => {
  resetSecrets();
  setSecret("API_KEY", "abc123");
  setSecret("TOKEN", "zzz");

  const input = {
    headers: {
      Authorization: "Bearer {{secret.TOKEN}}",
    },
    url: "https://example.com?key={{secret.API_KEY}}",
    list: ["a", "{{secret.API_KEY}}", { deep: "x {{ secret.TOKEN }} y" }],
  } as const;

  const out = replaceSecretsInArgs(input);
  expect(out.headers.Authorization).toBe("Bearer zzz");
  expect(out.url).toBe("https://example.com?key=abc123");
  expect(out.list[1]).toBe("abc123");
  expect((out.list[2] as { deep: string }).deep).toBe("x zzz y");
});

Deno.test("replaceSecretsInArgs throws on missing secret", () => {
  resetSecrets();
  setSecret("PRESENT", "ok");
  const input = { s: "a {{secret.PRESENT}} b {{secret.MISSING}}" };
  expect(() => replaceSecretsInArgs(input)).toThrow();
});

Deno.test("loadSecrets loads from project-local secrets.json only when present", async () => {
  resetSecrets();
  // Not creating a file here; just assert no values loaded
  await loadSecrets();
  expect(() => replaceSecretsInArgs({ v: "{{secret.TEST_ENV}}" })).toThrow();
});

Deno.test("list_secrets returns placeholders for set secrets", async () => {
  resetSecrets();
  setSecret("API_KEY", "x");
  setSecret("TOKEN", "y");
  const res = await listSecretsTool.execute!({}, { messages: [], toolCallId: crypto.randomUUID() });
  const placeholders = (res as { placeholders: string[] }).placeholders;
  expect(placeholders.sort()).toEqual(["{{secret.API_KEY}}", "{{secret.TOKEN}}"].sort());
});
