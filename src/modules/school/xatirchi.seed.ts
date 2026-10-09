import { DbClient } from '../../db/client.js';
import { hashPassword } from '../auth/crypto.js';

/**
 * Xatirchi tumani 65-maktab uchun tayyor maktab, rollar, sinflar, fanlar,
 * o'qituvchilar va namunaviy o'quvchilarni bazaga to'liq kiritish.
 */
export async function seedXatirchiSchool(db: DbClient): Promise<{ schoolId: number; message: string }> {
  // 1. Maktabni aniqlash yoki yaratish
  let schoolId: number;
  const existing = await db.query('SELECT id, name FROM schools ORDER BY id ASC LIMIT 1');

  if (existing.rows.length === 0) {
    const s = await db.query(
      "INSERT INTO schools (name, code, status) VALUES ('Xatirchi tumani 65-maktab', 'XATIRCHI-65', 'active') RETURNING id"
    );
    schoolId = s.rows[0].id;
  } else {
    schoolId = existing.rows[0].id;
    await db.query(
      "UPDATE schools SET name = 'Xatirchi tumani 65-maktab', code = 'XATIRCHI-65', status = 'active' WHERE id = $1",
      [schoolId]
    );
  }

  // 2. Maktab sozlamalari (Settings)
  await db.query(
    `INSERT INTO school_settings (school_id, name, addr, phone, logo, days, times)
     VALUES ($1, 'Xatirchi tumani 65-maktab', 'Navoiy viloyati, Xatirchi tumani', '+998901234567', '🏫',
             '[0, 1, 2, 3, 4, 5]'::jsonb,
             '["08:00-08:45","08:50-09:35","09:45-10:30","10:35-11:20","11:30-12:15","12:20-13:05"]'::jsonb)
     ON CONFLICT (school_id)
     DO UPDATE SET name = EXCLUDED.name, addr = EXCLUDED.addr, phone = EXCLUDED.phone, logo = EXCLUDED.logo, days = EXCLUDED.days, times = EXCLUDED.times`,
    [schoolId]
  );

  // 3. Joriy o'quv yili (2024-2025)
  let yearId: number;
  const yRes = await db.query('SELECT id FROM years WHERE school_id = $1 AND name = $2 LIMIT 1', [schoolId, '2024-2025']);
  if (yRes.rows.length === 0) {
    const insY = await db.query(
      "INSERT INTO years (school_id, name, is_current, status) VALUES ($1, '2024-2025', true, 'a') RETURNING id",
      [schoolId]
    );
    yearId = insY.rows[0].id;
  } else {
    yearId = yRes.rows[0].id;
    await db.query('UPDATE years SET is_current = true WHERE id = $1', [yearId]);
  }

  // 4. Barcha o'qituvchilar, fanlar, sinflar, o'quvchilar va soxta loginlarni BUTUNLAY O'CHIRISH!
  await db.query("DELETE FROM users WHERE school_id = $1 AND role != 'owner'", [schoolId]);
  await db.query("DELETE FROM users WHERE username LIKE 'xatirchi65_%'");
  await db.query("DELETE FROM attendance_records WHERE school_id = $1", [schoolId]);
  await db.query("DELETE FROM attendance_sessions WHERE school_id = $1", [schoolId]);
  await db.query("DELETE FROM schedule_slots WHERE school_id = $1", [schoolId]);
  await db.query("DELETE FROM assignments WHERE school_id = $1", [schoolId]);
  await db.query("DELETE FROM students WHERE school_id = $1", [schoolId]);
  await db.query("DELETE FROM classes WHERE school_id = $1", [schoolId]);
  await db.query("DELETE FROM teachers WHERE school_id = $1", [schoolId]);
  await db.query("DELETE FROM subjects WHERE school_id = $1", [schoolId]);

  return {
    schoolId,
    message: 'Xatirchi tumani 65-maktab tozalandi: barcha o\'qituvchilar va fanlar butunlay o\'chirildi. Baza toza holatda tayyor.',
  };
}
