import { IndexedDbRepository } from "./indexeddb";
import type { RilievoRepository } from "./repository";

export type { RilievoRepository } from "./repository";
export { freshJob } from "./repository";
export type * from "./types";

let repository: RilievoRepository | null = null;

export function getRepository(): RilievoRepository {
  if (!repository) repository = new IndexedDbRepository();
  return repository;
}
