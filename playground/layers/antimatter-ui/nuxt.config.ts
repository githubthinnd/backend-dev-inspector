import { fileURLToPath } from "node:url"

// The Antimatter front end for the Nuxt apps: the same design as the plain-HTML apps, written with Vue.
export default defineNuxtConfig({
  css: [fileURLToPath(new URL("../../shared/web/app.css", import.meta.url))],
  app: {
    head: {
      title: "Antimatter",
      meta: [{ name: "viewport", content: "width=device-width, initial-scale=1" }],
      link: [{ rel: "icon", href: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='9' fill='%236366f1'/%3E%3Ccircle cx='16' cy='16' r='6' fill='none' stroke='white' stroke-width='2.4'/%3E%3C/svg%3E" }]
    }
  }
})
