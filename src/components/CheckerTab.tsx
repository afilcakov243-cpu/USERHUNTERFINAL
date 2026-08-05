import React, { useState } from 'react';
import { Search, ListChecks, Copy, RefreshCw, FileText, Download, Check, Sparkles, Filter } from 'lucide-react';
import { CheckResult, SavedUsername } from '../types';
import { UsernameCard } from './UsernameCard';

interface CheckerTabProps {
  savedList: SavedUsername[];
  onToggleSave: (item: { username: string }) => void;
  onCheckStatus: (username: string) => Promise<CheckResult>;
  hideTakenUsernames?: boolean;
  setHideTakenUsernames?: (val: boolean) => void;
}

export const CheckerTab: React.FC<CheckerTabProps> = ({
  savedList,
  onToggleSave,
  onCheckStatus,
  hideTakenUsernames = true,
  setHideTakenUsernames,
}) => {
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [singleInput, setSingleInput] = useState('');
  const [bulkInput, setBulkInput] = useState('coolhandle\nalpha_bot\nton_dev\nsolana\n_rare_\nvip_user');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<CheckResult[]>([]);
  const [filter, setFilter] = useState<'all' | 'available' | 'fragment' | 'taken'>('all');
  const [copiedAvailable, setCopiedAvailable] = useState(false);
  const [progressStats, setProgressStats] = useState<{ checkedCount: number; totalCount: number; blocks: string[] } | null>(null);

  const handleCheckSingle = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!singleInput.trim()) return;

    setLoading(true);
    const clean = singleInput.replace(/^@/, '').trim();
    try {
      const res = await onCheckStatus(clean);
      setResults([res, ...results.filter((r) => r.username.toLowerCase() !== clean.toLowerCase())]);
    } catch (err) {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleCheckBulk = async () => {
    const list = bulkInput
      .split('\n')
      .map((line) => line.replace(/^@/, '').trim())
      .filter((line) => line.length > 0);

    if (list.length === 0) return;

    setLoading(true);
    const newResults: CheckResult[] = [];
    const blocks: string[] = [];
    setProgressStats({ checkedCount: 0, totalCount: list.length, blocks: [] });

    // Process in parallel batches of 5 for speed + live progress
    const batchSize = 5;
    for (let i = 0; i < list.length; i += batchSize) {
      const chunk = list.slice(i, i + batchSize);
      try {
        const res = await fetch('/api/check-bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ usernames: chunk }),
        });
        const data = await res.json();
        if (data.results && Array.isArray(data.results)) {
          for (const item of data.results) {
            newResults.push(item);
            if (item.status === 'available') blocks.push('🟩');
            else if (item.status === 'fragment' || item.status === 'short_premium') blocks.push('🟦');
            else blocks.push('🟥');
          }
          setResults([...newResults]);
          setProgressStats({ checkedCount: newResults.length, totalCount: list.length, blocks: [...blocks] });
        }
      } catch (err) {
        console.error(err);
      }
    }
    setLoading(false);
  };

  const handleCopyAllAvailable = () => {
    const availableList = results
      .filter((r) => r.status === 'available')
      .map((r) => `@${r.username}`)
      .join('\n');

    if (availableList) {
      navigator.clipboard.writeText(availableList);
      setCopiedAvailable(true);
      setTimeout(() => setCopiedAvailable(false), 2000);
    }
  };

  const filteredResults = results.filter((r) => {
    if (filter === 'available') return r.status === 'available';
    if (filter === 'fragment') return r.status === 'fragment' || r.status === 'short_premium';
    if (filter === 'taken') return r.status === 'taken';
    return true;
  });

  const availableCount = results.filter((r) => r.status === 'available').length;
  const takenCount = results.filter((r) => r.status === 'taken').length;
  const fragmentCount = results.filter((r) => r.status === 'fragment' || r.status === 'short_premium').length;

  return (
    <div className="space-y-6">
      {/* Top Controller */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-7 shadow-xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl font-bold text-white">Проверка занятости юзернеймов</h2>
            <p className="text-xs text-slate-400">
              Мгновенный инспектор статуса Telegram t.me и площадки Fragment NFT (фильтр лотов до $300)
            </p>
          </div>

          {/* Mode Switcher */}
          <div className="flex bg-slate-950 p-1 rounded-2xl border border-slate-800 text-xs">
            <button
              onClick={() => setMode('single')}
              className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl font-semibold transition ${
                mode === 'single'
                  ? 'bg-sky-500 text-white shadow-md shadow-sky-500/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Search className="w-3.5 h-3.5" />
              <span>Один юзернейм</span>
            </button>
            <button
              onClick={() => setMode('bulk')}
              className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl font-semibold transition ${
                mode === 'bulk'
                  ? 'bg-sky-500 text-white shadow-md shadow-sky-500/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ListChecks className="w-3.5 h-3.5" />
              <span>Массовая проверка</span>
            </button>
          </div>
        </div>

        {/* Mode Forms */}
        {mode === 'single' ? (
          <form onSubmit={handleCheckSingle} className="relative">
            <input
              type="text"
              value={singleInput}
              onChange={(e) => setSingleInput(e.target.value)}
              placeholder="Введите юзернейм, например: @my_cool_handle или ton_dev"
              className="w-full bg-slate-950 border border-slate-800 focus:border-sky-500 rounded-2xl pl-4 pr-32 py-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 font-mono transition"
            />
            <button
              type="submit"
              disabled={loading || !singleInput.trim()}
              className="absolute right-2 top-2 bottom-2 px-5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-bold flex items-center space-x-2 transition shadow-md shadow-sky-500/20 disabled:opacity-50"
            >
              {loading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  <span>Проверить</span>
                </>
              )}
            </button>
          </form>
        ) : (
          <div className="space-y-3">
            <textarea
              rows={5}
              value={bulkInput}
              onChange={(e) => setBulkInput(e.target.value)}
              placeholder="Вставьте список юзернеймов по одному на строчку..."
              className="w-full bg-slate-950 border border-slate-800 focus:border-sky-500 rounded-2xl p-4 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20 font-mono transition resize-none"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Строк: {bulkInput.split('\n').filter((l) => l.trim()).length} (макс. 50 за раз)
              </span>
              <button
                onClick={handleCheckBulk}
                disabled={loading || !bulkInput.trim()}
                className="px-6 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-bold flex items-center space-x-2 transition shadow-md shadow-sky-500/20 disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Проверяем список...</span>
                  </>
                ) : (
                  <>
                    <ListChecks className="w-4 h-4" />
                    <span>Запустить проверку всех</span>
                  </>
                )}
              </button>
            </div>

            {/* Visual Progress Display by Tens */}
            {progressStats && progressStats.totalCount > 0 && (
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 font-mono text-xs space-y-2 mt-4">
                <div className="flex items-center justify-between text-slate-300 font-bold mb-2">
                  <span className="flex items-center gap-2">
                    {loading && <RefreshCw className="w-3.5 h-3.5 text-sky-400 animate-spin" />}
                    <span>Прогресс проверки по десяткам:</span>
                  </span>
                  <span className="text-sky-400 font-bold">{progressStats.checkedCount} / {progressStats.totalCount}</span>
                </div>

                {Array.from({ length: Math.ceil(progressStats.blocks.length / 10) }).map((_, idx) => {
                  const slice = progressStats.blocks.slice(idx * 10, (idx + 1) * 10);
                  const isCompleteDecade = slice.length === 10;
                  const labelText = isCompleteDecade
                    ? `${(idx + 1) * 10} проверено`
                    : `${progressStats.blocks.length} проверено`;
                  return (
                    <div key={idx} className="flex items-center space-x-3 bg-slate-900/80 p-2.5 rounded-xl border border-slate-800/80">
                      <span className="text-slate-400 font-semibold w-32">{labelText}:</span>
                      <span className="tracking-widest text-base font-sans">{slice.join('')}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Results Header & Filters */}
      {results.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 p-4 rounded-2xl border border-slate-800">
            <div className="flex items-center space-x-2 text-xs">
              <span className="font-bold text-white text-sm">Результаты: {results.length}</span>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium">
                🟢 {availableCount}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 font-medium">
                💎 {fragmentCount}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-400 font-medium">
                🔴 {takenCount}
              </span>
            </div>

            <div className="flex items-center space-x-2 text-xs">
              <button
                onClick={handleCopyAllAvailable}
                disabled={availableCount === 0}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 font-medium border border-emerald-500/20 transition disabled:opacity-40"
              >
                {copiedAvailable ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedAvailable ? 'Скопировано!' : 'Скопировать все свободные'}</span>
              </button>

              <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
                <button
                  onClick={() => setFilter('all')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                    filter === 'all' ? 'bg-sky-500 text-white' : 'text-slate-400'
                  }`}
                >
                  Все
                </button>
                <button
                  onClick={() => setFilter('available')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                    filter === 'available' ? 'bg-emerald-500 text-white' : 'text-slate-400'
                  }`}
                >
                  🟢 Свободные
                </button>
                <button
                  onClick={() => setFilter('fragment')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                    filter === 'fragment' ? 'bg-amber-500 text-white' : 'text-slate-400'
                  }`}
                >
                  💎 Fragment
                </button>
                <button
                  onClick={() => setFilter('taken')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                    filter === 'taken' ? 'bg-rose-500 text-white' : 'text-slate-400'
                  }`}
                >
                  🔴 Заняты
                </button>
              </div>
            </div>
          </div>

          {/* Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredResults.map((r, idx) => {
              const isSaved = savedList.some(
                (s) => s.username.toLowerCase() === r.username.toLowerCase()
              );
              return (
                <UsernameCard
                  key={idx}
                  username={r.username}
                  checkResult={r}
                  isSaved={isSaved}
                  onToggleSave={() => onToggleSave({ username: r.username })}
                  onCheckStatus={async (u) => {
                    const updated = await onCheckStatus(u);
                    setResults((prev) =>
                      prev.map((item) => (item.username.toLowerCase() === u.toLowerCase() ? updated : item))
                    );
                  }}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
