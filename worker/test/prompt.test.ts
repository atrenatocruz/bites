import { describe, it, expect } from "vitest";
import { SYSTEM_PROMPT, buildUserText } from "../src/prompt";

describe("buildUserText", () => {
  it("states the language for pt-PT and English", () => {
    expect(buildUserText({ image: "x", locale: "pt-PT", localTime: "12:30" })).toContain("Language: European Portuguese (pt-PT)");
    expect(buildUserText({ image: "x", locale: "en", localTime: "12:30" })).toContain("Language: English");
  });
  it("uses 'none' when the hint is empty or blank", () => {
    expect(buildUserText({ image: "x", locale: "en", localTime: "12:30" })).toContain("User hint: none");
    expect(buildUserText({ image: "x", hint: "   ", locale: "en", localTime: "12:30" })).toContain("User hint: none");
  });
  it("truncates text descriptions to 500 chars and hints to 200", () => {
    const out = buildUserText({ text: "a".repeat(800), hint: "h".repeat(300), locale: "en", localTime: "12:30" });
    expect(out).toContain(`"""${"a".repeat(500)}"""`);
    expect(out).not.toContain("a".repeat(501));
    expect(out).toContain(`User hint: ${"h".repeat(200)}\n`);
  });
  it("describes a photo request when an image is present", () => {
    expect(buildUserText({ image: "x", locale: "en", localTime: "08:00" })).toContain("meal in this photo");
  });
});

describe("SYSTEM_PROMPT", () => {
  it("is long enough to be cacheable and contains no template interpolation", () => {
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(3000);
    expect(SYSTEM_PROMPT).not.toContain("${");
  });
});
