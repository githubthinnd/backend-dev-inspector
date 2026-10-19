import { type Locale, type MessageKey, MESSAGES } from "./messages.js"

export type { Locale, MessageKey }
export { MESSAGES }

export interface LocaleInfo {
  code: Locale
  /** Name of the language in that language, for the language picker. */
  name: string
}

export const LOCALES: LocaleInfo[] = [
  { code: "en", name: "English" },
  { code: "vi", name: "Tiếng Việt" },
  { code: "ja", name: "日本語" }
]

export const DEFAULT_LOCALE: Locale = "en"

const LOCALE_TAG = /^([a-z]{2,3})(?:[_\-.]|$)/i

/**
 * Maps a BCP 47 tag ("vi-VN"), a POSIX locale ("ja_JP.UTF-8") or a bare code to a supported
 * locale, or null when it names none.
 */
export function matchLocale(input: string | null | undefined): Locale | null {
  const code = LOCALE_TAG.exec(input?.trim() ?? "")?.[1]?.toLowerCase()
  return LOCALES.find(locale => locale.code === code)?.code ?? null
}

/** First supported locale in a preference list (e.g. `navigator.languages`), else English. */
export function pickLocale(preferences: readonly (string | null | undefined)[]): Locale {
  for (const preference of preferences) {
    const match = matchLocale(preference)
    if (match) {
      return match
    }
  }
  return DEFAULT_LOCALE
}

const PLACEHOLDER = /\{(\w+)\}/g

/** `{name}` placeholders are replaced; an unknown placeholder is left visible rather than dropped. */
export function translate(locale: Locale, key: MessageKey, params: Record<string, string | number> = {}): string {
  const messages = MESSAGES[locale] as Record<string, string | undefined>
  const english = MESSAGES.en as Record<string, string | undefined>
  // A `<key>.one` variant, when it exists, is used for a count of exactly 1 ("1 query", not "1 queries").
  const one = String(params.count) === "1" ? (messages[`${key}.one`] ?? english[`${key}.one`]) : undefined
  const template = one ?? messages[key] ?? english[key]!
  return template.replace(PLACEHOLDER, (whole, name: string) => name in params ? String(params[name]) : whole)
}

export function isMessageKey(key: string): key is MessageKey {
  return key in MESSAGES.en
}

/**
 * Locale for text printed by the server (terminal, API `message` fields). Only an explicit
 * `SQL_INSPECTOR_LANG` counts: a machine's `LANG` says nothing about what the developer
 * wants a dev tool to speak. Returns null when unset, so callers can tell "chosen" from "default".
 */
export function chosenLocale(env: Record<string, string | undefined>): Locale | null {
  return matchLocale(env.SQL_INSPECTOR_LANG)
}
