"""
QuantShield — Simulation Engine  (yfinance 1.x compatible)
Pure numerical logic; zero FastAPI / HTTP dependencies.

Fixes vs original:
  - Handles yfinance 1.x column schema (multi_level_index=False)
  - Pre-fetches Yahoo crumb/cookie session to cure YFTzMissingError
  - Falls back to direct Yahoo v8 chart API if yfinance session fails
  - Suppresses noisy yfinance stderr with a log-level guard

Public API
----------
    run_simulation(tickers, projection_days, ...) -> SimulationResult
"""

from __future__ import annotations

import logging
import warnings
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

import numpy as np
import pandas as pd
import requests
import yfinance as yf

logger = logging.getLogger("quantshield.engine")

# ---------------------------------------------------------------------------
# Silence yfinance's own noisy logging (it logs at ERROR for 4xx responses
# that we handle ourselves).  Only pass WARNING+ from yfinance upward.
# ---------------------------------------------------------------------------
logging.getLogger("yfinance").setLevel(logging.CRITICAL)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
LOOKBACK_YEARS: int = 2
N_SIMULATIONS: int = 1_000
PORTFOLIO_VALUE: float = 10_000.0
RISK_FREE_RATE: float = 0.04
TRADING_DAYS_PER_YEAR: int = 252
MIN_HISTORY_DAYS: int = TRADING_DAYS_PER_YEAR  # at least 1 year

# Yahoo Finance direct API endpoints (fallback path)
_YF_CRUMB_URL = "https://query1.finance.yahoo.com/v1/test/getcrumb"
_YF_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
_YF_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/133.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class SimulationResult:
    expected_return: float
    max_drawdown: float
    sharpe_ratio: float
    var_95: float
    var_99: float
    cvar: float


# ---------------------------------------------------------------------------
# Step 1 — Data acquisition (yfinance 1.x + direct HTTP fallback)
# ---------------------------------------------------------------------------

def _yf_session_with_crumb() -> requests.Session:
    """
    Build a requests.Session with a valid Yahoo crumb cookie.
    This is the fix for YFTzMissingError — the cookie primes the timezone
    metadata that yfinance 1.x requires from Yahoo's backend.
    """
    session = requests.Session()
    session.headers.update(_YF_HEADERS)
    try:
        # Hit the consent page to set the required cookie
        session.get("https://fc.yahoo.com", timeout=5)
        crumb_resp = session.get(_YF_CRUMB_URL, timeout=5)
        crumb_resp.raise_for_status()
        crumb = crumb_resp.text.strip()
        if crumb:
            session.params = {"crumb": crumb}  # type: ignore[assignment]
            logger.debug("Yahoo crumb acquired: %s…", crumb[:8])
    except Exception as exc:
        logger.warning("Could not obtain Yahoo crumb (will try without): %s", exc)
    return session


def _download_via_yfinance(
    tickers: list[str],
    start: str,
    end: str,
    session: Optional[requests.Session] = None,
) -> pd.DataFrame:
    """
    Primary path: use yfinance.download() with the crumb session.
    Returns a DataFrame with tickers as columns and dates as index,
    normalised to a flat column schema regardless of yfinance version.
    """
    kwargs: dict = dict(
        tickers=tickers,
        start=start,
        end=end,
        auto_adjust=True,
        progress=False,
        threads=True,
    )
    if session is not None:
        kwargs["session"] = session

    # yfinance ≥ 1.0 supports multi_level_index to flatten the column MI
    try:
        raw = yf.download(multi_level_index=False, **kwargs)
    except TypeError:
        # Older yfinance — doesn't have multi_level_index param
        raw = yf.download(**kwargs)

    # --- Normalise column structure ---
    # yfinance 1.x with multi_level_index=False: columns are plain field names
    #   e.g. ['Close', 'High', 'Low', 'Open', 'Volume'] for single ticker
    # yfinance 1.x with multi_level_index=True (default fallback):
    #   MultiIndex (field, ticker)
    # yfinance 0.2.x: MultiIndex (field, ticker) for multi, plain for single

    if isinstance(raw.columns, pd.MultiIndex):
        # Try 'Close' first (auto_adjust=True renames Adj Close → Close in v1.x)
        if "Close" in raw.columns.get_level_values(0):
            prices = raw["Close"].copy()
        elif "Adj Close" in raw.columns.get_level_values(0):
            prices = raw["Adj Close"].copy()
        else:
            raise ValueError(
                "yfinance returned unexpected column schema. "
                f"Top-level fields: {raw.columns.get_level_values(0).unique().tolist()}"
            )
        # If single ticker was requested, column is the ticker name already
        if len(tickers) == 1 and tickers[0] not in prices.columns:
            prices.columns = tickers
    else:
        # Flat columns — single-ticker scenario with multi_level_index=False
        if "Close" in raw.columns:
            prices = raw[["Close"]].copy()
        elif "Adj Close" in raw.columns:
            prices = raw[["Adj Close"]].copy()
        else:
            raise ValueError(
                "yfinance returned unexpected flat column schema: "
                f"{raw.columns.tolist()}"
            )
        prices.columns = tickers

    prices = prices.dropna(how="all")
    return prices


