import { createRequire } from "node:module"

const load = createRequire(import.meta.url)

/**
 * Loads an optional peer dependency, or returns null when the application does not have it.
 * Written as `tryLoad(r => r("name"))` so that the name is always a literal: a test checks every
 * call site against the peer dependencies the package declares.
 */
export function tryLoad<T>(loader: (load: NodeJS.Require) => T): T | null {
  try {
    return loader(load)
  } catch {
    return null
  }
}
