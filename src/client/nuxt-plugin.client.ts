import { defineNuxtPlugin, useRuntimeConfig } from "#app"
import { mountSqlInspectorWidget } from "./widget.js"

// Dev only, twice over: the module registers this plugin in `nuxt dev` only, and the plugin
// itself does nothing outside dev.
export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  if (!import.meta.dev) {
    return
  }
  mountSqlInspectorWidget({ baseURL: config.app.baseURL })
})
