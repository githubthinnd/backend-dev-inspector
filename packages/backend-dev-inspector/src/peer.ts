import { createRequire } from "node:module"

const load = createRequire(import.meta.url)
/** Resolves from the folder the process runs in, which is the application's. */
const resolveFromApp = createRequire(`${process.cwd()}/`)

/**
 * Loads an optional peer dependency, or returns null when the application does not have it.
 * Written as `tryLoad(r => r("name"))` so that the name is always a literal: a test checks every
 * call site against the peer dependencies the package declares.
 */
export function tryLoad<T>(loader: (load: NodeJS.Require) => T): T | null {
  // The application's own copy first: it is the one the application calls. Then the copy this package can see,
  // which is the same one in an ordinary install and the only one when the process runs from another folder.
  for (const resolver of [resolveFromApp, load]) {
    try {
      return loader(resolver)
    } catch {
      // not found from there: try the next place
    }
  }
  return null
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

export interface Location {
  /** Where the library resolves from the application's own folder (the one `npm start` runs in), or null. */
  fromApp: string | null
  /** Where it resolves from this package, which is where the inspector looks for it, or null. */
  fromPackage: string | null
}

/** For the setup check: which copy of a library the application would load, and which one the inspector would. */
export function locate(name: string): Location {
  const find = (resolve: NodeJS.RequireResolve) => {
    try {
      return resolve(name)
    } catch {
      return null
    }
  }
  return { fromApp: find(resolveFromApp.resolve), fromPackage: find(load.resolve) }
}
