import { scenarios } from "@playground/shared"

export default defineEventHandler(() => scenarios.map(({ id, path, title, expect }) => ({ id, path, title, expect })))
