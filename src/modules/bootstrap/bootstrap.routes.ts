import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { BootstrapService } from './bootstrap.service.js';
import { AuthService } from '../auth/auth.service.js';
import { can, ALL_PERMISSIONS } from '../auth/permissions.js';
import crypto from 'crypto';
import { DbClient } from '../../db/client.js';
import { normalizePhone } from '../auth/telegram.validator.js';
import { seedXatirchiSchool } from '../school/xatirchi.seed.js';
import { hashPassword, generateTempPassword, hashSessionToken } from '../auth/crypto.js';
import { logAudit } from '../audit/audit.service.js';

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

export async function bootstrapRoutes(app: FastifyInstance) {
  const db: DbClient = (app as any).db;

  // 1. GET /api/v1/bootstrap
  app.get('/api/v1/bootstrap', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) {
      return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    }

    let schoolId: number;
    if (auth.user.role === 'owner') {
      if (auth.user.support_school_id) {
        schoolId = auth.user.support_school_id;
      } else {
        // Owner hali maktab tanlamagan bo'lsa, birinchi maktabni olamiz
        const firstSchool = await db.query('SELECT id FROM schools ORDER BY id ASC LIMIT 1');
        schoolId = firstSchool.rows[0]?.id || 1;
      }
    } else {
      schoolId = auth.user.school_id || 1;
    }

    const data = await BootstrapService.getBootstrapData(db, schoolId, auth.user);
    return reply.send({ status: 'ok', data });
  });

  // 2. POST /api/v1/import
  app.post('/api/v1/import', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'MANAGE_SETTINGS', { type: 'settings', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ma\'lumotlarni import qilishga ruxsat yo\'q' });
    }

    try {
      const result = await BootstrapService.importData(db, schoolId, request.body);
      return reply.send({ status: 'ok', data: result });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // 3. GET /api/v1/export
  app.get('/api/v1/export', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'EXPORT_DATA', { type: 'settings', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Eksport qilishga ruxsat yo\'q' });
    }

    const data = await BootstrapService.getBootstrapData(db, schoolId, auth.user);
    reply.header('Content-Type', 'application/json');
    reply.header('Content-Disposition', `attachment; filename="edumemory-zaxira-${new Date().toISOString().slice(0, 10)}.json"`);
    return reply.send(data);
  });

  // 4. GET & PUT /api/v1/settings
  app.get('/api/v1/settings', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    const sRes = await db.query('SELECT * FROM school_settings WHERE school_id = $1', [schoolId]);
    return reply.send({ status: 'ok', data: sRes.rows[0] });
  });

  app.put('/api/v1/settings', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'MANAGE_SETTINGS', { type: 'settings', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Sozlamalarni o\'zgartirishga ruxsat yo\'q' });
    }

    const schema = z.object({
      name: z.string().min(1, 'Maktab nomini kiriting'),
      addr: z.string().optional(),
      phone: z.string().optional(),
      logo: z.string().optional(),
      days: z.array(z.number()).optional(),
      times: z.array(z.string()).optional(),
      tg_send_mode: z.enum(['per_lesson', 'end_of_day']).optional(),
      tg_send_time: z.string().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.errors[0].message });

    const d = parsed.data;
    const upd = await db.query(
      `UPDATE school_settings
       SET name = $1,
           addr = COALESCE($2, addr),
           phone = COALESCE($3, phone),
           logo = COALESCE($4, logo),
           days = COALESCE($5, days),
           times = COALESCE($6, times),
           tg_send_mode = COALESCE($7, tg_send_mode),
           tg_send_time = COALESCE($8, tg_send_time),
           updated_at = NOW()
       WHERE school_id = $9
       RETURNING *`,
      [
        d.name,
        d.addr,
        d.phone,
        d.logo,
        d.days ? JSON.stringify(d.days) : null,
        d.times ? JSON.stringify(d.times) : null,
        d.tg_send_mode,
        d.tg_send_time,
        schoolId,
      ]
    );

    return reply.send({ status: 'ok', data: upd.rows[0] });
  });

  // 5. GET & PUT /api/v1/permissions
  app.get('/api/v1/permissions', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    const res = await db.query('SELECT role, permission FROM role_permissions WHERE school_id = $1', [schoolId]);
    return reply.send({ status: 'ok', data: res.rows });
  });

  app.put('/api/v1/permissions', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'MANAGE_SETTINGS', { type: 'settings', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ruxsatlarni o\'zgartirishga huquq yo\'q' });
    }

    const schema = z.object({
      role: z.enum(['director', 'admin', 'teacher', 'student']),
      permission: z.string(),
      enabled: z.boolean(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.errors[0].message });

    const { role, permission, enabled } = parsed.data;

    if (enabled) {
      await db.query(
        `INSERT INTO role_permissions (school_id, role, permission)
         VALUES ($1, $2, $3)
         ON CONFLICT (school_id, role, permission) DO NOTHING`,
        [schoolId, role, permission]
      );
    } else {
      await db.query(
        'DELETE FROM role_permissions WHERE school_id = $1 AND role = $2 AND permission = $3',
        [schoolId, role, permission]
      );
    }

    return reply.send({ status: 'ok', message: 'Ruxsat yangilandi' });
  });

  // 6. GET /api/v1/audit (Faqat o'qish)
  app.get('/api/v1/audit', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!['owner', 'director', 'admin'].includes(auth.user.role)) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    const res = await db.query(
      `SELECT a.id, a.created_at, a.action, a.entity, a.entity_id, a.details, a.ip_address, u.username
       FROM audit_log a
       LEFT JOIN users u ON a.user_id = u.id
       WHERE a.school_id = $1 OR a.school_id IS NULL
       ORDER BY a.id DESC LIMIT 100`,
      [schoolId]
    );

    return reply.send({ status: 'ok', data: res.rows });
  });

  // 7. Foydalanuvchilar boshqaruvi (Users - EduMemory 3.0 MAX)
  app.get('/api/v1/users', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: "Avtorizatsiya talab qilinadi" });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'MANAGE_USERS', undefined, { permissions: auth.permissions }) &&
        !['owner', 'director', 'admin'].includes(auth.user.role)) {
      return reply.status(403).send({ error: "Foydalanuvchilarni ko'rish huquqi yo'q" });
    }

    const hasViewContacts = can(auth.user, 'VIEW_CONTACTS', undefined, { permissions: auth.permissions }) ||
      ['owner', 'director'].includes(auth.user.role);

    const res = await db.query(
      `SELECT u.id, u.username, u.role, u.phone_e164, u.full_name, u.status as user_status,
              u.teacher_id, u.student_id, u.must_change_password, u.locked_until, u.created_at,
              m.id as membership_id, m.status as membership_status,
              p.id as position_id, p.key as position_key, p.name_uz as position_name, p.rank,
              ti.telegram_id, ti.phone_verified_at,
              t.name as teacher_name, st.name as student_name
       FROM users u
       LEFT JOIN memberships m ON m.user_id = u.id AND (m.school_id = $1 OR m.school_id IS NULL)
       LEFT JOIN positions p ON m.position_id = p.id
       LEFT JOIN telegram_identities ti ON ti.user_id = u.id AND ti.unbound_at IS NULL
       LEFT JOIN teachers t ON u.teacher_id = t.id AND u.school_id = t.school_id
       LEFT JOIN students st ON u.student_id = st.id AND u.school_id = st.school_id
       WHERE u.school_id = $1 OR m.school_id = $1
       ORDER BY u.id ASC`,
      [schoolId]
    );

    const rows = res.rows.map((row: any) => {
      // Telegram status hisoblash
      let telegram_status: 'connected' | 'pending' | 'disconnected' = 'disconnected';
      if (row.phone_verified_at) {
        telegram_status = 'connected';
      } else if (row.membership_status === 'invited' || row.user_status === 'pending') {
        telegram_status = 'pending';
      }

      // Telefon raqamni maskalash (Section 5.3 VIEW_CONTACTS ruxsati bo'lmasa)
      let phone = row.phone_e164 || row.username || '';
      if (!hasViewContacts && phone) {
        const digits = phone.replace(/\D/g, '');
        if (digits.length >= 9) {
          const start = digits.slice(0, 5);
          const end = digits.slice(-2);
          phone = `+${start.slice(0, 3)} ${start.slice(3, 5)} *** ** ${end}`;
        } else {
          phone = '***';
        }
      }

      return {
        ...row,
        phone,
        telegram_status,
      };
    });

    return reply.send({ status: 'ok', data: rows });
  });

  // Taklif yuborish (Xodim taklifi: raqam + lavozim)
  app.post('/api/v1/users/invite', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: "Avtorizatsiya talab qilinadi" });

    if (!can(auth.user, 'MANAGE_USERS', undefined, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: "Foydalanuvchi taklif qilish huquqi yo'q" });
    }

    const schoolId = getEffectiveSchoolId(auth.user);
    if (!schoolId) return reply.status(400).send({ error: "Maktab aniqlanmadi" });

    const schema = z.object({
      phone: z.string().min(5, 'Telefon raqamni kiriting'),
      position_id: z.coerce.number().int().positive('Lavozim tanlanishi shart'),
      full_name: z.string().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.errors[0].message });

    const normPhone = normalizePhone(parsed.data.phone);

    // Lavozim tekshiruvi (Section 5.5: o'zidan yuqori lavozim berilmaydi)
    const posRes = await db.query('SELECT id, key, rank FROM positions WHERE id = $1', [parsed.data.position_id]);
    if (posRes.rows.length === 0) return reply.status(404).send({ error: "Lavozim topilmadi" });
    const targetPos = posRes.rows[0];

    const myRank = auth.user.rank || 10;
    if (targetPos.rank < myRank) {
      return reply.status(403).send({ error: "O'zingizdan yuqori darajali lavozim bera olmaysiz" });
    }

    // Foydalanuvchini topish yoki yaratish
    let userRes = await db.query('SELECT id FROM users WHERE phone_e164 = $1 LIMIT 1', [normPhone]);
    let userId: number;
    if (userRes.rows.length > 0) {
      userId = userRes.rows[0].id;
    } else {
      const insU = await db.query(
        `INSERT INTO users (school_id, username, phone_e164, full_name, role, status)
         VALUES ($1, $2, $2, $3, $4, 'pending')
         RETURNING id`,
        [schoolId, normPhone, parsed.data.full_name || 'Yangi xodim', targetPos.key]
      );
      userId = insU.rows[0].id;
    }

    // Taklif kodi (bir martalik, 7 kun)
    const rawCode = crypto.randomBytes(16).toString('hex');
    const codeHash = crypto.createHash('sha256').update(rawCode).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const mRes = await db.query(
      `INSERT INTO memberships (user_id, school_id, position_id, status, invited_phone, invited_by, invite_code_hash, invite_expires_at)
       VALUES ($1, $2, $3, 'invited', $4, $5, $6, $7)
       RETURNING id`,
      [userId, schoolId, targetPos.id, normPhone, auth.user.id, codeHash, expiresAt.toISOString()]
    );

    const inviteLink = `https://t.me/EduMemoryBot?start=inv_${rawCode}`;
    return reply.send({
      status: 'ok',
      message: "Taklif muvaffaqiyatli yaratildi",
      membership_id: mRes.rows[0].id,
      invite_link: inviteLink,
      expires_at: expiresAt.toISOString(),
    });
  });

  // Lavozimni almashtirish (POST /api/v1/users/:id/position)
  app.post('/api/v1/users/:id/position', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: "Avtorizatsiya talab qilinadi" });

    if (!can(auth.user, 'MANAGE_USERS', undefined, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: "Lavozim almashtirish huquqi yo'q" });
    }

    const schoolId = getEffectiveSchoolId(auth.user);
    const targetUserId = parseInt(request.params.id, 10);

    const schema = z.object({
      position_id: z.coerce.number().int().positive('Yangi lavozim tanlanishi shart'),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.errors[0].message });

    // Target user tekshiruvi: oxirgi director yoki owner pasaytirilmaydi
    const targetUserRes = await db.query('SELECT id, role FROM users WHERE id = $1', [targetUserId]);
    if (targetUserRes.rows.length === 0) return reply.status(404).send({ error: "Foydalanuvchi topilmadi" });
    const targetUser = targetUserRes.rows[0];

    if (targetUser.role === 'owner') {
      return reply.status(403).send({ error: "Owner lavozimini o'zgartirish taqiqlanadi" });
    }

    const posRes = await db.query('SELECT id, key, rank FROM positions WHERE id = $1', [parsed.data.position_id]);
    if (posRes.rows.length === 0) return reply.status(404).send({ error: "Lavozim topilmadi" });
    const targetPos = posRes.rows[0];

    // Section 5.5: Oxirgi director pasaytirilmaydi
    if (targetUser.role === 'director' && targetPos.key !== 'director') {
      const dirCount = await db.query(
        "SELECT COUNT(*) as count FROM users WHERE school_id = $1 AND role = 'director'",
        [schoolId]
      );
      if (parseInt(dirCount.rows[0].count, 10) <= 1) {
        return reply.status(403).send({ error: "Maktabning yagona direktorini pasaytirish taqiqlanadi" });
      }
    }

    const myRank = auth.user.rank || 10;
    if (targetPos.rank < myRank) {
      return reply.status(403).send({ error: "O'zingizdan yuqori darajali lavozim bera olmaysiz" });
    }

    // Yangilash
    await db.query(
      'UPDATE memberships SET position_id = $1 WHERE user_id = $2 AND school_id = $3',
      [targetPos.id, targetUserId, schoolId]
    );
    await db.query('UPDATE users SET role = $1 WHERE id = $2', [targetPos.key, targetUserId]);

    // Sessiyalarni bekor qilish (yangilangan lavozim kuchga kirishi uchun)
    await db.query('DELETE FROM sessions WHERE user_id = $1', [targetUserId]);

    return reply.send({ status: 'ok', message: "Lavozim yangilandi va sessiyalar qayta tiklashga tayyorlandi" });
  });

  // Foydalanuvchini to'xtatish (suspend)
  app.post('/api/v1/users/:id/suspend', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: "Avtorizatsiya talab qilinadi" });

    if (!can(auth.user, 'MANAGE_USERS', undefined, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: "Foydalanuvchini to'xtatish huquqi yo'q" });
    }

    const schoolId = getEffectiveSchoolId(auth.user);
    const targetUserId = parseInt(request.params.id, 10);

    const targetUserRes = await db.query('SELECT id, role FROM users WHERE id = $1', [targetUserId]);
    if (targetUserRes.rows.length === 0) return reply.status(404).send({ error: "Foydalanuvchi topilmadi" });

    if (targetUserRes.rows[0].role === 'owner') {
      return reply.status(403).send({ error: "Platforma egasini to'xtatish taqiqlanadi" });
    }

    await db.query(
      "UPDATE memberships SET status = 'suspended' WHERE user_id = $1 AND school_id = $2",
      [targetUserId, schoolId]
    );
    await db.query('DELETE FROM sessions WHERE user_id = $1', [targetUserId]);

    return reply.send({ status: 'ok', message: "Foydalanuvchi hisobi to'xtatildi va faol sessiyalar bekor qilindi" });
  });

  // Admin tomonidan Telegramni uzish
  app.delete('/api/v1/users/:id/telegram', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: "Avtorizatsiya talab qilinadi" });

    if (!can(auth.user, 'MANAGE_USERS', undefined, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: "Telegramni uzish huquqi yo'q" });
    }

    const targetUserId = parseInt(request.params.id, 10);
    await db.query(
      'UPDATE telegram_identities SET unbound_at = NOW(), user_id = NULL WHERE user_id = $1',
      [targetUserId]
    );
    await db.query('DELETE FROM sessions WHERE user_id = $1', [targetUserId]);

    return reply.send({ status: 'ok', message: "Telegram profili uzildi" });
  });

  app.post('/api/v1/users', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });

    const schema = z.object({
      username: z.string().min(3, 'Username kamida 3 ta belgi bo\'lsin'),
      role: z.enum(['director', 'admin', 'teacher', 'student']),
      teacher_id: z.coerce.number().optional(),
      student_id: z.coerce.number().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.errors[0].message });

    try {
      const created = await AuthService.createUser(db, auth.user, parsed.data, request.ip);
      return reply.send({ status: 'ok', data: created });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.delete('/api/v1/users/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });

    const targetUser = await db.query('SELECT role FROM users WHERE id = $1', [request.params.id]);
    if (targetUser.rows[0]?.role === 'owner') {
      return reply.status(403).send({ error: "Platforma egasini (owner) o'chirish qat'iyan taqiqlanadi" });
    }

    try {
      await AuthService.deleteUser(db, auth.user, Number(request.params.id), request.ip);
      return reply.send({ status: 'ok', message: 'Foydalanuvchi o\'chirildi' });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // 8. Maktablar (Schools - faqat owner)
  app.get('/api/v1/schools', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth || auth.user.role !== 'owner') {
      return reply.status(403).send({ error: 'Faqat platforma egasi (owner) uchun' });
    }

    const res = await db.query(
      `SELECT s.id, s.name, s.code, s.status, s.created_at,
              (SELECT COUNT(*) FROM students st WHERE st.school_id = s.id AND st.status = 'a') as student_count,
              (SELECT COUNT(*) FROM teachers t WHERE t.school_id = s.id AND t.status = 'a') as teacher_count
       FROM schools s ORDER BY s.id ASC`
    );

    return reply.send({ status: 'ok', data: res.rows });
  });

  app.post('/api/v1/schools', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth || auth.user.role !== 'owner') {
      return reply.status(403).send({ error: 'Faqat platforma egasi (owner) uchun' });
    }

    const schema = z.object({
      name: z.string().min(1, 'Maktab nomini kiriting'),
      director_username: z.string().min(3, 'Direktor username kiriting'),
      director_phone: z.string().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.errors[0].message });

    try {
      const result = await AuthService.createSchoolWithDirector(
        db,
        auth.user,
        parsed.data.name,
        parsed.data.director_username,
        parsed.data.director_phone,
        request.ip
      );
      return reply.send({ status: 'ok', data: result });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // 9. Xatirchi tumani 65-maktabni tayyor rollar va sinflar bilan qayta sozlash
  app.post('/api/v1/owner/seed-xatirchi', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth || auth.user.role !== 'owner') {
      return reply.status(403).send({ error: 'Faqat platforma egasi (owner) uchun' });
    }

    try {
      const result = await seedXatirchiSchool(db);
      return reply.send({ status: 'ok', data: result });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // 10. OWNER SUPERADMIN APIS (Cheksiz imkoniyatlar)
  // Global tizim ko'rsatkichlari va barcha maktablar
  app.get('/api/v1/owner/overview', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth || auth.user.role !== 'owner') {
      return reply.status(403).send({ error: 'Faqat platforma egasi (owner) uchun' });
    }

    const schoolsRes = await db.query(
      `SELECT s.id, s.name, s.code, s.status, s.created_at,
              (SELECT COUNT(*) FROM students st WHERE st.school_id = s.id AND st.status = 'a') as student_count,
              (SELECT COUNT(*) FROM teachers t WHERE t.school_id = s.id AND t.status = 'a') as teacher_count,
              (SELECT COUNT(*) FROM classes c WHERE c.school_id = s.id AND c.status = 'a') as class_count,
              (SELECT COUNT(*) FROM subjects sub WHERE sub.school_id = s.id AND sub.status = 'a') as subject_count,
              (SELECT u.username FROM users u WHERE u.school_id = s.id AND u.role = 'director' LIMIT 1) as director_username,
              (SELECT u.phone_e164 FROM users u WHERE u.school_id = s.id AND u.role = 'director' LIMIT 1) as director_phone
       FROM schools s ORDER BY s.id ASC`
    );

    const statsRes = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM schools) as total_schools,
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM teachers WHERE status = 'a') as total_teachers,
        (SELECT COUNT(*) FROM students WHERE status = 'a') as total_students,
        (SELECT COUNT(*) FROM classes WHERE status = 'a') as total_classes,
        (SELECT COUNT(*) FROM subjects WHERE status = 'a') as total_subjects
    `);

    return reply.send({
      status: 'ok',
      data: {
        stats: statsRes.rows[0],
        schools: schoolsRes.rows,
      },
    });
  });

  // Maktab ma'lumotlarini tozalash (Wipe school data)
  app.post('/api/v1/owner/wipe-school-data', async (request: FastifyRequest<{ Body: { school_id?: number } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth || auth.user.role !== 'owner') {
      return reply.status(403).send({ error: 'Faqat platforma egasi (owner) uchun' });
    }

    const targetSchoolId = request.body?.school_id || auth.user.support_school_id || (await db.query('SELECT id FROM schools LIMIT 1')).rows[0]?.id;
    if (!targetSchoolId) return reply.status(400).send({ error: 'Maktab topilmadi' });

    await db.query("DELETE FROM users WHERE school_id = $1 AND role != 'owner'", [targetSchoolId]);
    await db.query("DELETE FROM attendance_records WHERE school_id = $1", [targetSchoolId]);
    await db.query("DELETE FROM attendance_sessions WHERE school_id = $1", [targetSchoolId]);
    await db.query("DELETE FROM schedule_slots WHERE school_id = $1", [targetSchoolId]);
    await db.query("DELETE FROM assignments WHERE school_id = $1", [targetSchoolId]);
    await db.query("DELETE FROM students WHERE school_id = $1", [targetSchoolId]);
    await db.query("DELETE FROM classes WHERE school_id = $1", [targetSchoolId]);
    await db.query("DELETE FROM teachers WHERE school_id = $1", [targetSchoolId]);
    await db.query("DELETE FROM subjects WHERE school_id = $1", [targetSchoolId]);

    return reply.send({ status: 'ok', message: `Maktab #${targetSchoolId} ning barcha o'qituvchilari, fanlari va o'quvchilari to'liq tozalandi!` });
  });

  // Maktab nomini va sozlamalarini o'zgartirish
  app.put('/api/v1/owner/schools/:id', async (request: FastifyRequest<{ Params: { id: string }; Body: { name?: string; code?: string; status?: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth || auth.user.role !== 'owner') {
      return reply.status(403).send({ error: 'Faqat platforma egasi (owner) uchun' });
    }

    const schoolId = Number(request.params.id);
    const { name, code, status } = request.body || {};
    if (name) await db.query('UPDATE schools SET name = $1 WHERE id = $2', [name.trim(), schoolId]);
    if (code) await db.query('UPDATE schools SET code = $1 WHERE id = $2', [code.trim(), schoolId]);
    if (status) await db.query('UPDATE schools SET status = $1 WHERE id = $2', [status, schoolId]);

    return reply.send({ status: 'ok', message: 'Maktab ma\'lumotlari yangilandi' });
  });

  // Maktabni o'chirish
  app.delete('/api/v1/owner/schools/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth || auth.user.role !== 'owner') {
      return reply.status(403).send({ error: 'Faqat platforma egasi (owner) uchun' });
    }

    const schoolId = Number(request.params.id);
    const countRes = await db.query('SELECT COUNT(*) as c FROM schools');
    if (parseInt(countRes.rows[0].c, 10) <= 1) {
      return reply.status(400).send({ error: 'Oxirgi maktabni o\'chirib bo\'lmaydi' });
    }

    await db.query('DELETE FROM schools WHERE id = $1', [schoolId]);
    return reply.send({ status: 'ok', message: 'Maktab to\'liq o\'chirildi' });
  });

  // Har qanday foydalanuvchi parolini yangilash (Reset password)
  app.post('/api/v1/owner/users/:id/reset-password', async (request: FastifyRequest<{ Params: { id: string }; Body: { password?: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth || auth.user.role !== 'owner') {
      return reply.status(403).send({ error: 'Faqat platforma egasi (owner) uchun' });
    }

    const userId = Number(request.params.id);
    const newPass = request.body?.password?.trim() || generateTempPassword(10);
    const pwHash = await hashPassword(newPass);

    await db.query('UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2', [pwHash, userId]);
    return reply.send({ status: 'ok', temporary_password: newPass, message: 'Parol muvaffaqiyatli o\'rnatildi' });
  });

  // Foydalanuvchi rolini o'zgartirish
  app.put('/api/v1/owner/users/:id/role', async (request: FastifyRequest<{ Params: { id: string }; Body: { role: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth || auth.user.role !== 'owner') {
      return reply.status(403).send({ error: 'Faqat platforma egasi (owner) uchun' });
    }

    const userId = Number(request.params.id);
    const newRole = request.body?.role;
    if (!['owner', 'director', 'admin', 'teacher', 'student'].includes(newRole)) {
      return reply.status(400).send({ error: 'Noto\'g\'ri rol' });
    }

    const uRes = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (uRes.rows.length === 0) return reply.status(404).send({ error: 'Foydalanuvchi topilmadi' });
    if (uRes.rows[0].role === 'owner' && newRole !== 'owner') {
      return reply.status(403).send({ error: "Platforma egasining (owner) rolini pasaytirish taqiqlanadi" });
    }

    await db.query('UPDATE users SET role = $1 WHERE id = $2', [newRole, userId]);
    await logAudit(db, {
      school_id: auth.user.support_school_id || null,
      user_id: auth.user.id,
      action: 'USER_ROLE_CHANGED',
      entity: 'user',
      entity_id: String(userId),
      details: { old_role: uRes.rows[0].role, new_role: newRole },
    });
    return reply.send({ status: 'ok', message: 'Rol yangilandi' });
  });

  // Foydalanuvchini bloklash / faollashtirish (Status: active / blocked)
  app.put('/api/v1/owner/users/:id/status', async (request: FastifyRequest<{ Params: { id: string }; Body: { status: 'active' | 'blocked' } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth || auth.user.role !== 'owner') {
      return reply.status(403).send({ error: 'Faqat platforma egasi (owner) uchun' });
    }

    const userId = Number(request.params.id);
    const newStatus = request.body?.status === 'blocked' ? 'blocked' : 'active';

    const uRes = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (uRes.rows.length === 0) return reply.status(404).send({ error: 'Foydalanuvchi topilmadi' });
    if (uRes.rows[0].role === 'owner') {
      return reply.status(403).send({ error: 'Platforma egasini (owner) bloklash taqiqlanadi' });
    }

    await db.query('UPDATE users SET status = $1 WHERE id = $2', [newStatus, userId]);
    if (newStatus === 'blocked') {
      await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    }

    await logAudit(db, {
      school_id: auth.user.support_school_id || null,
      user_id: auth.user.id,
      action: newStatus === 'blocked' ? 'USER_BLOCKED' : 'USER_UNBLOCKED',
      entity: 'user',
      entity_id: String(userId),
    });

    return reply.send({ status: 'ok', message: newStatus === 'blocked' ? 'Foydalanuvchi bloklandi' : 'Foydalanuvchi faollashtirildi' });
  });

  // Telegram bot orqali ommaviy xabar yuborish (Broadcast)
  app.post('/api/v1/owner/broadcast', async (request: FastifyRequest<{ Body: { text: string; target?: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth || auth.user.role !== 'owner') {
      return reply.status(403).send({ error: 'Faqat platforma egasi (owner) uchun' });
    }

    const text = request.body?.text?.trim();
    if (!text) return reply.status(400).send({ error: 'Xabar matnini kiriting' });
    const target = request.body?.target || 'all';

    const { getBot } = await import('../telegram/bot.js');
    const bot = getBot();

    const chatIds: number[] = [];
    if (target === 'parents' || target === 'all') {
      const pRes = await db.query("SELECT DISTINCT telegram_chat_id FROM parent_contacts WHERE telegram_chat_id IS NOT NULL AND status = 'connected'");
      chatIds.push(...pRes.rows.map(r => Number(r.telegram_chat_id)));
    }
    if (target === 'teachers' || target === 'directors' || target === 'all') {
      const tiRes = await db.query("SELECT DISTINCT telegram_id FROM telegram_identities WHERE telegram_id IS NOT NULL AND unbound_at IS NULL");
      chatIds.push(...tiRes.rows.map(r => Number(r.telegram_id)));
    }

    const uniqueChatIds = Array.from(new Set(chatIds.filter(Boolean)));
    let successCount = 0;
    if (bot) {
      for (const cid of uniqueChatIds) {
        try {
          await bot.api.sendMessage(cid, `📢 Platforma Rahbari xabari:\n\n${text}`);
          successCount++;
        } catch {
          // ignore error per chat
        }
      }
    }

    await logAudit(db, {
      school_id: auth.user.support_school_id || null,
      user_id: auth.user.id,
      action: 'BROADCAST_SENT',
      entity: 'broadcast',
      details: { target, total_recipients: uniqueChatIds.length, success_count: successCount },
    });

    return reply.send({
      status: 'ok',
      message: `Xabar ${successCount} ta Telegram profiliga muvaffaqiyatli yuborildi`,
      total_recipients: uniqueChatIds.length,
      success_count: successCount,
    });
  });

  // Favqulodda kirish havolasi (Emergency break-glass link)
  app.post('/api/v1/owner/generate-break-glass', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth || auth.user.role !== 'owner') {
      return reply.status(403).send({ error: 'Faqat platforma egasi (owner) uchun' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashSessionToken(token);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.query(
      `INSERT INTO sessions (id, user_id, school_id, token_hash, expires_at)
       VALUES ($1, $2, NULL, $3, $4)`,
      [tokenHash, auth.user.id, tokenHash, expiresAt.toISOString()]
    );

    const baseUrl = process.env.PUBLIC_URL || (process.env.RENDER_EXTERNAL_URL ? process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '') : `http://${request.headers.host}`);
    return reply.send({
      status: 'ok',
      link: `${baseUrl}/?token=${token}`,
      expires_at: expiresAt.toISOString(),
    });
  });
}
