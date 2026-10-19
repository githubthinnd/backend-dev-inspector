// Types for the two Nuxt things the client plugin touches, so the package compiles without
// depending on Nuxt. The real ones are supplied by the consumer's Nuxt app.
declare module "#app" {
  export function defineNuxtPlugin(setup: () => void): unknown
  export function useRuntimeConfig(): { app: { baseURL: string } }
}

interface ImportMeta {
  dev?: boolean
}
