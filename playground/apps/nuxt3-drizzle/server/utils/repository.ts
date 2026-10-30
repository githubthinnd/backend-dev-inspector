import { openDatabase, type Repository } from "@playground/shared"
import { createDrizzleRepository } from "@playground/shared/drizzle"

let repository: Repository | undefined

/** Drizzle ORM on better-sqlite3, opened on first use. */
export function useRepository(): Repository {
  return repository ??= createDrizzleRepository(openDatabase())
}
