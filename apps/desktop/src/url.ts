/**
 * Parse the ready URL printed by the web-app runtime.
 * @module @deepseek-ai/dsh-desktop/url
 */

const WEB_URL_LINE = /^dsh web: (https?:\/\/\S+)/u

/**
 * Extract the canonical loopback URL from one web-app stdout line.
 * LAN annotations after the first URL are ignored.
 * @param line - one stdout line, with or without a trailing newline.
 * @returns the first `http(s)` URL, or `undefined` when the line is not a ready line.
 */
export function parseWebReadyUrl(line: string): string | undefined {
  const match = WEB_URL_LINE.exec(line.trimEnd())
  return match?.[1]
}
