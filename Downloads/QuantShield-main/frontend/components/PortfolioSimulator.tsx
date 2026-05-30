'use client';

/**
 * PortfolioSimulator.tsx
 *
 * DROP-IN COMPONENT — paste this file into your project and render it
 * inside your existing page.tsx. It owns only the input + weight-slider
 * UI; you wire up the actual API call via the `onRunSimulation` prop.
 *
 * Usage in page.tsx:
 * ─────────────────────────────────────────────────────────────────────
 * import { PortfolioSimulator } from '@/components/dashboard/PortfolioSimulator';
 *
 * export default function DashboardPage() {
 *   async function handleRun(params: SimulationParams) {
 *     const res = await fetch('/api/simulate', {
 *       method: 'POST',
 *       body: JSON.stringify({ tickers: params.tickers, days: params.days }),
 *     });
 *     const data = await res.json();
 *     // update your results state here
 *   }
 *   return <PortfolioSimulator onRunSimulation={handleRun} />;
 * }
 * ─────────────────────────────────────────────────────────────────────
 */

import React, {
  useState,
  useEffect,
  useCallback,
  type ChangeEvent,
} from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TickerWeight {
  ticker: string;   // uppercase symbol, e.g. "AAPL"
  weight: number;   // 0–100 scale; all entries should sum to 100
}

export type HorizonDays = 63 | 126 | 252 | 504;

export type BenchmarkOption = 'SPY' | 'QQQ' | 'DIA' | 'none';

export interface SimulationParams {
  /** Ordered list of tickers with their custom weights */
  tickerWeights: TickerWeight[];
  /** Number of forward-projection trading days */
  days: HorizonDays;
  /** Benchmark to compare against, or 'none' */
  benchmark: BenchmarkOption;
  /**
   * Convenience flat list for the FastAPI payload:
   *   POST /api/simulate { tickers, days }
   */
  tickers: string[];
  /**
   * Normalised weights map (fractions summing to 1.0) ready for the
   * backend `weights` field:
   *   { AAPL: 0.333, MSFT: 0.333, NVDA: 0.334 }
   */
  weightsNormalised: Record<string, number>;
}

export interface PortfolioSimulatorProps {
  /**
   * Called when the user clicks "Run Simulation".
   * All data needed for the API call is bundled in `params`.
   */
  onRunSimulation: (params: SimulationParams) => void | Promise<void>;

  /** Show spinner / disabled state on the Run button while loading. */
  isLoading?: boolean;

  /**
   * Callback fired on every weight or ticker change so the parent can
   * keep its own state in sync if needed. Optional.
   */
  onChange?: (tickerWeights: TickerWeight[]) => void;

  /** Override the default initial tickers. */
  defaultTickers?: string;

  /** Override the default horizon. */
  defaultDays?: HorizonDays;

  /** Override the default benchmark. */
  defaultBenchmark?: BenchmarkOption;

  /** Handler for the "Export Report" button. Optional — hides button if absent. */
  onExport?: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseTickers(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);
}

function buildEqualWeights(tickers: string[]): TickerWeight[] {
  if (!tickers.length) return [];
  const eq = parseFloat((100 / tickers.length).toFixed(1));
  // Adjust last ticker to ensure the sum is exactly 100
  return tickers.map((ticker, i) => ({
    ticker,
    weight: i === tickers.length - 1
      ? parseFloat((100 - eq * (tickers.length - 1)).toFixed(1))
      : eq,
  }));
}

function totalWeight(tw: TickerWeight[]): number {
  return tw.reduce((sum, { weight }) => sum + weight, 0);
}

