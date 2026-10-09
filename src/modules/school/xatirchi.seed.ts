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

  // 4. Fanlar (10 ta asosiy fan)
  const subjectsData = [
    { name: 'Matematika (Algebra / Geometriya)', code: 'MAT', color: '#1fa74f' },
    { name: 'Ona tili va adabiyot', code: 'ONA', color: '#3b5bdb' },
    { name: 'Ingliz tili', code: 'ING', color: '#e8590c' },
    { name: 'Fizika', code: 'FIZ', color: '#7048e8' },
    { name: 'Kimyo', code: 'KIM', color: '#1098ad' },
    { name: 'Biologiya', code: 'BIO', color: '#2b8a3e' },
    { name: 'Tarix', code: 'TAR', color: '#d6336c' },
    { name: 'Informatika va AT', code: 'INF', color: '#1c7ed6' },
    { name: 'Geografiya', code: 'GEO', color: '#f59f00' },
    { name: 'Jismoniy tarbiya', code: 'JIS', color: '#862e9c' },
  ];

  const subjectMap = new Map<string, number>();
  for (const s of subjectsData) {
    const exSub = await db.query('SELECT id FROM subjects WHERE school_id = $1 AND code = $2 LIMIT 1', [schoolId, s.code]);
    if (exSub.rows.length) {
      subjectMap.set(s.code, exSub.rows[0].id);
    } else {
      const ins = await db.query(
        'INSERT INTO subjects (school_id, name, code, color, status) VALUES ($1, $2, $3, $4, \'a\') RETURNING id',
        [schoolId, s.name, s.code, s.color]
      );
      subjectMap.set(s.code, ins.rows[0].id);
    }
  }

  // 5. Eski sinov/namunaviy loginlar va soxta ma'lumotlarni tozalash (Faqat owner qoladi!)
  await db.query("DELETE FROM users WHERE school_id = $1 AND role != 'owner'", [schoolId]);
  await db.query("DELETE FROM users WHERE username LIKE 'xatirchi65_%'");
  await db.query("DELETE FROM attendance_records WHERE school_id = $1", [schoolId]);
  await db.query("DELETE FROM attendance_sessions WHERE school_id = $1", [schoolId]);
  await db.query("DELETE FROM schedule_slots WHERE school_id = $1", [schoolId]);
  await db.query("DELETE FROM assignments WHERE school_id = $1", [schoolId]);
  await db.query("DELETE FROM students WHERE school_id = $1", [schoolId]);
  await db.query("DELETE FROM classes WHERE school_id = $1", [schoolId]);
  await db.query("DELETE FROM teachers WHERE school_id = $1", [schoolId]);

  return {
    schoolId,
    message: 'Xatirchi tumani 65-maktab tozalandi: namunaviy loginlar o\'chirildi, fanlar va baza yangi o\'qituvchilar uchun tayyorlandi.',
  };
}
