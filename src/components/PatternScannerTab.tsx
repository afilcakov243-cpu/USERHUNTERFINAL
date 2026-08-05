import React, { useState } from 'react';
import { SlidersHorizontal, RefreshCw, Zap, Sparkles, Filter, ShieldCheck, Check } from 'lucide-react';
import { CheckResult, SavedUsername } from '../types';
import { PATTERN_PRESETS, PREFIXES, SUFFIXES, NOUNS } from '../data/dictionary';
import { UsernameCard } from './UsernameCard';

interface PatternScannerTabProps {
  savedList: SavedUsername[];
  onToggleSave: (item: { username: string }) => void;
  onCheckStatus: (username: string) => Promise<CheckResult>;
  hideTakenUsernames?: boolean;
  setHideTakenUsernames?: (val: boolean) => void;
}

export const PatternScannerTab: React.FC<PatternScannerTabProps> = ({
  savedList,
  onToggleSave,
  onCheckStatus,
  hideTakenUsernames = true,
  setHideTakenUsernames,
}) => {
  const [selectedPreset, setSelectedPreset] = useState('LLLL');
  const [customPattern, setCustomPattern] = useState('v_???');
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [resultsMap, setResultsMap] = useState<Record<string, CheckResult>>({});

  const generateCandidates = () => {
    const list: string[] = [];

    const letters = 'abcdefghijklmnopqrstuvwxyz';

    const getRandomLetter = () => letters[Math.floor(Math.random() * letters.length)];

    for (let i = 0; i < 16; i++) {
      let handle = '';

      if (selectedPreset === 'LLL') {
        handle = getRandomLetter() + getRandomLetter() + getRandomLetter();
      } else if (selectedPreset === 'LLLL') {
        handle = getRandomLetter() + getRandomLetter() + getRandomLetter() + getRandomLetter();
      } else if (selectedPreset === 'prefix_core') {
        const pre = PREFIXES[Math.floor(Math.random() * PREFIXES.length)];
        const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
        handle = `${pre}_${noun}`;
      } else if (selectedPreset === 'core_suffix') {
        const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
        const suf = SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)];
        handle = `${noun}_${suf}`;
      } else if (selectedPreset === 'x_x_x') {
        handle = `${getRandomLetter()}_${getRandomLetter()}_${getRandomLetter()}`;
      } else if (selectedPreset === 'repeat') {
        const l1 = getRandomLetter();
        const l2 = getRandomLetter();
        handle = `${l1}${l1}${l1}${l2}`;
      } else if (selectedPreset === 'ton_web3') {
        const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
        handle = Math.random() > 0.5 ? `ton_${noun}` : `${noun}_ton`;
      } else {
        // Custom pattern wildcard '?'
        handle = customPattern.replace(/\?/g, () => getRandomLetter());
      }

      if (!list.includes(handle)) {
        list.push(handle);
      }
    }

    return list;
  };

  const handleScan = async () => {
    setLoading(true);
    const generated = generateCandidates();
    setCandidates(generated);

    try {
      const res = await fetch('/api/check-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernames: generated }),
      });

      const data = await res.json();
      if (data.results && Array.isArray(data.results)) {
        const map: Record<string, CheckResult> = {};
        data.results.forEach((r: CheckResult) => {
          map[r.username.toLowerCase()] = r;
        });
        setResultsMap(map);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Scanner Control Box */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-7 shadow-xl">
        <div className="flex items-center space-x-3 mb-4">
          <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <SlidersHorizontal className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Сканер паттернов (5-10 символов) и матрицы юзернеймов</h2>
            <p className="text-xs text-slate-400">
              Генерация и автопроверка комбинаций по шаблонам и маскам в пределах от 5 до 10 символов
            </p>
          </div>
        </div>

        {/* Presets Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-5">
          {PATTERN_PRESETS.map((p) => (
            <button
              key={p.pattern}
              onClick={() => setSelectedPreset(p.pattern)}
              className={`p-3 rounded-2xl border text-left transition ${
                selectedPreset === p.pattern
                  ? 'bg-indigo-500/15 border-indigo-500/50 text-indigo-200'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
              }`}
            >
              <div className="text-xs font-bold mb-0.5">{p.label}</div>
              <div className="text-[10px] text-slate-500 font-mono">Пример: {p.example}</div>
            </button>
          ))}
        </div>

        {/* Custom Wildcard Input if Custom selected */}
        {selectedPreset === 'custom' && (
          <div className="mb-4">
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Свой шаблон в пределах от 5 до 10 символов (используйте '?' как случайную букву)
            </label>
            <input
              type="text"
              value={customPattern}
              onChange={(e) => setCustomPattern(e.target.value)}
              placeholder="например: d?br?, cyber??? или my_name_??"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>
        )}

        {/* Scan Action */}
        <button
          onClick={handleScan}
          disabled={loading}
          className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-indigo-500 to-sky-500 hover:from-indigo-400 hover:to-sky-400 text-white font-bold text-sm flex items-center justify-center space-x-2 transition shadow-lg shadow-indigo-500/20 disabled:opacity-50"
        >
          {loading ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Сканируем Telegram & Fragment (до $300)...</span>
            </>
          ) : (
            <>
              <Zap className="w-4 h-4 fill-white" />
              <span>Сгенерировать и проверить комбинации</span>
            </>
          )}
        </button>
      </div>

      {/* Results */}
      {candidates.length > 0 && (() => {
        const visibleCandidates = candidates.filter((handle) => {
          const clean = handle.toLowerCase();
          const checkResult = resultsMap[clean];
          if (hideTakenUsernames && checkResult?.status === 'taken') {
            return false;
          }
          return true;
        });

        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between bg-slate-900/60 p-4 rounded-2xl border border-slate-800 text-xs">
              <div className="flex items-center space-x-2">
                <span className="font-bold text-white text-sm">
                  Отображается кандидатов: {visibleCandidates.length}
                </span>
                {hideTakenUsernames && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px] font-semibold">
                    🛡️ Занятые скрыты
                  </span>
                )}
              </div>
              <span className="text-slate-400">
                🟢 Свободных: {Object.values(resultsMap).filter((r: any) => r?.status === 'available').length}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {visibleCandidates.map((handle) => {
                const clean = handle.toLowerCase();
                const checkResult = resultsMap[clean];
                const isSaved = savedList.some(
                  (s) => s.username.toLowerCase() === clean
                );

                return (
                  <UsernameCard
                    key={clean}
                    username={clean}
                    checkResult={checkResult}
                    isSaved={isSaved}
                    onToggleSave={() => onToggleSave({ username: clean })}
                    onCheckStatus={async (u) => {
                      const res = await onCheckStatus(u);
                      setResultsMap((prev) => ({ ...prev, [u.toLowerCase()]: res }));
                    }}
                  />
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
  );
};
