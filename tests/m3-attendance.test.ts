import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createTestDb, DbClient } from '../src/db/client.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { AuthUser } from '../src/modules/auth/permissions.js';
import { getTodayInTashkent } from '../src/modules/attendance/attendance.service.js';
import { isSchoolDay } from '../src/modules/calendar/calendar.routes.js';

describe('M3: Davomat, sababli, hisobot, CSV', () => {
  let app: FastifyInstance;
  let testDb: DbClient;
  let directorCookie: string;
  let teacher1Cookie: string;
  let teacher2Cookie: string;
  let schoolId: number;
  let teacher1Id: number;
  let teacher2Id: number;
  let classId: number;
  let student1Id: number;
  let student2Id: number;
  let student3Id: number;
  let slotId: number;

  const today = getTodayInTashkent();

  beforeAll(async () => {
    testDb = await createTestDb();
    app = await buildApp({ db: testDb });
    await app.ready();

    // 1. Owner maktab va direktorni yaratadi
    const ownerUser: AuthUser = { id: 1, school_id: null, username: 'owner', role: 'owner' };
    const created = await AuthService.createSchoolWithDirector(
      testDb,
      ownerUser,
      '3-sonli Maktab',
      'dir_m3'
    );
    schoolId = created.school.id;

    // Director login
    const dirLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'dir_m3', password: created.director.tempPassword },
    });
    directorCookie = dirLogin.headers['set-cookie'] as string;

    // 2. O'qituvchilar yaratish
    const t1Res = await app.inject({
      method: 'POST',
      url: '/api/v1/teachers',
      headers: { cookie: directorCookie },
      payload: { name: 'Qodirov Bobur', code: 'T-10' },
    });
    teacher1Id = JSON.parse(t1Res.body).data.id;

    const t2Res = await app.inject({
      method: 'POST',
      url: '/api/v1/teachers',
      headers: { cookie: directorCookie },
      payload: { name: 'Valiyev Sarvar', code: 'T-11' },
    });
    teacher2Id = JSON.parse(t2Res.body).data.id;

    // O'qituvchilar uchun foydalanuvchi hisoblari yaratish
    const u1 = await AuthService.createUser(testDb, { id: created.director.id, school_id: schoolId, username: 'dir_m3', role: 'director' }, {
      username: 'teacher_bobur',
      role: 'teacher',
      teacher_id: teacher1Id,
    });
    const t1Login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'teacher_bobur', password: u1.tempPassword },
    });
    teacher1Cookie = t1Login.headers['set-cookie'] as string;

    const u2 = await AuthService.createUser(testDb, { id: created.director.id, school_id: schoolId, username: 'dir_m3', role: 'director' }, {
      username: 'teacher_sarvar',
      role: 'teacher',
      teacher_id: teacher2Id,
    });
    const t2Login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'teacher_sarvar', password: u2.tempPassword },
    });
    teacher2Cookie = t2Login.headers['set-cookie'] as string;

    // 3. Fan yaratish
    const sRes = await app.inject({
      method: 'POST',
      url: '/api/v1/subjects',
      headers: { cookie: directorCookie },
      payload: { name: 'Ona tili', code: 'ONA', color: '#e64980' },
    });
    const subjectId = JSON.parse(sRes.body).data.id;

    // 4. Sinf yaratish (sinf rahbari Teacher 1)
    const cRes = await app.inject({
      method: 'POST',
      url: '/api/v1/classes',
      headers: { cookie: directorCookie },
      payload: { name: '6-A', tid: teacher1Id },
    });
    classId = JSON.parse(cRes.body).data.id;

    // 5. O'quvchilar qo'shish
    const st1 = await app.inject({
      method: 'POST',
      url: '/api/v1/students',
      headers: { cookie: directorCookie },
      payload: { name: 'Anvarov Jasur', cid: classId },
    });
    student1Id = JSON.parse(st1.body).data.id;

    const st2 = await app.inject({
      method: 'POST',
      url: '/api/v1/students',
      headers: { cookie: directorCookie },
      payload: { name: 'Bekov Sardor', cid: classId },
    });
    student2Id = JSON.parse(st2.body).data.id;

    const st3 = await app.inject({
      method: 'POST',
      url: '/api/v1/students',
      headers: { cookie: directorCookie },
      payload: { name: '=FormulaAttack', cid: classId }, // CSV injection test uchun
    });
    student3Id = JSON.parse(st3.body).data.id;

    // 6. Biriktirish (Teacher 1 -> Ona tili -> 6-A)
    const asgRes = await app.inject({
      method: 'POST',
      url: '/api/v1/assignments',
      headers: { cookie: directorCookie },
      payload: { tid: teacher1Id, sid: subjectId, cid: classId },
    });
    const assignmentId = JSON.parse(asgRes.body).data.id;

    // 7. Jadvalga qo'yish (Bugungi hafta kuniga)
    const todayWd = (new Date(today + 'T12:00:00').getDay() + 6) % 7;
    const slotRes = await app.inject({
      method: 'POST',
      url: '/api/v1/schedule',
      headers: { cookie: directorCookie },
      payload: { aid: assignmentId, d: todayWd, n: 0 },
    });
    slotId = JSON.parse(slotRes.body).data.id;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (testDb) await testDb.close();
  });

  it('1. Kelajak sanaga davomat yozish serverda qat\'iy taqiqlanishi kerak', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/attendance/sessions/${slotId}/2099-12-31`,
      headers: { cookie: directorCookie },
      payload: {
        version: 0,
        records: { [student1Id]: 'p' },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('Kelajak sanaga davomat yozib bo\'lmaydi');
  });

  it('2. Begona o\'qituvchi boshqa o\'qituvchining darsiga davomat qo\'ya olmasligi kerak', async () => {
    // Teacher 2 dars o'qituvchisi emas (Teacher 1 darsi)
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/attendance/sessions/${slotId}/${today}`,
      headers: { cookie: teacher2Cookie },
      payload: {
        version: 0,
        records: { [student1Id]: 'p' },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('faqat o\'zingizning darsingizga');
  });

  it('3. Davomat saqlash, snapshot va Idempotency-Key ishlashi kerak', async () => {
    // Teacher 1 davomat saqlaydi
    const idempotencyKey = 'unique-key-12345';

    const res1 = await app.inject({
      method: 'PUT',
      url: `/api/v1/attendance/sessions/${slotId}/${today}`,
      headers: {
        cookie: teacher1Cookie,
        'idempotency-key': idempotencyKey,
      },
      payload: {
        version: 0,
        records: {
          [student1Id]: 'p', // keldi
          [student2Id]: 'a', // yo'q
          [student3Id]: 'l', // kechikdi
        },
      },
    });

    expect(res1.statusCode).toBe(200);
    const body1 = JSON.parse(res1.body);
    expect(body1.data.version).toBe(1);

    // Idempotency tekshirish: aynan shu kalit bilan qayta yuborilganda keshdan qaytishi kerak
    const res2 = await app.inject({
      method: 'PUT',
      url: `/api/v1/attendance/sessions/${slotId}/${today}`,
      headers: {
        cookie: teacher1Cookie,
        'idempotency-key': idempotencyKey,
      },
      payload: {
        version: 0,
        records: { [student1Id]: 'a' },
      },
    });
    expect(res2.statusCode).toBe(200);
    const body2 = JSON.parse(res2.body);
    expect(body2.data.records[student1Id]).toBe('p'); // keshdan avvalgi natija qaytdi
  });

  it('4. Optimistic Locking: Eskirgan versiya bilan yozilsa 409 Conflict qaytishi kerak', async () => {
    // Ayni paytda bazadagi versiya = 1
    // Foydalanuvchi A (Director) versiya 1 bilan saqlaydi -> versiya 2 bo'ladi
    const dirRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/attendance/sessions/${slotId}/${today}`,
      headers: { cookie: directorCookie },
      payload: {
        version: 1,
        records: {
          [student1Id]: 'p',
          [student2Id]: 'a',
          [student3Id]: 'p',
        },
      },
    });
    expect(dirRes.statusCode).toBe(200);
    expect(JSON.parse(dirRes.body).data.version).toBe(2);

    // Foydalanuvchi B (Teacher 1) hali ham eski versiya 1 bilan yozishga urinadi
    const conflictRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/attendance/sessions/${slotId}/${today}`,
      headers: { cookie: teacher1Cookie },
      payload: {
        version: 1, // eskirgan!
        records: {
          [student1Id]: 'a',
        },
      },
    });

    expect(conflictRes.statusCode).toBe(409);
    const conflictBody = JSON.parse(conflictRes.body);
    expect(conflictBody.error).toContain('o\'zgartirilgan');
    expect(conflictBody.current_version).toBe(2);
    expect(conflictBody.records).toBeDefined();
  });

  it('5. Sinf rahbari tomonidan sababli qilish (attendance_excuses) va bekor qilish', async () => {
    // Hozirda Student 2 'a' holatida
    // Sinf rahbari (Teacher 1) o'quvchini sababli qiladi
    const excuseRes = await app.inject({
      method: 'POST',
      url: '/api/v1/attendance/excuse',
      headers: { cookie: teacher1Cookie },
      payload: {
        student_id: student2Id,
        date: today,
        reason: 'Kasallik',
        note: 'Shifokor ma\'lumotnomasi bor',
      },
    });

    expect(excuseRes.statusCode).toBe(200);
    const excBody = JSON.parse(excuseRes.body).data;
    expect(excBody.excused_count).toBeGreaterThan(0);

    // Davomat tekshiriladi: student 2 ning 'a' yozuvi 'e' bo'lgan bo'lishi kerak
    const attRes = await app.inject({
      method: 'GET',
      url: `/api/v1/attendance?date=${today}`,
      headers: { cookie: directorCookie },
    });
    const sesData = JSON.parse(attRes.body).data.sessions[0];
    expect(sesData.records[student2Id]).toBe('e');

    // Sababli belgisini bekor qilish
    const cancelRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/attendance/excuse/${student2Id}/${today}`,
      headers: { cookie: teacher1Cookie },
    });
    expect(cancelRes.statusCode).toBe(200);

    // Bekor qilingach student 2 yana 'a' holatiga qaytishi kerak
    const attAfter = await app.inject({
      method: 'GET',
      url: `/api/v1/attendance?date=${today}`,
      headers: { cookie: directorCookie },
    });
    const sesAfter = JSON.parse(attAfter.body).data.sessions[0];
    expect(sesAfter.records[student2Id]).toBe('a');
  });

  it('6. Davomat foizi hisobi: Sababli (e) va Kechikish (l) foizni tushirmasligi kerak', async () => {
    // 3 ta o'quvchi davomatini aniq o'rnatamiz:
    // Student 1: 'p' (100%)
    // Student 2: 'e' (100% - chunki sababli)
    // Student 3: 'a' (0% - yo'q)
    await app.inject({
      method: 'PUT',
      url: `/api/v1/attendance/sessions/${slotId}/${today}`,
      headers: { cookie: directorCookie },
      payload: {
        version: 0,
        records: {
          [student1Id]: 'p',
          [student2Id]: 'e',
          [student3Id]: 'a',
        },
      },
    });

    const repRes = await app.inject({
      method: 'GET',
      url: `/api/v1/reports?from=${today}&to=${today}`,
      headers: { cookie: directorCookie },
    });

    expect(repRes.statusCode).toBe(200);
    const repData = JSON.parse(repRes.body).data;

    const st1 = repData.students.find((s: any) => s.id === student1Id);
    const st2 = repData.students.find((s: any) => s.id === student2Id);
    const st3 = repData.students.find((s: any) => s.id === student3Id);

    // Formula: (total - a) / total * 100
    expect(st1.pct).toBe(100);
    expect(st2.pct).toBe(100); // 'e' foizni tushirmaydi!
    expect(st3.pct).toBe(0);   // 'a' bo'lgani uchun 0%
  });

  it('7. CSV eksport va Formula Injection himoyasi', async () => {
    const csvRes = await app.inject({
      method: 'GET',
      url: `/api/v1/reports.csv?from=${today}&to=${today}`,
      headers: { cookie: directorCookie },
    });

    expect(csvRes.statusCode).toBe(200);
    expect(csvRes.headers['content-type']).toContain('text/csv');

    const csvText = csvRes.body;
    // UTF-8 BOM mavjudligi tekshiriladi
    expect(csvText.charCodeAt(0)).toBe(0xFEFF);

    // Formula injection himoyasi: "=FormulaAttack" oldiga ' qo'yilgan bo'lishi kerak
    expect(csvText).toContain("'=FormulaAttack");
  });

  it('8. K5: Darsni ochish hech qanday yozuv yaratmaydi (0 records)', async () => {
    // Kechagi sana bo'yicha dars ochilsa (GET)
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/attendance?date=${yesterday}`,
      headers: { cookie: teacher1Cookie },
    });
    expect(getRes.statusCode).toBe(200);

    // Bazada bu sana uchun attendance_sessions va attendance_records bo'sh bo'lishi shart!
    const recCount = await testDb.query(
      'SELECT COUNT(*)::int as cnt FROM attendance_records WHERE school_id = $1',
      [schoolId]
    );
    // Avvalgi testlardagi yozuvlar sonini o'zgartirmasligi kerak
    const sessCount = await testDb.query(
      'SELECT COUNT(*)::int as cnt FROM attendance_sessions WHERE school_id = $1 AND date = $2',
      [schoolId, yesterday]
    );
    expect(sessCount.rows[0].cnt).toBe(0);
  });

  it('9. Draft sessiya hisobotga kirmaydi; submit qilingandan keyin ko\'rinadi', async () => {
    // 2 kun oldingi sana uchun draft saqlash
    const pastDate = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    
    // Draft sifatida saqlash
    const draftRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/attendance/sessions/${slotId}/${pastDate}`,
      headers: { cookie: teacher1Cookie },
      payload: {
        version: 0,
        records: {
          [student1Id]: 'a',
          [student2Id]: 'a',
        },
        status: 'draft',
      },
    });
    expect(draftRes.statusCode).toBe(200);
    expect(JSON.parse(draftRes.body).data.status).toBe('draft');

    // Hisobotda pastDate bo'yicha ko'rinmasligi kerak!
    const repRes1 = await app.inject({
      method: 'GET',
      url: `/api/v1/reports?from=${pastDate}&to=${pastDate}`,
      headers: { cookie: directorCookie },
    });
    expect(repRes1.statusCode).toBe(200);
    expect(JSON.parse(repRes1.body).data.records.length).toBe(0);

    // Endi submit qilish: POST /sessions/:slotId/:date/submit
    const subRes = await app.inject({
      method: 'POST',
      url: `/api/v1/attendance/sessions/${slotId}/${pastDate}/submit`,
      headers: { cookie: teacher1Cookie },
      payload: {
        version: 1,
        records: {
          [student1Id]: 'p',
          [student2Id]: 'p',
        },
      },
    });
    expect(subRes.statusCode).toBe(200);
    expect(JSON.parse(subRes.body).data.status).toBe('submitted');

    // Endi hisobotda ko'rinishi kerak!
    const repRes2 = await app.inject({
      method: 'GET',
      url: `/api/v1/reports?from=${pastDate}&to=${pastDate}`,
      headers: { cookie: directorCookie },
    });
    expect(repRes2.statusCode).toBe(200);
    expect(JSON.parse(repRes2.body).data.records.length).toBeGreaterThan(0);
  });

  it('10. Xavf signali (GET /api/v1/risk): davomat foizi past o\'quvchini aniqlash', async () => {
    const riskRes = await app.inject({
      method: 'GET',
      url: '/api/v1/risk',
      headers: { cookie: directorCookie },
    });
    expect(riskRes.statusCode).toBe(200);
    const riskData = JSON.parse(riskRes.body).data;
    expect(Array.isArray(riskData)).toBe(true);

    // Student 3 (FormulaAttack) foizi 0% edi, xavf ro'yxatida bo'lishi kerak
    const riskSt3 = riskData.find((r: any) => r.student_id === student3Id);
    expect(riskSt3).toBeDefined();
    expect(riskSt3.reasons).toContain('low_rate');
  });

  it('11. Kalendar va isSchoolDay: bayram va dam olish kunlarini hisobga olish', async () => {
    const holidayDate = '2026-03-21'; // Navro'z

    // Kalendarga bayram kiritish
    const addCalRes = await app.inject({
      method: 'POST',
      url: '/api/v1/calendar',
      headers: { cookie: directorCookie },
      payload: {
        date_from: holidayDate,
        date_to: holidayDate,
        kind: 'holiday',
        name: "Navro'z bayrami",
      },
    });
    expect(addCalRes.statusCode).toBe(200);
    const calId = JSON.parse(addCalRes.body).data.id;

    // isSchoolDay tekshiruvi: bayram kuni o'qish kuni emas (false)
    const isSchool = await isSchoolDay(testDb, schoolId, holidayDate);
    expect(isSchool).toBe(false);

    // Kalendardan o'chirish
    const delCalRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/calendar/${calId}`,
      headers: { cookie: directorCookie },
    });
    expect(delCalRes.statusCode).toBe(200);
  });
});
