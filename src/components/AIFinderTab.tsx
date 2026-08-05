import React, { useState } from 'react';
import {
  Sparkles,
  Sliders,
  Search,
  RefreshCw,
  Crown,
  CheckCircle2,
  Filter,
  Zap,
  BookmarkPlus
} from 'lucide-react';
import { AIUsernameItem, CheckResult, GeneratorParams, SavedUsername } from '../types';
import { CATEGORIES } from '../data/dictionary';
import { UsernameCard } from './UsernameCard';

interface AIFinderTabProps {
  savedList: SavedUsername[];
  onToggleSave: (item: AIUsernameItem) => void;
  onCheckStatus: (username: string) => Promise<CheckResult>;
  hideTakenUsernames?: boolean;
  setHideTakenUsernames?: (val: boolean) => void;
}

export const AIFinderTab: React.FC<AIFinderTabProps> = ({
  savedList,
  onToggleSave,
  onCheckStatus,
  hideTakenUsernames = true,
  setHideTakenUsernames,
}) => {
  const [params, setParams] = useState<GeneratorParams>({
    keywords: 'crypto, ton, alpha, dark, luxury, bot',
    category: 'all',
    lengthPref: 'any',
    includeNumbers: false,
    includeUnderscore: false,
    count: 12,
  });

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<AIUsernameItem[]>([]);
  const [checkMap, setCheckMap] = useState<Record<string, CheckResult>>({});
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'fragment'>('all');
  const [checkingAll, setCheckingAll] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Ошибка при генерации юзернеймов');
      }

      if (data.usernames && Array.isArray(data.usernames)) {
        setItems(data.usernames);

        // Automatically start background checks for generated handles
        autoCheckAll(data.usernames);
      } else {
        setErrorMessage('Не удалось получить список юзернеймов');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Ошибка соединения с AI сервером');
    } finally {
      setLoading(false);
    }
  };

  const autoCheckAll = async (list: AIUsernameItem[]) => {
    setCheckingAll(true);
    const batchSize = 5;
    for (let i = 0; i < list.length; i += batchSize) {
      const chunk = list.slice(i, i + batchSize);
      await Promise.all(
        chunk.map(async (item) => {
          const handle = item.username.replace(/^@/, '').trim().toLowerCase();
          try {
            const result = await onCheckStatus(handle);
            setCheckMap((prev) => ({ ...prev, [handle]: result }));
          } catch (err) {
            // ignore single fail
          }
        })
      );
    }
    setCheckingAll(false);
  };

  const handleCheckSingle = async (username: string) => {
    const handle = username.replace(/^@/, '').trim().toLowerCase();
    const res = await onCheckStatus(handle);
    setCheckMap((prev) => ({ ...prev, [handle]: res }));
  };

  const filteredItems = items.filter((item) => {
    const clean = item.username.replace(/^@/, '').trim().toLowerCase();
    const st = checkMap[clean]?.status;

    if (statusFilter === 'available') return st === 'available';
    if (statusFilter === 'fragment') return st === 'fragment' || st === 'short_premium';
    return true;
  });

  const availableCount = items.filter(
    (i) => checkMap[i.username.replace(/^@/, '').trim().toLowerCase()]?.status === 'available'
  ).length;

  return (
    <div className="space-y-6">
      {/* Search & Generator Controls Box */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-7 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-sky-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="flex items-center space-x-3 mb-4">
          <div className="w-10 h-10 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
            <Sparkles className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">AI Генератор редких юзернеймов</h2>
            <p className="text-xs text-slate-400">
              Нейросеть генерирует красивые комбинации с оценкой ценности и проверкой свободных юзернеймов
            </p>
          </div>
        </div>

        {/* Inputs */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Ключевые слова или тематика
            </label>
            <div className="relative">
              <input
                type="text"
                value={params.keywords}
                onChange={(e) => setParams({ ...params, keywords: e.target.value })}
                placeholder="например: crypto, ton, solana, luxury, dark, dev, alpha..."
                className="w-full bg-slate-950 border border-slate-800 focus:border-sky-500 rounded-2xl px-4 py-3.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 font-medium transition"
              />
              <button
                onClick={handleGenerate}
                disabled={loading}
                className="absolute right-2 top-2 bottom-2 px-5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white text-xs font-bold flex items-center space-x-2 transition shadow-md shadow-sky-500/20 disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Ищем...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 fill-white" />
                    <span>Сгенерировать</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Quick preset keywords tags */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500 font-medium">Популярные темы:</span>
            {[
              'crypto',
              'ton',
              'sol',
              'dark',
              'luxury',
              'vip',
              'dev',
              'ai',
              'cyber',
              'alpha',
              'minimal',
              'trader',
            ].map((tag) => (
              <button
                key={tag}
                onClick={() => {
                  if (!params.keywords.includes(tag)) {
                    setParams({
                      ...params,
                      keywords: params.keywords ? `${params.keywords}, ${tag}` : tag,
                    });
                  }
                }}
                className="px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-800 text-slate-300 border border-slate-700/50 transition hover:border-sky-500/50"
              >
                +{tag}
              </button>
            ))}
          </div>

          {/* Categories Horizontal Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Категория стиля
            </label>
            <div className="flex items-center space-x-2 overflow-x-auto pb-2 scrollbar-none">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setParams({ ...params, category: cat.id })}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition border ${
                    params.category === cat.id
                      ? 'bg-sky-500/20 text-sky-300 border-sky-500/50'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800 hover:text-slate-200'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          {/* Additional Options */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">
                Длина юзернейма
              </label>
              <select
                value={params.lengthPref}
                onChange={(e) => setParams({ ...params, lengthPref: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
              >
                <option value="any">Любая длина</option>
                <option value="3-4">3 - 4 символа (Ультра редкие)</option>
                <option value="5-6">5 - 6 символов (Чистые слова)</option>
                <option value="7-8">7 - 8 символов (Брендовые)</option>
              </select>
            </div>

            <div className="flex items-center space-x-3 pt-4 sm:pt-0">
              <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={params.includeNumbers}
                  onChange={(e) => setParams({ ...params, includeNumbers: e.target.checked })}
                  className="rounded bg-slate-950 border-slate-800 text-sky-500 focus:ring-0"
                />
                <span>Цифры (0-9)</span>
              </label>

              <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={params.includeUnderscore}
                  onChange={(e) => setParams({ ...params, includeUnderscore: e.target.checked })}
                  className="rounded bg-slate-950 border-slate-800 text-sky-500 focus:ring-0"
                />
                <span>Символ '_'</span>
              </label>
            </div>

            <div className="flex items-center justify-end">
              <div className="text-xs text-slate-400">
                Кол-во: <span className="font-bold text-white">{params.count}</span> вариантов
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {errorMessage && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-300 text-xs flex items-center space-x-2">
          <span>⚠️ {errorMessage}</span>
        </div>
      )}

      {/* Results Section */}
      {items.length > 0 && (
        <div className="space-y-4">
          {/* Header Controls for Results */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 p-4 rounded-2xl border border-slate-800">
            <div className="flex items-center space-x-3">
              <h3 className="font-bold text-white text-base">
                Найдено юзернеймов: <span className="text-sky-400">{items.length}</span>
              </h3>
              {availableCount > 0 && (
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-xs font-semibold">
                  🟢 Свободно: {availableCount}
                </span>
              )}
            </div>

            {/* Filter Pills */}
            <div className="flex items-center space-x-2 text-xs">
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-3 py-1.5 rounded-xl font-medium transition ${
                  statusFilter === 'all'
                    ? 'bg-sky-500 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                Все ({items.length})
              </button>
              <button
                onClick={() => setStatusFilter('available')}
                className={`px-3 py-1.5 rounded-xl font-medium transition ${
                  statusFilter === 'available'
                    ? 'bg-emerald-500 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                🟢 Свободные
              </button>
              <button
                onClick={() => setStatusFilter('fragment')}
                className={`px-3 py-1.5 rounded-xl font-medium transition ${
                  statusFilter === 'fragment'
                    ? 'bg-amber-500 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                💎 Fragment (до $300)
              </button>
            </div>
          </div>

          {/* Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredItems.map((item, idx) => {
              const clean = item.username.replace(/^@/, '').trim().toLowerCase();
              const isSaved = savedList.some(
                (s) => s.username.toLowerCase() === clean.toLowerCase()
              );

              return (
                <UsernameCard
                  key={idx}
                  username={item.username}
                  score={item.score}
                  category={item.category}
                  rarity={item.rarity}
                  meaning={item.meaning}
                  estimatedValue={item.estimatedValue}
                  checkResult={checkMap[clean]}
                  isSaved={isSaved}
                  onToggleSave={() => onToggleSave(item)}
                  onCheckStatus={handleCheckSingle}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Empty State when no generation performed yet */}
      {!loading && items.length === 0 && !errorMessage && (
        <div className="text-center py-12 px-4 bg-slate-900/40 rounded-3xl border border-slate-800/80">
          <div className="w-16 h-16 rounded-3xl bg-slate-800/80 border border-slate-700/80 flex items-center justify-center mx-auto mb-4 text-sky-400">
            <Sparkles className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-white mb-2">Готовы сгенерировать эксклюзивные юзернеймы</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto mb-6">
            Введите ключевые слова выше и нажмите «Сгенерировать», чтобы AI подобрал эстетичные, редкие и дорогие юзернеймы Telegram.
          </p>
        </div>
      )}
    </div>
  );
};
