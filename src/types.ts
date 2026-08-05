export type UsernameStatus = 'available' | 'taken' | 'fragment' | 'short_premium' | 'invalid' | 'checking';

export interface CheckResult {
  username: string;
  status: UsernameStatus;
  length?: number;
  isShortPremium?: boolean;
  telegramUrl?: string;
  fragmentUrl?: string;
  title?: string;
  type?: string;
  fragmentDetails?: string;
  reason?: string;
  note?: string;
  checkedAt?: string;
  rating?: {
    score: number;
    stars: string;
    label: string;
    reason: string;
  };
}

export interface AIUsernameItem {
  username: string;
  score: number;
  category: string;
  rarity: string;
  meaning: string;
  estimatedValue: string;
  styleTag?: string;
  checkResult?: CheckResult;
}

export interface GeneratorParams {
  keywords: string;
  category: string;
  lengthPref: string;
  includeNumbers: boolean;
  includeUnderscore: boolean;
  count: number;
}

export interface TelegramBotInfo {
  id: number;
  is_bot: boolean;
  first_name: string;
  username: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
  supports_inline_queries?: boolean;
}

export interface SavedUsername {
  id: string;
  username: string;
  status: UsernameStatus;
  category?: string;
  score?: number;
  notes?: string;
  savedAt: string;
}
