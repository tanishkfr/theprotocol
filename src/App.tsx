/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { createProtocolChat } from './lib/gemini';
import { useSensors } from './hooks/useSensors';
import ReactMarkdown from 'react-markdown';
import { Terminal, Send } from 'lucide-react';

export default function App() {
  const [messages, setMessages] = useState<{role: 'user' | 'model', content: string}[]>([]);
  const [input, setInput] = useState('');
  const [chatSession, setChatSession] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const [activeConstraints, setActiveConstraints] = useState<string[]>([]);
  const [mode, setMode] = useState<'REGULAR' | 'AI' | null>(null);
  
  const sensors = useSensors(started);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
      if (activeConstraints.includes('not_charging') && sensors.isCharging === true) violated = 'not_charging';
      if (activeConstraints.includes('flat') && sensors.isFlat === false) violated = 'flat';
      if (activeConstraints.includes('dark') && sensors.isDark === false) violated = 'dark';
      if (activeConstraints.includes('humming') && sensors.isHumming === false) violated = 'humming';
      if (activeConstraints.includes('silent') && sensors.isSilent === false) violated = 'silent';
      if (activeConstraints.includes('still') && sensors.isMoving === true) violated = 'still';
      
      if (activeConstraints.includes('battery_below_80') && sensors.batteryLevel !== null && sensors.batteryLevel >= 80) violated = 'battery_below_80';
      if (activeConstraints.includes('battery_40_45') && sensors.batteryLevel !== null && (sensors.batteryLevel < 40 || sensors.batteryLevel > 45)) violated = 'battery_40_45';

      if (activeConstraints.includes('rhythm')) {
        const timeSinceLastTap = Date.now() - sensors.lastTapTime;
        if (timeSinceLastTap > 1500) violated = 'rhythm (too slow or stopped)';
      }

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
    } catch (error) {
      console.error(error);
      setMessages([{ role: 'model', content: '❌ CRITICAL ERROR: PROTOCOL INITIALIZATION FAILED.' }]);
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
        orientation: sensors.orientation,
        batteryLevel: sensors.batteryLevel,
        isCharging: sensors.isCharging,
        isFlat: sensors.isFlat,
        isDark: sensors.isDark,
        isHumming: sensors.isHumming,
        isSilent: sensors.isSilent,
        isMoving: sensors.isMoving
      })}]`;

      if (currentMode === 'AI') {
        hiddenContext += `\n[SYSTEM DIRECTIVE - AI MODE ACTIVE: Verify compliance with current rules. If compliant, generate the NEXT STAGE. Current active constraints: [${activeConstraints.length > 0 ? activeConstraints.join(', ') : 'none'}]. You MUST generate a new rule that conflicts with or complicates this specific stack. Output the updated [CONSTRAINTS: ...] block at the end.]`;
      }

      const parts: any[] = [{ text: userText + hiddenContext }];
      
      // Attach camera frame if available for visual verification
      if (sensors.cameraFrameBase64) {
        const base64Data = sensors.cameraFrameBase64.split(',')[1];
        parts.push({
          inlineData: {
            data: base64Data,
            mimeType: 'image/jpeg'
          }
        });
      }

      const response = await chatSession.sendMessage({ message: parts });
      handleModelResponse(response.text);
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'model', content: '❌ CONNECTION LOST.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!started) {
    return (
      <div className="min-h-screen bg-black text-green-500 font-mono flex flex-col items-center justify-center p-4">
        <Terminal size={48} className="mb-6 text-green-500 animate-pulse" />
        <h1 className="text-2xl md:text-4xl font-bold mb-8 tracking-widest text-center">THE PROTOCOL</h1>
        <p className="max-w-md text-center text-green-800 mb-8 text-sm">
          WARNING: This protocol requires absolute compliance. It will request access to your Camera, Microphone, and Motion sensors. Do not lie to it. It will know.
        </p>
        <button 
          onClick={handleStart}
          className="px-8 py-3 border border-green-500 hover:bg-green-500 hover:text-black transition-colors duration-300 tracking-widest uppercase"
        >
          Grant Access & Initialize
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-green-500 font-mono flex flex-col">
      <header className="border-b border-green-900 p-4 flex items-center justify-between bg-black z-10 sticky top-0">
        <div className="flex items-center gap-2">
          <Terminal size={20} />
          <span className="font-bold tracking-widest">PROTOCOL_ACTIVE</span>
        </div>
        <div className="text-xs text-green-800 flex gap-4 hidden sm:flex">
          <span>BATT: {sensors.batteryLevel !== null ? `${sensors.batteryLevel}%` : '??'}</span>
          <span>CHRG: {sensors.isCharging !== null ? (sensors.isCharging ? 'YES' : 'NO') : '??'}</span>
          <span>ORNT: {sensors.orientation.substring(0, 4).toUpperCase()}</span>
          <span>FLAT: {sensors.isFlat !== null ? (sensors.isFlat ? 'YES' : 'NO') : '??'}</span>
          <span>DARK: {sensors.isDark !== null ? (sensors.isDark ? 'YES' : 'NO') : '??'}</span>
          <span>HUM: {sensors.isHumming !== null ? (sensors.isHumming ? 'YES' : 'NO') : '??'}</span>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[95%] md:max-w-[80%] ${msg.role === 'user' ? 'text-green-400' : 'text-green-500'}`}>
              {msg.role === 'user' ? (
                <div className="text-right">
                  <span className="opacity-50 text-xs mr-2">&gt;</span>
                  {msg.content}
                </div>
              ) : (
                <div className="prose-green">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="text-green-500 animate-pulse">PROCESSING...</div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </main>

      <footer className="border-t border-green-900 p-4 bg-black">
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto flex gap-2">
          <div className="flex-1 flex items-center border border-green-900 bg-black px-4 py-2 focus-within:border-green-500 transition-colors">
            <span className="text-green-500 mr-2">&gt;</span>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="flex-1 bg-transparent outline-none text-green-500 placeholder-green-900"
              placeholder="Awaiting input..."
              autoFocus
              autoComplete="off"
            />
          </div>
          <button 
            type="submit" 
            disabled={isLoading || !input.trim()}
            className="px-4 py-2 border border-green-900 hover:bg-green-900 disabled:opacity-50 disabled:hover:bg-transparent transition-colors flex items-center justify-center"
          >
            <Send size={20} />
          </button>
        </form>
      </footer>
    </div>
  );
}
