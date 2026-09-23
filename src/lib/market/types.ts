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
  note: string;
};
