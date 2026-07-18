export function readCookieValue(cookieHeader: string, name: string): string | null {
  for (const segment of cookieHeader.split(';')) {
    const cookie = segment.trim();
    const separator = cookie.indexOf('=');
    if (separator < 0 || cookie.slice(0, separator) !== name) continue;
    return cookie.slice(separator + 1);
  }
  return null;
}
