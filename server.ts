import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { GoogleGenAI, Type } from "@google/genai";
import { HttpsProxyAgent } from "https-proxy-agent";

// Anti-IP-Block & Stealth Request Engine
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
];

const LANGS = [
  "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
  "en-US,en;q=0.9,ru;q=0.8",
  "ru,en-US;q=0.9,en;q=0.8",
];

function getRandomHeaders() {
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  const lang = LANGS[Math.floor(Math.random() * LANGS.length)];
  return {
    "User-Agent": ua,
    "Accept-Language": lang,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Cache-Control": "max-age=0",
    "Sec-Ch-Ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  };
}

let circuitBreakerUntil = 0;

function isCircuitBreakerActive() {
  return Date.now() < circuitBreakerUntil;
}

function triggerCircuitBreaker(seconds = 2) {
  circuitBreakerUntil = Date.now() + seconds * 1000;
  console.warn(`[ANTI-BLOCK] Circuit breaker active for ${seconds}s due to rate limits (429/403)`);
}

// Global active request concurrency controller (Limits concurrent outbound checks to max 12)
let activeRequestsCount = 0;
const MAX_CONCURRENT_FETCHES = 12;

async function acquireFetchSlot(): Promise<void> {
  while (activeRequestsCount >= MAX_CONCURRENT_FETCHES) {
    await new Promise((r) => setTimeout(r, 20));
  }
  activeRequestsCount++;
}

function releaseFetchSlot(): void {
  activeRequestsCount = Math.max(0, activeRequestsCount - 1);
}

// Proxy configuration if set in environment
const PROXY_URL = process.env.PROXY_URL || process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
let proxyAgentInstance: HttpsProxyAgent<string> | null = null;
if (PROXY_URL) {
  try {
    proxyAgentInstance = new HttpsProxyAgent(PROXY_URL);
    console.log("[ANTI-BLOCK] Proxy agent initialized successfully with PROXY_URL");
  } catch (e) {
    console.error("[ANTI-BLOCK] Failed to initialize proxy agent:", e);
  }
}

async function fetchWithAntiBlock(url: string, signal?: AbortSignal): Promise<Response | null> {
  if (isCircuitBreakerActive()) {
    return null;
  }

  await acquireFetchSlot();

  // Micro-delay (jitter 0-10ms)
  await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 10)));

  try {
    const fetchOptions: any = {
      headers: getRandomHeaders(),
      signal,
    };

    if (proxyAgentInstance) {
      fetchOptions.agent = proxyAgentInstance;
    }

    const res = await fetch(url, fetchOptions);

    if (res.status === 429 || res.status === 403) {
      triggerCircuitBreaker(10);
      return null;
    }

    return res;
  } catch (e) {
    return null;
  } finally {
    releaseFetchSlot();
  }
}

const safeFilename = typeof __filename !== "undefined" 
  ? __filename 
  : path.join(process.cwd(), "server.ts");
const safeDirname = typeof __dirname !== "undefined" 
  ? __dirname 
  : path.dirname(safeFilename);

function getWritableDataDir(): string {
  const envDir = process.env.DATA_DIR;
  if (envDir) {
    try {
      if (!fs.existsSync(envDir)) fs.mkdirSync(envDir, { recursive: true });
      fs.accessSync(envDir, fs.constants.W_OK);
      return envDir;
    } catch (e) {
      console.warn(`[STORAGE] Configured DATA_DIR ${envDir} is not writable, falling back...`);
    }
  }

  if (fs.existsSync("/data")) {
    try {
      fs.accessSync("/data", fs.constants.W_OK);
      return "/data";
    } catch (e) {
      console.warn("[STORAGE] /data directory exists but is not writable, falling back to process.cwd()");
    }
  }

  return process.cwd();
}

const DATA_DIR = getWritableDataDir();
const BOT_CONFIG_FILE = path.join(DATA_DIR, "bot_config.json");

interface SavedBotConfig {
  token: string;
  mode: "polling" | "webhook";
  webhookUrl?: string;
}

function saveBotConfig(config: SavedBotConfig) {
  try {
    fs.writeFileSync(BOT_CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save bot_config.json:", e);
  }
}

function loadBotConfig(): SavedBotConfig | null {
  try {
    if (fs.existsSync(BOT_CONFIG_FILE)) {
      const data = fs.readFileSync(BOT_CONFIG_FILE, "utf8");
      return JSON.parse(data);
    }
  } catch (e) {
    console.error("Failed to load bot_config.json:", e);
  }
  return null;
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;

process.on("unhandledRejection", (reason, promise) => {
  console.error("⚠️ [SERVER] Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("⚠️ [SERVER] Uncaught Exception:", err);
});

process.on("SIGTERM", () => {
  console.log("🛑 [SERVER] Received SIGTERM signal. Shutting down...");
  if (activeBot) {
    try {
      activeBot.stop("SIGTERM");
    } catch (e) {}
  }
  setTimeout(() => process.exit(0), 500);
});

process.on("SIGINT", () => {
  console.log("🛑 [SERVER] Received SIGINT signal. Shutting down...");
  if (activeBot) {
    try {
      activeBot.stop("SIGINT");
    } catch (e) {}
  }
  setTimeout(() => process.exit(0), 500);
});

app.use(express.json());

// Health check endpoints for Amvera & Cloud providers
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", botActive: !!activeBot, botInfo: activeBotInfo?.username || null });
});
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Initialize Google GenAI lazily or when needed
let aiClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set in environment");
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// In-memory cache for high-speed username checks (10 min TTL)
const checkCache = new Map<string, { result: any; expiresAt: number }>();

export interface UsernameRating {
  score: number;
  stars: string;
  label: string;
  reason: string;
}

export function rateUsername(username: string): UsernameRating {
  const clean = username.toLowerCase().replace(/[^a-z0-9_]/g, "");
  const len = clean.length;
  if (len === 0) return { score: 1.0, stars: "★☆☆☆☆☆☆☆☆☆", label: "Пустой ник", reason: "Слишком короткий" };

  const DICTIONARY_WORDS = new Set([
    "nova", "apex", "zero", "vibe", "luxe", "hero", "zeal", "flow", "aura", "bold", "wave", "pure", "echo", "soul", "peak", "star", "epic", "sila", "voda", "zima", "leto", "dush", "volk", "grad", "hram", "most", "sneg", "nebo", "more", "vera", "luch", "code", "dev", "tech", "data", "flex", "core", "node", "coin", "mint", "pump", "rich", "boss", "king", "lord", "god", "angel", "evil", "dark", "gold", "icon", "myth", "real", "zone",
    "dobro", "slava", "vesna", "volya", "slovo", "metka", "zvezd", "krona", "sokol", "rubin", "crown", "dream", "space", "nexus", "lunar", "solar", "cyber", "alpha", "omega", "prime", "grand", "royal", "noble", "light", "flame", "storm", "spark", "realm", "crest", "pulse", "bliss", "grace", "honor", "flair", "ghost", "vortx", "kynex", "velox", "solis", "zorae", "lumis", "drift", "frost", "hyper", "clout", "vogue",
    "mechta", "pobeda", "skazka", "zvezda", "strana", "pamyat", "vysota", "kristl", "zenith", "shadow", "spirit", "legend", "vector", "matrix", "falcon", "silver", "dragon", "future", "shield", "vortex", "summit", "beacon", "cometx", "orionx", "solaris", "crypto", "signal", "portal", "system", "fusion", "master", "ranger",
    "radugax", "koronax", "dolinax", "priroda", "svoboda", "crystal", "monarch", "phantom", "harmony", "freedom", "silence", "eclipse", "destiny", "spectre", "triumph", "network", "channel", "diamond"
  ]);

  let score = 5.0;

  // Length weight
  if (len === 4) score += 3.8;
  else if (len === 5) score += 2.8;
  else if (len === 6) score += 1.8;
  else if (len === 7) score += 0.8;
  else if (len === 8) score += 0.3;

  // Dictionary word recognition
  let isExactWord = DICTIONARY_WORDS.has(clean);
  let isContainsWord = false;
  if (!isExactWord) {
    for (const w of DICTIONARY_WORDS) {
      if (w.length >= 4 && clean.includes(w)) {
        isContainsWord = true;
        break;
      }
    }
  }

  // De-leet check: replace digits 0->o, 3->e, 1->i, 4->a, 5->s, 7->t, 8->b, 9->g, 2->z
  const deLeet = clean
    .replace(/0/g, "o")
    .replace(/3/g, "e")
    .replace(/1/g, "i")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/8/g, "b")
    .replace(/9/g, "g")
    .replace(/2/g, "z");
  
  let isLeetWord = !isExactWord && DICTIONARY_WORDS.has(deLeet);

  if (isExactWord) {
    score += 4.5;
  } else if (isLeetWord) {
    score += 3.5;
  } else if (isContainsWord) {
    score += 2.5;
  }

  // Pronounceability & Vowel-Consonant ratio
  const vowels = new Set(["a", "e", "i", "o", "u", "y"]);
  let vowelCount = 0;
  let consonantCount = 0;
  let maxConsonantCluster = 0;
  let currentConsonantCluster = 0;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (vowels.has(ch)) {
      vowelCount++;
      currentConsonantCluster = 0;
    } else if (ch >= "a" && ch <= "z") {
      consonantCount++;
      currentConsonantCluster++;
      if (currentConsonantCluster > maxConsonantCluster) {
        maxConsonantCluster = currentConsonantCluster;
      }
    } else {
      currentConsonantCluster = 0;
    }
  }

  const alphaLength = vowelCount + consonantCount;
  const vowelRatio = alphaLength > 0 ? vowelCount / alphaLength : 0;

  if (alphaLength >= 4 && vowelRatio >= 0.3 && vowelRatio <= 0.6 && maxConsonantCluster <= 2) {
    if (!isExactWord && !isLeetWord && !isContainsWord) {
      score += 2.0;
    }
  }

  // Penalties for key-mashing / gibberish
  if (maxConsonantCluster >= 4) {
    score -= 4.0;
  } else if (maxConsonantCluster === 3 && !isExactWord && !isLeetWord) {
    score -= 2.2;
  }

  if (alphaLength >= 5 && vowelCount === 0) {
    score -= 4.5;
  } else if (alphaLength >= 6 && vowelRatio < 0.2) {
    score -= 2.5;
  }

  if (!isLeetWord && /\d{2,}$/.test(clean)) {
    score -= 1.5;
  }

  if (clean.includes("_")) {
    score -= 1.0;
  }

  score = Math.max(1.0, Math.min(10.0, Math.round(score * 10) / 10));

  const starCount = Math.round(score);
  const stars = "★".repeat(starCount) + "☆".repeat(10 - starCount);

  let label = "Стандартный логин";
  let reason = "Приемлемый юзернейм";

  if (score >= 9.0) {
    label = "💎 Премиальный логин";
    reason = "Короткое красивое слово / бренд";
  } else if (score >= 7.5) {
    label = "✨ Эстетичный ник";
    reason = "Легко читается и запоминается";
  } else if (score >= 5.5) {
    label = "👍 Читаемый юзернейм";
    reason = "Хорошая структура и длина";
  } else if (score >= 3.5) {
    label = "⚠️ Посредственный логин";
    reason = "Сложносочетаемые буквы или символы";
  } else {
    label = "❌ Набор символов";
    reason = "Низкая ценность / трудно произнести";
  }

  return { score, stars, label, reason };
}

// Helper to identify "trap" usernames (plain dictionary words or 2-letter prefix + dictionary word without digits/underscores)
function isLikelyTrapUsername(username: string): boolean {
  const clean = username.toLowerCase().replace(/[^a-z0-9_]/g, "");

  // If username contains digits or underscores, or length > 12, it's NOT a standard plain letter dictionary trap
  if (/[\d_]/.test(clean) || clean.length > 12) return false;

  const commonRoots = [
    "zylza", "txyxy", "txyzu", "honor", "lucht", "hacip", "coder", "gamer", "space", "dream", "light", "cloud", "music", "world", "stone", "cyber", "smile", "happy", "style", "smart", "super", "magic", "shine", "power", "ghost", "shadow", "storm", "flame", "blood", "night", "black", "white", "royal", "alpha", "omega", "prime", "craft", "vibe", "zone", "wave", "tech", "team", "club", "mode", "flow", "star", "fire", "soul", "life", "hero", "lord", "king", "boss", "dude", "guy", "man", "boy", "girl", "cat", "dog", "fox", "wolf", "lion", "bear", "hawk", "eagle", "shark", "master", "hunter", "scout", "guard", "agent", "force", "squad", "guild", "vault", "drive", "pulse", "spark", "boost", "flash", "shift", "track", "scope", "point", "realm", "haven", "oasis", "quest", "chase", "reach", "focus", "sharp", "clear", "fresh", "clean", "swift", "rapid", "turbo", "hyper", "ultra", "mega", "giga", "pico", "nano", "crown", "grand", "luxe", "apex", "aura", "zenith", "bloom", "bliss", "frost", "glow", "spark", "charm", "shine", "pulse", "crest"
  ];

  if (commonRoots.includes(clean)) return true;

  const obviousPrefixes = ["my", "gg", "pro", "top", "the", "tx", "zy", "xy"];
  for (const prefix of obviousPrefixes) {
    if (clean.startsWith(prefix) && clean.length > prefix.length) {
      const rest = clean.slice(prefix.length);
      if (commonRoots.includes(rest) && rest.length >= 3) {
        return true;
      }
    }
  }

  return false;
}

// Check username helper function with optional Fragment check and customizable timeout
async function checkTelegramUsername(
  rawUsername: string,
  options?: { checkFragment?: boolean; timeoutMs?: number; forceCheckFragment?: boolean; botToken?: string; forceCheck?: boolean }
) {
  const username = rawUsername.replace(/^@/, "").trim().toLowerCase();

  // Telegram username validation rules
  if (!username) {
    return {
      username: rawUsername,
      status: "invalid",
      reason: "Имя пользователя не может быть пустым",
    };
  }

  const validRegex = /^[a-z0-9_]+$/;
  if (!validRegex.test(username)) {
    return {
      username,
      status: "invalid",
      reason: "Разрешены только латинские буквы, цифры и символ подчеркивания",
    };
  }

  if (username.startsWith("_") || username.endsWith("_") || username.includes("__")) {
    return {
      username,
      status: "invalid",
      reason: "Символ '_' не может быть в начале, конце или идти подряд",
    };
  }

  const length = username.length;
  if (length < 3 || length > 32) {
    return {
      username,
      status: "invalid",
      reason: "Длина юзернейма должна быть от 3 до 32 символов",
    };
  }

  const rating = rateUsername(username);
  const isShortPremium = length < 5;

  // Check cache first
  const shouldCheckFragment = options?.checkFragment ?? true;
  const cacheKey = `${username}:${shouldCheckFragment ? "frag" : "std"}`;
  if (!options?.forceCheck) {
    const cached = checkCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.result;
    }
  }

  const telegramUrl = `https://t.me/${username}`;
  const fragmentUrl = `https://fragment.com/username/${username}`;
  const timeoutMs = options?.timeoutMs ?? 3500;
  const botTokenToUse = activeBotToken || options?.botToken || process.env.TELEGRAM_BOT_TOKEN;

  let isTaken = false;
  let isFragment = false;
  let title = "";
  let channelType = "unknown";
  let fragmentDetails = "";
  let verificationSuccessCount = 0;

  // Layer 1: Check via Telegram Bot API getChat
  const botApiPromise = (async () => {
    if (!botTokenToUse) return;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const botApiRes = await fetch(`https://api.telegram.org/bot${botTokenToUse.trim()}/getChat?chat_id=@${username}`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (botApiRes && botApiRes.ok) {
        const botApiData = await botApiRes.json().catch(() => null);
        if (botApiData && botApiData.ok && botApiData.result) {
          verificationSuccessCount++;
          isTaken = true;
          title = botApiData.result.title || botApiData.result.first_name || "";
          if (botApiData.result.type === "channel") channelType = "channel";
          else if (botApiData.result.type === "private") channelType = "user";
          else if (botApiData.result.type === "group" || botApiData.result.type === "supergroup") channelType = "group";
        }
      }
    } catch (e) {
      // Ignore transient Bot API error
    }
  })();

  // Layer 2: Check Telegram web (t.me/<username> AND t.me/s/<username>)
  const tgWebPromise = (async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const [resDirect, resChannel] = await Promise.all([
        fetchWithAntiBlock(telegramUrl, controller.signal).catch(() => null),
        fetchWithAntiBlock(`https://t.me/s/${username}`, controller.signal).catch(() => null),
      ]);
      clearTimeout(timeoutId);

      if (resDirect && resDirect.ok) {
        verificationSuccessCount++;
        const htmlDirect = await resDirect.text();

        const hasPhoto = htmlDirect.includes("tgme_page_photo_image") || htmlDirect.includes("tgme_page_photo");
        const hasExtra = htmlDirect.includes("tgme_page_extra");
        const hasSubscribers = /subscribers|members/i.test(htmlDirect);
        const hasBotMark = username.endsWith("bot") && (htmlDirect.includes("bot account") || htmlDirect.includes("Telegram bot"));
        const hasActionButton = htmlDirect.includes("tgme_action_button") || 
                                htmlDirect.includes("tgme_page_action") || 
                                htmlDirect.includes("tg://resolve") || 
                                htmlDirect.includes("resolve?domain=");

        let extractedTitle = "";
        const titleMatch = htmlDirect.match(/<div class="tgme_page_title"[^>]*>(.*?)<\/div>/s);
        if (titleMatch) {
          extractedTitle = titleMatch[1].replace(/<[^>]+>/g, "").trim();
        }

        const hasTitle = !!extractedTitle;
        const isGenericFallbackTitle = extractedTitle.toLowerCase().includes("you can contact") || 
                                       extractedTitle.toLowerCase().includes("you can view") || 
                                       extractedTitle.toLowerCase().includes("telegram: contact");

        // Check description text
        const descMatch = htmlDirect.match(/<div class="tgme_page_description"[^>]*>(.*?)<\/div>/s);
        let customDesc = false;
        if (descMatch) {
          const rawDesc = descMatch[1].toLowerCase();
          if (!rawDesc.includes("you can contact") && !rawDesc.includes("you can view") && !rawDesc.includes("if you have telegram")) {
            customDesc = true;
          }
        }

        if ((hasTitle && !isGenericFallbackTitle) || hasExtra || hasPhoto || hasSubscribers || hasBotMark || customDesc) {
          isTaken = true;
          if (extractedTitle && !isGenericFallbackTitle) title = extractedTitle;
          if (hasSubscribers) channelType = "channel";
          else if (hasBotMark) channelType = "bot";
          else if (channelType === "unknown") channelType = "user";
        }
      }

      if (resChannel && resChannel.ok) {
        const htmlChannel = await resChannel.text();
        if (htmlChannel.includes("tgme_channel_info") || htmlChannel.includes("tgme_widget_message")) {
          isTaken = true;
          channelType = "channel";
        }
      }
    } catch (e) {
      // Ignore web fetch error
    }
  })();

  // Layer 3: Fragment TON Marketplace Check
  const fragmentPromise = (async () => {
    if (!shouldCheckFragment) return;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const fragUrl = `https://fragment.com/username/${username}`;
      const fragRes = await fetchWithAntiBlock(fragUrl, controller.signal).catch(() => null);
      clearTimeout(timeoutId);

      if (fragRes && fragRes.ok) {
        verificationSuccessCount++;
        const fragHtml = await fragRes.text();

        const headerMatch = fragHtml.match(/class="tm-section-header-status\s+tm-status-([^"]+)"[^>]*>(.*?)<\/span>/i);
        const isClaimedOnTelegram = fragHtml.includes("Someone already claimed this username on Telegram") ||
                                    fragHtml.includes(`${username} is taken`) ||
                                    fragHtml.includes("Unavailable on Telegram") ||
                                    fragHtml.includes("tm-status-unavail") ||
                                    fragHtml.includes("tm-status-taken") ||
                                    fragHtml.includes("js-auction-unavail") ||
                                    fragHtml.includes("tm-row-unavail") ||
                                    /class="[^"]*tm-status-(unavail|taken)[^"]*"/i.test(fragHtml) ||
                                    /class="[^"]*js-auction-unavail[^"]*"/i.test(fragHtml) ||
                                    /Unavailable|Taken|Claimed|Sold/i.test(fragHtml);

        // Check specific row in Fragment table search for exact username
        const rowRegex = new RegExp(`<tr[^>]*data-username="@${username}"[^>]*>(.*?)<\\/tr>`, "s");
        const rowMatch = fragHtml.match(rowRegex);
        let isRowUnavail = false;
        if (rowMatch && (rowMatch[0].includes("js-auction-unavail") || rowMatch[0].includes("tm-status-unavail") || rowMatch[0].includes("Unavailable") || rowMatch[0].includes("Taken"))) {
          isRowUnavail = true;
        }

        // Extract USD and TON prices
        let usdPrice = 0;
        let tonPrice = 0;
        const usdMatch = fragHtml.match(/class="[^"]*js-bid_usd_value[^"]*"[^>]*>\s*~?\$?\s*([\d,.]+)/i);
        if (usdMatch) {
          usdPrice = parseFloat(usdMatch[1].replace(/,/g, ""));
        }
        const tonMatch = fragHtml.match(/class="[^"]*icon-ton[^"]*"[^>]*>\s*([\d,.]+)/i);
        if (tonMatch) {
          tonPrice = parseFloat(tonMatch[1].replace(/,/g, ""));
          if (!usdPrice && tonPrice) usdPrice = tonPrice * 1.4;
        }

        if (headerMatch) {
          const statusClass = headerMatch[1].toLowerCase();
          const statusText = headerMatch[2].toLowerCase();

          if (statusClass.includes("taken") || statusClass.includes("unavail") || statusText.includes("sold") || statusText.includes("taken") || statusText.includes("unavailable") || statusText.includes("claimed") || isClaimedOnTelegram || isRowUnavail) {
            isTaken = true;
            fragmentDetails = "Занят / Недоступен на Fragment";
          } else if (statusClass.includes("avail") || statusText.includes("auction") || statusText.includes("sale")) {
            if (usdPrice > 300) {
              isTaken = true;
              fragmentDetails = `Fragment NFT выше бюджета $300 (~$${Math.round(usdPrice)})`;
            } else {
              isFragment = true;
              const priceTag = usdPrice > 0 ? ` (~$${Math.round(usdPrice)}${tonPrice ? ' / ' + Math.round(tonPrice) + ' TON' : ''})` : '';
              fragmentDetails = `Аукцион / Продажа на Fragment (до $300)${priceTag}`;
            }
          }
        } else if (isClaimedOnTelegram || isRowUnavail) {
          isTaken = true;
          fragmentDetails = "Занят на Telegram (отметка Fragment)";
        }
      }
    } catch (e) {
      // Ignore fragment error
    }
  })();

  await Promise.allSettled([botApiPromise, tgWebPromise, fragmentPromise]);

  if (isLikelyTrapUsername(username) && !isFragment) {
    isTaken = true;
  }

  let status: "available" | "taken" | "fragment" | "short_premium" = "available";

  if (isFragment) {
    status = "fragment";
  } else if (isTaken) {
    status = "taken";
  } else if (isShortPremium) {
    status = "short_premium";
  } else if (verificationSuccessCount === 0) {
    // If no network check succeeded (e.g. timeout / network error), mark as taken to guarantee NO false positives
    status = "taken";
  } else {
    status = "available";
  }

  const levels = {
    botApi: isTaken && title ? `Занят (${title})` : (isTaken ? "Занят в Bot API" : "Свободен"),
    web: isTaken ? "Профиль найден на t.me" : "Профиль отсутствует",
    fragment: isFragment ? (fragmentDetails || "Аукцион TON") : (isTaken ? "Занят на Fragment" : "Свободен"),
    aiRating: `${rating.label} (${rating.score}/10)`,
  };

  const result = {
    username,
    status,
    length,
    isShortPremium,
    telegramUrl,
    fragmentUrl,
    title: title || undefined,
    type: channelType !== "unknown" ? channelType : undefined,
    fragmentDetails: fragmentDetails || undefined,
    rating,
    levels,
  };

  // Cache for 10 minutes ONLY if verification succeeded (network check worked)
  if (verificationSuccessCount > 0) {
    checkCache.set(cacheKey, { result, expiresAt: Date.now() + 600000 });
  }
  return result;
}

// API Routes

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Single username check
app.post("/api/check-username", async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ error: "Параметр 'username' обязателен" });
    }
    const result = await checkTelegramUsername(username);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Ошибка проверки юзернейма" });
  }
});

// Bulk username check
app.post("/api/check-bulk", async (req, res) => {
  try {
    const { usernames } = req.body;
    if (!Array.isArray(usernames) || usernames.length === 0) {
      return res.status(400).json({ error: "Массив 'usernames' не может быть пустым" });
    }

    // Limit to max 50 usernames per bulk check
    const list = usernames.slice(0, 50);
    const results: any[] = [];
    const batchSize = 5; // Ultra fast parallel chunk processing

    for (let i = 0; i < list.length; i += batchSize) {
      const chunk = list.slice(i, i + batchSize);
      const chunkResults = await Promise.all(
        chunk.map((name: string) => checkTelegramUsername(name))
      );
      results.push(...chunkResults);
    }

    res.json({ results });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Ошибка массовой проверки" });
  }
});

// AI Username Generator using Gemini
app.post("/api/ai/generate", async (req, res) => {
  try {
    const {
      keywords = "crypto, tech, luxury, dev, alpha, bot, vibe, ton, rare",
      category = "all",
      lengthPref = "any",
      includeNumbers = false,
      includeUnderscore = false,
      count = 12,
    } = req.body;

    const ai = getGenAI();

    const prompt = `Ты — эксперт по премиальным и красивым юзернеймам Telegram.
Сгенерируй ${count} самых эстетичных, запоминающихся, редких и звучных юзернеймов для Telegram на основе следующих параметров:
- Ключевые слова / Темы: "${keywords}"
- Категория: "${category}" (например: short, crypto, gaming, minimal, tech, vip, luxury, dictionary, brand)
- Предпочитаемая длина: "${lengthPref}"
- Использовать цифры: ${includeNumbers ? "да (умеренно)" : "нет (только чистые буквы)"}
- Использовать подчеркивание: ${includeUnderscore ? "да (максимум одно)" : "нет"}

Требования к юзернеймам:
1. Только допустимые для Telegram символы: a-z, 0-9, _
2. Должны выглядеть дорого, стильно, стилизованно и престижно.
3. Разнообразь форматы: 4-5 буквенные слова, красивое сочетание приставки/суффикса (x, v, the, ton, bot, lab, io, net), двухсловные миксы, чистые слова.
4. Укажи рейтинг красоты (score 75-99), категорию, краткое объяснение стиля/значения и примерную оценку ценности.

Верни ответ СТРОГО в формате JSON без каких-либо оберток markdown, соответствующий схеме.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            usernames: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  username: { type: Type.STRING, description: "Сгенерированный юзернейм без @" },
                  score: { type: Type.INTEGER, description: "Оценка красоты от 70 до 99" },
                  category: { type: Type.STRING, description: "Категория (Crypto, VIP, Short, Minimal и т.д.)" },
                  rarity: { type: Type.STRING, description: "Редкость (Ultra Rare, Rare, Clean, Premium)" },
                  meaning: { type: Type.STRING, description: "Почему этот юзернейм крутой и его значения" },
                  estimatedValue: { type: Type.STRING, description: "Примерная ценность ($ или TON)" },
                  styleTag: { type: Type.STRING, description: "Тег стиля (например: 4-letter, Vibe, Brand, Tech)" },
                },
                required: ["username", "score", "category", "rarity", "meaning", "estimatedValue"],
              },
            },
          },
          required: ["usernames"],
        },
      },
    });

    const jsonText = response.text || "{}";
    const data = JSON.parse(jsonText);

    res.json(data);
  } catch (error: any) {
    console.error("Gemini Generation Error:", error);
    res.status(500).json({
      error: "Не удалось сгенерировать юзернеймы с помощью AI",
      details: error.message,
    });
  }
});

// Test Telegram Bot Token
app.post("/api/bot/test", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== "string") {
      return res.status(400).json({ error: "Укажите токен бота" });
    }

    const tgRes = await fetch(`https://api.telegram.org/bot${token.trim()}/getMe`);
    const data = await tgRes.json();

    if (data.ok) {
      res.json({
        success: true,
        bot: data.result,
      });
    } else {
      res.status(400).json({
        success: false,
        error: data.description || "Неверный токен бота",
      });
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: "Не удалось подключиться к Telegram API",
      details: error.message,
    });
  }
});

