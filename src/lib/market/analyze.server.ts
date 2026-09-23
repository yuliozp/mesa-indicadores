import https from "node:https";
import { bollinger, contractRange, macdSeries, recomLabel, rsiWilder, sma, vwapTypical, wordenStochastic } from "./math";
import type { Analysis, CalendarInfo, ChartPoint, ContractRow, IntervalId, OverlayPoint, OverlaySeries, SideRange } from "./types";

export type { Analysis, ChartPoint, ContractRow, SideRange };

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const MIN_PREMIUM = 0.3;

type QuoteBar = {
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
};

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json", ...headers },
      signal: AbortSignal.timeout(18000),
    });
    lastStatus = res.status;
    if (res.status === 429 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`Fuente no disponible (${res.status})`);
    return res.json();
  }
  throw new Error(`Fuente no disponible (${lastStatus})`);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

type ChartResult = {
  meta: Record<string, unknown>;
  timestamps: number[];
  quote: QuoteBar[];
};

function readChart(payload: unknown): ChartResult | null {
  const chart = (payload as { chart?: { result?: unknown[] } }).chart;
  const result = chart?.result?.[0] as
    | {
        meta?: Record<string, unknown>;
        timestamp?: number[];
        indicators?: { quote?: Array<Record<string, Array<number | null>>> };
      }
    | undefined;
  if (!result?.meta) return null;
  const q = result.indicators?.quote?.[0] ?? {};
  const ts = result.timestamp ?? [];
  const quote: QuoteBar[] = ts.map((_, i) => ({
    open: q.open?.[i] ?? null,
    high: q.high?.[i] ?? null,
    low: q.low?.[i] ?? null,
    close: q.close?.[i] ?? null,
    volume: q.volume?.[i] ?? null,
  }));
  return { meta: result.meta, timestamps: ts, quote };
}

