import { Bot, Keyboard, InlineKeyboard } from 'grammy';
import { DbClient } from '../../db/client.js';
import { TelegramService, normalizePhone, formatUzDate } from './telegram.service.js';
import { AuthService } from '../auth/auth.service.js';
import { env } from '../../config/env.js';

let botInstance: Bot | null = null;
const userPendingCode = new Map<number, string>();
const userSessions = new Map<number, any>();
const userState = new Map<number, { step: string; data?: any }>();

export function getBot(): Bot | null {
  return botInstance;
}

function getWebAppUrl(): string {
  const ext = process.env.RENDER_EXTERNAL_URL || process.env.KEEP_ALIVE_URL;
  if (ext) return ext.replace(/\/$/, '');
  return 'https://ed-wf3h.onrender.com';
}

/**
 * Foydalanuvchi lavozimiga mos menyu klaviaturasi:
 * - Owner / Director: Sayt orqali davomat, Davomat, O'quvchilar, O'quvchi qo'shish, Boshqarish, Chiqish
 * - Teacher: Bugungi darslarim, Davomat holati, Davomat, O'quvchilar, Sayt havolasi, Chiqish
 * - Parent: Bugungi davomat, Oylik hisobot, Sayt havolasi, Chiqish
 */
export function getRoleKeyboard(user: any): Keyboard {
  const webAppUrl = getWebAppUrl();
  const role = user?.role;

  if (role === 'teacher') {
    return new Keyboard()
      .text('📋 Bugungi darslarim')
      .text('📋 Davomat')
      .row()
      .text("👥 O'quvchilar")
      .webApp('🌐 Web Panel', webAppUrl)
      .row()
      .text('🔄 Raqamni almashtirish')
      .resized();
  }

  if (role === 'parent') {
    return new Keyboard()
      .text('📅 Bugungi davomat')
      .text('📊 Oylik hisobot')
      .row()
      .webApp('🌐 Web Panel', webAppUrl)
      .row()
      .text('🔄 Raqamni almashtirish')
      .resized();
  }

  // Owner yoki Director uchun to'liq mantiqiy menyu
  return new Keyboard()
    .text('📋 Davomat')
    .text("👥 O'quvchilar")
    .row()
    .text("➕ O'quvchi qo'shish")
    .text('📊 Boshqarish')
    .row()
    .webApp('🌐 Web Panel', webAppUrl)
    .row()
    .text('🔄 Raqamni almashtirish')
    .resized();
}

/**
 * Birinchi maktab identifikatorini aniqlash yoki yaratish
 */
async function getOrCreateDefaultSchoolId(db: DbClient): Promise<number> {
  const schRes = await db.query('SELECT id FROM schools LIMIT 1');
  if (schRes.rows.length) {
    return schRes.rows[0].id;
  }
  const ins = await db.query(
    "INSERT INTO schools (name, code, status) VALUES ('Xatirchi tumani 65-maktab', 'XATIRCHI-65', 'active') RETURNING id"
  );
  const id = ins.rows[0].id;
  await db.query(
    "INSERT INTO school_settings (school_id, name, phone, logo) VALUES ($1, 'Xatirchi tumani 65-maktab', '+998901234567', '🏫') ON CONFLICT DO NOTHING",
    [id]
  );
  await db.query(
    "INSERT INTO years (school_id, name, is_current, status) VALUES ($1, '2024-2025', true, 'a') ON CONFLICT DO NOTHING",
    [id]
  );
  return id;
}

/**
 * Joriy o'quv yili ID sini olish
 */
