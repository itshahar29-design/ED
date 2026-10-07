import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createTestDb, DbClient } from '../src/db/client.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { AuthUser } from '../src/modules/auth/permissions.js';
import { SchoolService } from '../src/modules/school/school.service.js';
import { AttendanceService } from '../src/modules/attendance/attendance.service.js';
import { ControlCenterService } from '../src/modules/control-center/control-center.service.js';

describe('M6: Feature 6-B Nazorat markazi (Eslatma, Eskalatsiya, Xavf signali, Kunlik xulosa)', () => {
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
      '65-sonli Maktab',
      'dir_m6'
    );
    schoolId = created.school.id;

    const dirLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'dir_m6', password: created.director.tempPassword },
    });
    directorCookie = dirLogin.headers['set-cookie'] as string;

    // 2. O'quv yili, fan, sinf, o'qituvchi, o'quvchilar
    const years = await SchoolService.listYears(testDb, schoolId);
    const year = years[0];

    const teacher = await SchoolService.createTeacher(
      testDb,
      schoolId,
      'Rahimov Jamshid',
      'T-60',
      '+998905554433',
      'Fizika'
    );
    teacherId = teacher.id;

    const subject = await SchoolService.createSubject(testDb, schoolId, 'Fizika', 'FIZ', '#f76707');
    subjectId = subject.id;

    const cl = await SchoolService.createClass(testDb, schoolId, year.id, '8-B', teacherId);
    classId = cl.id;

    const s1 = await SchoolService.createStudent(testDb, schoolId, {
      name: 'Nazarov Ilhom',
      class_id: classId,
      phone: '+998901112244',
      parent_name: 'Nazarov Ota',
      parent_phone: '+998901112255',
    });
    student1Id = s1.id;

    const s2 = await SchoolService.createStudent(testDb, schoolId, {
      name: 'Qosimova Shahlo',
      class_id: classId,
      phone: '+998902223344',
      parent_name: 'Qosimov Ota',
      parent_phone: '+998902223355',
    });
    student2Id = s2.id;

    const asg = await SchoolService.createAssignment(testDb, schoolId, teacherId, subjectId, classId);
    // Dushanba kuni 1-dars (slot 0: 08:00 - 08:45)
    const slot = await SchoolService.setScheduleSlot(testDb, schoolId, asg.id, 0, 0);
    slotId = slot.id;

    // O'qituvchi foydalanuvchisi
    const dirUser: AuthUser = { id: created.director.id, school_id: schoolId, username: 'dir_m6', role: 'director' };
    const tUser = await AuthService.createUser(testDb, dirUser, {
      username: 'teacher_m6',
      role: 'teacher',
      teacher_id: teacherId,
    });
    teacherUserId = tUser.id;

    const tLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'teacher_m6', password: tUser.tempPassword },
    });
    teacherCookie = tLogin.headers['set-cookie'] as string;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (testDb) await testDb.close();
  });

  it('1. GET va PUT /api/v1/notification-settings sozlamalarni to\'g\'ri qaytarishi va yangilashi kerak', async () => {
    // GET
    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/notification-settings',
      headers: { cookie: directorCookie },
    });
    expect(getRes.statusCode).toBe(200);
    const body = JSON.parse(getRes.body);
    expect(body.status).toBe('ok');
    expect(body.data.daily_summary_time).toBe('09:30');
    expect(body.data.teacher_reminder_minutes).toBe(15);
    expect(body.data.deputy_escalation_hours).toBe(2);
    expect(body.data.enabled.teacher_reminder).toBe(true);

    // PUT
    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/v1/notification-settings',
      headers: { cookie: directorCookie },
      payload: {
        daily_summary_time: '10:00',
        teacher_reminder_minutes: 20,
      },
    });
    expect(putRes.statusCode).toBe(200);
    const updated = JSON.parse(putRes.body).data;
    expect(updated.daily_summary_time).toBe('10:00');
    expect(updated.teacher_reminder_minutes).toBe(20);

    // Qayta tiklaymiz 15 daqiqaga
    await app.inject({
      method: 'PUT',
      url: '/api/v1/notification-settings',
      headers: { cookie: directorCookie },
      payload: { daily_summary_time: '09:30', teacher_reminder_minutes: 15 },
    });
  });

  it('2. Feature 6-B.1: Dars tugaganidan 15 daqiqa keyin davomat topshirilmagan bo\'lsa o\'qituvchiga eslatma ketishi va takrorlanmasligi (dedupe) kerak', async () => {
    // Dushanba sanasi: 2026-10-05
    // 1-dars: 08:00 - 08:45. Dars tugashidan 15 daqiqa keyin: 09:00.
    // Soat 08:50 da tekshirganda hali 15 daqiqa o'tmagan -> sent: 0
    const earlyRes = await ControlCenterService.checkTeacherReminders(
      testDb,
      schoolId,
      '2026-10-05',
      '08:50'
    );
    expect(earlyRes.sent).toBe(0);

    // Soat 09:05 da tekshirganda 15 daqiqadan oshgan va davomat olinmagan -> sent: 1
    const dueRes = await ControlCenterService.checkTeacherReminders(
      testDb,
      schoolId,
      '2026-10-05',
      '09:05'
    );
    expect(dueRes.sent).toBe(1);

    // outbox_messages da xabar bo'lishi kerak
    const outbox = await testDb.query(
      `SELECT * FROM outbox_messages WHERE school_id = $1 AND text LIKE '%Eslatma%1-dars%'`,
      [schoolId]
    );
    expect(outbox.rows.length).toBe(1);
    expect(outbox.rows[0].text).toContain('Fizika');
    expect(outbox.rows[0].phone).toBe('+998905554433');

    // Takroriy tekshiruv (dedupe): aynan bir marta yuboriladi
    const repeatRes = await ControlCenterService.checkTeacherReminders(
      testDb,
      schoolId,
      '2026-10-05',
      '09:10'
    );
    expect(repeatRes.sent).toBe(0);
  });

  it('3. Feature 6-B.1: Dars tugaganidan 2 soat o\'tgach ham topshirilmagan bo\'lsa zavuchga eskalatsiya yuborilishi kerak', async () => {
    // 1-dars tugashi 08:45. 2 soat keyin: 10:45.
    // 10:30 da tekshirganda hali 2 soat bo'lmagan
    const earlyEsc = await ControlCenterService.checkDeputyEscalation(
      testDb,
      schoolId,
      '2026-10-05',
      '10:30'
    );
    expect(earlyEsc.sent).toBe(0);

    // 10:50 da tekshirganda 2 soat o'tgan -> direktor/zavuchga eskalatsiya boradi
    const escRes = await ControlCenterService.checkDeputyEscalation(
      testDb,
      schoolId,
      '2026-10-05',
      '10:50'
    );
    expect(escRes.unsubmittedCount).toBe(1);
    expect(escRes.sent).toBeGreaterThan(0);

    const outboxEsc = await testDb.query(
      `SELECT * FROM outbox_messages WHERE school_id = $1 AND text LIKE '%2 soatdan oshdi%'`,
      [schoolId]
    );
    expect(outboxEsc.rows.length).toBeGreaterThan(0);
    expect(outboxEsc.rows[0].text).toContain('Fizika (8-B) — Rahimov Jamshid');
  });

  it('4. Feature 6-B Kalendar sharti: Bayram yoki dam olish kunlarida eslatmalar va xulosalar yuborilmasligi kerak', async () => {
    // Bayram kiritamiz: 2026-10-05 sanasini bayram deb belgilaymiz
    await testDb.query(
      `INSERT INTO school_calendar (school_id, date_from, date_to, kind, name)
       VALUES ($1, '2026-10-05', '2026-10-05', 'holiday', 'Ustozlar bayrami')`,
      [schoolId]
    );

    const holidayReminder = await ControlCenterService.checkTeacherReminders(
      testDb,
      schoolId,
      '2026-10-05',
      '09:05'
    );
    expect(holidayReminder.sent).toBe(0);
    expect(holidayReminder.reason).toBe('holiday_or_weekend');

    const holidayEsc = await ControlCenterService.checkDeputyEscalation(
      testDb,
      schoolId,
      '2026-10-05',
      '11:00'
    );
    expect(holidayEsc.sent).toBe(0);
    expect(holidayEsc.reason).toBe('holiday_or_weekend');

    // Bayramni tozalaymiz
    await testDb.query('DELETE FROM school_calendar WHERE school_id = $1', [schoolId]);
  });

  it('5. Feature 6-B.2: Ketma-ket 3 dars yo\'q bo\'lgan o\'quvchi bo\'yicha xavf signali yuborilishi va 7 kun dedupe ishlashi kerak', async () => {
    // O'quvchi student1Id uchun ketma-ket 3 kun (2026-09-21, 2026-09-22, 2026-09-23) 'a' davomat yozamiz
    const authUser: AuthUser = { id: teacherUserId, school_id: schoolId, username: 'teacher_m6', role: 'teacher', teacher_id: teacherId };

    const dates = ['2026-09-21', '2026-09-22', '2026-09-23'];
    for (const d of dates) {
      await AttendanceService.submitSessionAttendance(
        testDb,
        schoolId,
        slotId,
        d,
        { records: { [student1Id]: 'a', [student2Id]: 'p' } },
        authUser
      );
    }

    // Xavf signali tekshiruvi
    const riskRes = await ControlCenterService.checkRiskAlerts(testDb, schoolId, '2026-09-23');
    expect(riskRes.riskCount).toBeGreaterThan(0);
    expect(riskRes.sent).toBeGreaterThan(0);

    // outbox_messages da xavf signali matni bo'lishi kerak
    const outboxRisk = await testDb.query(
      `SELECT * FROM outbox_messages WHERE school_id = $1 AND text LIKE '%Xavf signali%'`,
      [schoolId]
    );
    expect(outboxRisk.rows.length).toBeGreaterThan(0);
    expect(outboxRisk.rows[0].text).toContain('Nazarov Ilhom');

    // 7 kunda ko'pi bilan 1 marta dedupe tekshiruvi
    const repeatRisk = await ControlCenterService.checkRiskAlerts(testDb, schoolId, '2026-09-24');
    expect(repeatRisk.sent).toBe(0); // Qayta yuborilmadi (dedupe)
  });

  it('6. Feature 6-B.3: Kunlik xulosa belgilangan vaqtda (09:30) direktor va zavuchga yuborilishi va bir kunda bir marta bo\'lishi kerak', async () => {
    // 09:15 da vaqt yetmagan
    const earlySummary = await ControlCenterService.sendDailySummary(
      testDb,
      schoolId,
      '2026-09-23',
      '09:15'
    );
    expect(earlySummary.sent).toBe(false);
    expect(earlySummary.reason).toBe('time_not_reached');

    // 09:35 da yuboriladi
    const dueSummary = await ControlCenterService.sendDailySummary(
      testDb,
      schoolId,
      '2026-09-23',
      '09:35'
    );
    expect(dueSummary.sent).toBe(true);

    const outboxSummary = await testDb.query(
      `SELECT * FROM outbox_messages WHERE school_id = $1 AND text LIKE '%Kunlik xulosa%'`,
      [schoolId]
    );
    expect(outboxSummary.rows.length).toBeGreaterThan(0);
    expect(outboxSummary.rows[0].text).toContain('Maktab davomati');

    // O'sha kuni qayta chaqirilganda dublikat bo'lmaydi
    const repeatSummary = await ControlCenterService.sendDailySummary(
      testDb,
      schoolId,
      '2026-09-23',
      '09:40'
    );
    expect(repeatSummary.sent).toBe(false);
    expect(repeatSummary.reason).toBe('already_sent');
  });

  it('7. POST /api/v1/control-center/run-tick tizimni muvaffaqiyatli tekshirishi kerak', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/control-center/run-tick',
      headers: { cookie: directorCookie },
      payload: { date: '2026-09-23', time: '12:00' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.data.date).toBe('2026-09-23');
    expect(body.data.teacherReminders).toBeDefined();
    expect(body.data.deputyEscalation).toBeDefined();
    expect(body.data.riskAlerts).toBeDefined();
    expect(body.data.dailySummary).toBeDefined();
  });
});
