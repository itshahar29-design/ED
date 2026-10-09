import { DbClient } from '../../db/client.js';
import { logAudit } from '../audit/audit.service.js';
import { AuthUser } from '../auth/permissions.js';

export function getTodayInTashkent(tz = 'Asia/Tashkent'): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

export interface SaveAttendanceInput {
  version: number;
  records: Record<number, 'p' | 'a' | 'l' | 'e'>;
  status?: 'draft' | 'submitted';
}

export interface AttendanceExcuseInput {
  student_id: number;
  date: string;
  reason: string;
  note?: string;
}

export interface ReportFilter {
  from?: string;
  to?: string;
  cid?: number;
  sid?: number;
  tid?: number;
  stid?: number;
}

export class AttendanceService {
  /**
   * Kun bo'yicha davomat sessiyalari va yozuvlarini olish
   */
  static async getAttendanceByDate(db: DbClient, schoolId: number, date: string) {
    const sessionsRes = await db.query(
      `SELECT s.id, s.date, s.schedule_slot_id, s.class_id as cid, s.subject_id as sid,
              s.teacher_id as tid, s.slot_no as n, s.year_id as yid, s.version, s.status,
              c.name as class_name, sub.name as subject_name, sub.color as subject_color,
              t.name as teacher_name
       FROM attendance_sessions s
       JOIN classes c ON s.class_id = c.id AND s.school_id = c.school_id
       JOIN subjects sub ON s.subject_id = sub.id AND s.school_id = sub.school_id
       JOIN teachers t ON s.teacher_id = t.id AND s.school_id = t.school_id
       WHERE s.school_id = $1 AND s.date = $2`,
      [schoolId, date]
    );

    const sessionIds = sessionsRes.rows.map((r) => r.id);
    let recordsBySession: Record<number, Record<number, string>> = {};

    if (sessionIds.length > 0) {
      const recordsRes = await db.query(
        `SELECT session_id, student_id, status FROM attendance_records
         WHERE school_id = $1 AND session_id = ANY($2::int[])`,
        [schoolId, sessionIds]
      );

      for (const rec of recordsRes.rows) {
        if (!recordsBySession[rec.session_id]) {
          recordsBySession[rec.session_id] = {};
        }
        recordsBySession[rec.session_id][rec.student_id] = rec.status;
      }
    }

    const excusesRes = await db.query(
      `SELECT student_id, date, reason, note, session_ids FROM attendance_excuses
       WHERE school_id = $1 AND date = $2`,
      [schoolId, date]
    );

    return {
      date,
      sessions: sessionsRes.rows.map((s) => ({
        ...s,
        records: recordsBySession[s.id] || {},
      })),
      excuses: excusesRes.rows,
    };
  }

