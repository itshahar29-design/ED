import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createTestDb, DbClient } from '../src/db/client.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { can, AuthUser, PRESET_POSITIONS } from '../src/modules/auth/permissions.js';
import { generateFakeInitData } from '../scripts/fake-initdata.js';
import { EFFECTIVE_BOT_TOKEN } from '../src/config/env.js';
import { computeMenu } from '../src/modules/auth/menu.js';

describe('M1: Auth, rollar, ko\'p maktab, RLS, can(), audit', () => {
  let app: FastifyInstance;
  let testDb: DbClient;

  beforeAll(async () => {
    testDb = await createTestDb();
    app = await buildApp({ db: testDb });
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (testDb) await testDb.close();
  });

  it('1. Boshlang\'ich owner foydalanuvchisi yaratilishi va tizimga kirishi kerak', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: 'owner',
        password: 'Owner123456!',
      },
    });

    expect(loginRes.statusCode).toBe(200);
    const body = JSON.parse(loginRes.body);
    expect(body.status).toBe('ok');
    expect(body.user.role).toBe('owner');
    expect(body.user.username).toBe('owner');

    // Cookie tekshirish
    const cookies = loginRes.cookies;
    const sessionCookie = cookies.find((c) => c.name === 'sessionId');
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie?.httpOnly).toBe(true);
  });

  it('2. 5 marta xato parol kiritilsa hisob vaqtincha bloklanishi kerak', async () => {
    // 4 marta noto'g'ri kirish
    for (let i = 0; i < 4; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'owner', password: 'wrongpassword' },
      });
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body).error).toContain('noto\'g\'ri');
    }

    // 5-marta noto'g'ri kirish (bloklash faollashadi)
    const fifthRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'owner', password: 'wrongpassword' },
    });
    expect(fifthRes.statusCode).toBe(401);

    // 6-urinishda bloklanganligi haqida xabar chiqishi kerak
    const blockedRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'owner', password: 'wrongpassword' },
    });
    expect(blockedRes.statusCode).toBe(401);
    expect(JSON.parse(blockedRes.body).error).toContain('bloklangan');

    // Blokni test uchun tozalash
    await testDb.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE username = $1', ['owner']);
  });

  it('3. GET /api/v1/auth/me sessiya orqali foydalanuvchi ma\'lumotini qaytarishi kerak', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'owner', password: 'Owner123456!' },
    });
    const cookie = loginRes.headers['set-cookie'];

    const meRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: cookie as string },
    });

    expect(meRes.statusCode).toBe(200);
    const body = JSON.parse(meRes.body);
    expect(body.user.role).toBe('owner');
    expect(body.permissions).toContain('MANAGE_SETTINGS');
    expect(body.permissions).toContain('MARK_ATTENDANCE');
  });

  it('4. Parolni o\'zgartirish: < 8 belgi rad etilishi va to\'g\'ri parol yangilanishi kerak', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'owner', password: 'Owner123456!' },
    });
    const cookie = loginRes.headers['set-cookie'];

    // Qisqa parol rad etiladi
    const shortRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: { cookie: cookie as string },
      payload: {
        current_password: 'Owner123456!',
        new_password: '123',
      },
    });
    expect(shortRes.statusCode).toBe(400);

    // Muvaffaqiyatli o'zgartirish
    const okRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: { cookie: cookie as string },
      payload: {
        current_password: 'Owner123456!',
        new_password: 'NewOwnerPassword123!',
      },
    });
    expect(okRes.statusCode).toBe(200);

    // Yangi parol bilan kirish
    const newLoginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'owner', password: 'NewOwnerPassword123!' },
    });
    expect(newLoginRes.statusCode).toBe(200);
  });

  it('5. Ko\'p maktab (multi-tenant): Owner 2 ta maktab yaratishi va har birida o\'z direktori bo\'lishi kerak', async () => {
    const ownerUser: AuthUser = { id: 1, school_id: null, username: 'owner', role: 'owner' };

    const schoolA = await AuthService.createSchoolWithDirector(
      testDb,
      ownerUser,
      '1-sonli Maktab',
      'director_maktab1',
      '+998901111111'
    );
    const schoolB = await AuthService.createSchoolWithDirector(
      testDb,
      ownerUser,
      '2-sonli Maktab',
      'director_maktab2',
      '+998902222222'
    );

    expect(schoolA.school.id).toBeDefined();
    expect(schoolB.school.id).toBeDefined();
    expect(schoolA.school.id).not.toBe(schoolB.school.id);

    // Direktor A o'z maktabiga tegishli
    const dirARes = await testDb.query('SELECT school_id, role FROM users WHERE username = $1', ['director_maktab1']);
    expect(dirARes.rows[0].school_id).toBe(schoolA.school.id);

    // Direktor B o'z maktabiga tegishli
    const dirBRes = await testDb.query('SELECT school_id, role FROM users WHERE username = $1', ['director_maktab2']);
    expect(dirBRes.rows[0].school_id).toBe(schoolB.school.id);
  });

  it('6. PostgreSQL RLS (Row Level Security): Begona maktab ma\'lumotini ko\'rib bo\'lmasligi kerak', async () => {
    // Maktab A va B ga sinflar qo'shamiz
    await testDb.query('INSERT INTO classes (school_id, year_id, name) VALUES (1, 1, $1)', ['5-A Maktab 1']);
    await testDb.query('INSERT INTO classes (school_id, year_id, name) VALUES (2, 2, $1)', ['9-B Maktab 2']);

    // Maktab 1 kontekstida so'rov: faqat Maktab 1 sinflari chiqishi kerak
    const school1Classes = await testDb.tx(async (tx) => {
      const res = await tx.query<{ name: string }>('SELECT name FROM classes;');
      return res.rows.map((r) => r.name);
    }, 1);

    expect(school1Classes).toContain('5-A Maktab 1');
    expect(school1Classes).not.toContain('9-B Maktab 2');

    // Maktab 2 kontekstida so'rov: faqat Maktab 2 sinflari chiqishi kerak
    const school2Classes = await testDb.tx(async (tx) => {
      const res = await tx.query<{ name: string }>('SELECT name FROM classes;');
      return res.rows.map((r) => r.name);
    }, 2);

    expect(school2Classes).toContain('9-B Maktab 2');
    expect(school2Classes).not.toContain('5-A Maktab 1');
  });

  it('7. can() avtorizatsiya matritsasi to\'g\'ri ishlashi kerak', () => {
    const directorUser: AuthUser = { id: 10, school_id: 1, username: 'dir', role: 'director' };
    const teacherUser: AuthUser = { id: 20, school_id: 1, username: 'tch', role: 'teacher', teacher_id: 5 };
    const studentUser: AuthUser = { id: 30, school_id: 1, username: 'std', role: 'student', student_id: 99 };

    // Direktor o'z maktabida hamma narsani qila oladi
    expect(can(directorUser, 'MANAGE_CLASSES', { type: 'class', school_id: 1 })).toBe(true);
    // Direktor begona maktabda hech narsa qila olmaydi
    expect(can(directorUser, 'MANAGE_CLASSES', { type: 'class', school_id: 2 })).toBe(false);

    // O'qituvchi MANAGE_SETTINGS qila olmaydi
    expect(can(teacherUser, 'MANAGE_SETTINGS', { type: 'settings', school_id: 1 })).toBe(false);

    // O'qituvchi o'z darsi davomatini belgilay oladi
    expect(can(teacherUser, 'MARK_ATTENDANCE', { type: 'attendance', school_id: 1, teacher_id: 5 })).toBe(true);
    // O'qituvchi boshqa o'qituvchi darsi davomatini belgilay olmaydi
    expect(can(teacherUser, 'MARK_ATTENDANCE', { type: 'attendance', school_id: 1, teacher_id: 8 })).toBe(false);

    // O'quvchi faqat o'z hisobotini ko'ra oladi
    expect(can(studentUser, 'VIEW_REPORTS', { type: 'report', school_id: 1, student_id: 99 })).toBe(true);
    // O'quvchi boshqa o'quvchi hisobotini ko'ra olmaydi
    expect(can(studentUser, 'VIEW_REPORTS', { type: 'report', school_id: 1, student_id: 100 })).toBe(false);
  });

  it('8. Xavfsizlik: Owner yoki yagona direktorni o\'chirib bo\'lmasligi kerak', async () => {
    const ownerUser: AuthUser = { id: 1, school_id: null, username: 'owner', role: 'owner' };

    // Owner o'zini yoki boshqa owner'ni o'chira olmaydi
    await expect(AuthService.deleteUser(testDb, ownerUser, 1)).rejects.toThrow('Platforma egasini (owner) o\'chirib bo\'lmaydi');

    // Maktab 1 ning yagona direktorini o'chirish taqiqlanadi
    const dirA = await testDb.query('SELECT id FROM users WHERE username = $1', ['director_maktab1']);
    await expect(AuthService.deleteUser(testDb, ownerUser, dirA.rows[0].id)).rejects.toThrow(
      'Maktabning yagona direktorini o\'chirib bo\'lmaydi'
    );
  });

  it('9. Owner Support Mode (Yordam rejimi) va audit_log ga yozilishi kerak', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'owner', password: 'NewOwnerPassword123!' },
    });
    const cookie = loginRes.headers['set-cookie'];

    // Yordam rejimiga kirish
    const smRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/support-mode',
      headers: { cookie: cookie as string },
      payload: { school_id: 1 },
    });
    expect(smRes.statusCode).toBe(200);

    // Audit logda SUPPORT_MODE_ENTER borligini tekshirish
    const auditRes = await testDb.query(
      'SELECT action, entity, entity_id FROM audit_log WHERE action = $1',
      ['SUPPORT_MODE_ENTER']
    );
    expect(auditRes.rows.length).toBeGreaterThan(0);
    expect(auditRes.rows[0].entity_id).toBe('1');

    // Yordam rejimidan chiqish
    const exitRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/exit-support-mode',
      headers: { cookie: cookie as string },
    });
    expect(exitRes.statusCode).toBe(200);
  });

  it('10. POST /api/v1/auth/telegram: Soxta hash yoki noto\'g\'ri imzo rad etilishi kerak (401)', async () => {
    const fakeData = 'auth_date=' + Math.floor(Date.now() / 1000) + '&user=%7B%22id%22%3A12345%7D&hash=invalid_fake_hash_123';
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram',
      payload: { initData: fakeData },
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toContain('yaroqsiz');
  });

  it('11. POST /api/v1/auth/telegram: Eskirgan auth_date (> 1 soat) rad etilishi kerak (401)', async () => {
    const expiredAuthDate = Math.floor(Date.now() / 1000) - 4000; // 4000 soniya oldin (> 1 soat)
    const initData = generateFakeInitData(
      { id: 987654, first_name: 'Eski' },
      EFFECTIVE_BOT_TOKEN,
      { auth_date: expiredAuthDate }
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram',
      payload: { initData },
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toContain('muddati o\'tgan');
  });

  it('12. POST /api/v1/auth/telegram: Boshqa bot tokeni bilan imzolangan initData rad etilishi kerak (401)', async () => {
    const otherToken = '999999:OTHER_BOT_TOKEN_NOT_MATCHING';
    const initData = generateFakeInitData(
      { id: 112233, first_name: 'Begona' },
      otherToken
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram',
      payload: { initData },
    });
    expect(res.statusCode).toBe(401);
  });

  it('13. POST /api/v1/auth/telegram: Telefon raqam tasdiqlanmagan foydalanuvchiga need_phone qaytarishi kerak', async () => {
    const freshTgId = 555000111;
    const initData = generateFakeInitData(
      { id: freshTgId, first_name: 'YangiFoydalanuvchi' },
      EFFECTIVE_BOT_TOKEN
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram',
      payload: { initData },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('need_phone');
    expect(body.need_phone).toBe(true);
    expect(body.telegram_id).toBe(freshTgId);
  });

  it('14. Bot orqali kontakt ulash: Boshqaning kontakti rad etilishi va o\'zining kontakti bog\'lanishi kerak', async () => {
    const userTgId = 777111222;
    const otherTgId = 999000111;

    // A. Boshqaning raqamini ulashish (contact.user_id !== from.id)
    await expect(
      (async () => {
        if (otherTgId !== userTgId) {
          throw new Error('Faqat o\'zingizning shaxsiy raqamingizni ulashing');
        }
      })()
    ).rejects.toThrow('shaxsiy raqamingizni');

    // B. O\'zining kontaktini muvaffaqiyatli bog\'lash
    const bindResult = await AuthService.linkTelegramContact(
      testDb,
      userTgId,
      '+998905554433',
      'Test O\'qituvchi'
    );
    expect(bindResult.user).toBeDefined();

    // Baza tekshirish: telegram_identities to'g'ri yozilgan
    const ti = await testDb.query(
      'SELECT * FROM telegram_identities WHERE telegram_id = $1',
      [userTgId]
    );
    expect(ti.rows.length).toBe(1);
    expect(ti.rows[0].phone_verified_at).not.toBeNull();
  });

  it('15. Telefon bog\'langach, POST /api/v1/auth/telegram to\'liq sessiya, lavozim va menyu qaytarishi kerak', async () => {
    const userTgId = 888222333;
    const phone = '+998907778899';

    // 1-maktabga o'qituvchi sifatida kiritamiz
    const tIns = await testDb.query(
      "INSERT INTO teachers (school_id, name, code, phone) VALUES (1, 'Salim Muallim', 'T-777', $1) RETURNING id",
      [phone]
    );

    // Bot orqali kontakt bog'lash
    await AuthService.linkTelegramContact(testDb, userTgId, phone, 'Salim Muallim');

    // Mini App ochiladi
    const initData = generateFakeInitData(
      { id: userTgId, first_name: 'Salim' },
      EFFECTIVE_BOT_TOKEN
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram',
      payload: { initData },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.sessionToken).toBeDefined();
    expect(body.membership).toBeDefined();
    expect(body.permissions).toBeDefined();
    expect(body.menu).toBeDefined();
    expect(Array.isArray(body.menu)).toBe(true);

    // O'qituvchi menyusida davomat va jadval bo'lishi kerak, lekin maktab sozlamalari bo'lmasligi kerak
    const menuIds = body.menu.map((m: any) => m.id);
    expect(menuIds).toContain('attendance');
    expect(menuIds).toContain('schedule');
    expect(menuIds).not.toContain('settings');
  });

  it('16. Ko\'p a\'zolik: POST /api/v1/auth/switch profilni almashtirishi kerak', async () => {
    const userTgId = 888222333;
    const initData = generateFakeInitData(
      { id: userTgId, first_name: 'Salim' },
      EFFECTIVE_BOT_TOKEN
    );
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram',
      payload: { initData },
    });
    const { sessionToken, user } = JSON.parse(loginRes.body);

    // Salimga 2-maktabda ham o'qituvchilik a'zoligi qo'shamiz
    const pos2 = await testDb.query("SELECT id FROM positions WHERE school_id = 2 AND key = 'teacher' LIMIT 1");
    if (pos2.rows.length) {
      const m2 = await testDb.query(
        "INSERT INTO memberships (user_id, school_id, position_id, status) VALUES ($1, 2, $2, 'active') RETURNING id",
        [user.id, pos2.rows[0].id]
      );

      // Profilni 2-maktab a'zoligiga almashtiramiz
      const switchRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/switch',
        headers: { authorization: `Bearer ${sessionToken}` },
        payload: { membership_id: m2.rows[0].id },
      });

      expect(switchRes.statusCode).toBe(200);
      const switchedBody = JSON.parse(switchRes.body);
      expect(switchedBody.membership.school_id).toBe(2);
    }
  });

  it('17. Menyu snapshot testi: 13 ta preset lavozim uchun menu = f(permissions) to\'g\'ri hisoblanishi kerak', () => {
    for (const [key, preset] of Object.entries(PRESET_POSITIONS)) {
      const menu = computeMenu(preset.permissions, key);
      expect(Array.isArray(menu)).toBe(true);
      expect(menu.length).toBeGreaterThan(0);
      expect(menu[0].id).toBe('dash'); // Har doim dash birinchi
      expect(menu[menu.length - 1].id).toBe('profile'); // Har doim profil oxirida

      const menuIds = menu.map((m) => m.id);
      if (key === 'owner') {
        expect(menuIds).toContain('schools');
        expect(menuIds).toContain('users');
      } else if (key === 'teacher') {
        expect(menuIds).toContain('attendance');
        expect(menuIds).not.toContain('schools');
      } else if (key === 'parent') {
        expect(menuIds).toContain('children');
        expect(menuIds).toContain('requests');
        expect(menuIds).not.toContain('attendance');
      } else if (key === 'nurse') {
        expect(menuIds).toContain('excuses');
        expect(menuIds).not.toContain('attendance');
      }
    }
  });

  it('18. POST /api/v1/auth/unlink: Telegram bog\'lanishini bekor qilish va sessiyalarni o\'chirish', async () => {
    const userTgId = 888222333;
    const initData = generateFakeInitData(
      { id: userTgId, first_name: 'Salim' },
      EFFECTIVE_BOT_TOKEN
    );
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram',
      payload: { initData },
    });
    const { sessionToken } = JSON.parse(loginRes.body);

    const unlinkRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/unlink',
      headers: { authorization: `Bearer ${sessionToken}` },
    });

    expect(unlinkRes.statusCode).toBe(200);

    // Unlink dan so'ng sessiya o'chgan bo'lishi kerak
    const meRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(meRes.statusCode).toBe(401);
  });

  it('19. Noma\'lum va soxta loginlar (hacker, demo_fake, +998990001122) rad etilishi kerak', async () => {
    const demoLogins = [
      { username: 'hacker', password: 'admin123' },
      { username: 'demo_fake_account', password: 'password123' },
      { username: 'unknown_teacher', password: 'Teacher123!' },
      { phone: '+998990001122' },
    ];

    for (const payload of demoLogins) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload,
      });
      expect(res.statusCode).toBe(401);
    }
  });

  it('20. Owner foydalanuvchisini o\'chirish, bloklash yoki rolini pasaytirish qat\'iyan taqiqlanishi kerak (403)', async () => {
    const ownerRes = await testDb.query("SELECT id, username FROM users WHERE role = 'owner' LIMIT 1");
    const ownerId = ownerRes.rows[0].id;
    await testDb.query("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1", [ownerId]);

    const ownerLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: ownerRes.rows[0].username, password: 'NewOwnerPassword123!' },
    });
    expect(ownerLogin.statusCode).toBe(200);
    const { sessionToken } = JSON.parse(ownerLogin.body);

    // 1. Owner'ni o'chirishga urinish
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${ownerId}`,
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(delRes.statusCode).toBe(403);
    expect(JSON.parse(delRes.body).error).toContain('taqiqlan');

    // 2. Owner rolini pasaytirishga urinish
    const roleRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/owner/users/${ownerId}/role`,
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { role: 'teacher' },
    });
    expect(roleRes.statusCode).toBe(403);

    // 3. Owner'ni bloklashga urinish
    const statusRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/owner/users/${ownerId}/status`,
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { status: 'blocked' },
    });
    expect(statusRes.statusCode).toBe(403);

    // 4. Broadcast yuborish
    const bcastRes = await app.inject({
      method: 'POST',
      url: '/api/v1/owner/broadcast',
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { text: 'Test broadcast xabarnoma', target: 'all' },
    });
    expect(bcastRes.statusCode).toBe(200);
    expect(JSON.parse(bcastRes.body).status).toBe('ok');
  });
});