def _download_via_direct_api(
    tickers: list[str],
    start: str,
    end: str,
    session: requests.Session,
) -> pd.DataFrame:
    """
    Fallback path: query Yahoo Finance v8 chart API directly.
    Used when yfinance's session fails entirely (YFTzMissingError, 403, etc.).
    """
    start_ts = int(datetime.strptime(start, "%Y-%m-%d").timestamp())
    end_ts = int(datetime.strptime(end, "%Y-%m-%d").timestamp())

    frames: dict[str, pd.Series] = {}
    for ticker in tickers:
        url = _YF_CHART_URL.format(ticker=ticker)
        params = {
            "interval": "1d",
            "period1": start_ts,
            "period2": end_ts,
            "events": "history",
            "includeAdjustedClose": "true",
        }
        resp = session.get(url, params=params, timeout=15)

        if resp.status_code == 403:
            raise ValueError(
                f"Yahoo Finance blocked the request for '{ticker}' (HTTP 403). "
                "This usually means the API rate limit was hit or the container's "
                "egress IP is blocked. Please check your Docker network / proxy settings "
                "and ensure query1.finance.yahoo.com is reachable."
            )
        resp.raise_for_status()

        data = resp.json()
        result = data.get("chart", {}).get("result")
        if not result:
            err = data.get("chart", {}).get("error", {})
            raise ValueError(
                f"Yahoo Finance returned no data for '{ticker}'. "
                f"API error: {err.get('description', 'unknown')}. "
                "Verify the ticker symbol is correct and active."
            )

        chart = result[0]
        timestamps = chart.get("timestamp", [])
        adj_close = (
            chart.get("indicators", {})
            .get("adjclose", [{}])[0]
            .get("adjclose", [])
        )

        if not timestamps or not adj_close:
            raise ValueError(
                f"Ticker '{ticker}' returned empty price series from Yahoo Finance. "
                "It may be delisted or have insufficient history."
            )

        dates = pd.to_datetime(timestamps, unit="s", utc=True).normalize().tz_localize(None)
        series = pd.Series(adj_close, index=dates, name=ticker, dtype=float)
        frames[ticker] = series

    prices = pd.DataFrame(frames).sort_index().dropna(how="all")
    return prices


