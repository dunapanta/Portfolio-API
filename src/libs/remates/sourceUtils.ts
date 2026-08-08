export const decodeHtml = (value: string) => value
  .replace(/&nbsp;|&#160;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));

export const stripTags = (value: string) => decodeHtml(value.replace(/<[^>]+>/g, " "))
  .replace(/\s+/g, " ")
  .trim();

export const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const inputValue = (html: string, name: string) => {
  const escaped = escapeRegExp(name);
  return decodeHtml(html.match(new RegExp(`name=["']${escaped}["'][^>]*value=["']([^"']*)`, "i"))?.[1] || "");
};

export const ecuadorDate = (value: string | null) => {
  if (!value) return null;
  const numeric = value.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (numeric) {
    const [, day, month, year, hour = "00", minute = "00", second = "00"] = numeric;
    return `${year}-${month}-${day}T${hour}:${minute}:${second}-05:00`;
  }
  const months: Record<string, string> = {
    ene: "01", enero: "01", feb: "02", febrero: "02", mar: "03", marzo: "03", abr: "04", abril: "04",
    may: "05", mayo: "05", jun: "06", junio: "06", jul: "07", julio: "07", ago: "08", agosto: "08",
    sep: "09", sept: "09", septiembre: "09", oct: "10", octubre: "10", nov: "11", noviembre: "11",
    dic: "12", diciembre: "12",
  };
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
  const words = normalized.match(/(?:[a-z]+,?\s*)?(\d{1,2})\s+(?:de\s+)?([a-z]+)\s+(?:de\s+)?(\d{4})/);
  if (!words) return null;
  const month = months[words[2].replace(/\.$/, "")];
  if (!month) return null;
  return `${words[3]}-${month}-${words[1].padStart(2, "0")}T00:00:00-05:00`;
};

export const endOfEcuadorDay = (value: string | null) => value ? `${value.slice(0, 10)}T23:59:59-05:00` : null;

export class CookieSession {
  private readonly cookies = new Map<string, string>();

  async request(url: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (!headers.has("User-Agent")) headers.set("User-Agent", "RematesEcuador/1.0 (+https://www.dunapant.dev/tools/remates-ecuador)");
    if (this.cookies.size) headers.set("Cookie", [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; "));
    const response = await fetch(url, { ...init, headers, signal: init.signal || AbortSignal.timeout(45_000) });
    const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    const setCookies = getSetCookie?.call(response.headers) || (response.headers.get("set-cookie") ? [response.headers.get("set-cookie") as string] : []);
    for (const cookie of setCookies) {
      const [pair] = cookie.split(";");
      const separator = pair.indexOf("=");
      if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    return response;
  }
}

export const pdfFilename = (header: string | null, fallback: string) => {
  if (!header) return fallback;
  const value = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1] || header.match(/filename="?([^";]+)"?/i)?.[1];
  if (!value) return fallback;
  try { return decodeURIComponent(value); } catch { return value; }
};
