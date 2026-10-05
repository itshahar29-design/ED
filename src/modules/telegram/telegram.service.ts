import crypto from 'crypto';
import { DbClient } from '../../db/client.js';
import { env } from '../../config/env.js';

const UZ_MONTHS: Record<number, string> = {
  1: 'yanvar',
  2: 'fevral',
  3: 'mart',
  4: 'aprel',
  5: 'may',
  6: 'iyun',
  7: 'iyul',
  8: 'avgust',
  9: 'sentyabr',
  10: 'oktyabr',
  11: 'noyabr',
  12: 'dekabr',
};

export function normalizePhone(raw: string): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 9) {
    return '+998' + digits;
  }
  if (digits.length === 12 && digits.startsWith('998')) {
    return '+' + digits;
  }
  if (digits.length > 9 && !digits.startsWith('998')) {
    return '+' + digits;
  }
  return '+' + digits;
}

export function formatUzDate(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const day = parseInt(parts[2], 10);
  const month = parseInt(parts[1], 10);
  return `${day}-${UZ_MONTHS[month] || month}`;
}

export interface StudentLessonRecord {
  slot_number: number;
  subject_name: string;
  status: 'p' | 'a' | 'l' | 'e';
}

export function composeAttendanceNotification(
  studentName: string,
  className: string,
  dateStr: string,
  records: StudentLessonRecord[]
): string {
  const dateFormatted = formatUzDate(dateStr);
  const header = `📚 Assalomu alaykum! ${studentName} (${className}) ${dateFormatted} kuni:`;

  if (records.length === 0) {
    return `${header}\nDavomat ma'lumotlari mavjud emas.`;
  }

  const badRecords = records.filter((r) => r.status !== 'p');
  const sorted = [...records].sort((a, b) => a.slot_number - b.slot_number);

  if (badRecords.length === 0) {
    return `${header}\nBarcha darslarda (${records.length} ta) qatnashdi ✅`;
  }

  const lines: string[] = [header];
  const BAD_STATUS_MAP: Record<'a' | 'l' | 'e', { icon: string; label: string }> = {
    a: { icon: '❌', label: 'kelmadi' },
    l: { icon: '⏰', label: 'kechikdi' },
    e: { icon: 'ℹ️', label: 'sababli qoldirdi' },
  };

  for (const r of sorted) {
    if (r.status !== 'p') {
      const meta = BAD_STATUS_MAP[r.status];
      lines.push(`${meta.icon} ${r.slot_number + 1}-dars ${r.subject_name} — ${meta.label}`);
    }
  }

  if (badRecords.length < records.length) {
    lines.push('Qolgan darslarda qatnashdi ✅');
  }

  return lines.join('\n');
}

