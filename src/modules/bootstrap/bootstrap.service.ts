import { DbClient } from '../../db/client.js';
import { AuthUser, ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } from '../auth/permissions.js';

export class BootstrapService {
  /**
   * Frontend uchun to'liq holatni shakllantirish (GET /bootstrap)
   */
  static async getBootstrapData(db: DbClient, schoolId: number, user: AuthUser) {
    // 1. Maktab sozlamalari
    const schoolRes = await db.query(
      `SELECT s.name, s.addr, s.phone, s.logo, s.days, s.times
       FROM school_settings s WHERE s.school_id = $1`,
      [schoolId]
    );
    const schoolSettings = schoolRes.rows[0] || {
      name: 'Maktab',
      addr: '',
      phone: '',
      logo: '🎓',
      days: [0, 1, 2, 3, 4],
      times: ['08:00-08:45', '08:55-09:40', '09:50-10:35', '10:45-11:30', '11:40-12:25', '12:35-13:20'],
    };

    // 2. O'quv yillari
    const yearsRes = await db.query(
      'SELECT id, name, is_current, status FROM years WHERE school_id = $1 ORDER BY id DESC',
      [schoolId]
    );
    const years = yearsRes.rows.map((y) => ({
      id: y.id,
      name: y.name,
      on: y.is_current ? 1 : 0,
      st: y.status || 'a',
    }));

    // 3. Fanlar
    const subjectsRes = await db.query(
      'SELECT id, name, code, color, status FROM subjects WHERE school_id = $1 ORDER BY id ASC',
      [schoolId]
    );
    const subjects = subjectsRes.rows.map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      color: s.color,
      st: s.status || 'a',
    }));

    // 4. O'qituvchilar
    const teachersRes = await db.query(
      'SELECT id, name, code, phone, position, status FROM teachers WHERE school_id = $1 ORDER BY id ASC',
      [schoolId]
    );
    const teachers = teachersRes.rows.map((t) => ({
      id: t.id,
      name: t.name,
      code: t.code,
      phone: t.phone || '',
      pos: t.position || 'O\'qituvchi',
      st: t.status || 'a',
    }));

    // 5. Sinflar
    const classesRes = await db.query(
      'SELECT id, year_id, name, leader_teacher_id, status FROM classes WHERE school_id = $1 ORDER BY id ASC',
      [schoolId]
    );
    const classes = classesRes.rows.map((c) => ({
      id: c.id,
      yid: c.year_id,
      name: c.name,
      tid: c.leader_teacher_id || 0,
      st: c.status || 'a',
    }));

    // 6. O'quvchilar
    const studentsRes = await db.query(
      `SELECT id, class_id, name, code, phone, parent_name, parent_phone, tg_username, dob, enrolled_at, status
       FROM students WHERE school_id = $1 ORDER BY id ASC`,
      [schoolId]
    );
    const students = studentsRes.rows.map((s) => ({
      id: s.id,
      cid: s.class_id,
      name: s.name,
      code: s.code,
      phone: s.phone || '',
      parent: s.parent_name || '',
      pphone: s.parent_phone || '',
      tg: s.tg_username || '',
      dob: s.dob ? String(s.dob).slice(0, 10) : '',
      enr: s.enrolled_at ? String(s.enrolled_at).slice(0, 10) : '',
      st: s.status || 'a',
    }));

    // 7. Biriktirishlar (Assignments)
    const assignsRes = await db.query(
      'SELECT id, teacher_id, subject_id, class_id FROM assignments WHERE school_id = $1 ORDER BY id ASC',
      [schoolId]
    );
    const assigns = assignsRes.rows.map((a) => ({
      id: a.id,
      tid: a.teacher_id,
      sid: a.subject_id,
      cid: a.class_id,
    }));

    // 8. Jadval (Schedule slots)
    const schedRes = await db.query(
      'SELECT id, day, slot_no, assignment_id FROM schedule_slots WHERE school_id = $1 ORDER BY day ASC, slot_no ASC',
      [schoolId]
    );
    const sched = schedRes.rows.map((s) => ({
      id: s.id,
      d: s.day,
      n: s.slot_no,
      aid: s.assignment_id,
    }));

    // 9. Davomat sessiyalari va yozuvlari (ses)
    const sessionsRes = await db.query(
      `SELECT id, date, schedule_slot_id, class_id, subject_id, teacher_id, slot_no, year_id, version, updated_at
       FROM attendance_sessions WHERE school_id = $1`,
      [schoolId]
    );

    const sesMap: Record<string, any> = {};
    if (sessionsRes.rows.length > 0) {
      const recordsRes = await db.query(
        'SELECT session_id, student_id, status FROM attendance_records WHERE school_id = $1',
        [schoolId]
      );
      const recsBySession: Record<number, Record<string, string>> = {};
      for (const rec of recordsRes.rows) {
        if (!recsBySession[rec.session_id]) recsBySession[rec.session_id] = {};
        recsBySession[rec.session_id][String(rec.student_id)] = rec.status;
      }

      for (const s of sessionsRes.rows) {
        const dateStr = s.date instanceof Date ? s.date.toISOString().slice(0, 10) : String(s.date).slice(0, 10);
        const schedId = s.schedule_slot_id || 0;
        const key = `${dateStr}|${schedId}`;
        sesMap[key] = {
          date: dateStr,
          schedId,
          aid: 0,
          cid: s.class_id,
          sid: s.subject_id,
          tid: s.teacher_id,
          n: s.slot_no,
          yid: s.year_id,
          recs: recsBySession[s.id] || {},
          ts: new Date(s.updated_at).getTime(),
          version: s.version,
          id: s.id,
        };
      }
    }

    // 10. Sababli (Excuses)
    const excusesRes = await db.query(
      'SELECT student_id, date, reason, note, session_ids FROM attendance_excuses WHERE school_id = $1',
      [schoolId]
    );
    const excuseMap: Record<string, any> = {};
    for (const exc of excusesRes.rows) {
      const dateStr = exc.date instanceof Date ? exc.date.toISOString().slice(0, 10) : String(exc.date).slice(0, 10);
      const key = `${dateStr}|${exc.student_id}`;
      const sIds = Array.isArray(exc.session_ids) ? exc.session_ids : JSON.parse(exc.session_ids || '[]');
      const kKeys = sIds.map((sid: number) => {
        const found = sessionsRes.rows.find((s) => s.id === sid);
        if (!found) return '';
        const d = found.date instanceof Date ? found.date.toISOString().slice(0, 10) : String(found.date).slice(0, 10);
        return `${d}|${found.schedule_slot_id || 0}`;
      }).filter(Boolean);

      excuseMap[key] = {
        r: exc.reason + (exc.note ? ': ' + exc.note : ''),
        k: kKeys,
      };
    }

    // 11. Rollar va Ruxsatlar (perm)
    const permsRes = await db.query(
      'SELECT role, permission FROM role_permissions WHERE school_id = $1',
      [schoolId]
    );
    const permMap: Record<string, string[]> = {
      owner: [...DEFAULT_ROLE_PERMISSIONS.owner],
      director: [],
      admin: [],
      teacher: [],
      student: [],
    };
    for (const p of permsRes.rows) {
      if (permMap[p.role]) {
        permMap[p.role].push(p.permission);
      }
    }
    // Agar bo'sh bo'lsa default'dan olish
    for (const role of ['director', 'admin', 'teacher', 'student'] as const) {
      if (permMap[role].length === 0) {
        permMap[role] = [...DEFAULT_ROLE_PERMISSIONS[role]];
      }
    }

    // 12. Telegram yuborilgan xabarlar (sent)
    const outboxRes = await db.query(
      'SELECT student_id, date FROM outbox_messages WHERE school_id = $1 AND status = \'sent\'',
      [schoolId]
    );
    const sentMap: Record<string, number> = {};
    for (const ob of outboxRes.rows) {
      const dateStr = ob.date instanceof Date ? ob.date.toISOString().slice(0, 10) : String(ob.date).slice(0, 10);
      sentMap[`${dateStr}|${ob.student_id}`] = 1;
    }

    // 13. Audit log (log: [[ts, text, role]])
    const auditRes = await db.query(
      `SELECT created_at, action, entity, entity_id, details
       FROM audit_log WHERE school_id = $1 ORDER BY id DESC LIMIT 50`,
      [schoolId]
    );
    const logs = auditRes.rows.map((al) => [
      new Date(al.created_at).getTime(),
      `${al.action}: ${al.entity} ${al.entity_id || ''}`,
      'system',
    ]);

    // Maksimal ID hisoblash
    const allIds = [
      ...years.map((x) => x.id),
      ...subjects.map((x) => x.id),
      ...teachers.map((x) => x.id),
      ...classes.map((x) => x.id),
      ...students.map((x) => x.id),
      ...assigns.map((x) => x.id),
      ...sched.map((x) => x.id),
    ];
    const maxId = allIds.length > 0 ? Math.max(...allIds) + 1 : 1;

    // Foydalanuvchilar (users)
    const usersRes = await db.query(
      `SELECT u.id, u.username, u.role, u.teacher_id, u.student_id, u.must_change_password, u.locked_until
       FROM users u WHERE u.school_id = $1 ORDER BY u.id ASC`,
      [schoolId]
    );

    // Maktablar ro'yxati (owner uchun)
    let schoolsList: any[] = [];
    if (user.role === 'owner') {
      const allSchoolsRes = await db.query('SELECT id, name, code, status, created_at FROM schools ORDER BY id ASC');
      schoolsList = allSchoolsRes.rows;
    }

    return {
      v: 1,
      n: maxId,
      theme: '',
      me: {
        role: user.role,
        id: user.teacher_id || user.student_id || user.id,
        username: user.username,
        user_id: user.id,
        support_school_id: user.support_school_id || null,
      },
      log: logs,
      school: {
        name: schoolSettings.name,
        addr: schoolSettings.addr || '',
        phone: schoolSettings.phone || '',
        logo: schoolSettings.logo || '🎓',
        days: typeof schoolSettings.days === 'string' ? JSON.parse(schoolSettings.days) : schoolSettings.days,
        times: typeof schoolSettings.times === 'string' ? JSON.parse(schoolSettings.times) : schoolSettings.times,
      },
      years,
      subjects,
      teachers,
      classes,
      students,
      assigns,
      sched,
      ses: sesMap,
      excuse: excuseMap,
      perm: permMap,
      sent: sentMap,
      users: usersRes.rows,
      schools: schoolsList,
    };
  }

  /**
   * Eski edm_school_v1 JSON ma'lumotlarini import qilish (Idempotent: takroriy yuborilsa dublikat yaratmaydi)
   */
  static async importData(db: DbClient, schoolId: number, data: any) {
    if (!data || typeof data !== 'object') {
      throw new Error('Yaroqsiz import ma\'lumoti');
    }

    return await db.tx(async (tx) => {
      // 1. Maktab sozlamalarini yangilash
      if (data.school) {
        await tx.query(
          `UPDATE school_settings
           SET name = COALESCE($1, name),
               addr = COALESCE($2, addr),
               phone = COALESCE($3, phone),
               logo = COALESCE($4, logo),
               days = COALESCE($5, days),
               times = COALESCE($6, times)
           WHERE school_id = $7`,
          [
            data.school.name,
            data.school.addr,
            data.school.phone,
            data.school.logo,
            data.school.days ? JSON.stringify(data.school.days) : null,
            data.school.times ? JSON.stringify(data.school.times) : null,
            schoolId,
          ]
        );
      }

      // Id xaritalash jadvallari: eskiId -> yangiId
      const yearMap = new Map<number, number>();
      const subjectMap = new Map<number, number>();
      const teacherMap = new Map<number, number>();
      const classMap = new Map<number, number>();
      const studentMap = new Map<number, number>();
      const assignMap = new Map<number, number>();

      // 2. O'quv yillari
      if (Array.isArray(data.years)) {
        for (const y of data.years) {
          const exist = await tx.query(
            'SELECT id FROM years WHERE school_id = $1 AND name = $2',
            [schoolId, y.name]
          );
          if (exist.rows.length > 0) {
            yearMap.set(y.id, exist.rows[0].id);
          } else {
            const ins = await tx.query(
              'INSERT INTO years (school_id, name, is_current, status) VALUES ($1, $2, $3, $4) RETURNING id',
              [schoolId, y.name, !!y.on, 'a']
            );
            yearMap.set(y.id, ins.rows[0].id);
          }
        }
      }

      // Default o'quv yili ID
      let defaultYearId = Array.from(yearMap.values())[0];
      if (!defaultYearId) {
        const curY = await tx.query('SELECT id FROM years WHERE school_id = $1 LIMIT 1', [schoolId]);
        defaultYearId = curY.rows[0]?.id;
      }

      // 3. Fanlar
      if (Array.isArray(data.subjects)) {
        for (const s of data.subjects) {
          const exist = await tx.query(
            'SELECT id FROM subjects WHERE school_id = $1 AND (LOWER(name) = LOWER($2) OR code = $3)',
            [schoolId, s.name, s.code]
          );
          if (exist.rows.length > 0) {
            subjectMap.set(s.id, exist.rows[0].id);
          } else {
            const ins = await tx.query(
              'INSERT INTO subjects (school_id, name, code, color, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
              [schoolId, s.name, s.code, s.color || '#3b5bdb', s.st || 'a']
            );
            subjectMap.set(s.id, ins.rows[0].id);
          }
        }
      }

      // 4. O'qituvchilar
      if (Array.isArray(data.teachers)) {
        for (const t of data.teachers) {
          const exist = await tx.query(
            'SELECT id FROM teachers WHERE school_id = $1 AND (LOWER(name) = LOWER($2) OR code = $3)',
            [schoolId, t.name, t.code]
          );
          if (exist.rows.length > 0) {
            teacherMap.set(t.id, exist.rows[0].id);
          } else {
            const ins = await tx.query(
              'INSERT INTO teachers (school_id, name, code, phone, position, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
              [schoolId, t.name, t.code, t.phone || '', t.pos || 'O\'qituvchi', t.st || 'a']
            );
            teacherMap.set(t.id, ins.rows[0].id);
          }
        }
      }

      // 5. Sinflar
      if (Array.isArray(data.classes)) {
        for (const c of data.classes) {
          const yid = yearMap.get(c.yid) || defaultYearId;
          const tid = teacherMap.get(c.tid) || null;

          const exist = await tx.query(
            'SELECT id FROM classes WHERE school_id = $1 AND year_id = $2 AND LOWER(name) = LOWER($3)',
            [schoolId, yid, c.name]
          );
          if (exist.rows.length > 0) {
            classMap.set(c.id, exist.rows[0].id);
          } else {
            const ins = await tx.query(
              'INSERT INTO classes (school_id, year_id, name, leader_teacher_id, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
              [schoolId, yid, c.name, tid, c.st || 'a']
            );
            classMap.set(c.id, ins.rows[0].id);
          }
        }
      }

      // 6. O'quvchilar
      if (Array.isArray(data.students)) {
        for (const s of data.students) {
          const cid = classMap.get(s.cid);
          if (!cid) continue;

          const exist = await tx.query(
            'SELECT id FROM students WHERE school_id = $1 AND class_id = $2 AND LOWER(name) = LOWER($3)',
            [schoolId, cid, s.name]
          );
          if (exist.rows.length > 0) {
            studentMap.set(s.id, exist.rows[0].id);
          } else {
            const ins = await tx.query(
              `INSERT INTO students (school_id, class_id, name, code, phone, parent_name, parent_phone, tg_username, dob, enrolled_at, status)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, CURRENT_DATE), $11) RETURNING id`,
              [
                schoolId,
                cid,
                s.name,
                s.code,
                s.phone || '',
                s.parent || '',
                s.pphone || '',
                s.tg || '',
                s.dob || null,
                s.enr || null,
                s.st || 'a',
              ]
            );
            studentMap.set(s.id, ins.rows[0].id);
          }
        }
      }

      // 7. Biriktirishlar (Assignments)
      if (Array.isArray(data.assigns)) {
        for (const a of data.assigns) {
          const tid = teacherMap.get(a.tid);
          const sid = subjectMap.get(a.sid);
          const cid = classMap.get(a.cid);
          if (!tid || !sid || !cid) continue;

          const exist = await tx.query(
            'SELECT id FROM assignments WHERE school_id = $1 AND class_id = $2 AND subject_id = $3',
            [schoolId, cid, sid]
          );
          if (exist.rows.length > 0) {
            assignMap.set(a.id, exist.rows[0].id);
          } else {
            const ins = await tx.query(
              'INSERT INTO assignments (school_id, teacher_id, subject_id, class_id) VALUES ($1, $2, $3, $4) RETURNING id',
              [schoolId, tid, sid, cid]
            );
            assignMap.set(a.id, ins.rows[0].id);
          }
        }
      }

      // 8. Jadval (Schedule slots)
      if (Array.isArray(data.sched)) {
        for (const sc of data.sched) {
          const aid = assignMap.get(sc.aid);
          if (!aid) continue;

          const asgRow = await tx.query(
            'SELECT teacher_id, class_id FROM assignments WHERE school_id = $1 AND id = $2',
            [schoolId, aid]
          );
          if (asgRow.rows.length === 0) continue;
          const { teacher_id, class_id } = asgRow.rows[0];

          // Collision tekshirish
          const exist = await tx.query(
            'SELECT id FROM schedule_slots WHERE school_id = $1 AND class_id = $2 AND day = $3 AND slot_no = $4',
            [schoolId, class_id, sc.d, sc.n]
          );
          if (exist.rows.length === 0) {
            await tx.query(
              `INSERT INTO schedule_slots (school_id, assignment_id, class_id, teacher_id, day, slot_no)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (school_id, class_id, day, slot_no) DO NOTHING`,
              [schoolId, aid, class_id, teacher_id, sc.d, sc.n]
            );
          }
        }
      }

      // 9. Davomat sessiyalari (ses)
      if (data.ses && typeof data.ses === 'object') {
        for (const [key, s] of Object.entries(data.ses) as [string, any][]) {
          const cid = classMap.get(s.cid);
          const sid = subjectMap.get(s.sid);
          const tid = teacherMap.get(s.tid);
          const yid = yearMap.get(s.yid) || defaultYearId;
          if (!cid || !sid || !tid) continue;

          const dateStr = s.date;

          // Sessiya mavjudligini tekshirish
          let sessId: number;
          const existSess = await tx.query(
            `SELECT id FROM attendance_sessions
             WHERE school_id = $1 AND date = $2 AND class_id = $3 AND slot_no = $4`,
            [schoolId, dateStr, cid, s.n]
          );

          if (existSess.rows.length > 0) {
            sessId = existSess.rows[0].id;
          } else {
            const insSess = await tx.query(
              `INSERT INTO attendance_sessions (school_id, date, schedule_slot_id, class_id, subject_id, teacher_id, slot_no, year_id, version)
               VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, 1) RETURNING id`,
              [schoolId, dateStr, cid, sid, tid, s.n, yid]
            );
            sessId = insSess.rows[0].id;
          }

          // Yozuvlarni kiritish
          if (s.recs && typeof s.recs === 'object') {
            for (const [oldStIdStr, stVal] of Object.entries(s.recs) as [string, any][]) {
              const newStId = studentMap.get(Number(oldStIdStr));
              if (!newStId) continue;

              await tx.query(
                `INSERT INTO attendance_records (school_id, session_id, student_id, status)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (school_id, session_id, student_id) DO NOTHING`,
                [schoolId, sessId, newStId, stVal]
              );
            }
          }
        }
      }

      return {
        status: 'ok',
        counts: {
          years: yearMap.size,
          subjects: subjectMap.size,
          teachers: teacherMap.size,
          classes: classMap.size,
          students: studentMap.size,
          assigns: assignMap.size,
        },
      };
    }, schoolId);
  }
}