def fetch_adjusted_close(
    tickers: list[str],
    lookback_years: int = LOOKBACK_YEARS,
) -> pd.DataFrame:
    """
    Download adjusted-close prices for the past `lookback_years` years.

    Strategy:
      1. Build a crumb-authenticated session (fixes YFTzMissingError)
      2. Try yfinance.download() with that session
      3. If yfinance fails, fall back to direct Yahoo v8 chart API
      4. Validate coverage and raise clear ValueError on bad tickers

    Returns a DataFrame: index=Date, columns=tickers.
    """
    end_dt = datetime.today()
    start_dt = end_dt - timedelta(days=lookback_years * 365 + 30)
    start_str = start_dt.strftime("%Y-%m-%d")
    end_str = end_dt.strftime("%Y-%m-%d")

    logger.info(
        "Fetching price data — tickers=%s, from=%s to=%s",
        tickers, start_str, end_str,
    )

    session = _yf_session_with_crumb()
    prices: Optional[pd.DataFrame] = None
    last_exc: Optional[Exception] = None

    # --- Attempt 1: yfinance with crumb session ---
    try:
        prices = _download_via_yfinance(tickers, start_str, end_str, session=session)
        if prices.empty or all(prices[t].dropna().empty for t in tickers if t in prices.columns):
            raise ValueError("yfinance returned empty DataFrame — will try direct API.")
        logger.info("yfinance download succeeded — shape=%s", prices.shape)
    except Exception as exc:
        last_exc = exc
        logger.warning("yfinance primary fetch failed (%s): %s", type(exc).__name__, exc)

    # --- Attempt 2: yfinance without session (no crumb) ---
    if prices is None or prices.empty:
        try:
            prices = _download_via_yfinance(tickers, start_str, end_str, session=None)
            if prices.empty:
                raise ValueError("yfinance (no-session) returned empty DataFrame.")
            logger.info("yfinance (no-session) fallback succeeded — shape=%s", prices.shape)
        except Exception as exc:
            last_exc = exc
            logger.warning("yfinance no-session fetch failed (%s): %s", type(exc).__name__, exc)

    # --- Attempt 3: direct Yahoo v8 chart API ---
    if prices is None or prices.empty:
        logger.info("Trying direct Yahoo Finance v8 chart API…")
        try:
            prices = _download_via_direct_api(tickers, start_str, end_str, session)
            logger.info("Direct API fetch succeeded — shape=%s", prices.shape)
        except ValueError:
            raise  # re-raise business-logic errors verbatim (bad ticker, 403, etc.)
        except Exception as exc:
            raise ValueError(
                f"All data sources failed for tickers {tickers}. "
                f"Last error: {exc}. "
                "Please verify: (1) tickers are valid NYSE/NASDAQ symbols, "
                "(2) your network allows outbound HTTPS to query1.finance.yahoo.com, "
                "(3) finance.yahoo.com, query1.finance.yahoo.com are in your Docker "
                "egress allowlist."
            ) from exc

    # --- Validate per-ticker coverage ---
    for ticker in tickers:
        if ticker not in prices.columns:
            raise ValueError(
                f"Ticker '{ticker}' was not found in the downloaded data. "
                "Please verify the symbol (e.g. 'AAPL', not 'Apple')."
            )
        available = prices[ticker].dropna()
        if len(available) < MIN_HISTORY_DAYS:
            raise ValueError(
                f"Ticker '{ticker}' has only {len(available)} trading days of history "
                f"(minimum required: {MIN_HISTORY_DAYS}). "
                "Use a ticker with at least 1 year of market history, "
                "or reduce the lookback window."
            )

    logger.info("Price data validated — shape=%s", prices.shape)
    return prices


# ---------------------------------------------------------------------------
# Step 2 — Portfolio returns
# ---------------------------------------------------------------------------
def build_portfolio_returns(prices: pd.DataFrame) -> np.ndarray:
    """
    Compute daily equal-weight portfolio log-returns.
    Returns np.ndarray of shape (T-1,).
    """
    n_assets = len(prices.columns)
    weights = np.full(n_assets, 1.0 / n_assets)

    simple_returns = prices.pct_change().dropna()
    portfolio_simple = simple_returns.values @ weights
    log_returns = np.log1p(portfolio_simple)

    logger.info(
        "Portfolio returns — n=%d, µ_daily=%.6f, σ_daily=%.6f",
        len(log_returns),
        float(np.mean(log_returns)),
        float(np.std(log_returns, ddof=1)),
    )
    return log_returns


