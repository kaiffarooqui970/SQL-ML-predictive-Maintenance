import numpy as np
import pandas as pd
from scipy.optimize import minimize

class PortfolioOptimizer:
    def __init__(self, historical_prices: pd.DataFrame, risk_free_rate: float = 0.04):
        self.prices = historical_prices
        self.risk_free_rate = risk_free_rate
        
        # Calculate annualized returns and covariance matrix (252 trading days)
        self.returns = np.log(self.prices / self.prices.shift(1)).dropna()
        self.mean_returns = self.returns.mean() * 252
        self.cov_matrix = self.returns.cov() * 252
        self.tickers = historical_prices.columns.tolist()

    def portfolio_performance(self, weights):
        """Calculates the annualized return and volatility for a given set of weights."""
        returns = np.sum(self.mean_returns * weights)
        std_dev = np.sqrt(np.dot(weights.T, np.dot(self.cov_matrix, weights)))
        return returns, std_dev

    def negative_sharpe(self, weights):
        """We want to MAXIMIZE the Sharpe Ratio, which is the same as MINIMIZING the negative Sharpe Ratio."""
        p_ret, p_std = self.portfolio_performance(weights)
        return - (p_ret - self.risk_free_rate) / p_std

    def optimize_max_sharpe(self) -> dict:
        """Finds the optimal weights that maximize the Sharpe Ratio."""
        num_assets = len(self.mean_returns)
        
        # Constraints: Weights must sum to 1.0 (Fully invested)
        constraints = ({'type': 'eq', 'fun': lambda x: np.sum(x) - 1})
        
        # Bounds: No short selling (Weights must be between 0.0 and 1.0)
        bounds = tuple((0.0, 1.0) for _ in range(num_assets))
        
        # Initial guess: Equal distribution (e.g., 50/50 for 2 assets)
        initial_guess = num_assets * [1. / num_assets,]
        
        # Run the Sequential Least Squares Programming (SLSQP) optimizer
        result = minimize(
            self.negative_sharpe, 
            initial_guess, 
            method='SLSQP', 
            bounds=bounds, 
            constraints=constraints
        )
        
        # Calculate final metrics for the optimal weights
        opt_weights = result.x
        opt_ret, opt_std = self.portfolio_performance(opt_weights)
        opt_sharpe = (opt_ret - self.risk_free_rate) / opt_std
        
        # Format the output cleanly
        weight_distribution = {self.tickers[i]: round(opt_weights[i] * 100, 2) for i in range(num_assets)}
        
        return {
            "Optimal Weights (%)": weight_distribution,
            "Expected Annual Return (%)": round(opt_ret * 100, 2),
            "Expected Volatility (%)": round(opt_std * 100, 2),
            "Maximized Sharpe Ratio": round(opt_sharpe, 4)
        }