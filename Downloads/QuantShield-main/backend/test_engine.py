"""
QuantShield — Engine unit tests
Run with: pytest tests/test_engine.py -v
"""
from __future__ import annotations

import numpy as np
import pytest

from engine import (
    TRADING_DAYS_PER_YEAR,
    SimulationResult,
    build_portfolio_returns,
    calculate_expected_return,
    calculate_max_drawdown,
    calculate_sharpe_ratio,
    calculate_var_cvar,
    run_gbm_simulation,
)
import pandas as pd


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
RNG = np.random.default_rng(42)
N_DAYS = 504  # ~2 years of history


@pytest.fixture()
def synthetic_prices() -> pd.DataFrame:
    """Synthetic price series for two fake tickers."""
    log_r = RNG.normal(0.0004, 0.015, (N_DAYS, 2))
    price_paths = 100 * np.exp(np.cumsum(log_r, axis=0))
    idx = pd.date_range("2022-01-03", periods=N_DAYS, freq="B")
    return pd.DataFrame(price_paths, index=idx, columns=["AAA", "BBB"])


@pytest.fixture()
def portfolio_log_returns(synthetic_prices) -> np.ndarray:
    return build_portfolio_returns(synthetic_prices)


# ---------------------------------------------------------------------------
# build_portfolio_returns
# ---------------------------------------------------------------------------
class TestBuildPortfolioReturns:
    def test_length(self, synthetic_prices, portfolio_log_returns):
        assert len(portfolio_log_returns) == len(synthetic_prices) - 1

    def test_no_nans(self, portfolio_log_returns):
        assert not np.isnan(portfolio_log_returns).any()

    def test_dtype(self, portfolio_log_returns):
        assert portfolio_log_returns.dtype == np.float64


# ---------------------------------------------------------------------------
# run_gbm_simulation
# ---------------------------------------------------------------------------
class TestRunGBMSimulation:
    def test_output_shape(self, portfolio_log_returns):
        paths = run_gbm_simulation(portfolio_log_returns, projection_days=60,
                                   n_simulations=200, rng_seed=0)
        assert paths.shape == (200, 61)   # 61 = 60 days + starting point

    def test_paths_start_at_one(self, portfolio_log_returns):
        paths = run_gbm_simulation(portfolio_log_returns, projection_days=30,
                                   n_simulations=100, rng_seed=1)
        np.testing.assert_allclose(paths[:, 0], 1.0, atol=1e-10)

    def test_paths_positive(self, portfolio_log_returns):
        paths = run_gbm_simulation(portfolio_log_returns, projection_days=252,
                                   n_simulations=500, rng_seed=2)
        assert (paths > 0).all()

    def test_reproducibility(self, portfolio_log_returns):
        p1 = run_gbm_simulation(portfolio_log_returns, 50, 100, rng_seed=99)
        p2 = run_gbm_simulation(portfolio_log_returns, 50, 100, rng_seed=99)
        np.testing.assert_array_equal(p1, p2)


# ---------------------------------------------------------------------------
# calculate_expected_return
# ---------------------------------------------------------------------------
class TestExpectedReturn:
    def test_positive_for_uptrending_series(self):
        log_r = np.full(500, 0.001)   # constant daily gain
        er = calculate_expected_return(log_r)
        assert er > 0

    def test_annualisation_scale(self):
        # If daily simple return is exactly 1 bp, annualised ≈ 252 bp
        daily_simple = 0.0001
        log_r = np.full(500, np.log1p(daily_simple))
        er = calculate_expected_return(log_r)
        expected = daily_simple * TRADING_DAYS_PER_YEAR
        assert abs(er - expected) < 1e-6


# ---------------------------------------------------------------------------
# calculate_sharpe_ratio
# ---------------------------------------------------------------------------
class TestSharpeRatio:
    def test_positive_for_strong_positive_returns(self):
        # Positive-drift series WITH variance so Sharpe is well-defined
        rng = np.random.default_rng(42)
        log_r = rng.normal(loc=0.002, scale=0.01, size=500)   # strong drift, small vol
        sharpe = calculate_sharpe_ratio(log_r)
        assert sharpe > 0

    def test_zero_vol_returns_zero(self):
        # Constant return equal to risk-free → Sharpe should be 0 or edge-case handled
        log_r = np.zeros(500)
        sharpe = calculate_sharpe_ratio(log_r)
        assert sharpe == 0.0


# ---------------------------------------------------------------------------
# calculate_max_drawdown
# ---------------------------------------------------------------------------
class TestMaxDrawdown:
    def test_monotone_increasing_path_has_no_drawdown(self):
        paths = np.tile(np.linspace(1.0, 2.0, 50), (10, 1))
        mdd = calculate_max_drawdown(paths)
        assert abs(mdd) < 1e-10

    def test_drawdown_is_non_positive(self, portfolio_log_returns):
        paths = run_gbm_simulation(portfolio_log_returns, 252, 500, rng_seed=7)
        mdd = calculate_max_drawdown(paths)
        assert mdd <= 0.0

    def test_known_drawdown(self):
        # Single path: rises to 2, drops to 1 → 50 % drawdown
        path = np.array([[1.0, 1.5, 2.0, 1.5, 1.0]])
        mdd = calculate_max_drawdown(path)
        assert abs(mdd - (-0.5)) < 1e-10


# ---------------------------------------------------------------------------
# calculate_var_cvar
# ---------------------------------------------------------------------------
class TestVarCVar:
    def test_all_negative(self, portfolio_log_returns):
        var95, var99, cvar = calculate_var_cvar(portfolio_log_returns)
        # For any realistic return series these should be negative
        # (we also clamp them ≤ 0 in the implementation)
        assert var95 <= 0
        assert var99 <= 0
        assert cvar <= 0

    def test_ordering(self, portfolio_log_returns):
        var95, var99, cvar = calculate_var_cvar(portfolio_log_returns)
        # 99 % VaR is more extreme than 95 % VaR; CVaR ≤ VaR99
        assert var99 <= var95
        assert cvar <= var99

    def test_scales_with_portfolio_value(self, portfolio_log_returns):
        v1, _, _ = calculate_var_cvar(portfolio_log_returns, portfolio_value=10_000)
        v2, _, _ = calculate_var_cvar(portfolio_log_returns, portfolio_value=20_000)
        assert abs(v2 / v1 - 2.0) < 1e-6