# ---------------------------------------------------------------------------
# Step 3 — GBM Monte Carlo simulation
# ---------------------------------------------------------------------------
def run_gbm_simulation(
    log_returns: np.ndarray,
    projection_days: int,
    n_simulations: int = N_SIMULATIONS,
    rng_seed: Optional[int] = None,
) -> np.ndarray:
    """
    Simulate `n_simulations` portfolio-value paths via Geometric Brownian
    Motion parameterised from historical log-returns.

    Returns np.ndarray of shape (n_simulations, projection_days + 1).
    Each row is one path starting at 1.0.
    """
    rng = np.random.default_rng(rng_seed)
    mu = float(np.mean(log_returns))
    sigma = float(np.std(log_returns, ddof=1))

    dt = 1.0
    drift = (mu - 0.5 * sigma ** 2) * dt
    diffusion = sigma * np.sqrt(dt)

    Z = rng.standard_normal((n_simulations, projection_days))
    daily_log_returns = drift + diffusion * Z

    log_paths = np.hstack([
        np.zeros((n_simulations, 1)),
        np.cumsum(daily_log_returns, axis=1),
    ])
    paths = np.exp(log_paths)

    logger.info(
        "GBM simulation — paths=%d, days=%d, µ=%.6f, σ=%.6f",
        n_simulations, projection_days, mu, sigma,
    )
    return paths


# ---------------------------------------------------------------------------
# Step 4 — Risk metrics
# ---------------------------------------------------------------------------
def calculate_expected_return(log_returns: np.ndarray) -> float:
    simple_returns = np.expm1(log_returns)
    return float(np.mean(simple_returns) * TRADING_DAYS_PER_YEAR)


def calculate_sharpe_ratio(log_returns: np.ndarray) -> float:
    simple_returns = np.expm1(log_returns)
    mean_daily = float(np.mean(simple_returns))
    std_daily = float(np.std(simple_returns, ddof=1))
    if std_daily < 1e-12:
        return 0.0
    annualised_return = mean_daily * TRADING_DAYS_PER_YEAR
    annualised_vol = std_daily * np.sqrt(TRADING_DAYS_PER_YEAR)
    return float((annualised_return - RISK_FREE_RATE) / annualised_vol)


def calculate_max_drawdown(paths: np.ndarray) -> float:
    running_max = np.maximum.accumulate(paths, axis=1)
    drawdowns = (paths - running_max) / running_max
    return float(np.min(drawdowns))


def calculate_var_cvar(
    log_returns: np.ndarray,
    portfolio_value: float = PORTFOLIO_VALUE,
) -> tuple[float, float, float]:
    simple_returns = np.expm1(log_returns)
    daily_pnl = simple_returns * portfolio_value

    var_95 = min(float(np.percentile(daily_pnl, 5)), 0.0)
    var_99 = min(float(np.percentile(daily_pnl, 1)), 0.0)

    tail_losses = daily_pnl[daily_pnl <= var_99]
    cvar = min(float(np.mean(tail_losses)) if len(tail_losses) > 0 else var_99, 0.0)

    return var_95, var_99, cvar


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------
def run_simulation(
    tickers: list[str],
    projection_days: int = TRADING_DAYS_PER_YEAR,
    n_simulations: int = N_SIMULATIONS,
    portfolio_value: float = PORTFOLIO_VALUE,
    rng_seed: Optional[int] = None,
    weights: dict = None,  # <--- NEW: Accept the weights from main.py
) -> SimulationResult:
    """
    Full pipeline: fetch → returns (with custom weights) → GBM → risk metrics.
    """
    prices = fetch_adjusted_close(tickers)
    
    # <--- NEW: Pass the weights into the math calculator
    log_returns = build_portfolio_returns(prices, weights_dict=weights) 
    
    paths = run_gbm_simulation(
        log_returns=log_returns,
        projection_days=projection_days,
        n_simulations=n_simulations,
        rng_seed=rng_seed,
    )
    expected_return = calculate_expected_return(log_returns)
    sharpe_ratio = calculate_sharpe_ratio(log_returns)
    max_drawdown = calculate_max_drawdown(paths)
    var_95, var_99, cvar = calculate_var_cvar(log_returns, portfolio_value)

    return SimulationResult(
        expected_return=expected_return,
        max_drawdown=max_drawdown,
        sharpe_ratio=sharpe_ratio,
        var_95=var_95,
        var_99=var_99,
        cvar=cvar,
    )