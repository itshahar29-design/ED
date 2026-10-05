import { Bot, Keyboard } from 'grammy';
import { DbClient } from '../../db/client.js';
import { TelegramService } from './telegram.service.js';
import { env } from '../../config/env.js';

let botInstance: Bot | null = null;
const userPendingCode = new Map<number, string>();

export function getBot(): Bot | null {
  return botInstance;
}

export function initBot(db: DbClient): Bot | null {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return null;
  }

  if (botInstance) {
    return botInstance;
  }

  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
  botInstance = bot;

  // /start va /start <code> buyrug'i
  bot.command('start', async (ctx) => {
    const code = ctx.match?.trim();
    const res = await TelegramService.handleStart(db, code);

    if (res.needContact && code) {
      userPendingCode.set(ctx.chat.id, code);
      const keyboard = new Keyboard()
        .requestContact('📱 Telefon raqamni yuborish')
        .resized()
        .oneTime();

      await ctx.reply(res.text, { reply_markup: keyboard });
    } else {
      await ctx.reply(res.text);
    }
  });

  // Kontakt yuborilganda tekshirish
  bot.on(':contact', async (ctx) => {
    const contact = ctx.message?.contact;
    if (!contact) return;

    const code = userPendingCode.get(ctx.chat.id);
    if (!code) {
      await ctx.reply(
        "Iltimos, avval maktab taqdim etgan taklif havolasini bosing.",
        { reply_markup: { remove_keyboard: true } }
      );
      return;
    }

    const res = await TelegramService.verifyContact(
      db,
      code,
      ctx.chat.id,
      contact.phone_number
    );

    userPendingCode.delete(ctx.chat.id);
    await ctx.reply(res.message, { reply_markup: { remove_keyboard: true } });
  });

  // /stop buyrug'i — xabarnomalarni to'xtatish
  bot.command('stop', async (ctx) => {
    const res = await TelegramService.handleStop(db, ctx.chat.id);
    userPendingCode.delete(ctx.chat.id);
    await ctx.reply(res.message, { reply_markup: { remove_keyboard: true } });
  });

  // Bot xatoliklarini ushlash
  bot.catch((err) => {
    console.error('Telegram bot xatosi:', err.error);
  });

  return bot;
}
