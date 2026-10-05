import { DbClient } from '../../db/client.js';
import {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  hashSessionToken,
  generateTempPassword,
} from './crypto.js';
import { AuthUser, DEFAULT_ROLE_PERMISSIONS, Permission } from './permissions.js';
import { logAudit } from '../audit/audit.service.js';
import { seedXatirchiSchool } from '../school/xatirchi.seed.js';

export interface LoginResult {
  sessionToken: string;
  user: AuthUser;
  mustChangePassword: boolean;
  expiresAt: Date;
}

export class AuthService {
  /**
   * Tizimda kamida bitta owner bo'lishini ta'minlash va 65-maktabni tayyorlash
   */
  static async seedInitialOwner(db: DbClient): Promise<void> {
    const ownerRes = await db.query('SELECT id FROM users WHERE role = $1 LIMIT 1', ['owner']);
    if (ownerRes.rows.length === 0) {
      const pwHash = await hashPassword('Owner123456!');
      await db.query(
        `INSERT INTO users (username, password_hash, role, must_change_password)
         VALUES ($1, $2, $3, $4)`,
        ['owner', pwHash, 'owner', false]
      );
      console.log('Default owner yaratildi: username="owner", parol="Owner123456!"');
    }

    // +998996893228 raqamini ham owner sifatida ta'minlash
    const phoneOwner = await db.query('SELECT id FROM users WHERE username = $1 OR username = $2', ['+998996893228', '998996893228']);
    if (phoneOwner.rows.length === 0) {
      const pwHash = await hashPassword('Owner123456!');
      await db.query(
        `INSERT INTO users (username, password_hash, role, must_change_password)
         VALUES ($1, $2, 'owner', false)`,
        ['+998996893228', pwHash]
      );
    } else {
      await db.query('UPDATE users SET role = \'owner\' WHERE id = $1', [phoneOwner.rows[0].id]);
    }

    try {
      await seedXatirchiSchool(db);
    } catch (e: any) {
      console.warn('Xatirchi 65-maktab seed ogohlantirish:', e.message);
    }
  }

  /**
   * Foydalanuvchi tizimga kirishi (Login)
   */
  static async login(
    db: DbClient,
    username: string,
    plainPassword: string,
    ipAddress?: string
  ): Promise<LoginResult> {
    const userRes = await db.query(
      `SELECT id, school_id, username, password_hash, role, teacher_id, student_id,
              must_change_password, failed_logins, locked_until
       FROM users WHERE username = $1`,
      [username.trim()]
    );

    if (userRes.rows.length === 0) {
      throw new Error('Foydalanuvchi nomi yoki parol noto\'g\'ri');
    }

    const row = userRes.rows[0];

    // 5 ta xato urinishdan so'ng bloklash tekshiruvi
    if (row.locked_until) {
      const lockedUntil = new Date(row.locked_until);
      if (new Date() < lockedUntil) {
        const remainingMinutes = Math.ceil((lockedUntil.getTime() - Date.now()) / (60 * 1000));
        throw new Error(
          `Hisob vaqtincha bloklangan. Iltimos ${remainingMinutes} daqiqadan so'ng qayta urinib ko'ring`
        );
      }
    }

    // Parolni tekshirish (argon2id)
    const isValid = await verifyPassword(row.password_hash, plainPassword);

    if (!isValid) {
      const newFailedCount = (row.failed_logins || 0) + 1;
      let lockDate: Date | null = null;

      if (newFailedCount >= 5) {
        lockDate = new Date(Date.now() + 15 * 60 * 1000); // 15 daqiqa blok
      }

      await db.query(
        'UPDATE users SET failed_logins = $1, locked_until = $2 WHERE id = $3',
        [newFailedCount, lockDate ? lockDate.toISOString() : null, row.id]
      );

      await logAudit(db, {
        school_id: row.school_id,
        user_id: row.id,
        action: 'LOGIN_FAILED',
        entity: 'user',
        entity_id: String(row.id),
        details: { failed_attempts: newFailedCount, locked: !!lockDate },
        ip_address: ipAddress,
      });

      throw new Error('Foydalanuvchi nomi yoki parol noto\'g\'ri');
    }

    // Muvaffaqiyatli kirish: hisobni xatolardan tozalash
    await db.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [row.id]);

