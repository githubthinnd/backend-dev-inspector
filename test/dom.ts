import type { DOMWindow } from "jsdom"
import { JSDOM, VirtualConsole } from "jsdom"

export interface WindowOptions {
  url: string
  width?: number
  height?: number
}

/**
 * A browser window for the widget and page tests. A blank virtual console keeps jsdom's
 * complaints about CSS it cannot parse (`color-mix`, `:where`) out of the test output.
 */
export function createWindow({ url, width = 1024, height = 768 }: WindowOptions): DOMWindow {
  const { window } = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    url,
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole()
  })
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true, writable: true })
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true, writable: true })
  return window
}
