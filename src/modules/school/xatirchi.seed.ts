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

  // 5. O'qituvchilar, Rahbariyat va Foydalanuvchi hisoblari (Rollar)
  const teachersData = [
    {
      name: 'Normatov Alisher Rustamovich',
      code: 'DIR-01',
      phone: '+998901112233',
      pos: 'Maktab direktori',
      username: 'xatirchi65_director',
      role: 'director',
      pass: 'Director1234!',
    },
    {
      name: 'Saidova Dilnoza Tohirovna',
      code: 'ZAV-01',
      phone: '+998902223344',
      pos: 'O\'quv ishlari bo\'yicha direktor o\'rinbosari',
      username: 'xatirchi65_zavuch',
      role: 'admin',
      pass: 'Zavuch1234!',
    },
    {
      name: 'Sobirova Shahlo Odilovna',
      code: 'T-01',
      phone: '+998903334401',
      pos: 'Boshlang\'ich sinf o\'qituvchisi',
      username: 'xatirchi65_t1',
      role: 'teacher',
      pass: 'Teacher1234!',
    },
    {
      name: 'Hamroyeva Feruza Karim qizi',
      code: 'T-02',
      phone: '+998903334402',
      pos: 'Boshlang\'ich sinf o\'qituvchisi',
      username: 'xatirchi65_t2',
      role: 'teacher',
      pass: 'Teacher1234!',
    },
    {
      name: 'Rahmonov Jasur Olimovich',
      code: 'T-03',
      phone: '+998903334403',
      pos: 'Matematika fani o\'qituvchisi',
      username: 'xatirchi65_matem',
      role: 'teacher',
      pass: 'Teacher1234!',
    },
    {
      name: 'Toshmatova Malika Akramovna',
      code: 'T-04',
      phone: '+998903334404',
      pos: 'Ona tili va adabiyot fani o\'qituvchisi',
      username: 'xatirchi65_onatili',
      role: 'teacher',
      pass: 'Teacher1234!',
    },
    {
      name: 'Karimov Sardor Baxtiyorovich',
      code: 'T-05',
      phone: '+998903334405',
      pos: 'Ingliz tili fani o\'qituvchisi',
      username: 'xatirchi65_ingliz',
      role: 'teacher',
      pass: 'Teacher1234!',
    },
    {
      name: 'Berdiyev Ilhom Samarovich',
      code: 'T-06',
      phone: '+998903334406',
      pos: 'Fizika fani o\'qituvchisi',
      username: 'xatirchi65_fizika',
      role: 'teacher',
      pass: 'Teacher1234!',
    },
    {
      name: 'Yo\'ldoshev Bobur Komilovich',
      code: 'T-07',
      phone: '+998903334407',
      pos: 'Informatika fani o\'qituvchisi',
      username: 'xatirchi65_informatika',
      role: 'teacher',
      pass: 'Teacher1234!',
    },
    {
      name: 'Xoliqova Nargiza Shuhratovna',
      code: 'T-08',
      phone: '+998903334408',
      pos: 'Kimyo va biologiya fani o\'qituvchisi',
      username: 'xatirchi65_kimyo',
      role: 'teacher',
      pass: 'Teacher1234!',
    },
    {
      name: 'Murodov Elyor Zafarovich',
      code: 'T-09',
      phone: '+998903334409',
      pos: 'Tarix fani o\'qituvchisi',
      username: 'xatirchi65_tarix',
      role: 'teacher',
      pass: 'Teacher1234!',
    },
    {
      name: 'Qodirov Anvar Rustamovich',
      code: 'T-10',
      phone: '+998903334410',
      pos: 'Jismoniy tarbiya fani o\'qituvchisi',
      username: 'xatirchi65_sport',
      role: 'teacher',
      pass: 'Teacher1234!',
    },
  ];

  const teacherMap = new Map<string, number>();
  for (const t of teachersData) {
    let tId: number;
    const exT = await db.query('SELECT id FROM teachers WHERE school_id = $1 AND code = $2 LIMIT 1', [schoolId, t.code]);
    if (exT.rows.length) {
      tId = exT.rows[0].id;
      await db.query(
        'UPDATE teachers SET name = $1, phone = $2, position = $3 WHERE id = $4',
        [t.name, t.phone, t.pos, tId]
      );
    } else {
      const ins = await db.query(
        'INSERT INTO teachers (school_id, name, code, phone, position, status) VALUES ($1, $2, $3, $4, $5, \'a\') RETURNING id',
        [schoolId, t.name, t.code, t.phone, t.pos]
      );
      tId = ins.rows[0].id;
    }
    teacherMap.set(t.code, tId);

    // Foydalanuvchi hisobini yaratish / yangilash
    const uEx = await db.query('SELECT id FROM users WHERE username = $1 LIMIT 1', [t.username]);
    const pwHash = await hashPassword(t.pass);
    if (uEx.rows.length === 0) {
      await db.query(
        `INSERT INTO users (school_id, username, password_hash, role, teacher_id, must_change_password)
         VALUES ($1, $2, $3, $4, $5, false)`,
        [schoolId, t.username, pwHash, t.role, t.role === 'teacher' ? tId : null]
      );
    } else {
      await db.query(
        `UPDATE users SET school_id = $1, password_hash = $2, role = $3, teacher_id = $4, must_change_password = false WHERE id = $5`,
        [schoolId, pwHash, t.role, t.role === 'teacher' ? tId : null, uEx.rows[0].id]
      );
    }
  }

  // 6. Sinflar (1-A dan 11-B gacha — jami 22 ta sinf)
  const classesList = [
    { name: '1-A', leaderCode: 'T-01' },
    { name: '1-B', leaderCode: 'T-02' },
    { name: '2-A', leaderCode: 'T-01' },
    { name: '2-B', leaderCode: 'T-02' },
    { name: '3-A', leaderCode: null },
    { name: '3-B', leaderCode: null },
    { name: '4-A', leaderCode: null },
    { name: '4-B', leaderCode: null },
    { name: '5-A', leaderCode: 'T-03' }, // Rahmonov Jasur (Matematika)
    { name: '5-B', leaderCode: null },
    { name: '6-A', leaderCode: 'T-04' }, // Toshmatova Malika (Ona tili)
    { name: '6-B', leaderCode: null },
    { name: '7-A', leaderCode: 'T-05' }, // Karimov Sardor (Ingliz tili)
    { name: '7-B', leaderCode: null },
    { name: '8-A', leaderCode: 'T-06' }, // Berdiyev Ilhom (Fizika)
    { name: '8-B', leaderCode: null },
    { name: '9-A', leaderCode: 'T-07' }, // Yo'ldoshev Bobur (Informatika)
    { name: '9-B', leaderCode: null },
    { name: '10-A', leaderCode: 'T-08' }, // Xoliqova Nargiza (Kimyo)
    { name: '10-B', leaderCode: null },
    { name: '11-A', leaderCode: 'T-09' }, // Murodov Elyor (Tarix)
    { name: '11-B', leaderCode: 'T-10' }, // Qodirov Anvar (Sport)
  ];

  const classMap = new Map<string, number>();
  for (const c of classesList) {
    const leaderId = c.leaderCode ? (teacherMap.get(c.leaderCode) || null) : null;
    const existingC = await db.query(
      'SELECT id FROM classes WHERE school_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1',
      [schoolId, c.name]
    );

    if (existingC.rows.length) {
      classMap.set(c.name, existingC.rows[0].id);
      if (leaderId) {
        await db.query('UPDATE classes SET leader_teacher_id = $1 WHERE id = $2', [leaderId, existingC.rows[0].id]);
      }
    } else {
      const ins = await db.query(
        'INSERT INTO classes (school_id, year_id, name, leader_teacher_id, status) VALUES ($1, $2, $3, $4, \'a\') RETURNING id',
        [schoolId, yearId, c.name, leaderId]
      );
      classMap.set(c.name, ins.rows[0].id);
    }
  }

  // 7. O'quvchilar va Ota-onalar
  const studentsData = [
    // 5-A sinfi
    { className: '5-A', name: 'Aliyev Vali Jasurovich', phone: '+998905010001', parentName: 'Aliyev Jasur Olimovich', parentPhone: '+998905010002' },
    { className: '5-A', name: 'Karimova Ziyoda Sardorovna', phone: '+998905010003', parentName: 'Karimov Sardor Baxtiyorovich', parentPhone: '+998905010004' },
    { className: '5-A', name: 'Nazarov Samandar Boburovich', phone: '+998905010005', parentName: 'Nazarov Bobur Komilovich', parentPhone: '+998905010006' },
    { className: '5-A', name: 'Usmonova Diyora Farhodovna', phone: '+998905010007', parentName: 'Usmonov Farhod Alisherovich', parentPhone: '+998905010008' },
    { className: '5-A', name: 'Qobilov Javohir Ilhomovich', phone: '+998905010009', parentName: 'Qobilov Ilhom Samarovich', parentPhone: '+998905010010' },

    // 6-A sinfi
    { className: '6-A', name: 'Rustamov Azizbek Akmalovich', phone: '+998906010001', parentName: 'Rustamov Akmal Tohirovich', parentPhone: '+998906010002' },
    { className: '6-A', name: 'To\'xtayeva Rayhona Sherzodovna', phone: '+998906010003', parentName: 'To\'xtayev Sherzod Ilhomovich', parentPhone: '+998906010004' },
    { className: '6-A', name: 'Ergashev Bekzod Mansurovich', phone: '+998906010005', parentName: 'Ergashev Mansur Karimovich', parentPhone: '+998906010006' },

    // 7-A sinfi
    { className: '7-A', name: 'Shamsiyev Doniyor Baxtiyorovich', phone: '+998907010001', parentName: 'Shamsiyev Baxtiyor Olimovich', parentPhone: '+998907010002' },
    { className: '7-A', name: 'Mirzayeva Madinabonu Otabekovna', phone: '+998907010003', parentName: 'Mirzayev Otabek Rustamovich', parentPhone: '+998907010004' },
    { className: '7-A', name: 'Sobirov Shahzod Ulug\'bekovich', phone: '+998907010005', parentName: 'Sobirov Ulug\'bek Odilovich', parentPhone: '+998907010006' },

    // 8-A sinfi
    { className: '8-A', name: 'Hamidov Asadbek Zafarovich', phone: '+998908010001', parentName: 'Hamidov Zafar Alisherovich', parentPhone: '+998908010002' },
    { className: '8-A', name: 'Jalilova Sevara Kamolovna', phone: '+998908010003', parentName: 'Jalilov Kamol Saidovich', parentPhone: '+998908010004' },

    // 9-A sinfi
    { className: '9-A', name: 'Botirov Shoxrux Bobirovich', phone: '+998909010001', parentName: 'Botirov Bobir Karimov', parentPhone: '+998909010002' },
    { className: '9-A', name: 'Olimova Nigora Jasurovna', phone: '+998909010003', parentName: 'Olimov Jasur Rustamovich', parentPhone: '+998909010004' },

    // 10-A sinfi
    { className: '10-A', name: 'Yusupov Diyorbek Jamolovich', phone: '+998910010001', parentName: 'Yusupov Jamol Bekovich', parentPhone: '+998910010002' },
    { className: '10-A', name: 'Hasanova Mohira Tohirovna', phone: '+998910010003', parentName: 'Hasanov Tohir Aliyevich', parentPhone: '+998910010004' },

    // 11-A sinfi
    { className: '11-A', name: 'Qodirov Sardorbek Anvarovich', phone: '+998911010001', parentName: 'Qodirov Anvar Rustamovich', parentPhone: '+998903334410' },
    { className: '11-A', name: 'Zokirova Gulnoza Farhod qizi', phone: '+998911010003', parentName: 'Zokirov Farhod Ilhomovich', parentPhone: '+998911010004' },
  ];

  for (let i = 0; i < studentsData.length; i++) {
    const st = studentsData[i];
    const cId = classMap.get(st.className);
    if (!cId) continue;

    const existingSt = await db.query(
      'SELECT id FROM students WHERE school_id = $1 AND class_id = $2 AND LOWER(name) = LOWER($3) LIMIT 1',
      [schoolId, cId, st.name]
    );

    if (existingSt.rows.length === 0) {
      const code = `ST-${(100 + i).toString()}`;
      await db.query(
        `INSERT INTO students (school_id, class_id, name, code, phone, parent_name, parent_phone, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'a')`,
        [schoolId, cId, st.name, code, st.phone, st.parentName, st.parentPhone]
      );
    }
  }

  // 8. Fan biriktirishlar (Assignments)
  const assignmentsData = [
    { tCode: 'T-03', sCode: 'MAT', cName: '5-A' },
    { tCode: 'T-04', sCode: 'ONA', cName: '5-A' },
    { tCode: 'T-05', sCode: 'ING', cName: '5-A' },
    { tCode: 'T-07', sCode: 'INF', cName: '5-A' },

    { tCode: 'T-03', sCode: 'MAT', cName: '6-A' },
    { tCode: 'T-04', sCode: 'ONA', cName: '6-A' },
    { tCode: 'T-05', sCode: 'ING', cName: '6-A' },

    { tCode: 'T-06', sCode: 'FIZ', cName: '7-A' },
    { tCode: 'T-03', sCode: 'MAT', cName: '7-A' },
    { tCode: 'T-05', sCode: 'ING', cName: '7-A' },

    { tCode: 'T-06', sCode: 'FIZ', cName: '8-A' },
    { tCode: 'T-08', sCode: 'KIM', cName: '8-A' },
    { tCode: 'T-03', sCode: 'MAT', cName: '8-A' },

    { tCode: 'T-07', sCode: 'INF', cName: '9-A' },
    { tCode: 'T-08', sCode: 'KIM', cName: '9-A' },
    { tCode: 'T-09', sCode: 'TAR', cName: '9-A' },
  ];

  for (const asg of assignmentsData) {
    const tId = teacherMap.get(asg.tCode);
    const sId = subjectMap.get(asg.sCode);
    const cId = classMap.get(asg.cName);

    if (tId && sId && cId) {
      await db.query(
        `INSERT INTO assignments (school_id, teacher_id, subject_id, class_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (school_id, class_id, subject_id) DO NOTHING`,
        [schoolId, tId, sId, cId]
      );
    }
  }

  return {
    schoolId,
    message: 'Xatirchi tumani 65-maktab to\'liq sozlandi (22 ta sinf, fanlar, o\'qituvchilar, o\'quvchilar va rollar tayyor).',
  };
}
