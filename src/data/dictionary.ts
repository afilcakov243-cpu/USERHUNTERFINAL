export const CATEGORIES = [
  { id: 'all', name: 'Все категории', icon: 'Sparkles' },
  { id: 'crypto', name: 'Crypto & TON', icon: 'Coins' },
  { id: 'short', name: 'Короткие (3-4 букв)', icon: 'Zap' },
  { id: 'vip', name: 'VIP & Elite', icon: 'Crown' },
  { id: 'tech', name: 'Tech & Dev', icon: 'Code' },
  { id: 'minimal', name: 'Минимализм & Clean', icon: 'Feather' },
  { id: 'gaming', name: 'Gaming & Cyber', icon: 'Gamepad2' },
  { id: 'brand', name: 'Бренд & Media', icon: 'Building2' },
  { id: 'dictionary', name: 'Словарные слова', icon: 'BookOpen' },
];

export const PREFIXES = ['the', 'i', 'v', 'x', 'im', 'real', 'my', 'get', 'try', 'go', 'ton', 'sol', 'ai', 'crypto', 'vip', 'pro'];
export const SUFFIXES = ['x', 'v', 'hq', 'io', 'lab', 'dev', 'app', 'net', 'bot', 'ton', 'vip', 'club', 'inc', 'one', 'zone', 'org'];
export const NOUNS = ['nova', 'pulse', 'alpha', 'nexus', 'prism', 'apex', 'vibe', 'orbit', 'flux', 'lunar', 'eth', 'byte', 'shard', 'core', 'crest', 'aura', 'zen'];

export const PATTERN_PRESETS = [
  { label: 'LLL (3 Буквы)', pattern: 'LLL', example: 'abc, xyz, ton' },
  { label: 'LLLL (4 Буквы)', pattern: 'LLLL', example: 'nova, apex, vibe' },
  { label: 'Prefix + Core (the_...)', pattern: 'prefix_core', example: 'the_alpha, v_nexus' },
  { label: 'Core + Suffix (..._hq)', pattern: 'core_suffix', example: 'crypto_hq, dev_io' },
  { label: 'X_X_X Паттерн', pattern: 'x_x_x', example: 'a_b_c, z_o_n' },
  { label: 'Повторяющиеся буквенные', pattern: 'repeat', example: 'aaaa, xvvv, zzzz' },
  { label: 'TON / Web3 Спец', pattern: 'ton_web3', example: 'ton_core, sol_bot' },
];

export const DEFAULT_BOT_CODE_JS = `// Telegram Username Checker Bot (Telegraf / Grammy / Node.js)
// Запуск: node bot.js
import { Telegraf } from 'telegraf';
import fetch from 'node-fetch';

const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN_HERE';
const bot = new Telegraf(BOT_TOKEN);

async function checkUsername(username) {
  const clean = username.replace(/^@/, '').trim().toLowerCase();
  if (clean.length < 3 || clean.length > 32) {
    return { status: 'invalid', message: '❌ Длина юзернейма должна быть от 3 до 32 символов.' };
  }

  try {
    const res = await fetch(\`https://t.me/\${clean}\`);
    const text = await res.text();
    
    const isTaken = text.includes('tgme_page_title') || text.includes('tgme_action_button');
    const isFragment = text.includes('fragment.com') || clean.length < 5;

    if (isTaken) {
      return { status: 'taken', message: \`🔴 Юзернейм @\${clean} ЗАНЯТ!\\n🔗 https://t.me/\${clean}\` };
    } else if (isFragment) {
      return { status: 'fragment', message: \`💎 Юзернейм @\${clean} на Fragment NFT или премиум!\\n🔗 https://fragment.com/username/\${clean}\` };
    } else {
      return { status: 'available', message: \`🟢 Юзернейм @\${clean} СВОБОДЕН!\\n🔗 https://t.me/\${clean}\` };
    }
  } catch (err) {
    return { status: 'error', message: '⚠️ Ошибка связи с сервером.' };
  }
}

bot.start((ctx) => {
  ctx.reply(\`👋 Привет! Я бот для поиска красивых свободных юзернеймов в Telegram.\\n\\n🔍 Напиши мне любой юзернейм (например @coolhandle) или команду:\\n/find <ключевое_слово> - сгенерировать варианты\\n/check <username> - проверить статус\`);
});

bot.command('check', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  if (!args[0]) return ctx.reply('Укажите юзернейм для проверки, например: /check alpha');
  const res = await checkUsername(args[0]);
  ctx.reply(res.message);
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return;
  const res = await checkUsername(text);
  ctx.reply(res.message);
});

bot.launch().then(() => console.log('🤖 Telegram Username Finder Bot запущен!'));
`;
