import type { Repo } from "./types";
import { LocalRepo } from "./local";

export type { Repo } from "./types";

export function createRepo(): Repo {
  return new LocalRepo();
}
