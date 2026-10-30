import { createPrismaRepository } from "./prisma-repository"
import type { Repository } from "@playground/shared"

let repository: Repository | undefined

/** Prisma on SQLite, opened on first use. */
export function useRepository(): Repository {
  return repository ??= createPrismaRepository()
}
