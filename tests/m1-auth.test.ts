import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createTestDb, DbClient } from '../src/db/client.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { can, AuthUser } from '../src/modules/auth/permissions.js';

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
});
