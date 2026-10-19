import { describe, expect, it } from "vitest"
import { chosenLocale, DEFAULT_LOCALE, isMessageKey, LOCALES, matchLocale, MESSAGES, pickLocale, translate } from "../src/i18n"

const placeholders = (text: string) => Array.from(text.matchAll(/\{(\w+)\}/g), m => m[1]).sort()
const keys = Object.keys(MESSAGES.en)

describe("messages", () => {
  it("declares every locale in the picker, and the picker lists nothing undeclared", () => {
    expect(LOCALES.map(l => l.code).sort()).toEqual(Object.keys(MESSAGES).sort())
    expect(DEFAULT_LOCALE).toBe("en")
  })

  it.each(LOCALES.map(l => l.code))("%s defines exactly the English keys, with the same placeholders, and no empty text", (code) => {
    expect(Object.keys(MESSAGES[code]).sort()).toEqual([...keys].sort())
    for (const key of keys) {
      const text = MESSAGES[code][key as keyof typeof MESSAGES.en]
      expect(text.trim(), `${code}:${key} is empty`).not.toBe("")
      expect(placeholders(text), `${code}:${key} placeholders`).toEqual(placeholders(MESSAGES.en[key as keyof typeof MESSAGES.en]))
    }
  })

  it("has a title and a message for every insight type", () => {
    for (const type of ["n-plus-one", "duplicate", "slow", "select-star", "select-in-transaction", "write-outside-transaction", "deep-subquery", "error", "many-queries"]) {
      expect(isMessageKey(`insight.title.${type}`)).toBe(true)
      expect(isMessageKey(`insight.msg.${type}`)).toBe(true)
    }
  })
})

describe("translate", () => {
  it("fills placeholders, and leaves an unknown one visible instead of dropping it", () => {
    expect(translate("en", "tx.savepoint", { name: "sp1" })).toBe("Savepoint sp1")
    expect(translate("en", "tx.savepoint")).toBe("Savepoint {name}")
    expect(translate("vi", "term.queries", { count: 3 })).toBe("3 query")
    expect(translate("ja", "term.queries", { count: 3 })).toBe("3クエリ")
  })

  it("uses the singular variant for a count of exactly one", () => {
    expect(translate("en", "term.queries", { count: 1 })).toBe("1 query")
    expect(translate("en", "term.queries", { count: 2 })).toBe("2 queries")
    expect(translate("en", "term.queries", { count: 0 })).toBe("0 queries")
    expect(translate("en", "sql.rows", { count: "1" })).toBe("1 row")
    expect(translate("en", "tx.statements", { count: 1 })).toBe("1 statement")
    expect(translate("vi", "term.queries", { count: 1 })).toBe("1 query")
  })

  it("does not interpret dollar signs in values as replacement patterns", () => {
    expect(translate("en", "insight.msg.error", { error: "price = $& $1" })).toBe("SQL error: price = $& $1")
  })
})

describe("locale detection", () => {
  it.each([
    ["vi", "vi"],
    ["vi-VN", "vi"],
    ["ja_JP.UTF-8", "ja"],
    ["EN-us", "en"],
    ["en", "en"],
    ["fr-FR", null],
    ["", null],
    [undefined, null],
    [null, null],
    ["zzz", null]
  ])("matchLocale(%s) → %s", (input, expected) => {
    expect(matchLocale(input as string)).toBe(expected)
  })

  it("picks the first supported language of a preference list, else English", () => {
    expect(pickLocale(["fr-FR", "ja-JP", "en"])).toBe("ja")
    expect(pickLocale(["fr", "de"])).toBe("en")
    expect(pickLocale([])).toBe("en")
  })

  it("lets only an explicit SQL_INSPECTOR_LANG choose the server language, never the machine's LANG", () => {
    expect(chosenLocale({ SQL_INSPECTOR_LANG: "ja" })).toBe("ja")
    expect(chosenLocale({ SQL_INSPECTOR_LANG: "fr" })).toBeNull()
    expect(chosenLocale({ LANG: "vi_VN.UTF-8" })).toBeNull()
    expect(chosenLocale({})).toBeNull()
  })
})
