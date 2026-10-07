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

const createAccessRequestSchema = z.object({
  join_code: z.string().min(1, 'Maktab kodi kiritilishi shart'),
  note: z.string().optional().default(''),
});

const decideAccessRequestSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  position_id: z.coerce.number().optional(),
});

// Brute-force protection for join_code: 5 attempts per user per hour
const joinAttempts = new Map<number, { count: number; resetAt: number }>();

export async function accessRequestsRoutes(app: FastifyInstance) {
  const db: DbClient = (app as any).db;

  // 1. GET /api/v1/access-requests — Kutilayotgan so'rovlar ro'yxati
  app.get('/api/v1/access-requests', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: "Avtorizatsiya talab qilinadi" });

    if (!can(auth.user, 'APPROVE_ACCESS', undefined, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: "Kirish so'rovlarini ko'rish huquqi yo'q" });
    }

    const schoolId = getEffectiveSchoolId(auth.user);
    if (!schoolId) {
      return reply.status(400).send({ error: "Maktab aniqlanmadi" });
    }

    const res = await db.query(
      `SELECT ar.id, ar.school_id, ar.user_id, ar.note, ar.status, ar.created_at, ar.decided_at,
              u.full_name, u.phone_e164, u.username
       FROM access_requests ar
       JOIN users u ON ar.user_id = u.id
       WHERE ar.school_id = $1 AND ar.status = 'pending'
       ORDER BY ar.created_at ASC`,
      [schoolId]
    );

    return reply.send({ status: 'ok', data: res.rows });
  });

  // 2. POST /api/v1/access-requests — Maktab kodi (join_code) orqali so'rov yuborish
  app.post('/api/v1/access-requests', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: "Avtorizatsiya talab qilinadi" });

    const userId = auth.user.id;
    const now = Date.now();
    const entry = joinAttempts.get(userId);

    if (entry && entry.resetAt > now) {
      if (entry.count >= 5) {
        return reply.status(429).send({
          error: "Juda ko'p xato urinishlar. Iltimos 1 soatdan so'ng qayta urinib ko'ring (himoya)",
        });
      }
    }

    const parsed = createAccessRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.errors[0].message });
    }

    const { join_code, note } = parsed.data;

    // Maktabni join_code bo'yicha qidirish
    const schoolRes = await db.query(
      'SELECT id, name FROM schools WHERE join_code = $1 OR code = $1 LIMIT 1',
      [join_code.trim()]
    );

    if (schoolRes.rows.length === 0) {
      // Brute-force count oshirish
      if (entry && entry.resetAt > now) {
        entry.count++;
      } else {
        joinAttempts.set(userId, { count: 1, resetAt: now + 3600_000 });
      }
      return reply.status(404).send({ error: "Bunday kodli maktab topilmadi" });
    }

    const school = schoolRes.rows[0];

    // Allaqachon a'zolik bormi?
    const existingMem = await db.query(
      'SELECT id FROM memberships WHERE user_id = $1 AND school_id = $2',
      [userId, school.id]
    );
    if (existingMem.rows.length > 0) {
      return reply.status(400).send({ error: "Siz allaqachon ushbu maktabga ulangansiz" });
    }

    // Allaqachon kutilayotgan so'rov bormi?
    const existingReq = await db.query(
      "SELECT id FROM access_requests WHERE user_id = $1 AND school_id = $2 AND status = 'pending'",
      [userId, school.id]
    );
    if (existingReq.rows.length > 0) {
      return reply.status(400).send({ error: "Ushbu maktab uchun so'rovingiz allaqachon ko'rib chiqilmoqda" });
    }

    const insRes = await db.query(
      `INSERT INTO access_requests (school_id, user_id, note, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING id, school_id, user_id, status, created_at`,
      [school.id, userId, note]
    );

    return reply.send({
      status: 'ok',
      message: `«${school.name}» ma'muriyatiga so'rov yuborildi. Tasdiqlanishini kuting.`,
      data: insRes.rows[0],
    });
  });

  // 3. POST /api/v1/access-requests/:id/decide — So'rovni tasdiqlash yoki rad etish
  app.post('/api/v1/access-requests/:id/decide', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: "Avtorizatsiya talab qilinadi" });

    if (!can(auth.user, 'APPROVE_ACCESS', undefined, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: "Kirish so'rovini tasdiqlash huquqi yo'q" });
    }

    const reqId = parseInt(request.params.id, 10);
    const reqRes = await db.query(
      'SELECT * FROM access_requests WHERE id = $1',
      [reqId]
    );
    if (reqRes.rows.length === 0) {
      return reply.status(404).send({ error: "So'rov topilmadi" });
    }

    const accessReq = reqRes.rows[0];

    const parsed = decideAccessRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.errors[0].message });
    }

    const { status, position_id } = parsed.data;

    if (status === 'approved') {
      if (!position_id) {
        return reply.status(400).send({ error: "Tasdiqlash uchun lavozim (position_id) tanlanishi shart" });
      }

      // Lavozim maktabga tegishliligini tekshirish
      const posRes = await db.query(
        'SELECT id, key, rank FROM positions WHERE id = $1 AND (school_id = $2 OR school_id IS NULL)',
        [position_id, accessReq.school_id]
      );
      if (posRes.rows.length === 0) {
        return reply.status(400).send({ error: "Tanlangan lavozim mavjud emas" });
      }

      // Membership yaratish
      await db.query(
        `INSERT INTO memberships (user_id, school_id, position_id, status)
         VALUES ($1, $2, $3, 'active')`,
        [accessReq.user_id, accessReq.school_id, position_id]
      );
    }

    await db.query(
      `UPDATE access_requests
       SET status = $1, decided_by = $2, decided_at = NOW()
       WHERE id = $3`,
      [status, auth.user.id, reqId]
    );

    return reply.send({
      status: 'ok',
      message: status === 'approved' ? "So'rov tasdiqlandi va a'zolik berildi" : "So'rov rad etildi",
    });
  });
}
