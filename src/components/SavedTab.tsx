import React, { useState } from 'react';
import { Bookmark, Download, Trash2, Search, Copy, Check, FileText, Filter, Crown, CheckCircle2, XCircle } from 'lucide-react';
import { SavedUsername, CheckResult, UsernameStatus } from '../types';
import { UsernameCard } from './UsernameCard';

interface SavedTabProps {
  savedList: SavedUsername[];
  onRemoveSaved: (username: string) => void;
  onClearAll: () => void;
  onCheckStatus: (username: string) => Promise<CheckResult>;
  onUpdateStatus?: (username: string, status: UsernameStatus) => void;
}

export const SavedTab: React.FC<SavedTabProps> = ({
  savedList,
  onRemoveSaved,
  onClearAll,
  onCheckStatus,
  onUpdateStatus,
}) => {
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'taken' | 'fragment'>('all');

  // Counters
  const availableCount = savedList.filter((s) => s.status === 'available').length;
  const takenCount = savedList.filter((s) => s.status === 'taken').length;
  const auctionCount = savedList.filter((s) => s.status === 'fragment' || s.status === 'short_premium').length;

  const filtered = savedList.filter((item) => {
    const matchesSearch = item.username.toLowerCase().includes(search.toLowerCase().trim());
    if (!matchesSearch) return false;

    if (statusFilter === 'available') return item.status === 'available';
    if (statusFilter === 'taken') return item.status === 'taken';
    if (statusFilter === 'fragment') return item.status === 'fragment' || item.status === 'short_premium';
    return true;
  });

  const handleExportTxt = () => {
    const text = savedList.map((item) => `@${item.username} - [${item.status}]`).join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `telegram_usernames_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportJson = () => {
    const data = JSON.stringify(savedList, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `telegram_usernames_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyAvailable = () => {
    const avail = savedList
      .filter((s) => s.status === 'available')
      .map((s) => `@${s.username}`)
      .join('\n');

    if (avail) {
      navigator.clipboard.writeText(avail);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleItemCheck = async (username: string) => {
    const result = await onCheckStatus(username);
    if (onUpdateStatus) {
      onUpdateStatus(username, result.status);
    }
    return result;
  };

  return (
    <div className="space-y-6">
      {/* Header Controller */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-7 shadow-xl">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Bookmark className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Избранные юзернеймы</h2>
              <p className="text-xs text-slate-400">
                Сохраненные варианты с наглядным цветовым статусом и экспортом
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleCopyAvailable}
              disabled={savedList.length === 0}
              className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/20 text-xs font-semibold transition disabled:opacity-40"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Скопировано!' : 'Скопировать свободные'}</span>
            </button>

            <button
              onClick={handleExportTxt}
              disabled={savedList.length === 0}
              className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition disabled:opacity-40"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Экспорт TXT</span>
            </button>

            <button
              onClick={handleExportJson}
              disabled={savedList.length === 0}
              className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" />
              <span>JSON</span>
            </button>

            {savedList.length > 0 && (
              <button
                onClick={onClearAll}
                className="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 transition"
                title="Очистить все"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Filter Badges & Search bar */}
        {savedList.length > 0 && (
          <div className="pt-2 border-t border-slate-800/80 space-y-3">
            {/* Status Filter Badges */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-400 font-medium flex items-center space-x-1 mr-1">
                <Filter className="w-3.5 h-3.5" />
                <span>Фильтр:</span>
              </span>

              <button
                onClick={() => setStatusFilter('all')}
                className={`px-3 py-1.5 rounded-xl font-semibold transition flex items-center space-x-1.5 ${
                  statusFilter === 'all'
                    ? 'bg-slate-700 text-white border border-slate-600'
                    : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                <span>Все</span>
                <span className="px-1.5 py-0.5 rounded-full bg-slate-900 text-slate-300 text-[10px]">
                  {savedList.length}
                </span>
              </button>

              <button
                onClick={() => setStatusFilter('available')}
                className={`px-3 py-1.5 rounded-xl font-semibold transition flex items-center space-x-1.5 ${
                  statusFilter === 'available'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-slate-800/60 text-emerald-400/70 hover:text-emerald-300 border border-slate-800'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Available</span>
                <span className="px-1.5 py-0.5 rounded-full bg-emerald-950 text-emerald-300 text-[10px] border border-emerald-800/50">
                  {availableCount}
                </span>
              </button>

              <button
                onClick={() => setStatusFilter('taken')}
                className={`px-3 py-1.5 rounded-xl font-semibold transition flex items-center space-x-1.5 ${
                  statusFilter === 'taken'
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                    : 'bg-slate-800/60 text-rose-400/70 hover:text-rose-300 border border-slate-800'
                }`}
              >
                <XCircle className="w-3.5 h-3.5 text-rose-400" />
                <span>Taken</span>
                <span className="px-1.5 py-0.5 rounded-full bg-rose-950 text-rose-300 text-[10px] border border-rose-800/50">
                  {takenCount}
                </span>
              </button>

              <button
                onClick={() => setStatusFilter('fragment')}
                className={`px-3 py-1.5 rounded-xl font-semibold transition flex items-center space-x-1.5 ${
                  statusFilter === 'fragment'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'bg-slate-800/60 text-amber-400/70 hover:text-amber-300 border border-slate-800'
                }`}
              >
                <Crown className="w-3.5 h-3.5 text-amber-400" />
                <span>Auction</span>
                <span className="px-1.5 py-0.5 rounded-full bg-amber-950 text-amber-300 text-[10px] border border-amber-800/50">
                  {auctionCount}
                </span>
              </button>
            </div>

            {/* Search Input */}
            <div className="relative">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск среди сохраненных юзернеймов..."
                className="w-full bg-slate-950 border border-slate-800 rounded-2xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
              <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
            </div>
          </div>
        )}
      </div>

      {/* Grid or Empty state */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((item) => (
            <UsernameCard
              key={item.id}
              username={item.username}
              score={item.score}
              category={item.category}
              isSaved={true}
              onToggleSave={() => onRemoveSaved(item.username)}
              onCheckStatus={handleItemCheck}
              checkResult={{
                username: item.username,
                status: item.status,
              }}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 bg-slate-900/40 rounded-3xl border border-slate-800/80">
          <Bookmark className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <h3 className="text-base font-bold text-white mb-1">
            {savedList.length === 0 ? 'Список сохраненных пуст' : 'Ничего не найдено'}
          </h3>
          <p className="text-xs text-slate-400">
            {savedList.length === 0
              ? 'Сохраняйте понравившиеся варианты в AI Поиске или Проверке, нажимая на значок закладки.'
              : 'Попробуйте изменить поисковый запрос или сбросить фильтры статуса.'}
          </p>
        </div>
      )}
    </div>
  );
};

