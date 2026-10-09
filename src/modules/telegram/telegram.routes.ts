import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { TelegramService, normalizePhone } from './telegram.service.js';
import { AuthService } from '../auth/auth.service.js';
import { can } from '../auth/permissions.js';
import { DbClient } from '../../db/client.js';

async function getAuth(request: FastifyRequest, db: DbClient) {
  const token = request.cookies.sessionId || request.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  return await AuthService.getUserByToken(db, token);
}

function getEffectiveSchoolId(user: any): number {
  if (user.role === 'owner') {
    return user.support_school_id || user.school_id || 1;
  }
  if (!user.school_id) return 1;
  return user.school_id;
}

export async function telegramRoutes(app: FastifyInstance) {
  const db: DbClient = (app as any).db;

  // 1. POST /api/v1/telegram/invite — Havola yaratish (7 kun amal qiladi)
  app.post('/api/v1/telegram/invite', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'VIEW_STUDENTS', { type: 'student', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    const schema = z.object({
      student_id: z.coerce.number().int().positive(),
      phone: z.string().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.errors[0].message });

    try {
      const invite = await TelegramService.createInvite(
        db,
        schoolId,
        parsed.data.student_id,
        parsed.data.phone
      );
      return reply.send({ status: 'ok', data: invite });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // 2. GET /api/v1/telegram/contacts — Ota-ona kontaktlari holati (O'qituvchi chat_id ko'rmaydi!)
  app.get('/api/v1/telegram/contacts', async (request: FastifyRequest<{ Querystring: { student_id?: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'VIEW_STUDENTS', { type: 'student', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    let query = `
      SELECT pc.id, pc.student_id, pc.phone, pc.status, pc.consent_at, pc.created_at,
             st.name as student_name, c.name as class_name
      FROM parent_contacts pc
      JOIN students st ON pc.student_id = st.id AND pc.school_id = st.school_id
      JOIN classes c ON st.class_id = c.id AND st.school_id = c.school_id
      WHERE pc.school_id = $1
    `;
    const params: any[] = [schoolId];

    if (request.query.student_id) {
      params.push(Number(request.query.student_id));
      query += ` AND pc.student_id = $${params.length}`;
    }

    query += ' ORDER BY pc.id DESC';

    const res = await db.query(query, params);
    // Xavfsizlik: chat_id qaytarilmaydi!
    return reply.send({ status: 'ok', data: res.rows });
  });

  // 3. POST /api/v1/telegram/approve-contact/:id — Mos kelmagan telefonni admin tasdiqlashi
  app.post('/api/v1/telegram/approve-contact/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'MANAGE_SETTINGS', { type: 'settings', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Faqat administrator tasdiqlay oladi' });
    }

    try {
      const result = await TelegramService.approveContact(db, schoolId, Number(request.params.id));
      return reply.send({ status: 'ok', data: result });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // 4. POST /api/v1/telegram/queue-daily — Kunlik davomat xabarlarini navbatga qo'yish
  app.post('/api/v1/telegram/queue-daily', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'MARK_ATTENDANCE', { type: 'attendance', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    const schema = z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Sana formati: YYYY-MM-DD').optional(),
    });
    const parsed = schema.safeParse(request.body || {});
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.errors[0].message });

    const date = parsed.data.date || new Date().toISOString().slice(0, 10);

    try {
      const result = await TelegramService.queueDailyMessages(db, schoolId, date);
      return reply.send({ status: 'ok', data: result });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // 5. GET /api/v1/telegram/outbox — Navbat holatini ko'rish
  app.get('/api/v1/telegram/outbox', async (request: FastifyRequest<{ Querystring: { date?: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'VIEW_REPORTS', { type: 'report', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    let query = `
      SELECT om.id, om.student_id, om.date, om.phone, om.text, om.status, om.attempts,
             om.error_text, om.created_at, om.sent_at, st.name as student_name
      FROM outbox_messages om
      JOIN students st ON om.student_id = st.id AND om.school_id = st.school_id
      WHERE om.school_id = $1
    `;
    const params: any[] = [schoolId];

    if (request.query.date) {
      params.push(request.query.date);
      query += ` AND om.date = $${params.length}`;
    }

    query += ' ORDER BY om.id DESC LIMIT 100';

    const res = await db.query(query, params);
    return reply.send({ status: 'ok', data: res.rows });
  });

  // 6. POST /api/v1/telegram/process-outbox — Navbatdagi xabarlarni yuborish (test yoki cron orqali)
  app.post('/api/v1/telegram/process-outbox', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });

    // Mock bot or real bot
    const mockSend = async (chatId: number, text: string) => {
      // Agar real bot bo'lsa bot orqali, aks holda ok
      return { ok: true };
    };

    const res = await TelegramService.processOutbox(db, mockSend);
    return reply.send({ status: 'ok', data: res });
  });
}
