import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createTestDb, DbClient } from '../src/db/client.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { AuthUser } from '../src/modules/auth/permissions.js';

describe('M4: /bootstrap, /import, Frontend integratsiyasi', () => {
  let app: FastifyInstance;
  let testDb: DbClient;
  let ownerCookie: string;
  let directorCookie: string;
  let schoolId: number;

  beforeAll(async () => {
    testDb = await createTestDb();
    app = await buildApp({ db: testDb });
    await app.ready();

    // 1. Owner login
    const ownerLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'owner', password: 'Owner123456!' },
    });
    ownerCookie = ownerLogin.headers['set-cookie'] as string;

    // 2. Maktab va direktor yaratish
    const ownerUser: AuthUser = { id: 1, school_id: null, username: 'owner', role: 'owner' };
    const created = await AuthService.createSchoolWithDirector(
      testDb,
      ownerUser,
      '4-sonli Maktab',
      'dir_m4'
    );
    schoolId = created.school.id;

    // 3. Direktor login
    const dirLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'dir_m4', password: created.director.tempPassword },
    });
    directorCookie = dirLogin.headers['set-cookie'] as string;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (testDb) await testDb.close();
  });

  it('1. GET /api/v1/bootstrap frontend kutayotgan to\'liq JSON shaklini qaytarishi kerak', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { cookie: directorCookie },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    const d = body.data;

    // Frontend talab qiladigan barcha kalitlar mavjud bo'lishi kerak
    expect(d).toHaveProperty('v');
    expect(d).toHaveProperty('n');
    expect(d).toHaveProperty('me');
    expect(d.me.role).toBe('director');
    expect(d).toHaveProperty('school');
    expect(d.school.name).toBe('4-sonli Maktab');
    expect(Array.isArray(d.years)).toBe(true);
    expect(Array.isArray(d.subjects)).toBe(true);
    expect(Array.isArray(d.teachers)).toBe(true);
    expect(Array.isArray(d.classes)).toBe(true);
    expect(Array.isArray(d.students)).toBe(true);
    expect(Array.isArray(d.assigns)).toBe(true);
    expect(Array.isArray(d.sched)).toBe(true);
    expect(typeof d.ses).toBe('object');
    expect(typeof d.excuse).toBe('object');
    expect(typeof d.perm).toBe('object');
    expect(typeof d.sent).toBe('object');
  });

  it('2. POST /api/v1/import eski edm_school_v1 JSON ma\'lumotlarini idempotent tarzda yuklashi kerak', async () => {
    const importPayload = {
      v: 1,
      school: {
        name: '4-sonli Yangilangan Maktab',
        addr: 'Toshkent shahar',
        phone: '+998712000000',
        logo: '🎓',
        days: [0, 1, 2, 3, 4],
        times: ['08:00-08:45', '08:55-09:40'],
      },
      years: [{ id: 101, name: '2026–2027', on: 1 }],
      subjects: [
        { id: 201, name: 'Biologiya', code: 'BIO', color: '#1098ad', st: 'a' },
        { id: 202, name: 'Kimyo', code: 'KIM', color: '#7048e8', st: 'a' },
      ],
      teachers: [
        { id: 301, name: 'Usmonov Jamshid', code: 'T-99', phone: '', pos: 'O\'qituvchi', st: 'a' },
      ],
      classes: [
        { id: 401, yid: 101, name: '7-A', tid: 301, st: 'a' },
      ],
      students: [
        { id: 501, cid: 401, name: 'Nazarov Ilhom', code: 'S-99', phone: '', parent: '', pphone: '', tg: '', dob: '', enr: '2026-10-05', st: 'a' },
      ],
      assigns: [
        { id: 601, tid: 301, sid: 201, cid: 401 },
      ],
      sched: [
        { id: 701, d: 0, n: 0, aid: 601 },
      ],
      ses: {
        '2026-10-05|701': {
          date: '2026-10-05',
          schedId: 701,
          aid: 601,
          cid: 401,
          sid: 201,
          tid: 301,
          n: 0,
          yid: 101,
          recs: { '501': 'p' },
        },
      },
    };

    // 1-marta import
    const impRes1 = await app.inject({
      method: 'POST',
      url: '/api/v1/import',
      headers: { cookie: directorCookie },
      payload: importPayload,
    });
    expect(impRes1.statusCode).toBe(200);

    // 2-marta aynan shu ma'lumotni import qilish (Idempotent: dublikat bo'lmasligi kerak)
    const impRes2 = await app.inject({
      method: 'POST',
      url: '/api/v1/import',
      headers: { cookie: directorCookie },
      payload: importPayload,
    });
    expect(impRes2.statusCode).toBe(200);

    // Bootstrap orqali tekshirish
    const bootRes = await app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { cookie: directorCookie },
    });
    const d = JSON.parse(bootRes.body).data;

    // Biologiya faqat 1 marta bo'lishi kerak
    const bioCount = d.subjects.filter((s: any) => s.name === 'Biologiya').length;
    expect(bioCount).toBe(1);

    // Usmonov Jamshid faqat 1 marta bo'lishi kerak
    const teacherCount = d.teachers.filter((t: any) => t.name === 'Usmonov Jamshid').length;
    expect(teacherCount).toBe(1);

    // 7-A sinfi faqat 1 marta bo'lishi kerak
    const classCount = d.classes.filter((c: any) => c.name === '7-A').length;
    expect(classCount).toBe(1);

    // O'quvchi faqat 1 marta bo'lishi kerak
    const stCount = d.students.filter((s: any) => s.name === 'Nazarov Ilhom').length;
    expect(stCount).toBe(1);
  });

  it('3. GET /api/v1/export to\'liq zaxira JSON faylini qaytarishi kerak', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/export',
      headers: { cookie: directorCookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const data = JSON.parse(res.body);
    expect(data.school).toBeDefined();
    expect(data.students.length).toBeGreaterThan(0);
  });

  it('4. Sozlamalar va Ruxsatlar API (GET/PUT /settings va /permissions)', async () => {
    // Sozlamalarni yangilash
    const setRes = await app.inject({
      method: 'PUT',
      url: '/api/v1/settings',
      headers: { cookie: directorCookie },
      payload: {
        name: '4-sonli Ixtisoslashtirilgan Maktab',
        phone: '+998909999999',
      },
    });
    expect(setRes.statusCode).toBe(200);

    // Ruxsatlarni yangilash: o'qituvchiga EXPORT_DATA ruxsatini olib tashlash
    const permRes = await app.inject({
      method: 'PUT',
      url: '/api/v1/permissions',
      headers: { cookie: directorCookie },
      payload: {
        role: 'teacher',
        permission: 'EXPORT_DATA',
        enabled: false,
      },
    });
    expect(permRes.statusCode).toBe(200);

    // Bootstrapda tekshirish
    const bootRes = await app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { cookie: directorCookie },
    });
    const d = JSON.parse(bootRes.body).data;
    expect(d.school.name).toBe('4-sonli Ixtisoslashtirilgan Maktab');
    expect(d.perm.teacher).not.toContain('EXPORT_DATA');
  });

  it('5. Foydalanuvchilar (Users) boshqaruvi API', async () => {
    // Direktor yangi o'qituvchi hisobini yaratadi
    const userRes = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { cookie: directorCookie },
      payload: {
        username: 'new_teacher_user',
        role: 'teacher',
      },
    });
    expect(userRes.statusCode).toBe(200);
    const createdUser = JSON.parse(userRes.body).data;
    expect(createdUser.tempPassword).toBeDefined();

    // Foydalanuvchilar ro'yxatini olish
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { cookie: directorCookie },
    });
    expect(listRes.statusCode).toBe(200);
    const users = JSON.parse(listRes.body).data;
    expect(users.some((u: any) => u.username === 'new_teacher_user')).toBe(true);

    // Foydalanuvchini o'chirish
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${createdUser.id}`,
      headers: { cookie: directorCookie },
    });
    expect(delRes.statusCode).toBe(200);
  });

  it('6. Maktablar (Schools) boshqaruvi API (Faqat owner uchun)', async () => {
    // Direktor maktablar ro'yxatini ko'ra olmasligi kerak (403)
    const forbiddenRes = await app.inject({
      method: 'GET',
      url: '/api/v1/schools',
      headers: { cookie: directorCookie },
    });
    expect(forbiddenRes.statusCode).toBe(403);

    // Owner maktablar ro'yxatini ko'ra oladi
    const ownerSchoolsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/schools',
      headers: { cookie: ownerCookie },
    });
    expect(ownerSchoolsRes.statusCode).toBe(200);
    const schools = JSON.parse(ownerSchoolsRes.body).data;
    expect(schools.length).toBeGreaterThan(0);
  });

  it('7. GET / frontend index.html faylini serverdan berishi kerak', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('EduMemory');
    expect(res.body).toContain('apiReq');
    expect(res.body).toContain('refreshData');
  });

  it('8. Platforma egasi (owner) maktabga yordam rejimida kirishi va chiqishi', async () => {
    // Yordam rejimiga kirish
    const enterRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/support-mode',
      headers: { cookie: ownerCookie },
      payload: { school_id: schoolId },
    });
    expect(enterRes.statusCode).toBe(200);

    // Endi owner ushbu maktab ma'lumotlarini bootstrap orqali ko'ra oladi
    const bootRes = await app.inject({
      method: 'GET',
      url: '/api/v1/bootstrap',
      headers: { cookie: ownerCookie },
    });
    expect(bootRes.statusCode).toBe(200);
    const bootData = JSON.parse(bootRes.body).data;
    expect(bootData.school.name).toBe('4-sonli Ixtisoslashtirilgan Maktab');

    // Yordam rejimidan chiqish
    const exitRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/exit-support-mode',
      headers: { cookie: ownerCookie },
    });
    expect(exitRes.statusCode).toBe(200);
  });
});
