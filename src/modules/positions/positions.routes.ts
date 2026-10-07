import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service.js';
import { can, ALL_PERMISSIONS, Permission } from '../auth/permissions.js';
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

const createPositionSchema = z.object({
  key: z.string().min(2).max(50),
  name_uz: z.string().min(2).max(100),
  base_key: z.string().min(2).max(50),
  scope: z.enum(['school', 'own_classes', 'own_subjects', 'own_children', 'self']).default('school'),
  permissions: z.array(z.string()),
});

const updatePermissionsSchema = z.object({
  permissions: z.array(z.string()),
});

export async function positionsRoutes(app: FastifyInstance) {
  const db: DbClient = (app as any).db;

  // 1. GET /api/v1/positions — Maktabdagi lavozimlar ro'yxati
  app.get('/api/v1/positions', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: "Avtorizatsiya talab qilinadi" });

    const schoolId = getEffectiveSchoolId(auth.user);

    let query: string;
    let params: any[];

    if (schoolId) {
      query = `SELECT p.id, p.school_id, p.key, p.name_uz, p.base_key, p.scope, p.rank, p.is_preset, p.created_at,
                      COALESCE(json_agg(pp.permission) FILTER (WHERE pp.permission IS NOT NULL), '[]'::json) as permissions
               FROM positions p
               LEFT JOIN position_permissions pp ON p.id = pp.position_id
               WHERE p.school_id = $1 OR p.school_id IS NULL
               GROUP BY p.id
               ORDER BY p.rank ASC, p.id ASC`;
      params = [schoolId];
    } else {
      query = `SELECT p.id, p.school_id, p.key, p.name_uz, p.base_key, p.scope, p.rank, p.is_preset, p.created_at,
                      COALESCE(json_agg(pp.permission) FILTER (WHERE pp.permission IS NOT NULL), '[]'::json) as permissions
               FROM positions p
               LEFT JOIN position_permissions pp ON p.id = pp.position_id
               GROUP BY p.id
               ORDER BY p.rank ASC, p.id ASC`;
      params = [];
    }

    const res = await db.query(query, params);
    return reply.send({ status: 'ok', data: res.rows });
  });

  // 2. POST /api/v1/positions — Direktor maxsus lavozim yaratishi
  app.post('/api/v1/positions', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: "Avtorizatsiya talab qilinadi" });

    if (!can(auth.user, 'MANAGE_USERS', undefined, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: "Lavozim yaratish huquqi yo'q" });
    }

    const parsed = createPositionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.errors[0].message });
    }

    const schoolId = getEffectiveSchoolId(auth.user);
    if (!schoolId) {
      return reply.status(400).send({ error: "Maktab aniqlanmadi" });
    }

    const { key, name_uz, base_key, scope, permissions } = parsed.data;

    // Section 5.5 berish qoidalari:
    // Berilayotgan barcha ruxsatlar berayotganning ruxsatlari ichida bo'lishi shart
    const myPerms = new Set(auth.permissions.map((p) => String(p)));
    for (const p of permissions) {
      if (!myPerms.has(p)) {
        return reply.status(403).send({
          error: `O'zingizda yo'q ruxsatni (${p}) boshqa lavozimga bera olmaysiz (privilege escalation himoyasi)`,
        });
      }
    }

    // Rank: yaratuvchining rankidan pastroq (katta son) bo'lishi shart
    const creatorRank = auth.user.rank || 10;
    const assignedRank = creatorRank + 10;

    const insRes = await db.query(
      `INSERT INTO positions (school_id, key, name_uz, base_key, scope, rank, is_preset)
       VALUES ($1, $2, $3, $4, $5, $6, false)
       RETURNING id, key, name_uz, base_key, scope, rank, is_preset`,
      [schoolId, key, name_uz, base_key, scope, assignedRank]
    );
    const createdPos = insRes.rows[0];

    for (const p of permissions) {
      if (ALL_PERMISSIONS.includes(p as Permission)) {
        await db.query(
          `INSERT INTO position_permissions (position_id, permission)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [createdPos.id, p]
        );
      }
    }

    return reply.send({
      status: 'ok',
      data: { ...createdPos, permissions },
    });
  });

  // 3. GET /api/v1/positions/:id/permissions
  app.get('/api/v1/positions/:id/permissions', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: "Avtorizatsiya talab qilinadi" });

    const posId = parseInt(request.params.id, 10);
    const res = await db.query(
      'SELECT permission FROM position_permissions WHERE position_id = $1',
      [posId]
    );

    return reply.send({ status: 'ok', data: res.rows.map((r) => r.permission) });
  });

  // 4. PUT /api/v1/positions/:id/permissions
  app.put('/api/v1/positions/:id/permissions', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: "Avtorizatsiya talab qilinadi" });

    if (!can(auth.user, 'MANAGE_USERS', undefined, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: "Ruxsatlarni o'zgartirish huquqi yo'q" });
    }

    const posId = parseInt(request.params.id, 10);
    const posRes = await db.query('SELECT * FROM positions WHERE id = $1', [posId]);
    if (posRes.rows.length === 0) {
      return reply.status(404).send({ error: "Lavozim topilmadi" });
    }

    const targetPos = posRes.rows[0];

    // Section 5.5: Direktor MANAGE_USERS va MANAGE_SETTINGS ni o'zidan ola olmaydi
    if (targetPos.key === 'director') {
      const parsed = updatePermissionsSchema.safeParse(request.body);
      if (parsed.success) {
        if (!parsed.data.permissions.includes('MANAGE_USERS') || !parsed.data.permissions.includes('MANAGE_SETTINGS')) {
          return reply.status(400).send({
            error: "Direktor lavozimidan MANAGE_USERS yoki MANAGE_SETTINGS ruxsatini olib tashlash taqiqlanadi",
          });
        }
      }
    }

    const parsed = updatePermissionsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.errors[0].message });
    }

    const myPerms = new Set(auth.permissions.map((p) => String(p)));
    for (const p of parsed.data.permissions) {
      if (!myPerms.has(p)) {
        return reply.status(403).send({
          error: `O'zingizda yo'q ruxsatni (${p}) bera olmaysiz`,
        });
      }
    }

    await db.query('DELETE FROM position_permissions WHERE position_id = $1', [posId]);
    for (const p of parsed.data.permissions) {
      if (ALL_PERMISSIONS.includes(p as Permission)) {
        await db.query(
          'INSERT INTO position_permissions (position_id, permission) VALUES ($1, $2)',
          [posId, p]
        );
      }
    }

    return reply.send({ status: 'ok', permissions: parsed.data.permissions });
  });
}
