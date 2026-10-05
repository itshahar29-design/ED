import { Bot, Keyboard, InlineKeyboard } from 'grammy';
import { DbClient } from '../../db/client.js';
import { TelegramService, normalizePhone, formatUzDate } from './telegram.service.js';
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
 * Asosiy klaviatura — Foydalanuvchi rasmdagi kabi:
 * 1-qator: 🌐 Sayt orqali davomat (Web App)
 * 2-qator: 📋 Davomat
 * 3-qator: 👥 O'quvchilar | ➕ O'quvchi qo'shish
 * 4-qator: 🛠 Boshqarish
 */
export function getMainMenuKeyboard(): Keyboard {
  const webAppUrl = getWebAppUrl();
  return new Keyboard()
    .webApp('🌐 Sayt orqali davomat (Web App)', webAppUrl)
    .row()
    .text('📋 Davomat')
    .row()
    .text("👥 O'quvchilar")
    .text("➕ O'quvchi qo'shish")
    .row()
    .text('🛠 Boshqarish')
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
    "INSERT INTO schools (name, code, status) VALUES ('EduMemory Maktab', 'SCH01', 'active') RETURNING id"
  );
  const id = ins.rows[0].id;
  await db.query(
    "INSERT INTO school_settings (school_id, name, phone, logo) VALUES ($1, 'EduMemory Maktab', '+998901234567', '🎓') ON CONFLICT DO NOTHING",
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

  // /start buyrug'i
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
        await ctx.reply(res.text, { reply_markup: getMainMenuKeyboard() });
        return;
      }
    }

    // 2. Foydalanuvchi avval tanilgan bo'lsa
    const existing = userSessions.get(ctx.chat.id);
    if (existing && existing.found) {
      const roleName =
        existing.role === 'teacher'
          ? "O'qituvchi 👨‍🏫"
          : existing.role === 'director'
          ? 'Maktab Direktori 🏫'
          : existing.role === 'owner'
          ? 'Administrator 👑'
          : 'Ota-ona 👨‍👩‍👦';

      await ctx.reply(
        `Xush kelibsiz, ${existing.name}! 👋\nLavozimingiz: ${roleName}\n\nQuyidagi menyudan kerakli bo'limni tanlang 👇`,
        { reply_markup: getMainMenuKeyboard() }
      );
      return;
    }

    // 3. Umumiy boshlang'ich xabar
    await ctx.reply(
      `Assalomu alaykum! 🎓 EduMemory maktab davomat tizimi botiga xush kelibsiz.\n\n` +
      `Quyidagi tugmalar orqali davomat olish, o'quvchilarni ko'rish yoki yangi o'quvchi qo'shishingiz mumkin 👇`,
      { reply_markup: getMainMenuKeyboard() }
    );
  });

  // /menu buyrug'i
  bot.command('menu', async (ctx) => {
    userState.delete(ctx.chat.id);
    await ctx.reply("Asosiy menyu:", { reply_markup: getMainMenuKeyboard() });
  });

  // -------------------------------------------------------------
  // 1. 🌐 Sayt orqali davomat (Web App)
  // -------------------------------------------------------------
  bot.hears(/🌐? ?Sayt orqali davomat/i, async (ctx) => {
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
    const webAppUrl = getWebAppUrl();
    const schoolId = await getOrCreateDefaultSchoolId(db);

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

  bot.hears(/📋? ?Davomat/i, handleDavomat);
  bot.command('davomat', handleDavomat);

  // -------------------------------------------------------------
  // 3. 👥 O'quvchilar (Tugma: "👥 O'quvchilar" yoki "O'quvchilar" yoki /students)
  // -------------------------------------------------------------
  const handleStudents = async (ctx: any) => {
    userState.delete(ctx.chat.id);
    const schoolId = await getOrCreateDefaultSchoolId(db);

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

  bot.hears(/👥? ?O'quvchilar/i, handleStudents);
  bot.command(['students', 'oquvchilar'], handleStudents);

  // -------------------------------------------------------------
  // 4. ➕ O'quvchi qo'shish (Tugma: "➕ O'quvchi qo'shish" yoki /add_student)
  // -------------------------------------------------------------
  const handleAddStudentPrompt = async (ctx: any) => {
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

  bot.hears(/➕? ?O'quvchi qo'shish/i, handleAddStudentPrompt);
  bot.command('add_student', handleAddStudentPrompt);

  // /cancel buyrug'i
  bot.command('cancel', async (ctx) => {
    userState.delete(ctx.chat.id);
    await ctx.reply("❌ Amal bekor qilindi.", { reply_markup: getMainMenuKeyboard() });
  });

  // -------------------------------------------------------------
  // 5. 🛠 Boshqarish (Tugma: "🛠 Boshqarish" yoki /admin yoki /manage)
  // -------------------------------------------------------------
  const handleManage = async (ctx: any) => {
    userState.delete(ctx.chat.id);
    const webAppUrl = getWebAppUrl();

    const inline = new InlineKeyboard()
      .text("🏫 Sinflar ro'yxati", 'manage_classes')
      .text("👥 O'quvchilar", 'open_students')
      .row()
      .text("👨‍🏫 O'qituvchilar", 'manage_teachers')
      .text("📊 Umumiy davomat", 'manage_school_stats')
      .row()
      .text("📱 Telefon raqamni yangilash", 'manage_link_phone')
      .row()
      .webApp('🌐 EduMemory Web Panel', webAppUrl);

    await ctx.reply(
      "🛠 EduMemory Maktab Boshqaruvi Paneli:\n\nKerakli bo'limni tanlang 👇",
      { reply_markup: inline }
    );
  };

  bot.hears(/🛠? ?Boshqarish/i, handleManage);
  bot.command(['admin', 'manage', 'boshqarish'], handleManage);

  // -------------------------------------------------------------
  // Callback Query Handlers (Inline tugmalar uchun)
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
    const schoolId = await getOrCreateDefaultSchoolId(db);
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
    const schoolId = await getOrCreateDefaultSchoolId(db);
    const today = new Date().toISOString().split('T')[0];
    const todayUz = formatUzDate(today);

    const cRes = await db.query('SELECT school_id, year_id, name FROM classes WHERE id = $1', [classId]);
    const cls = cRes.rows[0];
    if (!cls) {
      await ctx.answerCallbackQuery('Sinf topilmadi');
      return;
    }

    // Fan aniqlash yoki yaratish
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

    // O'qituvchi aniqlash yoki yaratish
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

    // Davomat sessiyasi
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

    // Barcha o'quvchilarni 'p' (Keldi) deb yozish
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
    const schoolId = await getOrCreateDefaultSchoolId(db);
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
    const schoolId = await getOrCreateDefaultSchoolId(db);
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
    const schoolId = await getOrCreateDefaultSchoolId(db);
    const statsText = await TelegramService.getSchoolTodayStats(db, schoolId);
    const inline = new InlineKeyboard().text("🔙 Boshqaruvga qaytish", 'manage_back');
    await ctx.editMessageText(statsText, { reply_markup: inline });
    await ctx.answerCallbackQuery();
  });

  // Boshqaruv: Telefon raqamni biriktirish
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
      .text("📱 Telefon raqamni yangilash", 'manage_link_phone')
      .row()
      .webApp('🌐 EduMemory Web Panel', webAppUrl);

    await ctx.editMessageText(
      "🛠 EduMemory Maktab Boshqaruvi Paneli:\n\nKerakli bo'limni tanlang 👇",
      { reply_markup: inline }
    );
    await ctx.answerCallbackQuery();
  });

  // -------------------------------------------------------------
  // Kontakt yuborilganda (Telegram Contact)
  // -------------------------------------------------------------
  bot.on(':contact', async (ctx) => {
    const contact = ctx.message?.contact;
    if (!contact) return;

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
      await ctx.reply(res.message, { reply_markup: getMainMenuKeyboard() });
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
        reply_markup: getMainMenuKeyboard(),
      });
    } else {
      await ctx.reply(
        `Telefon raqamingiz (${normalizePhone(contact.phone_number)}) qabul qilindi ✅\n` +
        `Siz EduMemory botining barcha funksiyalaridan foydalanishingiz mumkin.`,
        { reply_markup: getMainMenuKeyboard() }
      );
    }
  });

  // Raqamni almashtirish tugmasi
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

  // /stop buyrug'i
  bot.command('stop', async (ctx) => {
    userSessions.delete(ctx.chat.id);
    userPendingCode.delete(ctx.chat.id);
    userState.delete(ctx.chat.id);
    const res = await TelegramService.handleStop(db, ctx.chat.id);
    await ctx.reply(res.message, { reply_markup: { remove_keyboard: true } });
  });

  // -------------------------------------------------------------
  // Matnli xabarlar (Student qo'shish, telefon yozish yoki fallback)
  // -------------------------------------------------------------
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();

    // 1. Agar foydalanuvchi "O'quvchi qo'shish" rejimida bo'lsa
    const state = userState.get(ctx.chat.id);
    if (state && state.step === 'adding_student') {
      if (text.toLowerCase() === '/cancel' || text.toLowerCase() === 'cancel' || text.toLowerCase() === 'bekor') {
        userState.delete(ctx.chat.id);
        await ctx.reply("❌ O'quvchi qo'shish bekor qilindi.", { reply_markup: getMainMenuKeyboard() });
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
        const schoolId = await getOrCreateDefaultSchoolId(db);
        const yearId = await getOrCreateYearId(db, schoolId);

        // Sinfni topish yoki yaratish
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

        // O'quvchini qo'shish
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
          { reply_markup: getMainMenuKeyboard() }
        );
        return;
      } catch (err: any) {
        console.error("O'quvchi qo'shishda xato:", err);
        await ctx.reply(
          `Xatolik yuz berdi: ${err.message || 'Saqlab bo\'lmadi'}.\nIltimos, qaytadan urinib ko'ring:`,
          { reply_markup: getMainMenuKeyboard() }
        );
        return;
      }
    }

    // 2. Agar telefon raqam yozilgan bo'lsa (+998901234567 yoki 901234567)
    if (/^(\+?998\d{9}|\d{9})$/.test(text.replace(/\s+/g, ''))) {
      const identified = await TelegramService.identifyUserByPhone(
        db,
        text,
        ctx.chat.id
      );
      if (identified.found) {
        userSessions.set(ctx.chat.id, identified);
        await ctx.reply(identified.message, { reply_markup: getMainMenuKeyboard() });
      } else {
        await ctx.reply(
          `Telefon raqamingiz (${normalizePhone(text)}) qabul qilindi ✅\nSiz bot menyusidan erkin foydalanishingiz mumkin:`,
          { reply_markup: getMainMenuKeyboard() }
        );
      }
      return;
    }

    // 3. Fallback (Tushunarsiz xabar kelganda jim turmasdan menyuni ko'rsatish)
    await ctx.reply(
      "Quyidagi menyudan kerakli bo'limni tanlang 👇",
      { reply_markup: getMainMenuKeyboard() }
    );
  });

  // Bot xatoliklarini ushlash
  bot.catch((err) => {
    console.error('Telegram bot xatosi:', err.error);
  });

  return bot;
}