async function yahooChart(symbol: string, interval: string, range: string): Promise<ChartResult | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`;
  try {
    const payload = await fetchJson(url);
    return readChart(payload);
  } catch {
    return null;
  }
}

const MONTHS: Record<string, number> = {
  January: 1,
  February: 2,
  March: 3,
  April: 4,
  May: 5,
  June: 6,
  July: 7,
  August: 8,
  September: 9,
  October: 10,
  November: 11,
  December: 12,
};

function parseGroupDate(label: string): string | null {
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/.exec(label.trim());
  if (!m) return null;
  const month = MONTHS[m[1]];
  if (!month) return null;
  const day = Number(m[2]);
  return `${m[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function yymmdd(iso: string): string {
  return iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);
}

/** Después del cierre (16:00 ET) o en fin de semana, el vencimiento de hoy ya no sirve. */
export function expirationCutoff(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const iso = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = Number(get("hour"));
  const weekday = get("weekday");
  const after = weekday === "Sat" || weekday === "Sun" || hour >= 16;
  if (!after) return iso;
  const [y, m, d] = iso.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}

type ChainRow = Record<string, unknown>;

async function loadChain(ticker: string): Promise<ChainRow[]> {
  for (const asset of ["stocks", "etf"]) {
    try {
      const payload = (await fetchJson(
        `https://api.nasdaq.com/api/quote/${encodeURIComponent(ticker)}/option-chain?assetclass=${asset}&limit=800`,
        { Origin: "https://www.nasdaq.com", Referer: "https://www.nasdaq.com/" },
      )) as { data?: { table?: { rows?: ChainRow[] } } };
      const rows = payload.data?.table?.rows;
      if (Array.isArray(rows) && rows.some((r) => r.strike)) return rows;
    } catch {
      /* prueba el otro tipo de activo */
    }
  }
  return [];
}

function pickExpiration(rows: ChainRow[], cutoff: string): { expiration: string; strikes: ChainRow[] } | null {
  let chosen: string | null = null;
  const strikes: ChainRow[] = [];
  for (const row of rows) {
    const group = typeof row.expirygroup === "string" ? row.expirygroup.trim() : "";
    if (group) {
      if (chosen) break;
      const iso = parseGroupDate(group);
      if (iso && iso >= cutoff) chosen = iso;
      continue;
    }
    if (chosen && row.strike != null && row.strike !== "") strikes.push(row);
  }
  return chosen ? { expiration: chosen, strikes } : null;
}

function parseMoney(v: unknown): number | null {
  if (typeof v !== "string" || v === "--" || v.trim() === "") return null;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function sideRanges(
  ticker: string,
  expiration: string,
  strikes: ChainRow[],
): Promise<{ call: SideRange | null; put: SideRange | null }> {
  const root = ticker.replace(/\./g, "");
  const exp = yymmdd(expiration);
  const jobs: Array<{ side: "C" | "P"; strike: number; symbol: string }> = [];
  for (const row of strikes) {
    const strike = parseMoney(String(row.strike));
    if (strike == null) continue;
    const code = String(Math.round(strike * 1000)).padStart(8, "0");
    if ((parseMoney(row.c_Last) ?? 0) >= MIN_PREMIUM) {
      jobs.push({ side: "C", strike, symbol: `${root}${exp}C${code}` });
    }
    if ((parseMoney(row.p_Last) ?? 0) >= MIN_PREMIUM) {
      jobs.push({ side: "P", strike, symbol: `${root}${exp}P${code}` });
    }
  }

  const quotes = await mapPool(jobs, 8, async (job) => {
    const chart = await yahooChart(job.symbol, "1d", "5d");
    const meta = chart?.meta;
    const price = num(meta?.regularMarketPrice);
    const maximo = num(meta?.regularMarketDayHigh);
    const minimo = num(meta?.regularMarketDayLow);
    if (price == null || maximo == null || minimo == null || price < MIN_PREMIUM || minimo <= 0) {
      return null;
    }
    return {
      side: job.side,
      strike: job.strike,
      price,
      minimo,
      maximo,
      ratio: Math.round((maximo / minimo) * 10000) / 100,
    };
  });

  const build = (side: "C" | "P"): SideRange | null => {
    const ranked = quotes
      .filter((q): q is NonNullable<typeof q> => q != null && q.side === side)
      .sort((a, b) => b.ratio - a.ratio || a.strike - b.strike);
    if (ranked.length < 2) return null;
    const { desde, hasta } = contractRange(ranked[0].price, ranked[1].price);
    return {
      desde,
      hasta,
      detalle: ranked.slice(0, 8).map(({ strike, price, minimo, maximo, ratio }) => ({
        strike,
        price: round4(price),
        minimo: round4(minimo),
        maximo: round4(maximo),
        ratio,
      })),
    };
  };

  return { call: build("C"), put: build("P") };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function round2(n: number | null): number | null {
  return n == null ? null : Math.round(n * 100) / 100;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&/g, "&")
    .replace(/&#39;|'/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function finvizSnapshot(ticker: string): Promise<Record<string, string>> {
  try {
    const res = await fetch(`https://finviz.com/quote.ashx?t=${encodeURIComponent(ticker)}`, {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(18000),
    });
    if (!res.ok) return {};
    const html = await res.text();
    const out: Record<string, string> = {};
    const re = /snapshot-td-label">([\s\S]*?)<\/div>[\s\S]*?snapshot-td-content">([\s\S]*?)<\/div>/g;
    for (const match of html.matchAll(re)) {
      const label = stripTags(match[1]);
      const value = stripTags(match[2]);
      if (label && value && value !== "-") out[label] = value;
    }
    const sector = html.match(/f=sec_[^"]*"[^>]*>([^<]+)/);
    const industry =
      html.match(/f=ind_[^"]*"[^>]*title="([^"]+)"/) ??
      html.match(/f=ind_[^"]*"[^>]*>\s*(?:<span[^>]*>)?([^<]+)/);
    if (sector) out.Sector = stripTags(sector[1]);
    if (industry) out.Industry = stripTags(industry[1]);
    return out;
  } catch {
    return {};
  }
}

function parseTarget(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function etDate(unix: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(unix * 1000));
}

export async function analyzeTickerData(rawTicker: string): Promise<Analysis> {
  const ticker = rawTicker.trim().toUpperCase();
  const daily = await yahooChart(ticker, "1d", "5y");
  if (!daily) throw new Error(`No encontré el ticker ${ticker}.`);
  const meta = daily.meta;
  const price = num(meta.regularMarketPrice);
  if (price == null) throw new Error(`Yahoo no devolvió precio para ${ticker}.`);

  const closes: number[] = [];
  const dates: string[] = [];
  daily.timestamps.forEach((ts, i) => {
    const close = daily.quote[i]?.close;
    if (close == null) return;
    closes.push(close);
    dates.push(etDate(ts));
  });
  const lastDate = dates[dates.length - 1];
  const today = etDate(Math.floor(Date.now() / 1000));
  if (!closes.length || lastDate !== today) {
    closes.push(price);
    dates.push(today);
  } else if (Math.abs(closes[closes.length - 1] - price) > 0.0001) {
    closes[closes.length - 1] = price;
  }

  const rsi = rsiWilder(closes, 14);
  const macd = macdSeries(closes);
  const chart: ChartPoint[] = closes.slice(-140).map((close, offset) => {
    const i = closes.length - Math.min(closes.length, 140) + offset;
    return {
      date: dates[i],
      close: round2(close) as number,
      rsi: rsi[i] == null ? null : Math.round((rsi[i] as number) * 10) / 10,
      macd: round2(macd.line[i]),
      signal: round2(macd.signal[i]),
      hist: round2(macd.hist[i]),
    };
  });

  const intraday = await yahooChart(ticker, "5m", "5d");
  let vwap: number | null = null;
  if (intraday) {
    const session = today;
    const bars = intraday.timestamps.flatMap((ts, i) => {
      if (etDate(ts) !== session) return [];
      const q = intraday.quote[i];
      if (q?.high == null || q.low == null || q.close == null || q.volume == null) return [];
      return [{ high: q.high, low: q.low, close: q.close, volume: q.volume }];
    });
    const used = bars.length ? bars : fallbackLastSession(intraday);
    vwap = vwapTypical(used);
  }

  const snap = await finvizSnapshot(ticker);
  const calendar = await loadCalendar(ticker, snap);
  const chain = await loadChain(ticker);
  const picked = pickExpiration(chain, expirationCutoff());
  let call: SideRange | null = null;
  let put: SideRange | null = null;
  let expiration: string | null = null;
  if (picked) {
    expiration = picked.expiration;
    const ranges = await sideRanges(ticker, picked.expiration, picked.strikes);
    call = ranges.call;
    put = ranges.put;
  }

  const last = chart[chart.length - 1];
  const sector = snap.Sector ?? null;
  const industry = snap.Industry ?? null;
  const name =
    (typeof meta.shortName === "string" && meta.shortName) ||
    (typeof meta.longName === "string" && meta.longName) ||
    ticker;

  const note = expiration
    ? "Fecha de cierre: vencimiento más cercano que sigue vigente. El rango call/put sale de los dos contratos (prima ≥ $0.30) con mayor recorrido del día, la prima × 100 redondeada de 5 en 5. Mismo criterio que tu calculadora."
    : "No hay cadena de opciones vigente para este ticker. Los indicadores de precio sí están calculados.";

  return {
    ticker,
    name,
    indices: snap.Index ?? null,
    sector: sector ?? (industry ? null : quoteTypeLabel(meta)),
    industry,
    high52: num(meta.fiftyTwoWeekHigh),
    low52: num(meta.fiftyTwoWeekLow),
    price,
    previousClose: num(meta.chartPreviousClose) ?? num(meta.previousClose),
    rsi: last?.rsi ?? null,
    vwap: vwap == null ? null : Math.round(vwap * 100) / 100,
    macd: last?.macd ?? null,
    macdSignal: last?.signal ?? null,
    macdHist: last?.hist ?? null,
    targetPrice: parseTarget(snap["Target Price"]),
    recom: parseTarget(snap.Recom),
    recomLabel: recomLabel(parseTarget(snap.Recom)),
    expiration,
    calculatedAt: new Date().toISOString(),
    call,
    put,
    chart,
    overlay: overlayFromBars(ticker, "1d", barsWithLiveClose(ohlcBars(daily, false), today, price)),
    calendar,
    note,
  };
}

const INTERVALS: Record<IntervalId, { yahoo: string; range: string; label: string }> = {
  "1m": { yahoo: "1m", range: "5d", label: "1 minuto" },
  "5m": { yahoo: "5m", range: "60d", label: "5 minutos" },
  "15m": { yahoo: "15m", range: "60d", label: "15 minutos" },
  "1h": { yahoo: "60m", range: "2y", label: "1 hora" },
  "1d": { yahoo: "1d", range: "5y", label: "1 día" },
};

function stamp(unix: number, withTime: boolean): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(unix * 1000));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = `${get("year")}-${get("month")}-${get("day")}`;
  return withTime ? `${day} ${get("hour")}:${get("minute")}` : day;
}

type Bar = { t: string; open: number; high: number; low: number; close: number; volume: number };

function ohlcBars(chart: ChartResult, withTime: boolean): Bar[] {
  const out: Bar[] = [];
  chart.timestamps.forEach((ts, i) => {
    const q = chart.quote[i];
    if (q?.close == null) return;
    const close = q.close;
    const open = q.open ?? close;
    const high = Math.max(q.high ?? close, open, close);
    const low = Math.min(q.low ?? close, open, close);
    out.push({ t: stamp(ts, withTime), open, high, low, close, volume: q.volume ?? 0 });
  });
  return out;
}

function barsWithLiveClose(bars: Bar[], today: string, price: number): Bar[] {
  if (!bars.length || bars[bars.length - 1].t.slice(0, 10) < today) {
    return [...bars, { t: today, open: price, high: price, low: price, close: price, volume: 0 }];
  }
  if (bars[bars.length - 1].t.slice(0, 10) === today) {
    const copy = bars.slice();
    const last = copy[copy.length - 1];
    copy[copy.length - 1] = {
      ...last,
      close: price,
      high: Math.max(last.high, price),
      low: Math.min(last.low, price),
    };
    return copy;
  }
  return bars;
}

function roundTo(n: number | null, digits: number): number | null {
  if (n == null || Number.isNaN(n)) return null;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

export function overlayFromBars(ticker: string, interval: IntervalId, bars: Bar[]): OverlaySeries {
  const spec = INTERVALS[interval];
  const closes = bars.map((b) => b.close);
  const ma20 = sma(closes, 20);
  const ma40 = sma(closes, 40);
  const ma100 = sma(closes, 100);
  const ma200 = sma(closes, 200);
  const bb = bollinger(closes, 20, 2);
  const worden = wordenStochastic(closes, 14, 3);
  const points: OverlayPoint[] = bars.map((bar, i) => ({
    t: bar.t,
    open: roundTo(bar.open, 4) as number,
    high: roundTo(bar.high, 4) as number,
    low: roundTo(bar.low, 4) as number,
    close: roundTo(bar.close, 4) as number,
    volume: Math.round(bar.volume),
    ma20: roundTo(ma20[i], 4),
    ma40: roundTo(ma40[i], 4),
    ma100: roundTo(ma100[i], 4),
    ma200: roundTo(ma200[i], 4),
    bbMid: roundTo(bb.mid[i], 4),
    bbUpper: roundTo(bb.upper[i], 4),
    bbLower: roundTo(bb.lower[i], 4),
    worden: roundTo(worden[i], 2),
  }));
  return { ticker, interval, label: spec.label, points };
}

export function isInterval(value: string): value is IntervalId {
  return value === "1m" || value === "5m" || value === "15m" || value === "1h" || value === "1d";
}

export async function loadOverlaySeries(ticker: string, interval: IntervalId): Promise<OverlaySeries> {
  const spec = INTERVALS[interval];
  let chart = await yahooChart(ticker, spec.yahoo, spec.range);
  if (!chart && interval === "1h") chart = await yahooChart(ticker, "60m", "1y");
  if (!chart) throw new Error(`No hay velas de ${spec.label} para ${ticker}.`);
  const withTime = interval !== "1d";
  let bars = ohlcBars(chart, withTime);
  if (interval === "1d") {
    const price = num(chart.meta.regularMarketPrice);
    const today = etDate(Math.floor(Date.now() / 1000));
    if (price != null) bars = barsWithLiveClose(bars, today, price);
  }
  if (bars.length < 20) throw new Error(`Muy pocas velas de ${spec.label} para armar las medias.`);
  return overlayFromBars(ticker, interval, bars);
}

const FOMC: Array<[string, string]> = [
  ["2026-10-27", "2026-10-28"],
  ["2026-12-08", "2026-12-09"],
  ["2027-01-26", "2027-01-27"],
  ["2027-03-16", "2027-03-17"],
  ["2027-04-27", "2027-04-28"],
  ["2027-06-08", "2027-06-09"],
  ["2027-07-27", "2027-07-28"],
  ["2027-09-14", "2027-09-15"],
  ["2027-10-26", "2027-10-27"],
  ["2027-12-07", "2027-12-08"],
];

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTHS_EN: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

function fmtIso(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS_ES[Number(m) - 1]} ${y}`;
}

function parseLooseDate(raw: string): string | null {
  const m = /([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})/.exec(raw);
  if (!m || !MONTHS_EN[m[1]]) return null;
  return `${m[3]}-${String(MONTHS_EN[m[1]]).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`;
}

function nextFed(today: string): Pick<CalendarInfo, "fedLabel" | "fedDetail"> {
  const next = FOMC.find(([, end]) => end >= today) ?? FOMC[FOMC.length - 1];
  const [start, end] = next;
  const label =
    start.slice(0, 7) === end.slice(0, 7)
      ? `${Number(start.slice(8))}–${fmtIso(end)}`
      : `${fmtIso(start)} – ${fmtIso(end)}`;
  return {
    fedLabel: label,
    fedDetail: `Decisión el ${fmtIso(end)} a las 14:00 ET. Calendario oficial del FOMC.`,
  };
}

function getText(url: string, redirects = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "en-US,en;q=0.9" },
        maxHeaderSize: 256 * 1024,
      },
      (res) => {
        const code = res.statusCode ?? 0;
        const location = res.headers.location;
        if (code >= 300 && code < 400 && location && redirects < 3) {
          res.resume();
          getText(new URL(location, url).toString(), redirects + 1).then(resolve, reject);
          return;
        }
        if (code < 200 || code >= 300) {
          res.resume();
          reject(new Error(`Fuente no disponible (${code})`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      },
    );
    req.on("error", reject);
    req.setTimeout(18000, () => req.destroy(new Error("timeout")));
  });
}

async function loadCalendar(ticker: string, snap: Record<string, string>): Promise<CalendarInfo> {
  const today = etDate(Math.floor(Date.now() / 1000));
  const fed = nextFed(today);
  let earningsIso: string | null = null;
  let earningsEstimate = false;
  let exIso: string | null = null;
  try {
    const html = await getText(`https://finance.yahoo.com/quote/${encodeURIComponent(ticker)}/`);
    const earn = html.match(/earningsDate\\":\[\{\\"raw\\":\d+,\\"fmt\\":\\"([0-9-]+)\\"/);
    const est = html.match(/isEarningsDateEstimate\\":(true|false)/);
    const ex = html.match(/exDividendDate\\":\{\\"raw\\":\d+,\\"fmt\\":\\"([0-9-]+)\\"/);
    if (earn) {
      earningsIso = earn[1];
      earningsEstimate = est?.[1] === "true";
    }
    if (ex) exIso = ex[1];
  } catch {
    /* sigue con Finviz */
  }
  if (!exIso && snap["Dividend Ex-Date"]) exIso = parseLooseDate(snap["Dividend Ex-Date"]);
  if (!earningsIso && snap.Earnings) earningsIso = parseLooseDate(snap.Earnings);
  return {
    earnings: earningsIso ? fmtIso(earningsIso) : null,
    earningsEstimate,
    exDividend: exIso ? fmtIso(exIso) : null,
    exDividendUpcoming: exIso != null && exIso >= today,
    ...fed,
  };
}

function quoteTypeLabel(meta: Record<string, unknown>): string | null {
  const t = typeof meta.instrumentType === "string" ? meta.instrumentType : "";
  if (t === "ETF" || t === "MUTUALFUND") return "ETF";
  return null;
}

function fallbackLastSession(chart: ChartResult): Array<{ high: number; low: number; close: number; volume: number }> {
  let last = "";
  for (const ts of chart.timestamps) last = etDate(ts);
  return chart.timestamps.flatMap((ts, i) => {
    if (etDate(ts) !== last) return [];
    const q = chart.quote[i];
    if (q?.high == null || q.low == null || q.close == null || q.volume == null) return [];
    return [{ high: q.high, low: q.low, close: q.close, volume: q.volume }];
  });
}
