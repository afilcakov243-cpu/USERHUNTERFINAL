import React, { useState, useEffect } from 'react';
import {
  Bot,
  Key,
  ShieldCheck,
  Send,
  Copy,
  Check,
  Download,
  Terminal,
  Play,
  Sparkles,
  ExternalLink,
  MessageSquare,
  Zap,
  Info,
  RefreshCw
} from 'lucide-react';
import { TelegramBotInfo, CheckResult } from '../types';
import { DEFAULT_BOT_CODE_JS } from '../data/dictionary';

interface BotSetupTabProps {
  botInfo: TelegramBotInfo | null;
  setBotInfo: (info: TelegramBotInfo | null) => void;
  botToken: string;
  setBotToken: (token: string) => void;
  onCheckStatus: (username: string) => Promise<CheckResult>;
  hideTakenUsernames?: boolean;
  setHideTakenUsernames?: (val: boolean) => void;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  time: string;
}

export const BotSetupTab: React.FC<BotSetupTabProps> = ({
  botInfo,
  setBotInfo,
  botToken,
  setBotToken,
  onCheckStatus,
  hideTakenUsernames = true,
  setHideTakenUsernames,
}) => {
  const [testing, setTesting] = useState(false);
  const [startingBot, setStartingBot] = useState(false);
  const [stoppingBot, setStoppingBot] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  // Live Server Bot State
  const [isBotActive, setIsBotActive] = useState(false);
  const [liveLogs, setLiveLogs] = useState<Array<{ time: string; text: string; type: 'info' | 'success' | 'error' }>>([]);

  // Poll live bot status
  useEffect(() => {
    const fetchStatus = () => {
      fetch('/api/bot/status')
        .then((res) => res.json())
        .then((data) => {
          setIsBotActive(data.active);
          if (data.botInfo && !botInfo) setBotInfo(data.botInfo);
          if (data.logs) setLiveLogs(data.logs);
        })
        .catch(() => {});
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [botInfo, setBotInfo]);

  const handleStartLiveBot = async () => {
    if (!botToken.trim()) {
      setErrorMsg('Укажите токен бота от @BotFather');
      return;
    }
    setStartingBot(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/bot/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: botToken.trim() }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setIsBotActive(true);
        if (data.botInfo) setBotInfo(data.botInfo);
        localStorage.setItem('tg_bot_token', botToken.trim());
      } else {
        setErrorMsg(data.error || 'Не удалось запустить бота');
      }
    } catch (err: any) {
      setErrorMsg('Ошибка подключения к серверу');
    } finally {
      setStartingBot(false);
    }
  };

  const handleStopLiveBot = async () => {
    setStoppingBot(true);
    try {
      await fetch('/api/bot/stop', { method: 'POST' });
      setIsBotActive(false);
    } catch (e) {
      // ignore
    } finally {
      setStoppingBot(false);
    }
  };

  // Bot Simulator State & Wizard
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      sender: 'bot',
      text: '👋 Привет! Я умный Telegram Bot для поиска свободных и редких юзернеймов.\n\nНажмите «🔍 Поиск юзернеймов» ниже, чтобы выбрать тип поиска и запустить мастер подбора!',
      time: '12:00',
    },
  ]);
  const [inputMsg, setInputMsg] = useState('');
  const [simulating, setSimulating] = useState(false);
  const [wizardState, setWizardState] = useState<{
    step: number;
    searchType?: 'standard' | 'fragment';
    style?: string;
    length?: number;
  }>({ step: 0 });

  const handleTestToken = async () => {
    if (!botToken.trim()) return;
    setTesting(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/bot/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: botToken.trim() }),
      });

      const data = await res.json();
      if (res.ok && data.success && data.bot) {
        setBotInfo(data.bot);
        localStorage.setItem('tg_bot_token', botToken.trim());
      } else {
        setErrorMsg(data.error || 'Неверный токен Telegram бота');
      }
    } catch (err: any) {
      setErrorMsg('Ошибка подключения к серверу');
    } finally {
      setTesting(false);
    }
  };

  const addBotReply = (text: string) => {
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setChatMessages((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        sender: 'bot',
        text,
        time: now,
      },
    ]);
  };

  const handleStartSearchWizard = () => {
    setWizardState({ step: 0 });
    addBotReply('🔍 Выберите тип поиска:\n\n• Стандартный поиск — находит только полностью свободные никнеймы для бесплатной регистрации.\n• Мониторинг Fragment (до $300) — ищет редкие логины и аукционы Fragment NFT в пределах бюджета до $300 (~215 TON).');
  };

  const handleSelectSearchType = (searchType: 'standard' | 'fragment') => {
    setWizardState({ step: 1, searchType });
    const typeLabel = searchType === 'standard' ? '🔍 Стандартный поиск' : '💎 Мониторинг Fragment (до $300)';
    addBotReply(`⚙️ Шаг 1 из 3: Выберите стиль юзернеймов\n\n• Режим: ${typeLabel}\n\n1. 🔤 Только буквы (nova)\n2. 🔢 Буквы и цифры (n5v1)\n3. ⚡ Стиль / Leetspeak (n0va)`);
  };

  const handleSelectWizardStyle = (style: string) => {
    setWizardState((prev) => ({ ...prev, step: 2, style }));
    const styleName = style === 'letters' ? 'Только буквы' : style === 'alphanumeric' ? 'Буквы и цифры' : 'Стиль / Leetspeak';
    addBotReply(`⚙️ Шаг 2 из 3: Выберите количество символов\n\n• Выбран стиль: ${styleName}\n\nВыберите длину:\n• 5 символов\n• 6 символов\n• 7 символов`);
  };

  const handleSelectWizardLength = (length: number) => {
    setWizardState((prev) => ({ ...prev, step: 3, length }));
    addBotReply(`⚙️ Шаг 3 из 3: Количество никнеймов за 1 поиск\n\nСколько юзернеймов найти?\n• 1 никнейм\n• 2 никнейма\n• 3 никнейма`);
  };

  const handleExecuteWizardSearch = async (count: number) => {
    const searchType = wizardState.searchType || 'standard';
    const style = wizardState.style || 'letters';
    const length = wizardState.length || 5;

    setWizardState({ step: 0 });
    setSimulating(true);

    const typeLabel = searchType === 'standard' ? '🔍 Стандартный поиск (Свободные)' : '💎 Мониторинг Fragment (NFT)';
    const styleName = style === 'letters' ? 'Только буквы' : style === 'alphanumeric' ? 'Буквы и цифры' : 'Стиль / Leetspeak';

    addBotReply(`⏳ Ищем ${count} никнейм(а) по параметрам:\n• Режим: ${typeLabel}\n• Стиль: ${styleName}\n• Длина: ${length} символов\n\nПроверяем регистрацию...`);

    try {
      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: style, count: 12 }),
      });
      const data = await res.json();
      const rawList = data.usernames || [];

      const results: Array<{ username: string; status: string; meaning: string }> = [];
      const checkedSet = new Set<string>();

      // 1. Check AI candidates in parallel
      const aiItemsToTest = rawList
        .map((item: any) => ({
          name: item.username ? item.username.toLowerCase().replace(/[^a-z0-9_]/g, '') : '',
          meaning: item.meaning || 'Эстетичный логин',
        }))
        .filter((i: any) => i.name.length === length);

      if (aiItemsToTest.length > 0) {
        const checks = await Promise.all(aiItemsToTest.map((i: any) => onCheckStatus(i.name)));
        for (let idx = 0; idx < aiItemsToTest.length; idx++) {
          if (results.length >= count) break;
          const item = aiItemsToTest[idx];
          const check = checks[idx];
          checkedSet.add(item.name);

          if (searchType === 'standard') {
            if (check.status === 'available') {
              results.push({ username: item.name, status: check.status, meaning: item.meaning });
            }
          } else {
            if (check.status === 'fragment' || check.status === 'short_premium' || check.status === 'available') {
              results.push({ username: item.name, status: check.status, meaning: item.meaning });
            }
          }
        }
      }

      // 2. Parallel Algorithmic Loop if needed
      const vowels = ['a', 'e', 'i', 'o', 'u', 'y'];
      const consonants = ['b', 'c', 'd', 'f', 'g', 'h', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'x', 'z'];
      const leetMap: Record<string, string> = { o: '0', e: '3', i: '1', a: '4', s: '5', t: '7' };

      let maxBatches = 10;
      while (results.length < count && maxBatches > 0) {
        maxBatches--;

        const candidateBatch: string[] = [];
        while (candidateBatch.length < 8) {
          let candidate = '';
          if (style === 'letters') {
            let useConsonant = Math.random() > 0.3;
            for (let j = 0; j < length; j++) {
              candidate += useConsonant
                ? consonants[Math.floor(Math.random() * consonants.length)]
                : vowels[Math.floor(Math.random() * vowels.length)];
              useConsonant = !useConsonant;
            }
          } else if (style === 'alphanumeric') {
            let useConsonant = Math.random() > 0.3;
            for (let j = 0; j < length - 1; j++) {
              candidate += useConsonant
                ? consonants[Math.floor(Math.random() * consonants.length)]
                : vowels[Math.floor(Math.random() * vowels.length)];
              useConsonant = !useConsonant;
            }
            candidate += Math.floor(Math.random() * 10).toString();
          } else {
            let useConsonant = Math.random() > 0.3;
            for (let j = 0; j < length; j++) {
              let char = useConsonant
                ? consonants[Math.floor(Math.random() * consonants.length)]
                : vowels[Math.floor(Math.random() * vowels.length)];
              if (leetMap[char] && Math.random() > 0.3) char = leetMap[char];
              candidate += char;
              useConsonant = !useConsonant;
            }
          }

          if (!checkedSet.has(candidate) && candidate.length === length) {
            checkedSet.add(candidate);
            candidateBatch.push(candidate);
          }
        }

        const checks = await Promise.all(candidateBatch.map((name) => onCheckStatus(name)));

        for (let i = 0; i < candidateBatch.length; i++) {
          if (results.length >= count) break;
          const check = checks[i];
          const name = candidateBatch[i];

          if (searchType === 'standard') {
            if (check.status === 'available') {
              results.push({ username: name, status: check.status, meaning: 'Свободный никнейм' });
            }
          } else {
            if (check.status === 'fragment' || check.status === 'short_premium' || check.status === 'available') {
              results.push({ username: name, status: check.status, meaning: 'Fragment / Редкий логин' });
            }
          }
        }
      }

      let replyMsg = `🎯 Результаты поиска [${typeLabel}]:\n\n`;
      results.forEach((r, idx) => {
        const icon = r.status === 'available' ? '🟢 СВОБОДЕН' : r.status === 'fragment' ? '💎 FRAGMENT NFT' : '🔴 ЗАНЯТ';
        replyMsg += `${idx + 1}. @${r.username} — ${icon}\n   • ${r.meaning || 'Логин'} (https://t.me/${r.username})\n\n`;
      });

      addBotReply(replyMsg);
    } catch (err) {
      addBotReply('⚠️ Ошибка генерирования юзернеймов.');
    } finally {
      setSimulating(false);
    }
  };

  const handleShowProfile = () => {
    addBotReply('👤 Ваш Профиль:\n\n• ID: 12345678\n• Тариф: ⚡ Базовый (Бесплатный)\n• Выполнено поисков: 12\n\n(Раздел профиля находится в разработке)');
  };

  const handleShowPremium = () => {
    addBotReply('💎 Премиум подписка (Скоро):\n\n• Поиск 4-символьных редких логинов\n• Авто-мониторинг освобождения 24/7\n• Безлимитная AI генерация');
  };

  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMsg.trim() || simulating) return;

    const userText = inputMsg.trim();
    setInputMsg('');

    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMsgObj: ChatMessage = {
      id: Date.now().toString(),
      sender: 'user',
      text: userText,
      time: now,
    };

    setChatMessages((prev) => [...prev, userMsgObj]);
    setSimulating(true);

    try {
      if (userText.startsWith('/start') || userText === '🔍 Поиск юзернеймов') {
        handleStartSearchWizard();
      } else if (userText === '👤 Профиль') {
        handleShowProfile();
      } else if (userText === '💎 Премиум') {
        handleShowPremium();
      } else {
        // Treat as username check
        const clean = userText.replace(/^(https?:\/\/t\.me\/|@|\/check\s*)/, '').trim();
        const check = await onCheckStatus(clean);

        let botReply = '';
        if (check.status === 'available') {
          botReply = `🟢 Юзернейм @${clean} СВОБОДЕН!\n\n🔗 Зарегистрировать: https://t.me/${clean}`;
        } else if (check.status === 'fragment' || check.status === 'short_premium') {
          botReply = `💎 Юзернейм @${clean} на Fragment NFT!\n\n🔗 Смотреть на Fragment: https://fragment.com/username/${clean}`;
        } else if (check.status === 'taken') {
          botReply = `🔴 Юзернейм @${clean} ЗАНЯТ!\n\n🔗 Открыть профиль: https://t.me/${clean}`;
        } else {
          botReply = `⚠️ Юзернейм @${clean} невалиден (${check.reason || 'неверный формат'}).`;
        }

        addBotReply(botReply);
      }
    } catch (err) {
      addBotReply('⚠️ Ошибка при выполнении запроса.');
    } finally {
      setSimulating(false);
    }
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(DEFAULT_BOT_CODE_JS);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleDownloadCode = () => {
    const blob = new Blob([DEFAULT_BOT_CODE_JS], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'username_finder_bot.js';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Bot Token Config Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-7 shadow-xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Интеграция с Telegram Ботом</h2>
              <p className="text-xs text-slate-400">
                Подключите ваш токен от @BotFather для управления ботом и проверки статуса
              </p>
            </div>
          </div>

          {botInfo && (
            <div className="flex items-center space-x-2 px-3.5 py-1.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
              <ShieldCheck className="w-4 h-4" />
              <span>
                @{botInfo.username} ({botInfo.first_name})
              </span>
            </div>
          )}
        </div>

        {/* Token Input and Live Server Control */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Токен бота от @BotFather (HTTP API Token)
            </label>
            <div className="relative">
              <input
                type="password"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz..."
                className="w-full bg-slate-950 border border-slate-800 focus:border-sky-500 rounded-2xl pl-10 pr-36 py-3.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/20 font-mono transition"
              />
              <Key className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />

              <button
                onClick={handleTestToken}
                disabled={testing || !botToken.trim()}
                className="absolute right-2 top-2 bottom-2 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center space-x-1.5 transition disabled:opacity-50"
              >
                {testing ? (
                  <span>Проверка...</span>
                ) : (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
                    <span>Проверить токен</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Action Row: Start 24/7 Live Bot in Server */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-950 p-4 rounded-2xl border border-slate-800">
            <div className="flex items-center space-x-3">
              <div
                className={`w-3 h-3 rounded-full ${
                  isBotActive ? 'bg-emerald-400 animate-ping' : 'bg-slate-600'
                }`}
              />
              <div>
                <div className="text-xs font-bold text-white flex items-center gap-2">
                  <span>Статус Сервера:</span>
                  <span className={isBotActive ? 'text-emerald-400' : 'text-slate-400'}>
                    {isBotActive ? '🟢 БОТ АКТИВЕН В TELEGRAM (24/7)' : '⚪ БОТ ОСТАНОВЛЕН'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  {isBotActive
                    ? 'Бот непрерывно обрабатывает сообщения от пользователей прямо в Telegram.'
                    : 'Запустите бота, чтобы пользователи могли отправлять запросы прямо в чат Telegram!'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {isBotActive ? (
                <>
                  {botInfo && (
                    <a
                      href={`https://t.me/${botInfo.username}`}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3.5 py-2 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/20 text-xs font-bold flex items-center space-x-1.5 transition"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Открыть @{botInfo.username}</span>
                    </a>
                  )}

                  <button
                    onClick={handleStartLiveBot}
                    disabled={startingBot || !botToken.trim()}
                    className="px-3.5 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 text-xs font-bold flex items-center space-x-1 transition disabled:opacity-50"
                    title="Применить новый токен и перезапустить бота"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${startingBot ? 'animate-spin' : ''}`} />
                    <span>🔄 Сменить токен / Перезапустить</span>
                  </button>

                  <button
                    onClick={handleStopLiveBot}
                    disabled={stoppingBot}
                    className="px-3.5 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-xs font-bold transition disabled:opacity-50"
                  >
                    {stoppingBot ? 'Остановка...' : '🛑 Остановить'}
                  </button>
                </>
              ) : (
                <button
                  onClick={handleStartLiveBot}
                  disabled={startingBot || !botToken.trim()}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white text-xs font-bold flex items-center justify-center space-x-2 shadow-lg shadow-sky-500/20 transition disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>{startingBot ? 'Запуск...' : '🚀 ЗАПУСТИТЬ ЛАЙВ-БОТА 24/7'}</span>
                </button>
              )}
            </div>
          </div>

          {errorMsg && (
            <p className="text-xs text-rose-400 bg-rose-500/10 p-2.5 rounded-xl border border-rose-500/20">
              ⚠️ {errorMsg}
            </p>
          )}

          {/* Live Logs Console */}
          {liveLogs.length > 0 && (
            <div className="mt-3 bg-slate-950 p-3.5 rounded-2xl border border-slate-800">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-300 mb-2">
                <span className="flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-sky-400" />
                  <span>Логи событий Telegram Бота в реальном времени</span>
                </span>
                <span className="text-[10px] text-slate-500">Автообновление</span>
              </div>
              <div className="max-h-32 overflow-y-auto space-y-1 font-mono text-[11px] scrollbar-thin">
                {liveLogs.map((log, index) => (
                  <div key={index} className="flex items-start space-x-2">
                    <span className="text-slate-500">{log.time}</span>
                    <span
                      className={
                        log.type === 'success'
                          ? 'text-emerald-400 font-semibold'
                          : log.type === 'error'
                          ? 'text-rose-400 font-semibold'
                          : 'text-slate-300'
                      }
                    >
                      {log.text}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[11px] text-slate-500">
            💡 После нажатия «Запустить лайв-бота», приложение в фоновом режиме принимает сообщения пользователей из Telegram и отвечает им мгновенно!
          </p>
        </div>
      </div>

      {/* Grid: Bot Chat Simulator & Code Kit */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chat Simulator */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 flex flex-col h-[520px] shadow-xl">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-full bg-sky-500 flex items-center justify-center text-white text-xs font-bold">
                <Bot className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-white text-sm">
                  {botInfo ? `@${botInfo.username}` : 'Симулятор Telegram Бота'}
                </h3>
                <span className="text-[10px] text-emerald-400 font-medium">● Онлайн</span>
              </div>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
              Интерактивный тест
            </span>
          </div>

          {/* Messages Feed */}
          <div className="flex-1 overflow-y-auto space-y-3 p-2 scrollbar-thin scrollbar-thumb-slate-800">
            {chatMessages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] p-3 rounded-2xl text-xs leading-relaxed whitespace-pre-wrap ${
                    msg.sender === 'user'
                      ? 'bg-sky-500 text-white rounded-br-none shadow-md'
                      : 'bg-slate-950 text-slate-200 border border-slate-800 rounded-bl-none'
                  }`}
                >
                  <p>{msg.text}</p>
                  <span
                    className={`block text-[9px] mt-1 text-right ${
                      msg.sender === 'user' ? 'text-sky-100' : 'text-slate-500'
                    }`}
                  >
                    {msg.time}
                  </span>
                </div>
              </div>
            ))}

            {/* Interactive Step Buttons in Chat */}
            {wizardState.step === 0 && chatMessages.length > 1 && chatMessages[chatMessages.length - 1].text.includes('Выберите тип поиска') && (
              <div className="p-2 bg-slate-950/80 rounded-2xl border border-sky-500/30 space-y-2">
                <div className="text-[11px] font-bold text-sky-400">Выберите тип поиска:</div>
                <div className="flex flex-col gap-1.5">
                  <button
                    onClick={() => handleSelectSearchType('standard')}
                    className="w-full text-left px-3 py-2 rounded-xl bg-slate-900 hover:bg-sky-500/20 text-xs font-medium text-white border border-slate-800 transition flex items-center justify-between"
                  >
                    <span>🔍 Стандартный поиск</span>
                    <span className="text-[10px] text-emerald-400 bg-emerald-950/80 border border-emerald-800/50 px-1.5 py-0.5 rounded">Свободные</span>
                  </button>
                  <button
                    onClick={() => handleSelectSearchType('fragment')}
                    className="w-full text-left px-3 py-2 rounded-xl bg-slate-900 hover:bg-sky-500/20 text-xs font-medium text-white border border-slate-800 transition flex items-center justify-between"
                  >
                    <span>💎 Мониторинг Fragment (до $300)</span>
                    <span className="text-[10px] text-sky-400 bg-sky-950/80 border border-sky-800/50 px-1.5 py-0.5 rounded">До $300 / NFT</span>
                  </button>
                </div>
              </div>
            )}

            {wizardState.step === 1 && (
              <div className="p-2 bg-slate-950/80 rounded-2xl border border-sky-500/30 space-y-2">
                <div className="text-[11px] font-bold text-sky-400">
                  Шаг 1 из 3: Выберите стиль ({wizardState.searchType === 'standard' ? 'Стандартный' : 'Fragment'})
                </div>
                <div className="flex flex-col gap-1.5">
                  <button
                    onClick={() => handleSelectWizardStyle('letters')}
                    className="w-full text-left px-3 py-2 rounded-xl bg-slate-900 hover:bg-sky-500/20 text-xs font-medium text-white border border-slate-800 transition"
                  >
                    🔤 Только буквы (nova)
                  </button>
                  <button
                    onClick={() => handleSelectWizardStyle('alphanumeric')}
                    className="w-full text-left px-3 py-2 rounded-xl bg-slate-900 hover:bg-sky-500/20 text-xs font-medium text-white border border-slate-800 transition"
                  >
                    🔢 Буквы и цифры (n5v1)
                  </button>
                  <button
                    onClick={() => handleSelectWizardStyle('stylized')}
                    className="w-full text-left px-3 py-2 rounded-xl bg-slate-900 hover:bg-sky-500/20 text-xs font-medium text-white border border-slate-800 transition"
                  >
                    ⚡ Стиль / Leetspeak (n0va)
                  </button>
                </div>
              </div>
            )}

            {wizardState.step === 2 && (
              <div className="p-2 bg-slate-950/80 rounded-2xl border border-sky-500/30 space-y-2">
                <div className="text-[11px] font-bold text-sky-400">Шаг 2 из 3: Выберите количество символов</div>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    onClick={() => handleSelectWizardLength(5)}
                    className="px-2 py-2 rounded-xl bg-slate-900 hover:bg-sky-500/20 text-xs font-bold text-white border border-slate-800 transition text-center"
                  >
                    5️⃣ 5 симв.
                  </button>
                  <button
                    onClick={() => handleSelectWizardLength(6)}
                    className="px-2 py-2 rounded-xl bg-slate-900 hover:bg-sky-500/20 text-xs font-bold text-white border border-slate-800 transition text-center"
                  >
                    6️⃣ 6 симв.
                  </button>
                  <button
                    onClick={() => handleSelectWizardLength(7)}
                    className="px-2 py-2 rounded-xl bg-slate-900 hover:bg-sky-500/20 text-xs font-bold text-white border border-slate-800 transition text-center"
                  >
                    7️⃣ 7 симв.
                  </button>
                </div>
              </div>
            )}

            {wizardState.step === 3 && (
              <div className="p-2 bg-slate-950/80 rounded-2xl border border-sky-500/30 space-y-2">
                <div className="text-[11px] font-bold text-sky-400">Шаг 3 из 3: Сколько никнеймов найти за 1 поиск?</div>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    onClick={() => handleExecuteWizardSearch(1)}
                    className="px-2 py-2 rounded-xl bg-slate-900 hover:bg-sky-500/20 text-xs font-bold text-white border border-slate-800 transition text-center"
                  >
                    1️⃣ 1 шт.
                  </button>
                  <button
                    onClick={() => handleExecuteWizardSearch(2)}
                    className="px-2 py-2 rounded-xl bg-slate-900 hover:bg-sky-500/20 text-xs font-bold text-white border border-slate-800 transition text-center"
                  >
                    2️⃣ 2 шт.
                  </button>
                  <button
                    onClick={() => handleExecuteWizardSearch(3)}
                    className="px-2 py-2 rounded-xl bg-slate-900 hover:bg-sky-500/20 text-xs font-bold text-white border border-slate-800 transition text-center"
                  >
                    3️⃣ 3 шт.
                  </button>
                </div>
              </div>
            )}

            {simulating && (
              <div className="flex justify-start">
                <div className="bg-slate-950 p-3 rounded-2xl text-xs text-sky-400 animate-pulse border border-slate-800">
                  <span>Бот генерирует варианты и проверяет регистрацию...</span>
                </div>
              </div>
            )}
          </div>

          {/* Quick Menu Buttons Bar */}
          <div className="pt-2 pb-1 border-t border-slate-800/80 grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={handleStartSearchWizard}
              className="px-2 py-1.5 rounded-xl bg-slate-950 hover:bg-sky-500/10 text-sky-400 border border-slate-800 text-[11px] font-bold transition flex items-center justify-center gap-1"
            >
              <span>🔍 Поиск</span>
            </button>
            <button
              type="button"
              onClick={handleShowProfile}
              className="px-2 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 text-[11px] font-bold transition flex items-center justify-center gap-1"
            >
              <span>👤 Профиль</span>
            </button>
            <button
              type="button"
              onClick={handleShowPremium}
              className="px-2 py-1.5 rounded-xl bg-slate-950 hover:bg-amber-500/10 text-amber-400 border border-slate-800 text-[11px] font-bold transition flex items-center justify-center gap-1"
            >
              <span>💎 Премиум</span>
            </button>
          </div>

          {/* Chat Input */}
          <form onSubmit={handleSendChatMessage} className="pt-3 border-t border-slate-800 flex gap-2">
            <input
              type="text"
              value={inputMsg}
              onChange={(e) => setInputMsg(e.target.value)}
              placeholder="Напишите юзернейм или /find crypto..."
              className="flex-1 bg-slate-950 border border-slate-800 focus:border-sky-500 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={simulating || !inputMsg.trim()}
              className="px-4 bg-sky-500 hover:bg-sky-400 text-white rounded-xl font-bold flex items-center justify-center transition disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>

        {/* Ready Bot Source Code Kit */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 flex flex-col shadow-xl">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
            <div className="flex items-center space-x-2">
              <Terminal className="w-4 h-4 text-sky-400" />
              <h3 className="font-bold text-white text-sm">Исходный код для запуск бота 24/7</h3>
            </div>

            <div className="flex items-center space-x-1.5">
              <button
                onClick={handleCopyCode}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center space-x-1 transition"
              >
                {copiedCode ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copiedCode ? 'Скопировано' : 'Код'}</span>
              </button>

              <button
                onClick={handleDownloadCode}
                className="px-2.5 py-1 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 text-xs font-medium flex items-center space-x-1 border border-sky-500/30 transition"
              >
                <Download className="w-3 h-3" />
                <span>bot.js</span>
              </button>
            </div>
          </div>

          <p className="text-xs text-slate-400 mb-2">
            Готовый скрипт на Node.js (Telegraf) для размещения вашего бота на сервер VPS / Cloud Run / Railway:
          </p>

          <pre className="flex-1 bg-slate-950 p-3.5 rounded-2xl border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto overflow-y-auto max-h-[360px] scrollbar-thin">
            {DEFAULT_BOT_CODE_JS}
          </pre>

          {/* Quick Setup Instructions */}
          <div className="mt-3 p-3 bg-slate-950 rounded-2xl border border-slate-800 text-[11px] text-slate-400 space-y-1">
            <div className="font-bold text-slate-200">🚀 Быстрый старт за 3 шага:</div>
            <div>1. Создайте бота в <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-sky-400 underline">@BotFather</a> и скопируйте токен.</div>
            <div>2. Выполните на сервере: <code className="bg-slate-900 px-1 py-0.5 rounded text-sky-300">npm install telegraf node-fetch</code></div>
            <div>3. Запустите: <code className="bg-slate-900 px-1 py-0.5 rounded text-sky-300">BOT_TOKEN="ваш_токен" node bot.js</code></div>
          </div>
        </div>
      </div>
    </div>
  );
};
