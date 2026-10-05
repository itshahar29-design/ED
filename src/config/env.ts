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
  TELEGRAM_BOT_USERNAME: z.string().optional().default('edumemory_bot'),
  USE_PGLITE: z.coerce.boolean().optional().default(false),
});

export const env = envSchema.parse(process.env);
