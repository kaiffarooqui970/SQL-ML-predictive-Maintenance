"""
QuantShield — FastAPI entry point & router
Handles request validation, calls the simulation engine, and returns results.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
from typing import optional, Dict
from engine import SimulationResult, run_simulation

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s — %(message)s",
)
logger = logging.getLogger("quantshield")


# ---------------------------------------------------------------------------
# Lifespan (startup / shutdown hooks)
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("QuantShield API starting up…")
    yield
    logger.info("QuantShield API shutting down.")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="QuantShield Risk API",
    version="1.0.0",
    description="Monte Carlo portfolio risk simulation engine.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # Tighten to your frontend origin in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
from pydantic import BaseModel, Field, field_validator
from typing import Optional, Dict # Ensure these are imported!

class SimulationRequest(BaseModel):
    """Payload sent by the React frontend."""

    tickers: list[str] = Field(
        ...,
        min_length=1,
        max_length=20,
        description="List of ticker symbols (e.g. ['AAPL', 'MSFT']).",
        examples=[["AAPL", "MSFT", "NVDA"]],
    )
    days: int = Field(
        default=252,
        ge=1,
        le=1260,
        description="Number of forward-projection days (1–1260).",
        examples=[252],
    )
    # --- NEW: Added weights field ---
    weights: Optional[Dict[str, float]] = Field(
        default=None,
        description="Dictionary mapping ticker symbols to custom weight percentages (decimals summing to 1.0).",
        examples=[{"AAPL": 0.6, "MSFT": 0.4}],
    )

    @field_validator("tickers")
    @classmethod
    def normalise_tickers(cls, v: list[str]) -> list[str]:
        cleaned = [t.strip().upper() for t in v]
        if len(cleaned) != len(set(cleaned)):
            raise ValueError("Duplicate tickers are not allowed.")
        return cleaned

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.post(
    "/api/simulate",
    response_model=SimulationResponse,
    tags=["simulation"],
    summary="Run a Monte Carlo portfolio risk simulation.",
)
async def simulate(request: SimulationRequest) -> SimulationResponse:
    """
    Fetches 2 years of daily adjusted-close data for the requested tickers,
    builds a custom-weighted portfolio, runs ≥ 1,000 GBM paths, and returns
    key risk metrics.
    """
    logger.info(
        "Simulation request received — tickers=%s, days=%d, weights=%s",
        request.tickers,
        request.days,
        request.weights, # Added logging so you can see it in the terminal!
    )

    try:
        result: SimulationResult = run_simulation(
            tickers=request.tickers,
            projection_days=request.days,
            weights=request.weights,  # <--- THIS IS THE MAGIC LINE
        )
    except ValueError as exc:
        # Business-logic errors (bad ticker, insufficient history, etc.)
        logger.warning("Simulation failed with ValueError: %s", exc)
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Unexpected error during simulation.")
        raise HTTPException(status_code=500, detail="Internal simulation error.") from exc

    logger.info(
        "Simulation complete — E[r]=%.4f  Sharpe=%.2f  VaR95=$%.2f",
        result.expected_return,
        result.sharpe_ratio,
        result.var_95,
    )

    return SimulationResponse(
        expected_return=round(result.expected_return, 6),
        max_drawdown=round(result.max_drawdown, 6),
        sharpe_ratio=round(result.sharpe_ratio, 4),
        var_95=round(result.var_95, 2),
        var_99=round(result.var_99, 2),
        cvar=round(result.cvar, 2),
    )

# ---------------------------------------------------------------------------
# Dev entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
