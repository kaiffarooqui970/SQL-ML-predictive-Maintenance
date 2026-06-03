import React, { useState, useRef, useEffect } from 'react';

interface Message {
  role: 'user' | 'ai';
  content: string;
}

export default function CopilotWidget({ simulationResults, currentPortfolio }: { simulationResults: any, currentPortfolio: any }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'ai', content: "Hello. I am your QuantShield AI Advisor. How can I help you optimize this portfolio?" }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || !simulationResults || !currentPortfolio) return;

    const userText = input;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userText }]);
    setIsLoading(true);

    try {
      const response = await fetch('http://localhost:8000/api/advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_message: userText,
          tickers: currentPortfolio.tickers,
          weights: currentPortfolio.weights,
          expected_return: simulationResults.expected_return,
          max_drawdown: simulationResults.max_drawdown
        }),
      });

      if (!response.ok) throw new Error('Failed to fetch AI advice');

      const data = await response.json();
      
      // 1. Add the text to the chat UI
      setMessages(prev => [...prev, { role: 'ai', content: data.text }]);

      // 2. Instantly play the generated Voice Audio
      if (data.audio_base64) {
        const audio = new Audio("data:audio/mpeg;base64," + data.audio_base64);
        audio.play().catch(e => console.error("Browser blocked audio autoplay:", e));
      }

    } catch (error) {
      console.error("AI Error:", error);
      setMessages(prev => [...prev, { role: 'ai', content: "Connection error. Please check the backend." }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {/* The Floating Chat Window */}
      {isOpen && (
        <div className="mb-4 w-80 sm:w-96 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="bg-zinc-800 p-4 flex justify-between items-center border-b border-zinc-700">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
              <h3 className="font-bold text-white text-sm">QuantShield Copilot</h3>
            </div>
            <button onClick={() => setIsOpen(false)} className="text-zinc-400 hover:text-white">
              ✕
            </button>
          </div>

          {/* Chat History */}
          <div className="h-80 p-4 overflow-y-auto flex flex-col gap-3 bg-black/50">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`p-3 rounded-lg max-w-[85%] text-sm ${
                  msg.role === 'user' 
                    ? 'bg-emerald-600 text-white rounded-br-none' 
                    : 'bg-zinc-800 text-zinc-200 border border-zinc-700 rounded-bl-none'
                }`}>
                  {msg.content}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="p-3 rounded-lg bg-zinc-800 text-zinc-400 text-xs border border-zinc-700 rounded-bl-none animate-pulse">
                  Analyzing portfolio matrix...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-3 bg-zinc-800 border-t border-zinc-700 flex gap-2">
            <input 
              type="text" 
              className="flex-1 bg-zinc-900 text-white text-sm rounded-md px-3 py-2 border border-zinc-700 focus:outline-none focus:border-emerald-500"
              placeholder={simulationResults ? "Ask about this portfolio..." : "Run a simulation first..."}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              disabled={!simulationResults || isLoading}
            />
            <button 
              onClick={handleSend}
              disabled={!simulationResults || isLoading || !input.trim()}
              className="bg-emerald-500 hover:bg-emerald-600 text-zinc-950 font-bold px-3 py-2 rounded-md disabled:opacity-50 transition"
            >
              ➤
            </button>
          </div>
        </div>
      )}

      {/* The Floating Action Button */}
      {!isOpen && (
        <button 
          onClick={() => setIsOpen(true)}
          className="w-14 h-14 bg-emerald-500 hover:bg-emerald-600 text-zinc-950 rounded-full shadow-lg flex items-center justify-center transition-transform hover:scale-105"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg>
        </button>
      )}
    </div>
  );
}