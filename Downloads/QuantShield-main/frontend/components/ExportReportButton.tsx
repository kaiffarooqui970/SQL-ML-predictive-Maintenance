import React, { useState } from 'react';

export default function ExportReportButton({ simulationResults, currentPortfolio }: { simulationResults: any, currentPortfolio: any }) {
  const [firmName, setFirmName] = useState('QuantShield Capital Management');
  const [clientName, setClientName] = useState('Founders Bootcamp Judge');
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownloadPDF = async () => {
    setIsDownloading(true);
    try {
      const response = await fetch('http://localhost:8000/api/report/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          firm_name: firmName,
          client_name: clientName,
          tickers: currentPortfolio.tickers, 
          weights: currentPortfolio.weights, 
          expected_return: simulationResults.expected_return, 
          value_at_risk: simulationResults.var_95, 
          max_drawdown: simulationResults.max_drawdown,
        }),
      });

      if (!response.ok) throw new Error('Failed to generate report');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${clientName.replace(/\s+/g, '_')}_Risk_Report.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (error) {
      console.error("Error downloading PDF report:", error);
      alert("Failed to generate PDF. Check terminal logs.");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="p-5 bg-zinc-900 border border-zinc-800 rounded-lg text-white mt-6 w-full md:w-1/2 lg:w-1/3">
      <h3 className="text-lg font-bold mb-4 text-emerald-400">Generate Fiduciary PDF</h3>
      
      <div className="flex flex-col gap-4 mb-4">
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Your Firm Name</label>
          <input 
            type="text" 
            className="w-full bg-zinc-800 p-2 rounded border border-zinc-700 text-sm focus:outline-none focus:border-emerald-400"
            value={firmName} 
            onChange={(e) => setFirmName(e.target.value)} 
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Client Name</label>
          <input 
            type="text" 
            className="w-full bg-zinc-800 p-2 rounded border border-zinc-700 text-sm focus:outline-none focus:border-emerald-400"
            value={clientName} 
            onChange={(e) => setClientName(e.target.value)} 
          />
        </div>
      </div>

      <button 
        onClick={handleDownloadPDF}
        disabled={isDownloading}
        className="w-full bg-emerald-500 hover:bg-emerald-600 font-bold text-zinc-950 p-2.5 rounded transition text-sm disabled:bg-zinc-700 disabled:text-zinc-500"
      >
        {isDownloading ? 'Compiling PDF...' : 'Export White-Label PDF'}
      </button>
    </div>
  );
}