import { describe, it, expect } from "vitest";
import { fitWithin } from "../src/lib/image";

describe("fitWithin", () => {
  it("scales landscape to the max edge", () => {
    expect(fitWithin(4000, 3000, 1024)).toEqual({ w: 1024, h: 768 });
  });
  it("scales portrait to the max edge", () => {
    expect(fitWithin(3000, 4000, 1024)).toEqual({ w: 768, h: 1024 });
  });
  it("leaves small images unchanged", () => {
    expect(fitWithin(800, 600, 1024)).toEqual({ w: 800, h: 600 });
  });
});
