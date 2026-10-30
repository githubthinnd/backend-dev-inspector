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

/**
 * The ESM counterpart of `tryLoad`, for libraries that ship an ESM and a CommonJS build: those are two
 * separate copies, and an application that `import`s the library is on the ESM one. Written as
 * `tryImport(r => r("name"))` so that the name is always a literal, and checked the same way.
 */
export async function tryImport<T>(loader: (load: (name: string) => Promise<unknown>) => Promise<T>): Promise<T | null> {
  try {
    return await loader(name => import(name))
  } catch {
    return null
  }
}
