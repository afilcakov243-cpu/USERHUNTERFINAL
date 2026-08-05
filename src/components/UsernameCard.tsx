import React, { useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Bookmark,
  BookmarkCheck,
  RefreshCw,
  Crown,
  Sparkles,
  Info,
  ShieldAlert,
  ShoppingBag
} from 'lucide-react';
import { UsernameStatus, CheckResult } from '../types';

interface UsernameCardProps {
  username: string;
  score?: number;
  category?: string;
  rarity?: string;
  meaning?: string;
  estimatedValue?: string;
  checkResult?: CheckResult;
  isSaved?: boolean;
  onToggleSave?: () => void;
  onCheckStatus?: (username: string) => Promise<void>;
}

export const UsernameCard: React.FC<UsernameCardProps> = ({
  username,
  score,
  category,
  rarity,
  meaning,
  estimatedValue,
  checkResult,
  isSaved = false,
  onToggleSave,
  onCheckStatus,
}) => {
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);

  const cleanHandle = username.replace(/^@/, '').trim();
  const status: UsernameStatus = checkResult?.status || 'available';

  const handleCopy = () => {
    navigator.clipboard.writeText(`@${cleanHandle}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRecheck = async () => {
    if (!onCheckStatus || checking) return;
    setChecking(true);
    await onCheckStatus(cleanHandle);
    setChecking(false);
  };

  const renderStatusBadge = () => {
    if (checking) {
      return (
        <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 text-xs font-semibold animate-pulse border border-slate-700">
          <RefreshCw className="w-3 h-3 animate-spin text-sky-400" />
          <span>Проверка...</span>
        </span>
      );
    }

    switch (status) {
      case 'available':
        return (
          <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold border border-emerald-500/40 shadow-sm shadow-emerald-500/10">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>СВОБОДЕН</span>
          </span>
        );
      case 'taken':
        return (
          <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-rose-500/20 text-rose-300 text-xs font-bold border border-rose-500/40 shadow-sm shadow-rose-500/10">
            <span className="w-2 h-2 rounded-full bg-rose-400" />
            <span>ЗАНЯТ</span>
          </span>
        );
      case 'fragment':
        return (
          <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 text-xs font-bold border border-amber-500/40 shadow-sm shadow-amber-500/10">
            <Crown className="w-3.5 h-3.5 text-amber-400" />
            <span>FRAGMENT NFT</span>
          </span>
        );
      case 'short_premium':
        return (
          <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 text-xs font-bold border border-purple-500/40 shadow-sm shadow-purple-500/10">
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            <span>FRAGMENT TON</span>
          </span>
        );
      case 'invalid':
        return (
          <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-slate-800 text-slate-400 text-xs font-semibold border border-slate-700">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Invalid</span>
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="group relative bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-4 sm:p-5 transition-all duration-200 shadow-lg hover:shadow-sky-500/5">
      {/* Top Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center space-x-2.5">
          <span className="text-xl sm:text-2xl font-bold tracking-tight text-white font-mono group-hover:text-sky-300 transition-colors">
            @{cleanHandle}
          </span>
          {renderStatusBadge()}
        </div>

        <div className="flex items-center space-x-1.5">
          {(checkResult?.rating || score) && (() => {
            const numScore = checkResult?.rating?.score || (score ? Math.round(score / 10 * 10) / 10 : 7.0);
            const stars = checkResult?.rating?.stars || "★".repeat(Math.round(numScore)) + "☆".repeat(10 - Math.round(numScore));
            return (
              <div className="flex flex-col items-end">
                <div className="flex items-center space-x-1 px-2.5 py-1 bg-slate-950 rounded-lg border border-slate-800 text-xs font-bold text-amber-300">
                  <span className="text-amber-400 font-mono tracking-tighter">{stars}</span>
                  <span className="ml-1 text-slate-200">({numScore.toFixed(1)}/10)</span>
                </div>
                {checkResult?.rating?.label && (
                  <span className="text-[10px] text-slate-400 mt-0.5 font-medium">
                    {checkResult.rating.label}
                  </span>
                )}
              </div>
            );
          })()}

          {onToggleSave && (
            <button
              onClick={onToggleSave}
              title={isSaved ? 'Удалить из сохраненных' : 'Сохранить'}
              className={`p-2 rounded-xl transition ${
                isSaved
                  ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40'
                  : 'bg-slate-800/60 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700/50'
              }`}
            >
              {isSaved ? <BookmarkCheck className="w-4 h-4 fill-sky-400" /> : <Bookmark className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Rarity & Tags */}
      {(rarity || category || estimatedValue) && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3 text-xs">
          {rarity && (
            <span className="px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 font-medium">
              ✨ {rarity}
            </span>
          )}
          {category && (
            <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 font-medium">
              🏷️ {category}
            </span>
          )}
          {estimatedValue && (
            <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-mono font-medium">
              💎 {estimatedValue}
            </span>
          )}
        </div>
      )}

      {/* Description / Meaning */}
      {meaning && (
        <p className="text-xs text-slate-300/90 leading-relaxed bg-slate-950/40 p-2.5 rounded-xl border border-slate-800/80 mb-3">
          {meaning}
        </p>
      )}

      {/* Multi-level inspection breakdown */}
      {checkResult && (
        <div className="mb-3 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 text-[11px] space-y-1">
          <div className="font-semibold text-slate-400 uppercase tracking-wider text-[10px] mb-1 flex items-center justify-between">
            <span>🔬 Многоуровневая проверка</span>
            {checkResult.title && <span className="text-sky-400 font-normal truncate max-w-[150px]">👤 {checkResult.title}</span>}
          </div>
          <div className="grid grid-cols-2 gap-1.5 text-slate-300">
            <div className="flex items-center space-x-1 truncate">
              <span className="text-slate-500">Bot API:</span>
              <span className={status === 'available' ? 'text-emerald-400 font-medium' : 'text-slate-300'}>
                {status === 'available' ? 'Свободен' : 'Занят'}
              </span>
            </div>
            <div className="flex items-center space-x-1 truncate">
              <span className="text-slate-500">t.me Web:</span>
              <span className={status === 'available' ? 'text-emerald-400 font-medium' : 'text-slate-300'}>
                {status === 'available' ? 'Профиль ❌' : 'Профиль ✅'}
              </span>
            </div>
            <div className="flex items-center space-x-1 truncate">
              <span className="text-slate-500">Fragment:</span>
              <span className={status === 'fragment' || status === 'short_premium' ? 'text-amber-400 font-medium' : (status === 'available' ? 'text-emerald-400 font-medium' : 'text-slate-300')}>
                {status === 'fragment' || status === 'short_premium' ? 'Лот NFT' : (status === 'available' ? 'Свободен' : 'Занят')}
              </span>
            </div>
            <div className="flex items-center space-x-1 truncate">
              <span className="text-slate-500">AI Beauty:</span>
              <span className="text-amber-300 font-medium">
                {checkResult.rating ? `${checkResult.rating.score}/10` : 'Оценка OK'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Additional check notes */}
      {checkResult?.reason && (
        <p className="text-xs text-rose-400 mb-3 bg-rose-500/10 p-2 rounded-lg border border-rose-500/20">
          ⚠️ {checkResult.reason}
        </p>
      )}

      {checkResult?.fragmentDetails && (
        <p className="text-xs text-amber-300/90 mb-3 bg-amber-500/10 p-2 rounded-lg border border-amber-500/20">
          👑 {checkResult.fragmentDetails}
        </p>
      )}

      {/* Footer Action Buttons */}
      <div className="flex items-center justify-between pt-3 border-t border-slate-800/80 text-xs">
        <div className="flex items-center space-x-2">
          <button
            onClick={handleCopy}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Скопировано!' : 'Скопировать'}</span>
          </button>

          {onCheckStatus && (
            <button
              onClick={handleRecheck}
              disabled={checking}
              title="Перепроверить статус"
              className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin text-sky-400' : ''}`} />
            </button>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {cleanHandle.length < 5 || status === 'fragment' ? (
            <a
              href={`https://fragment.com/username/${cleanHandle}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center space-x-1 px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 font-medium border border-amber-500/20 transition"
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>Fragment</span>
              <ExternalLink className="w-3 h-3 opacity-60" />
            </a>
          ) : (
            <a
              href={`https://t.me/${cleanHandle}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center space-x-1 px-3 py-1.5 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 font-medium border border-sky-500/20 transition"
            >
              <span>t.me/{cleanHandle}</span>
              <ExternalLink className="w-3 h-3 opacity-60" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
};
