import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Navbar } from './components/Navbar';
import { AIFinderTab } from './components/AIFinderTab';
import { CheckerTab } from './components/CheckerTab';
import { PatternScannerTab } from './components/PatternScannerTab';
import { BotSetupTab } from './components/BotSetupTab';
import { SavedTab } from './components/SavedTab';
import { AIUsernameItem, CheckResult, SavedUsername, TelegramBotInfo, UsernameStatus } from './types';
import { Sparkles, Bot, Crown, Search, ShieldCheck } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<'ai' | 'checker' | 'patterns' | 'bot' | 'saved'>('ai');
  const [savedList, setSavedList] = useState<SavedUsername[]>(() => {
    try {
      const stored = localStorage.getItem('tg_saved_usernames');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [botToken, setBotToken] = useState<string>(() => {
    const saved = localStorage.getItem('tg_bot_token');
    if (!saved || saved.startsWith('8810823823')) {
      return '8868659501:AAHK7Ke00c5BLr90QZ8r_rpMIzanpyKUnaA';
    }
    return saved;
  });

  const [botInfo, setBotInfo] = useState<TelegramBotInfo | null>(null);

  const [hideTakenUsernames, setHideTakenUsernames] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('tg_hide_taken_usernames');
      return stored !== null ? JSON.parse(stored) : true;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    localStorage.setItem('tg_hide_taken_usernames', JSON.stringify(hideTakenUsernames));
  }, [hideTakenUsernames]);

  useEffect(() => {
    localStorage.setItem('tg_saved_usernames', JSON.stringify(savedList));
  }, [savedList]);

  useEffect(() => {
    if (botToken) {
      localStorage.setItem('tg_bot_token', botToken);
    }
  }, [botToken]);

  // Test token on load if token saved
  useEffect(() => {
    if (botToken.trim() && !botInfo) {
      fetch('/api/bot/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: botToken.trim() }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.bot) setBotInfo(data.bot);
        })
        .catch(() => {});
    }
  }, []);

  const handleCheckStatus = async (username: string): Promise<CheckResult> => {
    const res = await fetch('/api/check-username', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка проверки');
    return data;
  };

  const handleToggleSave = (item: { username: string; score?: number; category?: string }) => {
    const clean = item.username.replace(/^@/, '').trim().toLowerCase();
    const exists = savedList.some((s) => s.username.toLowerCase() === clean);

    if (exists) {
      setSavedList((prev) => prev.filter((s) => s.username.toLowerCase() !== clean));
    } else {
      const newItem: SavedUsername = {
        id: Date.now().toString(),
        username: clean,
        status: 'available',
        score: item.score,
        category: item.category,
        savedAt: new Date().toLocaleDateString(),
      };
      setSavedList((prev) => [newItem, ...prev]);
    }
  };

  const handleRemoveSaved = (username: string) => {
    const clean = username.replace(/^@/, '').trim().toLowerCase();
    setSavedList((prev) => prev.filter((s) => s.username.toLowerCase() !== clean));
  };

  const handleUpdateSavedStatus = (username: string, status: UsernameStatus) => {
    const clean = username.replace(/^@/, '').trim().toLowerCase();
    setSavedList((prev) =>
      prev.map((s) => (s.username.toLowerCase() === clean ? { ...s, status } : s))
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-sky-500 selection:text-white">
      {/* Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        savedCount={savedList.length}
        botConnected={!!botInfo}
        botUsername={botInfo?.username}
        hideTakenUsernames={hideTakenUsernames}
        setHideTakenUsernames={setHideTakenUsernames}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <AnimatePresence mode="wait">
          {activeTab === 'ai' && (
            <motion.div
              key="ai"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <AIFinderTab
                savedList={savedList}
                onToggleSave={handleToggleSave}
                onCheckStatus={handleCheckStatus}
                hideTakenUsernames={hideTakenUsernames}
                setHideTakenUsernames={setHideTakenUsernames}
              />
            </motion.div>
          )}

          {activeTab === 'checker' && (
            <motion.div
              key="checker"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <CheckerTab
                savedList={savedList}
                onToggleSave={handleToggleSave}
                onCheckStatus={handleCheckStatus}
                hideTakenUsernames={hideTakenUsernames}
                setHideTakenUsernames={setHideTakenUsernames}
              />
            </motion.div>
          )}

          {activeTab === 'patterns' && (
            <motion.div
              key="patterns"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <PatternScannerTab
                savedList={savedList}
                onToggleSave={handleToggleSave}
                onCheckStatus={handleCheckStatus}
                hideTakenUsernames={hideTakenUsernames}
                setHideTakenUsernames={setHideTakenUsernames}
              />
            </motion.div>
          )}

          {activeTab === 'bot' && (
            <motion.div
              key="bot"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <BotSetupTab
                botInfo={botInfo}
                setBotInfo={setBotInfo}
                botToken={botToken}
                setBotToken={setBotToken}
                onCheckStatus={handleCheckStatus}
                hideTakenUsernames={hideTakenUsernames}
                setHideTakenUsernames={setHideTakenUsernames}
              />
            </motion.div>
          )}

          {activeTab === 'saved' && (
            <motion.div
              key="saved"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <SavedTab
                savedList={savedList}
                onRemoveSaved={handleRemoveSaved}
                onClearAll={() => setSavedList([])}
                onCheckStatus={handleCheckStatus}
                onUpdateStatus={handleUpdateSavedStatus}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-900 bg-slate-950 py-8 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 rounded-lg bg-sky-500/20 text-sky-400 font-bold flex items-center justify-center text-xs">
              TG
            </div>
            <span>Telegram Username Finder & AI Bot Platform © 2026</span>
          </div>

          <div className="flex items-center space-x-6 text-slate-400">
            <button onClick={() => setActiveTab('ai')} className="hover:text-sky-400 transition">
              AI Генератор
            </button>
            <button onClick={() => setActiveTab('checker')} className="hover:text-sky-400 transition">
              Проверка t.me
            </button>
            <a href="https://fragment.com" target="_blank" rel="noreferrer" className="hover:text-sky-400 transition">
              Fragment NFT
            </a>
            <button onClick={() => setActiveTab('bot')} className="hover:text-sky-400 transition">
              Настройка Бота
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
