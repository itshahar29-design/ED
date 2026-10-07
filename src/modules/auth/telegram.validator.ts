import crypto from 'crypto';

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface TelegramInitData {
  query_id?: string;
  user: TelegramUser;
  auth_date: number;
  hash: string;
  start_param?: string;
  raw: Record<string, string>;
}

// In-memory rate limiter for auth (IP: 10/min, telegram_id: 5/min)
const ipRateLimits = new Map<string, { count: number; resetAt: number }>();
const tgRateLimits = new Map<number, { count: number; resetAt: number }>();

export function checkRateLimit(ip: string, telegramId?: number): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();

  // IP limit: 10/min
  const ipEntry = ipRateLimits.get(ip);
  if (ipEntry && ipEntry.resetAt > now) {
    if (ipEntry.count >= 10) {
      return { allowed: false, retryAfter: Math.ceil((ipEntry.resetAt - now) / 1000) };
    }
    ipEntry.count++;
  } else {
    ipRateLimits.set(ip, { count: 1, resetAt: now + 60_000 });
  }

  // Telegram ID limit: 5/min
  if (telegramId) {
    const tgEntry = tgRateLimits.get(telegramId);
    if (tgEntry && tgEntry.resetAt > now) {
      if (tgEntry.count >= 5) {
        return { allowed: false, retryAfter: Math.ceil((tgEntry.resetAt - now) / 1000) };
      }
      tgEntry.count++;
    } else {
      tgRateLimits.set(telegramId, { count: 1, resetAt: now + 60_000 });
    }
  }

  return { allowed: true };
}

/**
 * Validates Telegram WebApp initData string according to official Telegram docs
 */
export function validateTelegramInitData(initDataString: string, botToken: string): TelegramInitData {
  if (!initDataString || typeof initDataString !== 'string') {
    throw new Error('Bo\'sh yoki yaroqsiz initData');
  }

  const urlParams = new URLSearchParams(initDataString);
  const hash = urlParams.get('hash');
  if (!hash) {
    throw new Error('initData da hash mavjud emas');
  }

  urlParams.delete('hash');

  // Sort alphabetically by key
  const keys = Array.from(urlParams.keys()).sort();
  const dataCheckArr: string[] = [];
  const raw: Record<string, string> = {};

  for (const k of keys) {
    const val = urlParams.get(k) || '';
    dataCheckArr.push(`${k}=${val}`);
    raw[k] = val;
  }
  const dataCheckString = dataCheckArr.join('\n');

  // secret = HMAC_SHA256(key="WebAppData", data=BOT_TOKEN)
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();

  // calculatedHash = hex(HMAC_SHA256(secret, dataCheckString))
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  // timingSafeEqual comparison
  const calculatedBuf = Buffer.from(calculatedHash, 'utf-8');
  const hashBuf = Buffer.from(hash, 'utf-8');

  if (calculatedBuf.length !== hashBuf.length || !crypto.timingSafeEqual(calculatedBuf, hashBuf)) {
    throw new Error('initData imzosi yaroqsiz (hash mos kelmadi)');
  }

  // auth_date <= 1 hour (3600 seconds)
  const authDateStr = urlParams.get('auth_date');
  if (!authDateStr) {
    throw new Error('auth_date mavjud emas');
  }

  const authDate = parseInt(authDateStr, 10);
  const nowSec = Math.floor(Date.now() / 1000);

  // Expired if > 1 hour old or more than 5 minutes into the future
  if (nowSec - authDate > 3600) {
    throw new Error('initData muddati o\'tgan (1 soatdan eski)');
  }
  if (authDate > nowSec + 300) {
    throw new Error('auth_date noto\'g\'ri (kelajak vaqt)');
  }

  const userJson = urlParams.get('user');
  if (!userJson) {
    throw new Error('initData da foydalanuvchi ma\'lumoti mavjud emas');
  }

  let user: TelegramUser;
  try {
    user = JSON.parse(userJson);
  } catch {
    throw new Error('user ma\'lumoti yaroqsiz JSON');
  }

  if (!user.id) {
    throw new Error('user.id mavjud emas');
  }

  return {
    query_id: urlParams.get('query_id') || undefined,
    user,
    auth_date: authDate,
    hash,
    start_param: urlParams.get('start_param') || undefined,
    raw,
  };
}

/**
 * Normalizes any phone string to E.164 (+998XXXXXXXXX)
 */
export function normalizePhone(phone: string): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');

  if (digits.startsWith('998') && digits.length === 12) {
    return `+${digits}`;
  }
  if (digits.length === 9) {
    return `+998${digits}`;
  }
  if (digits.length === 12) {
    return `+${digits}`;
  }

  return `+${digits}`;
}

/**
 * Verifies that telegram message contact belongs to the sender
 */
export function verifyTelegramContact(contactUserId: number | undefined, senderId: number): boolean {
  if (!contactUserId || !senderId) return false;
  return contactUserId === senderId;
}