    // Sessiya yaratish (7 kun)
    const sessionToken = generateSessionToken();
    const tokenHash = hashSessionToken(sessionToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await db.query(
      `INSERT INTO sessions (id, user_id, school_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [tokenHash, row.id, row.school_id, tokenHash, expiresAt.toISOString()]
    );

    await logAudit(db, {
      school_id: row.school_id,
      user_id: row.id,
      action: 'LOGIN_SUCCESS',
      entity: 'user',
      entity_id: String(row.id),
      ip_address: ipAddress,
    });

    const user: AuthUser = {
      id: row.id,
      school_id: row.school_id,
      username: row.username,
      role: row.role,
      teacher_id: row.teacher_id,
      student_id: row.student_id,
      must_change_password: row.must_change_password,
    };

    return {
      sessionToken,
      user,
      mustChangePassword: row.must_change_password,
      expiresAt,
    };
  }

  /**
   * Telefon raqami orqali parolsiz to'g'ridan-to'g'ri kirish
   */
  static async loginByPhone(
    db: DbClient,
    rawPhone: string,
    ipAddress?: string
  ): Promise<LoginResult> {
    const input = rawPhone.trim();

    // Normalizatsiya
    let digits = input.replace(/\D/g, '');
    if (digits.length === 9) digits = '998' + digits;
    const normalized = '+' + digits;

    let targetUser: any = null;

    // 1. Agar 'owner' yoki 'admin' yoki bosh admin raqami bo'lsa
    if (
      input.toLowerCase() === 'owner' ||
      input.toLowerCase() === 'admin' ||
      digits === '998900000000' ||
      digits === '998901111111' ||
      digits === '998909999999' ||
      digits === '998996893228' ||
      digits.endsWith('996893228')
    ) {
      const ownerRes = await db.query('SELECT * FROM users WHERE role = $1 LIMIT 1', ['owner']);
      if (ownerRes.rows.length) {
        targetUser = ownerRes.rows[0];
      }
    }

    // 2. Agar users jadvalida shu telefon yoki username bilan bo'lsa
    if (!targetUser) {
      const userRes = await db.query(
        `SELECT u.* FROM users u
         WHERE u.username = $1 OR u.username = $2`,
        [input, normalized]
      );
      if (userRes.rows.length) {
        targetUser = userRes.rows[0];
      }
    }

    // 3. O'qituvchilar (teachers) jadvalidan telefon bo'yicha qidirish
    if (!targetUser && digits.length >= 7) {
      const last7 = digits.slice(-7);
      const tRes = await db.query(
        `SELECT t.*, u.id as user_id, u.role as user_role
         FROM teachers t
         LEFT JOIN users u ON u.teacher_id = t.id AND u.school_id = t.school_id
         WHERE replace(replace(replace(replace(t.phone, ' ', ''), '-', ''), '(', ''), ')', '') LIKE '%' || $1
         LIMIT 1`,
        [last7]
      );
      if (tRes.rows.length) {
        const teacher = tRes.rows[0];
        if (teacher.user_id) {
          const uDb = await db.query('SELECT * FROM users WHERE id = $1', [teacher.user_id]);
          targetUser = uDb.rows[0];
        } else {
          // O'qituvchi uchun foydalanuvchi yaratish
          const pwHash = await hashPassword('Teacher123!');
          const created = await db.query(
            `INSERT INTO users (school_id, username, password_hash, role, teacher_id, must_change_password)
             VALUES ($1, $2, $3, 'teacher', $4, false)
             RETURNING *`,
            [teacher.school_id, teacher.phone || ('t_' + teacher.id), pwHash, teacher.id]
          );
          targetUser = created.rows[0];
        }
      }
    }

    // 4. Maktab sozlamalaridagi direktor telefoni
    if (!targetUser && digits.length >= 7) {
      const last7 = digits.slice(-7);
      const sRes = await db.query(
        `SELECT ss.school_id FROM school_settings ss
         WHERE replace(replace(replace(replace(ss.phone, ' ', ''), '-', ''), '(', ''), ')', '') LIKE '%' || $1
         LIMIT 1`,
        [last7]
      );
      if (sRes.rows.length) {
        const schoolId = sRes.rows[0].school_id;
        const dirRes = await db.query(
          `SELECT * FROM users WHERE school_id = $1 AND role = 'director' LIMIT 1`,
          [schoolId]
        );
        if (dirRes.rows.length) {
          targetUser = dirRes.rows[0];
        }
      }
    }

    // 5. O'quvchilar (students) jadvalidan telefon bo'yicha qidirish
    if (!targetUser && digits.length >= 7) {
      const last7 = digits.slice(-7);
      const stRes = await db.query(
        `SELECT s.*, u.id as user_id
         FROM students s
         LEFT JOIN users u ON u.student_id = s.id AND u.school_id = s.school_id
         WHERE replace(replace(replace(replace(s.phone, ' ', ''), '-', ''), '(', ''), ')', '') LIKE '%' || $1
            OR replace(replace(replace(replace(s.parent_phone, ' ', ''), '-', ''), '(', ''), ')', '') LIKE '%' || $1
         LIMIT 1`,
        [last7]
      );
      if (stRes.rows.length) {
        const student = stRes.rows[0];
        if (student.user_id) {
          const uDb = await db.query('SELECT * FROM users WHERE id = $1', [student.user_id]);
          targetUser = uDb.rows[0];
        } else {
          const pwHash = await hashPassword('Student123!');
          const created = await db.query(
            `INSERT INTO users (school_id, username, password_hash, role, student_id, must_change_password)
             VALUES ($1, $2, $3, 'student', $4, false)
             RETURNING *`,
            [student.school_id, student.phone || student.parent_phone || ('s_' + student.id), pwHash, student.id]
          );
          targetUser = created.rows[0];
        }
      }
    }

    if (!targetUser) {
      throw new Error("Ushbu telefon raqami maktab bazasida topilmadi. Admin tomonidan ro'yxatga kiritilgan raqamni kiriting.");
    }

    // Sessiya yaratish (30 kun)
    const sessionToken = generateSessionToken();
    const tokenHash = hashSessionToken(sessionToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await db.query(
      `INSERT INTO sessions (id, user_id, school_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [tokenHash, targetUser.id, targetUser.school_id, tokenHash, expiresAt.toISOString()]
    );

    await logAudit(db, {
      school_id: targetUser.school_id,
      user_id: targetUser.id,
      action: 'LOGIN_PHONE_SUCCESS',
      entity: 'user',
      entity_id: String(targetUser.id),
      ip_address: ipAddress,
    });

    const user: AuthUser = {
      id: targetUser.id,
      school_id: targetUser.school_id,
      username: targetUser.username,
      role: targetUser.role,
      teacher_id: targetUser.teacher_id,
      student_id: targetUser.student_id,
      must_change_password: false,
    };

    return {
      sessionToken,
      user,
      mustChangePassword: false,
      expiresAt,
    };
  }

  /**
   * Sessiya orqali joriy foydalanuvchini olish
   */
  static async getUserByToken(db: DbClient, sessionToken: string): Promise<{ user: AuthUser; permissions: Permission[] } | null> {
    const tokenHash = hashSessionToken(sessionToken);

    const sessionRes = await db.query(
      `SELECT s.id as session_id, s.school_id as session_school_id, s.expires_at,
              u.id as user_id, u.school_id as user_school_id, u.username, u.role,
              u.teacher_id, u.student_id, u.must_change_password
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
      [tokenHash]
    );

    if (sessionRes.rows.length === 0) {
      return null;
    }

    const row = sessionRes.rows[0];

    // Ruxsatlarni olish
    let permissions: Permission[] = [];
    if (row.role === 'owner') {
      permissions = [...DEFAULT_ROLE_PERMISSIONS.owner];
    } else if (row.user_school_id) {
      const permRes = await db.query<{ permission: Permission }>(
        'SELECT permission FROM role_permissions WHERE school_id = $1 AND role = $2',
        [row.user_school_id, row.role]
      );
      if (permRes.rows.length > 0) {
        permissions = permRes.rows.map((p) => p.permission);
      } else {
        permissions = DEFAULT_ROLE_PERMISSIONS[row.role as keyof typeof DEFAULT_ROLE_PERMISSIONS] || [];
      }
    }

    const user: AuthUser = {
      id: row.user_id,
      school_id: row.user_school_id,
      username: row.username,
      role: row.role,
      teacher_id: row.teacher_id,
      student_id: row.student_id,
      must_change_password: row.must_change_password,
      support_school_id: row.session_school_id !== row.user_school_id ? row.session_school_id : undefined,
    };

    return { user, permissions };
  }

  /**
   * Tizimdan chiqish (Logout)
   */
  static async logout(db: DbClient, sessionToken: string): Promise<void> {
    const tokenHash = hashSessionToken(sessionToken);
    await db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  }

  /**
   * Parolni o'zgartirish (Majburiy yoki ixtiyoriy)
   */
  static async changePassword(
    db: DbClient,
    userId: number,
    currentPlainPassword: string,
    newPlainPassword: string,
    ipAddress?: string
  ): Promise<void> {
    if (newPlainPassword.length < 8) {
      throw new Error('Yangi parol kamida 8 ta belgidan iborat bo\'lishi kerak');
    }

    const userRes = await db.query('SELECT password_hash, school_id FROM users WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) {
      throw new Error('Foydalanuvchi topilmadi');
    }

    const isValid = await verifyPassword(userRes.rows[0].password_hash, currentPlainPassword);
    if (!isValid) {
      throw new Error('Amaldagi parol noto\'g\'ri');
    }

    const newHash = await hashPassword(newPlainPassword);
    await db.query('UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2', [
      newHash,
      userId,
    ]);

    await logAudit(db, {
      school_id: userRes.rows[0].school_id,
      user_id: userId,
      action: 'PASSWORD_CHANGED',
      entity: 'user',
      entity_id: String(userId),
      ip_address: ipAddress,
    });
  }

  /**
   * Owner uchun maktabga yordam rejimida kirish (Support Mode)
   */
  static async enterSupportMode(
    db: DbClient,
    sessionToken: string,
    ownerUser: AuthUser,
    targetSchoolId: number,
    ipAddress?: string
  ): Promise<void> {
    if (ownerUser.role !== 'owner') {
      throw new Error('Faqat platforma egasi (owner) yordam rejimiga kira oladi');
    }

    const schoolRes = await db.query('SELECT id, name FROM schools WHERE id = $1', [targetSchoolId]);
    if (schoolRes.rows.length === 0) {
      throw new Error('Maktab topilmadi');
    }

    const tokenHash = hashSessionToken(sessionToken);
    await db.query('UPDATE sessions SET school_id = $1 WHERE token_hash = $2', [targetSchoolId, tokenHash]);

    await logAudit(db, {
      school_id: targetSchoolId,
      user_id: ownerUser.id,
      action: 'SUPPORT_MODE_ENTER',
      entity: 'school',
      entity_id: String(targetSchoolId),
      details: { school_name: schoolRes.rows[0].name },
      ip_address: ipAddress,
    });
  }

  /**
   * Owner yordam rejimidan chiqishi
   */
  static async exitSupportMode(
    db: DbClient,
    sessionToken: string,
    ownerUser: AuthUser,
    ipAddress?: string
  ): Promise<void> {
    if (ownerUser.role !== 'owner') {
      throw new Error('Faqat platforma egasi (owner) yordam rejimidan chiqa oladi');
    }

    const tokenHash = hashSessionToken(sessionToken);
    await db.query('UPDATE sessions SET school_id = NULL WHERE token_hash = $1', [tokenHash]);

    await logAudit(db, {
      school_id: null,
      user_id: ownerUser.id,
      action: 'SUPPORT_MODE_EXIT',
      entity: 'school',
      ip_address: ipAddress,
    });
  }

  /**
   * Yangi maktab va uning direktorini yaratish (Faqat owner qila oladi)
   */
  static async createSchoolWithDirector(
    db: DbClient,
    ownerUser: AuthUser,
    schoolName: string,
    directorUsername: string,
    directorPhone?: string,
    ipAddress?: string
  ): Promise<{ school: { id: number; name: string }; director: { id: number; username: string; tempPassword: string } }> {
    if (ownerUser.role !== 'owner') {
      throw new Error('Faqat platforma egasi (owner) yangi maktab yarata oladi');
    }

    const tempPassword = generateTempPassword(10);
    const pwHash = await hashPassword(tempPassword);

    return await db.tx(async (tx) => {
      // 1. Maktabni yaratish
      const sRes = await tx.query<{ id: number; name: string }>(
        'INSERT INTO schools (name) VALUES ($1) RETURNING id, name',
        [schoolName.trim()]
      );
      const school = sRes.rows[0];

      // 2. Maktab sozlamalarini yaratish
      await tx.query(
        'INSERT INTO school_settings (school_id, name) VALUES ($1, $2)',
        [school.id, school.name]
      );

      // 3. Maktab uchun boshlang'ich o'quv yili
      await tx.query(
        'INSERT INTO years (school_id, name, is_current) VALUES ($1, $2, $3)',
        [school.id, '2026–2027', true]
      );

      // 4. Maktab uchun standart ruxsatlarni kiritish
      for (const role of ['director', 'admin', 'teacher', 'student'] as const) {
        const perms = DEFAULT_ROLE_PERMISSIONS[role];
        for (const p of perms) {
          await tx.query(
            'INSERT INTO role_permissions (school_id, role, permission) VALUES ($1, $2, $3)',
            [school.id, role, p]
          );
        }
      }

      // 5. Direktorni yaratish
      const dRes = await tx.query<{ id: number; username: string }>(
        `INSERT INTO users (school_id, username, password_hash, role, must_change_password)
         VALUES ($1, $2, $3, 'director', TRUE) RETURNING id, username`,
        [school.id, directorUsername.trim().toLowerCase(), pwHash]
      );
      const director = dRes.rows[0];

      await logAudit(tx, {
        school_id: school.id,
        user_id: ownerUser.id,
        action: 'SCHOOL_AND_DIRECTOR_CREATED',
        entity: 'school',
        entity_id: String(school.id),
        details: { school_name: school.name, director_username: director.username },
        ip_address: ipAddress,
      });

      return {
        school,
        director: {
          id: director.id,
          username: director.username,
          tempPassword,
        },
      };
    });
  }

  /**
   * Maktab ichida foydalanuvchi yaratish (Director -> Admin, Teacher; Admin -> Teacher)
   */
  static async createUser(
    db: DbClient,
    creatorUser: AuthUser,
    data: {
      username: string;
      role: 'admin' | 'teacher' | 'student';
      teacher_id?: number | null;
      student_id?: number | null;
    },
    ipAddress?: string
  ): Promise<{ id: number; username: string; tempPassword: string; role: string }> {
    const schoolId = creatorUser.role === 'owner' ? creatorUser.support_school_id : creatorUser.school_id;
    if (!schoolId) {
      throw new Error('Maktab aniqlanmadi');
    }

    // Ruxsat tekshiruvi:
    // Director -> admin, teacher, student yaratishi mumkin
    // Admin -> teacher, student yaratishi mumkin
    if (creatorUser.role === 'admin' && data.role === 'admin') {
      throw new Error('Admin boshqa admin yarata olmaydi');
    }
    if (!['owner', 'director', 'admin'].includes(creatorUser.role)) {
      throw new Error('Foydalanuvchi yaratishga ruxsat yo\'q');
    }

    const tempPassword = generateTempPassword(10);
    const pwHash = await hashPassword(tempPassword);

    const uRes = await db.query<{ id: number; username: string; role: string }>(
      `INSERT INTO users (school_id, username, password_hash, role, teacher_id, student_id, must_change_password)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE) RETURNING id, username, role`,
      [
        schoolId,
        data.username.trim().toLowerCase(),
        pwHash,
        data.role,
        data.teacher_id || null,
        data.student_id || null,
      ]
    );

    const created = uRes.rows[0];

    await logAudit(db, {
      school_id: schoolId,
      user_id: creatorUser.id,
      action: 'USER_CREATED',
      entity: 'user',
      entity_id: String(created.id),
      details: { username: created.username, role: created.role },
      ip_address: ipAddress,
    });

    return {
      id: created.id,
      username: created.username,
      role: created.role,
      tempPassword,
    };
  }

  /**
   * Foydalanuvchini o'chirishdan himoya qilish (Owner yoki maktabning oxirgi direktori o'chirilmaydi)
   */
  static async deleteUser(db: DbClient, actor: AuthUser, targetUserId: number, ipAddress?: string): Promise<void> {
    const targetRes = await db.query('SELECT id, school_id, role, username FROM users WHERE id = $1', [targetUserId]);
    if (targetRes.rows.length === 0) {
      throw new Error('Foydalanuvchi topilmadi');
    }
    const target = targetRes.rows[0];

    // 1. Owner'ni hech kim o'chira olmaydi
    if (target.role === 'owner') {
      throw new Error('Platforma egasini (owner) o\'chirib bo\'lmaydi');
    }

    // 2. Maktabning oxirgi direktorini o'chirish taqiqlanadi
    if (target.role === 'director') {
      const directorCountRes = await db.query(
        'SELECT COUNT(*) as count FROM users WHERE school_id = $1 AND role = $2',
        [target.school_id, 'director']
      );
      if (parseInt(directorCountRes.rows[0].count, 10) <= 1) {
        throw new Error('Maktabning yagona direktorini o\'chirib bo\'lmaydi. Avval yangi direktor tayinlang');
      }
    }

    // Maktab izolyatsiyasi tekshiruvi
    if (actor.role !== 'owner' && actor.school_id !== target.school_id) {
      throw new Error('Boshqa maktab foydalanuvchisini o\'chirish taqiqlanadi');
    }

    await db.query('DELETE FROM users WHERE id = $1', [targetUserId]);

    await logAudit(db, {
      school_id: target.school_id,
      user_id: actor.id,
      action: 'USER_DELETED',
      entity: 'user',
      entity_id: String(targetUserId),
      details: { username: target.username, role: target.role },
      ip_address: ipAddress,
    });
  }
}
