/**
 * Just enough user-agent parsing to label a signed-in device ("Chrome on macOS"). Order matters:
 * Edge and Opera also claim Chrome, Chrome also claims Safari, iPadOS may claim macOS.
 */
export type DeviceKind = "desktop" | "mobile" | "tablet"

export type ParsedAgent = {
  browser: string | null
  os: string | null
  device: DeviceKind
}

const BROWSERS: [RegExp, string][] = [
  [/EdgA?\/|Edg\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
]

const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPad|iPod/, "iOS"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/CrOS/, "ChromeOS"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/Linux/, "Linux"],
]

export function parseUserAgent(ua: string | null | undefined): ParsedAgent {
  if (!ua) return { browser: null, os: null, device: "desktop" }
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1] ?? null
  const os = SYSTEMS.find(([re]) => re.test(ua))?.[1] ?? null
  const device: DeviceKind = /iPad|Tablet/.test(ua)
    ? "tablet"
    : /Mobi|iPhone|Android/.test(ua)
      ? "mobile"
      : "desktop"
  return { browser, os, device }
}
