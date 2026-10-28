import { createNitroPlugin } from "sql-dev-inspector/nitro"
import { withDefaults } from "./options.js"

/** Nitro plugin (Nuxt, Nitro) with every driver; register it in `nitro.plugins`. */
export default createNitroPlugin(withDefaults())
