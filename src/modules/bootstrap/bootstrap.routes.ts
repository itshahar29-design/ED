import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { BootstrapService } from './bootstrap.service.js';
import { AuthService } from '../auth/auth.service.js';
import { can, ALL_PERMISSIONS } from '../auth/permissions.js';
import { DbClient } from '../../db/client.js';
import { seedXatirchiSchool } from '../school/xatirchi.seed.js';

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

  // 7. Foydalanuvchilar boshqaruvi (Users)
  app.get('/api/v1/users', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!['owner', 'director', 'admin'].includes(auth.user.role)) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    const res = await db.query(
      `SELECT u.id, u.username, u.role, u.teacher_id, u.student_id, u.must_change_password, u.locked_until, u.created_at,
              t.name as teacher_name, st.name as student_name
       FROM users u
       LEFT JOIN teachers t ON u.teacher_id = t.id AND u.school_id = t.school_id
       LEFT JOIN students st ON u.student_id = st.id AND u.school_id = st.school_id
       WHERE u.school_id = $1
       ORDER BY u.id ASC`,
      [schoolId]
    );

    return reply.send({ status: 'ok', data: res.rows });
  });

  app.post('/api/v1/users', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });

    const schema = z.object({
      username: z.string().min(3, 'Username kamida 3 ta belgi bo\'lsin'),
      role: z.enum(['admin', 'teacher', 'student']),
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
}
