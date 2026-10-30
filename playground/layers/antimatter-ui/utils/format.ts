export const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })

const PALETTE = ["#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#0ea5e9", "#ef4444", "#14b8a6"]

/** A stable colour per name, so a person keeps the same avatar everywhere. */
export function hue(name: string): string {
  let h = 0
  for (const char of name) {
    h = (h * 31 + char.charCodeAt(0)) >>> 0
  }
  return PALETTE[h % PALETTE.length]!
}

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join("").toUpperCase()

export const FLAGS: Record<string, string> = { JP: "🇯🇵", VN: "🇻🇳", US: "🇺🇸", IT: "🇮🇹", FR: "🇫🇷", DE: "🇩🇪" }
export const COUNTRIES: Record<string, string> = { JP: "Japan", VN: "Vietnam", US: "United States", IT: "Italy", FR: "France", DE: "Germany" }
