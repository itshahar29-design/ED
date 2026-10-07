import { DbClient } from '../../db/client.js';
import { isSchoolDay } from '../calendar/calendar.routes.js';
import { AttendanceService } from '../attendance/attendance.service.js';
import { logAudit } from '../audit/audit.service.js';

export interface NotificationSettings {
  school_id: number;
  daily_summary_time: string;
  teacher_reminder_minutes: number;
  deputy_escalation_hours: number;
  risk_alert_threshold: number;
  enabled: {
    teacher_reminder: boolean;
    deputy_escalation: boolean;
    risk_alert: boolean;
    daily_summary: boolean;
  };
}

export function parseTimeToMinutes(t: string): number {
  if (!t || !t.includes(':')) return 0;
  const [h, m] = t.split(':').map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}

export function formatMinutesToTime(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export class ControlCenterService {
  /**
   * Maktabning bildirishnoma sozlamalarini olish (yoki standart qiymatlarni qaytarish)
   */
  static async getNotificationSettings(db: DbClient, schoolId: number): Promise<NotificationSettings> {
    const res = await db.query(
      'SELECT * FROM notification_settings WHERE school_id = $1',
      [schoolId]
    );

    if (res.rows.length === 0) {
      const defaultSettings: NotificationSettings = {
        school_id: schoolId,
        daily_summary_time: '09:30',
        teacher_reminder_minutes: 15,
        deputy_escalation_hours: 2,
        risk_alert_threshold: 75,
        enabled: {
          teacher_reminder: true,
          deputy_escalation: true,
          risk_alert: true,
          daily_summary: true,
        },
      };

      await db.query(
        `INSERT INTO notification_settings (school_id, daily_summary_time, teacher_reminder_minutes, deputy_escalation_hours, risk_alert_threshold, enabled)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (school_id) DO NOTHING`,
        [
          schoolId,
          defaultSettings.daily_summary_time,
          defaultSettings.teacher_reminder_minutes,
          defaultSettings.deputy_escalation_hours,
          defaultSettings.risk_alert_threshold,
          JSON.stringify(defaultSettings.enabled),
        ]
      );

      return defaultSettings;
    }

    const row = res.rows[0];
    let enabled = row.enabled;
    if (typeof enabled === 'string') {
      try {
        enabled = JSON.parse(enabled);
      } catch (e) {
        enabled = { teacher_reminder: true, deputy_escalation: true, risk_alert: true, daily_summary: true };
      }
    }

    return {
      school_id: row.school_id,
      daily_summary_time: row.daily_summary_time || '09:30',
      teacher_reminder_minutes: row.teacher_reminder_minutes ?? 15,
      deputy_escalation_hours: row.deputy_escalation_hours ?? 2,
      risk_alert_threshold: row.risk_alert_threshold ?? 75,
      enabled: {
        teacher_reminder: enabled?.teacher_reminder ?? true,
        deputy_escalation: enabled?.deputy_escalation ?? true,
        risk_alert: enabled?.risk_alert ?? true,
        daily_summary: enabled?.daily_summary ?? true,
      },
    };
  }

  /**
   * Sozlamalarni yangilash
   */
  static async updateNotificationSettings(
    db: DbClient,
    schoolId: number,
    input: Partial<NotificationSettings>,
    userId?: number,
    ipAddress?: string
  ): Promise<NotificationSettings> {
    const current = await this.getNotificationSettings(db, schoolId);

    const updated: NotificationSettings = {
      school_id: schoolId,
      daily_summary_time: input.daily_summary_time ?? current.daily_summary_time,
      teacher_reminder_minutes: input.teacher_reminder_minutes ?? current.teacher_reminder_minutes,
      deputy_escalation_hours: input.deputy_escalation_hours ?? current.deputy_escalation_hours,
      risk_alert_threshold: input.risk_alert_threshold ?? current.risk_alert_threshold,
      enabled: {
        ...current.enabled,
        ...(input.enabled || {}),
      },
    };

    await db.query(
      `INSERT INTO notification_settings (school_id, daily_summary_time, teacher_reminder_minutes, deputy_escalation_hours, risk_alert_threshold, enabled, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (school_id)
       DO UPDATE SET
         daily_summary_time = EXCLUDED.daily_summary_time,
         teacher_reminder_minutes = EXCLUDED.teacher_reminder_minutes,
         deputy_escalation_hours = EXCLUDED.deputy_escalation_hours,
         risk_alert_threshold = EXCLUDED.risk_alert_threshold,
         enabled = EXCLUDED.enabled,
         updated_at = NOW()`,
      [
        schoolId,
        updated.daily_summary_time,
        updated.teacher_reminder_minutes,
        updated.deputy_escalation_hours,
        updated.risk_alert_threshold,
        JSON.stringify(updated.enabled),
      ]
    );

    await logAudit(db, {
      school_id: schoolId,
      user_id: userId || null,
      action: 'NOTIFICATION_SETTINGS_UPDATED',
      entity: 'notification_settings',
      entity_id: String(schoolId),
      details: updated,
      ip_address: ipAddress,
    });

    return updated;
  }

  /**
   * 1. O'qituvchiga 15 daqiqalik eslatma (Feature 6-B.1)
   * Dars tugaganidan 15 daqiqa keyin davomat topshirilmagan bo'lsa, o'qituvchiga bot xabari yuboriladi (bir marta).
   */
  static async checkTeacherReminders(
    db: DbClient,
    schoolId: number,
    dateStr: string,
    currentTimeStr: string
  ): Promise<{ sent: number; checked: number; reason?: string }> {
    // Kalendar / bayram tekshiruvi
    const isDay = await isSchoolDay(db, schoolId, dateStr);
    if (!isDay) return { sent: 0, checked: 0, reason: 'holiday_or_weekend' };

    const settings = await this.getNotificationSettings(db, schoolId);
    if (!settings.enabled.teacher_reminder) {
      return { sent: 0, checked: 0, reason: 'disabled' };
    }

    // Maktab dars vaqtlari va jadvalini olish
    const sSet = await db.query('SELECT times FROM school_settings WHERE school_id = $1', [schoolId]);
    let rawTimes = sSet.rows[0]?.times;
    if (typeof rawTimes === 'string') {
      try { rawTimes = JSON.parse(rawTimes); } catch (e) {}
    }
    const times: string[] = Array.isArray(rawTimes) ? rawTimes : [
      '08:00-08:45', '08:55-09:40', '09:50-10:35', '10:45-11:30', '11:40-12:25', '12:35-13:20'
    ];

    const dateObj = new Date(dateStr + 'T12:00:00Z');
    const dayOfWeek = (dateObj.getUTCDay() + 6) % 7;
    const currentMins = parseTimeToMinutes(currentTimeStr);

    // Bugungi kunga belgilangan dars slotlari
    const slotsRes = await db.query(
      `SELECT ss.id as slot_id, ss.slot_no, ss.teacher_id, t.name as teacher_name, t.phone as teacher_phone,
              c.name as class_name, sub.name as subject_name
       FROM schedule_slots ss
       JOIN assignments a ON ss.assignment_id = a.id AND ss.school_id = a.school_id
       JOIN teachers t ON ss.teacher_id = t.id AND ss.school_id = t.school_id
       JOIN classes c ON ss.class_id = c.id AND ss.school_id = c.school_id
       JOIN subjects sub ON a.subject_id = sub.id AND a.school_id = sub.school_id
       WHERE ss.school_id = $1 AND ss.day = $2`,
      [schoolId, dayOfWeek]
    );

    let sentCount = 0;

    for (const slot of slotsRes.rows) {
      const timeRange = times[slot.slot_no] || '08:00-08:45';
      const endTimeStr = timeRange.split('-')[1] || '08:45';
      const endMins = parseTimeToMinutes(endTimeStr);

      // Dars tugashiga reminder_minutes qo'shiladi
      if (currentMins >= endMins + settings.teacher_reminder_minutes) {
        // Davomat topshirilganmi (submitted)?
        const sesRes = await db.query(
          `SELECT id, status FROM attendance_sessions
           WHERE school_id = $1 AND date = $2 AND schedule_slot_id = $3`,
          [schoolId, dateStr, slot.slot_id]
        );

        const isSubmitted = sesRes.rows.length > 0 && sesRes.rows[0].status === 'submitted';

        if (!isSubmitted) {
          // Oldin bu slot uchun eslatma yuborilganmi? (dedupe: aynan bir marta)
          const dedupEntityId = `${slot.slot_id}|${dateStr}`;
          const auditCheck = await db.query(
            `SELECT id FROM audit_log
             WHERE school_id = $1 AND action = 'TEACHER_REMINDER_SENT' AND entity_id = $2`,
            [schoolId, dedupEntityId]
          );

          if (auditCheck.rows.length === 0) {
            const reminderText = `⏰ Eslatma: ${slot.slot_no + 1}-dars ${slot.subject_name} (${slot.class_name}) davomati hali topshirilmadi. Iltimos, davomatni saqlang va topshiring.`;

            await db.query(
              `INSERT INTO outbox_messages (school_id, user_id, date, phone, text, status)
               VALUES ($1, NULL, $2, $3, $4, 'pending')`,
              [schoolId, dateStr, slot.teacher_phone, reminderText]
            );

            await logAudit(db, {
              school_id: schoolId,
              user_id: null,
              action: 'TEACHER_REMINDER_SENT',
              entity: 'schedule_slots',
              entity_id: dedupEntityId,
              details: { slot_id: slot.slot_id, teacher_id: slot.teacher_id, date: dateStr },
            });

            sentCount++;
          }
        }
      }
    }

    return { sent: sentCount, checked: slotsRes.rows.length };
  }

  /**
   * 2. Zavuchga 2 soatlik eskalatsiya (Feature 6-B.1)
   * 2 soatdan keyin ham topshirilmagan bo'lsa — zavuch (deputy_academic) ga umumiy ro'yxat.
   */
  static async checkDeputyEscalation(
    db: DbClient,
    schoolId: number,
    dateStr: string,
    currentTimeStr: string
  ): Promise<{ sent: number; unsubmittedCount: number; reason?: string }> {
    const isDay = await isSchoolDay(db, schoolId, dateStr);
    if (!isDay) return { sent: 0, unsubmittedCount: 0, reason: 'holiday_or_weekend' };

    const settings = await this.getNotificationSettings(db, schoolId);
    if (!settings.enabled.deputy_escalation) {
      return { sent: 0, unsubmittedCount: 0, reason: 'disabled' };
    }

    const sSet = await db.query('SELECT times FROM school_settings WHERE school_id = $1', [schoolId]);
    let rawTimes = sSet.rows[0]?.times;
    if (typeof rawTimes === 'string') {
      try { rawTimes = JSON.parse(rawTimes); } catch (e) {}
    }
    const times: string[] = Array.isArray(rawTimes) ? rawTimes : [
      '08:00-08:45', '08:55-09:40', '09:50-10:35', '10:45-11:30', '11:40-12:25', '12:35-13:20'
    ];

    const dateObj = new Date(dateStr + 'T12:00:00Z');
    const dayOfWeek = (dateObj.getUTCDay() + 6) % 7;
    const currentMins = parseTimeToMinutes(currentTimeStr);
    const escalationThresholdMins = settings.deputy_escalation_hours * 60;

    const slotsRes = await db.query(
      `SELECT ss.id as slot_id, ss.slot_no, ss.teacher_id, t.name as teacher_name, t.phone as teacher_phone,
              c.name as class_name, sub.name as subject_name
       FROM schedule_slots ss
       JOIN assignments a ON ss.assignment_id = a.id AND ss.school_id = a.school_id
       JOIN teachers t ON ss.teacher_id = t.id AND ss.school_id = t.school_id
       JOIN classes c ON ss.class_id = c.id AND ss.school_id = c.school_id
       JOIN subjects sub ON a.subject_id = sub.id AND a.school_id = sub.school_id
       WHERE ss.school_id = $1 AND ss.day = $2`,
      [schoolId, dayOfWeek]
    );

    const pendingEscalations: any[] = [];

    for (const slot of slotsRes.rows) {
      const timeRange = times[slot.slot_no] || '08:00-08:45';
      const endTimeStr = timeRange.split('-')[1] || '08:45';
      const endMins = parseTimeToMinutes(endTimeStr);

      if (currentMins >= endMins + escalationThresholdMins) {
        const sesRes = await db.query(
          `SELECT id, status FROM attendance_sessions
           WHERE school_id = $1 AND date = $2 AND schedule_slot_id = $3`,
          [schoolId, dateStr, slot.slot_id]
        );

        const isSubmitted = sesRes.rows.length > 0 && sesRes.rows[0].status === 'submitted';

        if (!isSubmitted) {
          const dedupEntityId = `deputy|${slot.slot_id}|${dateStr}`;
          const auditCheck = await db.query(
            `SELECT id FROM audit_log
             WHERE school_id = $1 AND action = 'DEPUTY_ESCALATION_SENT' AND entity_id = $2`,
            [schoolId, dedupEntityId]
          );

          if (auditCheck.rows.length === 0) {
            pendingEscalations.push({ ...slot, dedupEntityId });
          }
        }
      }
    }

    if (pendingEscalations.length === 0) {
      return { sent: 0, unsubmittedCount: 0 };
    }

    // Zavuch yoki Direktorni topish
    const deputiesRes = await db.query(
      `SELECT u.id, COALESCE(NULLIF(u.phone_e164, ''), ss.phone, '+998900000000') as phone_e164, u.full_name
       FROM users u
       JOIN memberships m ON m.user_id = u.id AND m.school_id = $1
       JOIN positions p ON m.position_id = p.id
       LEFT JOIN school_settings ss ON ss.school_id = $1
       WHERE p.key IN ('deputy_academic', 'director') OR u.role IN ('deputy_academic', 'director')`,
      [schoolId]
    );

    const lines = [
      `⚠️ Nazorat markazi: Quyidagi darslar tugaganiga 2 soatdan oshdi, lekin davomat topshirilmadi:`
    ];
    for (const item of pendingEscalations) {
      lines.push(`• ${item.slot_no + 1}-dars: ${item.subject_name} (${item.class_name}) — ${item.teacher_name}`);
    }
    const messageText = lines.join('\n');

    for (const deputy of deputiesRes.rows) {
      await db.query(
        `INSERT INTO outbox_messages (school_id, user_id, date, phone, text, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')`,
        [schoolId, deputy.id, dateStr, deputy.phone_e164, messageText]
      );
    }

    for (const item of pendingEscalations) {
      await logAudit(db, {
        school_id: schoolId,
        user_id: null,
        action: 'DEPUTY_ESCALATION_SENT',
        entity: 'schedule_slots',
        entity_id: item.dedupEntityId,
        details: { slot_id: item.slot_id, date: dateStr, teacher: item.teacher_name },
      });
    }

    return { sent: deputiesRes.rows.length, unsubmittedCount: pendingEscalations.length };
  }

  /**
   * 3. Xavf signali (Feature 6-B.2)
   * 3 kun ketma-ket yo'q yoki 30 kunda <75% bo'lsa — sinf rahbari, psixolog va VIEW_RISK egalariga xabar.
   * Dedupe: bir o'quvchiga 7 kunda ko'pi bilan 1 marta.
   */
  static async checkRiskAlerts(
    db: DbClient,
    schoolId: number,
    todayStr: string
  ): Promise<{ sent: number; riskCount: number; reason?: string }> {
    const settings = await this.getNotificationSettings(db, schoolId);
    if (!settings.enabled.risk_alert) {
      return { sent: 0, riskCount: 0, reason: 'disabled' };
    }

    const riskStudents = await AttendanceService.getRiskStudents(db, schoolId);
    let sentCount = 0;

    for (const st of riskStudents) {
      // Dedupe tekshiruvi: so'nggi 7 kunda xabar yuborilganmi?
      const recentCheck = await db.query(
        `SELECT id FROM audit_log
         WHERE school_id = $1 AND action = 'RISK_ALERT_SENT' AND entity_id = $2
           AND created_at >= NOW() - INTERVAL '7 days'`,
        [schoolId, String(st.student_id)]
      );

      if (recentCheck.rows.length === 0) {
        // Sinf rahbari va psixologni topish
        const leaderRes = await db.query(
          `SELECT t.name, t.phone FROM classes c
           JOIN teachers t ON c.leader_teacher_id = t.id AND c.school_id = t.school_id
           WHERE c.school_id = $1 AND c.id = $2`,
          [schoolId, st.class_id]
        );

        const reasonsMap: Record<string, string> = {
          consecutive_absent: 'ketma-ket 3 dars kuni qatnashmadi',
          low_rate: '30 kunlik davomat 75% dan past',
        };
        const reasonsText = st.reasons.map((r) => reasonsMap[r] || r).join(', ');

        const alertText = `⚠️ Xavf signali!\nO'quvchi: ${st.student_name} (${st.class_name})\nSabab: ${reasonsText}\nDavomat ko'rsatkichi: ${st.pct}%\nIltimos, o'quvchi va ota-onasi bilan bog'laning.`;

        if (leaderRes.rows.length > 0 && leaderRes.rows[0].phone) {
          await db.query(
            `INSERT INTO outbox_messages (school_id, user_id, date, phone, text, status)
             VALUES ($1, NULL, $2, $3, $4, 'pending')`,
            [schoolId, todayStr, leaderRes.rows[0].phone, alertText]
          );
        }

        // Psixologlarni topish
        const psychoRes = await db.query(
          `SELECT u.id, u.phone_e164 FROM users u
           JOIN memberships m ON m.user_id = u.id AND m.school_id = $1
           JOIN positions p ON m.position_id = p.id
           WHERE p.key = 'psychologist' AND u.phone_e164 IS NOT NULL`,
          [schoolId]
        );

        for (const psycho of psychoRes.rows) {
          await db.query(
            `INSERT INTO outbox_messages (school_id, user_id, date, phone, text, status)
             VALUES ($1, $2, $3, $4, $5, 'pending')`,
            [schoolId, psycho.id, todayStr, psycho.phone_e164, alertText]
          );
        }

        await logAudit(db, {
          school_id: schoolId,
          user_id: null,
          action: 'RISK_ALERT_SENT',
          entity: 'students',
          entity_id: String(st.student_id),
          details: { student_id: st.student_id, reasons: st.reasons, pct: st.pct },
        });

        sentCount++;
      }
    }

    return { sent: sentCount, riskCount: riskStudents.length };
  }

  /**
   * 4. Kunlik xulosa (Feature 6-B.3)
   * Belgilangan vaqtda (default 09:30) direktor va zavuchga umumiy davomat %, olinmagan darslar, eng past 3 sinf.
   */
  static async sendDailySummary(
    db: DbClient,
    schoolId: number,
    dateStr: string,
    currentTimeStr: string
  ): Promise<{ sent: boolean; reason?: string }> {
    const isDay = await isSchoolDay(db, schoolId, dateStr);
    if (!isDay) return { sent: false, reason: 'holiday_or_weekend' };

    const settings = await this.getNotificationSettings(db, schoolId);
    if (!settings.enabled.daily_summary) {
      return { sent: false, reason: 'disabled' };
    }

    // Belgilangan vaqt yetdimi?
    const currentMins = parseTimeToMinutes(currentTimeStr);
    const summaryMins = parseTimeToMinutes(settings.daily_summary_time);
    if (currentMins < summaryMins) {
      return { sent: false, reason: 'time_not_reached' };
    }

    // Bugun allaqachon yuborilganmi? (dedupe)
    const auditCheck = await db.query(
      `SELECT id FROM audit_log
       WHERE school_id = $1 AND action = 'DAILY_SUMMARY_SENT' AND entity_id = $2`,
      [schoolId, dateStr]
    );
    if (auditCheck.rows.length > 0) {
      return { sent: false, reason: 'already_sent' };
    }

    // Maktab statistikasi
    const reportData = await AttendanceService.generateReport(db, schoolId, { from: dateStr, to: dateStr });
    const overallPct = reportData.tally.pct ?? 100;

    // Darslar jadvali bo'yicha kutilgan va topshirilmagan darslar
    const dateObj = new Date(dateStr + 'T12:00:00Z');
    const dayOfWeek = (dateObj.getUTCDay() + 6) % 7;

    const totalSlotsRes = await db.query(
      'SELECT count(*)::int as cnt FROM schedule_slots WHERE school_id = $1 AND day = $2',
      [schoolId, dayOfWeek]
    );
    const submittedSesRes = await db.query(
      `SELECT count(*)::int as cnt FROM attendance_sessions
       WHERE school_id = $1 AND date = $2 AND status = 'submitted'`,
      [schoolId, dateStr]
    );

    const totalScheduled = totalSlotsRes.rows[0].cnt;
    const submittedCount = submittedSesRes.rows[0].cnt;
    const missingCount = Math.max(0, totalScheduled - submittedCount);

    // Sinflar bo'yicha eng past 3 ta sinf
    const classStatsRes = await db.query(
      `SELECT c.name as class_name,
              count(*)::int as total,
              count(CASE WHEN r.status = 'a' THEN 1 END)::int as absent
       FROM attendance_records r
       JOIN attendance_sessions s ON r.session_id = s.id AND r.school_id = s.school_id
       JOIN classes c ON s.class_id = c.id AND s.school_id = c.school_id
       WHERE r.school_id = $1 AND s.date = $2 AND s.status = 'submitted'
       GROUP BY c.id, c.name`,
      [schoolId, dateStr]
    );

    const classStats = classStatsRes.rows.map((cs) => {
      const pct = cs.total > 0 ? Math.round(((cs.total - cs.absent) / cs.total) * 100) : 100;
      return { class_name: cs.class_name, pct };
    }).sort((a, b) => a.pct - b.pct).slice(0, 3);

    const lowestClassesText = classStats.length > 0
      ? classStats.map((cs) => `• ${cs.class_name}: ${cs.pct}%`).join('\n')
      : 'Ma\'lumot yo\'q';

    const summaryText = `📊 Kunlik xulosa (${dateStr}):\n\n` +
      `📈 Maktab davomati: ${overallPct}%\n` +
      `⚠️ Davomat olinmagan darslar: ${missingCount} ta (jami ${totalScheduled} tadan)\n\n` +
      `Eng past davomatli 3 ta sinf:\n${lowestClassesText}`;

    // Direktor va zavuchlarga yuborish
    const managersRes = await db.query(
      `SELECT u.id, COALESCE(NULLIF(u.phone_e164, ''), ss.phone, '+998900000000') as phone_e164
       FROM users u
       JOIN memberships m ON m.user_id = u.id AND m.school_id = $1
       JOIN positions p ON m.position_id = p.id
       LEFT JOIN school_settings ss ON ss.school_id = $1
       WHERE p.key IN ('director', 'deputy_academic') OR u.role IN ('director', 'deputy_academic')`,
      [schoolId]
    );

    for (const m of managersRes.rows) {
      await db.query(
        `INSERT INTO outbox_messages (school_id, user_id, date, phone, text, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')`,
        [schoolId, m.id, dateStr, m.phone_e164, summaryText]
      );
    }

    await logAudit(db, {
      school_id: schoolId,
      user_id: null,
      action: 'DAILY_SUMMARY_SENT',
      entity: 'daily_summary',
      entity_id: dateStr,
      details: { overallPct, missingCount, totalScheduled },
    });

    return { sent: true };
  }
}
