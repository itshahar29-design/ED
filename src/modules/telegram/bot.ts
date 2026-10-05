import { Bot, Keyboard } from 'grammy';
import { DbClient } from '../../db/client.js';
import { TelegramService } from './telegram.service.js';
import { env } from '../../config/env.js';

let botInstance: Bot | null = null;
const userPendingCode = new Map<number, string>();
const userSessions = new Map<number, any>();

export function getBot(): Bot | null {
  return botInstance;
}

function getWebAppUrl(): string {
  const ext = process.env.RENDER_EXTERNAL_URL || process.env.KEEP_ALIVE_URL;
  if (ext) return ext.replace(/\/$/, '');
  return 'https://ed-wf3h.onrender.com';
}

function getRoleKeyboard(user: any): Keyboard {
  const webAppUrl = getWebAppUrl();
  const role = user?.role;

  if (role === 'teacher') {
    return new Keyboard()
      .text('📋 Bugungi darslarim')
      .text('⚡ Davomat holati')
      .row()
      .webApp('🌐 EduMemory Tizimini Ochish', webAppUrl)
      .row()
      .text('🔄 Raqamni almashtirish')
      .resized();
  }

  if (role === 'parent') {
    return new Keyboard()
      .text('📅 Bugungi davomat')
      .text('📊 Oylik hisobot')
      .row()
      .webApp('🌐 EduMemory Tizimini Ochish', webAppUrl)
      .row()
      .text('🔄 Raqamni almashtirish')
      .resized();
  }

  if (role === 'director' || role === 'owner') {
    return new Keyboard()
      .text('📊 Bugungi umumiy davomat')
      .row()
      .webApp('🌐 EduMemory Tizimini Ochish', webAppUrl)
      .row()
      .text('🔄 Raqamni almashtirish')
      .resized();
  }

  return new Keyboard()
    .requestContact('📱 Telefon raqamni yuborish')
    .resized()
    .oneTime();
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

  // Bot buyruqlari menyusini ro'yxatdan o'tkazish
  bot.api
    .setMyCommands([
      { command: 'start', description: 'Botni ishga tushirish / Qayta ochish' },
      { command: 'menu', description: 'Asosiy menyuni ochish' },
      { command: 'stop', description: 'Xabarnomalarni to\'xtatish' },
    ])
    .catch((err) => {
      console.warn('Bot buyruqlarini sozlashda ogohlantirish:', err.message);
    });

  // /start va /start <code> buyrug'i
  bot.command('start', async (ctx) => {
    const code = ctx.match?.trim();

    // 1. Agar bir martalik taklif kodi bilan kirgan bo'lsa
    if (code) {
      const res = await TelegramService.handleStart(db, code);
      if (res.needContact) {
        userPendingCode.set(ctx.chat.id, code);
        const keyboard = new Keyboard()
          .requestContact('📱 Telefon raqamni yuborish')
          .resized()
          .oneTime();
        await ctx.reply(res.text, { reply_markup: keyboard });
        return;
      } else {
        await ctx.reply(res.text);
        return;
      }
    }

    // 2. Agar foydalanuvchi allaqachon tanilgan bo'lsa
    const existing = userSessions.get(ctx.chat.id);
    if (existing && existing.found) {
      await ctx.reply(
        `Xush kelibsiz, ${existing.name}! 👋\nLavozimingiz: ${existing.role === 'teacher' ? "O'qituvchi 👨‍🏫" : existing.role === 'director' ? 'Maktab Direktori 🏫' : existing.role === 'owner' ? 'Administrator 👑' : 'Ota-ona 👨‍👩‍👦'}\n\nQuyidagi menyudan kerakli bo'limni tanlang:`,
        { reply_markup: getRoleKeyboard(existing) }
      );
      return;
    }

    // 3. Yangi tashrif: Raqam yuborishni so'rash
    const phoneKeyboard = new Keyboard()
      .requestContact('📱 Telefon raqamni yuborish')
      .resized()
      .oneTime();

    await ctx.reply(
      "Assalomu alaykum! 🎓 EduMemory maktab davomat tizimi botiga xush kelibsiz.\n\nTizimda lavozimingizni (Direktor, O'qituvchi yoki Ota-ona) aniqlash va mos menyuni ochish uchun, iltimos, telefon raqamingizni yuboring 👇",
      { reply_markup: phoneKeyboard }
    );
  });

  // /menu buyrug'i
  bot.command('menu', async (ctx) => {
    const user = userSessions.get(ctx.chat.id);
    if (!user || !user.found) {
      const phoneKeyboard = new Keyboard()
        .requestContact('📱 Telefon raqamni yuborish')
        .resized()
        .oneTime();
      await ctx.reply("Iltimos, avval telefon raqamingizni yuboring 👇", { reply_markup: phoneKeyboard });
      return;
    }
    await ctx.reply("Asosiy menyu:", { reply_markup: getRoleKeyboard(user) });
  });

  // Kontakt kelganda — Lavozimni aniqlash
  bot.on(':contact', async (ctx) => {
    const contact = ctx.message?.contact;
    if (!contact) return;

    // A. Taklif kodi bor bo'lsa (eski oqim)
    const code = userPendingCode.get(ctx.chat.id);
    if (code) {
      const res = await TelegramService.verifyContact(
        db,
        code,
        ctx.chat.id,
        contact.phone_number
      );
      userPendingCode.delete(ctx.chat.id);
      await ctx.reply(res.message, { reply_markup: { remove_keyboard: true } });
      return;
    }

    // B. Umumiy kirish: Raqam bo'yicha lavozimni aniqlash
    const identified = await TelegramService.identifyUserByPhone(
      db,
      contact.phone_number,
      ctx.chat.id
    );

    if (identified.found) {
      userSessions.set(ctx.chat.id, identified);
      await ctx.reply(identified.message, {
        reply_markup: getRoleKeyboard(identified),
      });
    } else {
      const retryKeyboard = new Keyboard()
        .requestContact('📱 Boshqa raqam yuborish')
        .resized()
        .oneTime();
      await ctx.reply(identified.message, { reply_markup: retryKeyboard });
    }
  });

  // 1. O'qituvchi: Bugungi darslarim
  bot.hears('📋 Bugungi darslarim', async (ctx) => {
    const user = userSessions.get(ctx.chat.id);
    if (!user || user.role !== 'teacher' || !user.teacherId) {
      await ctx.reply("Bu bo'lim faqat o'qituvchilar uchun mo'ljallangan.");
      return;
    }
    const text = await TelegramService.getTeacherTodayLessons(db, user.teacherId);
    await ctx.reply(text);
  });

  // 2. O'qituvchi: Davomat holati
  bot.hears('⚡ Davomat holati', async (ctx) => {
    const user = userSessions.get(ctx.chat.id);
    if (!user || user.role !== 'teacher' || !user.teacherId) {
      await ctx.reply("Bu bo'lim faqat o'qituvchilar uchun mo'ljallangan.");
      return;
    }
    const text = await TelegramService.getTeacherTodayLessons(db, user.teacherId);
    await ctx.reply(`${text}\n\nDavomatni to'liq belgilash uchun pastdagi «EduMemory Tizimini Ochish» tugmasidan foydalaning.`);
  });

  // 3. Ota-ona: Bugungi davomat
  bot.hears('📅 Bugungi davomat', async (ctx) => {
    const user = userSessions.get(ctx.chat.id);
    if (!user || user.role !== 'parent' || !user.studentId) {
      await ctx.reply("Bu bo'lim faqat ota-onalar uchun mo'ljallangan.");
      return;
    }
    const text = await TelegramService.getStudentTodayAttendance(db, user.studentId);
    await ctx.reply(text);
  });

  // 4. Ota-ona: Oylik hisobot
  bot.hears('📊 Oylik hisobot', async (ctx) => {
    const user = userSessions.get(ctx.chat.id);
    if (!user || user.role !== 'parent' || !user.studentId) {
      await ctx.reply("Bu bo'lim faqat ota-onalar uchun mo'ljallangan.");
      return;
    }
    const text = await TelegramService.getStudentMonthlyStats(db, user.studentId);
    await ctx.reply(text);
  });

  // 5. Direktor / Admin: Bugungi umumiy davomat
  bot.hears('📊 Bugungi umumiy davomat', async (ctx) => {
    const user = userSessions.get(ctx.chat.id);
    if (!user || !['director', 'owner'].includes(user.role)) {
      await ctx.reply("Bu bo'lim faqat maktab ma'muriyati uchun mo'ljallangan.");
      return;
    }
    const schoolId = user.schoolId || 1;
    const text = await TelegramService.getSchoolTodayStats(db, schoolId);
    await ctx.reply(text);
  });

  // 6. Raqamni almashtirish
  bot.hears('🔄 Raqamni almashtirish', async (ctx) => {
    userSessions.delete(ctx.chat.id);
    userPendingCode.delete(ctx.chat.id);
    const phoneKeyboard = new Keyboard()
      .requestContact('📱 Telefon raqamni yuborish')
      .resized()
      .oneTime();
    await ctx.reply(
      "Raqamingiz tozalandi. Yangi raqamingizni yuborish uchun pastdagi tugmani bosing 👇",
      { reply_markup: phoneKeyboard }
    );
  });

  // /stop buyrug'i — xabarnomalarni to'xtatish
  bot.command('stop', async (ctx) => {
    userSessions.delete(ctx.chat.id);
    userPendingCode.delete(ctx.chat.id);
    const res = await TelegramService.handleStop(db, ctx.chat.id);
    await ctx.reply(res.message, { reply_markup: { remove_keyboard: true } });
  });

  // Bot xatoliklarini ushlash
  bot.catch((err) => {
    console.error('Telegram bot xatosi:', err.error);
  });

  return bot;
}
