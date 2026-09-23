import { contractRange, macdSeries, recomLabel, rsiWilder, vwapTypical } from "./math";
import type { Analysis, ChartPoint, ContractRow, SideRange } from "./types";

export type { Analysis, ChartPoint, ContractRow, SideRange };

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const MIN_PREMIUM = 0.3;

type QuoteBar = {
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
  const daily = await yahooChart(ticker, "1d", "1y");
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
    note,
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