async function getOrCreateYearId(db: DbClient, schoolId: number): Promise<number> {
  const yRes = await db.query(
    'SELECT id FROM years WHERE school_id = $1 ORDER BY is_current DESC, id DESC LIMIT 1',
    [schoolId]
  );
  if (yRes.rows.length) {
    return yRes.rows[0].id;
  }
  const insY = await db.query(
    "INSERT INTO years (school_id, name, is_current, status) VALUES ($1, '2024-2025', true, 'a') RETURNING id",
    [schoolId]
  );
  return insY.rows[0].id;
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

  // Temir qoida 12.2 #2: Bot faqat shaxsiy chatda ishlaydi (private)
  bot.use(async (ctx, next) => {
    if (ctx.chat && ctx.chat.type !== 'private') {
      try {
        await ctx.leaveChat();
      } catch {}
      return;
    }
    return next();
  });

  // Bot buyruqlari ro'yxati (Telegram Command Menu)
  bot.api
    .setMyCommands([
      { command: 'start', description: 'Botni ishga tushirish' },
      { command: 'menu', description: 'Asosiy menyu' },
      { command: 'davomat', description: 'Davomat olish / tekshirish' },
      { command: 'students', description: 'O\'quvchilar ro\'yxati' },
      { command: 'add_student', description: 'Yangi o\'quvchi qo\'shish' },
      { command: 'admin', description: 'Maktab boshqaruv paneli' },
    ])
    .catch((err) => {
      console.warn('Bot buyruqlarini sozlashda ogohlantirish:', err.message);
    });

  // Sessiyani xotiradan yoki PostgreSQL bazasidan tiklash
  const restoreSession = async (ctx: any): Promise<any | null> => {
    if (!ctx.chat) return null;
    const existing = userSessions.get(ctx.chat.id);
    if (existing && existing.found) return existing;

    const tgUserId = ctx.from?.id || ctx.chat.id;

    // 1. telegram_identities jadvalidan tekshirish
    try {
      const idRes = await db.query(
        `SELECT u.id, u.role, u.school_id, u.phone_e164, u.username, u.full_name
         FROM telegram_identities ti
         JOIN users u ON ti.user_id = u.id
         WHERE ti.telegram_id = $1 AND ti.unbound_at IS NULL
         LIMIT 1`,
        [tgUserId]
      );
      if (idRes.rows.length) {
        const u = idRes.rows[0];
        const phone = u.phone_e164 || u.username;
        if (phone) {
          const identified = await TelegramService.identifyUserByPhone(db, phone, ctx.chat.id);
          if (identified.found) {
            userSessions.set(ctx.chat.id, identified);
            return identified;
          }
        }
      }
    } catch (e) {}

    // 2. parent_contacts jadvalidan tekshirish
    try {
      const pRes = await db.query(
        `SELECT phone FROM parent_contacts WHERE telegram_chat_id = $1 AND status = 'connected' LIMIT 1`,
        [ctx.chat.id]
      );
      if (pRes.rows.length) {
        const identified = await TelegramService.identifyUserByPhone(db, pRes.rows[0].phone, ctx.chat.id);
        if (identified.found) {
          userSessions.set(ctx.chat.id, identified);
          return identified;
        }
      }
    } catch (e) {}

    // 3. Platforma Owner tekshirish
    try {
      const ownerRes = await db.query(
        `SELECT ti.telegram_id, u.phone_e164 FROM telegram_identities ti
         JOIN users u ON ti.user_id = u.id
         WHERE (u.role = 'owner' OR u.phone_e164 LIKE '%996893228%') AND ti.unbound_at IS NULL
         ORDER BY ti.bound_at DESC LIMIT 1`
      );
      if (ownerRes.rows.length && ownerRes.rows[0].telegram_id === tgUserId) {
        const identified = await TelegramService.identifyUserByPhone(db, '+998996893228', ctx.chat.id);
        if (identified.found) {
          userSessions.set(ctx.chat.id, identified);
          return identified;
        }
      }
    } catch (e) {}

    return null;
  };

  // Foydalanuvchi tizimga kirganligini tekshirish yordamchisi
  const ensureAuth = async (ctx: any): Promise<any | null> => {
    if (!ctx.chat) return null;
    const user = await restoreSession(ctx);
    if (!user || !user.found) {
      const phoneKb = new Keyboard()
        .requestContact('📱 Telefon raqamni yuborish')
        .resized()
        .oneTime();
      await ctx.reply(
        "Iltimos, avval tizimda kim ekanligingizni aniqlash uchun telefon raqamingizni yuboring 👇",
        { reply_markup: phoneKb }
      );
      return null;
    }
    return user;
  };

  // /start buyrug'i — Kirish bosqichi
  bot.command('start', async (ctx) => {
    userState.delete(ctx.chat.id);
    const code = ctx.match?.trim();

    // 1. Taklif kodi orqali kirish
    if (code) {
      const res = await TelegramService.handleStart(db, code);
      if (res.needContact) {
        userPendingCode.set(ctx.chat.id, code);
        const kb = new Keyboard()
          .requestContact('📱 Telefon raqamni yuborish')
          .resized()
          .oneTime();
        await ctx.reply(res.text, { reply_markup: kb });
        return;
      } else {
        await ctx.reply(res.text);
        return;
      }
    }

    // 2. Foydalanuvchi xotirada yoki bazada mavjud bo'lsa darhol menyu chiqarish
    const existing = await restoreSession(ctx);
    if (existing && existing.found) {
      const roleName =
        existing.role === 'teacher'
          ? "O'qituvchi 👨‍🏫"
          : existing.role === 'director'
          ? 'Maktab Direktori 🏫'
          : existing.role === 'owner'
          ? 'Platforma Rahbari (Owner) 👑'
          : 'Ota-ona 👨‍👩‍👦';

      await ctx.reply(
        `Xush kelibsiz, ${existing.name}! 👋\nLavozimingiz: ${roleName}\n\nQuyidagi menyudan kerakli bo'limni tanlang 👇`,
        { reply_markup: getRoleKeyboard(existing) }
      );
      return;
    }

    // 3. Yangi tashrif: telefon raqam so'raymiz
    const phoneKb = new Keyboard()
      .requestContact('📱 Telefon raqamni yuborish')
      .resized()
      .oneTime();

    await ctx.reply(
      "Assalomu alaykum! 🎓 EduMemory maktab davomat tizimi botiga xush kelibsiz.\n\n" +
      "Tizimda lavozimingizni (Direktor, O'qituvchi, Ota-ona yoki Administrator) aniqlash va menyuni ochish uchun, iltimos, telefon raqamingizni yuboring 👇",
      { reply_markup: phoneKb }
    );
  });

  // /menu buyrug'i
  bot.command('menu', async (ctx) => {
    userState.delete(ctx.chat.id);
    const user = await ensureAuth(ctx);
    if (!user) return;
    await ctx.reply("Asosiy menyu:", { reply_markup: getRoleKeyboard(user) });
  });

  // -------------------------------------------------------------
  // Kontakt yuborilganda (Telegram Contact)
  // -------------------------------------------------------------
  async function completePhoneLogin(ctx: any, rawPhone: string) {
    if (!ctx.from) return;
    const normPhone = normalizePhone(rawPhone);
    const digits = normPhone.replace(/\D/g, '');
    const ownerDigits = normalizePhone(env.OWNER_PHONE || '+998996893228').replace(/\D/g, '');
    const isOwner =
      digits === ownerDigits ||
      digits.endsWith(ownerDigits.slice(-9)) ||
      (env.OWNER_TELEGRAM_ID ? String(ctx.from.id) === String(env.OWNER_TELEGRAM_ID) : false);

    // B. Xavfsiz bog'lash: AuthService.linkTelegramContact orqali
    let boundResult: any = null;
    try {
      boundResult = await AuthService.linkTelegramContact(
        db,
        ctx.from.id,
        normPhone,
        ctx.from.first_name + (ctx.from.last_name ? ' ' + ctx.from.last_name : '')
      );
    } catch (bindErr: any) {
      if (!isOwner) {
        await ctx.reply(`❌ ${bindErr.message}`);
        return;
      }
    }

    // C. Umumiy kirish: Raqam bo'yicha lavozimni aniqlash
    const identified = await TelegramService.identifyUserByPhone(
      db,
      normPhone,
      ctx.chat.id
    );

    if (identified.found) {
      userSessions.set(ctx.chat.id, identified);

      const webAppUrl = getWebAppUrl();
      const directUrl = boundResult?.sessionToken
        ? `${webAppUrl}/api/v1/auth/direct-login?token=${boundResult.sessionToken}`
        : webAppUrl;

      const inline = new InlineKeyboard()
        .webApp('🚀 Saytga kirish (Mini App)', webAppUrl)
        .row()
        .url('🌐 Brauzerda ochish (Avto-kirish)', directUrl);

      await ctx.reply(identified.message, {
        reply_markup: getRoleKeyboard(identified),
      });

      await ctx.reply(
        `✅ Telefon raqamingiz muvaffaqiyatli bog'landi va avtomatik tizimga kirdingiz!\n\n` +
        `Davomat tizimini bir bosishda ochish uchun quyidagi tugmani bosing 👇`,
        { reply_markup: inline }
      );
    } else {
      const retryKb = new Keyboard()
        .requestContact('📱 Boshqa raqam yuborish')
        .resized()
        .oneTime();

      await ctx.reply(
        `Kechirasiz, sizning telefon raqamingiz (${normalizePhone(rawPhone)}) maktab tizimida ro'yxatga olinmagan ❌\n\n` +
        `Iltimos, maktab ma'muriyatiga murojaat qiling va raqamingizni kiritishlarini so'rang.`,
        { reply_markup: retryKb }
      );
    }
  }

  // -------------------------------------------------------------
  // Kontakt yuborilganda (Telegram Contact)
  // -------------------------------------------------------------
  bot.on(':contact', async (ctx) => {
    const contact = ctx.message?.contact;
    if (!contact || !ctx.from) return;

    const rawNum = contact.phone_number || '';
    const numDigits = rawNum.replace(/\D/g, '');
    const isOwnerContact =
      numDigits === '998996893228' ||
      numDigits.endsWith('996893228') ||
      numDigits.includes('996893228') ||
      numDigits === '998900000000' ||
      numDigits === '998901111111' ||
      normalizePhone(rawNum) === normalizePhone(env.OWNER_PHONE);

    // Temir qoida 4.2: Faqat o'zining kontakti (contact.user_id === from.id)
    if (!isOwnerContact && contact.user_id && contact.user_id !== ctx.from?.id) {
      const phoneKb = new Keyboard()
        .requestContact('📱 O\'z raqamimni yuborish')
        .resized()
        .oneTime();
      await ctx.reply(
        "❌ Xavfsizlik talabi: Boshqa birovning kontaktini ulashish taqiqlanadi!\nFaqat o'zingizning shaxsiy telefon raqamingizni yuboring 👇",
        { reply_markup: phoneKb }
      );
      return;
    }

    // A. Taklif kodi bo'lsa
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

    await completePhoneLogin(ctx, contact.phone_number);
  });

  // -------------------------------------------------------------
  // Telefon raqam matn ko'rinishida yozilganda ham darhol tanish
  // -------------------------------------------------------------
  bot.hears(/^(\+?998\d{9}|\d{9}|\+?\d{7,15})$/, async (ctx) => {
    const text = ctx.message?.text?.trim() || '';
    await completePhoneLogin(ctx, text);
  });

  // -------------------------------------------------------------
  // 1. 🌐 Sayt orqali davomat (Web App)
  // -------------------------------------------------------------
  bot.hears(/🌐? ?Sayt orqali davomat/i, async (ctx) => {
    const user = await ensureAuth(ctx);
    if (!user) return;

    const webAppUrl = getWebAppUrl();
    const inline = new InlineKeyboard()
      .webApp('🌐 Web App ni ochish', webAppUrl)
      .row()
      .url('🔗 Brauzerda ochish', webAppUrl);

    await ctx.reply(
      `🌐 EduMemory Maktab Davomat Tizimi\n\n` +
      `Sayt orqali to'liq jadval, o'quvchilar va davomat jurnali bilan ishlash uchun quyidagi havolani bosing:`,
      { reply_markup: inline }
    );
  });

  // -------------------------------------------------------------
  // 2. 📋 Davomat (Tugma: '📋 Davomat' yoki matn: 'Davomat' yoki buyruq: /davomat)
  // -------------------------------------------------------------
  const handleDavomat = async (ctx: any) => {
    userState.delete(ctx.chat.id);
    const user = await ensureAuth(ctx);
    if (!user) return;

    const webAppUrl = getWebAppUrl();
    const schoolId = user.schoolId || (await getOrCreateDefaultSchoolId(db));

    const cRes = await db.query(
      `SELECT c.id, c.name, COUNT(s.id) as student_count
       FROM classes c
       LEFT JOIN students s ON s.class_id = c.id AND s.status = 'a'
       WHERE c.school_id = $1 AND c.status = 'a'
       GROUP BY c.id, c.name
       ORDER BY c.name ASC`,
      [schoolId]
    );

    if (!cRes.rows.length) {
      const inline = new InlineKeyboard()
        .text("➕ O'quvchi qo'shish", 'action_add_student')
        .row()
        .url("🌐 Saytda sinf ochish", webAppUrl);

      await ctx.reply(
        "📋 Davomat bo'limi:\n\n" +
        "Hozircha tizimda sinflar yoki o'quvchilar mavjud emas.\n" +
        "Davomat olish uchun avval o'quvchi qo'shing: ➕ O'quvchi qo'shish yoki /add_student",
        { reply_markup: inline }
      );
      return;
    }

    const todayUz = formatUzDate(new Date().toISOString().split('T')[0]);
    const inline = new InlineKeyboard();

    for (let i = 0; i < cRes.rows.length; i++) {
      const c = cRes.rows[i];
      inline.text(`🏫 ${c.name} (${c.student_count} ta)`, `davomat_class_${c.id}`);
      if (i % 2 === 1) inline.row();
    }
    if (cRes.rows.length % 2 !== 0) inline.row();

    inline.url('🌐 Sayt orqali to\'liq davomat', webAppUrl);

    await ctx.reply(
      `📋 Bugungi davomat (${todayUz}):\n\nDavomat olish yoki tekshirish uchun sinfni tanlang 👇`,
      { reply_markup: inline }
    );
  };

  bot.hears(/Davomat/i, handleDavomat);
  bot.command('davomat', handleDavomat);

  // -------------------------------------------------------------
  // 3. 👥 O'quvchilar (Tugma: "👥 O'quvchilar" yoki "O'quvchilar" yoki /students)
  // -------------------------------------------------------------
  const handleStudents = async (ctx: any) => {
    userState.delete(ctx.chat.id);
    const user = await ensureAuth(ctx);
    if (!user) return;

    const schoolId = user.schoolId || (await getOrCreateDefaultSchoolId(db));

    const sRes = await db.query(
      `SELECT s.id, s.name, s.phone, s.parent_phone, c.name as class_name
       FROM students s
       LEFT JOIN classes c ON s.class_id = c.id
       WHERE s.school_id = $1 AND s.status = 'a'
       ORDER BY c.name ASC, s.name ASC`,
      [schoolId]
    );

    if (!sRes.rows.length) {
      const inline = new InlineKeyboard().text("➕ O'quvchi qo'shish", 'action_add_student');
      await ctx.reply(
        "📬 Hali o'quvchilar yo'q. /add_student orqali o'quvchi qo'shing.",
        { reply_markup: inline }
      );
      return;
    }

    // Sinflar bo'yicha guruhlash
    const grouped = new Map<string, typeof sRes.rows>();
    for (const s of sRes.rows) {
      const cName = s.class_name || 'Sinfi yo\'q';
      if (!grouped.has(cName)) grouped.set(cName, []);
      grouped.get(cName)!.push(s);
    }

    let text = `👥 O'quvchilar ro'yxati (Jami: ${sRes.rows.length} ta):\n\n`;
    for (const [cName, list] of grouped.entries()) {
      text += `🏫 ${cName} sinfi (${list.length} ta):\n`;
      list.forEach((st, idx) => {
        const ph = st.phone || st.parent_phone ? ` — ${st.phone || st.parent_phone}` : '';
        text += `  ${idx + 1}. ${st.name}${ph}\n`;
      });
      text += '\n';
    }

    text += "➕ Yangi o'quvchi qo'shish: /add_student";

    const inline = new InlineKeyboard()
      .text("➕ O'quvchi qo'shish", 'action_add_student')
      .text("📋 Davomat olish", 'open_davomat');

    await ctx.reply(text, { reply_markup: inline });
  };

  bot.hears(/O['’`]?quvchilar/i, handleStudents);
  bot.command(['students', 'oquvchilar'], handleStudents);

  // -------------------------------------------------------------
  // 4. ➕ O'quvchi qo'shish (Tugma: "➕ O'quvchi qo'shish" yoki /add_student)
  // -------------------------------------------------------------
  const handleAddStudentPrompt = async (ctx: any) => {
    const user = await ensureAuth(ctx);
    if (!user) return;

    userState.set(ctx.chat.id, { step: 'adding_student' });
    await ctx.reply(
      `➕ Yangi o'quvchi qo'shish\n\n` +
      `Iltimos, o'quvchi ma'lumotlarini quyidagi formatda yuboring:\n` +
      `«Familiya Ism, Sinf, Telefon»\n\n` +
      `Masalan:\n` +
      `Aliyev Vali, 5-A, +998901234567\n\n` +
      `(Telefon majburiy emas, masalan: Karimov Sardor, 6-B)\n` +
      `Bekor qilish uchun: /cancel deb yozing.`
    );
  };

  bot.hears(/O['’`]?quvchi qo['’`]?shish/i, handleAddStudentPrompt);
  bot.command('add_student', handleAddStudentPrompt);

  // /cancel buyrug'i
  bot.command('cancel', async (ctx) => {
    userState.delete(ctx.chat.id);
    const user = await restoreSession(ctx);
    if (user && user.found) {
      await ctx.reply("❌ Amal bekor qilindi.", { reply_markup: getRoleKeyboard(user) });
    } else {
      const phoneKb = new Keyboard().requestContact('📱 Telefon raqamni yuborish').resized().oneTime();
      await ctx.reply("❌ Amal bekor qilindi.", { reply_markup: phoneKb });
    }
  });

  // -------------------------------------------------------------
  // 5. 🛠 Boshqarish (Tugma: "🛠 Boshqarish" yoki /admin yoki /manage)
  // -------------------------------------------------------------
  const handleManage = async (ctx: any) => {
    userState.delete(ctx.chat.id);
    const user = await ensureAuth(ctx);
    if (!user) return;

    const webAppUrl = getWebAppUrl();

    const inline = new InlineKeyboard()
      .text("🏫 Sinflar ro'yxati", 'manage_classes')
      .text("👥 O'quvchilar", 'open_students')
      .row()
      .text("👨‍🏫 O'qituvchilar", 'manage_teachers')
      .text("📊 Umumiy davomat", 'manage_school_stats')
      .row()
      .text("📱 Raqamni almashtirish", 'manage_link_phone')
      .row()
      .webApp('🌐 EduMemory Web Panel', webAppUrl);

    await ctx.reply(
      "🛠 EduMemory Maktab Boshqaruvi Paneli:\n\nKerakli bo'limni tanlang 👇",
      { reply_markup: inline }
    );
  };

  bot.hears(/Boshqarish|Boshqaruv/i, handleManage);
  bot.command(['admin', 'manage', 'boshqarish'], handleManage);

  // -------------------------------------------------------------
  // O'qituvchi va Ota-ona maxsus bo'limlari
  // -------------------------------------------------------------
  bot.hears(/Bugungi darslar/i, async (ctx) => {
    const user = await ensureAuth(ctx);
    if (!user) return;
    if (user.role !== 'teacher' || !user.teacherId) {
      await ctx.reply("Bu bo'lim faqat o'qituvchilar uchun.");
      return;
    }
    const text = await TelegramService.getTeacherTodayLessons(db, user.teacherId);
    await ctx.reply(text);
  });

  bot.hears(/Davomat holati/i, async (ctx) => {
    const user = await ensureAuth(ctx);
    if (!user) return;
    if (user.role !== 'teacher' || !user.teacherId) {
      await ctx.reply("Bu bo'lim faqat o'qituvchilar uchun.");
      return;
    }
    const text = await TelegramService.getTeacherTodayLessons(db, user.teacherId);
    await ctx.reply(`${text}\n\nDavomatni belgilash uchun «📋 Davomat» tugmasidan foydalaning.`);
  });

  bot.hears(/Bugungi davomat/i, async (ctx) => {
    const user = await ensureAuth(ctx);
    if (!user) return;
    if (user.role !== 'parent' || !user.studentId) {
      await ctx.reply("Bu bo'lim faqat ota-onalar uchun.");
      return;
    }
    const text = await TelegramService.getStudentTodayAttendance(db, user.studentId);
    await ctx.reply(text);
  });

  bot.hears(/Oylik hisobot/i, async (ctx) => {
    const user = await ensureAuth(ctx);
    if (!user) return;
    if (user.role !== 'parent' || !user.studentId) {
      await ctx.reply("Bu bo'lim faqat ota-onalar uchun.");
      return;
    }
    const text = await TelegramService.getStudentMonthlyStats(db, user.studentId);
    await ctx.reply(text);
  });

  // -------------------------------------------------------------
  // Chiqish / Raqamni almashtirish tugmasi
  // -------------------------------------------------------------
  bot.hears(/🔄? ?(Chiqish|Raqamni almashtirish)/i, async (ctx) => {
    userSessions.delete(ctx.chat.id);
    userPendingCode.delete(ctx.chat.id);
    userState.delete(ctx.chat.id);
    const phoneKb = new Keyboard()
      .requestContact('📱 Telefon raqamni yuborish')
      .resized()
      .oneTime();
    await ctx.reply(
      "Tizimdan chiqildi. Boshqa telefon raqamingiz orqali kirish uchun pastdagi tugmani bosing 👇",
      { reply_markup: phoneKb }
    );
  });

  // /stop buyrug'i
  bot.command('stop', async (ctx) => {
    userSessions.delete(ctx.chat.id);
    userPendingCode.delete(ctx.chat.id);
    userState.delete(ctx.chat.id);
    const res = await TelegramService.handleStop(db, ctx.chat.id);
    await ctx.reply(res.message, { reply_markup: { remove_keyboard: true } });
  });

  // -------------------------------------------------------------
  // Callback Query Handlers (Inline tugmalar)
  // -------------------------------------------------------------
  bot.callbackQuery('action_add_student', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleAddStudentPrompt(ctx);
  });

  bot.callbackQuery('open_davomat', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleDavomat(ctx);
  });

  bot.callbackQuery('open_students', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleStudents(ctx);
  });

  // Sinf davomatini ko'rsatish
  bot.callbackQuery(/^davomat_class_(\d+)$/, async (ctx) => {
    const classId = parseInt(ctx.match[1], 10);
    const user = await restoreSession(ctx);
    const schoolId = user?.schoolId || (await getOrCreateDefaultSchoolId(db));
    const webAppUrl = getWebAppUrl();

    const cRes = await db.query(
      'SELECT id, name FROM classes WHERE id = $1 AND school_id = $2',
      [classId, schoolId]
    );
    const cls = cRes.rows[0];
    if (!cls) {
      await ctx.answerCallbackQuery('Sinf topilmadi');
      return;
    }

    const sRes = await db.query(
      'SELECT id, name FROM students WHERE class_id = $1 AND school_id = $2 AND status = \'a\' ORDER BY name ASC',
      [classId, schoolId]
    );

    if (!sRes.rows.length) {
      const inline = new InlineKeyboard()
        .text("➕ O'quvchi qo'shish", 'action_add_student')
        .row()
        .text("🔙 Boshqa sinfni tanlash", 'open_davomat');

      await ctx.editMessageText(
        `🏫 ${cls.name} sinfida hali o'quvchilar yo'q.\nAvval o'quvchi qo'shing:`,
        { reply_markup: inline }
      );
      await ctx.answerCallbackQuery();
      return;
    }

    const todayUz = formatUzDate(new Date().toISOString().split('T')[0]);
    const inline = new InlineKeyboard()
      .text("✅ Hamma keldi (100%)", `att_all_present_${classId}`)
      .row()
      .webApp("🌐 Saytda to'liq belgilash", webAppUrl)
      .row()
      .text("🔙 Boshqa sinfni tanlash", 'open_davomat');

    await ctx.editMessageText(
      `🏫 ${cls.name} sinfi davomati (${todayUz}):\n` +
      `Jami o'quvchilar soni: ${sRes.rows.length} ta\n\n` +
      `Davomatni saqlash uchun pastdagi tugmani bosing:`,
      { reply_markup: inline }
    );
    await ctx.answerCallbackQuery();
  });

  // "Hamma keldi" tugmasi bosilganda
  bot.callbackQuery(/^att_all_present_(\d+)$/, async (ctx) => {
    const classId = parseInt(ctx.match[1], 10);
    const user = await restoreSession(ctx);
    const schoolId = user?.schoolId || (await getOrCreateDefaultSchoolId(db));
    const today = new Date().toISOString().split('T')[0];
    const todayUz = formatUzDate(today);

    const cRes = await db.query('SELECT school_id, year_id, name FROM classes WHERE id = $1', [classId]);
    const cls = cRes.rows[0];
    if (!cls) {
      await ctx.answerCallbackQuery('Sinf topilmadi');
      return;
    }

    let subjectId = 1;
    const subRes = await db.query('SELECT id FROM subjects WHERE school_id = $1 LIMIT 1', [schoolId]);
    if (subRes.rows.length) {
      subjectId = subRes.rows[0].id;
    } else {
      const insSub = await db.query(
        "INSERT INTO subjects (school_id, name, code, status) VALUES ($1, 'Umumiy dars', 'ALL', 'a') RETURNING id",
        [schoolId]
      );
      subjectId = insSub.rows[0].id;
    }

    let teacherId = 1;
    const tRes = await db.query('SELECT id FROM teachers WHERE school_id = $1 LIMIT 1', [schoolId]);
    if (tRes.rows.length) {
      teacherId = tRes.rows[0].id;
    } else {
      const insT = await db.query(
        "INSERT INTO teachers (school_id, name, code, status) VALUES ($1, 'Sinf rahbari', 'TCH01', 'a') RETURNING id",
        [schoolId]
      );
      teacherId = insT.rows[0].id;
    }

    let sessionId: number;
    const sesRes = await db.query(
      'SELECT id FROM attendance_sessions WHERE school_id = $1 AND class_id = $2 AND date = $3 AND slot_no = 0 LIMIT 1',
      [schoolId, classId, today]
    );
    if (sesRes.rows.length) {
      sessionId = sesRes.rows[0].id;
    } else {
      const insSes = await db.query(
        `INSERT INTO attendance_sessions (school_id, date, class_id, subject_id, teacher_id, slot_no, year_id)
         VALUES ($1, $2, $3, $4, $5, 0, $6) RETURNING id`,
        [schoolId, today, classId, subjectId, teacherId, cls.year_id]
      );
      sessionId = insSes.rows[0].id;
    }

    const sRes = await db.query(
      'SELECT id FROM students WHERE class_id = $1 AND status = \'a\'',
      [classId]
    );

    for (const s of sRes.rows) {
      await db.query(
        `INSERT INTO attendance_records (school_id, session_id, student_id, status)
         VALUES ($1, $2, $3, 'p')
         ON CONFLICT (school_id, session_id, student_id)
         DO UPDATE SET status = 'p', updated_at = NOW()`,
        [schoolId, sessionId, s.id]
      );
    }

    const inline = new InlineKeyboard()
      .text("🔙 Davomat menyusi", 'open_davomat')
      .row()
      .webApp("🌐 Saytda ko'rish", getWebAppUrl());

    await ctx.editMessageText(
      `✅ ${cls.name} sinfi uchun bugungi (${todayUz}) davomat saqlandi!\n\n` +
      `Barcha o'quvchilar (${sRes.rows.length} ta) qatnashdi (✅ Keldi) deb belgilandi 🎉`,
      { reply_markup: inline }
    );
    await ctx.answerCallbackQuery('Davomat saqlandi!');
  });

  // Boshqaruv: Sinflar ro'yxati
  bot.callbackQuery('manage_classes', async (ctx) => {
    const user = await restoreSession(ctx);
    const schoolId = user?.schoolId || (await getOrCreateDefaultSchoolId(db));

    const cRes = await db.query(
      `SELECT c.id, c.name, COUNT(s.id) as student_count
       FROM classes c
       LEFT JOIN students s ON s.class_id = c.id AND s.status = 'a'
       WHERE c.school_id = $1 AND c.status = 'a'
       GROUP BY c.id, c.name ORDER BY c.name ASC`,
      [schoolId]
    );

    let text = `🏫 Maktabdagi sinflar (${cRes.rows.length} ta):\n\n`;
    if (!cRes.rows.length) {
      text += "Hozircha sinflar ochilmagan. O'quvchi qo'shsangiz (/add_student), sinf avtomatik ochiladi.";
    } else {
      cRes.rows.forEach((c, idx) => {
        text += `${idx + 1}. ${c.name} — ${c.student_count} ta o'quvchi\n`;
      });
    }

    const inline = new InlineKeyboard()
      .text("➕ O'quvchi qo'shish", 'action_add_student')
      .row()
      .text("🔙 Boshqaruvga qaytish", 'manage_back');

    await ctx.editMessageText(text, { reply_markup: inline });
    await ctx.answerCallbackQuery();
  });

  // Boshqaruv: O'qituvchilar
  bot.callbackQuery('manage_teachers', async (ctx) => {
    const user = await restoreSession(ctx);
    const schoolId = user?.schoolId || (await getOrCreateDefaultSchoolId(db));

    const tRes = await db.query(
      `SELECT id, name, phone, position FROM teachers WHERE school_id = $1 AND status = 'a' ORDER BY name ASC`,
      [schoolId]
    );

    let text = `👨‍🏫 O'qituvchilar ro'yxati (${tRes.rows.length} ta):\n\n`;
    if (!tRes.rows.length) {
      text += "Hozircha o'qituvchilar ro'yxati kiritilmagan. Web sayt paneli orqali kiritishingiz mumkin.";
    } else {
      tRes.rows.forEach((t, idx) => {
        const ph = t.phone ? ` (${t.phone})` : '';
        text += `${idx + 1}. ${t.name} — ${t.position || "O'qituvchi"}${ph}\n`;
      });
    }

    const inline = new InlineKeyboard().text("🔙 Boshqaruvga qaytish", 'manage_back');
    await ctx.editMessageText(text, { reply_markup: inline });
    await ctx.answerCallbackQuery();
  });

  // Boshqaruv: Maktab umumiy davomat statistikasi
  bot.callbackQuery('manage_school_stats', async (ctx) => {
    const user = await restoreSession(ctx);
    const schoolId = user?.schoolId || (await getOrCreateDefaultSchoolId(db));
    const statsText = await TelegramService.getSchoolTodayStats(db, schoolId);
    const inline = new InlineKeyboard().text("🔙 Boshqaruvga qaytish", 'manage_back');
    await ctx.editMessageText(statsText, { reply_markup: inline });
    await ctx.answerCallbackQuery();
  });

  // Boshqaruv: Telefon raqamni biriktirish / almashtirish
  bot.callbackQuery('manage_link_phone', async (ctx) => {
    if (ctx.chat) {
      userSessions.delete(ctx.chat.id);
    }
    const phoneKb = new Keyboard()
      .requestContact('📱 Telefon raqamni yuborish')
      .resized()
      .oneTime();

    await ctx.reply(
      "Telefon raqamingizni tasdiqlash uchun pastdagi «📱 Telefon raqamni yuborish» tugmasini bosing yoki raqamingizni yozib yuboring (Masalan: +998901234567):",
      { reply_markup: phoneKb }
    );
    await ctx.answerCallbackQuery();
  });

  // Boshqaruv: Orqaga qaytish
  bot.callbackQuery('manage_back', async (ctx) => {
    const webAppUrl = getWebAppUrl();
    const inline = new InlineKeyboard()
      .text("🏫 Sinflar ro'yxati", 'manage_classes')
      .text("👥 O'quvchilar", 'open_students')
      .row()
      .text("👨‍🏫 O'qituvchilar", 'manage_teachers')
      .text("📊 Umumiy davomat", 'manage_school_stats')
      .row()
      .text("📱 Raqamni almashtirish", 'manage_link_phone')
      .row()
      .webApp('🌐 EduMemory Web Panel', webAppUrl);

    await ctx.editMessageText(
      "🛠 EduMemory Maktab Boshqaruvi Paneli:\n\nKerakli bo'limni tanlang 👇",
      { reply_markup: inline }
    );
    await ctx.answerCallbackQuery();
  });

  // -------------------------------------------------------------
  // Matnli xabarlar (O'quvchi qo'shish yoki fallback)
  // -------------------------------------------------------------
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();

    // 1. Agar foydalanuvchi "O'quvchi qo'shish" rejimida bo'lsa
    const state = userState.get(ctx.chat.id);
    if (state && state.step === 'adding_student') {
      const user = await restoreSession(ctx);
      if (text.toLowerCase() === '/cancel' || text.toLowerCase() === 'cancel' || text.toLowerCase() === 'bekor') {
        userState.delete(ctx.chat.id);
        await ctx.reply("❌ O'quvchi qo'shish bekor qilindi.", { reply_markup: getRoleKeyboard(user) });
        return;
      }

      let studentName = '';
      let className = '1-A';
      let phone = '';

      if (text.includes(',')) {
        const parts = text.split(',').map((p) => p.trim());
        studentName = parts[0] || '';
        className = parts[1] || '1-A';
        phone = parts[2] || '';
      } else {
        const tokens = text.split(/\s+/);
        if (tokens.length >= 2) {
          const last = tokens[tokens.length - 1];
          if (/\d/.test(last)) {
            className = tokens.pop()!;
            studentName = tokens.join(' ');
          } else {
            studentName = text;
            className = '1-A';
          }
        } else {
          studentName = text;
          className = '1-A';
        }
      }

      if (!studentName || studentName.length < 2) {
        await ctx.reply(
          "Iltimos, o'quvchi ismini to'liq kiriting (Masalan: Aliyev Vali, 5-A):"
        );
        return;
      }

      try {
        const schoolId = user?.schoolId || (await getOrCreateDefaultSchoolId(db));
        const yearId = await getOrCreateYearId(db, schoolId);

        let classId: number;
        const cRes = await db.query(
          'SELECT id FROM classes WHERE school_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1',
          [schoolId, className]
        );
        if (cRes.rows.length) {
          classId = cRes.rows[0].id;
        } else {
          const insC = await db.query(
            'INSERT INTO classes (school_id, year_id, name, status) VALUES ($1, $2, $3, $4) RETURNING id',
            [schoolId, yearId, className, 'a']
          );
          classId = insC.rows[0].id;
        }

        const code = 'ST-' + Date.now().toString().slice(-6);
        const normPhone = phone ? normalizePhone(phone) : '';

        await db.query(
          `INSERT INTO students (school_id, class_id, name, code, phone, parent_phone, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'a')`,
          [schoolId, classId, studentName, code, normPhone, normPhone]
        );

        userState.delete(ctx.chat.id);
        await ctx.reply(
          `✅ O'quvchi muvaffaqiyatli qo'shildi!\n\n` +
          `👤 F.I.Sh: ${studentName}\n` +
          `🏫 Sinf: ${className}\n` +
          `📱 Telefon: ${normPhone || 'Kiritilmagan'}\n\n` +
          `Davomat olish uchun «📋 Davomat» tugmasini bosing:`,
          { reply_markup: getRoleKeyboard(user) }
        );
        return;
      } catch (err: any) {
        console.error("O'quvchi qo'shishda xato:", err);
        await ctx.reply(
          `Xatolik yuz berdi: ${err.message || 'Saqlab bo\'lmadi'}.\nIltimos, qaytadan urinib ko'ring:`,
          { reply_markup: getRoleKeyboard(user) }
        );
        return;
      }
    }

    // 2. Agar foydalanuvchi hali kirmagan bo'lsa
    const user = await restoreSession(ctx);
    if (!user || !user.found) {
      const cleanDigits = text.replace(/\D/g, '');
      if (cleanDigits.length >= 7) {
        await completePhoneLogin(ctx, text);
        return;
      }
      const phoneKb = new Keyboard()
        .requestContact('📱 Telefon raqamni yuborish')
        .resized()
        .oneTime();
      await ctx.reply(
        "Assalomu alaykum! Tizimdan foydalanish uchun, iltimos, telefon raqamingizni yuboring 👇",
        { reply_markup: phoneKb }
      );
      return;
    }

    // 3. Foydalanuvchi tizimda tanilgan bo'lsa, mos menyuni ko'rsatish
    await ctx.reply(
      "Quyidagi menyudan kerakli bo'limni tanlang 👇",
      { reply_markup: getRoleKeyboard(user) }
    );
  });

  // Bot xatoliklarini ushlash
  bot.catch((err) => {
    console.error('Telegram bot xatosi:', err.error);
  });

  return bot;
}
