import { DbClient } from '../../db/client.js';
import { ControlCenterService } from './control-center.service.js';
import { TelegramService } from '../telegram/telegram.service.js';
import { getTodayInTashkent } from '../attendance/attendance.service.js';
import { env } from '../../config/env.js';

let schedulerInterval: NodeJS.Timeout | null = null;

export async function runSchedulerTick(db: DbClient, sendFn?: (chatId: number, text: string) => Promise<{ ok: boolean; error?: any }>) {
  try {
    const today = getTodayInTashkent();
    const now = new Date();
    const currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const schoolsRes = await db.query('SELECT id FROM schools WHERE status = \'active\'');

    for (const school of schoolsRes.rows) {
      const schoolId = school.id;
      try {
        await ControlCenterService.checkTeacherReminders(db, schoolId, today, currentTimeStr);
        await ControlCenterService.checkDeputyEscalation(db, schoolId, today, currentTimeStr);
        await ControlCenterService.checkRiskAlerts(db, schoolId, today);
        await ControlCenterService.sendDailySummary(db, schoolId, today, currentTimeStr);
      } catch (err: any) {
        console.error(`Scheduler xatosi (maktab ${schoolId}):`, err.message);
      }
    }

    // Navbatdagi xabarlarni yuborish
    if (sendFn) {
      await TelegramService.processOutbox(db, sendFn);
    }
  } catch (err: any) {
    console.error('Umumiy scheduler xatosi:', err.message);
  }
}

export function startScheduler(
  db: DbClient,
  intervalMs = 60000,
  sendFn?: (chatId: number, text: string) => Promise<{ ok: boolean; error?: any }>
) {
  if (schedulerInterval) return;
  if (env.NODE_ENV === 'test' || process.env.DISABLE_SCHEDULER === 'true') {
    return; // Test muhitida avtomatik ishga tushmaydi
  }

  // Dastlabki birinchi chaqiriq
  runSchedulerTick(db, sendFn).catch(() => {});

  schedulerInterval = setInterval(() => {
    runSchedulerTick(db, sendFn).catch(() => {});
  }, intervalMs);
}

export function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
