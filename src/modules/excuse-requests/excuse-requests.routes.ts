import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service.js';
import { can } from '../auth/permissions.js';
import { DbClient } from '../../db/client.js';
import { logAudit } from '../audit/audit.service.js';
import { getTodayInTashkent } from '../attendance/attendance.service.js';

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

const createExcuseRequestSchema = z.object({
  student_id: z.coerce.number().int().positive('O\'quvchi ID noto\'g\'ri'),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Sana formati: YYYY-MM-DD'),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Sana formati: YYYY-MM-DD'),
  reason: z.enum(['Kasallik', 'Oilaviy sabab', 'Tadbir / musobaqa', 'Boshqa'], {
    errorMap: () => ({ message: "Sabab: 'Kasallik', 'Oilaviy sabab', 'Tadbir / musobaqa' yoki 'Boshqa' bo'lishi kerak" }),
  }),
  note: z.string().max(500, 'Izoh 500 belgidan oshmasligi kerak').optional(),
});

const decideExcuseRequestSchema = z.object({
  action: z.enum(['approve', 'reject'], {
    errorMap: () => ({ message: "Amal faqat 'approve' yoki 'reject' bo'lishi mumkin" }),
  }),
  comment: z.string().max(500).optional(),
});

export async function excuseRequestsRoutes(app: FastifyInstance) {
  const db: DbClient = (app as any).db;

  // 1. GET /api/v1/excuse-requests — Arizalar ro'yxati
  app.get('/api/v1/excuse-requests', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });

    const schoolId = getEffectiveSchoolId(auth.user);
    if (!schoolId) return reply.status(400).send({ error: 'Maktab aniqlanmadi' });

    const user = auth.user;

    let sql = `
      SELECT er.id, er.school_id, er.student_id, er.parent_user_id,
             er.date_from, er.date_to, er.reason, er.note, er.status,
             er.reviewed_by, er.reviewed_at, er.created_at,
             st.name as student_name, c.name as class_name, c.id as class_id,
             u.full_name as parent_name, u.phone_e164 as parent_phone
      FROM excuse_requests er
      JOIN students st ON er.student_id = st.id AND er.school_id = st.school_id
      JOIN classes c ON st.class_id = c.id AND st.school_id = c.school_id
      JOIN users u ON er.parent_user_id = u.id
      WHERE er.school_id = $1
    `;
    const params: any[] = [schoolId];

    if (user.role === 'parent') {
      // Ota-ona faqat o'z arizalarini ko'radi
      params.push(user.id);
      sql += ` AND er.parent_user_id = $${params.length}`;
    } else if (user.role === 'teacher') {
      // Agar sinf rahbari bo'lsa, o'z sinfining arizalarini ko'radi
      if (user.teacher_id) {
        params.push(user.teacher_id);
        sql += ` AND c.leader_teacher_id = $${params.length}`;
      } else {
        return reply.send({ status: 'ok', data: [] });
      }
    } else if (!['owner', 'director', 'deputy_academic', 'deputy_edu', 'admin'].includes(user.role)) {
      if (!can(user, 'REVIEW_EXCUSE_REQUESTS', { type: 'report', school_id: schoolId }, { permissions: auth.permissions })) {
        return reply.status(403).send({ error: "Arizalarni ko'rishga ruxsat yo'q" });
      }
    }

    sql += ' ORDER BY er.created_at DESC';

    const res = await db.query(sql, params);
    return reply.send({ status: 'ok', data: res.rows });
  });

  // 2. POST /api/v1/excuse-requests — Ariza yuborish (Ota-ona)
  app.post('/api/v1/excuse-requests', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });

    const schoolId = getEffectiveSchoolId(auth.user);
    if (!schoolId) return reply.status(400).send({ error: 'Maktab aniqlanmadi' });

    const user = auth.user;

    const parsed = createExcuseRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.errors[0].message });
    }

    const { student_id, date_from, date_to, reason, note } = parsed.data;

    // 1. Sana mantiqi: date_from <= date_to
    if (date_from > date_to) {
      return reply.status(400).send({ error: "Boshlanish sanasi tugash sanasidan katta bo'lishi mumkin emas" });
    }

    const today = getTodayInTashkent();
    // Eng ko'pi bilan 14 kun oldinga
    const maxFuture = new Date(today);
    maxFuture.setDate(maxFuture.getDate() + 14);
    const maxFutureStr = maxFuture.toISOString().slice(0, 10);

    if (date_to > maxFutureStr) {
      return reply.status(400).send({ error: "Ariza eng ko'pi bilan 14 kun oldinga yuborilishi mumkin" });
    }

    // 2. Ota-ona tekshiruvi: faqat o'z farzandi va consent_at mavjud bo'lishi shart
    if (user.role === 'parent') {
      const relRes = await db.query(
        `SELECT id, consent_at FROM parent_students
         WHERE school_id = $1 AND parent_user_id = $2 AND student_id = $3`,
        [schoolId, user.id, student_id]
      );

      if (relRes.rows.length === 0) {
        return reply.status(403).send({ error: "Siz faqat o'z farzandingiz uchun ariza yubora olasiz" });
      }

      if (!relRes.rows[0].consent_at) {
        return reply.status(403).send({ error: "Ariza yuborish uchun avval ota-ona roziligi (consent) berilishi kerak" });
      }
    } else if (!['owner', 'director', 'deputy_academic', 'deputy_edu', 'admin'].includes(user.role)) {
      return reply.status(403).send({ error: "Ariza yuborish huquqi yo'q" });
    }

    // 3. Cheklov: kuniga farzand boshiga <= 3 ariza
    const countRes = await db.query(
      `SELECT count(*)::int as cnt FROM excuse_requests
       WHERE school_id = $1 AND student_id = $2 AND created_at::date = CURRENT_DATE`,
      [schoolId, student_id]
    );

    if (countRes.rows[0].cnt >= 3) {
      return reply.status(400).send({ error: "Kuniga bir farzand uchun ko'pi bilan 3 ta ariza yuborish mumkin" });
    }

    // 4. Ariza yaratish
    const insRes = await db.query(
      `INSERT INTO excuse_requests (school_id, student_id, parent_user_id, date_from, date_to, reason, note, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       RETURNING id, school_id, student_id, parent_user_id, date_from, date_to, reason, note, status, created_at`,
      [schoolId, student_id, user.id, date_from, date_to, reason, note || '']
    );
    const createdReq = insRes.rows[0];

    // 5. Sinf rahbarini topish va unga xabar navbatiga qo'yish
    const leaderRes = await db.query(
      `SELECT t.name as teacher_name, t.phone, st.name as student_name, c.name as class_name
       FROM students st
       JOIN classes c ON st.class_id = c.id AND st.school_id = c.school_id
       JOIN teachers t ON c.leader_teacher_id = t.id AND c.school_id = t.school_id
       WHERE st.school_id = $1 AND st.id = $2`,
      [schoolId, student_id]
    );

    if (leaderRes.rows.length > 0) {
      const leader = leaderRes.rows[0];
      const notifyText = `📩 Yangi ariza!\nO'quvchi: ${leader.student_name} (${leader.class_name})\nMuddat: ${date_from} dan ${date_to} gacha\nSabab: ${reason}\nIzoh: ${note || 'Yo\'q'}\nKo'rib chiqish: Web ilova orqali`;

      await db.query(
        `INSERT INTO outbox_messages (school_id, student_id, date, phone, text, status)
         VALUES ($1, $2, $3, $4, $5, 'queued')
         ON CONFLICT (school_id, student_id, date)
         DO UPDATE SET text = EXCLUDED.text, status = 'queued', phone = EXCLUDED.phone`,
        [schoolId, student_id, today, leader.phone, notifyText]
      );
    }

    await logAudit(db, {
      school_id: schoolId,
      user_id: user.id,
      action: 'EXCUSE_REQUEST_CREATED',
      entity: 'excuse_requests',
      entity_id: String(createdReq.id),
      details: { student_id, date_from, date_to, reason },
      ip_address: request.ip,
    });

    return reply.send({ status: 'ok', data: createdReq });
  });

  // 3. POST /api/v1/excuse-requests/:id/decide — Qaror qabul qilish (Sinf rahbari / Zavuch / Direktor)
  app.post('/api/v1/excuse-requests/:id/decide', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });

    const schoolId = getEffectiveSchoolId(auth.user);
    if (!schoolId) return reply.status(400).send({ error: 'Maktab aniqlanmadi' });

    const reqId = parseInt(request.params.id, 10);
    const user = auth.user;

    const parsed = decideExcuseRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.errors[0].message });
    }

    const { action } = parsed.data;

    // Mavjud arizani olish
    const reqRes = await db.query(
      `SELECT er.*, st.name as student_name, c.leader_teacher_id, c.name as class_name, u.phone_e164 as parent_phone
       FROM excuse_requests er
       JOIN students st ON er.student_id = st.id AND er.school_id = st.school_id
       JOIN classes c ON st.class_id = c.id AND st.school_id = c.school_id
       JOIN users u ON er.parent_user_id = u.id
       WHERE er.school_id = $1 AND er.id = $2`,
      [schoolId, reqId]
    );

    if (reqRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Ariza topilmadi' });
    }

    const excuseReq = reqRes.rows[0];

    if (excuseReq.status !== 'pending') {
      return reply.status(400).send({ error: `Ariza allaqachon ko'rib chiqilgan (${excuseReq.status})` });
    }

    // Ruxsat tekshiruvi: faqat sinf rahbari yoki REVIEW_EXCUSE_REQUESTS
    if (user.role === 'teacher') {
      if (!user.teacher_id || user.teacher_id !== excuseReq.leader_teacher_id) {
        return reply.status(403).send({ error: "Faqat shu sinf rahbari arizani ko'rib chiqa oladi" });
      }
    } else if (!['owner', 'director', 'deputy_academic', 'deputy_edu', 'admin'].includes(user.role)) {
      if (!can(user, 'REVIEW_EXCUSE_REQUESTS', { type: 'report', school_id: schoolId }, { permissions: auth.permissions })) {
        return reply.status(403).send({ error: "Arizani ko'rib chiqish huquqi yo'q" });
      }
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    const today = getTodayInTashkent();

    return await db.tx(async (tx) => {
      // 1. Statusni yangilash
      await tx.query(
        `UPDATE excuse_requests
         SET status = $1, reviewed_by = $2, reviewed_at = NOW()
         WHERE school_id = $3 AND id = $4`,
        [newStatus, user.id, schoolId, reqId]
      );

function toDateStr(d: any): string {
  if (!d) return '';
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

      // 2. Agar tasdiqlansa va sana o'tgan yoki bugun bo'lsa: mavjud 'a' larni 'e' ga aylantirish
      if (action === 'approve') {
        const fromDate = toDateStr(excuseReq.date_from);
        const reqToDate = toDateStr(excuseReq.date_to);
        const toDate = reqToDate <= today ? reqToDate : today;

        if (fromDate <= toDate) {
          // O'sha oraliqdagi barcha 'a' yozuvlarni topish
          const absentRecs = await tx.query(
            `SELECT r.session_id, s.date
             FROM attendance_records r
             JOIN attendance_sessions s ON r.session_id = s.id AND r.school_id = s.school_id
             WHERE r.school_id = $1 AND r.student_id = $2
               AND s.date >= $3 AND s.date <= $4 AND r.status = 'a'`,
            [schoolId, excuseReq.student_id, fromDate, toDate]
          );

          if (absentRecs.rows.length > 0) {
            const sessionIds = absentRecs.rows.map((r) => r.session_id);
            await tx.query(
              `UPDATE attendance_records
               SET status = 'e', updated_at = NOW()
               WHERE school_id = $1 AND student_id = $2 AND session_id = ANY($3::int[])`,
              [schoolId, excuseReq.student_id, sessionIds]
            );

            // attendance_excuses ga har bir sana bo'yicha yozish
            const datesSet = [...new Set(absentRecs.rows.map((r) => toDateStr(r.date)))];
            for (const d of datesSet) {
              const dSessionIds = absentRecs.rows.filter((r) => toDateStr(r.date) === d).map((r) => r.session_id);
              await tx.query(
                `INSERT INTO attendance_excuses (school_id, student_id, date, reason, note, created_by, session_ids, source)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (school_id, student_id, date)
                 DO UPDATE SET reason = EXCLUDED.reason, session_ids = EXCLUDED.session_ids, source = EXCLUDED.source`,
                [
                  schoolId,
                  excuseReq.student_id,
                  d,
                  excuseReq.reason,
                  excuseReq.note || 'Ariza asosida',
                  user.id,
                  JSON.stringify(dSessionIds),
                  `ariza#${reqId}`,
                ]
              );
            }
          }
        }
      }

      // 3. Ota-onaga qaror haqida bot xabari navbatga qo'yish
      if (excuseReq.parent_phone) {
        const decisionText = action === 'approve'
          ? `✅ Hurmatli ota-ona! Farzandingiz ${excuseReq.student_name} bo'yicha ${excuseReq.date_from} — ${excuseReq.date_to} sanalariga yuborilgan ariza qabul qilindi.`
          : `❌ Hurmatli ota-ona! Farzandingiz ${excuseReq.student_name} bo'yicha ${excuseReq.date_from} — ${excuseReq.date_to} sanalariga yuborilgan ariza rad etildi.`;

        await tx.query(
          `INSERT INTO outbox_messages (school_id, student_id, date, phone, text, status)
           VALUES ($1, $2, $3, $4, $5, 'queued')
           ON CONFLICT (school_id, student_id, date)
           DO UPDATE SET text = EXCLUDED.text, status = 'queued', phone = EXCLUDED.phone`,
          [schoolId, excuseReq.student_id, today, excuseReq.parent_phone, decisionText]
        );
      }

      await logAudit(tx, {
        school_id: schoolId,
        user_id: user.id,
        action: action === 'approve' ? 'EXCUSE_REQUEST_APPROVED' : 'EXCUSE_REQUEST_REJECTED',
        entity: 'excuse_requests',
        entity_id: String(reqId),
        details: { action, student_id: excuseReq.student_id },
        ip_address: request.ip,
      });

      return reply.send({
        status: 'ok',
        data: {
          id: reqId,
          status: newStatus,
          reviewed_by: user.id,
        },
      });
    }, schoolId);
  });
}