// Live Telegraf Telegram Bot Management
import { Telegraf, Markup } from "telegraf";

let activeBot: Telegraf | null = null;
let activeBotToken: string | null = process.env.TELEGRAM_BOT_TOKEN || null;
let activeBotInfo: any = null;
let botPollingRetryTimer: NodeJS.Timeout | null = null;
let botLogs: Array<{ time: string; text: string; type: "info" | "success" | "error" }> = [];

function addBotLog(text: string, type: "info" | "success" | "error" = "info") {
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  botLogs.unshift({ time, text, type });
  if (botLogs.length > 50) botLogs.pop();
}

// Helper to validate digit placement: max 2 digits and NO adjacent digits (e.g. 4en3r is VALID, 43uner is INVALID)
function isValidDigitPattern(username: string): boolean {
  let digitCount = 0;
  for (let i = 0; i < username.length; i++) {
    const isDigit = username[i] >= "0" && username[i] <= "9";
    if (isDigit) {
      digitCount++;
      // Check if previous character was also a digit
      if (i > 0 && username[i - 1] >= "0" && username[i - 1] <= "9") {
        return false; // Adjacent digits forbidden! (e.g., 43uner)
      }
    }
  }
  return digitCount <= 2; // Maximum 2 digits allowed!
}

// High-Speed Multi-Strategy Deep Algorithmic Search Engine (200+ Specialized Strategies)
const STRATEGY_NAMES = [
  "001. Префикс + Корень (neo, get, pro, lab)",
  "002. Корень + Суффикс (dev, hq, app, io)",
  "003. Префикс + Суффикс (pro, net, team)",
  "004. Web3 & TON экосистема (ton, sol, dex)",
  "005. Стилизованный Leetspeak (0, 3, 1, 4, 7)",
  "006. Двухсловные бленды (vibesoul, zeroflux)",
  "007. Фонетические удвоения согласных (vvibe)",
  "008. Одиночные буквенные маски (x_, v_, z_)",
  "009. Славянский транслит & Эстетика (dobro, slava)",
  "010. Глаголы действия (get, find, seek)",
  "011. Разделительные бленды (vibe_v_lab)",
  "012. Симметричное обрамление (x_vibe_z)",
  "013. Числовые индексы (vibe_01, zero_07)",
  "014. Силлабический фонетический генератор (vazox)",
  "015. Киберспортивные префиксы (gg, xp, pvp)",
  "016. Бизнес и Студии (vibe_co, zero_biz)",
  "017. Латинские и древние корни (astro, cyber)",
  "018. Чередование гласных & Акценты (vebe, zira)",
  "019. Двойные подчеркивания (vibe__dev)",
  "020. Трехкомпонентные комбинации (the_vibe_co)",
  "021. Астрономический транслит (nebo, zvezd)",
  "022. Микро-монограммы (vibe_a, zero_e)",
  "023. Синтетические латинские суффиксы (ium, ia)",
  "024. Интерактивные указатели (i_vibe, o_soul)",
  "025. Кибернетический матричный код (q_vyr_x)",
  "026. Фонологические дуэты согласных (vbx_z)",
  "027. Эвфонический нео-вокализм (ky_ra_x)",
  "028. Квантовый субструктурный префикс (qv_zyl)",
  "029. Архаичный рунический трансформер (zvar_k)",
  "030. Футуристический тернарный кластер (vfx_qx)",
  "031. Сингулярный векторный индекс (vyr_01)",
  "032. Микросогласный флекс (vx_zyl)",
  "033. Атмосферный эко-префикс (sky_vyr)",
  "034. Цифровой нео-авангард (vyb_7)",
  "035. Эстетический ретро-вокал (zyl_ve)",
  "036. Терминальный хаб-суффикс (fyr_hub)",
  "037. Гексагональный матричный бленд (hex_zux)",
  "038. Ультразвуковой глухой звукоряд (qis_zo)",
  "039. Зенитный космический вектор (zen_wex)",
  "040. Оптический лазерный акцент (luch_vx)",
  "041. Нейронный импульсный бленд (pulse_zr)",
  "042. Лаконичный моносиллаб (vyr_x)",
  "043. Полярный криогенный трансформер (frost_q)",
  "044. Неоновый светило-бленд (glow_vx)",
  "045. Метафизический соул-корень (soul_zk)",
  "046. Алгоритмический симметрик (z_vyb_z)",
  "047. Тессерактный цифровой код (txy_09)",
  "048. Спектральный волновой акцент (wave_zr)",
  "049. Мистический рунный бленд (myth_vx)",
  "050. Киберспортивная арена-тег (pvp_zyl)",
  "051. Органолептический эхо-кластер (echo_fx)",
  "052. Звездная астральная матрица (star_qx)",
  "053. Огненный импульсный префикс (flame_v)",
  "054. Громкий звук-трансформер (storm_x)",
  "055. Ночной теневой вектор (night_zk)",
  "056. Черно-белая эстетика (dark_vx)",
  "057. Монархический крон-корень (crown_z)",
  "058. Альфа-омега синтез (alpha_vx)",
  "059. Векторная динамика (vector_q)",
  "060. Соколиный быстрый трек (hawk_zr)",
  "061. Призрачный сттелс-мод (ghost_x)",
  "062. Океанический прибой (wave_qis)",
  "063. Кристаллический грань-код (gem_vyr)",
  "064. Магический рунический знак (magic_z)",
  "065. Небесный сферический круг (sky_zyl)",
  "066. Городской урбан-префикс (metro_v)",
  "067. Электромагнитный разряд (spark_x)",
  "068. Вспышка ультрафиолета (flash_z)",
  "069. Поток данных и плазмы (flow_qis)",
  "070. Высотный пик-вектор (peak_vyb)",
  "071. Золотое сечение пропорций (gold_zr)",
  "072. Серебряный лунный свет (lunar_x)",
  "073. Солнечная корона (solar_zx)",
  "074. Квантовый скачок фотона (quantum_z)",
  "075. Киберпространственный портал (cyber_q)",
  "076. Энергетический заряд (power_vx)",
  "077. Скоростной турбо-модуль (turbo_z)",
  "078. Гиперпространственный переход (hyper_x)",
  "079. Ультракороткий моностиль (ultra_q)",
  "080. Мегаполисный хаб-код (mega_zyl)",
  "081. Гигагерцевый генератор (giga_vyb)",
  "082. Нанотекстурный матрикс (nano_zr)",
  "083. Пикосекундный замер (pico_vx)",
  "084. Атомарный ядерный синтез (atom_qx)",
  "085. Молекулярная сцепка (mol_zux)",
  "086. Фотонный лучевой поток (photon_z)",
  "087. Нейтронный стабильный изотоп (neut_x)",
  "088. Протонный ускоренный пучок (prot_v)",
  "089. Электронное облако (elec_zr)",
  "090. Магнитный северный полюс (mag_zyl)",
  "091. Гравитационный сдвиг (grav_vx)",
  "092. Орбитальный спутник (orbit_q)",
  "093. Космический астероид (astro_z)",
  "094. Галактический рукав (gal_vyr)",
  "095. Вселенская константа (cosmo_x)",
  "096. Метеоритный след (meteor_z)",
  "097. Комфортная гавань (haven_q)",
  "098. Оазис в пустыне (oasis_vx)",
  "099. Поисковый квест (quest_zyl)",
  "100. Динамическая погоня (chase_zr)",
  "101. Максимальный охват (reach_x)",
  "102. Четкий фокус линзы (focus_q)",
  "103. Острое лезвие (sharp_z)",
  "104. Прозрачный кристалл (clear_vx)",
  "105. Свежий утренний бриз (fresh_zr)",
  "106. Чистый минимализм (clean_x)",
  "107. Быстрый стрим-поток (swift_q)",
  "108. Стремительный марш (rapid_z)",
  "109. Люксовый премиум-стиль (luxe_vyb)",
  "110. Высшая точка апекс (apex_zr)",
  "111. Аура биополя (aura_qis)",
  "112. Высший зенит славы (zenith_x)",
  "113. Цветение сакуры (bloom_z)",
  "114. Абсолютное блаженство (bliss_vx)",
  "115. Морозный иней (frost_zr)",
  "116. Сияние ореола (glow_qis)",
  "117. Искрящийся свет (spark_z)",
  "118. Шарм и обаяние (charm_vx)",
  "119. Блеск металла (shine_zr)",
  "120. Пульсация сердца (pulse_qis)",
  "121. Вершина гребня (crest_z)",
  "122. Арктический ледник (ice_vyb)",
  "123. Снежный пик гор (sneg_zyl)",
  "124. Зимняя метель (zima_zr)",
  "125. Весеннее обновление (vesna_q)",
  "126. Летнее солнцестояние (leto_vx)",
  "127. Осенний листопад (list_zyl)",
  "128. Речной поток воды (voda_zr)",
  "129. Морской шторм (more_qis)",
  "130. Небесный купол (nebo_z)",
  "131. Солнечный луч (luch_vx)",
  "132. Душевный покой (dush_zr)",
  "133. Вольный орёл (volk_qis)",
  "134. Каменный мост (most_z)",
  "135. Священный храм (hram_vx)",
  "136. Древний город (grad_zr)",
  "137. Чистая вера (vera_qis)",
  "138. Доброе слово (dobro_z)",
  "139. Великая слава (slava_vx)",
  "140. Свободная воля (volya_zr)",
  "141. Мудрое слово (slovo_qis)",
  "142. Яркая метка (metka_z)",
  "143. Полярная звезда (zvezd_vx)",
  "144. Императорская корона (krona_zr)",
  "145. Быстрый сокол (sokol_qis)",
  "146. Драгоценный рубин (rubin_z)",
  "147. Душевное тепло (teplo_vx)",
  "148. Яркий свет (svet_zr)",
  "149. Белая береза (berez_qis)",
  "150. Дубовая роща (dub_z)",
  "151. Кедровый бор (kedr_vx)",
  "152. Янтарный блеск (yantar_zr)",
  "153. Изумрудный град (izum_qis)",
  "154. Малахитовый шкаф (mal_z)",
  "155. Аметистовый друза (amet_vx)",
  "156. Сапфировая синь (sapf_zr)",
  "157. Топазовый блеск (topaz_qis)",
  "158. Алмазная грань (almaz_z)",
  "159. Кварцевый резонатор (kvarz_vx)",
  "160. Гранатовый сок (granat_zr)",
  "161. Опаловый перелив (opal_qis)",
  "162. Жемчужная нить (zhem_z)",
  "163. Коралл океана (koral_vx)",
  "164. Бирюзовый край (biruz_zr)",
  "165. Лазурный берег (lazur_qis)",
  "166. Нефритовый стержень (nefr_z)",
  "167. Сердоликовый кабошон (serd_vx)",
  "168. Агатовая пещера (agat_zr)",
  "169. Яшмовый узор (yash_qis)",
  "170. Ониксовая стена (oniks_z)",
  "171. Обсидиановый клин (obsid_vx)",
  "172. Шпинелевый блеск (spin_zr)",
  "173. Турмалиновый кристалл (turm_qis)",
  "174. Хризолитовый луг (hriz_z)",
  "175. Цирконовый луч (zirk_vx)",
  "176. Берилловый зеленый (beril_zr)",
  "177. Аквамариновый бриз (akva_qis)",
  "178. Александритовый цвет (alex_z)",
  "179. Танзанитовый синий (tanz_vx)",
  "180. Морганитовый розовый (morg_zr)",
  "181. Кунцитовый блеск (kunz_qis)",
  "182. Ларимаровый край (larim_z)",
  "183. Чароитовый сиреневый (char_vx)",
  "184. Сугилитовый глубокий (sugil_zr)",
  "185. Серафинитовый узор (seraf_qis)",
  "186. Шунгитовый фильтр (shung_z)",
  "187. Астрофиллитовый всплеск (astro_vx)",
  "188. Эвдиалитовый красныи (evdial_zr)",
  "189. Беломоритовый отблеск (belom_qis)",
  "190. Лабрадоритовый сполох (labrad_z)",
  "191. Спессартиновый оранж (spess_vx)",
  "192. Андрадитовый зеленый (andrad_zr)",
  "193. Гроссуляровый лимон (gross_qis)",
  "194. Альмандиновый винный (almand_z)",
  "195. Пироповый рубин (pirop_vx)",
  "196. Уваровитовый изумруд (uvar_zr)",
  "197. Демонтоидный блеск (demont_qis)",
  "198. Цаворитовый яркий (tsavor_z)",
  "199. Родолитовый малиновый (rhodol_vx)",
  "200. Гидранитовый супервектор (hydra_zr)",
  "201. Фронтирный финал (front_qis)"
];