  /**
   * Davomat sessiyasini saqlash (Upsert + Snapshot + Optimistic Locking)
   */
  static async saveSessionAttendance(
    db: DbClient,
    schoolId: number,
    slotId: number,
    date: string,
    input: SaveAttendanceInput,
    user: AuthUser,
    ipAddress?: string
  ) {
    const today = getTodayInTashkent();
    if (date > today && user.role !== 'owner') {
      throw new Error('Kelajak sanaga davomat yozib bo\'lmaydi');
    }

    // Jadvaldagi dars ma'lumotlarini olish
    const slotRes = await db.query(
      `SELECT s.id, s.class_id, s.teacher_id, s.slot_no, a.subject_id, c.year_id
       FROM schedule_slots s
       JOIN assignments a ON s.assignment_id = a.id AND s.school_id = a.school_id
       JOIN classes c ON s.class_id = c.id AND s.school_id = c.school_id
       WHERE s.school_id = $1 AND s.id = $2`,
      [schoolId, slotId]
    );

    if (slotRes.rows.length === 0) {
      throw new Error('Dars jadvalda topilmadi');
    }

    const slot = slotRes.rows[0];

    // Ruxsat tekshiruvi: faqat dars o'qituvchisi yoki direktor/admin
    if (user.role === 'teacher') {
      if (!user.teacher_id || user.teacher_id !== slot.teacher_id) {
        throw new Error('Siz faqat o\'zingizning darsingizga davomat qo\'ya olasiz');
      }
    }

    return await db.tx(async (tx) => {
      // Mavjud sessiyani tekshirish
      const existRes = await tx.query(
        `SELECT id, version, class_id, subject_id, teacher_id, slot_no, year_id
         FROM attendance_sessions
         WHERE school_id = $1 AND date = $2 AND schedule_slot_id = $3`,
        [schoolId, date, slotId]
      );

      let sessionId: number;
      let nextVersion = 1;

      if (existRes.rows.length > 0) {
        const currentSession = existRes.rows[0];

        // Optimistic locking tekshiruvi
        if (input.version && input.version !== currentSession.version) {
          // Boshqa foydalanuvchi yozgan joriy holatni qaytarish
          const currentRecs = await tx.query(
            'SELECT student_id, status FROM attendance_records WHERE school_id = $1 AND session_id = $2',
            [schoolId, currentSession.id]
          );
          const recsObj: Record<string, string> = {};
          currentRecs.rows.forEach((r) => {
            recsObj[r.student_id] = r.status;
          });

          const conflictError: any = new Error('Davomat boshqa foydalanuvchi tomonidan o\'zgartirilgan');
          conflictError.statusCode = 409;
          conflictError.current_version = currentSession.version;
          conflictError.current_records = recsObj;
          throw conflictError;
        }

        sessionId = currentSession.id;
        nextVersion = currentSession.version + 1;

        await tx.query(
          `UPDATE attendance_sessions
           SET version = $1, status = COALESCE($2, status), updated_at = NOW()
           WHERE school_id = $3 AND id = $4`,
          [nextVersion, input.status || null, schoolId, sessionId]
        );
      } else {
        // Yangi sessiya yaratish (snapshot saqlash)
        const sessStatus = input.status || 'submitted';
        const createRes = await tx.query(
          `INSERT INTO attendance_sessions (school_id, date, schedule_slot_id, class_id, subject_id, teacher_id, slot_no, year_id, status, version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1)
           RETURNING id`,
          [schoolId, date, slotId, slot.class_id, slot.subject_id, slot.teacher_id, slot.slot_no, slot.year_id, sessStatus]
        );
        sessionId = createRes.rows[0].id;
        nextVersion = 1;
      }

      // O'quvchilar yozuvlarini saqlash
      for (const [stIdStr, status] of Object.entries(input.records)) {
        const studentId = Number(stIdStr);
        if (!['p', 'a', 'l', 'e'].includes(status)) continue;

        let finalStatus = status;

        if (finalStatus === 'a') {
          // 6-A Ariza bo'yicha tekshiruv: qabul qilingan ariza bormi?
          const reqRes = await tx.query(
            `SELECT id, reason, note FROM excuse_requests
             WHERE school_id = $1 AND student_id = $2 AND status = 'approved'
               AND date_from <= $3 AND date_to >= $3`,
            [schoolId, studentId, date]
          );

          if (reqRes.rows.length > 0) {
            const appReq = reqRes.rows[0];
            finalStatus = 'e'; // Qabul qilingan ariza asosida avtomatik 'e' ga aylanadi!

            const excExist = await tx.query(
              `SELECT id, session_ids FROM attendance_excuses
               WHERE school_id = $1 AND student_id = $2 AND date = $3`,
              [schoolId, studentId, date]
            );

            if (excExist.rows.length > 0) {
              const exc = excExist.rows[0];
              const curIds: number[] = Array.isArray(exc.session_ids) ? exc.session_ids : JSON.parse(exc.session_ids || '[]');
              if (!curIds.includes(sessionId)) {
                curIds.push(sessionId);
                await tx.query(
                  `UPDATE attendance_excuses
                   SET session_ids = $1, source = $2, reason = $3
                   WHERE school_id = $4 AND id = $5`,
                  [JSON.stringify(curIds), `ariza#${appReq.id}`, appReq.reason, schoolId, exc.id]
                );
              }
            } else {
              await tx.query(
                `INSERT INTO attendance_excuses (school_id, student_id, date, reason, note, created_by, session_ids, source)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                  schoolId,
                  studentId,
                  date,
                  appReq.reason,
                  appReq.note || 'Ariza asosida',
                  user.id,
                  JSON.stringify([sessionId]),
                  `ariza#${appReq.id}`,
                ]
              );
            }

            await logAudit(tx, {
              school_id: schoolId,
              user_id: user.id,
              action: 'ATTENDANCE_AUTO_EXCUSED',
              entity: 'attendance_records',
              entity_id: `${sessionId}|${studentId}`,
              details: { student_id: studentId, date, excuse_request_id: appReq.id, source: `ariza#${appReq.id}` },
              ip_address: ipAddress,
            });
          } else {
            // Agar ariza bo'lmasa, mavjud excuse tekshiriladi
            const excRes = await tx.query(
              `SELECT id, session_ids FROM attendance_excuses
               WHERE school_id = $1 AND student_id = $2 AND date = $3`,
              [schoolId, studentId, date]
            );
            if (excRes.rows.length > 0) {
              const exc = excRes.rows[0];
              const currentIds: number[] = Array.isArray(exc.session_ids) ? exc.session_ids : JSON.parse(exc.session_ids || '[]');
              if (currentIds.includes(sessionId)) {
                const updatedIds = currentIds.filter((id) => id !== sessionId);
                await tx.query(
                  'UPDATE attendance_excuses SET session_ids = $1 WHERE school_id = $2 AND id = $3',
                  [JSON.stringify(updatedIds), schoolId, exc.id]
                );
                await logAudit(tx, {
                  school_id: schoolId,
                  user_id: user.id,
                  action: 'EXCUSE_SESSION_REMOVED_BY_TEACHER',
                  entity: 'attendance_excuses',
                  entity_id: String(exc.id),
                  details: { student_id: studentId, session_id: sessionId },
                  ip_address: ipAddress,
                });
              }
            }
          }
        }

        await tx.query(
          `INSERT INTO attendance_records (school_id, session_id, student_id, status)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (school_id, session_id, student_id)
           DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()`,
          [schoolId, sessionId, studentId, finalStatus]
        );
      }

      await logAudit(tx, {
        school_id: schoolId,
        user_id: user.id,
        action: 'ATTENDANCE_SAVED',
        entity: 'attendance_sessions',
        entity_id: String(sessionId),
        details: { date, slot_id: slotId, version: nextVersion, record_count: Object.keys(input.records).length },
        ip_address: ipAddress,
      });

      return {
        sessionId,
        version: nextVersion,
        status: input.status || (existRes.rows.length > 0 ? (existRes.rows[0].status || 'submitted') : 'submitted'),
        date,
        records: input.records,
      };
    }, schoolId);
  }

  /**
   * Davomat sessiyasini topshirish (status = 'submitted')
   */
  static async submitSessionAttendance(
    db: DbClient,
    schoolId: number,
    slotId: number,
    date: string,
    input: { version?: number; records?: Record<number, 'p' | 'a' | 'l' | 'e'> },
    user: AuthUser,
    ipAddress?: string
  ) {
    const today = getTodayInTashkent();
    if (date > today && user.role !== 'owner') {
      throw new Error('Kelajak sanaga davomat yozib bo\'lmaydi');
    }

    const saved = await this.saveSessionAttendance(
      db,
      schoolId,
      slotId,
      date,
      {
        version: input.version ?? 0,
        records: input.records || {},
        status: 'submitted',
      },
      user,
      ipAddress
    );

    await db.query(
      `UPDATE attendance_sessions SET status = 'submitted', updated_at = NOW()
       WHERE school_id = $1 AND id = $2`,
      [schoolId, saved.sessionId]
    );

    await logAudit(db, {
      school_id: schoolId,
      user_id: user.id,
      action: 'ATTENDANCE_SUBMITTED',
      entity: 'attendance_sessions',
      entity_id: String(saved.sessionId),
      details: { date, slot_id: slotId, version: saved.version },
      ip_address: ipAddress,
    });

    return {
      ...saved,
      status: 'submitted',
    };
  }

  /**
   * O'quvchini sababli qilish (attendance_excuses)
   */
  static async createExcuse(
    db: DbClient,
    schoolId: number,
    input: AttendanceExcuseInput,
    user: AuthUser,
    ipAddress?: string
  ) {
    const today = getTodayInTashkent();
    if (input.date > today && user.role !== 'owner') {
      throw new Error('Kelajak kunga sababli qo\'yib bo\'lmaydi');
    }

    return await db.tx(async (tx) => {
      // 1. O'sha kunda o'quvchining 'a' bo'lgan darslarini topish
      const absentRecs = await tx.query(
        `SELECT r.session_id
         FROM attendance_records r
         JOIN attendance_sessions s ON r.session_id = s.id AND r.school_id = s.school_id
         WHERE r.school_id = $1 AND r.student_id = $2 AND s.date = $3 AND r.status = 'a'`,
        [schoolId, input.student_id, input.date]
      );

      if (absentRecs.rows.length === 0) {
        throw new Error('Bu kunda «Yo\'q» dars topilmadi');
      }

      const affectedSessionIds = absentRecs.rows.map((r) => r.session_id);

      // 2. Yozuvlarni 'a' dan 'e' ga o'tkazish
      await tx.query(
        `UPDATE attendance_records
         SET status = 'e', updated_at = NOW()
         WHERE school_id = $1 AND student_id = $2 AND session_id = ANY($3::int[])`,
        [schoolId, input.student_id, affectedSessionIds]
      );

      // 3. attendance_excuses jadvaliga yozish
      await tx.query(
        `INSERT INTO attendance_excuses (school_id, student_id, date, reason, note, created_by, session_ids)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (school_id, student_id, date)
         DO UPDATE SET reason = EXCLUDED.reason, note = EXCLUDED.note, session_ids = EXCLUDED.session_ids, created_at = NOW()`,
        [
          schoolId,
          input.student_id,
          input.date,
          input.reason,
          input.note || '',
          user.id,
          JSON.stringify(affectedSessionIds),
        ]
      );

      await logAudit(tx, {
        school_id: schoolId,
        user_id: user.id,
        action: 'STUDENT_EXCUSED',
        entity: 'attendance_excuses',
        entity_id: `${input.date}|${input.student_id}`,
        details: { student_id: input.student_id, reason: input.reason, count: affectedSessionIds.length },
        ip_address: ipAddress,
      });

      return {
        student_id: input.student_id,
        date: input.date,
        excused_count: affectedSessionIds.length,
        session_ids: affectedSessionIds,
      };
    }, schoolId);
  }

  /**
   * Sababli belgisini bekor qilish
   */
  static async cancelExcuse(
    db: DbClient,
    schoolId: number,
    studentId: number,
    date: string,
    user: AuthUser,
    ipAddress?: string
  ) {
    return await db.tx(async (tx) => {
      const excRes = await tx.query(
        `SELECT id, session_ids FROM attendance_excuses
         WHERE school_id = $1 AND student_id = $2 AND date = $3`,
        [schoolId, studentId, date]
      );

      if (excRes.rows.length === 0) {
        throw new Error('Sababli ma\'lumoti topilmadi');
      }

      const exc = excRes.rows[0];
      const sessionIds: number[] = Array.isArray(exc.session_ids)
        ? exc.session_ids
        : JSON.parse(exc.session_ids || '[]');

      // Faqat shu session_ids dagi 'e' yozuvlar yana 'a' bo'ladi
      if (sessionIds.length > 0) {
        await tx.query(
          `UPDATE attendance_records
           SET status = 'a', updated_at = NOW()
           WHERE school_id = $1 AND student_id = $2 AND session_id = ANY($3::int[]) AND status = 'e'`,
          [schoolId, studentId, sessionIds]
        );
      }

      await tx.query(
        'DELETE FROM attendance_excuses WHERE school_id = $1 AND id = $2',
        [schoolId, exc.id]
      );

      await logAudit(tx, {
        school_id: schoolId,
        user_id: user.id,
        action: 'STUDENT_EXCUSE_CANCELLED',
        entity: 'attendance_excuses',
        entity_id: String(exc.id),
        details: { student_id: studentId, date },
        ip_address: ipAddress,
      });

      return { status: 'ok', message: 'Bekor qilindi' };
    }, schoolId);
  }

  /**
   * Hisobotlar generatsiyasi
   */
  static async generateReport(db: DbClient, schoolId: number, filter: ReportFilter, user?: AuthUser) {
    let sql = `
      SELECT r.student_id, r.status, s.date, s.class_id, s.subject_id, s.teacher_id, s.slot_no,
             st.name as student_name, c.name as class_name, sub.name as subject_name, t.name as teacher_name
      FROM attendance_records r
      JOIN attendance_sessions s ON r.session_id = s.id AND r.school_id = s.school_id
      JOIN students st ON r.student_id = st.id AND r.school_id = st.school_id
      JOIN classes c ON s.class_id = c.id AND s.school_id = c.school_id
      JOIN subjects sub ON s.subject_id = sub.id AND s.school_id = sub.school_id
      JOIN teachers t ON s.teacher_id = t.id AND s.school_id = t.school_id
      WHERE r.school_id = $1 AND s.status = 'submitted'
    `;
    const params: any[] = [schoolId];

    if (filter.from) {
      params.push(filter.from);
      sql += ` AND s.date >= $${params.length}`;
    }
    if (filter.to) {
      params.push(filter.to);
      sql += ` AND s.date <= $${params.length}`;
    }
    if (filter.cid) {
      params.push(filter.cid);
      sql += ` AND s.class_id = $${params.length}`;
    }
    if (filter.sid) {
      params.push(filter.sid);
      sql += ` AND s.subject_id = $${params.length}`;
    }
    if (filter.tid) {
      params.push(filter.tid);
      sql += ` AND s.teacher_id = $${params.length}`;
    }
    if (filter.stid) {
      params.push(filter.stid);
      sql += ` AND r.student_id = $${params.length}`;
    }

    // O'quvchi roli tekshiruvi: faqat o'zini ko'rishi mumkin
    if (user?.role === 'student' && user.student_id) {
      params.push(user.student_id);
      sql += ` AND r.student_id = $${params.length}`;
    }

    sql += ' ORDER BY s.date DESC, s.slot_no ASC';

    const res = await db.query(sql, params);
    const rows = res.rows;

    // Umumiy statistika hisoblash
    let p = 0;
    let a = 0;
    let l = 0;
    let e = 0;

    const studentMap: Record<number, { id: number; name: string; class_name: string; p: number; a: number; l: number; e: number; t: number; pct: number | null }> = {};

    for (const row of rows) {
      if (row.status === 'p') p++;
      else if (row.status === 'a') a++;
      else if (row.status === 'l') l++;
      else if (row.status === 'e') e++;

      if (!studentMap[row.student_id]) {
        studentMap[row.student_id] = {
          id: row.student_id,
          name: row.student_name,
          class_name: row.class_name,
          p: 0,
          a: 0,
          l: 0,
          e: 0,
          t: 0,
          pct: null,
        };
      }
      const st = studentMap[row.student_id];
      if (row.status === 'p') st.p++;
      else if (row.status === 'a') st.a++;
      else if (row.status === 'l') st.l++;
      else if (row.status === 'e') st.e++;
      st.t++;
    }

    const total = p + a + l + e;
    const overallPct = total > 0 ? Math.round(((total - a) / total) * 100) : null;

    const studentList = Object.values(studentMap).map((st) => {
      st.pct = st.t > 0 ? Math.round(((st.t - st.a) / st.t) * 100) : null;
      return st;
    }).sort((x, y) => (x.pct ?? 101) - (y.pct ?? 101));

    return {
      tally: { p, a, l, e, total, pct: overallPct },
      students: studentList,
      records: rows,
    };
  }

  /**
   * CSV formatiga o'tkazish (Formula injection himoyasi bilan)
   */
  static sanitizeCsvValue(val: any): string {
    let str = String(val == null ? '' : val);
    // Formula injection himoyasi: = + - @ bilan boshlansa ' qo'shish
    if (/^[=+\-@\t\r]/.test(str)) {
      str = "'" + str;
    }
    // Ichidagi qo'shtirnoqlarni dubllash
    return `"${str.replace(/"/g, '""')}"`;
  }

  static toCsv(reportData: any): string {
    const header = ['O\'quvchi', 'Sinf', 'Keldi', 'Yo\'q', 'Kechikdi', 'Sababli', 'Foiz'].join(',');
    const lines = [header];

    for (const st of reportData.students) {
      lines.push(
        [
          this.sanitizeCsvValue(st.name),
          this.sanitizeCsvValue(st.class_name),
          st.p,
          st.a,
          st.l,
          st.e,
          st.pct != null ? `${st.pct}%` : '–',
        ].join(',')
      );
    }

    // Excel uchun UTF-8 BOM
    return '\uFEFF' + lines.join('\n');
  }

  /**
   * Xavf ro'yxati (3 kun ketma-ket yo'q yoki 30 kunda <75%)
   */
  static async getRiskStudents(db: DbClient, schoolId: number) {
    const today = getTodayInTashkent();
    const d30 = new Date(today);
    d30.setDate(d30.getDate() - 30);
    const date30Str = d30.toISOString().slice(0, 10);

    const recsRes = await db.query(
      `SELECT r.student_id, r.status, s.date,
              st.name as student_name, c.id as class_id, c.name as class_name
       FROM attendance_records r
       JOIN attendance_sessions s ON r.session_id = s.id AND r.school_id = s.school_id
       JOIN students st ON r.student_id = st.id AND r.school_id = st.school_id
       JOIN classes c ON st.class_id = c.id AND st.school_id = c.school_id
       WHERE r.school_id = $1 AND s.status = 'submitted' AND s.date >= $2 AND s.date <= $3
       ORDER BY s.date DESC, s.slot_no ASC`,
      [schoolId, date30Str, today]
    );

    const studentData: Record<number, {
      student_id: number;
      student_name: string;
      class_id: number;
      class_name: string;
      total: number;
      absent: number;
      dates: Map<string, { total: number; absent: number }>;
    }> = {};

    for (const r of recsRes.rows) {
      if (!studentData[r.student_id]) {
        studentData[r.student_id] = {
          student_id: r.student_id,
          student_name: r.student_name,
          class_id: r.class_id,
          class_name: r.class_name,
          total: 0,
          absent: 0,
          dates: new Map(),
        };
      }
      const sd = studentData[r.student_id];
      sd.total++;
      if (r.status === 'a') sd.absent++;

      if (!sd.dates.has(r.date)) {
        sd.dates.set(r.date, { total: 0, absent: 0 });
      }
      const dayData = sd.dates.get(r.date)!;
      dayData.total++;
      if (r.status === 'a') dayData.absent++;
    }

    const riskList: Array<{
      student_id: number;
      student_name: string;
      class_id: number;
      class_name: string;
      reasons: string[];
      pct: number;
      consecutive_absent_days: number;
    }> = [];

    for (const sd of Object.values(studentData)) {
      if (sd.total === 0) continue;
      const pct = Math.round(((sd.total - sd.absent) / sd.total) * 100);
      const reasons: string[] = [];

      if (pct < 75) {
        reasons.push('low_rate');
      }

      const sortedDates = Array.from(sd.dates.keys()).sort().reverse();
      let consecutiveAbsent = 0;
      for (const d of sortedDates) {
        const dayStat = sd.dates.get(d)!;
        if (dayStat.absent > 0 && dayStat.absent === dayStat.total) {
          consecutiveAbsent++;
        } else {
          break;
        }
      }

      if (consecutiveAbsent >= 3) {
        reasons.push('consecutive_absent');
      }

      if (reasons.length > 0) {
        riskList.push({
          student_id: sd.student_id,
          student_name: sd.student_name,
          class_id: sd.class_id,
          class_name: sd.class_name,
          reasons,
          pct,
          consecutive_absent_days: consecutiveAbsent,
        });
      }
    }

    return riskList;
  }
}
