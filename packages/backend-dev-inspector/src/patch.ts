/** Small helpers shared by the drivers that wrap methods of a library's classes. */

const PATCHED = Symbol.for("backendDevInspector.patched")

// Patched methods have any signature; each driver knows its own.
// eslint-disable-next-line ts/no-explicit-any
type AnyFunction = (...args: any[]) => any

export interface Patch {
  target: object
  name: string
  make: (original: AnyFunction) => AnyFunction
}

/**
 * Replaces `target[name]` with `make(original)` for each patch and returns the function that
 * puts the originals back. A patch is applied at most once per method, however many times the
 * driver is installed; installing again first undoes the earlier install, so a reloaded module
 * never stacks two wrappers.
 */
export function applyPatches(owner: object, patches: Patch[]): () => void {
  const registry = owner as Record<symbol, (() => void) | undefined>
  registry[PATCHED]?.()

  const applied = patches
    .filter(patch => typeof (patch.target as Record<string, unknown>)[patch.name] === "function")
    .map(patch => ({
      ...patch,
      original: (patch.target as Record<string, AnyFunction>)[patch.name]!,
      hadOwn: Object.hasOwn(patch.target, patch.name)
    }))
  for (const patch of applied) {
    ;(patch.target as Record<string, unknown>)[patch.name] = patch.make(patch.original)
  }
  const uninstall = () => {
    for (const patch of applied) {
      if (patch.hadOwn) {
        ;(patch.target as Record<string, unknown>)[patch.name] = patch.original
      } else {
        delete (patch.target as Record<string, unknown>)[patch.name]
      }
    }
    registry[PATCHED] = undefined
  }
  registry[PATCHED] = uninstall
  return uninstall
}

/** A stable small integer per object, negative so it can never clash with a real connection id. */
const ids = new WeakMap<object, number>()
let counter = 0
export function objectId(object: object): number {
  let id = ids.get(object)
  if (id === undefined) {
    id = -(++counter)
    ids.set(object, id)
  }
  return id
}