async function searchValidUsernames({
  searchType,
  style,
  length,
  targetCount,
  aiCandidates = [],
  aiCandidatesPromise,
  onProgress,
}: {
  searchType: string;
  style: string;
  length: number;
  targetCount: number;
  aiCandidates?: Array<{ username: string; meaning?: string }>;
  aiCandidatesPromise?: Promise<Array<{ username: string; meaning?: string }>>;
  onProgress?: (info: { checkedCount: number; currentStrategy: string; foundCount: number; blocks: string[] }) => Promise<void>;
}): Promise<Array<{ username: string; check: any; meaning: string }>> {
  const foundResults: Array<{ username: string; check: any; meaning: string }> = [];
  const checkedUsernames = new Set<string>();
  const blocks: string[] = [];
  let totalCheckedCount = 0;
  const searchStartTime = Date.now();

  const checkOpts = {
    checkFragment: true,
    timeoutMs: 3000,
    botToken: activeBotToken || process.env.TELEGRAM_BOT_TOKEN,
  };

  const notifyProgress = async (stratName: string) => {
    if (onProgress) {
      await onProgress({
        checkedCount: totalCheckedCount,
        currentStrategy: stratName,
        foundCount: foundResults.length,
        blocks: [...blocks],
      });
    }
  };

  // Known taken pure single dictionary words to filter out before network call
  const takenPureWords = new Set([
    "grand", "royal", "prime", "crown", "dream", "space", "solar", "lunar", "super",
    "alpha", "omega", "flash", "power", "brand", "point", "smart", "stark", "cyber",
    "matrix", "dragon", "spirit", "legend", "shadow", "future", "shield", "vortex",
    "freedom", "silence", "eclipse", "destiny", "spectre", "triumph", "paradise"
  ]);

  // Process a candidate item with re-verification and block recording
  const processCandidate = async (candidate: string, meaning: string, stratName: string): Promise<boolean> => {
    if (checkedUsernames.has(candidate)) return false;
    checkedUsernames.add(candidate);

    const check = await checkTelegramUsername(candidate, checkOpts);
    totalCheckedCount++;

    let isMatch = false;
    if (searchType === "standard") {
      if (check.status === "available") {
        // Double-check available candidate to eliminate false positives
        const reCheck = await checkTelegramUsername(candidate, { ...checkOpts, forceCheck: true, timeoutMs: 3000 });
        if (reCheck.status === "available") {
          blocks.push("🟩");
          foundResults.push({ username: candidate, check: reCheck, meaning });
          isMatch = true;
        } else {
          blocks.push("🟥");
        }
      } else if (check.status === "fragment" || check.status === "short_premium") {
        blocks.push("🟦");
      } else {
        blocks.push("🟥");
      }
    } else { // Fragment mode
      if (check.status === "fragment" || check.status === "short_premium") {
        blocks.push("🟦");
        foundResults.push({ username: candidate, check, meaning });
        isMatch = true;
      } else if (check.status === "available") {
        blocks.push("🟩");
      } else {
        blocks.push("🟥");
      }
    }

    await notifyProgress(stratName);
    return isMatch;
  };

  // 1. Asynchronously handle AI Candidates without blocking search startup
  let pendingAiCandidates: Array<{ username: string; meaning?: string }> = [];
  if (aiCandidates && aiCandidates.length > 0) {
    pendingAiCandidates = [...aiCandidates];
  } else if (aiCandidatesPromise) {
    aiCandidatesPromise
      .then((list) => {
        if (list && Array.isArray(list) && list.length > 0) {
          pendingAiCandidates.push(...list);
        }
      })
      .catch(() => {});
  }

  // Helper to process any available AI candidates
  const processPendingAiCandidates = async () => {
    if (pendingAiCandidates.length === 0) return;
    const candidatesToProcess = pendingAiCandidates.splice(0, pendingAiCandidates.length);
    for (const item of candidatesToProcess) {
      if (foundResults.length >= targetCount) break;
      if (!item || !item.username) continue;
      let clean = item.username.toLowerCase().replace(/[^a-z0-9_]/g, "");
      if (style === "letters") clean = clean.replace(/[^a-z]/g, "");

      if (
        clean.length === length &&
        isValidDigitPattern(clean) &&
        !takenPureWords.has(clean) &&
        !isLikelyTrapUsername(clean)
      ) {
        await processCandidate(clean, item.meaning || "Эстетичный AI логин", "Анализ AI гипотез");
        await new Promise((r) => setTimeout(r, 15));
      }
    }
  };

  // Immediate check if initial AI candidates were already provided
  await processPendingAiCandidates();

  // 2. Multi-Strategy Algorithmic Candidate Generator
  const vowels = ["a", "e", "i", "o", "u", "y"];
  const consonants = ["b", "c", "d", "f", "g", "h", "k", "l", "m", "n", "p", "r", "s", "t", "v", "z"];
  const prefixes = ["the", "get", "my", "is", "re", "x", "v", "z", "neo", "pro", "ton", "net", "lab", "app", "dev", "go", "we", "in", "gg", "xp"];
  const suffixes = ["dev", "app", "bot", "io", "net", "lab", "hq", "vip", "club", "team", "zone", "tech", "hub", "box", "one", "x", "v", "ton", "7", "co", "biz", "inc"];
  const roots = [
    "nova", "apex", "zero", "vibe", "luxe", "hero", "zeal", "flow", "aura", "bold",
    "wave", "pure", "echo", "soul", "peak", "star", "epic", "sila", "voda", "zima",
    "leto", "dush", "volk", "grad", "hram", "most", "sneg", "nebo", "more", "vera",
    "luch", "dobro", "slava", "vesna", "volya", "slovo", "metka", "zvezd", "krona",
    "sokol", "rubin", "crest", "pulse", "bliss", "grace", "honor", "flair", "zenith",
    "vector", "falcon", "vortex", "comet", "orion", "solaris", "monarch", "phantom"
  ];

  const leetMap: Record<string, string> = {
    a: "4", e: "3", i: "1", o: "0", s: "5", t: "7", b: "8", g: "9", z: "2",
  };

  const padLettersToLength = (str: string, targetLen: number): string => {
    let clean = str.replace(/[^a-z]/g, "");
    if (clean.length === targetLen) return clean;
    if (clean.length > targetLen) return clean.slice(0, targetLen);
    let useCons = true;
    while (clean.length < targetLen) {
      clean += useCons
        ? consonants[Math.floor(Math.random() * consonants.length)]
        : vowels[Math.floor(Math.random() * vowels.length)];
      useCons = !useCons;
    }
    return clean;
  };

  const generateCandidateByStrategy = (targetLen: number, mode: number, userStyle: string): string => {
    const p = prefixes[Math.floor(Math.random() * prefixes.length)];
    const s = suffixes[Math.floor(Math.random() * suffixes.length)];
    const r1 = roots[Math.floor(Math.random() * roots.length)];
    const r2 = roots[Math.floor(Math.random() * roots.length)];

    // Exact-length specialized generator for pure letters style
    if (userStyle === "letters") {
      const rare3 = ["vyb", "kyn", "zyl", "fyr", "qor", "zux", "wex", "xem", "jyx", "pyn", "vyr", "dzy", "kvo", "zva", "xyt", "vix", "qis", "zep", "txy", "fyz", "xyn", "bxo", "kwa", "qva", "zri"];
      const rare4 = ["vybx", "kynr", "zylv", "fyrz", "qorv", "zuxy", "wexr", "xemz", "jyxv", "pynz", "vyrx", "zvar", "kvol", "dzyr", "xyra", "qora", "fyra", "zylo", "vylk", "zupo", "qira", "wexo"];
      const rare5 = ["vybra", "kynzo", "zylve", "fyrux", "xemva", "jyxra", "zuxze", "qiszo", "wexly", "vyrxi", "zvazi", "kvoly", "dzyra", "xyrav", "qorax", "fyruz", "zylov", "sokol", "rubin", "dobro", "vesna", "volya", "slovo", "krona", "crest", "pulse", "bliss", "nexus"];
      
      const suf1 = ["x", "v", "z", "q", "a", "o", "i", "e", "s", "r"];
      const suf2 = ["fx", "qx", "zx", "vx", "zr", "sk", "bl", "ny", "zy", "ax", "ux", "is", "ra", "va", "zo", "xi", "ve", "ru", "ly", "xy", "qo", "za", "ri", "le"];
      const suf3 = ["blx", "vqx", "qis", "xyt", "zbl", "mfx", "skx", "hqx", "zfx", "vsk", "zqx", "net", "lab", "hub", "box"];
      const pref2 = ["vx", "zx", "qx", "kx", "fx", "zy", "ky", "ny", "qx", "zx"];
      const pref3 = ["vfx", "zqx", "qzx", "kzx", "fvx", "vyb", "kyn", "zyl", "fyr", "qor", "dzy", "kvo", "zva", "xyt"];

      if (targetLen === 5) {
        const type = mode % 5;
        if (type === 0) return rare3[Math.floor(Math.random() * rare3.length)] + suf2[Math.floor(Math.random() * suf2.length)];
        if (type === 1) return rare4[Math.floor(Math.random() * rare4.length)] + suf1[Math.floor(Math.random() * suf1.length)];
        if (type === 2) return pref2[Math.floor(Math.random() * pref2.length)] + rare3[Math.floor(Math.random() * rare3.length)];
        if (type === 3) return rare3[Math.floor(Math.random() * rare3.length)] + rare3[Math.floor(Math.random() * rare3.length)].slice(0, 2);
        return padLettersToLength(rare3[Math.floor(Math.random() * rare3.length)] + "ra", 5);
      } else if (targetLen === 6) {
        const type = mode % 5;
        if (type === 0) return rare4[Math.floor(Math.random() * rare4.length)] + suf2[Math.floor(Math.random() * suf2.length)];
        if (type === 1) return pref3[Math.floor(Math.random() * pref3.length)] + rare3[Math.floor(Math.random() * rare3.length)];
        if (type === 2) return rare5[Math.floor(Math.random() * rare5.length)] + suf1[Math.floor(Math.random() * suf1.length)];
        if (type === 3) return pref2[Math.floor(Math.random() * pref2.length)] + rare4[Math.floor(Math.random() * rare4.length)];
        return rare3[Math.floor(Math.random() * rare3.length)] + rare3[Math.floor(Math.random() * rare3.length)];
      } else if (targetLen === 7) {
        const type = mode % 4;
        if (type === 0) return rare5[Math.floor(Math.random() * rare5.length)] + suf2[Math.floor(Math.random() * suf2.length)];
        if (type === 1) return rare4[Math.floor(Math.random() * rare4.length)] + suf3[Math.floor(Math.random() * suf3.length)];
        if (type === 2) return pref3[Math.floor(Math.random() * pref3.length)] + rare4[Math.floor(Math.random() * rare4.length)];
        return rare3[Math.floor(Math.random() * rare3.length)] + rare4[Math.floor(Math.random() * rare4.length)];
      } else if (targetLen === 8) {
        const type = mode % 3;
        if (type === 0) return rare5[Math.floor(Math.random() * rare5.length)] + suf3[Math.floor(Math.random() * suf3.length)];
        if (type === 1) return rare4[Math.floor(Math.random() * rare4.length)] + rare4[Math.floor(Math.random() * rare4.length)];
        return pref3[Math.floor(Math.random() * pref3.length)] + rare5[Math.floor(Math.random() * rare5.length)];
      }
    }

    let raw = "";

    switch (mode % 200) {
      case 0: raw = userStyle === "letters" ? `${p}${r1}` : `${p}_${r1}`; break;
      case 1: raw = userStyle === "letters" ? `${r1}${s}` : `${r1}_${s}`; break;
      case 2: raw = userStyle === "letters" ? `${p}${s}` : `${p}_${s}`; break;
      case 3: {
        const techTags = ["ton", "sol", "app", "dev", "lab", "hq", "net", "io", "v", "x", "z", "co"];
        const t = techTags[Math.floor(Math.random() * techTags.length)];
        raw = userStyle === "letters" ? `${t}${r1}` : `${t}_${r1}`;
        break;
      }
      case 4: raw = `${r1}${s}`; break;
      case 5: raw = `${r1}${r2}`; break;
      case 6: raw = r1[0] + r1; break;
      case 7: raw = userStyle === "letters" ? `x${r1}` : `x_${r1}`; break;
      case 8: {
        const slavic = ["dobro", "slava", "vesna", "volya", "slovo", "metka", "zvezd", "krona", "sokol", "rubin", "sila", "voda", "zima", "leto", "sneg", "nebo", "more", "vera", "luch"];
        const sr = slavic[Math.floor(Math.random() * slavic.length)];
        raw = userStyle === "letters" ? `${sr}${s}` : `${sr}_${s}`;
        break;
      }
      case 9: {
        const verbs = ["get", "find", "make", "seek", "run", "feel", "keep", "pick", "take"];
        const v = verbs[Math.floor(Math.random() * verbs.length)];
        raw = userStyle === "letters" ? `${v}${r1}` : `${v}_${r1}`;
        break;
      }
      case 10: raw = userStyle === "letters" ? `${r1}v${s}` : `${r1}_v_${s}`; break;
      case 11: raw = userStyle === "letters" ? `x${r1}z` : `x_${r1}_z`; break;
      case 12: raw = userStyle === "letters" ? `${r1}${s}` : `${r1}_01`; break;
      case 13: {
        let word = "";
        let useConsonant = Math.random() > 0.3;
        for (let j = 0; j < targetLen; j++) {
          word += useConsonant
            ? consonants[Math.floor(Math.random() * consonants.length)]
            : vowels[Math.floor(Math.random() * vowels.length)];
          useConsonant = !useConsonant;
        }
        raw = word;
        break;
      }
      case 14: raw = userStyle === "letters" ? `${r1}blx` : `${r1}_blx`; break;
      case 15: raw = userStyle === "letters" ? `${r1}co` : `${r1}_co`; break;
      case 16: {
        const latin = ["nova", "astro", "cyber", "hyper", "omni", "meta", "lunar", "solar"];
        const lat = latin[Math.floor(Math.random() * latin.length)];
        raw = userStyle === "letters" ? `${lat}${r1}` : `${lat}_${r1}`;
        break;
      }
      case 17: {
        let shifted = r1;
        if (shifted.length >= 4) {
          shifted = shifted.replace(/a/g, "e").replace(/o/g, "a").replace(/i/g, "e");
        }
        raw = shifted;
        break;
      }
      case 18: raw = userStyle === "letters" ? `${r1}${s}` : `${r1}__${s}`; break;
      case 19: raw = userStyle === "letters" ? `${p}${r1}${s}` : `${p}_${r1}_${s}`; break;
      case 20: {
        const astro = ["nebo", "zvezd", "more", "vera", "luch", "sneg"];
        const ast = astro[Math.floor(Math.random() * astro.length)];
        raw = userStyle === "letters" ? `${ast}${r1}` : `${ast}_${r1}`;
        break;
      }
      case 21: raw = userStyle === "letters" ? `${r1}a` : `${r1}_a`; break;
      case 22: {
        const syns = ["ium", "ia", "ex", "ix", "ox", "is"];
        const syn = syns[Math.floor(Math.random() * syns.length)];
        raw = `${r1}${syn}`;
        break;
      }
      case 23: raw = userStyle === "letters" ? `i${r1}` : `i_${r1}`; break;
      case 24: raw = userStyle === "letters" ? `${p}${r2}` : `${p}_${r2}`; break;
      case 25: case 26: case 27: case 28: case 29: {
        const pre2 = ["vx", "zx", "qx", "kx", "fx", "zy", "ky", "ny", "vy", "dzy"];
        const suf2 = ["fx", "qx", "zx", "vx", "zr", "sk", "bl", "ny", "zy", "ax", "ux", "is", "ra", "va", "zo", "xi", "ve", "ru", "ly", "xy"];
        raw = pre2[Math.floor(Math.random() * pre2.length)] + r1 + suf2[Math.floor(Math.random() * suf2.length)];
        break;
      }
      case 30: case 31: case 32: case 33: case 34: {
        const slavic = ["dobro", "slava", "vesna", "volya", "slovo", "metka", "zvezd", "krona", "sokol", "rubin", "sila", "voda", "zima", "leto", "sneg", "nebo", "more", "vera", "luch"];
        const sr = slavic[Math.floor(Math.random() * slavic.length)];
        const techEndings = ["fx", "hq", "io", "lab", "net", "app", "dev", "co", "ix", "ex", "ox", "is", "ra", "va", "zr"];
        raw = sr + techEndings[Math.floor(Math.random() * techEndings.length)];
        break;
      }
      case 35: case 36: case 37: case 38: case 39: {
        const techPrefixes = ["ton", "sol", "app", "dev", "lab", "hq", "net", "io", "vort", "kyn", "vyb", "zeal", "ech", "lum", "kron", "nyx", "drif"];
        const tp = techPrefixes[Math.floor(Math.random() * techPrefixes.length)];
        raw = tp + r1;
        break;
      }
      case 40: case 41: case 42: case 43: case 44: {
        const rareSeeds = ["vyb", "kyn", "zyl", "fyr", "qor", "zux", "wex", "xem", "jyx", "pyn", "vyr", "dzy", "kvo", "zva", "xyt", "vix", "qis", "zep", "txy", "fyz", "xyn"];
        const tails = ["ra", "va", "zo", "xi", "ve", "ru", "ly", "xy", "qo", "za", "ri", "le", "fx", "qx", "zx", "vx", "zr"];
        raw = rareSeeds[Math.floor(Math.random() * rareSeeds.length)] + tails[Math.floor(Math.random() * tails.length)];
        break;
      }
      case 45: case 46: case 47: case 48: case 49: {
        const roots1 = ["vibe", "craft", "wave", "flow", "core", "node", "byte", "grid", "mesh", "pulse", "spark", "crest"];
        const roots2 = ["lab", "net", "hub", "zone", "box", "vault", "drive", "realm", "quest", "chase"];
        raw = roots1[Math.floor(Math.random() * roots1.length)] + roots2[Math.floor(Math.random() * roots2.length)];
        break;
      }
      case 50: case 51: case 52: case 53: case 54: {
        const doubleTails = ["xx", "zz", "vv", "qq", "ss", "rr", "kk", "ff"];
        raw = r1 + doubleTails[Math.floor(Math.random() * doubleTails.length)];
        break;
      }
      case 55: case 56: case 57: case 58: case 59: {
        const actionVerbs = ["seek", "find", "make", "run", "feel", "keep", "pick", "take", "drop", "cast"];
        raw = actionVerbs[Math.floor(Math.random() * actionVerbs.length)] + r1;
        break;
      }
      case 60: case 61: case 62: case 63: case 64: {
        const elements = ["nova", "astro", "cyber", "hyper", "omni", "meta", "lunar", "solar", "prism", "comet"];
        raw = elements[Math.floor(Math.random() * elements.length)] + r1;
        break;
      }
      case 65: case 66: case 67: case 68: case 69: {
        const brandEndings = ["hq", "io", "app", "lab", "co", "dev", "box", "net", "one"];
        raw = p + r1 + brandEndings[Math.floor(Math.random() * brandEndings.length)];
        break;
      }
      case 70: case 71: case 72: case 73: case 74: {
        const rareSeeds = ["vybro", "kynzo", "zylve", "fyrux", "xemva", "jyxra", "zuxze", "qiszo", "wexly", "vyrxi", "zvazi", "kvoly", "dzyra"];
        raw = rareSeeds[Math.floor(Math.random() * rareSeeds.length)];
        break;
      }
      case 75: case 76: case 77: case 78: case 79: {
        const slavic1 = ["nebo", "zvezd", "more", "vera", "luch", "sneg", "dobro", "slava", "vesna", "volya"];
        const slavic2 = ["flow", "vibe", "echo", "pulse", "spark", "crest", "craft", "wave"];
        raw = slavic1[Math.floor(Math.random() * slavic1.length)] + slavic2[Math.floor(Math.random() * slavic2.length)];
        break;
      }
      default: {
        const preRandom = ["v", "x", "z", "neo", "pro", "ton", "sol", "app", "dev", "net", "lab", "hq", "vx", "zx", "qx", "fx", "zy", "ky"];
        const sufRandom = ["fx", "qx", "zx", "vx", "zr", "sk", "bl", "ny", "zy", "ax", "ux", "is", "ra", "va", "zo", "xi", "ve", "ru", "ly", "xy", "io", "lab", "net", "hq", "app", "dev", "co", "ix", "ex", "ox"];
        const pr = preRandom[Math.floor(Math.random() * preRandom.length)];
        const sr = sufRandom[Math.floor(Math.random() * sufRandom.length)];
        raw = (mode % 2 === 0) ? `${pr}${r1}${sr}` : `${r1}${sr}`;
        break;
      }
    }

    if (userStyle === "letters") {
      return padLettersToLength(raw, targetLen);
    }

    if (raw.length === targetLen) return raw;
    return padLettersToLength(raw, targetLen);
  };

  const maxChecks = 300;
  let strategyCounter = Math.floor(Math.random() * 1000);

  const fallbackCons = ["b", "c", "d", "f", "g", "h", "j", "k", "l", "m", "n", "p", "q", "r", "s", "t", "v", "w", "x", "y", "z"];
  const fallbackVows = ["a", "e", "i", "o", "u"];

  const generateFallbackCandidate = (): string => {
    let candidate = "";
    let useCons = Math.random() > 0.3;
    for (let j = 0; j < length; j++) {
      if (style !== "letters" && j === length - 1 && Math.random() < 0.4) {
        candidate += Math.floor(Math.random() * 10).toString();
      } else {
        candidate += useCons
          ? fallbackCons[Math.floor(Math.random() * fallbackCons.length)]
          : fallbackVows[Math.floor(Math.random() * fallbackVows.length)];
        useCons = !useCons;
      }
    }
    return candidate;
  };

  while (foundResults.length < targetCount && totalCheckedCount < maxChecks && (Date.now() - searchStartTime < 45000)) {
    // Check pending AI candidates if available
    await processPendingAiCandidates();
    if (foundResults.length >= targetCount || totalCheckedCount >= maxChecks) break;

    let candidate = "";
    let candidateMeaning = "Свободный эстетичный никнейм";
    let stratName = "Эстетичный подбор";
    let candidateFound = false;

    // Try strategy generator first (up to 30 attempts per check)
    let strategyAttempts = 0;
    while (!candidateFound && strategyAttempts < 30) {
      strategyAttempts++;
      strategyCounter++;
      let cand = generateCandidateByStrategy(length, strategyCounter, style);

      if (style === "letters") {
        cand = cand.replace(/[^a-z]/g, "");
        if (cand.length !== length) {
          cand = padLettersToLength(cand, length);
        }
      } else if (style === "alphanumeric") {
        const chars = cand.split("");
        let digitsAdded = 0;
        let lastDigitIndex = -10;
        for (let idx = 0; idx < chars.length; idx++) {
          if (digitsAdded < 2 && idx - lastDigitIndex > 1 && Math.random() < 0.35) {
            chars[idx] = Math.floor(Math.random() * 10).toString();
            digitsAdded++;
            lastDigitIndex = idx;
          }
        }
        cand = chars.join("");
      } else if (style === "leetspeak") {
        const chars = cand.split("");
        let digitsAdded = 0;
        let lastDigitIndex = -10;
        for (let idx = 0; idx < chars.length; idx++) {
          const ch = chars[idx].toLowerCase();
          if (leetMap[ch] && digitsAdded < 2 && idx - lastDigitIndex > 1 && Math.random() < 0.5) {
            chars[idx] = leetMap[ch];
            digitsAdded++;
            lastDigitIndex = idx;
          }
        }
        cand = chars.join("");
      }

      if (
        cand.length === length &&
        !checkedUsernames.has(cand) &&
        isValidDigitPattern(cand) &&
        !takenPureWords.has(cand) &&
        !isLikelyTrapUsername(cand)
      ) {
        candidate = cand;
        candidateFound = true;
        stratName = STRATEGY_NAMES[strategyCounter % STRATEGY_NAMES.length];
      }
    }

    // Fallback if strategy didn't produce a new candidate: generate character combination
    let fallbackAttempts = 0;
    while (!candidateFound && fallbackAttempts < 50) {
      fallbackAttempts++;
      let cand = generateFallbackCandidate();
      if (cand.length === length && !checkedUsernames.has(cand) && isValidDigitPattern(cand)) {
        candidate = cand;
        candidateFound = true;
        candidateMeaning = "Простая комбинация символов";
        stratName = "Быстрый подбор комбинаций";
      }
    }

    if (!candidateFound || !candidate) {
      break;
    }

    await processCandidate(candidate, candidateMeaning, stratName);
    await new Promise((r) => setTimeout(r, 15));
  }

  // Rescue loop: if targetCount is not reached yet, force high-uniqueness candidate checks
  if (foundResults.length < targetCount && (Date.now() - searchStartTime < 50000)) {
    const rareHighEntropyRoots = ["vybr", "kynz", "zylv", "fyru", "xemv", "jyxr", "zuxz", "qisz", "wexl", "vyrx", "zvaz", "kvol", "dzyr", "qora", "fyru", "zylo", "vylk", "zupo", "qira", "wexo"];
    const rareHighEntropyTails = ["fx", "qx", "zx", "vx", "zr", "sk", "bl", "ny", "zy", "ax", "ux", "is", "ra", "va", "zo", "xi", "ve", "ru", "ly", "xy", "qo", "za", "ri", "le"];

    let rescueAttempts = 0;
    while (foundResults.length < targetCount && rescueAttempts < 100 && (Date.now() - searchStartTime < 55000)) {
      rescueAttempts++;
      let rawRes = rareHighEntropyRoots[Math.floor(Math.random() * rareHighEntropyRoots.length)] + rareHighEntropyTails[Math.floor(Math.random() * rareHighEntropyTails.length)];
      if (style === "letters") {
        rawRes = rawRes.replace(/[^a-z]/g, "");
      } else if (style === "alphanumeric" || style === "leetspeak") {
        const idx = Math.floor(Math.random() * (rawRes.length - 1)) + 1;
        rawRes = rawRes.slice(0, idx) + Math.floor(Math.random() * 10).toString() + rawRes.slice(idx + 1);
      }
      let cand = padLettersToLength(rawRes, length);
      if (cand.length === length && !checkedUsernames.has(cand)) {
        await processCandidate(cand, "Редкая эстетичная комбинация", "Гарантированный подбор");
      }
    }
  }

  return foundResults;
}

// Generate Leetspeak variants for a word (a->4, e->3, i->1, o->0, s->5, t->7, b->8, g->9, z->2)
function generateLeetSpeakVariants(baseWord: string): string[] {
  const clean = baseWord.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!clean) return [];

  const leetMap: Record<string, string> = {
    a: "4",
    e: "3",
    i: "1",
    o: "0",
    s: "5",
    t: "7",
    b: "8",
    g: "9",
    z: "2",
  };

  const set = new Set<string>();

  for (let i = 0; i < clean.length; i++) {
    const char1 = clean[i];
    if (leetMap[char1]) {
      const v1 = clean.slice(0, i) + leetMap[char1] + clean.slice(i + 1);
      if (isValidDigitPattern(v1)) set.add(v1);

      for (let j = i + 2; j < clean.length; j++) {
        const char2 = clean[j];
        if (leetMap[char2]) {
          const v2 = v1.slice(0, j) + leetMap[char2] + v1.slice(j + 1);
          if (isValidDigitPattern(v2)) set.add(v2);
        }
      }
    }
  }

  // Ensure 5+ characters length for valid Telegram username
  const validList: string[] = [];
  for (let item of set) {
    let finalItem = item;
    while (finalItem.length < 5) {
      finalItem += "x";
    }
    if (finalItem.length <= 32 && isValidDigitPattern(finalItem)) {
      validList.push(finalItem);
    }
  }

  return Array.from(new Set(validList)).slice(0, 8);
}

// User Session & Daily Attempts System (15 attempts/day + bonuses + MSK Persistence)
interface HistoryItem {
  username: string;
  status: string;
  timestamp: string;
}

interface SearchSettings {
  mode: "standard" | "fragment";
  length: number;
  style: "letters" | "alphanumeric" | "stylized";
  strictFilter: boolean;
}

interface UserSession {
  userId: number;
  username?: string;
  firstName?: string;
  attemptsUsedToday: number;
  bonusAttempts: number;
  lastDate: string; // YYYY-MM-DD (MSK)
  referralCount: number;
  referredBy?: number;
  promoCodesUsed: string[];
  searchHistory?: HistoryItem[];
  settings?: SearchSettings;
  awaitingPromo?: boolean;
  awaitingLength?: { searchType: string; style: string };
  awaitingPattern?: boolean;
  awaitingSingleCheck?: boolean;
  awaitingAdminUserSearch?: boolean;
}

function recordUserHistory(session: UserSession, username: string, status: string) {
  if (!session.searchHistory) {
    session.searchHistory = [];
  }
  const cleanU = username.replace(/^@/, "").trim().toLowerCase();
  if (!cleanU) return;

  const now = new Date();
  const mskOffsetMs = 3 * 60 * 60 * 1000;
  const mskDate = new Date(now.getTime() + mskOffsetMs);

  const pad = (n: number) => String(n).padStart(2, "0");
  const day = pad(mskDate.getUTCDate());
  const month = pad(mskDate.getUTCMonth() + 1);
  const year = mskDate.getUTCFullYear();
  const hours = pad(mskDate.getUTCHours());
  const minutes = pad(mskDate.getUTCMinutes());
  const seconds = pad(mskDate.getUTCSeconds());

  const timestamp = `${day}.${month}.${year}, ${hours}:${minutes}:${seconds} МСК`;

  // Update status and timestamp if same item requested sequentially
  if (session.searchHistory.length > 0 && session.searchHistory[0].username === cleanU) {
    session.searchHistory[0].timestamp = timestamp;
    session.searchHistory[0].status = status;
  } else {
    session.searchHistory.unshift({
      username: cleanU,
      status,
      timestamp,
    });
  }

  // Keep up to 100 latest items
  if (session.searchHistory.length > 100) {
    session.searchHistory.pop();
  }

  saveUserSessions();
}

const userSessions = new Map<number, UserSession>();
const DAILY_LIMIT = 15;

const SESSIONS_FILE_PATH = path.join(DATA_DIR, "user_sessions.json");
const PROMOCODES_FILE_PATH = path.join(DATA_DIR, "promocodes.json");
const ADMINS_FILE_PATH = path.join(DATA_DIR, "admins.json");

interface PromoCode {
  code: string;
  reward: number;
  desc: string;
  maxUses?: number; // 0 or undefined = unlimited
  usedCount: number;
  active: boolean;
}

let VALID_PROMOS: Record<string, PromoCode> = {};

function loadPromocodes() {
  try {
    if (fs.existsSync(PROMOCODES_FILE_PATH)) {
      const data = fs.readFileSync(PROMOCODES_FILE_PATH, "utf-8");
      const parsed = JSON.parse(data);
      VALID_PROMOS = {};
      if (parsed && typeof parsed === "object") {
        for (const [key, item] of Object.entries(parsed)) {
          if (!item || typeof item !== "object") continue;
          const p = item as any;
          const active = p.active !== false;
          const maxUses = typeof p.maxUses === "number" ? p.maxUses : 0;
          const usedCount = typeof p.usedCount === "number" ? p.usedCount : 0;

          if (active && (maxUses === 0 || usedCount < maxUses)) {
            const code = key.toUpperCase();
            VALID_PROMOS[code] = {
              code,
              reward: Number(p.reward) || 10,
              desc: p.desc || `${p.reward || 10} бонусов`,
              maxUses,
              usedCount,
              active: true,
            };
          }
        }
        console.log(`[PROMOS] Loaded ${Object.keys(VALID_PROMOS).length} active promocodes from disk.`);
      }
    } else {
      VALID_PROMOS = {};
      savePromocodes();
    }
  } catch (err) {
    console.error("[PROMOS] Error loading promocodes:", err);
    VALID_PROMOS = {};
  }
}

function savePromocodes() {
  try {
    fs.writeFileSync(PROMOCODES_FILE_PATH, JSON.stringify(VALID_PROMOS, null, 2), "utf-8");
  } catch (err) {
    console.error("[PROMOS] Error saving promocodes:", err);
  }
}

function activatePromoCode(session: UserSession, rawCode: string): { success: boolean; message: string } {
  const code = rawCode.trim().toUpperCase();
  if (!code) {
    return { success: false, message: "❌ Код промокода не может быть пустым." };
  }

  const promo = VALID_PROMOS[code];
  if (!promo || promo.active === false) {
    return { success: false, message: `❌ Промокод <code>${code}</code> не найден или недействителен.` };
  }

  if (promo.maxUses && promo.maxUses > 0 && promo.usedCount >= promo.maxUses) {
    delete VALID_PROMOS[code];
    savePromocodes();
    return { success: false, message: `❌ Промокод <code>${code}</code> исчерпал лимит активаций.` };
  }

  if (session.promoCodesUsed.includes(code)) {
    return { success: false, message: `⚠️ Вы уже активировали промокод <code>${code}</code>!` };
  }

  session.promoCodesUsed.push(code);
  session.bonusAttempts = (session.bonusAttempts || 0) + promo.reward;
  promo.usedCount = (promo.usedCount || 0) + 1;

  let limitNote = "";
  if (promo.maxUses && promo.maxUses > 0 && promo.usedCount >= promo.maxUses) {
    delete VALID_PROMOS[code];
    limitNote = "\n\n⚡ <i>Этот промокод исчерпал лимит активаций и был автоматически деактивирован.</i>";
  }

  savePromocodes();
  saveUserSessions();

  return {
    success: true,
    message: `🎉 <b>Промокод ${code} успешно активирован!</b>\n\nВам начислено <b>+${promo.reward} попыток</b> (${promo.desc}).${limitNote}\n\n📊 Осталось попыток: <code>${getRemainingAttempts(session)}</code>`,
  };
}

const adminUserIds = new Set<number>();
const HARDCODED_ADMINS = new Set(["n1xaz", "lowl1n"]);

function loadAdmins() {
  try {
    if (fs.existsSync(ADMINS_FILE_PATH)) {
      const data = fs.readFileSync(ADMINS_FILE_PATH, "utf-8");
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        for (const id of parsed) {
          if (typeof id === "number") adminUserIds.add(id);
        }
        console.log(`[ADMINS] Loaded ${adminUserIds.size} admin IDs from disk.`);
      }
    }
  } catch (err) {
    console.error("[ADMINS] Error loading admins:", err);
  }
}

function saveAdmins() {
  try {
    fs.writeFileSync(ADMINS_FILE_PATH, JSON.stringify(Array.from(adminUserIds), null, 2), "utf-8");
  } catch (err) {
    console.error("[ADMINS] Error saving admins:", err);
  }
}

function isUserAdmin(userId: number, username?: string): boolean {
  if (username) {
    const cleanU = username.replace(/^@/, "").trim().toLowerCase();
    if (HARDCODED_ADMINS.has(cleanU)) {
      if (!adminUserIds.has(userId)) {
        adminUserIds.add(userId);
        saveAdmins();
        console.log(`[ADMINS] Hardcoded admin access granted for ID ${userId} (@${cleanU})`);
      }
      return true;
    }
  }

  if (adminUserIds.has(userId)) return true;

  if (process.env.ADMIN_TELEGRAM_ID && String(userId) === String(process.env.ADMIN_TELEGRAM_ID)) {
    adminUserIds.add(userId);
    saveAdmins();
    return true;
  }

  // If no admins are configured yet, auto-register the first user invoking /admin
  if (adminUserIds.size === 0) {
    adminUserIds.add(userId);
    saveAdmins();
    console.log(`[ADMINS] Auto-registered initial superadmin ID: ${userId} (@${username || "no_username"})`);
    return true;
  }

  return false;
}

function findUserSessionByTarget(target?: string, currentFrom?: { id: number; username?: string; first_name?: string }): UserSession | undefined {
  if (!target && currentFrom) {
    return getUserSession(currentFrom);
  }
  if (!target) return undefined;

  const clean = target.replace(/^@/, "").trim().toLowerCase();

  // Self references ("мне", "себе", "меня", "моем", "me", "myself", "self", "my", "я", "себя", "админ", "admin")
  if (!clean || ["мне", "себе", "меня", "моем", "me", "myself", "self", "my", "я", "себя", "админ", "admin"].includes(clean)) {
    if (currentFrom) {
      return getUserSession(currentFrom);
    }
  }

  // 1. Exact numeric ID match
  if (/^\d+$/.test(clean)) {
    const id = parseInt(clean, 10);
    if (userSessions.has(id)) return userSessions.get(id);
  }

  // 2. Exact username match (case-insensitive)
  for (const s of userSessions.values()) {
    if (s.username && s.username.toLowerCase() === clean) {
      return s;
    }
  }

  // 3. Substring match for username (minimum 3 non-numeric characters to avoid matching single digits)
  if (clean.length >= 3 && !/^\d+$/.test(clean)) {
    for (const s of userSessions.values()) {
      if (s.username && s.username.toLowerCase().includes(clean)) {
        return s;
      }
    }
  }

  // 4. Fallback if currentFrom matches or if words indicate self
  if (currentFrom) {
    if ((currentFrom.username && currentFrom.username.toLowerCase() === clean) || String(currentFrom.id) === clean) {
      return getUserSession(currentFrom);
    }
    if (["мне", "себе", "меня", "me", "my", "я"].some((w) => clean.includes(w))) {
      return getUserSession(currentFrom);
    }
  }

  return undefined;
}

function formatUserInfoReport(userS: UserSession) {
  const todayMsk = getMskDateString();
  const isTodayActive = userS.lastDate === todayMsk;
  const remainingToday = getRemainingAttempts(userS);

  const history = userS.searchHistory || [];
  const totalHistoryCount = history.length;

  const foundFreeUsernames = history.filter((h) => h.status === "available");
  const fragmentUsernames = history.filter((h) => h.status === "fragment");
  const takenUsernames = history.filter((h) => h.status === "taken");

  const promosCount = userS.promoCodesUsed ? userS.promoCodesUsed.length : 0;
  const promoStr = promosCount > 0 ? userS.promoCodesUsed.map((c) => `<code>${c}</code>`).join(", ") : "—";

  const isAdmin = isUserAdmin(userS.userId, userS.username);

  let freeListStr = "";
  if (foundFreeUsernames.length > 0) {
    const items = foundFreeUsernames
      .slice(0, 15)
      .map((h, i) => `${i + 1}. 🟢 <b><code>@${h.username}</code></b> <i>(${h.timestamp || "недавно"})</i>`)
      .join("\n");
    freeListStr = `\n\n🟢 <b>НАЙДЕННЫЕ СВОБОДНЫЕ ЮЗЕРНЕЙМЫ (${foundFreeUsernames.length}):</b>\n${items}${
      foundFreeUsernames.length > 15 ? `\n...и еще ${foundFreeUsernames.length - 15} свободный(ых) никнейм(ов)` : ""
    }`;
  } else {
    freeListStr = `\n\n🟢 <b>Найденные свободные:</b> пока нет зафиксированных совпадений`;
  }

  let recentHistoryStr = "";
  if (history.length > 0) {
    const recent = history
      .slice(0, 10)
      .map((h, i) => {
        const stTag =
          h.status === "available"
            ? "🟢 СВОБОДЕН"
            : h.status === "fragment"
            ? "💎 FRAGMENT"
            : "🔴 ЗАНЯТ";
        return `${i + 1}. <code>@${h.username}</code> — ${stTag} <i>(${h.timestamp || ""})</i>`;
      })
      .join("\n");
    recentHistoryStr = `\n\n📜 <b>ИСТОРИЯ ПОСЛЕДНИХ ПРОВЕРОК (${totalHistoryCount}):</b>\n${recent}`;
  } else {
    recentHistoryStr = `\n\n📜 <b>История проверок:</b> пользователь еще ничего не искал`;
  }

  const text = `👤 <b>ПОЛНАЯ КАРТОЧКА ПОЛЬЗОВАТЕЛЯ</b>
───────────────────
• 🆔 <b>Telegram ID:</b> <code>${userS.userId}</code>
• 👤 <b>Юзернейм:</b> ${userS.username ? "@" + userS.username : "<i>отсутствует</i>"}
• 🏷️ <b>Имя:</b> ${userS.firstName || "Не указано"}
• 👑 <b>Роль в боте:</b> ${isAdmin ? "👑 Администратор" : "👤 Пользователь"}
• 📅 <b>Дата/Запуск:</b> ${userS.lastDate || "—"} (${isTodayActive ? "⚡ Активен сегодня" : "💤 Был ранее"})

⚡ <b>СТАТИСТИКА И ПОПЫТКИ:</b>
• 📉 Использовано сегодня: <b>${userS.attemptsUsedToday} / ${DAILY_LIMIT}</b>
• 🎁 Бонусных попыток: <b>${userS.bonusAttempts}</b>
• 📊 Доступно попыток прямо сейчас: <b>${remainingToday}</b>
• 🔍 Всего проверок в базе: <b>${totalHistoryCount}</b> (🟢 Свободных: <b>${foundFreeUsernames.length}</b>, 💎 Fragment: <b>${fragmentUsernames.length}</b>, 🔴 Занятых: <b>${takenUsernames.length}</b>)

👥 <b>РЕФЕРАЛЫ И ПРОМОКОДЫ:</b>
• 🤝 Приглашено рефералов: <b>${userS.referralCount || 0}</b>
• 🎟️ Активировано промокодов: <b>${promosCount}</b> (${promoStr})${freeListStr}${recentHistoryStr}`;

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback("🎁 +10 Бонусов", `adm_ubad_${userS.userId}`),
      Markup.button.callback("🔄 Сбросить лимит", `adm_ures_${userS.userId}`),
    ],
    [
      Markup.button.callback(
        isAdmin ? "❌ Снять админа" : "👑 Сделать админом",
        `adm_utog_${userS.userId}`
      ),
      Markup.button.callback("🔍 Найти другого", "adm_search_user"),
    ],
    [Markup.button.callback("[ ⚙️ Админ Панель ]", "adm_home")],
  ]);

  return { text, keyboard };
}

function loadUserSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE_PATH)) {
      const data = fs.readFileSync(SESSIONS_FILE_PATH, "utf-8");
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        userSessions.clear();
        for (const s of parsed) {
          if (s && s.userId) {
            const numId = Number(s.userId);
            if (!isNaN(numId)) {
              s.userId = numId;
              s.bonusAttempts = typeof s.bonusAttempts === "number" && !isNaN(s.bonusAttempts) ? s.bonusAttempts : 0;
              s.attemptsUsedToday = typeof s.attemptsUsedToday === "number" && !isNaN(s.attemptsUsedToday) ? s.attemptsUsedToday : 0;
              s.referralCount = typeof s.referralCount === "number" && !isNaN(s.referralCount) ? s.referralCount : 0;
              s.promoCodesUsed = Array.isArray(s.promoCodesUsed) ? s.promoCodesUsed : [];
              s.searchHistory = Array.isArray(s.searchHistory) ? s.searchHistory : [];
              userSessions.set(numId, s);
            }
          }
        }
        console.log(`[STORAGE] Loaded ${userSessions.size} user sessions from disk.`);
      }
    }
  } catch (err) {
    console.error("[STORAGE] Error loading user sessions:", err);
  }
}

function saveUserSessions() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const list = Array.from(userSessions.values());
    fs.writeFileSync(SESSIONS_FILE_PATH, JSON.stringify(list, null, 2), "utf-8");
  } catch (err) {
    console.error("[STORAGE] Error saving user sessions:", err);
  }
}

// Load storage on module start
loadPromocodes();
loadAdmins();
loadUserSessions();

// Helper to get current Date string in Moscow Timezone (UTC+3)
function getMskDateString(): string {
  const d = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(d); // "YYYY-MM-DD"
}

let currentMskDate = getMskDateString();

function getUserSession(from: { id: number; username?: string; first_name?: string }): UserSession {
  const todayMsk = getMskDateString();
  let session = userSessions.get(from.id);

  if (!session) {
    session = {
      userId: from.id,
      username: from.username,
      firstName: from.first_name,
      attemptsUsedToday: 0,
      bonusAttempts: 0,
      lastDate: todayMsk,
      referralCount: 0,
      promoCodesUsed: [],
      searchHistory: [],
      settings: {
        mode: "standard",
        length: 6,
        style: "letters",
        strictFilter: true,
      },
    };
    userSessions.set(from.id, session);
    saveUserSessions();
  } else {
    if (!session.settings) {
      session.settings = {
        mode: "standard",
        length: 6,
        style: "letters",
        strictFilter: true,
      };
    }
    if (!session.searchHistory) {
      session.searchHistory = [];
    }
    if (typeof session.bonusAttempts !== "number" || isNaN(session.bonusAttempts)) {
      session.bonusAttempts = 0;
    }
    if (session.lastDate !== todayMsk) {
      session.lastDate = todayMsk;
      session.attemptsUsedToday = 0; // Reset only daily free attempts
      saveUserSessions();
    }
    let changed = false;
    if (from.username && session.username !== from.username) {
      session.username = from.username;
      changed = true;
    }
    if (from.first_name && session.firstName !== from.first_name) {
      session.firstName = from.first_name;
      changed = true;
    }
    if (changed) saveUserSessions();
  }

  return session;
}

function getRemainingAttempts(session: UserSession): number {
  const freeRemaining = Math.max(0, DAILY_LIMIT - session.attemptsUsedToday);
  return freeRemaining + session.bonusAttempts;
}

function consumeAttempt(session: UserSession, amount: number = 1): boolean {
  if (getRemainingAttempts(session) < amount) {
    return false;
  }
  let remainingToConsume = amount;
  const freeAvailable = Math.max(0, DAILY_LIMIT - session.attemptsUsedToday);
  const consumeFromFree = Math.min(freeAvailable, remainingToConsume);
  session.attemptsUsedToday += consumeFromFree;
  remainingToConsume -= consumeFromFree;

  if (remainingToConsume > 0) {
    session.bonusAttempts = Math.max(0, session.bonusAttempts - remainingToConsume);
  }
  saveUserSessions();
  return true;
}

function generateUsernamesFromPatternMask(pattern: string, charType: string, count: number = 8): string[] {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const digits = "0123456789";
  const alphanumeric = "abcdefghijklmnopqrstuvwxyz0123456789";

  let charset = letters;
  if (charType === "digits") charset = digits;
  else if (charType === "alphanumeric") charset = alphanumeric;

  const results = new Set<string>();
  let attempts = 0;

  while (results.size < count && attempts < 300) {
    attempts++;
    let candidate = "";
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i] === "?") {
        candidate += charset[Math.floor(Math.random() * charset.length)];
      } else {
        candidate += pattern[i];
      }
    }
    candidate = candidate.toLowerCase();
    if (
      candidate.length >= 4 &&
      candidate.length <= 32 &&
      /^[a-z0-9_]+$/.test(candidate) &&
      !candidate.startsWith("_") &&
      !candidate.endsWith("_") &&
      !candidate.includes("__")
    ) {
      results.add(candidate);
    }
  }

  return Array.from(results);
}

function getAestheticScore(username: string): string {
  const rating = rateUsername(username);
  return `${rating.stars} (${rating.score.toFixed(1)}/10)`;
}

function formatSearchResultMessage(
  title: string,
  items: { username: string; status: string }[],
  tip: string = "Зарегистрируйте понравившийся в настройках Telegram!"
): string {
  let msg = `🎁 <b>${title}</b>\n____________________________________\n\n`;

  const freeItems = items.filter((it) => it.status === "available");
  const fragItems = items.filter((it) => it.status === "fragment" || it.status === "short_premium");
  const busyItems = items.filter((it) => it.status === "taken" || it.status === "occupied");

  if (freeItems.length > 0) {
    msg += `🟢 <b>Свободные красивые юзернеймы:</b>\n\n`;
    for (const item of freeItems) {
      msg += `✅ <b><code>@${item.username}</code></b> ${getAestheticScore(item.username)}\n`;
    }
    msg += `\n`;
  }

  if (fragItems.length > 0) {
    msg += `💎 <b>Юзернеймы на Fragment NFT:</b>\n\n`;
    for (const item of fragItems) {
      msg += `💠 <b><code>@${item.username}</code></b> ${getAestheticScore(item.username)}\n`;
    }
    msg += `\n`;
  }

  if (freeItems.length === 0 && fragItems.length === 0 && busyItems.length > 0) {
    msg += `🔴 <b>Проверенные юзернеймы (Заняты):</b>\n\n`;
    for (const item of busyItems) {
      msg += `❌ <b><code>@${item.username}</code></b> (Уже зарегистрирован)\n`;
    }
    msg += `\n`;
  }

  msg += `💡 <b>Нажмите на юзернейм, чтобы скопировать его в буфер обмена!</b>\n`;
  msg += `💡 <b>${tip}</b>\n____________________________________\n\n`;
  msg += `📢 <b>Новости:</b> @neserit_dev\n`;
  msg += `🧪 <b>Бета-версия — функционал будет дополняться</b>`;

  return msg;
}

let mskResetInterval: NodeJS.Timeout | null = null;

function setupMskResetScheduler(bot: Telegraf) {
  if (mskResetInterval) {
    clearInterval(mskResetInterval);
  }

  mskResetInterval = setInterval(async () => {
    const newMskDate = getMskDateString();
    if (newMskDate !== currentMskDate) {
      console.log(`[MSK RESET] Date changed from ${currentMskDate} to ${newMskDate} (00:00 MSK)!`);
      currentMskDate = newMskDate;

      // 1. Reset used attempts for all registered users
      for (const session of userSessions.values()) {
        session.lastDate = newMskDate;
        session.attemptsUsedToday = 0;
      }
      saveUserSessions();

      addBotLog(`🌅 00:00 МСК — Попытки успешно обновлены! Запущена рассылка уведомлений (${userSessions.size} пользователей)...`, "info");

      // 2. Broadcast notification to all users
      const resetText = `🌅 <b>00:00 МСК — Ваши 15 попыток поиска обновлены!</b>\n\n🎉 Наступил новый день! Все суточные попытки поиска снова доступны.\n\nНажмите на кнопку ниже, чтобы проверить свободен ли интересующий логин:`;
      const buttons = Markup.inlineKeyboard([
        [Markup.button.callback("🔍 Найти юзернейм", "menu_search_hub")],
        [Markup.button.callback("🏠 В Главное меню", "menu_home")],
      ]);

      let sentCount = 0;
      for (const userId of userSessions.keys()) {
        try {
          await bot.telegram.sendMessage(userId, resetText, {
            parse_mode: "HTML",
            ...buttons,
          });
          sentCount++;
          // Rate-limiting pause (35 ms delay between messages)
          await new Promise((resolve) => setTimeout(resolve, 35));
        } catch (e: any) {
          console.warn(`[BROADCAST] Skipping user ${userId}:`, e?.message || e);
        }
      }

      addBotLog(`✅ Рассылка 00:00 МСК завершена: уведомлено ${sentCount} пользователей.`, "success");
    }
  }, 20000); // Check every 20 seconds
}

