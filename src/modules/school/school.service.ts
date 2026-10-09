import { DbClient } from '../../db/client.js';
import { hashPassword } from '../auth/crypto.js';

export interface CreateStudentInput {
  class_id: number;
  name: string;
  code?: string;
  phone?: string;
  parent_name?: string;
  parent_phone?: string;
  tg_username?: string;
  dob?: string | null;
  enrolled_at?: string;
}

export class SchoolService {
  // ================= YEARS =================
  static async listYears(db: DbClient, schoolId: number) {
    const res = await db.query(
      'SELECT id, name, is_current as "on", status as st FROM years WHERE school_id = $1 ORDER BY id DESC',
      [schoolId]
    );
    return res.rows;
  }

  static async createYear(db: DbClient, schoolId: number, name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Yil nomini kiriting');

    const exist = await db.query('SELECT id FROM years WHERE school_id = $1 AND name = $2', [schoolId, trimmed]);
    if (exist.rows.length > 0) throw new Error('Bunday o\'quv yili mavjud');

    return await db.tx(async (tx) => {
      await tx.query('UPDATE years SET is_current = FALSE WHERE school_id = $1', [schoolId]);
      const res = await tx.query(
        'INSERT INTO years (school_id, name, is_current, status) VALUES ($1, $2, TRUE, $3) RETURNING id, name, is_current as "on", status as st',
        [schoolId, trimmed, 'a']
      );
      return res.rows[0];
    }, schoolId);
  }

  static async setCurrentYear(db: DbClient, schoolId: number, yearId: number) {
    return await db.tx(async (tx) => {
      await tx.query('UPDATE years SET is_current = FALSE WHERE school_id = $1', [schoolId]);
      const res = await tx.query(
        'UPDATE years SET is_current = TRUE WHERE school_id = $1 AND id = $2 RETURNING id, name, is_current as "on"',
        [schoolId, yearId]
      );
      if (res.rows.length === 0) throw new Error('O\'quv yili topilmadi');
      return res.rows[0];
    }, schoolId);
  }

  // ================= SUBJECTS =================
  static async listSubjects(db: DbClient, schoolId: number, includeArchived = false) {
    const sql = includeArchived
      ? 'SELECT id, name, code, color, status as st FROM subjects WHERE school_id = $1 ORDER BY id ASC'
      : 'SELECT id, name, code, color, status as st FROM subjects WHERE school_id = $1 AND status = \'a\' ORDER BY id ASC';
    const res = await db.query(sql, [schoolId]);
    return res.rows;
  }

  static async createSubject(db: DbClient, schoolId: number, name: string, code?: string, color?: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Fan nomini kiriting');
    const cd = (code?.trim() || trimmed.slice(0, 3)).toUpperCase();
    const clr = color || '#3b5bdb';

    const exist = await db.query(
      'SELECT id FROM subjects WHERE school_id = $1 AND (LOWER(name) = LOWER($2) OR code = $3)',
      [schoolId, trimmed, cd]
    );
    if (exist.rows.length > 0) throw new Error('Bunday fan yoki kod mavjud');

    const res = await db.query(
      'INSERT INTO subjects (school_id, name, code, color, status) VALUES ($1, $2, $3, $4, \'a\') RETURNING id, name, code, color, status as st',
      [schoolId, trimmed, cd, clr]
    );
    return res.rows[0];
  }

  static async updateSubject(db: DbClient, schoolId: number, id: number, name: string, code?: string, color?: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Fan nomini kiriting');
    const cd = (code?.trim() || trimmed.slice(0, 3)).toUpperCase();
    const clr = color || '#3b5bdb';

    const exist = await db.query(
      'SELECT id FROM subjects WHERE school_id = $1 AND id != $2 AND (LOWER(name) = LOWER($3) OR code = $4)',
      [schoolId, id, trimmed, cd]
    );
    if (exist.rows.length > 0) throw new Error('Bunday fan yoki kod mavjud');

    const res = await db.query(
      'UPDATE subjects SET name = $1, code = $2, color = $3 WHERE school_id = $4 AND id = $5 RETURNING id, name, code, color, status as st',
      [trimmed, cd, clr, schoolId, id]
    );
    if (res.rows.length === 0) throw new Error('Fan topilmadi');
    return res.rows[0];
  }