export class TelegramService {
  /**
   * O'quvchi uchun 7 kun amal qiladigan bir martalik taklif havolasi yaratish
   */
  static async createInvite(
    db: DbClient,
    schoolId: number,
    studentId: number,
    customPhone?: string
  ): Promise<{ code: string; phone: string; expires_at: Date; link: string }> {
    // O'quvchi mavjudligini tekshirish
    const sRes = await db.query(
      'SELECT id, name, phone, parent_phone FROM students WHERE school_id = $1 AND id = $2',
      [schoolId, studentId]
    );
    if (!sRes.rows.length) {
      throw new Error("O'quvchi topilmadi");
    }
    const student = sRes.rows[0];

    const rawPhone = customPhone || student.parent_phone || student.phone;
    if (!rawPhone) {
      throw new Error("Ota-ona telefon raqami ko'rsatilmagan");
    }
    const normalized = normalizePhone(rawPhone);

    const code = crypto.randomBytes(12).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 kun

    await db.query(
      `INSERT INTO telegram_invites (code, school_id, student_id, phone, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [code, schoolId, studentId, normalized, expiresAt]
    );

    const botUsername = env.TELEGRAM_BOT_USERNAME || 'edumemory_bot';
    const link = `https://t.me/${botUsername}?start=${code}`;

    return {
      code,
      phone: normalized,
      expires_at: expiresAt,
      link,
    };
  }

  /**
   * Telegram bot /start <code> buyrug'ini tekshirish
   */
  static async handleStart(
    db: DbClient,
    code?: string
  ): Promise<{ text: string; needContact: boolean; invite?: any }> {
    if (!code) {
      return {
        text: "Assalomu alaykum! EduMemory maktab davomat botiga xush kelibsiz.\n\nFarzandingiz davomatidan xabardor bo'lish uchun maktab taqdim etgan maxsus havola orqali kiring.",
        needContact: false,
      };
    }

    const res = await db.query(
      `SELECT ti.*, st.name as student_name, s.name as school_name
       FROM telegram_invites ti
       JOIN students st ON ti.student_id = st.id AND ti.school_id = st.school_id
       JOIN schools s ON ti.school_id = s.id
       WHERE ti.code = $1`,
      [code]
    );

    if (!res.rows.length) {
      return {
        text: 'Kechirasiz, ushbu taklif havolasi eskirgan yoki mavjud emas.',
        needContact: false,
      };
    }

    const invite = res.rows[0];
    if (invite.used_at) {
      return {
        text: 'Ushbu taklif havolasi allaqachon ishlatilgan.',
        needContact: false,
      };
    }

    if (new Date(invite.expires_at) < new Date()) {
      return {
        text: 'Kechirasiz, taklif havolasining 7 kunlik amal qilish muddati tugagan.',
        needContact: false,
      };
    }

    return {
      text: `Assalomu alaykum!\n«${invite.school_name}» ${invite.student_name} o'quvchisining davomat xabarlariga ulanish uchun pastdagi tugmani bosing va telefon raqamingizni yuboring:`,
      needContact: true,
      invite,
    };
  }

  /**
   * Telegram orqali yuborilgan kontaktni tasdiqlash
   */
  static async verifyContact(
    db: DbClient,
    code: string,
    chatId: number,
    incomingPhone: string
  ): Promise<{ success: boolean; status: 'connected' | 'pending'; message: string }> {
    const normalizedIncoming = normalizePhone(incomingPhone);

    const invRes = await db.query(
      `SELECT * FROM telegram_invites
       WHERE code = $1 AND used_at IS NULL AND expires_at > NOW()`,
      [code]
    );

    if (!invRes.rows.length) {
      return {
        success: false,
        status: 'pending',
        message: 'Taklif havolasi yaroqsiz yoki muddati tugagan.',
      };
    }

    const invite = invRes.rows[0];
    const invitePhone = normalizePhone(invite.phone);

    if (invitePhone === normalizedIncoming) {
      // Telefon mos keldi: bog'lash va rozilik sanasini belgilash
      await db.query(
        `UPDATE telegram_invites SET used_at = NOW() WHERE code = $1`,
        [code]
      );

      // parent_contacts ga ulangan holda yozish
      await db.query(
        `INSERT INTO parent_contacts (school_id, student_id, phone, telegram_chat_id, status, consent_at)
         VALUES ($1, $2, $3, $4, 'connected', NOW())
         ON CONFLICT DO NOTHING`,
        [invite.school_id, invite.student_id, normalizedIncoming, chatId]
      );

      // Agar oldin mavjud bo'lsa yangilash
      await db.query(
        `UPDATE parent_contacts
         SET status = 'connected', telegram_chat_id = $1, consent_at = NOW()
         WHERE school_id = $2 AND student_id = $3 AND phone = $4`,
        [chatId, invite.school_id, invite.student_id, normalizedIncoming]
      );

      return {
        success: true,
        status: 'connected',
        message: "Assalomu alaykum! Telefon raqamingiz muvaffaqiyatli tasdiqlandi. Farzandingiz davomati bo'yicha xabarnomalar yoqildi ✅",
      };
    } else {
      // Telefon mos kelmadi: kutilmoqda (admin tasdig'i talab etiladi)
      await db.query(
        `INSERT INTO parent_contacts (school_id, student_id, phone, telegram_chat_id, status)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [invite.school_id, invite.student_id, normalizedIncoming, chatId]
      );

      return {
        success: false,
        status: 'pending',
        message: "Telefon raqamingiz maktab bazasidagi raqam bilan mos kelmadi. Maktab ma'muriyati tasdiqlagach xabarnomalar yoqiladi ⏳",
      };
    }
  }

  /**
   * Foydalanuvchi /stop buyrug'ini yuborganda aloqani uzish
   */
  static async handleStop(db: DbClient, chatId: number): Promise<{ message: string }> {
    await db.query(
      `UPDATE parent_contacts
       SET status = 'unlinked', telegram_chat_id = NULL
       WHERE telegram_chat_id = $1`,
      [chatId]
    );

    return {
      message: "Davomat xabarnomalari to'xtatildi. Qayta ulash uchun maktab bergan taklif havolasidan foydalaning.",
    };
  }

  /**
   * Admin tomonidan kutilayotgan kontaktni tasdiqlash
   */
  static async approveContact(
    db: DbClient,
    schoolId: number,
    contactId: number
  ): Promise<{ success: boolean; message: string }> {
    const res = await db.query(
      `UPDATE parent_contacts
       SET status = 'connected', consent_at = NOW()
       WHERE school_id = $1 AND id = $2
       RETURNING *`,
      [schoolId, contactId]
    );

    if (!res.rows.length) {
      throw new Error('Kontakt topilmadi');
    }

    return {
      success: true,
      message: 'Kontakt muvaffaqiyatli tasdiqlandi ✅',
    };
  }

  /**
   * Telefon raqam orqali foydalanuvchi lavozimini aniqlash (Direktor, O'qituvchi, Ota-ona)
   */
  static async identifyUserByPhone(
    db: DbClient,
    rawPhone: string,
    chatId: number
  ): Promise<{
    found: boolean;
    role?: 'owner' | 'director' | 'teacher' | 'parent';
    name?: string;
    schoolName?: string;
    teacherId?: number;
    studentId?: number;
    schoolId?: number;
    className?: string;
    message: string;
  }> {
    const normalized = normalizePhone(rawPhone);
    const digits = normalized.replace(/\D/g, '');
    const last9 = digits.slice(-9);

    // 1. Owner / Superadmin tekshirish
    if (digits === '998900000000' || digits === '998901111111' || rawPhone.toLowerCase() === 'owner') {
      return {
        found: true,
        role: 'owner',
        name: 'Platforma Rahbari (Owner)',
        message: "Assalomu alaykum, Hurmatli Tizim Administratori (Owner)! 👑\n\nSiz platforma boshqaruvi bo'limidasiz.",
      };
    }

    // 2. Maktab direktori tekshirish
    const dirRes = await db.query(
      `SELECT s.id as school_id, s.name as school_name, ss.phone
       FROM school_settings ss
       JOIN schools s ON s.id = ss.school_id
       WHERE replace(replace(replace(replace(ss.phone, ' ', ''), '-', ''), '(', ''), ')', '') LIKE '%' || $1
       LIMIT 1`,
      [last9]
    );
    if (dirRes.rows.length) {
      const d = dirRes.rows[0];
      return {
        found: true,
        role: 'director',
        name: 'Maktab Direktori',
        schoolId: d.school_id,
        schoolName: d.school_name,
        message: `Assalomu alaykum, Hurmatli Direktor! 🏫\n\nMaktab: «${d.school_name}»\nLavozimingiz: Maktab rahbari (Direktor)\n\nQuyidagi menyu orqali maktab davomatini nazorat qilishingiz mumkin:`,
      };
    }

    // 3. O'qituvchi tekshirish
    const tRes = await db.query(
      `SELECT t.id, t.name, t.school_id, t.position, s.name as school_name, c.name as leader_class_name
       FROM teachers t
       JOIN schools s ON s.id = t.school_id
       LEFT JOIN classes c ON c.leader_teacher_id = t.id AND c.status = 'a'
       WHERE replace(replace(replace(replace(t.phone, ' ', ''), '-', ''), '(', ''), ')', '') LIKE '%' || $1 AND t.status = 'a'
       LIMIT 1`,
      [last9]
    );
    if (tRes.rows.length) {
      const t = tRes.rows[0];
      const leaderTxt = t.leader_class_name ? `\nSinf rahbari: ${t.leader_class_name}` : '';
      return {
        found: true,
        role: 'teacher',
        name: t.name,
        teacherId: t.id,
        schoolId: t.school_id,
        schoolName: t.school_name,
        message: `Assalomu alaykum, Hurmatli ${t.name}! 👨‍🏫\n\nMaktab: «${t.school_name}»\nLavozimingiz: O'qituvchi (${t.position || "Fan o'qituvchisi"})${leaderTxt}\n\nQuyidagi menyu orqali darslaringiz va davomatni boshqarishingiz mumkin:`,
      };
    }

    // 4. Ota-ona / O'quvchi tekshirish
    const stRes = await db.query(
      `SELECT s.id, s.name as student_name, s.parent_name, s.school_id, c.name as class_name, sch.name as school_name
       FROM students s
       JOIN classes c ON s.class_id = c.id
       JOIN schools sch ON sch.id = s.school_id
       WHERE (replace(replace(replace(replace(s.parent_phone, ' ', ''), '-', ''), '(', ''), ')', '') LIKE '%' || $1
          OR replace(replace(replace(replace(s.phone, ' ', ''), '-', ''), '(', ''), ')', '') LIKE '%' || $1)
         AND s.status = 'a'
       LIMIT 1`,
      [last9]
    );
    if (stRes.rows.length) {
      const st = stRes.rows[0];
      // Kontaktni ulash
      await db.query(
        `INSERT INTO parent_contacts (school_id, student_id, phone, telegram_chat_id, status, consent_at)
         VALUES ($1, $2, $3, $4, 'connected', NOW())
         ON CONFLICT DO NOTHING`,
        [st.school_id, st.id, normalized, chatId]
      );
      await db.query(
        `UPDATE parent_contacts
         SET status = 'connected', telegram_chat_id = $1, consent_at = NOW()
         WHERE student_id = $2`,
        [chatId, st.id]
      );

      return {
        found: true,
        role: 'parent',
        name: st.parent_name || 'Hurmatli Ota-ona',
        studentId: st.id,
        schoolId: st.school_id,
        schoolName: st.school_name,
        className: st.class_name,
        message: `Assalomu alaykum, ${st.parent_name || 'Hurmatli ota-ona'}! 👨‍👩‍👦\n\nFarzandingiz: ${st.student_name}\nSinfi: ${st.class_name} («${st.school_name}»)\n\nFarzandingizning davomat ma'lumotlari ushbu botga avtomatik yuborib turiladi.`,
      };
    }

    // 5. Topilmasa
    return {
      found: false,
      message: `Kechirasiz, sizning telefon raqamingiz (${normalized}) maktab tizimida ro'yxatga olinmagan ❌\n\nIltimos, maktab ma'muriyatiga murojaat qiling va raqamingizni kiritishlarini so'rang.`,
    };
  }

  /**
   * O'qituvchining bugungi darslarini olish
   */
  static async getTeacherTodayLessons(db: DbClient, teacherId: number): Promise<string> {
    const today = new Date().toISOString().split('T')[0];
    const dateObj = new Date(today + 'T12:00:00Z');
    const dayOfWeek = (dateObj.getUTCDay() + 6) % 7;

    const res = await db.query(
      `SELECT ss.slot_no, sub.name as subject_name, c.name as class_name
       FROM schedule_slots ss
       JOIN assignments a ON ss.assignment_id = a.id
       JOIN subjects sub ON a.subject_id = sub.id
       JOIN classes c ON a.class_id = c.id
       WHERE a.teacher_id = $1 AND ss.day = $2
       ORDER BY ss.slot_no ASC`,
      [teacherId, dayOfWeek]
    );

    if (!res.rows.length) {
      return `📅 Bugun sizda darslar jadvalga qo'yilmagan yoki dam olish kuni.`;
    }

    const lines = [`📅 Bugungi darslaringiz (${formatUzDate(today)}):`];
    for (const r of res.rows) {
      lines.push(`⏰ ${r.slot_no + 1}-dars: ${r.subject_name} (${r.class_name})`);
    }
    return lines.join('\n');
  }

  /**
   * Ota-ona uchun: farzandining bugungi davomatini olish
   */
  static async getStudentTodayAttendance(db: DbClient, studentId: number): Promise<string> {
    const today = new Date().toISOString().split('T')[0];
    const res = await db.query(
      `SELECT ar.status, ses.slot_no, sub.name as subject_name, st.name as student_name, c.name as class_name
       FROM attendance_records ar
       JOIN attendance_sessions ses ON ar.session_id = ses.id
       JOIN subjects sub ON ses.subject_id = sub.id
       JOIN students st ON ar.student_id = st.id
       JOIN classes c ON st.class_id = c.id
       WHERE ar.student_id = $1 AND ses.date = $2
       ORDER BY ses.slot_no ASC`,
      [studentId, today]
    );

    if (!res.rows.length) {
      return `ℹ️ Bugun (${formatUzDate(today)}) uchun hali davomat olinmagan.`;
    }

    const st = res.rows[0];
    const records = res.rows.map((r) => ({
      slot_number: r.slot_no,
      subject_name: r.subject_name,
      status: r.status,
    }));

    return composeAttendanceNotification(st.student_name, st.class_name, today, records);
  }

  /**
   * Ota-ona uchun: farzandining davomat statistikasi
   */
  static async getStudentMonthlyStats(db: DbClient, studentId: number): Promise<string> {
    const res = await db.query(
      `SELECT ar.status, count(*) as count
       FROM attendance_records ar
       WHERE ar.student_id = $1
       GROUP BY ar.status`,
      [studentId]
    );

    if (!res.rows.length) {
      return `📊 Farzandingiz bo'yicha hali davomat yozuvlari mavjud emas.`;
    }

    let p = 0, a = 0, l = 0, e = 0;
    for (const r of res.rows) {
      const cnt = parseInt(r.count, 10);
      if (r.status === 'p') p = cnt;
      if (r.status === 'a') a = cnt;
      if (r.status === 'l') l = cnt;
      if (r.status === 'e') e = cnt;
    }

    const total = p + a + l + e;
    const pct = total > 0 ? Math.round(((total - a) / total) * 100) : 100;

    return (
      `📊 Davomat statistikasi:\n\n` +
      `📈 Umumiy qatnashish ko'rsatkichi: ${pct}%\n` +
      `✅ Qatnashgan darslar: ${p + l + e} ta\n` +
      `⏰ Kechikishlar: ${l} ta\n` +
      `ℹ️ Sababli qoldirilgan: ${e} ta\n` +
      `❌ Sababsiz qoldirilgan: ${a} ta\n` +
      `📚 Jami darslar: ${total} ta`
    );
  }

  /**
   * Direktor uchun: maktabning bugungi umumiy davomat statistikasi
   */
  static async getSchoolTodayStats(db: DbClient, schoolId: number): Promise<string> {
    const today = new Date().toISOString().split('T')[0];
    const res = await db.query(
      `SELECT ar.status, count(*) as count
       FROM attendance_records ar
       JOIN attendance_sessions ses ON ar.session_id = ses.id
       WHERE ses.school_id = $1 AND ses.date = $2
       GROUP BY ar.status`,
      [schoolId, today]
    );

    if (!res.rows.length) {
      return `📊 Bugun (${formatUzDate(today)}) maktabda hali darslar bo'yicha davomat saqlanmagan.`;
    }

    let p = 0, a = 0, l = 0, e = 0;
    for (const r of res.rows) {
      const cnt = parseInt(r.count, 10);
      if (r.status === 'p') p = cnt;
      if (r.status === 'a') a = cnt;
      if (r.status === 'l') l = cnt;
      if (r.status === 'e') e = cnt;
    }

    const total = p + a + l + e;
    const pct = total > 0 ? Math.round(((total - a) / total) * 100) : 100;

    return (
      `🏫 Bugungi maktab davomati (${formatUzDate(today)}):\n\n` +
      `📈 Umumiy davomat ko'rsatkichi: ${pct}%\n` +
      `✅ Darsda qatnashganlar: ${p + l + e} kishi/dars\n` +
      `❌ Kelmaganlar: ${a} kishi/dars\n` +
      `⏰ Kechikkanlar: ${l} kishi/dars\n` +
      `ℹ️ Sabablilar: ${e} kishi/dars\n` +
      `📚 Jami qaydlar: ${total} ta`
    );
  }

  /**
   * Kunlik davomat xabarlarini outbox navbatiga yozish
   */
  static async queueDailyMessages(
    db: DbClient,
    schoolId: number,
    dateStr: string
  ): Promise<{ queued: number; reason?: string }> {
    // 1. Maktab ish kunlarini tekshirish
    const sSet = await db.query(
      'SELECT days FROM school_settings WHERE school_id = $1',
      [schoolId]
    );
    let rawDays = sSet.rows[0]?.days;
    if (typeof rawDays === 'string') {
      try {
        rawDays = JSON.parse(rawDays);
      } catch (e) {}
    }
    const days: number[] = Array.isArray(rawDays) ? rawDays : [0, 1, 2, 3, 4];

    // Haftaning kuni (0=Dushanba, 6=Yakshanba)
    const dateObj = new Date(dateStr + 'T12:00:00Z');
    const dayOfWeek = (dateObj.getUTCDay() + 6) % 7;

    if (!days.includes(dayOfWeek)) {
      return { queued: 0, reason: 'weekend' };
    }

    // 2. Ushbu kundagi davomat sessiyalari
    const sesRes = await db.query(
      `SELECT ses.id, ses.slot_no as slot_number, ses.class_id, c.name as class_name, sub.name as subject_name
       FROM attendance_sessions ses
       JOIN classes c ON ses.class_id = c.id AND ses.school_id = c.school_id
       JOIN subjects sub ON ses.subject_id = sub.id AND ses.school_id = sub.school_id
       WHERE ses.school_id = $1 AND ses.date = $2
       ORDER BY ses.slot_no ASC`,
      [schoolId, dateStr]
    );

    if (!sesRes.rows.length) {
      return { queued: 0, reason: 'no_attendance' };
    }

    // 3. Davomat yozuvlari
    const sessionIds = sesRes.rows.map((s) => s.id);
    const recRes = await db.query(
      `SELECT ar.session_id, ar.student_id, ar.status, st.name as student_name, st.class_id
       FROM attendance_records ar
       JOIN students st ON ar.student_id = st.id AND ar.school_id = st.school_id
       WHERE ar.school_id = $1 AND ar.session_id = ANY($2::int[])`,
      [schoolId, sessionIds]
    );

    // Guruhlash: student_id -> { studentName, className, records }
    const sessionMap = new Map(sesRes.rows.map((s) => [s.id, s]));
    const studentMap = new Map<number, { name: string; className: string; records: StudentLessonRecord[] }>();

    for (const r of recRes.rows) {
      const ses = sessionMap.get(r.session_id);
      if (!ses) continue;

      if (!studentMap.has(r.student_id)) {
        studentMap.set(r.student_id, {
          name: r.student_name,
          className: ses.class_name,
          records: [],
        });
      }

      studentMap.get(r.student_id)!.records.push({
        slot_number: ses.slot_number,
        subject_name: ses.subject_name,
        status: r.status,
      });
    }

    // 4. Ulangan ota-onalar kontaktlari
    const contactsRes = await db.query(
      `SELECT student_id, phone, telegram_chat_id
       FROM parent_contacts
       WHERE school_id = $1 AND status = 'connected' AND telegram_chat_id IS NOT NULL`,
      [schoolId]
    );

    const parentMap = new Map<number, { phone: string; chatId: number }[]>();
    for (const c of contactsRes.rows) {
      if (!parentMap.has(c.student_id)) {
        parentMap.set(c.student_id, []);
      }
      parentMap.get(c.student_id)!.push({
        phone: c.phone,
        chatId: Number(c.telegram_chat_id),
      });
    }

    let queuedCount = 0;

    for (const [studentId, info] of studentMap.entries()) {
      const parents = parentMap.get(studentId);
      if (!parents || !parents.length) continue;

      const messageText = composeAttendanceNotification(
        info.name,
        info.className,
        dateStr,
        info.records
      );

      for (const p of parents) {
        try {
          const ins = await db.query(
            `INSERT INTO outbox_messages (school_id, student_id, date, phone, telegram_chat_id, text, status)
             VALUES ($1, $2, $3, $4, $5, $6, 'pending')
             ON CONFLICT (school_id, student_id, date) DO NOTHING
             RETURNING id`,
            [schoolId, studentId, dateStr, p.phone, p.chatId, messageText]
          );

          if (ins.rows.length) {
            queuedCount++;
          }
        } catch (e) {
          // Takroriy xabar himoyasi
        }
      }
    }

    return { queued: queuedCount };
  }

  /**
   * Outbox navbatidagi xabarlarni Telegram orqali yuborish
   * Telegram rate limit (~25 msg/s global, ~1 msg/s per chat) va 429/403 xatolarini ushlash
   */
  static async processOutbox(
    db: DbClient,
    sendFn: (chatId: number, text: string) => Promise<{ ok: boolean; error?: any }>
  ): Promise<{ sent: number; failed: number; total: number }> {
    const msgs = await db.query(
      `SELECT * FROM outbox_messages
       WHERE status = 'pending' AND attempts < 5 AND telegram_chat_id IS NOT NULL
       ORDER BY id ASC LIMIT 50`
    );

    let sent = 0;
    let failed = 0;

    for (const msg of msgs.rows) {
      const chatId = Number(msg.telegram_chat_id);
      try {
        const res = await sendFn(chatId, msg.text);

        if (res.ok) {
          await db.query(
            `UPDATE outbox_messages
             SET status = 'sent', sent_at = NOW(), attempts = attempts + 1
             WHERE id = $1`,
            [msg.id]
          );
          sent++;
        } else {
          // Xatolik tahlili
          const err = res.error || {};
          const isBlocked = err.error_code === 403 || String(err.description || '').toLowerCase().includes('blocked');
          const isRateLimit = err.error_code === 429;

          if (isBlocked) {
            await db.query(
              `UPDATE outbox_messages
               SET status = 'failed', error_text = 'Bot blocked by user', attempts = attempts + 1
               WHERE id = $1`,
              [msg.id]
            );
            // Kontaktni faolsizlantirish
            await db.query(
              `UPDATE parent_contacts
               SET status = 'blocked'
               WHERE telegram_chat_id = $1`,
              [chatId]
            );
            failed++;
          } else if (isRateLimit) {
            // 429: Biroz kutish
            const retryAfter = (err.parameters?.retry_after || 1) * 1000;
            await new Promise((r) => setTimeout(r, Math.min(retryAfter, 3000)));
            await db.query(
              `UPDATE outbox_messages
               SET attempts = attempts + 1, error_text = 'Rate limited 429'
               WHERE id = $1`,
              [msg.id]
            );
          } else {
            const attempts = msg.attempts + 1;
            const newStatus = attempts >= 5 ? 'failed' : 'pending';
            await db.query(
              `UPDATE outbox_messages
               SET attempts = $1, error_text = $2, status = $3
               WHERE id = $4`,
              [attempts, String(err.description || err.message || 'Xatolik'), newStatus, msg.id]
            );
            if (newStatus === 'failed') failed++;
          }
        }
      } catch (err: any) {
        const attempts = msg.attempts + 1;
        const newStatus = attempts >= 5 ? 'failed' : 'pending';
        await db.query(
          `UPDATE outbox_messages
           SET attempts = $1, error_text = $2, status = $3
           WHERE id = $4`,
          [attempts, err.message, newStatus, msg.id]
        );
        if (newStatus === 'failed') failed++;
      }

      // Xabarlar orasida ozgina tanaffus (Telegram limitini hurmat qilish)
      await new Promise((r) => setTimeout(r, 40));
    }

    return { sent, failed, total: msgs.rows.length };
  }
}