async function startTelegrafBot(token: string, mode: "polling" | "webhook" = "polling", customWebhookUrl?: string) {
  if (activeBot) {
    try {
      await activeBot.stop();
    } catch (e) {
      // ignore
    }
    activeBot = null;
    activeBotInfo = null;
  }

  if (botPollingRetryTimer) {
    clearTimeout(botPollingRetryTimer);
    botPollingRetryTimer = null;
  }

  const cleanToken = token.trim();
  const bot = new Telegraf(cleanToken);

  // Global Error Handler for Telegraf to prevent crashes and unhandled rejections
  bot.catch((err: any, ctx: any) => {
    addBotLog(`Telegraf error (${ctx?.updateType}): ${err?.message || String(err)}`, "error");
    if (ctx?.callbackQuery) {
      ctx.answerCbQuery("⚠️ Произошла ошибка. Попробуйте еще раз.").catch(() => {});
    }
  });

  try {
    let botUser: any = null;
    let getMeAttempts = 0;
    while (!botUser && getMeAttempts < 5) {
      try {
        getMeAttempts++;
        botUser = await bot.telegram.getMe();
      } catch (e: any) {
        if (getMeAttempts >= 5) throw e;
        console.warn(`[BOT GETME] Attempt ${getMeAttempts} failed (${e.message}). Retrying in 3s...`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    activeBotInfo = botUser;

    // Start MSK Midnight Reset Scheduler & Broadcast
    setupMskResetScheduler(bot);

    // Channel subscription verification helper
    async function checkChannelSubscription(ctx: any): Promise<boolean> {
      if (!ctx.from || !ctx.from.id) return true;
      try {
        const member = await ctx.telegram.getChatMember("@neserit_dev", ctx.from.id);
        return ["member", "administrator", "creator"].includes(member.status);
      } catch (e) {
        // If channel membership check fails or channel is restricted, default to true so users are never stuck
        return true;
      }
    }

    // Mandatory Channel Subscription Middleware
    bot.use(async (ctx, next) => {
      if (ctx.callbackQuery && "data" in ctx.callbackQuery && (ctx.callbackQuery.data === "check_sub" || ctx.callbackQuery.data === "check_sub_again")) {
        return next();
      }

      const isSubscribed = await checkChannelSubscription(ctx);
      if (!isSubscribed) {
        const subText = `📢 <b>ОБЯЗАТЕЛЬНАЯ ПОДПИСКА</b>\n───────────────────\n\nЧтобы пользоваться ботом <b>NeseritUserHunter</b>, необходимо подписаться на наш официальный канал:\n\n👉 <b>@neserit_dev</b>\n\n<i>После подписки нажмите кнопку «Проверить подписку» ниже!</i>`;
        const subKeyboard = Markup.inlineKeyboard([
          [Markup.button.url("📢 Подписаться на @neserit_dev", "https://t.me/neserit_dev")],
          [Markup.button.callback("[ 🔄 Проверить подписку ]", "check_sub")],
        ]);

        if (ctx.callbackQuery) {
          try {
            await ctx.answerCbQuery("⚠️ Необходима подписка на канал @neserit_dev!", { show_alert: true }).catch(() => {});
            await ctx.editMessageText(subText, { parse_mode: "HTML", ...subKeyboard });
          } catch (e) {
            await ctx.replyWithHTML(subText, subKeyboard).catch(() => {});
          }
        } else {
          await ctx.replyWithHTML(subText, subKeyboard).catch(() => {});
        }
        return;
      }

      return next();
    });

    bot.action("check_sub", async (ctx) => {
      const isSubscribed = await checkChannelSubscription(ctx);
      if (isSubscribed) {
        await ctx.answerCbQuery("✅ Подписка подтверждена! Добро пожаловать!", { show_alert: true }).catch(() => {});
        await sendMainInlineMenu(ctx);
      } else {
        await ctx.answerCbQuery("❌ Вы ещё не подписались на канал @neserit_dev!", { show_alert: true }).catch(() => {});
      }
    });

    // Helper for Reply Keyboard (Persistent bottom menu)
    const getReplyMenu = () => {
      return Markup.keyboard([
        [
          Markup.button.text("🏠 Главное меню"),
          Markup.button.text("🔍 Поиск юзернеймов"),
        ],
        [
          Markup.button.text("👤 Профиль"),
          Markup.button.text("💎 Премиум"),
          Markup.button.text("🎁 Бонусы"),
        ],
      ]).resize();
    };

    // Helper for Inline Main Menu (Interactive Switches included)
    const getMainInlineMenu = () => {
      return Markup.inlineKeyboard([
        [
          Markup.button.callback("[ 🔍 Поиск ]", "menu_search_hub"),
          Markup.button.callback("[ 🎛️ Переключатели ]", "menu_switches"),
        ],
        [
          Markup.button.callback("[ 👤 Профиль ]", "menu_profile"),
          Markup.button.callback("[ 💎 Премиум ]", "menu_premium"),
        ],
        [
          Markup.button.callback("[ 🎁 Бонусы ]", "menu_bonuses"),
        ],
      ]);
    };

    const sendMainInlineMenu = async (ctx: any) => {
      const session = getUserSession(ctx.from);
      session.awaitingLength = undefined;
      session.awaitingPromo = false;
      session.awaitingPattern = false;
      session.awaitingSingleCheck = false;
      saveUserSessions();
      const remaining = getRemainingAttempts(session);
      const text = `🤖 <b>ГЛАВНОЕ МЕНЮ | NeseritUserHunter</b>\n───────────────────\n\n⚡ <b>Умный сервис поиска юзернеймов Telegram & Fragment NFT (в бюджете до $300)</b>\n\n📊 <b>Остаток попыток:</b> <code>${remaining} / ${DAILY_LIMIT}</code>\n🎉 <b>Бета-тест:</b> все функции открыты бесплатно!\n___________________________________\n\n📢 <b>Новости:</b> @neserit_dev\n🧩Версия: Beta`;

      if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: "HTML", ...getMainInlineMenu() });
      } else {
        await ctx.replyWithHTML(text, {
          ...getMainInlineMenu(),
          ...getReplyMenu(),
        });
      }
    };

    const sendSwitchesMenu = async (ctx: any) => {
      const session = getUserSession(ctx.from);
      if (!session.settings) {
        session.settings = {
          mode: "standard",
          length: 6,
          style: "letters",
          strictFilter: true,
        };
      }
      const s = session.settings;

      const modeText = s.mode === "standard" ? "🟩 Стандартный (Свободные)" : "💎 Fragment NFT (до $300)";
      const styleText =
        s.style === "letters"
          ? "🔤 Только буквы"
          : s.style === "alphanumeric"
          ? "🔢 Буквы и цифры"
          : "⚡ Leetspeak";
      const filterText = s.strictFilter ? "✅ ВКЛ (Фильтр занятых)" : "❌ ВЫКЛ (Без фильтра)";

      const text = `🎛️ <b>ПЕРЕКЛЮЧАТЕЛИ И НАСТРОЙКИ ПОИСКА</b>\n───────────────────\n\nНажимайте на переключатели ниже, чтобы настроить параметры:\n\n• <b>Режим:</b> ${modeText}\n• <b>Длина:</b> <code>${s.length}</code> символов\n• <b>Стиль:</b> ${styleText}\n• <b>Строгий фильтр занятых:</b> ${filterText}\n___________________________________\n\n📢 <b>Новости:</b> @neserit_dev\n🧩Версия: Beta`;

      const buttons = Markup.inlineKeyboard([
        [
          Markup.button.callback(`⚙️ Режим: ${s.mode === "standard" ? "🟩 Стандарт" : "💎 Fragment"}`, "switch_mode"),
        ],
        [
          Markup.button.callback(`📏 Длина: ${s.length === 5 ? "✅ 5" : "5"}`, "switch_len:5"),
          Markup.button.callback(`${s.length === 6 ? "✅ 6" : "6"}`, "switch_len:6"),
          Markup.button.callback(`${s.length === 7 ? "✅ 7" : "7"}`, "switch_len:7"),
          Markup.button.callback(`${s.length === 8 ? "✅ 8" : "8"}`, "switch_len:8"),
        ],
        [
          Markup.button.callback(`🔤 ${s.style === "letters" ? "✅ Буквы" : "Буквы"}`, "switch_style:letters"),
          Markup.button.callback(`${s.style === "alphanumeric" ? "✅ Буквы+Цифры" : "Буквы+Цифры"}`, "switch_style:alphanumeric"),
          Markup.button.callback(`${s.style === "stylized" ? "✅ Leetspeak" : "Leetspeak"}`, "switch_style:stylized"),
        ],
        [
          Markup.button.callback(`🛡️ Фильтр занятых: ${s.strictFilter ? "✅ ВКЛ" : "❌ ВЫКЛ"}`, "switch_filter_toggle"),
        ],
        [
          Markup.button.callback("[ ⚡ ЗАПУСТИТЬ ПОИСК ПО НАСТРОЙКАМ ]", "exec_switch_search"),
        ],
        [
          Markup.button.callback("[ 🔍 Все варианты ]", "menu_search_hub"),
          Markup.button.callback("[ 🏠 Главное меню ]", "menu_home"),
        ],
      ]);

      if (ctx.callbackQuery) {
        try {
          await ctx.editMessageText(text, { parse_mode: "HTML", ...buttons });
        } catch (e) {
          await ctx.replyWithHTML(text, buttons);
        }
      } else {
        await ctx.replyWithHTML(text, buttons);
      }
    };

    const sendSearchHubMenu = async (ctx: any) => {
      const session = getUserSession(ctx.from);
      const remaining = getRemainingAttempts(session);
      if (remaining < 1) {
        return sendLimitExceededMessage(ctx);
      }
      session.awaitingLength = undefined;
      session.awaitingPromo = false;
      session.awaitingPattern = false;
      session.awaitingSingleCheck = false;
      saveUserSessions();

      const text = `🔍 <b>ПОИСК ЮЗЕРНЕЙМОВ</b>\n───────────────────\n\n📊 <b>Попыток:</b> <code>${remaining} / ${DAILY_LIMIT}</code>\n\n• <b>🎛️ Переключатели</b> — интерактивная панель настроек поиска\n• <b>Мгновенная проверка</b> — быстрая проверка любого логина\n• <b>Стандартный поиск</b> — подбор свободных юзернеймов\n• <b>Шаблонный поиск</b> — по маскам от 5 до 10 символов (<code>??okak</code>, <code>d?br?</code>)\n• <b>Fragment NFT (до $300)</b> — мониторинг доступных лотов в бюджете до $300\n___________________________________\n\n📢 <b>Новости:</b> @neserit_dev\n🧩Версия: Beta`;

      const buttons = Markup.inlineKeyboard([
        [Markup.button.callback("[ 🎛️ Переключатели и Настройки ]", "menu_switches")],
        [Markup.button.callback("[ ⚡ Мгновенная проверка ]", "menu_instant_check")],
        [Markup.button.callback("[ 🔍 Стандартный поиск ]", "wiz_type:standard")],
        [Markup.button.callback("[ 📐 Шаблонный поиск ]", "menu_pattern_search")],
        [Markup.button.callback("[ 💎 Fragment NFT ]", "wiz_type:fragment")],
        [Markup.button.callback("[ 🏠 Главное меню ]", "menu_home")],
      ]);

      if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: "HTML", ...buttons });
      } else {
        await ctx.replyWithHTML(text, buttons);
      }
    };

    const sendInstantCheckMenu = async (ctx: any) => {
      const session = getUserSession(ctx.from);
      const remaining = getRemainingAttempts(session);
      if (remaining < 1) {
        return sendLimitExceededMessage(ctx);
      }
      session.awaitingLength = undefined;
      session.awaitingPromo = false;
      session.awaitingPattern = false;
      session.awaitingSingleCheck = true;
      saveUserSessions();

      const text = `⚡ <b>МГНОВЕННАЯ ПРОВЕРКА</b>\n───────────────────\n\n📊 <b>Попыток:</b> <code>${remaining} / ${DAILY_LIMIT}</code>\n\n💬 <b>Напишите логин или слово в чат</b> для мгновенной проверки (например: <code>dobro</code>, <code>vortx</code>, <code>@alex</code>):\n___________________________________\n\n📢 <b>Новости:</b> @neserit_dev\n🧩Версия: Beta`;

      const buttons = Markup.inlineKeyboard([
        [Markup.button.callback("[ 🏠 Главное меню ]", "menu_home")],
      ]);

      if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: "HTML", ...buttons });
      } else {
        await ctx.replyWithHTML(text, buttons);
      }
    };

    const sendProfileMenu = async (ctx: any) => {
      const session = getUserSession(ctx.from);
      const remaining = getRemainingAttempts(session);
      const historyCount = session.searchHistory ? session.searchHistory.length : 0;

      const text = `👤 <b>ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ</b>\n───────────────────\n\n• <b>Пользователь:</b> ${ctx.from.first_name} (${ctx.from.username ? `@${ctx.from.username}` : "ID: " + ctx.from.id})\n• <b>Статус:</b> ⚡ Бета-Премиум (Бесплатно)\n• <b>Осталось попыток:</b> <code>${remaining} / ${DAILY_LIMIT}</code> (бонусы: <code>${session.bonusAttempts}</code>)\n• <b>Проверено всего:</b> <code>${historyCount}</code> юзернеймов\n___________________________________\n\n📢 <b>Новости:</b> @neserit_dev\n🧩Версия: Beta`;

      const buttons = Markup.inlineKeyboard([
        [Markup.button.callback("[ 📜 История проверок ]", "menu_history:0")],
        [Markup.button.callback("[ 🏠 Главное меню ]", "menu_home")],
      ]);

      if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: "HTML", ...buttons });
      } else {
        await ctx.replyWithHTML(text, buttons);
      }
    };

    const sendHistoryMenu = async (ctx: any, page: number = 0) => {
      const session = getUserSession(ctx.from);
      const history = session.searchHistory || [];

      if (history.length === 0) {
        const emptyText = `📜 <b>ИСТОРИЯ ПРОВЕРОК</b>\n───────────────────\n\n<i>Ваша история проверок пока пуста. Начните поиск, чтобы сохранить найденные логины!</i>\n___________________________________\n\n📢 <b>Новости:</b> @neserit_dev\n🧩Версия: Beta`;
        const emptyButtons = Markup.inlineKeyboard([
          [Markup.button.callback("[ 🔍 Начать поиск ]", "menu_search_hub")],
          [Markup.button.callback("[ 👤 Назад в Профиль ]", "menu_profile")],
          [Markup.button.callback("[ 🏠 Главное меню ]", "menu_home")],
        ]);

        if (ctx.callbackQuery) {
          return await ctx.editMessageText(emptyText, { parse_mode: "HTML", ...emptyButtons });
        } else {
          return await ctx.replyWithHTML(emptyText, emptyButtons);
        }
      }

      const PAGE_SIZE = 10;
      const totalPages = Math.ceil(history.length / PAGE_SIZE);
      const currentPage = Math.max(0, Math.min(page, totalPages - 1));
      const startIdx = currentPage * PAGE_SIZE;
      const pageItems = history.slice(startIdx, startIdx + PAGE_SIZE);

      let text = `📜 <b>ИСТОРИЯ ПРОВЕРОК (${history.length})</b>\n───────────────────\n\n💡 <i>Нажмите на юзернейм, чтобы скопировать его в буфер!</i>\n\n`;

      for (const item of pageItems) {
        let icon = "🔴";
        let statusLabel = "Занят";
        if (item.status === "available") {
          icon = "✅";
          statusLabel = "Свободен";
        } else if (item.status === "fragment" || item.status === "short_premium") {
          icon = "💎";
          statusLabel = "Fragment NFT";
        }

        text += `${icon} <b><code>@${item.username}</code></b> [${statusLabel}] — <i>${item.timestamp}</i>\n`;
      }

      text += `___________________________________\n\n📢 <b>Новости:</b> @neserit_dev\n🧩Версия: Beta`;

      const navButtons: any[] = [];
      if (totalPages > 1) {
        const row: any[] = [];
        if (currentPage > 0) {
          row.push(Markup.button.callback("⬅️ Назад", `menu_history:${currentPage - 1}`));
        }
        row.push(Markup.button.callback(`${currentPage + 1}/${totalPages}`, "noop"));
        if (currentPage < totalPages - 1) {
          row.push(Markup.button.callback("Вперед ➡️", `menu_history:${currentPage + 1}`));
        }
        navButtons.push(row);
      }

      navButtons.push([
        Markup.button.callback("[ 🗑 Очистить историю ]", "menu_clear_history"),
        Markup.button.callback("[ 👤 Профиль ]", "menu_profile"),
      ]);
      navButtons.push([Markup.button.callback("[ 🏠 Главное меню ]", "menu_home")]);

      if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: "HTML", ...Markup.inlineKeyboard(navButtons) });
      } else {
        await ctx.replyWithHTML(text, Markup.inlineKeyboard(navButtons));
      }
    };

    const sendPremiumMenu = async (ctx: any) => {
      const text = `💎 <b>ПРЕМИУМ ДОСТУП</b>\n───────────────────\n\n🎉 В период бета-теста все функции открыты бесплатно!\n\n• Быстрая проверка комбинаций\n• Шаблонный и Leetspeak поиск\n• Мониторинг Fragment NFT\n___________________________________\n\n📢 <b>Новости:</b> @neserit_dev\n🧩Версия: Beta`;

      const buttons = Markup.inlineKeyboard([
        [Markup.button.callback("[ ⚡ Активировать Бета-Премиум ]", "action_activate_beta")],
        [Markup.button.callback("[ 🏠 Главное меню ]", "menu_home")],
      ]);

      if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: "HTML", ...buttons });
      } else {
        await ctx.replyWithHTML(text, buttons);
      }
    };

    const sendBonusesMenu = async (ctx: any) => {
      const session = getUserSession(ctx.from);
      const refLink = `https://t.me/${botUser.username}?start=ref_${ctx.from.id}`;

      const text = `🎁 <b>БОНУСЫ И РЕФЕРАЛЫ</b>\n───────────────────\n\n💡 <b>Зачем нужны бонусы?</b>\nБонусные попытки не сгорают при ежедневном сбросе лимита и расходуются, когда исчерпан суточный лимит!\n\n• <b>Приглашено друзей:</b> <code>${session.referralCount}</code> (+5 попыток за каждого)\n• <b>Бонусных попыток на счету:</b> <code>${session.bonusAttempts}</code>\n• <b>Ваша реферальная ссылка:</b>\n<code>${refLink}</code>\n\n💬 Введите промокод или поделитесь ссылкой с друзьями.\n___________________________________\n\n📢 <b>Новости:</b> @neserit_dev\n🧩Версия: Beta`;

      const buttons = Markup.inlineKeyboard([
        [
          Markup.button.callback("[ 🎁 Промокод ]", "menu_enter_promo"),
          Markup.button.callback("[ 👥 Поделиться ]", "menu_share_ref"),
        ],
        [Markup.button.callback("[ 🏠 Главное меню ]", "menu_home")],
      ]);

      if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: "HTML", ...buttons });
      } else {
        await ctx.replyWithHTML(text, buttons);
      }
    };

    const sendPatternSearchMenu = async (ctx: any) => {
      const session = getUserSession(ctx.from);
      const remaining = getRemainingAttempts(session);
      if (remaining < 1) {
        return sendLimitExceededMessage(ctx);
      }
      session.awaitingPattern = true;
      saveUserSessions();

      const text = `📐 <b>ШАБЛОННЫЙ ПОИСК (5–10 СИМВОЛОВ)</b>\n───────────────────\n\nПоиск свободных юзернеймов по вашей маске <b>в пределах от 5 до 10 символов</b>.\n\nИспользуйте знак <b>?</b> на месте неизвестных символов.\n\n<i>Примеры масок (от 5 до 10 символов):</i>\n• <code>d?br?</code> (5 символов)\n• <code>??okak</code> (6 символов)\n• <code>cyber???</code> (8 символов)\n• <code>my_name_??</code> (10 символов)\n\n💬 <b>Напишите ваш шаблон (в пределах от 5 до 10 символов) прямо в чат:</b>\n___________________________________\n\n📢 <b>Новости:</b> @neserit_dev\n🧩Версия: Beta`;

      const buttons = Markup.inlineKeyboard([
        [Markup.button.callback("[ 🏠 Главное меню ]", "menu_home")],
      ]);

      if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: "HTML", ...buttons });
      } else {
        await ctx.replyWithHTML(text, buttons);
      }
    };

    const sendPatternCharTypeMenu = async (ctx: any, pattern: string) => {
      const session = getUserSession(ctx.from);
      const remaining = getRemainingAttempts(session);
      if (remaining < 1) {
        return sendLimitExceededMessage(ctx);
      }
      session.awaitingPattern = false;
      saveUserSessions();

      const text = `📐 <b>Шаблон:</b> <code>${pattern}</code>\n───────────────────\n\n<b>Выберите символы подстановки вместо «?»:</b>\n___________________________________\n\n📢 <b>Новости:</b> @neserit_dev\n🧩Версия: Beta`;
      const buttons = Markup.inlineKeyboard([
        [Markup.button.callback("[ 🔤 Только буквы ]", `pat_exec:${encodeURIComponent(pattern)}:letters`)],
        [Markup.button.callback("[ 🔢 Только цифры ]", `pat_exec:${encodeURIComponent(pattern)}:digits`)],
        [Markup.button.callback("[ 🔣 Буквы и цифры ]", `pat_exec:${encodeURIComponent(pattern)}:alphanumeric`)],
        [Markup.button.callback("[ 🏠 Главное меню ]", "menu_home")],
      ]);

      if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: "HTML", ...buttons });
      } else {
        await ctx.replyWithHTML(text, buttons);
      }
    };

    const sendLeetInfoMessage = async (ctx: any) => {
      const text = `🔤 <b>Стиль Leetspeak (Замена букв)</b>\n───────────────────\n\nБуквы меняются на цифры:\n• <code>a → 4</code> | <code>e → 3</code> | <code>i → 1</code> | <code>o → 0</code> | <code>s → 5</code> | <code>t → 7</code>\n\n<b>Выберите пример для проверки:</b>\n___________________________________\n\n📢 <b>Новости:</b> @neserit_dev\n🧩Версия: Beta`;

      const buttons = Markup.inlineKeyboard([
        [
          Markup.button.callback("[ master ]", "leet_check:master"),
          Markup.button.callback("[ alex ]", "leet_check:alex"),
        ],
        [
          Markup.button.callback("[ boss ]", "leet_check:boss"),
          Markup.button.callback("[ angel ]", "leet_check:angel"),
        ],
        [
          Markup.button.callback("[ ⚡ Запустить поиск ]", "wiz_style:standard:stylized"),
        ],
        [Markup.button.callback("[ 🏠 Главное меню ]", "menu_home")],
      ]);

      if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: "HTML", ...buttons });
      } else {
        await ctx.replyWithHTML(text, buttons);
      }
    };

    const processLeetSpeakCheck = async (ctx: any, word: string) => {
      const session = getUserSession(ctx.from);
      const variants = generateLeetSpeakVariants(word);
      const reqAttempts = variants.length || 1;
      const remaining = getRemainingAttempts(session);

      if (remaining < reqAttempts) {
        return ctx.replyWithHTML(
          `⚠️ <b>Недостаточно попыток!</b>\n\nДля проверки <b>${reqAttempts}</b> Leetspeak-вариантов слова «${word}» требуется ${reqAttempts} попыток, но у вас осталось <b>${remaining}</b>.\n\n💡 <i>Воспользуйтесь мгновенной проверкой по 1 слову или получите бесплатные бонусы!</i>`,
          Markup.inlineKeyboard([
            [Markup.button.callback("[ 🎁 Получить бонусы ]", "menu_bonuses")],
            [Markup.button.callback("[ ⚡ Мгновенная проверка ]", "menu_instant_check")],
            [Markup.button.callback("[ 🏠 Главное меню ]", "menu_home")],
          ])
        );
      }

      consumeAttempt(session, reqAttempts);
      addBotLog(`Leetspeak проверка для "${word}" [${variants.length} вариаций, списано ${reqAttempts} попыток] от @${ctx.from.username || ctx.from.id}`, "info");

      if (ctx.callbackQuery) {
        await ctx.editMessageText(`⏳ <b>Генерируем Leetspeak вариации для «${word}»...</b>`, { parse_mode: "HTML" });
      } else {
        await ctx.replyWithHTML(`⏳ <b>Генерируем Leetspeak вариации для «${word}»...</b>`);
      }

      const checks = await Promise.all(
        variants.map((v) => checkTelegramUsername(v, { checkFragment: true, timeoutMs: 2000 }))
      );
      const items = variants.map((v, i) => ({ username: v, status: checks[i].status }));
      const msg = formatSearchResultMessage(`LEETSPEAK ДЛЯ «${word.toUpperCase()}»`, items);

      const buttons: any[] = [];
      for (let i = 0; i < variants.length; i++) {
        const v = variants[i];
        const check = checks[i];
        if (check.status === "available") {
          buttons.push([Markup.button.url(`[ 🔗 Занять @${v} ]`, `https://t.me/${v}`)]);
        } else if (check.status === "fragment" || check.status === "short_premium") {
          buttons.push([Markup.button.url(`[ 💎 @${v} на Fragment ]`, `https://fragment.com/username/${v}`)]);
        }
      }

      buttons.push([
        Markup.button.callback("[ 🔤 Другое слово ]", "menu_leet_info"),
        Markup.button.callback("[ 🏠 Главное меню ]", "menu_home"),
      ]);

      await ctx.replyWithHTML(msg, Markup.inlineKeyboard(buttons));
    };

    const sendLimitExceededMessage = async (ctx: any) => {
      const text = `⚠️ <b>ЛИМИТ ПОПЫТОК ИСЧЕРПАН!</b>\n───────────────────\n\n🎉 В период бета-теста вы можете легко пополнить попытки:\n\n1️⃣ <b>Рефералы:</b> Пригласите друга (+5 попыток за каждого)\n2️⃣ <b>Суточный сброс:</b> Лимит обновляется каждые 24 часа\n___________________________________\n\n📢 <b>Новости:</b> @neserit_dev\n🧩Версия: Beta`;

      const buttons = Markup.inlineKeyboard([
        [Markup.button.callback("[ 🎁 Ввести Промокод ]", "menu_enter_promo")],
        [Markup.button.callback("[ 👥 Поделиться ссылкой (+5) ]", "menu_bonuses")],
        [Markup.button.callback("[ 🏠 Главное меню ]", "menu_home")],
      ]);

      if (ctx.callbackQuery) {
        try {
          await ctx.editMessageText(text, { parse_mode: "HTML", ...buttons });
        } catch (e) {
          await ctx.replyWithHTML(text, buttons);
        }
      } else {
        await ctx.replyWithHTML(text, buttons);
      }
    };

    // Helper to send Step 0 (Select Search Type)
    const sendStep0SearchType = async (ctx: any) => {
      const session = getUserSession(ctx.from);
      const remaining = getRemainingAttempts(session);
      if (remaining < 1) {
        return sendLimitExceededMessage(ctx);
      }

      const text = `🔍 <b>ПОИСК ЮЗЕРНЕЙМОВ</b>\n───────────────────\n\n📊 <b>Попыток:</b> <code>${remaining} / ${DAILY_LIMIT}</code>\n\n• <b>Мгновенная проверка</b> — проверка конкретного слова\n• <b>Стандартный поиск</b> — подбор свободных логинов\n• <b>Шаблонный поиск</b> — по маскам от 5 до 10 символов (<code>??okak</code>, <code>cyber???</code>)\n• <b>Мониторинг Fragment (до $300)</b> — подбор доступных лотов Fragment NFT в бюджете до $300 (~215 TON)\n___________________________________\n\n📢 <b>Новости:</b> @neserit_dev\n🧩Версия: Beta`;

      const buttons = Markup.inlineKeyboard([
        [Markup.button.callback("[ ⚡ Мгновенная проверка ]", "menu_instant_check")],
        [Markup.button.callback("[ 🔍 Стандартный поиск ]", "wiz_type:standard")],
        [Markup.button.callback("[ 📐 Шаблонный поиск ]", "menu_pattern_search")],
        [Markup.button.callback("[ 💎 Fragment NFT ]", "wiz_type:fragment")],
        [Markup.button.callback("[ 🏠 Главное меню ]", "menu_home")],
      ]);

      if (ctx.callbackQuery) {
        try {
          await ctx.editMessageText(text, { parse_mode: "HTML", ...buttons });
        } catch (e) {
          await ctx.replyWithHTML(text, buttons);
        }
      } else {
        await ctx.replyWithHTML(text, buttons);
      }
    };

    // Helper to send Step 1 (Select Style)
    const sendStep1Style = async (ctx: any, searchType: string = "standard") => {
      const session = getUserSession(ctx.from);
      const remaining = getRemainingAttempts(session);
      if (remaining < 1) {
        return sendLimitExceededMessage(ctx);
      }

      const typeLabel = searchType === "standard" ? "🔍 Стандартный поиск" : "💎 Мониторинг Fragment";
      const text = `⚙️ <b>ШАГ 1 ИЗ 3: СТИЛЬ ЮЗЕРНЕЙМОВ</b>\n───────────────────\n\n• <b>Режим:</b> ${typeLabel}\n\n<b>Выберите формат логина:</b>\n___________________________________\n\n📢 <b>Новости:</b> @neserit_dev\n🧩Версия: Beta`;
      const buttons = Markup.inlineKeyboard([
        [Markup.button.callback("[ 🔤 Только буквы (dobro) ]", `wiz_style:${searchType}:letters`)],
        [Markup.button.callback("[ 🔢 Буквы и цифры (d0bro) ]", `wiz_style:${searchType}:alphanumeric`)],
        [Markup.button.callback("[ ⚡ Стиль Leetspeak (m3cht4) ]", `wiz_style:${searchType}:stylized`)],
        [Markup.button.callback("[ 🏠 Главное меню ]", "menu_home")],
      ]);

      if (ctx.callbackQuery) {
        try {
          await ctx.editMessageText(text, { parse_mode: "HTML", ...buttons });
        } catch (e) {
          await ctx.replyWithHTML(text, buttons);
        }
      } else {
        await ctx.replyWithHTML(text, buttons);
      }
    };

    // Command /start (with Referral link support /start ref_123456)
    bot.start(async (ctx) => {
      const session = getUserSession(ctx.from);
      const text = ctx.message.text.trim();
      const refMatch = text.match(/\/start\s+ref_(\d+)/);

      if (refMatch) {
        const referrerId = parseInt(refMatch[1], 10);
        if (referrerId && referrerId !== ctx.from.id && !session.referredBy) {
          session.referredBy = referrerId;
          const refSession = userSessions.get(referrerId);
          if (refSession) {
            refSession.referralCount += 1;
            refSession.bonusAttempts += 5;
            saveUserSessions();
            try {
              await bot.telegram.sendMessage(
                referrerId,
                `🎉 <b>Новый реферал!</b>\nПользователь @${ctx.from.username || ctx.from.first_name} перешел по вашей ссылке. Начислено <b>+5 дополнительных попыток</b>!`,
                { parse_mode: "HTML" }
              );
            } catch (e) {
              // ignore if user blocked bot
            }
          }
          saveUserSessions();
        }
      }

      addBotLog(`Пользователь @${ctx.from.username || ctx.from.id} запустил /start`, "info");
      await sendMainInlineMenu(ctx);
    });

    // Commands
    bot.help(async (ctx) => await sendMainInlineMenu(ctx));
    bot.command("menu", async (ctx) => await sendMainInlineMenu(ctx));
    bot.command("profile", async (ctx) => await sendProfileMenu(ctx));
    bot.command("search", async (ctx) => await sendSearchHubMenu(ctx));

    // Command /promo CODE
    bot.command("promo", async (ctx) => {
      const session = getUserSession(ctx.from);
      const code = ctx.message.text.replace("/promo", "").trim();

      if (!code) {
        return ctx.replyWithHTML("🔑 <b>Использование:</b> <code>/promo ВАШ_ПРОМОКОД</code>");
      }

      const res = activatePromoCode(session, code);
      if (res.success) {
        return ctx.replyWithHTML(
          res.message,
          Markup.inlineKeyboard([[Markup.button.callback("🔍 Начать поиск", "menu_search_hub")]])
        );
      } else {
        return ctx.replyWithHTML(res.message);
      }
    });

    // Inline Actions
    bot.action("menu_home", async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await sendMainInlineMenu(ctx);
    });

    bot.action("menu_search_hub", async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await sendSearchHubMenu(ctx);
    });

    bot.action("menu_switches", async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await sendSwitchesMenu(ctx);
    });

    bot.action("switch_mode", async (ctx) => {
      const session = getUserSession(ctx.from);
      if (!session.settings) {
        session.settings = { mode: "standard", length: 6, style: "letters", strictFilter: true };
      }
      session.settings.mode = session.settings.mode === "standard" ? "fragment" : "standard";
      saveUserSessions();
      await ctx.answerCbQuery(`⚙️ Режим изменен на: ${session.settings.mode === "standard" ? "Стандартный" : "Fragment NFT"}`).catch(() => {});
      await sendSwitchesMenu(ctx);
    });

    bot.action(/^switch_len:(\d+)$/, async (ctx) => {
      const len = parseInt(ctx.match[1], 10);
      const session = getUserSession(ctx.from);
      if (!session.settings) {
        session.settings = { mode: "standard", length: 6, style: "letters", strictFilter: true };
      }
      session.settings.length = len;
      saveUserSessions();
      await ctx.answerCbQuery(`📏 Длина изменена: ${len} символов`).catch(() => {});
      await sendSwitchesMenu(ctx);
    });

    bot.action(/^switch_style:(.+)$/, async (ctx) => {
      const st = ctx.match[1] as "letters" | "alphanumeric" | "stylized";
      const session = getUserSession(ctx.from);
      if (!session.settings) {
        session.settings = { mode: "standard", length: 6, style: "letters", strictFilter: true };
      }
      session.settings.style = st;
      saveUserSessions();
      const styleName = st === "letters" ? "Только буквы" : st === "alphanumeric" ? "Буквы и цифры" : "Leetspeak";
      await ctx.answerCbQuery(`🔤 Стиль изменен: ${styleName}`).catch(() => {});
      await sendSwitchesMenu(ctx);
    });

    bot.action("switch_filter_toggle", async (ctx) => {
      const session = getUserSession(ctx.from);
      if (!session.settings) {
        session.settings = { mode: "standard", length: 6, style: "letters", strictFilter: true };
      }
      session.settings.strictFilter = !session.settings.strictFilter;
      saveUserSessions();
      await ctx.answerCbQuery(`🛡️ Фильтр занятых: ${session.settings.strictFilter ? "ВКЛЮЧЕН" : "ВЫКЛЮЧЕН"}`).catch(() => {});
      await sendSwitchesMenu(ctx);
    });

    bot.action("exec_switch_search", async (ctx) => {
      await ctx.answerCbQuery("⚡ Запуск поиска по вашим переключателям...").catch(() => {});
      const session = getUserSession(ctx.from);
      const s = session.settings || { mode: "standard", length: 6, style: "letters", strictFilter: true };
      await runWizGen(ctx, s.mode, s.style, s.length, 2);
    });

    bot.action("menu_instant_check", async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await sendInstantCheckMenu(ctx);
    });

    bot.action(/^instant_check:(.+)$/, async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      const handle = ctx.match[1];
      await processUsernameCheckInBot(ctx, handle);
    });

    bot.action("menu_profile", async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await sendProfileMenu(ctx);
    });

    bot.action(/^menu_history(?::(\d+))?$/, async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      const page = ctx.match[1] ? parseInt(ctx.match[1], 10) : 0;
      await sendHistoryMenu(ctx, page);
    });

    bot.action("menu_clear_history", async (ctx) => {
      await ctx.answerCbQuery("🗑 История очищена!").catch(() => {});
      const session = getUserSession(ctx.from);
      session.searchHistory = [];
      saveUserSessions();
      await sendHistoryMenu(ctx, 0);
    });

    bot.action("noop", async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
    });

    bot.action("menu_premium", async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await sendPremiumMenu(ctx);
    });

    bot.action("menu_bonuses", async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await sendBonusesMenu(ctx);
    });

    bot.action("menu_pattern_search", async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await sendPatternSearchMenu(ctx);
    });

    bot.action("menu_leet_info", async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await sendLeetInfoMessage(ctx);
    });

    bot.action("action_activate_beta", async (ctx) => {
      await ctx.answerCbQuery("⚡ Бета-Премиум уже активен!").catch(() => {});
      await sendProfileMenu(ctx);
    });

    bot.action("menu_share_ref", async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      const refLink = `https://t.me/${botUser.username}?start=ref_${ctx.from.id}`;
      await ctx.replyWithHTML(
        `🔗 <b>Ваша реферальная ссылка:</b>\n<code>${refLink}</code>\n\nОтправьте её друзьям! За каждого зарегистрированного друга вы получите <b>+5 дополнительных попыток поиска</b>!`
      );
    });

    bot.action("menu_enter_promo", async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      const session = getUserSession(ctx.from);
      session.awaitingPromo = true;
      await ctx.replyWithHTML(
        `🎁 <b>Введите промокод:</b>\n\nОтправьте ваше сообщение с промокодом прямо в чат.`
      );
    });

    bot.action(/^leet_check:(.+)$/, async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      const word = ctx.match[1];
      await processLeetSpeakCheck(ctx, word);
    });

    bot.action("menu_help", async (ctx) => {
      await ctx.answerCbQuery();
      const buttons = Markup.inlineKeyboard([
        [Markup.button.callback("🔤 Leetspeak стиль", "menu_leet_info")],
        [Markup.button.callback("🔍 Начать поиск", "menu_search_hub")],
        [Markup.button.callback("🏠 В Главное меню", "menu_home")],
      ]);
      await ctx.editMessageText(
        `📌 <b>ИНСТРУКЦИЯ И ВОЗМОЖНОСТИ БОТА:</b>\n───────────────────\n\n1️⃣ <b>Мгновенная проверка:</b> Просто отправьте любое слово или <code>@username</code> прямо в чат.\n2️⃣ <b>Поиск юзернеймов:</b> Автоматический подбор свободных коротких логинов.\n3️⃣ <b>Шаблоны:</b> Поиск по маскам в пределах от 5 до 10 символов (<code>d?br?</code>, <code>cyber???</code>, <code>my_name_??</code>).\n4️⃣ <b>Leetspeak:</b> Автозамена букв на цифры (<code>a→4</code>, <code>e→3</code>, <code>i→1</code>, <code>o→0</code>).\n5️⃣ <b>Fragment NFT:</b> Мониторинг доступных юзернеймов на Fragment в пределах бюджета до $300 (~215 TON).\n___________________________________\n\n📢 <b>Новости:</b> @neserit_dev\n🧩Версия: Beta`,
        { parse_mode: "HTML", ...buttons }
      );
    });

    bot.action(/^pat_preset:(.+)$/, async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      const pattern = ctx.match[1];
      await sendPatternCharTypeMenu(ctx, pattern);
    });

    bot.action(/^pat_select_type:(.+)$/, async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      const pattern = decodeURIComponent(ctx.match[1]);
      await sendPatternCharTypeMenu(ctx, pattern);
    });

    bot.action(/^pat_exec:(.+):(.+)$/, async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      const pattern = decodeURIComponent(ctx.match[1]);
      const charType = ctx.match[2];

      const session = getUserSession(ctx.from);
      const remaining = getRemainingAttempts(session);
      const reqAttempts = 1;

      if (remaining < reqAttempts) {
        return sendLimitExceededMessage(ctx);
      }

      const charTypeLabel =
        charType === "letters"
          ? "Буквы"
          : charType === "digits"
          ? "Цифры"
          : "Буквы+Цифры";

      try {
        await ctx.editMessageText(
          `⏳ <b>Поиск по шаблону «${pattern}» (${charTypeLabel})...</b>`,
          { parse_mode: "HTML" }
        );
      } catch (e) {
        try {
          await ctx.replyWithHTML(`⏳ <b>Поиск по шаблону «${pattern}» (${charTypeLabel})...</b>`);
        } catch (e2) {}
      }

      const maxTries = 15;
      let bestFoundResult: { username: string; check: any } | null = null;
      let lastCheckedResult: { username: string; check: any } | null = null;
      const testedUsernames = new Set<string>();

      for (let i = 0; i < maxTries; i++) {
        const batch = generateUsernamesFromPatternMask(pattern, charType, 10);
        let candidateToTest = "";
        for (const b of batch) {
          if (!testedUsernames.has(b)) {
            candidateToTest = b;
            break;
          }
        }
        if (!candidateToTest) break;

        testedUsernames.add(candidateToTest);
        const check = await checkTelegramUsername(candidateToTest, { checkFragment: true, timeoutMs: 2500 });
        lastCheckedResult = { username: candidateToTest, check };

        if (check.status === "available" || check.status === "fragment" || check.status === "short_premium") {
          bestFoundResult = { username: candidateToTest, check };
          break;
        }
      }

      const foundResult = bestFoundResult || lastCheckedResult;

      if (!foundResult) {
        const noResMarkup = Markup.inlineKeyboard([
          [Markup.button.callback("[ 📐 Другой шаблон ]", "menu_pattern_search")],
          [Markup.button.callback("[ 🏠 Главное меню ]", "menu_home")],
        ]);
        const noResText = `⚠️ Не удалось сгенерировать юзернеймы по шаблону «${pattern}».`;
        try {
          return await ctx.editMessageText(noResText, { parse_mode: "HTML", ...noResMarkup });
        } catch (e) {
          return await ctx.replyWithHTML(noResText, noResMarkup);
        }
      }

      consumeAttempt(session, 1);
      addBotLog(`Сработал шаблонный поиск «${pattern}» [${charType}, списана 1 попытка, результат: ${foundResult.username}] от @${ctx.from.username || ctx.from.id}`, "info");

      const c = foundResult.username;
      const st = foundResult.check.status;
      const rating = rateUsername(c);
      recordUserHistory(session, c, st);

      let msg = `🎁 <b>РЕЗУЛЬТАТ ПОИСКА ПО ШАБЛОНУ «${pattern}»:</b>\n\n`;
      const buttons: any[] = [];

      if (st === "available") {
        msg += `🟢 <b>Свободный юзернейм:</b>\n✅ <b><code>@${c}</code></b> ${rating.stars}\n⭐️ <b>Оценка:</b> ${rating.label} (<code>${rating.score}/10</code>)\n🎯 <b>Качество:</b> <i>${rating.reason}</i>\n`;
        buttons.push([Markup.button.url(`[ 🔗 Занять @${c} ]`, `https://t.me/${c}`)]);
      } else if (st === "fragment" || st === "short_premium") {
        msg += `💎 <b>Fragment NFT юзернейм:</b>\n💎 <b><code>@${c}</code></b> ${rating.stars}\n⭐️ <b>Оценка:</b> ${rating.label} (<code>${rating.score}/10</code>)\n🎯 <b>Качество:</b> <i>${rating.reason}</i>\n`;
        buttons.push([Markup.button.url(`[ 💎 Открыть @${c} на Fragment ]`, `https://fragment.com/username/${c}`)]);
      } else {
        msg += `🔴 <b><code>@${c}</code></b> — Занят ${rating.stars}\n⭐️ <b>Оценка:</b> ${rating.label} (<code>${rating.score}/10</code>)\n🎯 <b>Качество:</b> <i>${rating.reason}</i>\n\n<i>Попробуйте повторить поиск, чтобы найти свободный вариант!</i>\n`;
      }

      msg += `___________________________________\n\n📢 <b>Новости:</b> @neserit_dev\n🧩Версия: Beta`;

      buttons.push([
        Markup.button.callback("[ 🔄 НАЙТИ ЕЩЕ ВАРИАНТ ]", `pat_exec:${encodeURIComponent(pattern)}:${charType}`),
        Markup.button.callback("[ ⚙️ В ПОИСК ]", "menu_pattern_search"),
      ]);
      buttons.push([Markup.button.callback("[ 🏠 В МЕНЮ ]", "menu_home")]);

      const patMarkup = Markup.inlineKeyboard(buttons);
      try {
        await ctx.editMessageText(msg, { parse_mode: "HTML", ...patMarkup });
      } catch (e) {
        await ctx.replyWithHTML(msg, patMarkup);
      }
    });

    // Step 0 Callbacks
    bot.action(/^wiz_type:(.+)$/, async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      const type = ctx.match[1];
      if (type === "fragment") {
        await sendStep2LengthMenu(ctx, "fragment", "letters");
      } else {
        await sendStep1Style(ctx, type);
      }
    });

    bot.action("wiz_back_type", async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await sendStep0SearchType(ctx);
    });

    const sendStep2LengthMenu = async (ctx: any, searchType: string, style: string) => {
      const session = getUserSession(ctx.from);
      const remaining = getRemainingAttempts(session);
      if (remaining < 1) {
        return sendLimitExceededMessage(ctx);
      }
      session.awaitingLength = { searchType, style };
      saveUserSessions();

      const typeLabel = searchType === "standard" ? "🔍 Стандартный поиск" : "💎 Мониторинг Fragment (до $300)";
      const styleName =
        style === "letters"
          ? "Только буквы"
          : style === "alphanumeric"
          ? "Буквы и цифры"
          : "Стиль Leetspeak";

      const isFragment = searchType === "fragment";
      const stepTitle = isFragment
        ? "⚙️ ВЫБОР ДЛИНЫ ЮЗЕРНЕЙМА (4-9)"
        : "⚙️ ШАГ 2 ИЗ 3: ДЛИНА ЮЗЕРНЕЙМА (5-7)";

      let text = `<b>${stepTitle}</b>\n───────────────────\n\n• <b>Режим:</b> ${typeLabel}\n• <b>Стиль:</b> ${styleName}\n\n<b>Укажите длину юзернейма (${isFragment ? "от 4 до 9" : "5, 6 или 7"} символов):</b>\n___________________________________\n\n📢 <b>Новости:</b> @neserit_dev\n🧩Версия: Beta`;
      let buttonsArr: any[] = [];

      if (isFragment) {
        buttonsArr = [
          [
            Markup.button.callback("[ 4 символа ]", `wiz_len:${searchType}:${style}:4`),
            Markup.button.callback("[ 5 символов ]", `wiz_len:${searchType}:${style}:5`),
            Markup.button.callback("[ 6 символов ]", `wiz_len:${searchType}:${style}:6`),
          ],
          [
            Markup.button.callback("[ 7 символов ]", `wiz_len:${searchType}:${style}:7`),
            Markup.button.callback("[ 8 символов ]", `wiz_len:${searchType}:${style}:8`),
            Markup.button.callback("[ 9 символов ]", `wiz_len:${searchType}:${style}:9`),
          ],
          [Markup.button.callback("[ 🏠 Главное меню ]", "menu_home")],
        ];
      } else {
        buttonsArr = [
          [
            Markup.button.callback("[ 5 символов ]", `wiz_len:${searchType}:${style}:5`),
            Markup.button.callback("[ 6 символов ]", `wiz_len:${searchType}:${style}:6`),
            Markup.button.callback("[ 7 символов ]", `wiz_len:${searchType}:${style}:7`),
          ],
          [Markup.button.callback("[ 🏠 Главное меню ]", "menu_home")],
        ];
      }

      const buttons = Markup.inlineKeyboard(buttonsArr);

      if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: "HTML", ...buttons });
      } else {
        await ctx.replyWithHTML(text, buttons);
      }
    };

    const sendStep3CountMenu = async (ctx: any, searchType: string, style: string, length: string) => {
      const session = getUserSession(ctx.from);
      const remaining = getRemainingAttempts(session);
      if (remaining < 1) {
        return sendLimitExceededMessage(ctx);
      }

      const typeLabel = searchType === "standard" ? "🔍 Стандартный поиск" : "💎 Мониторинг Fragment";
      const styleName =
        style === "letters"
          ? "Только буквы"
          : style === "alphanumeric"
          ? "Буквы и цифры"
          : "Стиль Leetspeak";

      const text = `<b>⚙️ ШАГ 3 ИЗ 3: КОЛИЧЕСТВО ВАРИАНТОВ</b>\n───────────────────\n\n• Режим: <b>${typeLabel}</b>\n• Параметры: <b>${styleName} | ${length} символов</b>\n\n<b>Сколько свободных юзернеймов найти за 1 поиск?</b>\n___________________________________\n\n📢 <b>Новости:</b> @neserit_dev\n🧩Версия: Beta`;
      const buttons = Markup.inlineKeyboard([
        [
          Markup.button.callback("[ 1 вариант ]", `wiz_gen:${searchType}:${style}:${length}:1`),
          Markup.button.callback("[ 2 варианта ]", `wiz_gen:${searchType}:${style}:${length}:2`),
          Markup.button.callback("[ 3 варианта ]", `wiz_gen:${searchType}:${style}:${length}:3`),
        ],
        [Markup.button.callback("[ 🏠 Главное меню ]", "menu_home")],
      ]);

      if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: "HTML", ...buttons });
      } else {
        await ctx.replyWithHTML(text, buttons);
      }
    };

    // Step 1 -> Step 2
    bot.action(/^wiz_style:(.+):(.+)$/, async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      const searchType = ctx.match[1];
      const style = ctx.match[2];
      await sendStep2LengthMenu(ctx, searchType, style);
    });

    const runWizGen = async (ctx: any, searchType: string, style: string, length: number, requestedCount: number) => {
      const count = searchType === "fragment" ? 1 : Math.max(1, requestedCount);

      const session = getUserSession(ctx.from);
      const remaining = getRemainingAttempts(session);

      if (remaining < count) {
        return sendLimitExceededMessage(ctx);
      }

      consumeAttempt(session, count);

      const typeLabel = searchType === "standard" ? "🔍 Стандартный поиск (Свободные)" : "💎 Мониторинг Fragment (NFT)";
      const styleName =
        style === "letters"
          ? "Только буквы"
          : style === "alphanumeric"
          ? "Буквы и цифры"
          : "Стиль / Leetspeak";

      addBotLog(`Запуск поиска [Режим: ${searchType}, Стиль: ${style}, Длина: ${length}, Кол-во: ${count}] от @${ctx.from.username || ctx.from.id}`, "info");

      const initialStatusText = `⏳ <b>ПОИСК ЮЗЕРНЕЙМОВ В TELEGRAM</b>\n───────────────────\n\n• Режим: <b>${typeLabel}</b>\n• Стиль: <b>${styleName}</b>\n• Длина: <b>${length} символов</b>\n• Найдено: <b>0 из ${count}</b>\n\n📊 <b>Прогресс проверки:</b>\n<code>[]</code> <b>(0/100)</b>\n\n<i>Сканируем комбинации, пожалуйста подождите...</i>`;

      try {
        await ctx.editMessageText(initialStatusText, { parse_mode: "HTML" });
      } catch (e) {
        try {
          await ctx.replyWithHTML(initialStatusText);
        } catch (e2) {}
      }

      // Requirement 3: Trigger AI candidate generation asynchronously so search starts IMMEDIATELY!
      const aiCandidatesPromise = (async () => {
        try {
          const ai = getGenAI();
          let formatGuidance = "";
          if (style === "letters") {
            formatGuidance = `ТОЛЬКО латинские буквы a-z без цифр и КАТЕГОРИЧЕСКИ без подчёркиваний! Каждое имя должно состоять СТРОГО из ${length} букв (пример для длины 6: novafx, zealix, vybexx, kynora, soliva, flowzr, echoxx, herohq, sokolx, rubinx). НИКАКИХ ПОДЧЁРКИВАНИЙ!`;
          } else if (style === "alphanumeric") {
            formatGuidance = `латинские буквы с 1-2 цифрами. СТРОГОЕ ПРАВИЛО: максимум 2 цифры в никнейме, и цифры НИКОГДА НЕ ДОЛЖНЫ СТОЯТЬ РЯДОМ, итоговая длина СТРОГО ${length} символов без подчёркиваний! Пример: n5v1x, x7prx, v0rtx`;
          } else {
            formatGuidance = `стилизованный leetspeak с заменой букв на сходные цифры (o->0, e->3, i->1, a->4, s->5, t->7, b->8, g->9, z->2). СТРОГОЕ ПРАВИЛО: максимум 2 цифры в никнейме, и цифры НИКОГДА НЕ ДОЛЖНЫ СТОЯТЬ РЯДОМ, итоговая длина СТРОГО ${length} символов! (пример: 4en3rx или v0rtxz — ПРАВИЛЬНО).`;
          }

          const prompt = `Сгенерируй ровно 15 уникальных, красивых и эстетичных юзернеймов Telegram.
КРИТИЧЕСКИЕ ТРЕБОВАНИЯ:
1. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО генерировать простые слова и простые комбинации 2-буквенных приставок со словами (например gghonor, mylucht, cyhacip, progamer, topcoder) — такие ники на 100% ЗАНЯТЫ личными профилями Telegram ("ники-ловушки")!
2. ОБЯЗАТЕЛЬНО генерируй исключительно оригинальные, стилизованные юзернеймы: с оригинальными суффиксами (fx, hq, io, lab, net, blx, app, dev, co, ix, ex, ox, is, ra, va, zr), стилизацией leetspeak или нетривиальными слияниями двух коротким морфем! (Внимание: если стиль "Только буквы", ЗАПРЕЩЕНО использовать подчёркивания!).
3. Каждое имя ДОЛЖНО БЫТЬ ПОХОЖЕ НА НАСТОЯЩИЕ АНГЛИЙСКИЕ ИЛИ РУССКИЕ СЛОВА (или их транслит/стилизацию).
4. СТРОГО ЗАПРЕЩЕНЫ бессмысленные наборы букв (например "qxvzk" или "xzbqw")! Имя должно легко читаться.
5. Длина каждого юзернейма: РОВНО ${length} символов!
6. Формат и стиль: ${formatGuidance}.
7. Ограничение на цифры: МАКСИМУМ 2 цифры в юзернейме, и цифры НИКОГДА НЕ ДОЛЖНЫ СТОЯТЬ РЯДОМ! (Пример: 4en3r, d0bro, m3chta — ПРАВИЛЬНО. 43uner — СТРОГО ЗАПРЕЩЕНО).
8. Уникальное зерно генерации: ${Date.now()}_${Math.floor(Math.random() * 10000)}.

Верни JSON с массивом объектов usernames: [{username, meaning}].`;

          const response = await ai.models.generateContent({
            model: "gemini-3.6-flash",
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  usernames: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        username: { type: Type.STRING },
                        meaning: { type: Type.STRING },
                      },
                    },
                  },
                },
              },
            },
          });

          const data = JSON.parse(response.text || "{}");
          return data.usernames || [];
        } catch (aiErr: any) {
          addBotLog(`AI генерация временно недоступна (${aiErr.message}), используем внутренний генератор кандидатов`, "info");
          return [];
        }
      })();

      try {
        let lastEditTime = 0;
        // Requirement 4: Visual progress bar grouped by tens (10 проверено, 20 проверено) with 🟩 (Available), 🟥 (Taken), 🟦 (Fragment)
        const onProgress = async (info: { checkedCount: number; currentStrategy: string; foundCount: number; blocks: string[] }) => {
          const now = Date.now();
          if (info.checkedCount > 1 && now - lastEditTime < 600 && info.foundCount === 0 && info.checkedCount % 10 !== 0) return;
          lastEditTime = now;

          try {
            const totalBlocks = info.blocks;
            const completedTens = Math.floor(totalBlocks.length / 10);
            const decadeLines: string[] = [];

            for (let i = 0; i < completedTens; i++) {
              const tenBlocks = totalBlocks.slice(i * 10, (i + 1) * 10).join("");
              decadeLines.push(`• <b>${(i + 1) * 10} проверено:</b> <code>[${tenBlocks}]</code>`);
            }

            const currentRem = totalBlocks.length % 10;
            if (currentRem > 0) {
              const remBlocks = totalBlocks.slice(completedTens * 10).join("");
              decadeLines.push(`• <b>${totalBlocks.length} проверено:</b> <code>[${remBlocks}]</code>`);
            }

            const progressBarText = decadeLines.length > 0
              ? decadeLines.join("\n")
              : `<code>[${totalBlocks.join("")}]</code> (${info.checkedCount} проверено)`;

            const statusText = `⏳ <b>ПОИСК ЮЗЕРНЕЙМОВ В TELEGRAM</b>\n───────────────────\n\n• Режим: <b>${typeLabel}</b>\n• Стиль: <b>${styleName}</b>\n• Длина: <b>${length} символов</b>\n• Найдено: <b>${info.foundCount} из ${count}</b>\n\n📊 <b>Прогресс проверки по десяткам:</b>\n${progressBarText}\n\n<i>Сканируем комбинации, пожалуйста подождите...</i>`;

            await ctx.editMessageText(statusText, { parse_mode: "HTML" });
          } catch (e) {
            // Ignore edit message rate limit errors
          }
        };

        const checkedResults = await searchValidUsernames({
          searchType,
          style,
          length,
          targetCount: count,
          aiCandidatesPromise,
          onProgress,
        });

        if (checkedResults.length === 0) {
          const noResultsText =
            searchType === "fragment"
              ? `⚠️ <b>На Fragment в данный момент не найдено доступных юзернеймов заданной длины (${length} символов) в бюджете до $300.</b>\n\nПопробуйте повторить поиск или изменить параметры!`
              : `⚠️ <b>Не удалось подобрать свободные юзернеймы (${length} символов, стиль: ${styleName}).</b>\n\nНажмите кнопку ниже, чтобы запустить повторный поиск!`;

          const noResMarkup = Markup.inlineKeyboard([
            [Markup.button.callback("[ 🔄 Найти еще варианты ]", `wiz_gen:${searchType}:${style}:${length}:${count}`)],
            [Markup.button.callback("[ ⚙️ Изменить параметры ]", "wiz_back_type")],
            [Markup.button.callback("[ 🏠 Главное меню ]", "menu_home")],
          ]);

          try {
            return await ctx.editMessageText(noResultsText, { parse_mode: "HTML", ...noResMarkup });
          } catch (e) {
            return await ctx.replyWithHTML(noResultsText, noResMarkup);
          }
        }

        const headerTitle =
          searchType === "fragment"
            ? "💎 <b>Fragment NFT юзернеймы (в пределах до $300):</b>"
            : "🟢 <b>Свободные красивые юзернеймы:</b>";

        let msg = `🎁 <b>РЕЗУЛЬТАТЫ ПОИСКА</b>\n───────────────────\n\n${headerTitle}\n\n`;
        const actionButtons: any[] = [];

        for (let i = 0; i < checkedResults.length; i++) {
          const res = checkedResults[i];
          const st = res.check.status;
          const rating = rateUsername(res.username);

          recordUserHistory(session, res.username, st);

          if (st === "available") {
            msg += `✅ <b><code>@${res.username}</code></b> ${rating.stars}\n   └ ${rating.label} (<i>${rating.reason}</i>)\n`;
            actionButtons.push([Markup.button.url(`[ 🔗 Занять @${res.username} ]`, `https://t.me/${res.username}`)]);
          } else if (st === "fragment" || st === "short_premium") {
            msg += `💎 <b><code>@${res.username}</code></b> ${rating.stars} — Fragment NFT\n   └ ${rating.label} (<i>${rating.reason}</i>)\n`;
            actionButtons.push([Markup.button.url(`[ 💎 Открыть @${res.username} на Fragment ]`, `https://fragment.com/username/${res.username}`)]);
          } else {
            msg += `🔴 <b><code>@${res.username}</code></b> — Занят\n`;
          }
        }

        msg += `___________________________________\n\n📢 <b>Новости:</b> @neserit_dev\n🧩Версия: Beta`;

        actionButtons.push([
          Markup.button.callback("[ 🔄 ПОВТОРИТЬ ПОИСК ]", `wiz_gen:${searchType}:${style}:${length}:${count}`),
          Markup.button.callback("[ 🏠 ГЛАВНОЕ МЕНЮ ]", "menu_home"),
        ]);

        const finalMarkup = Markup.inlineKeyboard(actionButtons);
        try {
          await ctx.editMessageText(msg, { parse_mode: "HTML", ...finalMarkup });
        } catch (e) {
          await ctx.replyWithHTML(msg, finalMarkup);
        }
      } catch (err: any) {
        addBotLog(`Ошибка поиска: ${err.message}`, "error");
        const errMarkup = Markup.inlineKeyboard([[Markup.button.callback("🔄 Попробовать снова", "wiz_back_type")]]);
        try {
          await ctx.editMessageText(`⚠️ <b>Ошибка:</b> ${err.message}`, { parse_mode: "HTML", ...errMarkup });
        } catch (e) {
          await ctx.replyWithHTML(`⚠️ <b>Ошибка:</b> ${err.message}`, errMarkup);
        }
      }
    };

    // Step 2 -> Step 3 (or direct run for fragment)
    bot.action(/^wiz_len:(.+):(.+):(\d+)$/, async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      const searchType = ctx.match[1];
      const style = ctx.match[2];
      const length = ctx.match[3];

      const session = getUserSession(ctx.from);
      session.awaitingLength = undefined;
      saveUserSessions();

      if (searchType === "fragment") {
        return await runWizGen(ctx, searchType, style, parseInt(length, 10), 1);
      }

      await sendStep3CountMenu(ctx, searchType, style, length);
    });

    // Step 3 -> Execute Generation & Check
    bot.action(/^wiz_gen:(.+):(.+):(\d+):(\d+)$/, async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      const searchType = ctx.match[1];
      const style = ctx.match[2];
      const length = parseInt(ctx.match[3], 10);
      const count = parseInt(ctx.match[4], 10);

      await runWizGen(ctx, searchType, style, length, count);
    });

    // Command /find fallback
    bot.command("find", async (ctx) => await sendStep1Style(ctx));

    // Command /check
    bot.command("check", async (ctx) => {
      const handle = ctx.message.text.replace("/check", "").trim();
      if (!handle) return ctx.reply("Укажите юзернейм: /check my_username");
      await processUsernameCheckInBot(ctx, handle);
    });

    // AI Admin Command Processor
    const processAdminAiCommand = async (ctx: any, promptText: string) => {
      const userId = ctx.from.id;
      if (!isUserAdmin(userId, ctx.from.username)) {
        return ctx.replyWithHTML(
          `⛔ <b>Доступ запрещен!</b>\n\nВы не являетесь администратором бота.`,
          Markup.inlineKeyboard([[Markup.button.callback("[ 🏠 Главное меню ]", "menu_home")]])
        );
      }

      const cleanPrompt = promptText.trim();

      if (!cleanPrompt) {
        const text = `🤖 <b>AI-ПАНЕЛЬ АДМИНИСТРАТОРА | NeseritUserHunter</b>\n───────────────────\n\n🧠 <b>AI Движок:</b> Gemini 2.5 Flash\n👥 <b>Пользователей в базе:</b> <code>${userSessions.size}</code>\n🎟️ <b>Активных промокодов:</b> <code>${Object.keys(VALID_PROMOS).length}</code>\n👑 <b>Администраторов:</b> <code>${adminUserIds.size}</code>\n\n⚡ <b>БЫСТРЫЕ КОМАНДЫ (СУБКОМАНДЫ):</b>\n• <code>/admin user @username</code> — найти полную инфу, найденные никнеймы и попытки юзера\n• <code>/admin clear_promos</code> — деактивировать ВСЕ промокоды\n• <code>/admin create_promo BETA 100</code> — создать промокод\n• <code>/admin del_promo BETA</code> — удалить промокод\n• <code>/admin promos</code> — список промокодов\n• <code>/admin add_bonus @user 20</code> — начислить бонусы\n• <code>/admin set_bonus @user 100</code> — установить баланс\n• <code>/admin reset @user</code> — сбросить суточный лимит\n• <code>/admin stats</code> — статистика бота\n• <code>/admin users</code> — список пользователей\n• <code>/admin add_admin @user</code> — назначить админа\n• <code>/admin del_admin @user</code> — снять админа\n• <code>/admin broadcast ТЕКСТ</code> — рассылка всем\n\n💬 <b>ИЛИ ПИШИТЕ В СВОБОДНОЙ ФОРМЕ НА РУССКОМ:</b>\n• <i>/admin Покажи полную инфу и найденные юзернеймы пользователя @username</i>\n• <i>/admin Деактивируй все промокоды действующие в данный момент</i>\n• <i>/admin Начисли пользователю @username 50 бонусов</i>\n___________________________________\n\n📢 <b>Управление ботом в реальном времени</b>`;

        const buttons = Markup.inlineKeyboard([
          [
            Markup.button.callback("[ 📊 Статистика ]", "adm_stats"),
            Markup.button.callback("[ 🎟️ Промокоды ]", "adm_promos"),
          ],
          [
            Markup.button.callback("[ 👥 Список юзеров ]", "adm_users"),
            Markup.button.callback("[ 🔍 Найти пользователя ]", "adm_search_user"),
          ],
          [
            Markup.button.callback("[ 👑 Админы ]", "adm_list_admins"),
          ],
          [Markup.button.callback("[ 🏠 Главное меню ]", "menu_home")],
        ]);

        if (ctx.callbackQuery) {
          return await ctx.editMessageText(text, { parse_mode: "HTML", ...buttons });
        } else {
          return await ctx.replyWithHTML(text, buttons);
        }
      }

      let responseData: any = null;

      // Direct fast subcommand router (bypasses Gemini for 100% immediate execution)
      const lowerPrompt = cleanPrompt.toLowerCase();
      if (/^(?:clear_promos|clear_promocodes|deactivate_all_promos|деактивируй_все|деактивировать все промокоды|деактивируй все промокоды|деактивируй все промокоды действующие в данный момент|удали все промокоды)$/i.test(lowerPrompt)) {
        responseData = { explanation: "Деактивация всех действующих промокодов", actions: [{ action: "deactivate_all_promocodes" }] };
      } else if (/^(?:promos|promocodes|промокоды|список промов)$/i.test(lowerPrompt)) {
        responseData = { explanation: "Запрос списка промокодов", actions: [{ action: "list_promocodes" }] };
      } else if (/^(?:stats|stat|статистика|стата)$/i.test(lowerPrompt)) {
        responseData = { explanation: "Запрос статистики", actions: [{ action: "get_bot_stats" }] };
      } else if (/^(?:users|юзеры|список юзеров)$/i.test(lowerPrompt)) {
        responseData = { explanation: "Запрос списка пользователей", actions: [{ action: "list_users" }] };
      } else if (/^(?:user|user_info|find_user|info|инфо|информация|инфа|юзер|пользователь|найти|покажи)\s*(?:о|по|про|для)?\s*(@?[a-zA-Z0-9_]+)$/i.test(cleanPrompt)) {
        const m = cleanPrompt.match(/^(?:user|user_info|find_user|info|инфо|информация|инфа|юзер|пользователь|найти|покажи)\s*(?:о|по|про|для)?\s*(@?[a-zA-Z0-9_]+)$/i)!;
        responseData = { explanation: `Поиск полной информации о пользователе ${m[1]}`, actions: [{ action: "get_user_info", target: m[1] }] };
      } else if (/^create_promo(?:code)?\s+([a-zA-Z0-9_А-Яа-я-]+)(?:\s+(\d+))?(?:\s+(\d+))?/i.test(cleanPrompt)) {
        const m = cleanPrompt.match(/^create_promo(?:code)?\s+([a-zA-Z0-9_А-Яа-я-]+)(?:\s+(\d+))?(?:\s+(\d+))?/i)!;
        const code = m[1].toUpperCase();
        const reward = m[2] ? parseInt(m[2], 10) : 15;
        const maxUses = m[3] ? parseInt(m[3], 10) : 0;
        responseData = { explanation: `Создание промокода ${code}`, actions: [{ action: "create_promocode", code, reward, maxUses }] };
      } else if (/^del_promo(?:code)?\s+([a-zA-Z0-9_А-Яа-я-]+)/i.test(cleanPrompt)) {
        const m = cleanPrompt.match(/^del_promo(?:code)?\s+([a-zA-Z0-9_А-Яа-я-]+)/i)!;
        responseData = { explanation: `Удаление промокода ${m[1].toUpperCase()}`, actions: [{ action: "delete_promocode", code: m[1] }] };
      } else if (/^add_bonus(?:\s+(@?[a-zA-Z0-9_А-Яа-я-]+))?\s+(\d+)(?:\s+(.+))?/i.test(cleanPrompt)) {
        const m = cleanPrompt.match(/^add_bonus(?:\s+(@?[a-zA-Z0-9_А-Яа-я-]+))?\s+(\d+)(?:\s+(.+))?/i)!;
        let target = m[1] || "мне";
        let count = parseInt(m[2], 10);
        let note = m[3] ? m[3].trim() : undefined;
        if (/^\d+$/.test(target) && parseInt(target, 10) > 0 && !m[2]) {
          count = parseInt(target, 10);
          target = "мне";
        }
        responseData = { explanation: `Начисление бонусов`, actions: [{ action: "add_user_bonus", target, bonusCount: count, message: note }] };
      } else if (/^set_bonus(?:\s+(@?[a-zA-Z0-9_А-Яа-я-]+))?\s+(\d+)(?:\s+(.+))?/i.test(cleanPrompt)) {
        const m = cleanPrompt.match(/^set_bonus(?:\s+(@?[a-zA-Z0-9_А-Яа-я-]+))?\s+(\d+)(?:\s+(.+))?/i)!;
        responseData = { explanation: `Установка баланса`, actions: [{ action: "set_user_bonus", target: m[1] || "мне", bonusCount: parseInt(m[2], 10), message: m[3] ? m[3].trim() : undefined }] };
      } else if (/^(?:msg|message|напиши|написать|сообщение)\s+(@?[a-zA-Z0-9_А-Яа-я]+)\s+(.+)/i.test(cleanPrompt)) {
        const m = cleanPrompt.match(/^(?:msg|message|напиши|написать|сообщение)\s+(@?[a-zA-Z0-9_А-Яа-я]+)\s+(.+)/i)!;
        responseData = { explanation: `Отправка личного сообщения пользователю ${m[1]}`, actions: [{ action: "send_user_message", target: m[1], message: m[2].trim() }] };
      } else if (/(?:начисли|дай|добавь|пополни|выдай|добавить)\s+(?:пользователю\s+|юзеру\s+)?(@?[a-zA-Z0-9_А-Яа-я]+)\s+(\d+)\s*(?:бонусов|попыток)?(?:\s+(?:с пометкой|с текстом|с сообщением|причина|сообщение)?\s*["«'”]?([^"»'”]+)["»'”]?)?/i.test(cleanPrompt)) {
        const m = cleanPrompt.match(/(?:начисли|дай|добавь|пополни|выдай|добавить)\s+(?:пользователю\s+|юзеру\s+)?(@?[a-zA-Z0-9_А-Яа-я]+)\s+(\d+)\s*(?:бонусов|попыток)?(?:\s+(?:с пометкой|с текстом|с сообщением|причина|сообщение)?\s*["«'”]?([^"»'”]+)["»'”]?)?/i)!;
        responseData = { explanation: `Начисление ${m[2]} бонусов ${m[1]}`, actions: [{ action: "add_user_bonus", target: m[1], bonusCount: parseInt(m[2], 10), message: m[3] ? m[3].trim() : undefined }] };
      } else if (/(?:начисли|дай|добавь|пополни|выдай|добавить)\s+(?:пользователю\s+|юзеру\s+)?(\d+)\s+(?:бонусов|попыток)?\s*(@?[a-zA-Z0-9_А-Яа-я]+)?/i.test(cleanPrompt)) {
        const m = cleanPrompt.match(/(?:начисли|дай|добавь|пополни|выдай|добавить)\s+(?:пользователю\s+|юзеру\s+)?(\d+)\s+(?:бонусов|попыток)?\s*(@?[a-zA-Z0-9_А-Яа-я]+)?/i)!;
        const count = parseInt(m[1], 10);
        const target = m[2] || "мне";
        responseData = { explanation: `Начисление ${count} бонусов ${target}`, actions: [{ action: "add_user_bonus", target, bonusCount: count }] };
      } else if (/(?:начисли|дай|добавь|пополни|выдай|добавить)\s+(?:мне|себе|меня)?\s*(\d+)\s*(?:бонусов|попыток)?/i.test(cleanPrompt)) {
        const m = cleanPrompt.match(/(?:начисли|дай|добавь|пополни|выдай|добавить)\s+(?:мне|себе|меня)?\s*(\d+)\s*(?:бонусов|попыток)?/i)!;
        const count = parseInt(m[1], 10);
        responseData = { explanation: `Начисление ${count} бонусов мне`, actions: [{ action: "add_user_bonus", target: "мне", bonusCount: count }] };
      } else if (/^reset(?:\s+(@?[a-zA-Z0-9_А-Яа-я-]+))?/i.test(cleanPrompt)) {
        const m = cleanPrompt.match(/^reset(?:\s+(@?[a-zA-Z0-9_А-Яа-я-]+))?/i)!;
        responseData = { explanation: `Сброс лимитов ${m[1] || "мне"}`, actions: [{ action: "reset_user_attempts", target: m[1] || "мне" }] };
      } else if (/^add_admin\s+(@?[a-zA-Z0-9_]+)/i.test(cleanPrompt)) {
        const m = cleanPrompt.match(/^add_admin\s+(@?[a-zA-Z0-9_]+)/i)!;
        responseData = { explanation: `Назначение админа ${m[1]}`, actions: [{ action: "add_admin", target: m[1] }] };
      } else if (/^del_admin\s+(@?[a-zA-Z0-9_]+)/i.test(cleanPrompt)) {
        const m = cleanPrompt.match(/^del_admin\s+(@?[a-zA-Z0-9_]+)/i)!;
        responseData = { explanation: `Снятие админа ${m[1]}`, actions: [{ action: "remove_admin", target: m[1] }] };
      } else if (/^broadcast\s+(.+)/i.test(cleanPrompt)) {
        const m = cleanPrompt.match(/^broadcast\s+(.+)/i)!;
        responseData = { explanation: "Запуск рассылки", actions: [{ action: "broadcast_message", text: m[1] }] };
      }

      let loadingMsg: any = null;
      if (!responseData) {
        try {
          loadingMsg = await ctx.replyWithHTML(`⏳ <i>AI-ассистент обрабатывает запрос:</i>\n«<code>${cleanPrompt}</code>»...`);
        } catch (e) {
          // ignore
        }

        try {
          const ai = getGenAI();
          const systemPrompt = `Ты AI-управляющий администратор Telegram-бота для поиска юзернеймов NeseritUserHunter.
Твоя ключевая обязанность — ПОНЯТЬ СУТЬ И НАМЕРЕНИЕ администратора, ДАЖЕ ЕСЛИ ТЕКСТ НАПИСАН С ОПЕЧАТКАМИ, БЕЗ ЗНАКОВ ПРЕПИНАНИЯ, С РАЗГОВОРНЫМ СЛЕНГОМ ИЛИ ОШИБКАМИ.

Запрос администратора: "${cleanPrompt}"

Примеры распознавания разговорной речи, деактивации и команд:
• "найди юзера @n1xaz" / "покажи инфу по @lowl1n" / "какие юзернеймы нашел @n1xaz" -> get_user_info { target: "@n1xaz" }
• "деактивируй все промокоды действующие в данный момент" / "удали все промокоды" / "деактивируй все промники" -> deactivate_all_promocodes {}
• "сделай промник бета на 100" -> create_promocode { code: "BETA", reward: 100 }
• "создай пром скидка 50" -> create_promocode { code: "СКИДКА", reward: 50 }
• "удали промник test" / "деактивируй промокод BETA" -> delete_promocode { code: "TEST" }
• "Начисли 15 бонусов @n1xaz" -> add_user_bonus { target: "@n1xaz", bonusCount: 15 }
• "начисли никнейму lowl1n 50 бонусов" -> add_user_bonus { target: "@lowl1n", bonusCount: 50 }
• "пополни баланс алексу на 20" -> add_user_bonus { target: "алексу", bonusCount: 20 }
• "установи баланс алексу 100" -> set_user_bonus { target: "алексу", bonusCount: 100 }
• "сбрось попытки @n1xaz" -> reset_user_attempts { target: "@n1xaz" }
• "пакажи скока людей в боте" / "стата" -> get_bot_stats
• "список промов" -> list_promocodes
• "кто в боте" / "покажи юзеров" -> list_users
• "добавь в админы @lowl1n" -> add_admin { target: "@lowl1n" }
• "удали из админов @lowl1n" -> remove_admin { target: "@lowl1n" }
• "сделай рассылку: Вышло обновление!" / "отправь всем: привет" -> broadcast_message { text: "текст сообщения" }

ОБЯЗАТЕЛЬНОЕ ПРАВИЛО ДЛЯ БОНУСОВ:
- В выражениях вида "Начисли X бонусов @юзер" число X должно быть записано в поле bonusCount (например, "Начисли 15 бонусов @n1xaz" -> bonusCount: 15, target: "@n1xaz"). Никогда не путай число X с ID или количеством рефералов.

Контекст приложения:
- Всего пользователей в системе: ${userSessions.size}
- Активные промокоды: ${JSON.stringify(VALID_PROMOS)}

Поддерживаемые действия (action):
- "get_user_info": { action: "get_user_info", target: "@username_или_id" } (показать подробную информацию о пользователе, найденных им юзернеймах и балансе)
- "deactivate_all_promocodes": { action: "deactivate_all_promocodes" } (деактивировать ВСЕ действующие промокоды)
- "create_promocode": { action: "create_promocode", code: "КОД", reward: число, desc: "описание" }
- "delete_promocode": { action: "delete_promocode", code: "КОД" }
- "list_promocodes": { action: "list_promocodes" }
- "add_user_bonus": { action: "add_user_bonus", target: "@username_или_id", bonusCount: число }
- "set_user_bonus": { action: "set_user_bonus", target: "@username_или_id", bonusCount: число }
- "reset_user_attempts": { action: "reset_user_attempts", target: "@username_или_id" }
- "get_bot_stats": { action: "get_bot_stats" }
- "broadcast_message": { action: "broadcast_message", text: "текст_сообщения" }
- "add_admin": { action: "add_admin", target: "@username_или_id" }
- "remove_admin": { action: "remove_admin", target: "@username_или_id" }
- "list_users": { action: "list_users" }
- "answer": { action: "answer", text: "ответ_на_вопрос" }

Сформируй корректный JSON по схеме. Извлеки чистый код промокода, имя юзера и числовые значения.`;

          const res = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: systemPrompt,
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  explanation: { type: Type.STRING },
                  actions: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        action: { type: Type.STRING },
                        code: { type: Type.STRING },
                        reward: { type: Type.INTEGER },
                        desc: { type: Type.STRING },
                        target: { type: Type.STRING },
                        bonusCount: { type: Type.INTEGER },
                        text: { type: Type.STRING },
                      },
                      required: ["action"],
                    },
                  },
                },
                required: ["explanation", "actions"],
              },
            },
          });

          if (res.text) {
            responseData = JSON.parse(res.text);
          }
        } catch (err: any) {
          console.error("[ADMIN_AI] Gemini error, using fallback parser:", err);
        }
      }

      // Fallback parser if Gemini output failed or missing
      if (!responseData || !responseData.actions) {
        responseData = parseAdminCommandFallback(cleanPrompt);
      }

      const results: string[] = [];
      if (responseData.explanation) {
        results.push(`💡 <b>AI Пояснение:</b> ${responseData.explanation}\n───────────────────`);
      }

      for (const act of responseData.actions || []) {
        switch (act.action) {
          case "deactivate_all_promocodes": {
            const count = Object.keys(VALID_PROMOS).length;
            VALID_PROMOS = {};
            savePromocodes();
            results.push(`🚨 <b>ВСЕ ПРОМОКОДЫ ДЕАКТИВИРОВАНЫ И УДАЛЕНЫ!</b>\nОчищено промокодов из базы: <b>${count}</b>.`);
            break;
          }

          case "create_promocode": {
            const code = (act.code || "PROMO").toUpperCase().replace(/[^A-Z0-9_-]/g, "");
            const reward = act.reward && act.reward > 0 ? act.reward : 15;
            const maxUses = act.maxUses && act.maxUses > 0 ? act.maxUses : 0;
            const desc = act.desc || (maxUses > 0 ? `${reward} бонусов (лимит: ${maxUses} активаций)` : `${reward} бонусов от администратора`);

            VALID_PROMOS[code] = {
              code,
              reward,
              desc,
              maxUses,
              usedCount: 0,
              active: true,
            };
            savePromocodes();

            const limitText = maxUses > 0 ? ` (лимит: ${maxUses} активаций)` : " (безлимитный)";
            results.push(`✅ <b>Промокод создан:</b> <code>${code}</code> (+${reward} бонусов)${limitText}\n📝 Описание: ${desc}`);
            break;
          }

          case "delete_promocode": {
            const code = (act.code || "").toUpperCase();
            if (VALID_PROMOS[code]) {
              delete VALID_PROMOS[code];
              savePromocodes();
              results.push(`🗑️ <b>Промокод <code>${code}</code> полностью удален из базы!</b>`);
            } else {
              results.push(`⚠️ Промокод <code>${code}</code> не найден в списке активных.`);
            }
            break;
          }

          case "list_promocodes": {
            const items = Object.entries(VALID_PROMOS).filter(([_, v]) => v && v.active !== false);
            if (items.length === 0) {
              results.push(`🎟️ <b>Список активных промокодов пуст.</b>`);
            } else {
              const list = items
                .map(([k, v]) => {
                  const limitStr = v.maxUses && v.maxUses > 0 ? ` [Активаций: ${v.usedCount || 0}/${v.maxUses}]` : " [Безлимитный]";
                  return `• <code>${k}</code> — +${v.reward} бонусов${limitStr} (${v.desc || "Без описания"})`;
                })
                .join("\n");
              results.push(`🎟️ <b>Действующие промокоды (${items.length}):</b>\n\n${list}`);
            }
            break;
          }

          case "add_user_bonus": {
            const userS = findUserSessionByTarget(act.target, ctx.from);
            if (userS) {
              const amount = act.bonusCount || 10;
              userS.bonusAttempts = (userS.bonusAttempts || 0) + amount;
              saveUserSessions();

              const noteText = act.message || act.text || act.note || "Спасибо за использование нашего бота!";
              const notifyMsg = `🎁 <b>ВАМ НАЧИСЛЕНЫ БОНУСНЫЕ ПОПЫТКИ!</b>\n───────────────────\n\n+<b>${amount}</b> бонусных попыток добавлено на ваш баланс!\n\n💬 <b>Сообщение от администратора:</b>\n«<i>${noteText}</i>»\n\n📊 Всего доступно попыток: <b>${getRemainingAttempts(userS)}</b>\n\nПриятного поиска красивых юзернеймов! 🚀`;

              let deliverStatus = "";
              try {
                await ctx.telegram.sendMessage(userS.userId, notifyMsg, { parse_mode: "HTML" });
                deliverStatus = `\n📩 <i>Пользователю доставлено уведомление в Telegram!</i>`;
              } catch (e: any) {
                deliverStatus = `\n⚠️ <i>Не удалось доставить уведомление в ЛС (возможно, бот заблокирован).</i>`;
              }

              results.push(`🎉 <b>Бонусы начислены!</b>\nПользователю <b>${userS.username ? "@" + userS.username : userS.userId}</b> добавлено +${amount} попыток.\n📊 Итого бонусов: <b>${userS.bonusAttempts}</b>${deliverStatus}`);
            } else {
              results.push(`⚠️ Пользователь «<code>${act.target || "не указан"}</code>» не найден в базе активных сессий.`);
            }
            break;
          }

          case "set_user_bonus": {
            const userS = findUserSessionByTarget(act.target, ctx.from);
            if (userS) {
              const amount = typeof act.bonusCount === "number" ? act.bonusCount : 0;
              userS.bonusAttempts = amount;
              saveUserSessions();

              const noteText = act.message || act.text || act.note || "Баланс бонусов обновлен администратором.";
              const notifyMsg = `🎯 <b>ОБНОВЛЕНИЕ БАЛАНСА БОНУСОВ!</b>\n───────────────────\n\nВаш баланс бонусных попыток был уставновлен в: <b>${amount}</b>!\n\n💬 <b>Сообщение от администратора:</b>\n«<i>${noteText}</i>»\n\n📊 Всего доступно попыток: <b>${getRemainingAttempts(userS)}</b>\n\nУдачного поиска! 🚀`;

              let deliverStatus = "";
              try {
                await ctx.telegram.sendMessage(userS.userId, notifyMsg, { parse_mode: "HTML" });
                deliverStatus = `\n📩 <i>Пользователю доставлено уведомление в Telegram!</i>`;
              } catch (e: any) {
                deliverStatus = `\n⚠️ <i>Не удалось доставить уведомление в ЛС.</i>`;
              }

              results.push(`🎯 <b>Баланс бонусов установлен!</b>\nПользователь: <b>${userS.username ? "@" + userS.username : userS.userId}</b>\nНовый баланс: <b>${amount}</b> попыток.${deliverStatus}`);
            } else {
              results.push(`⚠️ Пользователь «<code>${act.target || "не указан"}</code>» не найден.`);
            }
            break;
          }

          case "send_user_message": {
            const userS = findUserSessionByTarget(act.target, ctx.from);
            if (userS) {
              const userMsg = act.message || act.text || "Здравствуйте!";
              const fullMsg = `💬 <b>ЛИЧНОЕ СООБЩЕНИЕ ОТ АДМИНИСТРАЦИИ</b>\n───────────────────\n\n${userMsg}\n___________________________________\n📢 @neserit_dev`;
              try {
                await ctx.telegram.sendMessage(userS.userId, fullMsg, { parse_mode: "HTML" });
                results.push(`📩 <b>Сообщение отправлено!</b>\nПользователю <b>${userS.username ? "@" + userS.username : userS.userId}</b> доставлено:\n«<i>${userMsg}</i>»`);
              } catch (e: any) {
                results.push(`⚠️ <b>Ошибка доставки сообщения пользователю:</b> ${e.message}`);
              }
            } else {
              results.push(`⚠️ Пользователь «<code>${act.target || "не указан"}</code>» не найден.`);
            }
            break;
          }

          case "reset_user_attempts": {
            const userS = findUserSessionByTarget(act.target, ctx.from);
            if (userS) {
              userS.attemptsUsedToday = 0;
              saveUserSessions();
              results.push(`🔄 <b>Лимит сброшен!</b>\nСуточные попытки пользователя <b>${userS.username ? "@" + userS.username : userS.userId}</b> обнулены (0 / ${DAILY_LIMIT}).`);
            } else {
              results.push(`⚠️ Пользователь «<code>${act.target || "не указан"}</code>» не найден.`);
            }
            break;
          }

          case "get_bot_stats": {
            const todayMsk = getMskDateString();
            let activeToday = 0;
            let totalUsedToday = 0;
            let totalBonusHeld = 0;

            for (const s of userSessions.values()) {
              if (s.lastDate === todayMsk && s.attemptsUsedToday > 0) activeToday++;
              totalUsedToday += s.attemptsUsedToday;
              totalBonusHeld += s.bonusAttempts;
            }

            results.push(
              `📊 <b>ПОДРОБНАЯ СТАТИСТИКА БОТА</b>\n───────────────────\n\n• 👥 <b>Всего юзеров:</b> <code>${userSessions.size}</code>\n• ⚡ <b>Активных сегодня:</b> <code>${activeToday}</code>\n• 📉 <b>Проверок сегодня:</b> <code>${totalUsedToday}</code>\n• 🎁 <b>Бонусов у юзеров:</b> <code>${totalBonusHeld}</code>\n• 🎟️ <b>Промокодов:</b> <code>${Object.keys(VALID_PROMOS).length}</code>\n• 👑 <b>Администраторов:</b> <code>${adminUserIds.size}</code>`
            );
            break;
          }

          case "add_admin": {
            const userS = findUserSessionByTarget(act.target, ctx.from);
            if (userS) {
              adminUserIds.add(userS.userId);
              saveAdmins();
              results.push(`👑 <b>Новый администратор добавлен!</b>\nПользователь <b>${userS.username ? "@" + userS.username : userS.userId}</b> теперь имеет доступ к /admin.`);
            } else if (act.target && /^\d+$/.test(act.target)) {
              const id = parseInt(act.target, 10);
              adminUserIds.add(id);
              saveAdmins();
              results.push(`👑 <b>Новый администратор добавлен по ID!</b>\nID: <code>${id}</code>`);
            } else {
              results.push(`⚠️ Пользователь «<code>${act.target || "не указан"}</code>» не найден.`);
            }
            break;
          }

          case "remove_admin": {
            const userS = findUserSessionByTarget(act.target, ctx.from);
            let targetId: number | null = userS ? userS.userId : (act.target && /^\d+$/.test(act.target) ? parseInt(act.target, 10) : null);
            if (targetId && adminUserIds.has(targetId)) {
              adminUserIds.delete(targetId);
              saveAdmins();
              results.push(`❌ <b>Права администратора отозваны!</b>\nПользователь ID <code>${targetId}</code> удален из администраторов.`);
            } else {
              results.push(`⚠️ Пользователь «<code>${act.target || "не указан"}</code>» не найден среди админов.`);
            }
            break;
          }

          case "broadcast_message": {
            if (!act.text) {
              results.push(`⚠️ Укажите текст для рассылки.`);
              break;
            }
            let success = 0;
            let failed = 0;
            const msgText = `📢 <b>ОПОВЕЩЕНИЕ ОТ АДМИНИСТРАЦИИ</b>\n───────────────────\n\n${act.text}\n___________________________________\n📢 @neserit_dev`;

            for (const s of userSessions.values()) {
              try {
                await ctx.telegram.sendMessage(s.userId, msgText, { parse_mode: "HTML" });
                success++;
              } catch (e) {
                failed++;
              }
            }
            results.push(`📢 <b>Рассылка завершена!</b>\n\n✅ Успешно доставлено: <b>${success}</b>\n❌ Ошибок/заблокировали бота: <b>${failed}</b>`);
            break;
          }

          case "list_users": {
            const top = Array.from(userSessions.values())
              .slice(0, 15)
              .map((s, idx) => `${idx + 1}. ${s.username ? "@" + s.username : "ID " + s.userId} — Использовано: ${s.attemptsUsedToday}, Бонусов: ${s.bonusAttempts}`)
              .join("\n");
            results.push(`👥 <b>Список последних пользователей (15 из ${userSessions.size}):</b>\n\n${top}`);
            break;
          }

          case "get_user_info": {
            const userS = findUserSessionByTarget(act.target, ctx.from);
            if (userS) {
              const { text: repText, keyboard } = formatUserInfoReport(userS);
              if (responseData.actions.length === 1 && !loadingMsg) {
                return ctx.replyWithHTML(repText, keyboard);
              }
              results.push(repText);
            } else {
              results.push(`⚠️ Пользователь «<code>${act.target || "не указан"}</code>» не найден в базе активных сессий.`);
            }
            break;
          }

          case "answer": {
            if (act.text) results.push(act.text);
            break;
          }
        }
      }

      const finalReply = results.join("\n\n") || "⚠️ Не удалось распознать действие. Попробуйте уточнить ваш запрос.";

      if (loadingMsg) {
        try {
          await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
        } catch (e) {
          // ignore
        }
      }

      return ctx.replyWithHTML(
        `🛠️ <b>РЕЗУЛЬТАТ ВЫПОЛНЕНИЯ /admin:</b>\n\n${finalReply}`,
        Markup.inlineKeyboard([
          [Markup.button.callback("[ ⚙️ Админ Меню ]", "adm_home")],
          [Markup.button.callback("[ 🏠 Главное меню ]", "menu_home")],
        ])
      );
    };

    function parseAdminCommandFallback(text: string): { explanation: string; actions: any[] } {
      const actions: any[] = [];
      const clean = text.trim();

      // Deactivate/delete ALL promocodes (e.g., "деактивируй все промокоды действующие в данный момент", "удали все промокоды")
      if (/(?:деактивируй|удали|сбрось|очисти|deactivate|del|clear)\s+(?:все|всё|all)\s+(?:промокоды|промники|промы|promos|promocodes)?/i.test(clean) ||
          /(?:деактивируй|удали|сбрось|очисти)\s+(?:все|всё)\s+действующие/i.test(clean)) {
        actions.push({ action: "deactivate_all_promocodes" });
        return { explanation: "Деактивация всех действующих промокодов", actions };
      }

      // Create promo (e.g. "создай промник BETA 100", "сделай промокод test 50")
      const createPromoMatch = clean.match(/(?:создай|добавь|сделай|промник|промокод|промо)\s+([a-zA-Z0-9_А-Яа-я-]+)(?:\s+(?:на|в|со|с)?\s*(\d+))?/i);
      if (createPromoMatch && !/удали|убрать|сбрось|деактивируй|список/i.test(clean)) {
        const rawCode = createPromoMatch[1];
        if (!/начисли|дай|пополни|пользовател|юзер|стат|админ|все|всех/i.test(rawCode)) {
          const code = rawCode.toUpperCase();
          const reward = createPromoMatch[2] ? parseInt(createPromoMatch[2], 10) : 15;
          actions.push({ action: "create_promocode", code, reward, desc: `${reward} бонусов` });
          return { explanation: `Создание промокода ${code}`, actions };
        }
      }

      // Set user bonus (e.g., "установи баланс @user 100", "задай баланс 100 мне")
      const setBonusMatch = clean.match(/(?:установи|поставь|задай)\s+(?:баланс|бонусы)\s+(@?[a-zA-Z0-9_А-Яа-я-]+)?\s*(\d+)/i);
      if (setBonusMatch) {
        const target = setBonusMatch[1] || "мне";
        actions.push({ action: "set_user_bonus", target, bonusCount: parseInt(setBonusMatch[2], 10) });
        return { explanation: `Установка баланса бонусов ${target}`, actions };
      }

      // Add bonus (e.g. "дай n1xaz 50", "начисли @lowl1n 100 бонусов", "начисли 100", "дай 500 мне", "начисли мне 100")
      const addBonusMatch = clean.match(/(?:начисли|дай|добавь|пополни|выдай|добавить)\s+(?:пользователю\s+|юзеру\s+)?(@?[a-zA-Z0-9_А-Яа-я-]+)?\s*(\d+)?\s*(?:бонусов|попыток)?\s*(@?[a-zA-Z0-9_А-Яа-я-]+)?/i);
      if (addBonusMatch) {
        let target = "мне";
        let bonusCount = 10;
        const part1 = addBonusMatch[1];
        const numStr = addBonusMatch[2];
        const part3 = addBonusMatch[3];

        if (numStr) {
          bonusCount = parseInt(numStr, 10);
        }

        if (part1 && !/^\d+$/.test(part1) && !["бонусов", "попыток"].includes(part1.toLowerCase())) {
          target = part1;
        } else if (part3 && !/^\d+$/.test(part3) && !["бонусов", "попыток"].includes(part3.toLowerCase())) {
          target = part3;
        }

        actions.push({ action: "add_user_bonus", target, bonusCount });
        return { explanation: `Начисление ${bonusCount} бонусов ${target}`, actions };
      }

      // Reset attempts (e.g. "сбрось попытки lowl1n", "обнули @n1xaz")
      if (/сбрось|обнули|сброс/i.test(clean) && !/все|промо/i.test(clean)) {
        const match = clean.match(/(@?[a-zA-Z0-9_]+)/i);
        if (match) {
          actions.push({ action: "reset_user_attempts", target: match[1] });
          return { explanation: `Сброс лимитов для ${match[1]}`, actions };
        }
      }

      // Delete promo (e.g. "удали промник BETA", "деактивируй промокод VIP")
      if (/(?:удали|убрать|del|деактивируй)\s+(?:пром|код|промокод|промник)\s+([a-zA-Z0-9_А-Яа-я-]+)/i.test(clean)) {
        const match = clean.match(/(?:пром|код|промокод|промник)\s+([a-zA-Z0-9_А-Яа-я-]+)/i);
        if (match) {
          actions.push({ action: "delete_promocode", code: match[1].toUpperCase() });
          return { explanation: `Удаление промокода ${match[1]}`, actions };
        }
      }

      // Remove admin
      if (/админ/i.test(clean) && /(?:удали|разжалуй|сними|убрать)/i.test(clean)) {
        const match = clean.match(/(@?[a-zA-Z0-9_]+)/i);
        if (match) {
          actions.push({ action: "remove_admin", target: match[1] });
          return { explanation: "Снятие прав администратора", actions };
        }
      }

      // Add admin
      if (/админ/i.test(clean) && /(?:добав|сделай|назначь)/i.test(clean)) {
        const match = clean.match(/(@?[a-zA-Z0-9_]+)/i);
        if (match) {
          actions.push({ action: "add_admin", target: match[1] });
          return { explanation: "Назначение администратора", actions };
        }
      }

      // Stats
      if (/статистика|стата|стат|скока|сколько|людей/i.test(clean)) {
        actions.push({ action: "get_bot_stats" });
        return { explanation: "Запрос статистики", actions };
      }

      // List promocodes
      if (/список промокодов|действующие промокоды|покажи промники|промы|промники|список промов/i.test(clean)) {
        actions.push({ action: "list_promocodes" });
        return { explanation: "Запрос списка промокодов", actions };
      }

      // User Info (e.g., "инфо @username", "юзер lowl1n", "найди @n1xaz", "инфа по @user", "покажи пользователя @user", "user @user")
      if (/(?:инфо|информация|инфа|юзер|user|пользователь|найти|find|show|покажи|чеки|история|стата|логи)\s*(?:о|по|про|для)?\s*(@?[a-zA-Z0-9_]+)/i.test(clean)) {
        const match = clean.match(/(?:инфо|информация|инфа|юзер|user|пользователь|найти|find|show|покажи|чеки|история|стата|логи)\s*(?:о|по|про|для)?\s*(@?[a-zA-Z0-9_]+)/i);
        if (match && !/всех|все|промо|стата|статистика/i.test(match[1])) {
          actions.push({ action: "get_user_info", target: match[1] });
          return { explanation: `Запрос полной информации о пользователе ${match[1]}`, actions };
        }
      }

      // List users
      if (/список юзеров|все юзеры|все пользователи|список пользователей|кто в боте/i.test(clean)) {
        actions.push({ action: "list_users" });
        return { explanation: "Запрос списка пользователей", actions };
      }

      // Broadcast
      const broadcastMatch = clean.match(/(?:рассылка|отправь всем|напиши всем)[\s:]*(.+)/i);
      if (broadcastMatch) {
        actions.push({ action: "broadcast_message", text: broadcastMatch[1] });
        return { explanation: "Запуск рассылки", actions };
      }

      actions.push({ action: "answer", text: `🤖 Не удалось однозначно распарсить команду. Попробуйте написать в явной форме, например: <code>/admin clear_promos</code> или <code>/admin Создай промокод VIP на 50</code>` });
      return { explanation: "Анализ естественного языка", actions };
    }

    // Command /admin
    bot.command("admin", async (ctx) => {
      const prompt = ctx.message.text.replace(/^\/admin/i, "").trim();
      await processAdminAiCommand(ctx, prompt);
    });

    // Admin Inline Actions
    bot.action("adm_home", async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await processAdminAiCommand(ctx, "");
    });

    bot.action("adm_stats", async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await processAdminAiCommand(ctx, "Покажи статистику");
    });

    bot.action("adm_promos", async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await processAdminAiCommand(ctx, "Список промокодов");
    });

    bot.action("adm_users", async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await processAdminAiCommand(ctx, "Список пользователей");
    });

    bot.action("adm_list_admins", async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      await processAdminAiCommand(ctx, "Покажи всех админов");
    });

    bot.action("adm_search_user", async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      const session = getUserSession(ctx.from);
      session.awaitingAdminUserSearch = true;
      saveUserSessions();

      return ctx.replyWithHTML(
        `🔍 <b>ПОИСК ПОЛЬЗОВАТЕЛЯ ПО ЮЗЕРНЕЙМУ ИЛИ ID</b>\n\n` +
          `Пришлите юзернейм (например: <code>@n1xaz</code>) или Telegram ID пользователя (например: <code>123456789</code>).\n\n` +
          `Я найду всю историю проверок, найденные свободные никнеймы и текущий баланс попыток!`,
        Markup.inlineKeyboard([[Markup.button.callback("[ ⚙️ Админ Панель ]", "adm_home")]])
      );
    });

    bot.action(/^adm_ubad_(\d+)$/, async (ctx) => {
      await ctx.answerCbQuery("🎁 +10 Бонусов начислено!").catch(() => {});
      const targetId = parseInt(ctx.match[1], 10);
      const targetS = userSessions.get(targetId);
      if (targetS) {
        targetS.bonusAttempts = (targetS.bonusAttempts || 0) + 10;
        saveUserSessions();

        const notifyMsg = `🎁 <b>ВАМ НАЧИСЛЕНЫ БОНУСНЫЕ ПОПЫТКИ!</b>\n───────────────────\n\n+<b>10</b> бонусных попыток добавлено на ваш баланс!\n\n💬 <b>Сообщение от администратора:</b>\n«<i>Спасибо за использование нашего бота!</i>»\n\n📊 Всего доступно попыток: <b>${getRemainingAttempts(targetS)}</b>\n\nУдачного поиска красивых юзернеймов! 🚀`;
        await ctx.telegram.sendMessage(targetId, notifyMsg, { parse_mode: "HTML" }).catch(() => {});

        const { text, keyboard } = formatUserInfoReport(targetS);
        await ctx.editMessageText(text, { parse_mode: "HTML", ...keyboard }).catch(() => {});
      }
    });

    bot.action(/^adm_ures_(\d+)$/, async (ctx) => {
      await ctx.answerCbQuery("🔄 Суточный лимит сброшен!").catch(() => {});
      const targetId = parseInt(ctx.match[1], 10);
      const targetS = userSessions.get(targetId);
      if (targetS) {
        targetS.attemptsUsedToday = 0;
        saveUserSessions();
        const { text, keyboard } = formatUserInfoReport(targetS);
        await ctx.editMessageText(text, { parse_mode: "HTML", ...keyboard }).catch(() => {});
      }
    });

    bot.action(/^adm_utog_(\d+)$/, async (ctx) => {
      const targetId = parseInt(ctx.match[1], 10);
      const targetS = userSessions.get(targetId);
      if (targetS) {
        if (adminUserIds.has(targetId)) {
          adminUserIds.delete(targetId);
          await ctx.answerCbQuery("❌ Пользователь снят с админа").catch(() => {});
        } else {
          adminUserIds.add(targetId);
          await ctx.answerCbQuery("👑 Пользователь назначен админом").catch(() => {});
        }
        saveAdmins();
        const { text, keyboard } = formatUserInfoReport(targetS);
        await ctx.editMessageText(text, { parse_mode: "HTML", ...keyboard }).catch(() => {});
      }
    });

    bot.action(/^check_(.+)$/, async (ctx) => {
      await ctx.answerCbQuery().catch(() => {});
      const handle = ctx.match[1];
      await processUsernameCheckInBot(ctx, handle);
    });

    // Inline Mode support
    bot.on("inline_query", async (ctx) => {
      const query = ctx.inlineQuery.query.trim().replace(/^@/, "");
      if (!query || query.length < 2) return;

      try {
        const check = await checkTelegramUsername(query);
        const isFree = check.status === "available";

        await ctx.answerInlineQuery([
          {
            type: "article",
            id: `check_${query}`,
            title: `@${query} — ${isFree ? "🟢 СВОБОДЕН!" : "🔴 ЗАНЯТ / FRAGMENT"}`,
            description: isFree
              ? "Этот юзернейм свободен для бесплатной регистрации!"
              : "Юзернейм уже кем-то занят или продан на Fragment.",
            input_message_content: {
              message_text: `🔍 <b>Проверка юзернейма @${query}:</b>\n\n${
                isFree ? "🟢 <b>СВОБОДЕН!</b>" : "🔴 <b>ЗАНЯТ / FRAGMENT</b>"
              }\n🔗 https://t.me/${query}`,
              parse_mode: "HTML",
            },
          },
        ]);
      } catch (e) {
        // ignore
      }
    });

    // Handle plain text messages (reply keyboard buttons, promocodes, or username check)
    bot.on("text", async (ctx) => {
      const text = ctx.message.text.trim();
      if (text.startsWith("/")) return;

      const session = getUserSession(ctx.from);
      const cleanLower = text.toLowerCase();

      // Intercept reply keyboard buttons and main navigation commands FIRST
      if (
        cleanLower === "поиск" ||
        cleanLower === "поиск юзернеймов" ||
        cleanLower.includes("поиск юзернеймов") ||
        cleanLower.includes("найти юзернейм")
      ) {
        session.awaitingLength = undefined;
        session.awaitingPromo = false;
        session.awaitingPattern = false;
        session.awaitingAdminUserSearch = false;
        session.awaitingSingleCheck = false;
        saveUserSessions();
        return await sendSearchHubMenu(ctx);
      }

      if (
        cleanLower === "профиль" ||
        cleanLower.includes("профиль")
      ) {
        session.awaitingLength = undefined;
        session.awaitingPromo = false;
        session.awaitingPattern = false;
        session.awaitingAdminUserSearch = false;
        session.awaitingSingleCheck = false;
        saveUserSessions();
        return await sendProfileMenu(ctx);
      }

      if (
        cleanLower === "премиум" ||
        cleanLower.includes("премиум")
      ) {
        session.awaitingLength = undefined;
        session.awaitingPromo = false;
        session.awaitingPattern = false;
        session.awaitingAdminUserSearch = false;
        session.awaitingSingleCheck = false;
        saveUserSessions();
        return await sendPremiumMenu(ctx);
      }

      if (
        cleanLower === "бонусы" ||
        cleanLower === "бонус" ||
        cleanLower.includes("бонусы") ||
        cleanLower.includes("рефералы")
      ) {
        session.awaitingLength = undefined;
        session.awaitingPromo = false;
        session.awaitingPattern = false;
        session.awaitingAdminUserSearch = false;
        session.awaitingSingleCheck = false;
        saveUserSessions();
        return await sendBonusesMenu(ctx);
      }

      if (
        cleanLower === "главное меню" ||
        cleanLower === "в меню" ||
        cleanLower === "меню" ||
        cleanLower.includes("главное меню") ||
        cleanLower.includes("главное")
      ) {
        session.awaitingLength = undefined;
        session.awaitingPromo = false;
        session.awaitingPattern = false;
        session.awaitingAdminUserSearch = false;
        session.awaitingSingleCheck = false;
        saveUserSessions();
        return await sendMainInlineMenu(ctx);
      }

      // Check if awaiting admin user search
      if (session.awaitingAdminUserSearch && isUserAdmin(ctx.from.id, ctx.from.username)) {
        session.awaitingAdminUserSearch = false;
        saveUserSessions();

        const targetS = findUserSessionByTarget(text, ctx.from);
        if (targetS) {
          const { text: repText, keyboard } = formatUserInfoReport(targetS);
          return ctx.replyWithHTML(repText, keyboard);
        } else {
          return ctx.replyWithHTML(
            `⚠️ <b>Пользователь «<code>${text}</code>» не найден в базе данных бота.</b>\n\nУбедитесь, что пользователь хотя бы раз запускал бота или введите его Telegram ID.`,
            Markup.inlineKeyboard([
              [Markup.button.callback("🔍 Попробовать еще раз", "adm_search_user")],
              [Markup.button.callback("[ ⚙️ Админ Панель ]", "adm_home")],
            ])
          );
        }
      }

      // Check if message is an admin command sent directly by an admin without /admin prefix
      if (isUserAdmin(ctx.from.id, ctx.from.username)) {
        if (
          /^(?:начисли|дай|добавь|пополни|выдай|установи|сбрось|деактивируй|создай пром|удали пром|админ|add_bonus|set_bonus|reset|broadcast)/i.test(cleanLower) ||
          /(?:бонусов|попыток)\s+(?:мне|себе|@?[a-zA-Z0-9_]+)/i.test(cleanLower) ||
          /(?:начисли|добавь|выдай|пополни)\s+(?:мне|себе|@?[a-zA-Z0-9_]+)?\s*\d+/i.test(cleanLower)
        ) {
          return await processAdminAiCommand(ctx, text);
        }
      }

      // Check if user is entering length (4-9)
      if (session.awaitingLength) {
        if (/^\d+$/.test(text)) {
          const num = parseInt(text, 10);
          if (num >= 4 && num <= 9) {
            const { searchType, style } = session.awaitingLength;
            session.awaitingLength = undefined;
            saveUserSessions();
            await sendStep3CountMenu(ctx, searchType, style, num.toString());
            return;
          } else {
            return ctx.replyWithHTML(
              `⚠️ Пожалуйста, укажите количество символов от <b>4 до 9</b> (например: <code>4</code>, <code>5</code>, <code>6</code>, <code>7</code>, <code>8</code> или <code>9</code>) или нажмите на одну из кнопок под сообщением.`,
              Markup.inlineKeyboard([[Markup.button.callback("[ 🏠 Главное меню ]", "menu_home")]])
            );
          }
        } else {
          return ctx.replyWithHTML(
            `⚠️ Пожалуйста, укажите количество символов цифрой от <b>4 до 9</b> или воспользуйтесь кнопками ниже:`,
            Markup.inlineKeyboard([[Markup.button.callback("[ 🏠 Главное меню ]", "menu_home")]])
          );
        }
      }

      // Check if user entered a promo code
      const upperText = text.toUpperCase();
      if (session.awaitingPromo || VALID_PROMOS[upperText]) {
        session.awaitingPromo = false;
        const res = activatePromoCode(session, text);
        if (res.success) {
          return ctx.replyWithHTML(
            res.message,
            Markup.inlineKeyboard([
              [Markup.button.callback("[ 🔍 Найти юзернейм ]", "menu_search_hub")],
              [Markup.button.callback("[ 🏠 Главное меню ]", "menu_home")],
            ])
          );
        } else {
          return ctx.replyWithHTML(
            res.message,
            Markup.inlineKeyboard([[Markup.button.callback("[ 🏠 Главное меню ]", "menu_home")]])
          );
        }
      }

      // Check if user is entering pattern mask or text contains '?'
      if (session.awaitingPattern || (text.includes("?") && text.length >= 4 && text.length <= 12)) {
        session.awaitingPattern = false;
        saveUserSessions();

        const cleanPattern = text.trim().toLowerCase().replace(/^@/, "");
        if (cleanPattern.length < 5 || cleanPattern.length > 10) {
          return ctx.replyWithHTML(
            `⚠️ <b>Некорректная длина шаблона!</b>\n\nДлина шаблона должна быть <b>в пределах от 5 до 10 символов</b> (например: <code>d?br?</code>, <code>??okak</code>, <code>cyber???</code>, <code>my_name_??</code>).`,
            Markup.inlineKeyboard([[Markup.button.callback("[ 🏠 Главное меню ]", "menu_home")]])
          );
        }
        if (!cleanPattern.includes("?")) {
          return ctx.replyWithHTML(
            `⚠️ <b>В шаблоне отсутствует знак «?»!</b>\n\nИспользуйте знак <b>?</b> на месте символов, которые нужно подставить (в пределах от 5 до 10 символов, например: <code>d?br?</code>, <code>??okak</code>, <code>cyber???</code>).`,
            Markup.inlineKeyboard([[Markup.button.callback("[ 🏠 Главное меню ]", "menu_home")]])
          );
        }

        await sendPatternCharTypeMenu(ctx, cleanPattern);
        return;
      }

      // Direct username or link check (e.g. @dzyax, qxxyn, vyrfy, t.me/dzyax)
      if (/^@?[a-zA-Z0-9_]{4,32}$/.test(text) || text.includes("t.me/")) {
        if (session.awaitingSingleCheck) {
          session.awaitingSingleCheck = false;
          saveUserSessions();
        }
        await processUsernameCheckInBot(ctx, text);
        return;
      }

      // Fallback for unprompted raw text input -> Unknown Command Error
      return ctx.replyWithHTML(
        `❌ <b>Неизвестная команда!</b>\n\nБот работает через интерактивные кнопки меню. Пожалуйста, воспользуйтесь кнопками ниже для вызова нужного раздела:`,
        Markup.inlineKeyboard([
          [Markup.button.callback("[ ⚡ Мгновенная проверка ]", "menu_instant_check")],
          [Markup.button.callback("[ 🔍 Поиск юзернеймов ]", "menu_search_hub")],
          [Markup.button.callback("[ 🏠 Главное меню ]", "menu_home")],
        ])
      );
    });

    // Helper to process and reply username check
    async function processUsernameCheckInBot(ctx: any, raw: string) {
      const session = getUserSession(ctx.from);
      const remaining = getRemainingAttempts(session);

      if (remaining < 1) {
        return sendLimitExceededMessage(ctx);
      }

      const clean = raw.replace(/^(https?:\/\/t\.me\/|@)/, "").trim().toLowerCase();

      if (!clean || clean.length < 4) {
        return ctx.replyWithHTML(
          `❌ <b>Слишком короткий юзернейм @${clean}</b>\n\nМинимальная длина юзернейма в Telegram — 4 символа.\n___________________________________\n\n📢 <b>Новости:</b> @neserit_dev\n🧩Версия: Beta`,
          Markup.inlineKeyboard([[Markup.button.callback("[ 🏠 Главное меню ]", "menu_home")]])
        );
      }

      consumeAttempt(session, 1);
      const newRemaining = getRemainingAttempts(session);

      addBotLog(`Проверка @${clean} в Telegram (списано 1 попытка, осталось: ${newRemaining}) от @${ctx.from.username || ctx.from.id}`, "info");

      const check = await checkTelegramUsername(clean, { checkFragment: true });
      const rating = rateUsername(clean);

      recordUserHistory(session, clean, check.status);

      if (check.status === "invalid") {
        return ctx.replyWithHTML(
          `❌ <b>Невалидный <code>@${clean}</code></b> (${check.reason})\n📊 Осталось: <code>${newRemaining}/${DAILY_LIMIT}</code>`,
          Markup.inlineKeyboard([[Markup.button.callback("[ 🏠 Главное меню ]", "menu_home")]])
        );
      }

      let replyHtml = `🎁 <b>МНОГОУРОВНЕВАЯ ПРОВЕРКА ЮЗЕРНЕЙМА</b>\n───────────────────\n\n`;
      const buttons = [];

      if (check.status === "fragment" || check.status === "short_premium" || check.fragmentDetails) {
        replyHtml += `💎 <b>Статус: FRAGMENT NFT (Продается / Лот)</b>\n\n💎 <b><code>@${clean}</code></b> ${rating.stars}\n\n🔬 <b>Анализ по 4 уровням:</b>\n├ 🤖 <b>Bot API:</b> Зарезервирован\n├ 🌐 <b>Telegram Web (t.me):</b> На аукционе Fragment\n├ 💎 <b>Fragment Marketplace:</b> ${check.fragmentDetails || 'Аукцион TON'}\n└ ⭐️ <b>AI Оценка:</b> ${rating.label} (<code>${rating.score}/10</code>)\n\n<i>Юзернейм доступен к покупке на Fragment TON!</i>`;
        buttons.push([Markup.button.url(`[ 💎 Открыть @${clean} на Fragment ]`, `https://fragment.com/username/${clean}`)]);
      } else if (check.status === "available") {
        replyHtml += `🟢 <b>Статус: СВОБОДЕН ДЛЯ РЕГИСТРАЦИИ!</b>\n\n✅ <b><code>@${clean}</code></b> ${rating.stars}\n\n🔬 <b>Анализ по 4 уровням:</b>\n├ 🤖 <b>Bot API:</b> Свободен (нет объектов)\n├ 🌐 <b>Telegram Web (t.me):</b> Профиль отсутствует\n├ 💎 <b>Fragment Marketplace:</b> Свободен\n└ ⭐️ <b>AI Оценка:</b> ${rating.label} (<code>${rating.score}/10</code>)\n\n✨ <i>Зарегистрируйте понравившийся в настройках Telegram!</i>`;
        buttons.push([Markup.button.url("[ 🔗 Зарегистрировать в Telegram ]", `https://t.me/${clean}`)]);
      } else {
        replyHtml += `🔴 <b>Статус: ЗАНЯТ В TELEGRAM</b>\n\n🔴 <b><code>@${clean}</code></b> ${rating.stars}\n\n🔬 <b>Анализ по 4 уровням:</b>\n├ 🤖 <b>Bot API:</b> Найден (<code>${check.title || 'Аккаунт / Канал'}</code>)\n├ 🌐 <b>Telegram Web (t.me):</b> Активный профиль\n├ 💎 <b>Fragment Marketplace:</b> Занят / Недоступен\n└ ⭐️ <b>AI Оценка:</b> ${rating.label} (<code>${rating.score}/10</code>)`;
        buttons.push([Markup.button.url("[ 🔗 Открыть профиль ]", `https://t.me/${clean}`)]);
      }

      replyHtml += `\n\n📊 <b>Осталось попыток:</b> <code>${newRemaining} / ${DAILY_LIMIT}</code>\n___________________________________\n\n📢 <b>Новости:</b> @neserit_dev\n🧩Версия: Beta`;

      buttons.push([
        Markup.button.callback("[ ⚡ Новый поиск ]", "menu_instant_check"),
        Markup.button.callback("[ 🏠 Главное меню ]", "menu_home"),
      ]);

      await ctx.replyWithHTML(replyHtml, Markup.inlineKeyboard(buttons));
    }

    activeBot = bot;
    activeBotToken = cleanToken;

    const webhookUrlToUse = customWebhookUrl || process.env.WEBHOOK_URL || process.env.AMVERA_APP_URL || process.env.APP_URL;

    if (mode === "webhook" && webhookUrlToUse) {
      const cleanUrl = webhookUrlToUse.replace(/\/$/, "");
      const fullWebhookUrl = `${cleanUrl}/api/bot/webhook`;
      await bot.telegram.setWebhook(fullWebhookUrl, { drop_pending_updates: true }).catch((err) => {
        console.error("[WEBHOOK SET ERROR]", err);
      });
      addBotLog(`🤖 Бот @${botUser.username} запущен в режиме Webhook: ${fullWebhookUrl}`, "success");
      return { success: true, botInfo: botUser, mode: "webhook", webhookUrl: fullWebhookUrl };
    } else {
      await bot.telegram.deleteWebhook({ drop_pending_updates: true }).catch(() => {});
      await new Promise((r) => setTimeout(r, 1000));

      const launchPollingLoop = () => {
        if (activeBot !== bot) return;
        bot.launch({ dropPendingUpdates: true, allowedUpdates: ["message", "callback_query"] }).catch((err: any) => {
          const errMsg = err?.message || String(err);
          addBotLog(`⚠️ Ошибка Long-Polling (@${botUser.username}): ${errMsg}`, "error");
          console.error("[BOT POLLING ERROR]", errMsg);

          if (errMsg.includes("409") || errMsg.includes("Conflict")) {
            addBotLog(`⚠️ Обнаружен 409 Conflict (параллельный запуск на другом сервере). Перезапуск через 5 сек...`, "info");
          }

          if (botPollingRetryTimer) clearTimeout(botPollingRetryTimer);
          botPollingRetryTimer = setTimeout(() => {
            if (activeBot === bot) {
              console.log("[BOT POLLING] Полный авто-перезапуск бота...");
              try { bot.stop(); } catch (e) {}
              startTelegrafBot(cleanToken, mode, customWebhookUrl).catch((r) => {
                console.error("[BOT RESTART FAILED]", r);
              });
            }
          }, 5000);
        });
      };

      launchPollingLoop();
      addBotLog(`🤖 Бот @${botUser.username} запущен в режиме Long-Polling 24/7 (с авто-восстановлением)!`, "success");
      return { success: true, botInfo: botUser, mode: "polling" };
    }
  } catch (error: any) {
    addBotLog(`❌ Ошибка запуска бота: ${error.message}`, "error");
    throw error;
  }
}

