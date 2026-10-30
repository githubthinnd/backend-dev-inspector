import { matchRoute, pathnameOf } from "./route-filter.js"

/**
 * A performance budget for the requests of a route: at most this many calls, this long in all, this much time in
 * calls. Written as `[METHOD ]/path/pattern=calls:10,ms:200,callMs:80` (the path takes the same `*` and `**` as the route
 * filters); several are separated by `;` or given as a list. A request that goes over raises a warning, and the first
 * budget that matches a request is the one that applies.
 */
export interface Budget {
  method: string | null
  route: string
  calls: number | null
  ms: number | null
  callMs: number | null
}

const METRICS = { calls: "calls", ms: "ms", callms: "callMs" } as const
const METHOD = /^[A-Za-z]+$/
const MAX_BUDGETS = 50
const MAX_TEXT = 200

/** One budget, or null when the text is not one. */
export function parseBudget(text: string): Budget | null {
  const equals = text.lastIndexOf("=")
  if (equals <= 0 || text.length > MAX_TEXT) {
    return null
  }
  const head = text.slice(0, equals).trim().split(/\s+/)
  const [first, second] = head
  const method = head.length === 2 && first && METHOD.test(first) ? first.toUpperCase() : null
  const route = (method ? second : first) ?? ""
  if ((head.length !== 1 && head.length !== 2) || (head.length === 2 && !method) || !route) {
    return null
  }
  const budget: Budget = { method, route: route.startsWith("/") ? route : `/${route}`, calls: null, ms: null, callMs: null }
  for (const part of text.slice(equals + 1).split(",")) {
    const [name, value] = part.split(":").map(item => item.trim())
    const lowered = (name ?? "").toLowerCase()
    const key = Object.hasOwn(METRICS, lowered) ? METRICS[lowered as keyof typeof METRICS] : undefined // not "constructor" or "__proto__"
    const number = Number(value)
    if (!key || !value || !Number.isFinite(number) || number < 0) {
      return null
    }
    budget[key] = number
  }
  return budget.calls === null && budget.ms === null && budget.callMs === null ? null : budget
}

/** Valid budgets from `a=calls:1; b=ms:5` or a list of such strings; invalid ones are dropped. */
export function parseBudgets(raw: string | readonly string[] | undefined): Budget[] {
  const items = typeof raw === "string" ? raw.split(";") : (raw ?? []).flatMap(item => item.split(";"))
  return items.map(item => item.trim()).filter(Boolean).map(parseBudget).filter((budget): budget is Budget => budget !== null).slice(0, MAX_BUDGETS)
}

/** `^[METHOD ]route=calls:..` strings that all parse, or undefined when one does not (for validating input). */
export function validBudgetList(raw: readonly unknown[]): string[] | undefined {
  if (raw.length > MAX_BUDGETS || raw.some(item => typeof item !== "string" || item.includes(";") || parseBudget(item) === null)) {
    return undefined
  }
  return (raw as string[]).map(item => item.trim())
}

/** The budget that applies to a request, if any. */
export function budgetFor(budgets: readonly Budget[], method: string, url: string): Budget | undefined {
  const path = pathnameOf(url)
  return budgets.find(budget => (budget.method === null || budget.method === method.toUpperCase()) && matchRoute(budget.route, path))
}

export const budgetKey = (budgets: readonly Budget[]) => budgets.map(b => `${b.method}|${b.route}|${b.calls}|${b.ms}|${b.callMs}`).join(";")
