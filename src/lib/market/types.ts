export type ContractRow = {
  strike: number;
  price: number;
  minimo: number;
  maximo: number;
  ratio: number;
};

export type SideRange = {
  desde: number;
  hasta: number;
  detalle: ContractRow[];
};

export type ChartPoint = {
  date: string;
  close: number;
  rsi: number | null;
  macd: number | null;
  signal: number | null;
  hist: number | null;
};

export type IntervalId = "1m" | "5m" | "15m" | "1h" | "1d";

export type RangeId = "1d" | "1w" | "1mo" | "3mo" | "6mo" | "1y" | "ytd";

export type OverlayPoint = {
  t: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ma20: number | null;
  ma40: number | null;
  ma100: number | null;
  ma200: number | null;
  bbMid: number | null;
  bbUpper: number | null;
  bbLower: number | null;
  worden: number | null;
};

export type OverlaySeries = {
  ticker: string;
  interval: IntervalId;
  label: string;
  points: OverlayPoint[];
};

export type CalendarInfo = {
  earnings: string | null;
  earningsEstimate: boolean;
  exDividend: string | null;
  exDividendUpcoming: boolean;
  fedLabel: string;
  fedDetail: string;
};

export type Analysis = {
  ticker: string;
  name: string;
  indices: string | null;
  sector: string | null;
  industry: string | null;
  high52: number | null;
  low52: number | null;
  price: number;
  previousClose: number | null;
  rsi: number | null;
  vwap: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  targetPrice: number | null;
  recom: number | null;
  recomLabel: string | null;
  expiration: string | null;
  calculatedAt: string;
  call: SideRange | null;
  put: SideRange | null;
  chart: ChartPoint[];
  overlay: OverlaySeries;
  calendar: CalendarInfo;
  note: string;
};
