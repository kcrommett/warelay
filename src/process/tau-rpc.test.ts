import { describe, expect, it } from "vitest";

import { normalizePiPrompt } from "./tau-rpc.js";

describe("normalizePiPrompt", () => {
  it("returns string prompts unchanged", () => {
    const result = normalizePiPrompt("hello");
    expect(result).toEqual({ text: "hello", coerced: false });
  });

  it("extracts text from message-like payloads", () => {
    const result = normalizePiPrompt({
      role: "user",
      content: [{ type: "text", text: "[Dec 3 13:23] Test" }],
    });
    expect(result.text).toBe("[Dec 3 13:23] Test");
    expect(result.coerced).toBe(true);
  });

  it("stringifies other prompt shapes", () => {
    const payload = { text: { foo: "bar" } };
    const result = normalizePiPrompt(payload);
    expect(result.text).toBe(JSON.stringify(payload));
    expect(result.coerced).toBe(true);
  });
});
