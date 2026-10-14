import { describe, it, expect } from "vitest";
import pt from "../src/locales/pt-PT.json";
import en from "../src/locales/en.json";

function flatten(o: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === "object" ? flatten(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  ).sort();
}

describe("locales", () => {
  it("pt-PT and en have identical keys", () => {
    expect(flatten(pt)).toEqual(flatten(en));
  });
  it("has no empty strings", () => {
    const empty = (o: Record<string, unknown>): string[] =>
      Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? empty(v as Record<string, unknown>).map((x) => `${k}.${x}`) : v === "" ? [k] : []));
    expect(empty(pt)).toEqual([]);
    expect(empty(en)).toEqual([]);
  });
});