  static async setSubjectStatus(db: DbClient, schoolId: number, id: number, status: 'a' | 'x') {
    const res = await db.query(
      'UPDATE subjects SET status = $1 WHERE school_id = $2 AND id = $3 RETURNING id, name, status as st',
      [status, schoolId, id]
    );
    if (res.rows.length === 0) throw new Error('Fan topilmadi');
    return res.rows[0];
  }

  static async deleteSubject(db: DbClient, schoolId: number, id: number) {
    // Davomat tarixi bog'liq bo'lsa o'chirib bo'lmaydi
    const attRes = await db.query('SELECT id FROM attendance_sessions WHERE school_id = $1 AND subject_id = $2 LIMIT 1', [schoolId, id]);
    if (attRes.rows.length > 0) {
      throw new Error('Davomat tarixi bog\'liq — o\'chirib bo\'lmaydi. Arxivlang: tarix saqlanadi');
    }

    return await db.tx(async (tx) => {
      // Biriktirishlar va tegishli darslarni o'chirish
      await tx.query('DELETE FROM assignments WHERE school_id = $1 AND subject_id = $2', [schoolId, id]);
      const res = await tx.query('DELETE FROM subjects WHERE school_id = $1 AND id = $2 RETURNING id, name', [schoolId, id]);
      if (res.rows.length === 0) throw new Error('Fan topilmadi');
      return res.rows[0];
    }, schoolId);
  }

  // ================= TEACHERS =================
  static async listTeachers(db: DbClient, schoolId: number, includeArchived = false) {
    const sql = includeArchived
      ? 'SELECT id, name, code, phone, position as pos, status as st FROM teachers WHERE school_id = $1 ORDER BY id ASC'
      : 'SELECT id, name, code, phone, position as pos, status as st FROM teachers WHERE school_id = $1 AND status = \'a\' ORDER BY id ASC';
    const res = await db.query(sql, [schoolId]);
    return res.rows;
  }

  static async createTeacher(db: DbClient, schoolId: number, name: string, code?: string, phone?: string, position?: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('O\'qituvchi ismini kiriting');

    const countRes = await db.query('SELECT COUNT(*) as c FROM teachers WHERE school_id = $1', [schoolId]);
    const num = parseInt(countRes.rows[0].c, 10) + 1;
    const cd = code?.trim() || `T-${String(num).padStart(2, '0')}`;
    const pos = position?.trim() || 'O\'qituvchi';
    const ph = phone?.trim() || '';

    const res = await db.query(
      'INSERT INTO teachers (school_id, name, code, phone, position, status) VALUES ($1, $2, $3, $4, $5, \'a\') RETURNING id, name, code, phone, position as pos, status as st',
      [schoolId, trimmed, cd, ph, pos]
    );
    const teacher = res.rows[0];

    // Agar telefon kiritilgan bo'lsa, avtomatik tizim foydalanuvchisini yaratish (login uchun)
    if (ph) {
      try {
        let role = 'teacher';
        const pLow = pos.toLowerCase();
        if (pLow.includes('direktor') && !pLow.includes('o\'rinbosar')) {
          role = 'director';
        } else if (pLow.includes('o\'rinbosar') || pLow.includes('zavuch') || pLow.includes('admin')) {
          role = 'admin';
        }

        const normPhone = ph.startsWith('+') ? ph : ('+' + ph.replace(/\D/g, ''));
        const uEx = await db.query('SELECT id FROM users WHERE phone_e164 = $1 OR username = $1 LIMIT 1', [normPhone]);
        let userId: number;
        if (uEx.rows.length === 0) {
          const pwHash = await hashPassword('Maktab123!');
          const insU = await db.query(
            `INSERT INTO users (school_id, username, password_hash, role, teacher_id, phone_e164, full_name, status, must_change_password)
             VALUES ($1, $2, $3, $4, $5, $2, $6, 'active', false)
             RETURNING id`,
            [schoolId, normPhone, pwHash, role, teacher.id, trimmed]
          );
          userId = insU.rows[0].id;
        } else {
          userId = uEx.rows[0].id;
          await db.query(
            'UPDATE users SET school_id = $1, role = $2, teacher_id = $3, full_name = $4 WHERE id = $5',
            [schoolId, role, teacher.id, trimmed, userId]
          );
        }

        const posRes = await db.query('SELECT id FROM positions WHERE school_id = $1 AND key = $2 LIMIT 1', [schoolId, role]);
        if (posRes.rows.length) {
          await db.query(
            `INSERT INTO memberships (user_id, school_id, position_id, teacher_id, status)
             VALUES ($1, $2, $3, $4, 'active')
             ON CONFLICT DO NOTHING`,
            [userId, schoolId, posRes.rows[0].id, teacher.id]
          );
        }
      } catch (e) {
        console.warn('O\'qituvchiga login yaratishda ogohlantirish:', e);
      }
    }

    return teacher;
  }

