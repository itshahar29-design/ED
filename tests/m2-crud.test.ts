import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createTestDb, DbClient } from '../src/db/client.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { AuthUser } from '../src/modules/auth/permissions.js';
import { hashSessionToken } from '../src/modules/auth/crypto.js';

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

  it('8. Preset lavozimlar (GET /api/v1/positions): Maktab uchun barcha preset lavozimlar ro\'yxati qaytishi kerak', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/positions',
      headers: { cookie: directorCookie },
    });
    expect(res.statusCode).toBe(200);
    const positions = JSON.parse(res.body).data;
    expect(positions.length).toBeGreaterThanOrEqual(12);

    const keys = positions.map((p: any) => p.key);
    expect(keys).toContain('director');
    expect(keys).toContain('teacher');
    expect(keys).toContain('deputy_academic');
    expect(keys).toContain('deputy_edu');
    expect(keys).toContain('nurse');
    expect(keys).toContain('psychologist');
    expect(keys).toContain('student');
    expect(keys).toContain('parent');
  });

  it('9. Maxsus lavozim yaratish (POST /api/v1/positions) va privilege escalation dan himoya', async () => {
    // A. O'zida yo'q ruxsatni berishga urinish rad etilishi kerak
    const invalidRes = await app.inject({
      method: 'POST',
      url: '/api/v1/positions',
      headers: { cookie: directorCookie },
      payload: {
        key: 'super_admin_fake',
        name_uz: 'Soxta Super Admin',
        base_key: 'admin',
        scope: 'school',
        permissions: ['MANAGE_PLATFORM'], // Direktor platforma boshqaruviga ega emas
      },
    });
    expect(invalidRes.statusCode).toBe(403);
    expect(JSON.parse(invalidRes.body).error).toContain('privilege escalation');

    // B. Muvaffaqiyatli maxsus lavozim yaratish
    const validRes = await app.inject({
      method: 'POST',
      url: '/api/v1/positions',
      headers: { cookie: directorCookie },
      payload: {
        key: 'tutor',
        name_uz: 'Tyutor / Murabbiy',
        base_key: 'teacher',
        scope: 'own_classes',
        permissions: ['VIEW_STUDENTS', 'VIEW_REPORTS'],
      },
    });
    expect(validRes.statusCode).toBe(200);
    const created = JSON.parse(validRes.body).data;
    expect(created.key).toBe('tutor');
    expect(created.name_uz).toBe('Tyutor / Murabbiy');
    expect(created.permissions).toContain('VIEW_STUDENTS');
  });

  it('10. Lavozim ruxsatlarini olish va yangilash (GET & PUT /api/v1/positions/:id/permissions)', async () => {
    // Tyutor lavozimini topamiz
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/positions',
      headers: { cookie: directorCookie },
    });
    const positions = JSON.parse(listRes.body).data;
    const tutorPos = positions.find((p: any) => p.key === 'tutor');
    expect(tutorPos).toBeDefined();

    // Ruxsatlarni olish
    const getPermsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/positions/${tutorPos.id}/permissions`,
      headers: { cookie: directorCookie },
    });
    expect(getPermsRes.statusCode).toBe(200);

    // Ruxsatlarni yangilash
    const updateRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/positions/${tutorPos.id}/permissions`,
      headers: { cookie: directorCookie },
      payload: { permissions: ['VIEW_STUDENTS', 'VIEW_REPORTS', 'EXPORT_DATA'] },
    });
    expect(updateRes.statusCode).toBe(200);

    // Direktordan MANAGE_USERS ni olib tashlash taqiqlanishi kerak
    const dirPos = positions.find((p: any) => p.key === 'director');
    const demoteDirRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/positions/${dirPos.id}/permissions`,
      headers: { cookie: directorCookie },
      payload: { permissions: ['VIEW_STUDENTS'] },
    });
    expect(demoteDirRes.statusCode).toBe(400);
    expect(JSON.parse(demoteDirRes.body).error).toContain('MANAGE_USERS');
  });

  it('11. Foydalanuvchilar ro\'yxati (GET /api/v1/users) va xodim taklif qilish (POST /api/v1/users/invite)', async () => {
    // Tyutor lavozimi ID sini olamiz
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/positions',
      headers: { cookie: directorCookie },
    });
    const tutorPos = JSON.parse(listRes.body).data.find((p: any) => p.key === 'tutor');

    // Xodim taklif qilish
    const inviteRes = await app.inject({
      method: 'POST',
      url: '/api/v1/users/invite',
      headers: { cookie: directorCookie },
      payload: {
        phone: '+998901239988',
        position_id: tutorPos.id,
        full_name: 'Bobur Murabbiy',
      },
    });
    expect(inviteRes.statusCode).toBe(200);
    const inviteData = JSON.parse(inviteRes.body);
    expect(inviteData.invite_link).toContain('t.me/EduMemoryBot?start=inv_');

    // Ro'yxatda taklif etilgan xodim ko'rinishi va telegram_status pending bo'lishi kerak
    const usersRes = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { cookie: directorCookie },
    });
    expect(usersRes.statusCode).toBe(200);
    const users = JSON.parse(usersRes.body).data;
    const invitedUser = users.find((u: any) => u.phone_e164 === '+998901239988');
    expect(invitedUser).toBeDefined();
    expect(invitedUser.telegram_status).toBe('pending');
  });

  it('12. Kirish so\'rovlari (access-requests): join_code orqali so\'rov va direktor tasdig\'i', async () => {
    // Maktabga join_code beramiz
    await testDb.query("UPDATE schools SET join_code = 'PM_JOIN_2026' WHERE id = $1", [schoolId]);

    // Yangi foydalanuvchi tizimga kiradi
    const userRes = await testDb.query(
      "INSERT INTO users (username, phone_e164, full_name, status) VALUES ($1, $2, $3, 'pending') RETURNING id",
      ['+998903332211', '+998903332211', 'Sorovchi Ota-ona']
    );
    const requesterId = userRes.rows[0].id;

    // Sessiya yaratamiz
    const token = 'requester_test_token_123';
    const tokenHash = hashSessionToken(token);
    await testDb.query(
      "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL '1 day')",
      [tokenHash, requesterId, tokenHash]
    );

    // Foydalanuvchi join_code bilan kirish so'rovi yuboradi
    const reqRes = await app.inject({
      method: 'POST',
      url: '/api/v1/access-requests',
      headers: { authorization: `Bearer ${token}` },
      payload: { join_code: 'PM_JOIN_2026', note: 'Farzandim 5-A da o\'qiydi' },
    });
    expect(reqRes.statusCode).toBe(200);
    const reqData = JSON.parse(reqRes.body).data;

    // Direktor kutilayotgan so'rovlarni ko'radi
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/access-requests',
      headers: { cookie: directorCookie },
    });
    expect(listRes.statusCode).toBe(200);
    const pendingList = JSON.parse(listRes.body).data;
    expect(pendingList.some((r: any) => r.id === reqData.id)).toBe(true);

    // Direktor so'rovni tasdiqlaydi (parent lavozimi beradi)
    const posRes = await app.inject({
      method: 'GET',
      url: '/api/v1/positions',
      headers: { cookie: directorCookie },
    });
    const parentPos = JSON.parse(posRes.body).data.find((p: any) => p.key === 'parent');

    const decideRes = await app.inject({
      method: 'POST',
      url: `/api/v1/access-requests/${reqData.id}/decide`,
      headers: { cookie: directorCookie },
      payload: { status: 'approved', position_id: parentPos.id },
    });
    expect(decideRes.statusCode).toBe(200);

    // Foydalanuvchiga a'zolik berilganligini tekshirish
    const memRes = await testDb.query(
      'SELECT * FROM memberships WHERE user_id = $1 AND school_id = $2',
      [requesterId, schoolId]
    );
    expect(memRes.rows.length).toBe(1);
    expect(memRes.rows[0].position_id).toBe(parentPos.id);
  });

  it('13. Foydalanuvchini to\'xtatish (suspend) va sessiyalarni bekor qilish', async () => {
    // Foydalanuvchini topamiz
    const usersRes = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { cookie: directorCookie },
    });
    const userToSuspend = JSON.parse(usersRes.body).data.find((u: any) => u.phone_e164 === '+998901239988');
    expect(userToSuspend).toBeDefined();

    // To'xtatish
    const suspRes = await app.inject({
      method: 'POST',
      url: `/api/v1/users/${userToSuspend.id}/suspend`,
      headers: { cookie: directorCookie },
    });
    expect(suspRes.statusCode).toBe(200);

    // Baza holati: membership suspended
    const mRes = await testDb.query(
      'SELECT status FROM memberships WHERE user_id = $1 AND school_id = $2',
      [userToSuspend.id, schoolId]
    );
    expect(mRes.rows[0].status).toBe('suspended');
  });

  it('14. Ruxsat va rol xavfsizligi: Begona maktab yoki direktorni pasaytirish taqiqlanadi', async () => {
    // Direktor o'zini o'zi yoki o'zidan yuqori lavozimni pasaytira olmaydi
    const dirUserRes = await testDb.query("SELECT id FROM users WHERE username = 'pm_director'");
    const dirId = dirUserRes.rows[0].id;

    const teacherPos = (await testDb.query("SELECT id FROM positions WHERE school_id = $1 AND key = 'teacher'", [schoolId])).rows[0];

    // Direktorni o'qituvchiga pasaytirishga urinish
    const demoteRes = await app.inject({
      method: 'POST',
      url: `/api/v1/users/${dirId}/position`,
      headers: { cookie: directorCookie },
      payload: { position_id: teacherPos.id },
    });
    // O'zidan yuqori yoki teng darajadagi direktorni boshqarish taqiqlanadi
    expect(demoteRes.statusCode).toBe(403);
  });
});
