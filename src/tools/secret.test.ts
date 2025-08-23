import { expect } from "@std/expect";
import {
  listSecretsTool,
  loadSecrets,
  replaceSecretsInArgsWithTracking,
  replaceSecretsInResultAllowed,
  resetSecrets,
  setSecret,
} from "./secret.ts";

Deno.test("replaceSecretsInArgsWithTracking replaces placeholders recursively and tracks names", () => {
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

  const { value: out, usedSecretNames } = replaceSecretsInArgsWithTracking(input);
  expect(out.headers.Authorization).toBe("Bearer zzz");
  expect(out.url).toBe("https://example.com?key=abc123");
  expect(out.list[1]).toBe("abc123");
  expect((out.list[2] as { deep: string }).deep).toBe("x zzz y");
  expect(usedSecretNames.sort()).toEqual(["API_KEY", "TOKEN"].sort());
});

Deno.test("replaceSecretsInArgsWithTracking throws on missing secret", () => {
  resetSecrets();
  setSecret("PRESENT", "ok");
  const input = { s: "a {{secret.PRESENT}} b {{secret.MISSING}}" };
  expect(() => replaceSecretsInArgsWithTracking(input)).toThrow();
});

Deno.test("loadSecrets loads from project-local secrets.json only when present", async () => {
  resetSecrets();
  // Not creating a file here; just assert no values loaded
  await loadSecrets();
  expect(() => replaceSecretsInArgsWithTracking({ v: "{{secret.TEST_ENV}}" })).toThrow();
});

Deno.test("list_secrets returns placeholders for set secrets", async () => {
  resetSecrets();
  setSecret("API_KEY", "x");
  setSecret("TOKEN", "y");
  const res = await listSecretsTool.execute!({}, { messages: [], toolCallId: crypto.randomUUID() });
  const placeholders = (res as { placeholders: string[] }).placeholders;
  expect(placeholders.sort()).toEqual(["{{secret.API_KEY}}", "{{secret.TOKEN}}"].sort());
});

Deno.test("replaceSecretsInResultAllowed masks raw secret values in strings, arrays, and objects when allowed", () => {
  resetSecrets();
  setSecret("API_KEY", "abc123");
  setSecret("TOKEN", "zzz");

  const input = {
    text: "url?k=abc123 and bearer zzz",
    nested: ["abc123", { deep: "x zzz y", mix: "zzzabc123" }],
  } as const;

  const masked = replaceSecretsInResultAllowed(input, ["API_KEY", "TOKEN"]);
  expect(masked.text).toBe("url?k={{secret.API_KEY}} and bearer {{secret.TOKEN}}");
  expect(masked.nested[0]).toBe("{{secret.API_KEY}}");
  expect((masked.nested[1] as { deep: string }).deep).toBe("x {{secret.TOKEN}} y");
  expect((masked.nested[1] as { mix: string }).mix).toBe("{{secret.TOKEN}}{{secret.API_KEY}}");
});

Deno.test("replaceSecretsInResultAllowed handles overlapping/partial values by preferring longer first", () => {
  resetSecrets();
  setSecret("LONG", "abcdef");
  setSecret("SHORT", "abc");

  const input = { s: "abcdef abc" } as const;
  const masked = replaceSecretsInResultAllowed(input, ["LONG", "SHORT"]);
  // Expect the longer value to be replaced as a whole and the remaining 'abc' also replaced
  expect(masked.s).toBe("{{secret.LONG}} {{secret.SHORT}}");
});

Deno.test("replaceSecretsInArgsWithTracking tracks used secrets and output masking respects allowed list", () => {
  resetSecrets();
  setSecret("API_KEY", "abc123");
  setSecret("TOKEN", "zzz");

  // Args only use TOKEN
  const args = { headers: { Authorization: "Bearer {{secret.TOKEN}}" } } as const;
  const { value: safeArgs, usedSecretNames } = replaceSecretsInArgsWithTracking(args);
  expect(safeArgs.headers.Authorization).toBe("Bearer zzz");
  expect(usedSecretNames.sort()).toEqual(["TOKEN"].sort());

  // Result contains both values, but only TOKEN should be masked
  const result = {
    content: [
      { type: "text", text: "key abc123 and token zzz" },
    ],
  } as const;
  const masked = replaceSecretsInResultAllowed(result, usedSecretNames);
  expect((masked.content[0] as { type: string; text: string }).text).toBe(
    "key abc123 and token {{secret.TOKEN}}",
  );
});
