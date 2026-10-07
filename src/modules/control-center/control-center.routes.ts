import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service.js';
import { can } from '../auth/permissions.js';
import { DbClient } from '../../db/client.js';
import { ControlCenterService } from './control-center.service.js';
import { getTodayInTashkent } from '../attendance/attendance.service.js';

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

const updateSettingsSchema = z.object({
  daily_summary_time: z.string().regex(/^\d{2}:\d{2}$/, 'Vaqt formati: HH:MM').optional(),
  teacher_reminder_minutes: z.coerce.number().int().min(1).max(180).optional(),
  deputy_escalation_hours: z.coerce.number().int().min(1).max(24).optional(),
  risk_alert_threshold: z.coerce.number().int().min(1).max(100).optional(),
  enabled: z.object({
    teacher_reminder: z.boolean().optional(),
    deputy_escalation: z.boolean().optional(),
    risk_alert: z.boolean().optional(),
    daily_summary: z.boolean().optional(),
  }).optional(),
});

export async function controlCenterRoutes(app: FastifyInstance) {
  const db: DbClient = (app as any).db;

  // 1. GET /api/v1/notification-settings
  app.get('/api/v1/notification-settings', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });

    let schoolId: number;
    try {
      schoolId = getEffectiveSchoolId(auth.user);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }

    if (!can(auth.user, 'VIEW_REPORTS', { type: 'report', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    const settings = await ControlCenterService.getNotificationSettings(db, schoolId);
    return reply.send({ status: 'ok', data: settings });
  });

  // 2. PUT /api/v1/notification-settings
  app.put('/api/v1/notification-settings', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });

    let schoolId: number;
    try {
      schoolId = getEffectiveSchoolId(auth.user);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }

    if (!can(auth.user, 'MANAGE_SETTINGS', { type: 'settings', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Faqat administrator yoki direktor o\'zgartira oladi' });
    }

    const parsed = updateSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.errors[0].message });
    }

    const updated = await ControlCenterService.updateNotificationSettings(
      db,
      schoolId,
      parsed.data as any,
      auth.user.id,
      request.ip
    );

    return reply.send({ status: 'ok', data: updated });
  });

  // 3. POST /api/v1/control-center/run-tick — Sinov yoki rejalashtirgich takti
  app.post('/api/v1/control-center/run-tick', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });

    let schoolId: number;
    try {
      schoolId = getEffectiveSchoolId(auth.user);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }

    const body: any = request.body || {};
    const dateStr = body.date || getTodayInTashkent();
    const now = new Date();
    const currentTimeStr = body.time || `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const teacherRes = await ControlCenterService.checkTeacherReminders(db, schoolId, dateStr, currentTimeStr);
    const deputyRes = await ControlCenterService.checkDeputyEscalation(db, schoolId, dateStr, currentTimeStr);
    const riskRes = await ControlCenterService.checkRiskAlerts(db, schoolId, dateStr);
    const summaryRes = await ControlCenterService.sendDailySummary(db, schoolId, dateStr, currentTimeStr);

    return reply.send({
      status: 'ok',
      data: {
        date: dateStr,
        time: currentTimeStr,
        teacherReminders: teacherRes,
        deputyEscalation: deputyRes,
        riskAlerts: riskRes,
        dailySummary: summaryRes,
      },
    });
  });
}