  static async updateTeacher(db: DbClient, schoolId: number, id: number, name: string, code?: string, phone?: string, position?: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('O\'qituvchi ismini kiriting');

    const pos = position?.trim() || 'O\'qituvchi';
    const ph = phone?.trim() || '';

    const res = await db.query(
      'UPDATE teachers SET name = $1, code = $2, phone = $3, position = $4 WHERE school_id = $5 AND id = $6 RETURNING id, name, code, phone, position as pos, status as st',
      [trimmed, code?.trim() || `T-${id}`, ph, pos, schoolId, id]
    );
    if (res.rows.length === 0) throw new Error('O\'qituvchi topilmadi');
    const teacher = res.rows[0];

    if (ph) {
      try {
        let role = 'teacher';
        const pLow = pos.toLowerCase();
        if (pLow.includes('direktor') && !pLow.includes('o\'rinbosar')) {
          role = 'director';
        } else if (pLow.includes('o\'rinbosar') || pLow.includes('zavuch') || pLow.includes('admin')) {
          role = 'admin';
        }

        const normPhone = ph.startsWith('+') ? ph : ('+' + ph.replace(/\D/g, ''));
        const uEx = await db.query('SELECT id FROM users WHERE teacher_id = $1 AND school_id = $2 LIMIT 1', [id, schoolId]);
        if (uEx.rows.length) {
          await db.query(
            'UPDATE users SET username = $1, phone_e164 = $1, full_name = $2, role = $3 WHERE id = $4',
            [normPhone, trimmed, role, uEx.rows[0].id]
          );
        } else {
          const pwHash = await hashPassword('Maktab123!');
          await db.query(
            `INSERT INTO users (school_id, username, password_hash, role, teacher_id, phone_e164, full_name, status, must_change_password)
             VALUES ($1, $2, $3, $4, $5, $2, $6, 'active', false)
             ON CONFLICT (phone_e164) DO UPDATE SET teacher_id = EXCLUDED.teacher_id, role = EXCLUDED.role, full_name = EXCLUDED.full_name`,
            [schoolId, normPhone, pwHash, role, id, trimmed]
          );
        }
      } catch (e) {
        console.warn('O\'qituvchi hisobini yangilashda ogohlantirish:', e);
      }
    }

    return teacher;
  }

  static async setTeacherStatus(db: DbClient, schoolId: number, id: number, status: 'a' | 'x') {
    const res = await db.query(
      'UPDATE teachers SET status = $1 WHERE school_id = $2 AND id = $3 RETURNING id, name, status as st',
      [status, schoolId, id]
    );
    if (res.rows.length === 0) throw new Error('O\'qituvchi topilmadi');
    return res.rows[0];
  }

  static async deleteTeacher(db: DbClient, schoolId: number, id: number) {
    const attRes = await db.query('SELECT id FROM attendance_sessions WHERE school_id = $1 AND teacher_id = $2 LIMIT 1', [schoolId, id]);
    if (attRes.rows.length > 0) {
      throw new Error('Davomat tarixi bog\'liq — o\'chirib bo\'lmaydi. Arxivlang: tarix saqlanadi');
    }

    return await db.tx(async (tx) => {
      await tx.query('UPDATE classes SET leader_teacher_id = NULL WHERE school_id = $1 AND leader_teacher_id = $2', [schoolId, id]);
      await tx.query('DELETE FROM assignments WHERE school_id = $1 AND teacher_id = $2', [schoolId, id]);
      const res = await tx.query('DELETE FROM teachers WHERE school_id = $1 AND id = $2 RETURNING id, name', [schoolId, id]);
      if (res.rows.length === 0) throw new Error('O\'qituvchi topilmadi');
      return res.rows[0];
    }, schoolId);
  }

