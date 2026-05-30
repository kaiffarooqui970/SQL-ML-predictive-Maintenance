'use client';
import { useState } from 'react';
import './globals.css';

// 1. Import Claude's new component from where we saved it
import { PortfolioSimulator, type SimulationParams } from '../components/PortfolioSimulator';
export default function Dashboard() {
  // 1. State Management
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // 2. The Bridge to your Python FastAPI Backend
  // Notice we now accept `params` from Claude's component
  const handleRunSimulation = async (params: SimulationParams) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('http://localhost:8000/api/simulate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tickers: params.tickers,
          days: params.days,
          // We are sending the custom weights to Python!
          weights: params.weightsNormalised 
        }),
      });
      
      if (!response.ok) {
        throw new Error('Simulation calculation failed.');
      }

      const data = await response.json();
      setResults(data); 
    } catch (err: any) {
      console.error("Failed to fetch from backend:", err);
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen p-8 max-w-7xl mx-auto">
      
      {/* Header Section */}
      <div className="flex justify-between items-end mb-8 border-b border-zinc-800 pb-6">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-white mb-2">QuantShield Engine</h1>
          <p className="text-zinc-400">Institutional Risk Analytics & Portfolio Optimization</p>
        </div>
      </div>

      {/* --- CLAUDE'S PORTFOLIO SIMULATOR COMPONENT --- */}
      {/* This renders the input box and the custom weight sliders */}
      <div className="mb-8">
         <PortfolioSimulator 
            onRunSimulation={handleRunSimulation} 
            isLoading={loading} 
            defaultTickers="AAPL, MSFT, NVDA"
         />
      </div>

      {/* Error State */}
      {error && (
         <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500 rounded-lg text-rose-500 text-sm font-medium">
            Error: {error}
         </div>
      )}

      {/* Top Row: Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        
        {/* Metric Card 1: Expected Return */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-sm hover:border-zinc-700 transition-colors">
          <p className="text-sm font-medium text-zinc-400 mb-1">Expected Annual Return</p>
          <div className="flex items-baseline space-x-2">
            <h2 className="text-3xl font-bold text-white">
              {results && results.expected_return !== undefined ? `${(results.expected_return * 100).toFixed(1)}%` : '12.4%'}
            </h2>
            <span className="text-sm font-medium text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded">+1.2%</span>
          </div>
        </div>

        {/* Metric Card 2: Max Drawdown */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-sm hover:border-zinc-700 transition-colors">
          <p className="text-sm font-medium text-zinc-400 mb-1">Maximum Drawdown</p>
          <div className="flex items-baseline space-x-2">
            <h2 className="text-3xl font-bold text-white">
              {results && results.max_drawdown !== undefined ? `${(results.max_drawdown * 100).toFixed(1)}%` : '-8.2%'}
            </h2>
            <span className="text-sm font-medium text-rose-500 bg-rose-500/10 px-2 py-0.5 rounded">Risk</span>
          </div>
        </div>

        {/* Metric Card 3: Sharpe Ratio */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-sm hover:border-zinc-700 transition-colors">
          <p className="text-sm font-medium text-zinc-400 mb-1">Sharpe Ratio</p>
          <div className="flex items-baseline space-x-2">
            <h2 className="text-3xl font-bold text-white">
              {results && results.sharpe_ratio !== undefined ? results.sharpe_ratio.toFixed(2) : '1.84'}
            </h2>
            <span className="text-sm font-medium text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded">Optimized</span>
          </div>
        </div>
      </div>

      {/* Middle Row: The Chart & VaR */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Main Chart Area */}
        <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-white mb-6">252-Day Monte Carlo Projection</h3>
          
          <div className="h-64 w-full relative pt-4">
            {/* Grid lines */}
            <div className="absolute inset-0 flex flex-col justify-between pointer-events-none opacity-10 z-0">
               <div className="border-t border-white w-full"></div>
               <div className="border-t border-white w-full"></div>
               <div className="border-t border-white w-full"></div>
               <div className="border-t border-white w-full"></div>
               <div className="border-t border-white w-full"></div>
            </div>
            
            {/* Sleek SVG Multi-Line Chart */}
            <svg viewBox="0 0 100 100" className="w-full h-full z-10 relative overflow-visible" preserveAspectRatio="none">
              <polyline points="0,50 10,48 20,45 30,52 40,40 50,35 60,38 70,25 80,30 90,15 100,20" fill="none" stroke="#3b82f6" strokeWidth="1.5" opacity="0.9" />
              <polyline points="0,50 10,45 20,35 30,30 40,20 50,25 60,15 70,10 80,5 90,8 100,2" fill="none" stroke="#10b981" strokeWidth="1" opacity="0.4" />
              <polyline points="0,50 10,55 20,52 30,60 40,65 50,58 60,70 70,75 80,85 90,80 100,95" fill="none" stroke="#ef4444" strokeWidth="1" opacity="0.4" />
              <polyline points="0,50 10,52 20,48 30,45 40,50 50,48 60,55 70,50 80,60 90,55 100,65" fill="none" stroke="#71717a" strokeWidth="1" opacity="0.3" />
            </svg>
          </div>
          <div className="flex justify-between mt-4 text-xs text-zinc-500 font-medium">
            <span>Day 1</span>
            <span>Day 126</span>
            <span>Day 252</span>
          </div>
        </div>

        {/* Value at Risk (VaR) Panel */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-white mb-6">Risk Profile</h3>
          
          <div className="space-y-6">
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-sm font-medium text-zinc-400">95% Confidence (Daily)</span>
                <span className="text-sm font-bold text-rose-500">
                   {results && results.var_95 !== undefined ? `-$${Math.abs(results.var_95).toFixed(2)}` : '-$240.50'}
                </span>
              </div>
              <div className="w-full bg-zinc-800 rounded-full h-1.5">
                <div className="bg-rose-500 h-1.5 rounded-full" style={{ width: '45%' }}></div>
              </div>
            </div>

            <div>
              <div className="flex justify-between mb-2">
                <span className="text-sm font-medium text-zinc-400">99% Confidence (Daily)</span>
                <span className="text-sm font-bold text-rose-500">
                   {results && results.var_99 !== undefined ? `-$${Math.abs(results.var_99).toFixed(2)}` : '-$410.20'}
                </span>
              </div>
              <div className="w-full bg-zinc-800 rounded-full h-1.5">
                <div className="bg-rose-500 h-1.5 rounded-full" style={{ width: '70%' }}></div>
              </div>
            </div>

            <div className="pt-4 border-t border-zinc-800">
               <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-zinc-400">Conditional VaR (CVaR)</span>
                  <span className="text-lg font-bold text-rose-600">
                     {results && results.cvar !== undefined ? `-$${Math.abs(results.cvar).toFixed(2)}` : '-$580.90'}
                  </span>
               </div>
            </div>
          </div>
        </div>

      </div>
    </main>
  );
}