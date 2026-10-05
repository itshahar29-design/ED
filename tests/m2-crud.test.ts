import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createTestDb, DbClient } from '../src/db/client.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { AuthUser } from '../src/modules/auth/permissions.js';

describe('M2: CRUD, biriktirish, jadval qoidalari, arxiv/o\'chirish', () => {
  let app: FastifyInstance;
  let testDb: DbClient;
  let directorCookie: string;
  let schoolId: number;

  beforeAll(async () => {
    testDb = await createTestDb();
    app = await buildApp({ db: testDb });
    await app.ready();

    // Owner maktab va direktorni yaratadi
    const ownerUser: AuthUser = { id: 1, school_id: null, username: 'owner', role: 'owner' };
    const created = await AuthService.createSchoolWithDirector(
      testDb,
      ownerUser,
      'Prezident Maktabi',
      'pm_director'
    );
    schoolId = created.school.id;

    // Director login qiladi
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        username: 'pm_director',
        password: created.director.tempPassword,
      },
    });
    directorCookie = loginRes.headers['set-cookie'] as string;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (testDb) await testDb.close();
  });

  it('1. O\'quv yili (Years) CRUD va joriy yilni almashtirish', async () => {
    // Mavjud yillarni olish
    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/years',
      headers: { cookie: directorCookie },
    });
    expect(getRes.statusCode).toBe(200);
    const initialYears = JSON.parse(getRes.body).data;
    expect(initialYears.length).toBeGreaterThan(0);

    // Yangi yil qo'shish
    const addRes = await app.inject({
      method: 'POST',
      url: '/api/v1/years',
      headers: { cookie: directorCookie },
      payload: { name: '2027–2028' },
    });
    expect(addRes.statusCode).toBe(200);
    const newYear = JSON.parse(addRes.body).data;
    expect(newYear.on).toBe(true);

    // Dublikat nom rad etilishi kerak
    const dupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/years',
      headers: { cookie: directorCookie },
      payload: { name: '2027–2028' },
    });
    expect(dupRes.statusCode).toBe(400);

    // Eski yilni yana joriy qilish
    const setCurRes = await app.inject({
      method: 'POST',
      url: `/api/v1/years/${initialYears[0].id}/current`,
      headers: { cookie: directorCookie },
    });
    expect(setCurRes.statusCode).toBe(200);
    expect(JSON.parse(setCurRes.body).data.on).toBe(true);
  });

  it('2. Fanlar (Subjects) CRUD, unikallik va arxivlash', async () => {
    // Fan yaratish
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/subjects',
      headers: { cookie: directorCookie },
      payload: { name: 'Matematika', code: 'MAT', color: '#3b5bdb' },
    });
    expect(createRes.statusCode).toBe(200);
    const sub = JSON.parse(createRes.body).data;
    expect(sub.name).toBe('Matematika');

    // Ikkinchi fan yaratish
    await app.inject({
      method: 'POST',
      url: '/api/v1/subjects',
      headers: { cookie: directorCookie },
      payload: { name: 'Fizika', code: 'FIZ', color: '#f76707' },
    });

    // Dublikat fan rad etilishi kerak
    const dupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/subjects',
      headers: { cookie: directorCookie },
      payload: { name: 'Matematika' },
    });
    expect(dupRes.statusCode).toBe(400);

    // Arxivlash va tiklash
    const archRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/subjects/${sub.id}/status`,
      headers: { cookie: directorCookie },
      payload: { status: 'x' },
    });
    expect(archRes.statusCode).toBe(200);
    expect(JSON.parse(archRes.body).data.st).toBe('x');

    // Faol fanlar ro'yxatida chiqmasligi kerak
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/subjects',
      headers: { cookie: directorCookie },
    });
    const activeSubs = JSON.parse(listRes.body).data;
    expect(activeSubs.some((s: any) => s.id === sub.id)).toBe(false);

    // Qayta tiklash
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/subjects/${sub.id}/status`,
      headers: { cookie: directorCookie },
      payload: { status: 'a' },
    });
  });

  it('3. O\'qituvchilar (Teachers) CRUD va sinf rahbarligi', async () => {
    const tRes = await app.inject({
      method: 'POST',
      url: '/api/v1/teachers',
      headers: { cookie: directorCookie },
      payload: {
        name: 'Aliyev Anvar',
        code: 'T-01',
        phone: '+998901234567',
        pos: 'Matematika o\'qituvchisi',
      },
    });
    expect(tRes.statusCode).toBe(200);
    const teacher1 = JSON.parse(tRes.body).data;
    expect(teacher1.name).toBe('Aliyev Anvar');

    // Ikkinchi o'qituvchi
    await app.inject({
      method: 'POST',
      url: '/api/v1/teachers',
      headers: { cookie: directorCookie },
      payload: { name: 'Karimova Dilnoza' },
    });

    // O'qituvchilar ro'yxati
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/teachers',
      headers: { cookie: directorCookie },
    });
    expect(JSON.parse(listRes.body).data.length).toBeGreaterThanOrEqual(2);
  });

  it('4. Sinflar (Classes) CRUD va o\'quvchisi bor sinfni o\'chirishdan himoya', async () => {
    const teachersRes = await app.inject({
      method: 'GET',
      url: '/api/v1/teachers',
      headers: { cookie: directorCookie },
    });
    const teacherId = JSON.parse(teachersRes.rows || teachersRes.body).data[0].id;

    // Sinf yaratish
    const cRes = await app.inject({
      method: 'POST',
      url: '/api/v1/classes',
      headers: { cookie: directorCookie },
      payload: { name: '5-A', tid: teacherId },
    });
    expect(cRes.statusCode).toBe(200);
    const class5A = JSON.parse(cRes.body).data;

    // Yana bir sinf
    await app.inject({
      method: 'POST',
      url: '/api/v1/classes',
      headers: { cookie: directorCookie },
      payload: { name: '5-B' },
    });

    // Sinfga o'quvchi qo'shamiz
    await app.inject({
      method: 'POST',
      url: '/api/v1/students',
      headers: { cookie: directorCookie },
      payload: { name: 'Karimov Jasur', cid: class5A.id },
    });

    // O'quvchisi bor sinfni o'chirish rad etilishi kerak!
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/classes/${class5A.id}`,
      headers: { cookie: directorCookie },
    });
    expect(delRes.statusCode).toBe(400);
    expect(JSON.parse(delRes.body).error).toContain('o\'quvchilar bor');
  });

  it('5. O\'quvchilar (Students) CRUD, Bulk ro\'yxat va arxivdagi sinfga tiklanmaslik qoidasi', async () => {
    const classesRes = await app.inject({
      method: 'GET',
      url: '/api/v1/classes',
      headers: { cookie: directorCookie },
    });
    const class5B = JSON.parse(classesRes.body).data.find((c: any) => c.name === '5-B');

    // 1. Validatsiyalar: Kelajak sana rad etilishi kerak
    const futureDobRes = await app.inject({
      method: 'POST',
      url: '/api/v1/students',
      headers: { cookie: directorCookie },
      payload: { name: 'Kelajakbek', cid: class5B.id, dob: '2099-01-01' },
    });
    expect(futureDobRes.statusCode).toBe(400);

    // 2. Telegram formati xato bo'lsa rad etiladi
    const badTgRes = await app.inject({
      method: 'POST',
      url: '/api/v1/students',
      headers: { cookie: directorCookie },
      payload: { name: 'Telegrambek', cid: class5B.id, tg: 'not_an_at_username' },
    });
    expect(badTgRes.statusCode).toBe(400);

    // 3. Bulk (ro'yxat bilan) qo'shish
    const bulkRes = await app.inject({
      method: 'POST',
      url: '/api/v1/students/bulk',
      headers: { cookie: directorCookie },
      payload: {
        cid: class5B.id,
        names: ['Abdullayev Aziz', 'Karimova Sevinch', 'Raxmatov Shohruh', 'Abdullayev Aziz'], // bitta dublikat bor
      },
    });
    expect(bulkRes.statusCode).toBe(200);
    const bulkBody = JSON.parse(bulkRes.body);
    expect(bulkBody.count).toBe(3);
    expect(bulkBody.skipped).toBe(1);

    // 4. Arxivdagi sinfga o'quvchini tiklashni taqiqlash
    // O'quvchini arxivlaymiz
    const studentsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/students?cid=${class5B.id}`,
      headers: { cookie: directorCookie },
    });
    const student1 = JSON.parse(studentsRes.body).data[0];

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/students/${student1.id}/status`,
      headers: { cookie: directorCookie },
      payload: { status: 'x' },
    });

    // Sinfni arxivlaymiz
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/classes/${class5B.id}/status`,
      headers: { cookie: directorCookie },
      payload: { status: 'x' },
    });

    // Endi o'quvchini tiklashga urinish rad etilishi kerak!
    const restoreRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/students/${student1.id}/status`,
      headers: { cookie: directorCookie },
      payload: { status: 'a' },
    });
    expect(restoreRes.statusCode).toBe(400);
    expect(JSON.parse(restoreRes.body).error).toContain('Avval «5-B» sinfini tiklang');

    // Sinfni qayta faollashtiramiz
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/classes/${class5B.id}/status`,
      headers: { cookie: directorCookie },
      payload: { status: 'a' },
    });
  });

  it('6. O\'qituvchiga fan/sinf biriktirish (Assignments) va unikallik qoidasi', async () => {
    const tRes = await app.inject({ method: 'GET', url: '/api/v1/teachers', headers: { cookie: directorCookie } });
    const sRes = await app.inject({ method: 'GET', url: '/api/v1/subjects', headers: { cookie: directorCookie } });
    const cRes = await app.inject({ method: 'GET', url: '/api/v1/classes', headers: { cookie: directorCookie } });

    const teacher1 = JSON.parse(tRes.body).data[0];
    const teacher2 = JSON.parse(tRes.body).data[1];
    const subjectMath = JSON.parse(sRes.body).data.find((s: any) => s.name === 'Matematika');
    const class5A = JSON.parse(cRes.body).data.find((c: any) => c.name === '5-A');

    // Teacher 1 ga 5-A da Matematika biriktirish
    const asgRes = await app.inject({
      method: 'POST',
      url: '/api/v1/assignments',
      headers: { cookie: directorCookie },
      payload: { tid: teacher1.id, sid: subjectMath.id, cid: class5A.id },
    });
    expect(asgRes.statusCode).toBe(200);

    // Shu sinfda Matematika fanini boshqa o'qituvchiga biriktirish taqiqlanadi!
    const conflictRes = await app.inject({
      method: 'POST',
      url: '/api/v1/assignments',
      headers: { cookie: directorCookie },
      payload: { tid: teacher2.id, sid: subjectMath.id, cid: class5A.id },
    });
    expect(conflictRes.statusCode).toBe(400);
    expect(JSON.parse(conflictRes.body).error).toContain('boshqa o\'qituvchiga biriktirilgan');
  });

  it('7. Dars jadvali qoidalari (Schedule slots): Bir vaqtda 2 sinfda bo\'lishni taqiqlash', async () => {
    const tRes = await app.inject({ method: 'GET', url: '/api/v1/teachers', headers: { cookie: directorCookie } });
    const sRes = await app.inject({ method: 'GET', url: '/api/v1/subjects', headers: { cookie: directorCookie } });
    const cRes = await app.inject({ method: 'GET', url: '/api/v1/classes', headers: { cookie: directorCookie } });

    const teacher1 = JSON.parse(tRes.body).data[0];
    const subjectFizika = JSON.parse(sRes.body).data.find((s: any) => s.name === 'Fizika');
    const class5A = JSON.parse(cRes.body).data.find((c: any) => c.name === '5-A');
    const class5B = JSON.parse(cRes.body).data.find((c: any) => c.name === '5-B');

    // Teacher 1 ga 5-B da ham Fizika biriktiramiz
    const asg5BRes = await app.inject({
      method: 'POST',
      url: '/api/v1/assignments',
      headers: { cookie: directorCookie },
      payload: { tid: teacher1.id, sid: subjectFizika.id, cid: class5B.id },
    });
    const asg5B = JSON.parse(asg5BRes.body).data;

    const asg5ARes = await app.inject({
      method: 'GET',
      url: `/api/v1/assignments?tid=${teacher1.id}`,
      headers: { cookie: directorCookie },
    });
    const asg5A = JSON.parse(asg5ARes.body).data.find((a: any) => a.cid === class5A.id);

    // 1. Dushanba kuni 1-darsga (day=0, slot=0) 5-A ga dars qo'yamiz
    const slot1Res = await app.inject({
      method: 'POST',
      url: '/api/v1/schedule',
      headers: { cookie: directorCookie },
      payload: { aid: asg5A.id, d: 0, n: 0 },
    });
    expect(slot1Res.statusCode).toBe(200);

    // 2. To'qnashuv: Aynan shu vaqtda (day=0, slot=0) Teacher 1 ni 5-B ga qo'yish taqiqlanadi!
    const conflictRes = await app.inject({
      method: 'POST',
      url: '/api/v1/schedule',
      headers: { cookie: directorCookie },
      payload: { aid: asg5B.id, d: 0, n: 0 },
    });
    expect(conflictRes.statusCode).toBe(400);
    expect(JSON.parse(conflictRes.body).error).toContain('sinfida dars beradi');

    // 3. Biriktirish olib tashlansa, unga tegishli jadvaldagi darslar ham o'chishi kerak
    const delAsgRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/assignments/${asg5A.id}`,
      headers: { cookie: directorCookie },
    });
    expect(delAsgRes.statusCode).toBe(200);

    // Jadval tekshiriladi: slot o'chirilgan bo'lishi kerak
    const schedRes = await app.inject({
      method: 'GET',
      url: `/api/v1/schedule?cid=${class5A.id}`,
      headers: { cookie: directorCookie },
    });
    expect(JSON.parse(schedRes.body).data.length).toBe(0);
  });
});
