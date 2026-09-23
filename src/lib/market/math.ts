/** Indicadores y redondeo del rango. Puro, sin red. */

export type Bar = { date: string; close: number };

export function emaSeries(values: number[], n: number): Array<number | null> {
  const k = 2 / (n + 1);
  const out: Array<number | null> = Array(values.length).fill(null);
  if (values.length < n) return out;
  let prev = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = prev;
  for (let i = n; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function macdSeries(closes: number[]): {
  line: Array<number | null>;
  signal: Array<number | null>;
  hist: Array<number | null>;
} {
  const e12 = emaSeries(closes, 12);
  const e26 = emaSeries(closes, 26);
  const line: Array<number | null> = closes.map((_, i) =>
    e12[i] != null && e26[i] != null ? (e12[i] as number) - (e26[i] as number) : null,
  );
  const start = line.findIndex((v) => v != null);
  const signal: Array<number | null> = Array(closes.length).fill(null);
  const hist: Array<number | null> = Array(closes.length).fill(null);
  if (start < 0) return { line, signal, hist };
  const raw = line.slice(start).map((v) => v as number);
  const sig = emaSeries(raw, 9);
  for (let j = 0; j < raw.length; j++) {
    signal[start + j] = sig[j];
    if (sig[j] != null) hist[start + j] = raw[j] - (sig[j] as number);
  }
  return { line, signal, hist };
}

export function rsiWilder(closes: number[], n = 14): Array<number | null> {
  const out: Array<number | null> = Array(closes.length).fill(null);
  if (closes.length <= n) return out;
  let avgG = 0;
  let avgL = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) avgG += d;
    else avgL -= d;
  }
  avgG /= n;
  avgL /= n;
  const rsi = (g: number, l: number) => (l === 0 ? 100 : 100 - 100 / (1 + g / l));
  out[n] = rsi(avgG, avgL);
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgG = (avgG * (n - 1) + g) / n;
    avgL = (avgL * (n - 1) + l) / n;
    out[i] = rsi(avgG, avgL);
  }
  return out;
}

/** Prima × 100. El menor sube al múltiplo de 5; el mayor baja. Igual que el sitio de rangos. */
export function contractRange(priceA: number, priceB: number): { desde: number; hasta: number } {
  const premiums = [priceA * 100, priceB * 100].sort((a, b) => a - b);
  let desde = Math.ceil(premiums[0] / 5) * 5;
  let hasta = Math.floor(premiums[1] / 5) * 5;
  if (hasta < desde) {
    const round5 = (n: number) => Math.round(n / 5) * 5;
    const pair = [round5(premiums[0]), round5(premiums[1])].sort((a, b) => a - b);
    desde = pair[0];
    hasta = pair[1];
  }
  return { desde, hasta };
}

export function vwapTypical(
  bars: Array<{ high: number; low: number; close: number; volume: number }>,
): number | null {
  let num = 0;
  let den = 0;
  for (const b of bars) {
    if (!b.volume) continue;
    num += ((b.high + b.low + b.close) / 3) * b.volume;
    den += b.volume;
  }
  return den > 0 ? num / den : null;
}

export function recomLabel(value: number | null): string | null {
  if (value == null || Number.isNaN(value)) return null;
  if (value <= 1.5) return "Compra fuerte";
  if (value <= 2.5) return "Compra";
  if (value <= 3.5) return "Mantener";
  if (value <= 4.5) return "Venta";
  return "Venta fuerte";
}

export function rsiZone(value: number | null): string | null {
  if (value == null) return null;
  if (value >= 70) return "Sobrecompra";
  if (value <= 30) return "Sobreventa";
  if (value >= 50) return "Sesgo alcista";
  return "Sesgo bajista";
}

export function sma(values: number[], n: number): Array<number | null> {
  const out: Array<number | null> = Array(values.length).fill(null);
  if (n < 1 || values.length < n) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** Bandas de Bollinger: media n y ±k desviaciones del cierre. */
export function bollinger(
  closes: number[],
  n = 20,
  k = 2,
): { mid: Array<number | null>; upper: Array<number | null>; lower: Array<number | null> } {
  const mid = sma(closes, n);
  const upper: Array<number | null> = Array(closes.length).fill(null);
  const lower: Array<number | null> = Array(closes.length).fill(null);
  for (let i = n - 1; i < closes.length; i++) {
    const mean = mid[i];
    if (mean == null) continue;
    let acc = 0;
    for (let j = i - n + 1; j <= i; j++) {
      const d = closes[j] - mean;
      acc += d * d;
    }
    const sd = Math.sqrt(acc / n);
    upper[i] = mean + k * sd;
    lower[i] = mean - k * sd;
  }
  return { mid, upper, lower };
}

/**
 * Worden Stochastic (TC2000): percentil del cierre dentro de las últimas n
 * observaciones. Rank 0 es el más bajo. (100 / (n - 1)) × Rank.
 * Luego se suaviza con una media simple.
 */
export function wordenStochastic(closes: number[], period = 14, smooth = 3): Array<number | null> {
  const raw: Array<number | null> = Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const current = closes[i];
    let rank = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (closes[j] < current) rank += 1;
    }
    raw[i] = period <= 1 ? 100 : (100 / (period - 1)) * rank;
  }
  if (smooth <= 1) return raw;
  const out: Array<number | null> = Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    let sum = 0;
    let ok = true;
    for (let j = i - smooth + 1; j <= i; j++) {
      if (j < 0 || raw[j] == null) {
        ok = false;
        break;
      }
      sum += raw[j] as number;
    }
    if (ok) out[i] = sum / smooth;
  }
  return out;
}
