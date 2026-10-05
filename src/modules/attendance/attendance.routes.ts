import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AttendanceService } from './attendance.service.js';
import { AuthService } from '../auth/auth.service.js';
import { can } from '../auth/permissions.js';
import { DbClient } from '../../db/client.js';
import { checkIdempotency, saveIdempotency } from '../../common/idempotency.js';

async function getAuth(request: FastifyRequest, db: DbClient) {
  const token = request.cookies.sessionId || request.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  return await AuthService.getUserByToken(db, token);
}

function getEffectiveSchoolId(user: any): number {
  if (user.role === 'owner') {
    if (!user.support_school_id) {
      throw new Error('Platforma egasi (owner) uchun avval yordam rejimida maktab tanlanishi shart');
    }
    return user.support_school_id;
  }
  if (!user.school_id) throw new Error('Maktab aniqlanmadi');
  return user.school_id;
}

export async function attendanceRoutes(app: FastifyInstance) {
  const db: DbClient = (app as any).db;

  // 1. GET /api/v1/attendance?date=YYYY-MM-DD
  app.get('/api/v1/attendance', async (request: FastifyRequest<{ Querystring: { date?: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    const date = request.query.date || new Date().toISOString().slice(0, 10);
    const data = await AttendanceService.getAttendanceByDate(db, schoolId, date);
    return reply.send({ status: 'ok', data });
  });

  // 2. PUT /api/v1/attendance/sessions/:slotId/:date
  app.put('/api/v1/attendance/sessions/:slotId/:date', async (
    request: FastifyRequest<{
      Params: { slotId: string; date: string };
      Body: { version?: number; records?: Record<string, 'p' | 'a' | 'l' | 'e'> };
    }>,
    reply: FastifyReply
  ) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'MARK_ATTENDANCE', { type: 'attendance', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Davomat belgilashga ruxsat yo\'q' });
    }

    const slotId = Number(request.params.slotId);
    const date = request.params.date;

    const schema = z.object({
      version: z.coerce.number().default(0),
      records: z.record(z.enum(['p', 'a', 'l', 'e'])).default({}),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.errors[0].message });

    // Idempotency-Key tekshirish
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
    if (idempotencyKey) {
      const cached = await checkIdempotency(db, idempotencyKey, schoolId, auth.user.id);
      if (cached) {
        return reply.status(cached.statusCode).send(cached.body);
      }
    }

    try {
      const result = await AttendanceService.saveSessionAttendance(
        db,
        schoolId,
        slotId,
        date,
        {
          version: parsed.data.version,
          records: parsed.data.records as Record<number, 'p' | 'a' | 'l' | 'e'>,
        },
        auth.user,
        request.ip
      );

      const respBody = { status: 'ok', data: result };

      if (idempotencyKey) {
        await saveIdempotency(db, idempotencyKey, schoolId, auth.user.id, request.url, 200, respBody);
      }

      return reply.send(respBody);
    } catch (err: any) {
      if (err.statusCode === 409) {
        return reply.status(409).send({
          error: err.message,
          current_version: err.current_version,
          records: err.current_records,
        });
      }
      return reply.status(400).send({ error: err.message });
    }
  });

  // 3. POST /api/v1/attendance/excuse
  app.post('/api/v1/attendance/excuse', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    const schema = z.object({
      student_id: z.coerce.number().int().positive('O\'quvchi ID noto\'g\'ri'),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Sana formati: YYYY-MM-DD'),
      reason: z.string().min(1, 'Sababni tanlang'),
      note: z.string().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.errors[0].message });

    // Ruxsat tekshiruvi: faqat sinf rahbari, direktor yoki admin
    if (auth.user.role === 'teacher') {
      const stRes = await db.query(
        `SELECT c.leader_teacher_id
         FROM students s
         JOIN classes c ON s.class_id = c.id AND s.school_id = c.school_id
         WHERE s.school_id = $1 AND s.id = $2`,
        [schoolId, parsed.data.student_id]
      );
      if (stRes.rows.length === 0 || stRes.rows[0].leader_teacher_id !== auth.user.teacher_id) {
        return reply.status(403).send({ error: 'Faqat sinf rahbari o\'quvchini sababli qila oladi' });
      }
    } else if (!['owner', 'director', 'admin'].includes(auth.user.role)) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    try {
      const result = await AttendanceService.createExcuse(db, schoolId, parsed.data, auth.user, request.ip);
      return reply.send({ status: 'ok', data: result });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // 4. DELETE /api/v1/attendance/excuse/:studentId/:date
  app.delete('/api/v1/attendance/excuse/:studentId/:date', async (
    request: FastifyRequest<{ Params: { studentId: string; date: string } }>,
    reply: FastifyReply
  ) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    const studentId = Number(request.params.studentId);
    const date = request.params.date;

    if (auth.user.role === 'teacher') {
      const stRes = await db.query(
        `SELECT c.leader_teacher_id
         FROM students s
         JOIN classes c ON s.class_id = c.id AND s.school_id = c.school_id
         WHERE s.school_id = $1 AND s.id = $2`,
        [schoolId, studentId]
      );
      if (stRes.rows.length === 0 || stRes.rows[0].leader_teacher_id !== auth.user.teacher_id) {
        return reply.status(403).send({ error: 'Faqat sinf rahbari sababli belgisini bekor qila oladi' });
      }
    } else if (!['owner', 'director', 'admin'].includes(auth.user.role)) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    try {
      const result = await AttendanceService.cancelExcuse(db, schoolId, studentId, date, auth.user, request.ip);
      return reply.send({ status: 'ok', data: result });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // 5. GET /api/v1/reports
  app.get('/api/v1/reports', async (request: FastifyRequest<{
    Querystring: { from?: string; to?: string; cid?: string; sid?: string; tid?: string; stid?: string };
  }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'VIEW_REPORTS', { type: 'report', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Hisobotlarni ko\'rishga ruxsat yo\'q' });
    }

    const filter = {
      from: request.query.from,
      to: request.query.to,
      cid: request.query.cid ? Number(request.query.cid) : undefined,
      sid: request.query.sid ? Number(request.query.sid) : undefined,
      tid: request.query.tid ? Number(request.query.tid) : undefined,
      stid: request.query.stid ? Number(request.query.stid) : undefined,
    };

    const report = await AttendanceService.generateReport(db, schoolId, filter, auth.user);
    return reply.send({ status: 'ok', data: report });
  });

  // 6. GET /api/v1/reports.csv
  app.get('/api/v1/reports.csv', async (request: FastifyRequest<{
    Querystring: { from?: string; to?: string; cid?: string; sid?: string; tid?: string; stid?: string };
  }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'EXPORT_DATA', { type: 'report', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ma\'lumotlarni eksport qilishga ruxsat yo\'q' });
    }

    const filter = {
      from: request.query.from,
      to: request.query.to,
      cid: request.query.cid ? Number(request.query.cid) : undefined,
      sid: request.query.sid ? Number(request.query.sid) : undefined,
      tid: request.query.tid ? Number(request.query.tid) : undefined,
      stid: request.query.stid ? Number(request.query.stid) : undefined,
    };

    const report = await AttendanceService.generateReport(db, schoolId, filter, auth.user);
    const csvContent = AttendanceService.toCsv(report);

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="davomat-${new Date().toISOString().slice(0, 10)}.csv"`);
    return reply.send(csvContent);
  });
}
