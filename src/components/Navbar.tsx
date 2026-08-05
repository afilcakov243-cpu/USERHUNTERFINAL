import React from 'react';
import { Search, Sparkles, SlidersHorizontal, Bot, Bookmark, ShieldCheck, ExternalLink } from 'lucide-react';

interface NavbarProps {
  activeTab: 'ai' | 'checker' | 'patterns' | 'bot' | 'saved';
  setActiveTab: (tab: 'ai' | 'checker' | 'patterns' | 'bot' | 'saved') => void;
  savedCount: number;
  botConnected: boolean;
  botUsername?: string;
  hideTakenUsernames?: boolean;
  setHideTakenUsernames?: (val: boolean) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  savedCount,
  botConnected,
  botUsername,
  hideTakenUsernames = true,
  setHideTakenUsernames,
}) => {
  return (
    <header className="sticky top-0 z-50 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 text-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Brand Logo & Title */}
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setActiveTab('ai')}>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20 text-white font-bold text-xl">
              TG
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="font-bold text-lg text-white tracking-tight">Username Finder AI</h1>
                <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
                  v2.5 Pro
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">Поиск и генерация красивых юзернеймов Telegram</p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="hidden md:flex items-center space-x-1 bg-slate-950/60 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setActiveTab('ai')}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'ai'
                  ? 'bg-sky-500 text-white shadow-md shadow-sky-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              <span>AI Генератор</span>
            </button>

            <button
              onClick={() => setActiveTab('checker')}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'checker'
                  ? 'bg-sky-500 text-white shadow-md shadow-sky-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Search className="w-4 h-4" />
              <span>Проверка</span>
            </button>

            <button
              onClick={() => setActiveTab('patterns')}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'patterns'
                  ? 'bg-sky-500 text-white shadow-md shadow-sky-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span>Сканер 3-4L</span>
            </button>

            <button
              onClick={() => setActiveTab('bot')}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all relative ${
                activeTab === 'bot'
                  ? 'bg-sky-500 text-white shadow-md shadow-sky-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Bot className="w-4 h-4" />
              <span>Бот Telegram</span>
              {botConnected && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              )}
            </button>

            <button
              onClick={() => setActiveTab('saved')}
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all relative ${
                activeTab === 'saved'
                  ? 'bg-sky-500 text-white shadow-md shadow-sky-500/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <Bookmark className="w-4 h-4" />
              <span>Избранное</span>
              {savedCount > 0 && (
                <span className="ml-1 px-1.5 py-0.2 bg-indigo-500 text-white text-xs rounded-full font-bold">
                  {savedCount}
                </span>
              )}
            </button>
          </nav>

          {/* Right Status Badge */}
          <div className="flex items-center space-x-2 sm:space-x-3">
            {botConnected ? (
              <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span className="truncate max-w-[120px]">@{botUsername || 'bot'}</span>
              </div>
            ) : (
              <button
                onClick={() => setActiveTab('bot')}
                className="hidden sm:flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition"
              >
                <Bot className="w-3.5 h-3.5 text-sky-400" />
                <span>Подключить бота</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Bar Navigation */}
      <div className="md:hidden flex items-center justify-around bg-slate-950 border-t border-slate-800 py-2 px-2 text-xs">
        <button
          onClick={() => setActiveTab('ai')}
          className={`flex flex-col items-center py-1 px-2 rounded-lg ${
            activeTab === 'ai' ? 'text-sky-400 font-bold' : 'text-slate-400'
          }`}
        >
          <Sparkles className="w-5 h-5 mb-1" />
          <span>AI Поиск</span>
        </button>

        <button
          onClick={() => setActiveTab('checker')}
          className={`flex flex-col items-center py-1 px-2 rounded-lg ${
            activeTab === 'checker' ? 'text-sky-400 font-bold' : 'text-slate-400'
          }`}
        >
          <Search className="w-5 h-5 mb-1" />
          <span>Проверка</span>
        </button>

        <button
          onClick={() => setActiveTab('patterns')}
          className={`flex flex-col items-center py-1 px-2 rounded-lg ${
            activeTab === 'patterns' ? 'text-sky-400 font-bold' : 'text-slate-400'
          }`}
        >
          <SlidersHorizontal className="w-5 h-5 mb-1" />
          <span>Сканер</span>
        </button>

        <button
          onClick={() => setActiveTab('bot')}
          className={`flex flex-col items-center py-1 px-2 rounded-lg ${
            activeTab === 'bot' ? 'text-sky-400 font-bold' : 'text-slate-400'
          }`}
        >
          <Bot className="w-5 h-5 mb-1" />
          <span>Бот</span>
        </button>

        <button
          onClick={() => setActiveTab('saved')}
          className={`flex flex-col items-center py-1 px-2 rounded-lg ${
            activeTab === 'saved' ? 'text-sky-400 font-bold' : 'text-slate-400'
          }`}
        >
          <Bookmark className="w-5 h-5 mb-1" />
          <span>Заметки ({savedCount})</span>
        </button>
      </div>
    </header>
  );
};