// API Endpoints for Live Bot Management
app.post("/api/bot/webhook", express.json(), async (req, res) => {
  res.status(200).send("OK");
  if (activeBot && req.body && typeof req.body === "object" && Object.keys(req.body).length > 0) {
    try {
      await activeBot.handleUpdate(req.body);
    } catch (err) {
      console.error("[WEBHOOK HANDLE ERROR]", err);
    }
  }
});

app.post("/api/bot/start", async (req, res) => {
  try {
    const { token, mode, webhookUrl } = req.body;
    if (!token) return res.status(400).json({ error: "Токен обязателен" });

    const result = await startTelegrafBot(token, mode || "polling", webhookUrl);
    saveBotConfig({ token, mode: mode || "polling", webhookUrl });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Не удалось запустить бота" });
  }
});

app.post("/api/bot/stop", async (req, res) => {
  try {
    if (activeBot) {
      await activeBot.stop();
      activeBot = null;
      activeBotToken = null;
      activeBotInfo = null;
      addBotLog("🛑 Бот был остановлен через консоль", "info");
    }
    try {
      if (fs.existsSync(BOT_CONFIG_FILE)) {
        fs.unlinkSync(BOT_CONFIG_FILE);
      }
    } catch (e) {}
    res.json({ success: true, message: "Бот остановлен" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/bot/status", (_req, res) => {
  res.json({
    active: !!activeBot,
    botInfo: activeBotInfo,
    logs: botLogs,
  });
});

// Start Express + Vite
async function startServer() {
  const distPath = path.join(process.cwd(), "dist");

  const isProduction =
    process.env.NODE_ENV === "production" ||
    process.argv[1]?.includes("dist") ||
    process.argv[1]?.endsWith(".cjs");

  if (isProduction) {
    console.log("📦 Serving static files from /dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      console.log("⚡ Vite dev server middleware mounted");
    } catch (e) {
      console.warn("Could not start Vite dev server, serving static files instead:", e);
      app.use(express.static(distPath));
      app.get("*", (_req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }
  }

  app.listen(PORT, "0.0.0.0", async () => {
    console.log(`🚀 Telegram Username Finder & Bot running on http://localhost:${PORT}`);

    // Auto-start Telegram Bot on boot
    const savedConfig = loadBotConfig();
    const DEFAULT_TOKEN = "8868659501:AAHK7Ke00c5BLr90QZ8r_rpMIzanpyKUnaA";
    const envToken = process.env.TELEGRAM_BOT_TOKEN;
    const initialToken = savedConfig?.token || ((envToken && !envToken.startsWith("8810823823")) ? envToken : DEFAULT_TOKEN);
    const envWebhook = process.env.WEBHOOK_URL || process.env.AMVERA_APP_URL || process.env.APP_URL;
    const initialMode = savedConfig?.mode || (envWebhook ? "webhook" : "polling");
    const initialWebhook = savedConfig?.webhookUrl || envWebhook;

    if (initialToken) {
      let attempts = 0;
      const bootBot = () => {
        attempts++;
        startTelegrafBot(initialToken, initialMode, initialWebhook).then(() => {
          saveBotConfig({ token: initialToken, mode: initialMode, webhookUrl: initialWebhook });
          console.log(`🤖 Auto-started Telegram Bot successfully in ${initialMode} mode!`);
        }).catch((err: any) => {
          console.error(`⚠️ Boot attempt #${attempts} failed: ${err.message}. Retrying in 5s...`);
          setTimeout(bootBot, 5000);
        });
      };
      bootBot();
    }
  });
}

startServer();
