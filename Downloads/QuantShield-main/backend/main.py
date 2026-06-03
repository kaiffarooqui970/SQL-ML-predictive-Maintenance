"""
QuantShield — FastAPI entry point & router
"""

from __future__ import annotations
import logging
import os
import io
import base64
import requests
import uvicorn
from contextlib import asynccontextmanager

import google.generativeai as genai
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse 
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
from typing import Optional, Dict
from jinja2 import Template
from xhtml2pdf import pisa 

from engine import SimulationResult, run_simulation

# ---------------------------------------------------------------------------
# API Key Setup
# ---------------------------------------------------------------------------
# 1. Log into https://aistudio.google.com/app/apikey -> Copy the AIza... key
# 2. Log into https://elevenlabs.io/app/settings -> Copy your API Key
GEMINI_API_KEY = "PASTE_YOUR_AIza_GEMINI_KEY_HERE"
ELEVENLABS_API_KEY = "PASTE_YOUR_ELEVENLABS_KEY_HERE"

# Configure SDKs
os.environ["GOOGLE_API_KEY"] = GEMINI_API_KEY
genai.configure(api_key=GEMINI_API_KEY)

# ---------------------------------------------------------------------------
# Logging & Lifespan
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)-8s | %(name)s — %(message)s")
logger = logging.getLogger("quantshield")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("QuantShield API starting up…")
    yield
    logger.info("QuantShield API shutting down.")

# ---------------------------------------------------------------------------
# App & Middleware
# ---------------------------------------------------------------------------
app = FastAPI(title="QuantShield Risk API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class SimulationRequest(BaseModel):
    tickers: list[str]; days: int = 252; weights: Optional[Dict[str, float]] = None
    @field_validator("tickers")
    @classmethod
    def normalise_tickers(cls, v):
        return [t.strip().upper() for t in v]

class ReportData(BaseModel):
    firm_name: str; client_name: str; tickers: list[str]; weights: list[float]; expected_return: float; value_at_risk: float; max_drawdown: float

class AdvisorRequest(BaseModel):
    user_message: str; tickers: list[str]; weights: list[float]; expected_return: float; max_drawdown: float

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.post("/api/simulate")
async def simulate(request: SimulationRequest):
    result = run_simulation(tickers=request.tickers, projection_days=request.days, weights=request.weights)
    return {"expected_return": round(result.expected_return, 6), "max_drawdown": round(result.max_drawdown, 6), "sharpe_ratio": round(result.sharpe_ratio, 4), "var_95": round(result.var_95, 2), "var_99": round(result.var_99, 2), "cvar": round(result.cvar, 2)}

@app.post("/api/advisor")
async def get_quant_advice(req: AdvisorRequest):
    try:
        portfolio_context = f"You are the QuantShield AI Advisor. User asks: {req.user_message}. Portfolio: {req.tickers}, Exp Return: {req.expected_return*100:.1f}%, Max Drawdown: {req.max_drawdown*100:.1f}%."
        model = genai.GenerativeModel('gemini-1.5-flash')
        response = model.generate_content(portfolio_context)
        ai_text_reply = response.text.replace('*', '')

        audio_base64 = None
        try:
            tts_response = requests.post(f"https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM", 
                json={"text": ai_text_reply, "model_id": "eleven_monolingual_v1"},
                headers={"xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json"})
            if tts_response.ok: audio_base64 = base64.b64encode(tts_response.content).decode('utf-8')
        except Exception as e: logger.error(f"TTS Failed: {e}")

        return {"text": ai_text_reply, "audio_base64": audio_base64}
    except Exception as e:
        logger.exception("AI Failed")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)