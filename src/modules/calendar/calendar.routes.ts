import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service.js';
import { can } from '../auth/permissions.js';
import { DbClient } from '../../db/client.js';

async function getAuth(request: FastifyRequest, db: DbClient) {
  const token = request.cookies.sessionId || request.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  return await AuthService.getUserByToken(db, token);
}

function getEffectiveSchoolId(user: any): number | null {
  if (user.role === 'owner') {
    return user.support_school_id || null;
  }
  return user.school_id || null;
}

const createCalendarSchema = z.object({
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Sana formati: YYYY-MM-DD'),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Sana formati: YYYY-MM-DD'),
  kind: z.enum(['holiday', 'break', 'no_lessons']).default('holiday'),
  name: z.string().min(1, 'Tadbir/Bayram nomini kiriting'),
});

export async function isSchoolDay(db: DbClient, schoolId: number, dateStr: string): Promise<boolean> {
  // 1. Kalendar tekshiruvi: bayram yoki ta'til bormi?
  const calRes = await db.query(
    `SELECT id, name, kind FROM school_calendar
     WHERE school_id = $1 AND date_from <= $2 AND date_to >= $2`,
    [schoolId, dateStr]
  );
  if (calRes.rows.length > 0) {
    return false; // Bayram yoki ta'til kuni
  }

  // 2. Maktab o'qish kunlari tekshiruvi (school_settings.days)
  const d = new Date(dateStr + 'T12:00:00Z');
  const dayOfWeek = (d.getUTCDay() + 6) % 7; // 0=Mon, 6=Sun

  const sRes = await db.query('SELECT days FROM school_settings WHERE school_id = $1', [schoolId]);
  if (sRes.rows.length > 0) {
    const days: number[] = sRes.rows[0].days || [0, 1, 2, 3, 4];
    if (!days.includes(dayOfWeek)) {
      return false; // Dam olish kuni
    }
  }

  return true;
}

export async function calendarRoutes(app: FastifyInstance) {
  const db: DbClient = (app as any).db;

  // 1. GET /api/v1/calendar — Maktab kalendari
  app.get('/api/v1/calendar', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: "Avtorizatsiya talab qilinadi" });

    const schoolId = getEffectiveSchoolId(auth.user);
    if (!schoolId) return reply.status(400).send({ error: "Maktab aniqlanmadi" });

    const res = await db.query(
      `SELECT id, school_id, date_from, date_to, kind, name, created_at
       FROM school_calendar
       WHERE school_id = $1
       ORDER BY date_from ASC`,
      [schoolId]
    );

    return reply.send({ status: 'ok', data: res.rows });
  });

  // 2. POST /api/v1/calendar — Kalendarga sana qo'shish (MANAGE_CALENDAR)
  app.post('/api/v1/calendar', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: "Avtorizatsiya talab qilinadi" });

    if (!can(auth.user, 'MANAGE_CALENDAR', undefined, { permissions: auth.permissions }) &&
        !['owner', 'director', 'deputy_academic'].includes(auth.user.role)) {
      return reply.status(403).send({ error: "Kalendarni boshqarish huquqi yo'q" });
    }

    const schoolId = getEffectiveSchoolId(auth.user);
    if (!schoolId) return reply.status(400).send({ error: "Maktab aniqlanmadi" });

    const parsed = createCalendarSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.errors[0].message });
    }

    const { date_from, date_to, kind, name } = parsed.data;
    if (date_from > date_to) {
      return reply.status(400).send({ error: "Boshlanish sanasi tugash sanasidan katta bo'lishi mumkin emas" });
    }

    const insRes = await db.query(
      `INSERT INTO school_calendar (school_id, date_from, date_to, kind, name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, school_id, date_from, date_to, kind, name, created_at`,
      [schoolId, date_from, date_to, kind, name]
    );

    return reply.send({ status: 'ok', data: insRes.rows[0] });
  });

  // 3. DELETE /api/v1/calendar/:id
  app.delete('/api/v1/calendar/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: "Avtorizatsiya talab qilinadi" });

    if (!can(auth.user, 'MANAGE_CALENDAR', undefined, { permissions: auth.permissions }) &&
        !['owner', 'director', 'deputy_academic'].includes(auth.user.role)) {
      return reply.status(403).send({ error: "Kalendarni boshqarish huquqi yo'q" });
    }

    const schoolId = getEffectiveSchoolId(auth.user);
    const calId = parseInt(request.params.id, 10);

    await db.query(
      'DELETE FROM school_calendar WHERE id = $1 AND school_id = $2',
      [calId, schoolId]
    );

    return reply.send({ status: 'ok', message: "Kalendar yozuvi o'chirildi" });
  });
}
