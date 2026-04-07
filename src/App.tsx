/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { createProtocolChat } from './lib/gemini';
import { useSensors } from './hooks/useSensors';
import ReactMarkdown from 'react-markdown';
import { Terminal, Send, ShieldAlert, Cpu, Activity, Lock, Smartphone, Wifi, Battery } from 'lucide-react';

export default function App() {
  const [isBooting, setIsBooting] = useState(true);
  const [messages, setMessages] = useState<{role: 'user' | 'model', content: string}[]>([]);
  const [input, setInput] = useState('');
  const [chatSession, setChatSession] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const [activeConstraints, setActiveConstraints] = useState<string[]>([]);
  const [mode, setMode] = useState<'REGULAR' | 'AI' | null>(null);
  
  const sensors = useSensors(started);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Splash Screen Sequence
  useEffect(() => {
    const timer = setTimeout(() => setIsBooting(false), 3500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Continuous Polling for Auto-Failure
  useEffect(() => {
    if (!started || isLoading || activeConstraints.length === 0 || !chatSession) return;

    const checkInterval = setInterval(() => {
      let violated = null;
      
      if (activeConstraints.includes('landscape') && sensors.orientation === 'portrait') violated = 'landscape';
      if (activeConstraints.includes('charging') && sensors.isCharging === false) violated = 'charging';
      if (activeConstraints.includes('flat') && sensors.isFlat === false) violated = 'flat';
      if (activeConstraints.includes('online') && sensors.isOnline === false) violated = 'online';
      if (activeConstraints.includes('anchor') && sensors.distanceMoved !== null && sensors.distanceMoved > 10) violated = 'anchor';

      if (violated) {
        clearInterval(checkInterval);
        triggerAutoFailure(violated);
      }
    }, 500);

    return () => clearInterval(checkInterval);
  }, [sensors, activeConstraints, started, isLoading, chatSession]);

  const triggerAutoFailure = async (reason: string) => {
    setIsLoading(true);
    try {
      const response = await chatSession.sendMessage({ message: `[SYSTEM OVERRIDE: USER VIOLATED CONSTRAINT '${reason}'. TRIGGER FAILURE STATE IMMEDIATELY.]` });
      handleModelResponse(response.text);
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleModelResponse = (text: string) => {
    const constraintsMatch = text.match(/\[CONSTRAINTS:\s*(.*?)\]/);
    if (constraintsMatch) {
      const parsed = constraintsMatch[1].split(',').map(s => s.trim().toLowerCase()).filter(s => s && s !== 'none');
      setActiveConstraints(parsed);
    } else if (text.includes('❌ RULE') && text.includes('VIOLATED')) {
      setActiveConstraints([]); // Reset on failure
    }
    
    const cleanText = text.replace(/\[CONSTRAINTS:\s*(.*?)\]/g, '').trim();
    setMessages(prev => [...prev, { role: 'model', content: cleanText }]);
  };

  const handleStart = async () => {
    // Request iOS permissions if needed
    if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      try {
        await (DeviceOrientationEvent as any).requestPermission();
      } catch (e) { console.error(e); }
    }
    
    setStarted(true);
    setIsLoading(true);
    try {
      const chat = await createProtocolChat();
      setChatSession(chat);
      const response = await chat.sendMessage({ message: "Start Protocol" });
      handleModelResponse(response.text);
    } catch (error: any) {
      console.error(error);
      setMessages([{ role: 'model', content: `❌ CRITICAL ERROR: PROTOCOL INITIALIZATION FAILED.\n\nDetails: ${error.message || String(error)}\n\nDid you add VITE_GEMINI_API_KEY to your Vercel Environment Variables and redeploy?` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !chatSession || isLoading) return;

    const userText = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userText }]);
    setIsLoading(true);

    let currentMode = mode;
    if (!currentMode) {
      if (userText === '1') currentMode = 'REGULAR';
      if (userText === '2') currentMode = 'AI';
      setMode(currentMode);
    } else if (activeConstraints.length === 0 && userText.toUpperCase() === 'Y') {
      currentMode = null;
      setMode(null);
    }

    try {
      let hiddenContext = `\n\n[SYSTEM SENSOR DATA: ${JSON.stringify({
        timestamp: new Date().toISOString(),
        seconds: new Date().getSeconds(),
        orientation: sensors.orientation,
        batteryLevel: sensors.batteryLevel,
        isCharging: sensors.isCharging,
        isFlat: sensors.isFlat,
        isMoving: sensors.isMoving,
        isOnline: sensors.isOnline,
        offlineCount: sensors.offlineCount,
        lastHiddenDuration: sensors.lastHiddenDuration,
        recentTaps: sensors.recentTaps,
        distanceMoved: sensors.distanceMoved,
        illuminance: sensors.illuminance
      })}]`;

      if (currentMode === 'AI') {
        hiddenContext += `\n[SYSTEM DIRECTIVE - AI MODE ACTIVE: Verify compliance with current rules. If compliant, generate the NEXT STAGE. Current active constraints: [${activeConstraints.length > 0 ? activeConstraints.join(', ') : 'none'}]. You MUST generate a new rule that conflicts with or complicates this specific stack. Output the updated [CONSTRAINTS: ...] block at the end.]`;
      }

      const parts: any[] = [{ text: userText + hiddenContext }];

      const response = await chatSession.sendMessage({ message: parts });
      handleModelResponse(response.text);
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'model', content: '❌ CONNECTION LOST.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  // 1. Splash Screen
  if (isBooting) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center font-mono overflow-hidden">
        <div className="text-orange-600 animate-glitch text-4xl font-black mb-4">1 UNREAD MESSAGE</div>
        <div className="w-64 h-1 bg-zinc-900 overflow-hidden relative">
          <div className="absolute top-0 left-0 h-full bg-orange-600 animate-progress"></div>
        </div>
        <div className="mt-4 text-[10px] text-zinc-500 uppercase tracking-[0.4em] animate-pulse">
          Establishing Hostile Friction...
        </div>
      </div>
    );
  }

  // 2. Landing Page
  if (!started) {
    return (
      <div className="min-h-screen bg-black text-green-500 font-mono flex flex-col items-center justify-center p-6 scanlines">
        <div className="border-2 border-green-500 p-8 md:p-12 flex flex-col items-center gap-6 shadow-[0_0_20px_rgba(34,197,94,0.3)] max-w-lg w-full">
          <Lock size={48} className="animate-pulse" />
          <h1 className="text-3xl md:text-4xl font-black tracking-[0.2em] text-center uppercase">The Protocol</h1>
          <p className="text-[10px] text-green-800 tracking-widest text-center uppercase leading-loose">
            Encryption: Active<br/>
            Friction Level: Maximum<br/>
            Worthiness: Unverified
          </p>
          <button 
            onClick={handleStart}
            title="Begin the verification process"
            className="w-full mt-4 px-8 py-4 border-2 border-green-500 hover:bg-green-500 hover:text-black transition-all duration-300 font-bold uppercase text-lg"
          >
            Initialize Entry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black text-green-500 font-mono flex flex-col lg:flex-row overflow-hidden scanlines">
      {/* Mobile-Only Sensor Bar (Visible when sidebar is hidden) */}
      <div className="lg:hidden shrink-0 flex justify-around items-center py-2 px-4 border-b border-green-900 bg-black/90 text-[10px] z-20">
        <div className="flex items-center gap-1" title="Current battery level">
          <Battery size={12} className={sensors.isCharging ? "text-green-400" : "text-green-800"} />
          <span>{sensors.batteryLevel}%</span>
        </div>
        <div className="flex items-center gap-1" title="Device orientation">
          <Smartphone size={12} className={sensors.isFlat ? "text-green-400" : "text-green-800"} />
          <span>{sensors.orientation.toUpperCase().slice(0,4)}</span>
        </div>
        <div className="flex items-center gap-1" title="Network connectivity">
          <Wifi size={12} className={sensors.isOnline ? "text-green-400" : "text-red-500"} />
          <span>{sensors.isOnline ? 'SECURE' : 'OFFLINE'}</span>
        </div>
      </div>

      {/* Desktop Sidebar (Rules & Stats) */}
      <aside className="hidden lg:flex w-80 border-r border-green-900 bg-black/50 p-6 flex-col gap-8">
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs text-green-800 font-bold tracking-widest uppercase">
            <Activity size={14} /> Biometrics
          </div>
          <div className="grid grid-cols-2 gap-2">
            <StatusTile label="BATT" val={`${sensors.batteryLevel}%`} active={!!sensors.batteryLevel} title="Current battery level" />
            <StatusTile label="CHRG" val={sensors.isCharging ? 'YES' : 'NO'} active={!!sensors.isCharging} title="Power source connection status" />
            <StatusTile label="FLAT" val={sensors.isFlat ? 'YES' : 'NO'} active={!!sensors.isFlat} title="Gyroscope stability" />
            <StatusTile label="MODE" val={sensors.orientation.toUpperCase()} active={true} title="Device orientation" />
          </div>
        </div>
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="flex items-center gap-2 text-xs text-green-800 font-bold tracking-widest uppercase mb-4">
            <Cpu size={14} /> The Stack
          </div>
          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar text-[10px] space-y-2 opacity-60">
            {activeConstraints.length === 0 ? (
              <div className="italic">Awaiting first rule...</div>
            ) : (
              activeConstraints.map((constraint, idx) => (
                <div key={idx} className="border border-green-900 p-2 uppercase flex items-center justify-between">
                  <span>{constraint}</span>
                  <span className="text-green-500 animate-pulse">ACTIVE</span>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="border-t border-green-900 pt-4">
          <div className="text-[10px] text-green-800 mb-2">VERSION 3.1.0_PRO</div>
          <div className="h-1 w-full bg-green-900">
            <div className="h-full bg-green-500 shadow-[0_0_10px_green]" style={{width: `${Math.min(100, (activeConstraints.length / 15) * 100)}%`}}></div>
          </div>
        </div>
      </aside>

      {/* Main Interface */}
      <div className="flex-1 flex flex-col h-full relative min-w-0">
        <header className="shrink-0 border-b border-green-900 p-4 flex items-center justify-between bg-black/80 backdrop-blur-md z-10">
          <div className="flex items-center gap-2">
            <ShieldAlert size={16} className="text-red-600 animate-pulse" />
            <span className="font-bold tracking-widest text-xs uppercase">Protocol_v3.1</span>
          </div>
          <div className="text-[10px] text-green-800 animate-pulse">LIVE FEED // UPLINK SECURE</div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[95%] md:max-w-[80%] ${msg.role === 'user' ? 'bg-green-950/10 p-3 border-r-2 border-green-500 text-green-400' : 'text-green-500'}`}>
                {msg.role === 'user' ? (
                  <div className="text-right">
                    <span className="text-[10px] block opacity-30 mb-1">USER_INPUT</span>
                    {msg.content}
                  </div>
                ) : (
                  <div className="prose prose-invert prose-xs text-green-500 leading-relaxed max-w-none">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
          ))}
          {isLoading && <div className="text-[10px] animate-pulse tracking-widest text-green-800">PROCESSING...</div>}
          <div ref={messagesEndRef} />
        </main>

        {/* Input area: Sticky at bottom, mobile-friendly padding */}
        <footer className="shrink-0 p-4 bg-black border-t border-green-900/50 z-10">
          <form onSubmit={handleSubmit} className="max-w-3xl mx-auto flex items-center border border-green-900 bg-black/90 px-4 py-3 focus-within:border-green-500 transition-all shadow-2xl">
            <span className="text-green-800 mr-2 text-xs">&gt;</span>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              title="Enter your response here"
              className="flex-1 bg-transparent outline-none text-green-500 text-sm placeholder-green-900"
              placeholder="Submit proof..."
              autoComplete="off"
            />
            <button type="submit" disabled={isLoading || !input.trim()} title="Transmit message" className="ml-2 text-green-500 disabled:opacity-20 hover:text-green-400 transition-colors">
              <Send size={18} />
            </button>
          </form>
        </footer>
      </div>
    </div>
  );
}

function StatusTile({ label, val, active, title }: { label: string, val: string, active: boolean, title?: string }) {
  return (
    <div title={title} className={`p-2 border ${active ? 'border-green-800 text-green-500' : 'border-zinc-900 text-zinc-700'} text-[10px]`}>
      <div className="opacity-40 mb-1">{label}</div>
      <div className="font-bold truncate">{val}</div>
    </div>
  );
}
