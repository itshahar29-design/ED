import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().default('postgres://edumemory:edumemory123@localhost:5432/edumemory'),
  COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET kamida 32 ta belgidan iborat bo\'lishi kerak').default('edumemory_super_secure_random_cookie_secret_key_32_chars_long'),
  TIMEZONE: z.string().default('Asia/Tashkent'),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(''),
  BOT_TOKEN: z.string().optional().default(''),
  TELEGRAM_BOT_USERNAME: z.string().optional().default('EduMemoryBot'),
  BOT_USERNAME: z.string().optional().default('EduMemoryBot'),
  PUBLIC_URL: z.string().optional().default('http://localhost:3000'),
  WEBHOOK_SECRET: z.string().optional().default(''),
  OWNER_PHONE: z.string().optional().default('+998996893228'),
  DEV_LOGIN: z.string().optional().default('0'),
  USE_PGLITE: z.coerce.boolean().optional().default(false),
});

export const env = envSchema.parse(process.env);

// Temir qoida 4.7: DEV_LOGIN=1 faqat NODE_ENV=development da ishlaydi.
// Production'da DEV_LOGIN=1 bo'lsa server ishga tushmasin (xato bilan to'xtasin).
if (env.NODE_ENV === 'production' && env.DEV_LOGIN === '1') {
  throw new Error('DEV_LOGIN=1 faqat development rejimida ruxsat etiladi! Production da taqiqlangan.');
}

// Bot token alias
export const EFFECTIVE_BOT_TOKEN =
  env.BOT_TOKEN || env.TELEGRAM_BOT_TOKEN || (env.NODE_ENV === 'test' ? '123456:TEST_BOT_TOKEN_FOR_TESTS' : '');
export const EFFECTIVE_BOT_USERNAME = env.BOT_USERNAME || env.TELEGRAM_BOT_USERNAME || 'EduMemoryBot';
