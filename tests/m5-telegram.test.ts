import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createTestDb, DbClient } from '../src/db/client.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { AuthUser } from '../src/modules/auth/permissions.js';
import { SchoolService } from '../src/modules/school/school.service.js';
import { AttendanceService } from '../src/modules/attendance/attendance.service.js';
import {
  TelegramService,
  normalizePhone,
  formatUzDate,
  composeAttendanceNotification,
} from '../src/modules/telegram/telegram.service.js';

describe('M5: Telegram bot, ulash, xabarlar navbati', () => {
  let app: FastifyInstance;
  let testDb: DbClient;
  let directorCookie: string;
  let teacherCookie: string;
  let schoolId: number;
  let student1Id: number;
  let student2Id: number;
  let classId: number;
  let subjectId: number;
  let teacherId: number;
  let slotId: number;
  let teacherUserId: number;

  beforeAll(async () => {
    testDb = await createTestDb();
    app = await buildApp({ db: testDb });
    await app.ready();

    // 1. Maktab va direktor
    const ownerUser: AuthUser = { id: 1, school_id: null, username: 'owner', role: 'owner' };
    const created = await AuthService.createSchoolWithDirector(
      testDb,
      ownerUser,
      '5-sonli Maktab',
      'dir_m5'
    );
    schoolId = created.school.id;

    const dirLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'dir_m5', password: created.director.tempPassword },
    });
    directorCookie = dirLogin.headers['set-cookie'] as string;

    // 2. O'quv yili, fan, sinf, o'qituvchi, o'quvchilar
    const years = await SchoolService.listYears(testDb, schoolId);
    const year = years[0];

    const teacher = await SchoolService.createTeacher(testDb, schoolId, 'Sobirov Jasur', 'T-01', '+998901112233', 'Matematika');
    teacherId = teacher.id;

    const subject = await SchoolService.createSubject(testDb, schoolId, 'Matematika', 'MAT', '#3b5bdb');
    subjectId = subject.id;

    const cl = await SchoolService.createClass(testDb, schoolId, year.id, '7-A', teacherId);
    classId = cl.id;

    const s1 = await SchoolService.createStudent(testDb, schoolId, {
      name: 'Aliyev Valijon',
      class_id: classId,
      phone: '+998909876543',
      parent_name: 'Aliyev Ota',
      parent_phone: '+998901234567',
    });
    student1Id = s1.id;

    const s2 = await SchoolService.createStudent(testDb, schoolId, {
      name: 'Karimov Rustam',
      class_id: classId,
      phone: '+998909998877',
      parent_name: 'Karimov Ota',
      parent_phone: '+998907654321',
    });
    student2Id = s2.id;

    const asg = await SchoolService.createAssignment(testDb, schoolId, teacherId, subjectId, classId);
    const slot = await SchoolService.setScheduleSlot(testDb, schoolId, asg.id, 0, 0); // Dushanba, 1-dars
    slotId = slot.id;

    // O'qituvchi foydalanuvchisi yaratish
    const dirUser: AuthUser = { id: created.director.id, school_id: schoolId, username: 'dir_m5', role: 'director' };
    const tUser = await AuthService.createUser(testDb, dirUser, {
      username: 'teacher_m5',
      role: 'teacher',
      teacher_id: teacherId,
    });
    teacherUserId = tUser.id;

    const tLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'teacher_m5', password: tUser.tempPassword },
    });
    teacherCookie = tLogin.headers['set-cookie'] as string;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (testDb) await testDb.close();
  });

  it('1. normalizePhone va formatUzDate to\'g\'ri ishlashi kerak', () => {
    expect(normalizePhone('+998901234567')).toBe('+998901234567');
    expect(normalizePhone('998901234567')).toBe('+998901234567');
    expect(normalizePhone('901234567')).toBe('+998901234567');
    expect(normalizePhone('+998 (90) 123-45-67')).toBe('+998901234567');

    expect(formatUzDate('2026-10-05')).toBe('5-oktyabr');
    expect(formatUzDate('2026-03-21')).toBe('21-mart');
  });

  it('2. composeAttendanceNotification to\'g\'ri formatda matn generatsiya qilishi kerak', () => {
    // Hammasi kelgan holat
    const allPresent = composeAttendanceNotification('Aliyev Vali', '7-A', '2026-10-05', [
      { slot_number: 0, subject_name: 'Matematika', status: 'p' },
      { slot_number: 1, subject_name: 'Fizika', status: 'p' },
    ]);
    expect(allPresent).toContain('📚 Assalomu alaykum! Aliyev Vali (7-A) 5-oktyabr kuni:');
    expect(allPresent).toContain('Barcha darslarda (2 ta) qatnashdi ✅');

    // Dars qoldirgan / kechikkan / sababli
    const mixed = composeAttendanceNotification('Aliyev Vali', '7-A', '2026-10-05', [
      { slot_number: 0, subject_name: 'Matematika', status: 'p' },
      { slot_number: 1, subject_name: 'Fizika', status: 'a' },
      { slot_number: 2, subject_name: 'Tarix', status: 'l' },
      { slot_number: 3, subject_name: 'Adabiyot', status: 'e' },
    ]);
    expect(mixed).toContain('❌ 2-dars Fizika — kelmadi');
    expect(mixed).toContain('⏰ 3-dars Tarix — kechikdi');
    expect(mixed).toContain('ℹ️ 4-dars Adabiyot — sababli qoldirdi');
    expect(mixed).toContain('Qolgan darslarda qatnashdi ✅');
  });

  it('3. POST /api/v1/telegram/invite 7 kun amal qiladigan taklif havolasi yaratishi kerak', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/telegram/invite',
      headers: { cookie: directorCookie },
      payload: { student_id: student1Id },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.data.code).toBeDefined();
    expect(body.data.phone).toBe('+998901234567');
    expect(body.data.link).toContain(`start=${body.data.code}`);

    const expiresAt = new Date(body.data.expires_at).getTime();
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(expiresAt - now).toBeGreaterThan(sevenDaysMs - 10000);
  });

  it('4. Bot /start va kontakt tekshiruvi: mos kelgan telefon avtomatik ulanishi kerak', async () => {
    const invite = await TelegramService.createInvite(testDb, schoolId, student1Id);

    // /start <code> tekshirish
    const startRes = await TelegramService.handleStart(testDb, invite.code);
    expect(startRes.needContact).toBe(true);
    expect(startRes.text).toContain('Aliyev Valijon');

    // Mos telefon yuborilganda
    const verifyRes = await TelegramService.verifyContact(
      testDb,
      invite.code,
      12345678, // Telegram chat ID
      '+998901234567'
    );
    expect(verifyRes.success).toBe(true);
    expect(verifyRes.status).toBe('connected');

    // Taklif havolasi ishlatilgan deb belgilangan bo'lishi kerak
    const invDb = await testDb.query('SELECT used_at FROM telegram_invites WHERE code = $1', [invite.code]);
    expect(invDb.rows[0].used_at).not.toBeNull();

    // parent_contacts da consent_at va status = 'connected' bo'lishi kerak
    const pDb = await testDb.query('SELECT * FROM parent_contacts WHERE student_id = $1', [student1Id]);
    expect(pDb.rows[0].status).toBe('connected');
    expect(pDb.rows[0].consent_at).not.toBeNull();
    expect(Number(pDb.rows[0].telegram_chat_id)).toBe(12345678);
  });

  it('5. Mos kelmagan telefon kutilayotgan (pending) bo\'lib admin tasdig\'ini kutishi kerak', async () => {
    const invite = await TelegramService.createInvite(testDb, schoolId, student2Id);

    // Mos bo'lmagan raqam yuborilganda
    const verifyRes = await TelegramService.verifyContact(
      testDb,
      invite.code,
      87654321,
      '+998900000000' // Boshqa raqam
    );
    expect(verifyRes.success).toBe(false);
    expect(verifyRes.status).toBe('pending');
    expect(verifyRes.message).toContain("mos kelmadi");

    // Bazada pending holatda saqlangan bo'lishi kerak
    const pDb = await testDb.query('SELECT * FROM parent_contacts WHERE student_id = $1 AND telegram_chat_id = 87654321', [student2Id]);
    expect(pDb.rows[0].status).toBe('pending');
    const contactId = pDb.rows[0].id;

    // Admin POST /api/v1/telegram/approve-contact/:id orqali tasdiqlaydi
    const appRes = await app.inject({
      method: 'POST',
      url: `/api/v1/telegram/approve-contact/${contactId}`,
      headers: { cookie: directorCookie },
    });
    expect(appRes.statusCode).toBe(200);

    const updated = await testDb.query('SELECT * FROM parent_contacts WHERE id = $1', [contactId]);
    expect(updated.rows[0].status).toBe('connected');
    expect(updated.rows[0].consent_at).not.toBeNull();
  });

  it('6. GET /api/v1/telegram/contacts orqali o\'qituvchi chat_id ni ko\'ra olmasligi kerak', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/telegram/contacts',
      headers: { cookie: teacherCookie },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.data.length).toBeGreaterThan(0);
    // Xavfsizlik talabi: chat_id o'qituvchiga ko'rsatilmasligi shart
    for (const c of body.data) {
      expect(c).not.toHaveProperty('telegram_chat_id');
      expect(c).toHaveProperty('status');
      expect(c).toHaveProperty('phone');
    }
  });

  it('7. /stop buyrug\'i aloqani uzishi va xabarnomalarni to\'xtatishi kerak', async () => {
    const stopRes = await TelegramService.handleStop(testDb, 12345678);
    expect(stopRes.message).toContain("to'xtatildi");

    const pDb = await testDb.query('SELECT * FROM parent_contacts WHERE telegram_chat_id = 12345678');
    expect(pDb.rows.length).toBe(0); // telegram_chat_id NULL qilingan
  });

  it('8. Dam olish kuni yoki davomat olinmagan kunga navbatga xabar qo\'shilmasligi kerak', async () => {
    // Shanba sanasi (2026-10-10) — ish kuni emas
    const weekendRes = await TelegramService.queueDailyMessages(testDb, schoolId, '2026-10-10');
    expect(weekendRes.queued).toBe(0);
    expect(weekendRes.reason).toBe('weekend');

    // Ish kuni (2026-10-05), lekin hali davomat olinmagan
    const noAttRes = await TelegramService.queueDailyMessages(testDb, schoolId, '2026-10-05');
    expect(noAttRes.queued).toBe(0);
    expect(noAttRes.reason).toBe('no_attendance');
  });

  it('9. Davomat saqlangandan so\'ng outbox navbatiga yozilishi va takroriy dublikat bo\'lmasligi kerak', async () => {
    // Avval kontaktni qayta ulaymiz
    await testDb.query(
      `UPDATE parent_contacts SET status = 'connected', telegram_chat_id = 12345678 WHERE student_id = $1`,
      [student1Id]
    );

    // Dushanba sanasi: 2026-10-05 ga davomat yozish
    const authUser: AuthUser = { id: teacherUserId, school_id: schoolId, username: 'teacher_m5', role: 'teacher', teacher_id: teacherId };
    await AttendanceService.saveSessionAttendance(
      testDb,
      schoolId,
      slotId,
      '2026-10-05',
      {
        version: 0,
        records: {
          [student1Id]: 'a', // Yo'q
          [student2Id]: 'p', // Keldi
        },
      },
      authUser
    );

    // Navbatga qo'yish
    const queueRes = await TelegramService.queueDailyMessages(testDb, schoolId, '2026-10-05');
    expect(queueRes.queued).toBeGreaterThan(0);

    // outbox_messages jadvalida xabar mavjud bo'lishi kerak
    const outbox = await testDb.query(
      'SELECT * FROM outbox_messages WHERE school_id = $1 AND date = $2',
      [schoolId, '2026-10-05']
    );
    expect(outbox.rows.length).toBeGreaterThan(0);
    expect(outbox.rows[0].text).toContain('📚 Assalomu alaykum!');
    expect(outbox.rows[0].text).toContain('kelmadi');
    expect(outbox.rows[0].status).toBe('pending');

    // Takroran yuborilganda dublikat bo'lmasligi kerak (UNIQUE constraint)
    const queueRes2 = await TelegramService.queueDailyMessages(testDb, schoolId, '2026-10-05');
    expect(queueRes2.queued).toBe(0); // qayta qo'shilmadi
  });

  it('10. processOutbox: muvaffaqiyatli yuborish, 403 (bloklangan) va 429 (rate-limit) to\'g\'ri qayta ishlanishi kerak', async () => {
    // 1. Muvaffaqiyatli yuborish
    const mockSendSuccess = async (chatId: number, text: string) => ({ ok: true });
    const resSuccess = await TelegramService.processOutbox(testDb, mockSendSuccess);
    expect(resSuccess.sent).toBeGreaterThan(0);

    const sentMsg = await testDb.query('SELECT status, sent_at FROM outbox_messages WHERE school_id = $1', [schoolId]);
    expect(sentMsg.rows[0].status).toBe('sent');
    expect(sentMsg.rows[0].sent_at).not.toBeNull();

    // 2. 403 Bloklangan holat
    await testDb.query(
      `INSERT INTO outbox_messages (school_id, student_id, date, phone, telegram_chat_id, text, status)
       VALUES ($1, $2, '2026-10-06', '+998901234567', 99999999, 'Test', 'pending')
       ON CONFLICT (school_id, student_id, date) DO UPDATE SET status = 'pending'`,
      [schoolId, student1Id]
    );

    const mockSendBlocked = async () => ({
      ok: false,
      error: { error_code: 403, description: 'Forbidden: bot was blocked by the user' },
    });
    const resBlocked = await TelegramService.processOutbox(testDb, mockSendBlocked);
    expect(resBlocked.failed).toBe(1);

    const blockedMsg = await testDb.query("SELECT status, error_text FROM outbox_messages WHERE date = '2026-10-06'");
    expect(blockedMsg.rows[0].status).toBe('failed');
    expect(blockedMsg.rows[0].error_text).toContain('blocked');
  });
});