function normaliseWeights(tw: TickerWeight[]): Record<string, number> {
  const total = totalWeight(tw) || 100;
  return Object.fromEntries(tw.map(({ ticker, weight }) => [ticker, weight / total]));
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface SliderRowProps {
  ticker: string;
  weight: number;
  onChange: (ticker: string, value: number) => void;
}

function SliderRow({ ticker, weight, onChange }: SliderRowProps) {
  return (
    <div className="weight-row flex items-center gap-[10px] px-[12px] py-[10px] bg-[var(--deep)] rounded-[8px] mb-[6px] border border-[var(--rim)]">
      {/* Ticker chip */}
      <span className="w-chip text-[11px] font-mono font-semibold bg-[rgba(30,239,184,.1)] text-[var(--pulse)] border border-[rgba(30,239,184,.2)] rounded-[5px] px-[9px] py-[3px] min-w-[56px] text-center flex-shrink-0">
        {ticker}
      </span>

      {/* Range slider */}
      <input
        type="range"
        className="w-slider flex-1 appearance-none h-[4px] rounded-[2px] bg-[var(--edge)] outline-none cursor-pointer"
        min={0}
        max={100}
        step={0.5}
        value={weight}
        onChange={(e: ChangeEvent<HTMLInputElement>) =>
          onChange(ticker, parseFloat(e.target.value))
        }
        aria-label={`${ticker} weight`}
        style={{
          // Custom thumb — can't do pseudo-element in Tailwind inline, so we keep
          // the .w-slider CSS class from the prototype for ::-webkit-slider-thumb
        }}
      />

      {/* Weight display */}
      <span
        className="w-val text-[12px] font-mono font-semibold min-w-[38px] text-right text-[var(--sky)]"
        aria-live="polite"
      >
        {weight.toFixed(1)}%
      </span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function PortfolioSimulator({
  onRunSimulation,
  isLoading = false,
  onChange,
  defaultTickers = 'AAPL, MSFT, NVDA',
  defaultDays = 252,
  defaultBenchmark = 'SPY',
  onExport,
}: PortfolioSimulatorProps) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [tickerInput, setTickerInput] = useState<string>(defaultTickers);
  const [tickerWeights, setTickerWeights] = useState<TickerWeight[]>(() =>
    buildEqualWeights(parseTickers(defaultTickers))
  );
  const [days, setDays] = useState<HorizonDays>(defaultDays);
  const [benchmark, setBenchmark] = useState<BenchmarkOption>(defaultBenchmark);

  // ── Derived ────────────────────────────────────────────────────────────────
  const total = totalWeight(tickerWeights);
  const isBalanced = Math.abs(total - 100) < 1;

  // ── Sync sliders when ticker input changes ─────────────────────────────────
  useEffect(() => {
    const newTickers = parseTickers(tickerInput);

    setTickerWeights((prev) => {
      // Keep existing weights for tickers that haven't changed
      const existingMap = Object.fromEntries(prev.map((tw) => [tw.ticker, tw.weight]));
      const newWeights = newTickers.map((ticker) => ({
        ticker,
        weight: existingMap[ticker] ?? parseFloat((100 / newTickers.length).toFixed(1)),
      }));
      onChange?.(newWeights);
      return newWeights;
    });
  }, [tickerInput]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ───────────────────────────────────────────────────────────────

  /** Update a single ticker's weight */
  const handleWeightChange = useCallback(
    (ticker: string, value: number) => {
      setTickerWeights((prev) => {
        const updated = prev.map((tw) =>
          tw.ticker === ticker ? { ...tw, weight: value } : tw
        );
        onChange?.(updated);
        return updated;
      });
    },
    [onChange]
  );

  /** Reset all weights to equal distribution */
  const handleEqualize = useCallback(() => {
    const tickers = parseTickers(tickerInput);
    const equalised = buildEqualWeights(tickers);
    setTickerWeights(equalised);
    onChange?.(equalised);
  }, [tickerInput, onChange]);

  /** Bundle all params and call the parent handler */
  const handleRun = useCallback(async () => {
    const tickers = parseTickers(tickerInput);
    if (!tickers.length) return;

    const params: SimulationParams = {
      tickerWeights,
      days,
      benchmark,
      tickers,
      weightsNormalised: normaliseWeights(tickerWeights),
    };

    await onRunSimulation(params);
  }, [tickerInput, tickerWeights, days, benchmark, onRunSimulation]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <section aria-label="Portfolio Simulator">

      {/* ── Page header ── */}
      <div className="pg-header flex items-start justify-between mb-6">
        <div>
          <h1 className="pg-title font-[var(--font-head)] text-[24px] font-extrabold tracking-[-0.5px] leading-tight">
            Portfolio Simulator
          </h1>
          <p className="pg-sub text-[11px] font-mono text-[var(--fog)] mt-1 tracking-[0.3px]">
            Monte Carlo · GBM · 1,000 paths · Equal or custom weights
          </p>
        </div>

        {onExport && (
          <button
            type="button"
            onClick={onExport}
            className="btn btn-outline flex items-center gap-[6px] px-[18px] py-[9px] rounded-[8px] text-[12px] font-bold border border-[var(--edge)] text-[var(--fog)] bg-transparent hover:border-[var(--pulse)] hover:text-[var(--pulse)] transition-all"
          >
            <svg
              viewBox="0 0 24 24"
              width={14}
              height={14}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
            >
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            Export Report
          </button>
        )}
      </div>

      {/* ── Simulation controls ── */}
      {/*
        sim-controls is defined in the prototype CSS as:
        grid-template-columns: 1fr 120px 120px auto
        We replicate this with inline style to avoid Tailwind's
        arbitrary-value JIT compiling issues for custom grid tracks.
      */}
      <div
        className="sim-controls mb-4"
        style={{ display: 'grid', gridTemplateColumns: '1fr 120px 120px auto', gap: 10, alignItems: 'end' }}
      >
        {/* Ticker input */}
        <div>
          <label
            htmlFor="ticker-input"
            className="field-lbl block text-[9px] tracking-[1.5px] uppercase text-[var(--mist)] font-mono mb-[5px] font-medium"
          >
            Portfolio tickers (comma-separated)
          </label>
          <input
            id="ticker-input"
            type="text"
            className="field-inp w-full bg-[var(--deep)] border border-[var(--edge)] rounded-[8px] px-[12px] py-[9px] text-[13px] text-[var(--sky)] font-mono outline-none transition-colors focus:border-[var(--pulse)] placeholder:text-[var(--mist)]"
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value)}
            placeholder="AAPL, MSFT, NVDA, TSLA"
            aria-label="Portfolio tickers"
          />
        </div>

        {/* Horizon select */}
        <div>
          <label
            htmlFor="horizon-select"
            className="field-lbl block text-[9px] tracking-[1.5px] uppercase text-[var(--mist)] font-mono mb-[5px] font-medium"
          >
            Horizon
          </label>
          <select
            id="horizon-select"
            className="field-inp w-full bg-[var(--deep)] border border-[var(--edge)] rounded-[8px] px-[12px] py-[9px] text-[13px] text-[var(--sky)] font-mono outline-none appearance-none cursor-pointer focus:border-[var(--pulse)]"
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value) as HorizonDays)}
          >
            <option value={63}>63d (Q)</option>
            <option value={126}>126d (H)</option>
            <option value={252}>252d (1Y)</option>
            <option value={504}>504d (2Y)</option>
          </select>
        </div>

        {/* Benchmark select */}
        <div>
          <label
            htmlFor="benchmark-select"
            className="field-lbl block text-[9px] tracking-[1.5px] uppercase text-[var(--mist)] font-mono mb-[5px] font-medium"
          >
            Benchmark
          </label>
          <select
            id="benchmark-select"
            className="field-inp w-full bg-[var(--deep)] border border-[var(--edge)] rounded-[8px] px-[12px] py-[9px] text-[13px] text-[var(--sky)] font-mono outline-none appearance-none cursor-pointer focus:border-[var(--pulse)]"
            value={benchmark}
            onChange={(e) => setBenchmark(e.target.value as BenchmarkOption)}
          >
            <option value="SPY">vs SPY</option>
            <option value="QQQ">vs QQQ</option>
            <option value="DIA">vs DIA</option>
            <option value="none">None</option>
          </select>
        </div>

        {/* Run button */}
        <button
          type="button"
          onClick={handleRun}
          disabled={isLoading || !tickerWeights.length}
          className="btn btn-pulse flex items-center gap-[6px] px-[18px] py-[9px] rounded-[8px] text-[12px] font-bold bg-[var(--pulse)] text-[var(--void)] hover:brightness-110 hover:-translate-y-px transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          style={{ marginTop: 16 }}
        >
          {isLoading ? (
            <>
              {/* Inline spinner — no extra dependency */}
              <svg
                className="animate-spin"
                width={14}
                height={14}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
              >
                <path d="M21 12a9 9 0 11-6.219-8.56" />
              </svg>
              Running…
            </>
          ) : (
            <>
              <svg
                viewBox="0 0 24 24"
                width={14}
                height={14}
                fill="currentColor"
              >
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Run Simulation
            </>
          )}
        </button>
      </div>

      {/* ── Custom portfolio weights card ── */}
      <div className="card bg-[var(--ink)] border border-[var(--rim)] rounded-[12px] p-[20px] mb-[14px]">
        {/* Card header */}
        <div className="card-head flex items-center justify-between text-[10px] font-mono tracking-[1.5px] uppercase text-[var(--mist)] mb-[14px]">
          <span>Custom portfolio weights</span>
          <button
            type="button"
            onClick={handleEqualize}
            className="btn btn-ghost btn-sm flex items-center gap-1 px-[12px] py-[5px] rounded-[8px] text-[11px] font-bold bg-[var(--layer)] text-[var(--fog)] border border-[var(--rim)] hover:text-[var(--sky)] transition-all"
          >
            Equalize
          </button>
        </div>

        {/* Slider rows — one per ticker */}
        <div role="group" aria-label="Portfolio weight sliders">
          {tickerWeights.length === 0 ? (
            <p className="text-[12px] font-mono text-[var(--mist)] text-center py-4">
              Enter at least one ticker above
            </p>
          ) : (
            tickerWeights.map(({ ticker, weight }) => (
              <SliderRow
                key={ticker}
                ticker={ticker}
                weight={weight}
                onChange={handleWeightChange}
              />
            ))
          )}
        </div>

        {/* Total allocation indicator */}
        <div
          role="status"
          aria-live="polite"
          className={[
            'w-total flex items-center gap-[6px] px-[12px] py-[7px] rounded-[7px] text-[11px] font-mono mt-[8px]',
            isBalanced
              ? 'bg-[rgba(30,239,184,.08)] text-[var(--pulse)] border border-[rgba(30,239,184,.15)]'
              : 'bg-[var(--danger-dim)] text-[var(--danger)] border border-[rgba(255,69,96,.2)]',
          ].join(' ')}
        >
          {isBalanced ? (
            <svg
              width={12}
              height={12}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg
              width={12}
              height={12}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
            >
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          )}
          Allocation:{' '}
          <strong>
            {total.toFixed(1)}%
            {!isBalanced && ' — must total 100%'}
          </strong>
        </div>
      </div>

    </section>
  );
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW TO WIRE THIS INTO YOUR page.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1.  Import the component and its types:
 *
 *       import {
 *         PortfolioSimulator,
 *         type SimulationParams,
 *       } from '@/components/dashboard/PortfolioSimulator';
 *
 * 2.  Add a results state in your page:
 *
 *       const [results, setResults] = useState<SimulateResponse | null>(null);
 *       const [loading, setLoading]  = useState(false);
 *
 * 3.  Define the run handler (this is where YOUR API call lives):
 *
 *       async function handleRun(params: SimulationParams) {
 *         setLoading(true);
 *         try {
 *           const res = await fetch('/api/simulate', {
 *             method: 'POST',
 *             headers: { 'Content-Type': 'application/json' },
 *             body: JSON.stringify({
 *               tickers: params.tickers,
 *               days:    params.days,
 *               weights: params.weightsNormalised,  // optional — backend must support
 *             }),
 *           });
 *           setResults(await res.json());
 *         } finally {
 *           setLoading(false);
 *         }
 *       }
 *
 * 4.  Render the component:
 *
 *       <PortfolioSimulator
 *         onRunSimulation={handleRun}
 *         isLoading={loading}
 *         onChange={(tw) => console.log('live weights:', tw)}
 *         onExport={() => generatePDFReport(...)}
 *       />
 *
 * 5.  Read results below the component using `results` state.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CSS VARIABLES REQUIRED (add to globals.css or layout.css)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   :root {
 *     --void:      #030508;
 *     --ink:       #08101C;
 *     --deep:      #0C1828;
 *     --layer:     #101F30;
 *     --rim:       #1A3050;
 *     --edge:      #233B5A;
 *     --sky:       #E8F4FF;
 *     --fog:       #7BA8CC;
 *     --mist:      #3D6080;
 *     --pulse:     #1EEFB8;
 *     --pulse-dim: #0A3D2E;
 *     --pulse-glow:#1EEFB820;
 *     --danger:    #FF4560;
 *     --danger-dim:#3D0F18;
 *     --void:      #030508;  (repeated for --void reference in slider thumb)
 *     --font-head: 'Cabinet Grotesk', sans-serif;
 *     --font-mono: 'JetBrains Mono', monospace;
 *   }
 *
 *   Add this to globals.css for the custom range thumb (can't be done inline):
 *
 *   .w-slider::-webkit-slider-thumb {
 *     -webkit-appearance: none;
 *     width: 14px;
 *     height: 14px;
 *     border-radius: 50%;
 *     background: var(--pulse);
 *     cursor: pointer;
 *     border: 2px solid var(--void);
 *     box-shadow: 0 0 8px var(--pulse-glow);
 *   }
 *   .w-slider::-moz-range-thumb {
 *     width: 14px;
 *     height: 14px;
 *     border-radius: 50%;
 *     background: var(--pulse);
 *     cursor: pointer;
 *     border: 2px solid var(--void);
 *     box-shadow: 0 0 8px var(--pulse-glow);
 *   }
 * ─────────────────────────────────────────────────────────────────────────────
 */