  // ================= CLASSES =================
  static async listClasses(db: DbClient, schoolId: number, includeArchived = false) {
    const sql = includeArchived
      ? 'SELECT id, year_id as yid, name, leader_teacher_id as tid, status as st FROM classes WHERE school_id = $1 ORDER BY id ASC'
      : 'SELECT id, year_id as yid, name, leader_teacher_id as tid, status as st FROM classes WHERE school_id = $1 AND status = \'a\' ORDER BY id ASC';
    const res = await db.query(sql, [schoolId]);
    return res.rows;
  }

  static async createClass(db: DbClient, schoolId: number, yearId: number, name: string, leaderTeacherId?: number | null) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Sinf nomini kiriting');

    const exist = await db.query(
      'SELECT id FROM classes WHERE school_id = $1 AND year_id = $2 AND LOWER(name) = LOWER($3)',
      [schoolId, yearId, trimmed]
    );
    if (exist.rows.length > 0) throw new Error('Bu o\'quv yilida bunday sinf bor');

    const res = await db.query(
      'INSERT INTO classes (school_id, year_id, name, leader_teacher_id, status) VALUES ($1, $2, $3, $4, \'a\') RETURNING id, year_id as yid, name, leader_teacher_id as tid, status as st',
      [schoolId, yearId, trimmed, leaderTeacherId || null]
    );
    return res.rows[0];
  }

  static async updateClass(db: DbClient, schoolId: number, id: number, name: string, leaderTeacherId?: number | null) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Sinf nomini kiriting');

    const res = await db.query(
      'UPDATE classes SET name = $1, leader_teacher_id = $2 WHERE school_id = $3 AND id = $4 RETURNING id, year_id as yid, name, leader_teacher_id as tid, status as st',
      [trimmed, leaderTeacherId || null, schoolId, id]
    );
    if (res.rows.length === 0) throw new Error('Sinf topilmadi');
    return res.rows[0];
  }

  static async setClassStatus(db: DbClient, schoolId: number, id: number, status: 'a' | 'x') {
    const res = await db.query(
      'UPDATE classes SET status = $1 WHERE school_id = $2 AND id = $3 RETURNING id, name, status as st',
      [status, schoolId, id]
    );
    if (res.rows.length === 0) throw new Error('Sinf topilmadi');
    return res.rows[0];
  }

  static async deleteClass(db: DbClient, schoolId: number, id: number) {
    // O'quvchisi bor sinf o'chirilmaydi
    const stRes = await db.query('SELECT id FROM students WHERE school_id = $1 AND class_id = $2 LIMIT 1', [schoolId, id]);
    if (stRes.rows.length > 0) {
      throw new Error('Sinfda o\'quvchilar bor. Avval ularni boshqa sinfga ko\'chiring yoki sinfni arxivlang');
    }

    const attRes = await db.query('SELECT id FROM attendance_sessions WHERE school_id = $1 AND class_id = $2 LIMIT 1', [schoolId, id]);
    if (attRes.rows.length > 0) {
      throw new Error('Davomat tarixi bog\'liq — o\'chirib bo\'lmaydi. Arxivlang: tarix saqlanadi');
    }

    return await db.tx(async (tx) => {
      await tx.query('DELETE FROM assignments WHERE school_id = $1 AND class_id = $2', [schoolId, id]);
      const res = await tx.query('DELETE FROM classes WHERE school_id = $1 AND id = $2 RETURNING id, name', [schoolId, id]);
      if (res.rows.length === 0) throw new Error('Sinf topilmadi');
      return res.rows[0];
    }, schoolId);
  }

  // ================= STUDENTS =================
  static async listStudents(db: DbClient, schoolId: number, includeArchived = false, classId?: number) {
    let sql = 'SELECT id, class_id as cid, name, code, phone, parent_name as parent, parent_phone as pphone, tg_username as tg, dob, enrolled_at as enr, status as st FROM students WHERE school_id = $1';
    const params: any[] = [schoolId];

    if (!includeArchived) {
      sql += ' AND status = \'a\'';
    }
    if (classId) {
      params.push(classId);
      sql += ` AND class_id = $${params.length}`;
    }
    sql += ' ORDER BY id ASC';

    const res = await db.query(sql, params);
    return res.rows;
  }

  static async getStudentById(db: DbClient, schoolId: number, id: number) {
    const res = await db.query(
      'SELECT id, class_id as cid, name, code, phone, parent_name as parent, parent_phone as pphone, tg_username as tg, dob, enrolled_at as enr, status as st FROM students WHERE school_id = $1 AND id = $2',
      [schoolId, id]
    );
    return res.rows[0] || null;
  }

  static async createStudent(db: DbClient, schoolId: number, input: CreateStudentInput) {
    const trimmed = input.name.trim();
    if (!trimmed) throw new Error('O\'quvchi ismini kiriting');
    if (!input.class_id) throw new Error('Sinfni tanlang');

    // Tug'ilgan sana kelajakda bo'lishi mumkin emas
    if (input.dob) {
      const dobDate = new Date(input.dob);
      if (dobDate > new Date()) {
        throw new Error('Tug\'ilgan sana kelajakda bo\'lishi mumkin emas');
      }
    }

    // Telegram @username validatsiyasi
    if (input.tg_username && input.tg_username.trim()) {
      const tg = input.tg_username.trim();
      if (!/^@[A-Za-z0-9_]{4,32}$/.test(tg)) {
        throw new Error('Telegram @username ko\'rinishida bo\'lsin yoki bo\'sh qoldiring');
      }
    }

    const exist = await db.query(
      'SELECT id FROM students WHERE school_id = $1 AND class_id = $2 AND LOWER(name) = LOWER($3)',
      [schoolId, input.class_id, trimmed]
    );
    if (exist.rows.length > 0) throw new Error('Bu sinfda bunday o\'quvchi bor');

    const countRes = await db.query('SELECT COUNT(*) as c FROM students WHERE school_id = $1', [schoolId]);
    const num = parseInt(countRes.rows[0].c, 10) + 1;
    const code = input.code?.trim() || `S-${String(num).padStart(2, '0')}`;

    const res = await db.query(
      `INSERT INTO students (school_id, class_id, name, code, phone, parent_name, parent_phone, tg_username, dob, enrolled_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, CURRENT_DATE), 'a')
       RETURNING id, class_id as cid, name, code, phone, parent_name as parent, parent_phone as pphone, tg_username as tg, dob, enrolled_at as enr, status as st`,
      [
        schoolId,
        input.class_id,
        trimmed,
        code,
        input.phone?.trim() || '',
        input.parent_name?.trim() || '',
        input.parent_phone?.trim() || '',
        input.tg_username?.trim() || '',
        input.dob || null,
        input.enrolled_at || null,
      ]
    );
    return res.rows[0];
  }

  static async createStudentsBulk(db: DbClient, schoolId: number, classId: number, rawNames: string | string[]) {
    const list = Array.isArray(rawNames)
      ? rawNames.map((n) => n.trim()).filter(Boolean)
      : rawNames.split(/[\n,;]+/).map((n) => n.trim()).filter(Boolean);

    if (list.length === 0) throw new Error('Kamida bitta ism kiriting');

    return await db.tx(async (tx) => {
      let createdCount = 0;
      let skippedCount = 0;

      for (const name of list) {
        const exist = await tx.query(
          'SELECT id FROM students WHERE school_id = $1 AND class_id = $2 AND LOWER(name) = LOWER($3)',
          [schoolId, classId, name]
        );
        if (exist.rows.length > 0) {
          skippedCount++;
          continue;
        }

        const countRes = await tx.query('SELECT COUNT(*) as c FROM students WHERE school_id = $1', [schoolId]);
        const num = parseInt(countRes.rows[0].c, 10) + 1;
        const code = `S-${String(num).padStart(2, '0')}`;

        await tx.query(
          `INSERT INTO students (school_id, class_id, name, code, phone, parent_name, parent_phone, tg_username, status)
           VALUES ($1, $2, $3, $4, '', '', '', '', 'a')`,
          [schoolId, classId, name, code]
        );
        createdCount++;
      }

      return { count: createdCount, skipped: skippedCount };
    }, schoolId);
  }

  static async updateStudent(db: DbClient, schoolId: number, id: number, input: CreateStudentInput) {
    const trimmed = input.name.trim();
    if (!trimmed) throw new Error('O\'quvchi ismini kiriting');

    if (input.dob) {
      const dobDate = new Date(input.dob);
      if (dobDate > new Date()) {
        throw new Error('Tug\'ilgan sana kelajakda bo\'lishi mumkin emas');
      }
    }

    if (input.tg_username && input.tg_username.trim()) {
      const tg = input.tg_username.trim();
      if (!/^@[A-Za-z0-9_]{4,32}$/.test(tg)) {
        throw new Error('Telegram @username ko\'rinishida bo\'lsin yoki bo\'sh qoldiring');
      }
    }

    const exist = await db.query(
      'SELECT id FROM students WHERE school_id = $1 AND class_id = $2 AND LOWER(name) = LOWER($3) AND id != $4',
      [schoolId, input.class_id, trimmed, id]
    );
    if (exist.rows.length > 0) throw new Error('Bu sinfda bunday o\'quvchi bor');

    const res = await db.query(
      `UPDATE students
       SET class_id = $1, name = $2, phone = $3, parent_name = $4, parent_phone = $5, tg_username = $6, dob = $7
       WHERE school_id = $8 AND id = $9
       RETURNING id, class_id as cid, name, code, phone, parent_name as parent, parent_phone as pphone, tg_username as tg, dob, enrolled_at as enr, status as st`,
      [
        input.class_id,
        trimmed,
        input.phone?.trim() || '',
        input.parent_name?.trim() || '',
        input.parent_phone?.trim() || '',
        input.tg_username?.trim() || '',
        input.dob || null,
        schoolId,
        id,
      ]
    );
    if (res.rows.length === 0) throw new Error('O\'quvchi topilmadi');
    return res.rows[0];
  }

  static async setStudentStatus(db: DbClient, schoolId: number, id: number, status: 'a' | 'x') {
    // Agar arxivdan tiklanayotgan bo'lsa (status == 'a'), uning sinfi faol ('a') bo'lishi shart!
    if (status === 'a') {
      const stRes = await db.query(
        `SELECT s.id, c.name as class_name, c.status as class_status
         FROM students s
         JOIN classes c ON s.class_id = c.id AND s.school_id = c.school_id
         WHERE s.school_id = $1 AND s.id = $2`,
        [schoolId, id]
      );
      if (stRes.rows.length > 0 && stRes.rows[0].class_status !== 'a') {
        throw new Error(`Avval «${stRes.rows[0].class_name}» sinfini tiklang`);
      }
    }

    const res = await db.query(
      'UPDATE students SET status = $1 WHERE school_id = $2 AND id = $3 RETURNING id, name, status as st',
      [status, schoolId, id]
    );
    if (res.rows.length === 0) throw new Error('O\'quvchi topilmadi');
    return res.rows[0];
  }

  static async deleteStudent(db: DbClient, schoolId: number, id: number) {
    // Davomat tarixi bog'liq bo'lsa o'chirib bo'lmaydi
    const attRes = await db.query(
      'SELECT session_id FROM attendance_records WHERE school_id = $1 AND student_id = $2 LIMIT 1',
      [schoolId, id]
    );
    if (attRes.rows.length > 0) {
      throw new Error('Davomat tarixi bog\'liq — o\'chirib bo\'lmaydi. Arxivlang: tarix saqlanadi');
    }

    const res = await db.query('DELETE FROM students WHERE school_id = $1 AND id = $2 RETURNING id, name', [schoolId, id]);
    if (res.rows.length === 0) throw new Error('O\'quvchi topilmadi');
    return res.rows[0];
  }

  // ================= ASSIGNMENTS =================
  static async listAssignments(db: DbClient, schoolId: number, teacherId?: number) {
    let sql = 'SELECT id, teacher_id as tid, subject_id as sid, class_id as cid FROM assignments WHERE school_id = $1';
    const params: any[] = [schoolId];
    if (teacherId) {
      params.push(teacherId);
      sql += ' AND teacher_id = $2';
    }
    sql += ' ORDER BY id ASC';
    const res = await db.query(sql, params);
    return res.rows;
  }

  static async createAssignment(db: DbClient, schoolId: number, teacherId: number, subjectId: number, classId: number) {
    // Unikallik: (school_id, class_id, subject_id)
    const exist = await db.query(
      'SELECT id, teacher_id FROM assignments WHERE school_id = $1 AND class_id = $2 AND subject_id = $3',
      [schoolId, classId, subjectId]
    );
    if (exist.rows.length > 0) {
      if (exist.rows[0].teacher_id === teacherId) {
        throw new Error('Bu allaqachon biriktirilgan');
      }
      throw new Error('Bu fan shu sinfda boshqa o\'qituvchiga biriktirilgan');
    }

    const res = await db.query(
      'INSERT INTO assignments (school_id, teacher_id, subject_id, class_id) VALUES ($1, $2, $3, $4) RETURNING id, teacher_id as tid, subject_id as sid, class_id as cid',
      [schoolId, teacherId, subjectId, classId]
    );
    return res.rows[0];
  }

  static async deleteAssignment(db: DbClient, schoolId: number, id: number) {
    // Biriktirish olib tashlansa, jadvaldagi darslar ham ketadi, davomat tarixi qoladi
    return await db.tx(async (tx) => {
      await tx.query('DELETE FROM schedule_slots WHERE school_id = $1 AND assignment_id = $2', [schoolId, id]);
      const res = await tx.query('DELETE FROM assignments WHERE school_id = $1 AND id = $2 RETURNING id', [schoolId, id]);
      if (res.rows.length === 0) throw new Error('Biriktirish topilmadi');
      return res.rows[0];
    }, schoolId);
  }

  // ================= SCHEDULE SLOTS =================
  static async listSchedule(db: DbClient, schoolId: number, classId?: number, teacherId?: number) {
    let sql = 'SELECT id, day as d, slot_no as n, assignment_id as aid, class_id as cid, teacher_id as tid FROM schedule_slots WHERE school_id = $1';
    const params: any[] = [schoolId];
    if (classId) {
      params.push(classId);
      sql += ` AND class_id = $${params.length}`;
    }
    if (teacherId) {
      params.push(teacherId);
      sql += ` AND teacher_id = $${params.length}`;
    }
    sql += ' ORDER BY day ASC, slot_no ASC';
    const res = await db.query(sql, params);
    return res.rows;
  }

  static async setScheduleSlot(db: DbClient, schoolId: number, assignmentId: number, day: number, slotNo: number) {
    // Assignment ma'lumotlarini olish
    const asgRes = await db.query(
      'SELECT id, teacher_id, class_id, subject_id FROM assignments WHERE school_id = $1 AND id = $2',
      [schoolId, assignmentId]
    );
    if (asgRes.rows.length === 0) throw new Error('Biriktirish topilmadi');
    const asg = asgRes.rows[0];

    // To'qnashuv 1: O'qituvchi bir vaqtda boshqa sinfda bo'la olmaydi
    const teacherBusy = await db.query(
      `SELECT s.id, c.name as class_name
       FROM schedule_slots s
       JOIN classes c ON s.class_id = c.id AND s.school_id = c.school_id
       WHERE s.school_id = $1 AND s.teacher_id = $2 AND s.day = $3 AND s.slot_no = $4 AND s.class_id != $5`,
      [schoolId, asg.teacher_id, day, slotNo, asg.class_id]
    );
    if (teacherBusy.rows.length > 0) {
      throw new Error(`O'qituvchi shu vaqtda «${teacherBusy.rows[0].class_name}» sinfida dars beradi`);
    }

    // Sinfning shu vaqtdagi darsi bormi (agar bo'lsa uni almashtirish yoki yangi qo'shish)
    return await db.tx(async (tx) => {
      const currentSlot = await tx.query(
        'SELECT id FROM schedule_slots WHERE school_id = $1 AND class_id = $2 AND day = $3 AND slot_no = $4',
        [schoolId, asg.class_id, day, slotNo]
      );

      if (currentSlot.rows.length > 0) {
        const res = await tx.query(
          `UPDATE schedule_slots
           SET assignment_id = $1, teacher_id = $2
           WHERE school_id = $3 AND id = $4
           RETURNING id, day as d, slot_no as n, assignment_id as aid, class_id as cid, teacher_id as tid`,
          [assignmentId, asg.teacher_id, schoolId, currentSlot.rows[0].id]
        );
        return res.rows[0];
      }

      const res = await tx.query(
        `INSERT INTO schedule_slots (school_id, assignment_id, class_id, teacher_id, day, slot_no)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, day as d, slot_no as n, assignment_id as aid, class_id as cid, teacher_id as tid`,
        [schoolId, assignmentId, asg.class_id, asg.teacher_id, day, slotNo]
      );
      return res.rows[0];
    }, schoolId);
  }

  static async deleteScheduleSlot(db: DbClient, schoolId: number, id: number) {
    const res = await db.query('DELETE FROM schedule_slots WHERE school_id = $1 AND id = $2 RETURNING id', [schoolId, id]);
    if (res.rows.length === 0) throw new Error('Dars topilmadi');
    return res.rows[0];
  }
}
