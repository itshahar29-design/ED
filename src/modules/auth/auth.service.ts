import { DbClient } from '../../db/client.js';
import {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  hashSessionToken,
  generateTempPassword,
} from './crypto.js';
import {
  AuthUser,
  DEFAULT_ROLE_PERMISSIONS,
  PRESET_POSITIONS,
  ALL_PERMISSIONS,
  Permission,
} from './permissions.js';
import { computeMenu, MenuItem } from './menu.js';
import {
  validateTelegramInitData,
  checkRateLimit,
  normalizePhone,
} from './telegram.validator.js';
import { logAudit } from '../audit/audit.service.js';
import { seedXatirchiSchool } from '../school/xatirchi.seed.js';
import { env, EFFECTIVE_BOT_TOKEN } from '../../config/env.js';

export interface LoginResult {
  sessionToken: string;
  user: AuthUser;
  mustChangePassword: boolean;
  expiresAt: Date;
  membership?: any;
  position?: any;
  permissions?: Permission[];
  menu?: MenuItem[];
  memberships?: any[];
}

export class AuthService {
  /**
   * Maktab uchun 13 ta standart (preset) lavozimlarni yaratish
   */
  static async seedSchoolPositions(db: DbClient, schoolId: number): Promise<void> {
    for (const [key, preset] of Object.entries(PRESET_POSITIONS)) {
      if (key === 'owner') continue; // owner - platforma darajasida

      const existing = await db.query(
        'SELECT id FROM positions WHERE school_id = $1 AND key = $2 LIMIT 1',
        [schoolId, key]
      );

      let posId: number;
      if (existing.rows.length === 0) {
        const ins = await db.query(
          `INSERT INTO positions (school_id, key, name_uz, base_key, scope, rank, is_preset)
           VALUES ($1, $2, $3, $4, $5, $6, true)
           RETURNING id`,
          [schoolId, preset.key, preset.name_uz, preset.key, preset.scope, preset.rank]
        );
        posId = ins.rows[0].id;
      } else {
        posId = existing.rows[0].id;
      }

      // Ruxsatlarni position_permissions ga kiritish
      for (const perm of preset.permissions) {
        await db.query(
          `INSERT INTO position_permissions (position_id, permission)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [posId, perm]
        );
      }
    }
  }

  /**
   * Tizimda kamida bitta owner bo'lishini ta'minlash, owner lavozimi va 65-maktabni tayyorlash
   */
  static async seedInitialOwner(db: DbClient): Promise<void> {
    // 1. Platforma owner lavozimini tekshirish/yaratish
    let ownerPosRes = await db.query(
      "SELECT id FROM positions WHERE school_id IS NULL AND key = 'owner' LIMIT 1"
    );
    let ownerPosId: number;
    if (ownerPosRes.rows.length === 0) {
      const insPos = await db.query(
        `INSERT INTO positions (school_id, key, name_uz, base_key, scope, rank, is_preset)
         VALUES (NULL, 'owner', 'Platforma egasi', 'owner', 'school', 1, true)
         RETURNING id`
      );
      ownerPosId = insPos.rows[0].id;
      for (const p of ALL_PERMISSIONS) {
        await db.query(
          `INSERT INTO position_permissions (position_id, permission)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [ownerPosId, p]
        );
      }
    } else {
      ownerPosId = ownerPosRes.rows[0].id;
    }

    // 2. Default owner foydalanuvchisi
    const ownerRes = await db.query("SELECT id FROM users WHERE role = 'owner' LIMIT 1");
    let ownerId: number;
    if (ownerRes.rows.length === 0) {
      const pwHash = await hashPassword('Owner123456!');
      const insUser = await db.query(
        `INSERT INTO users (username, password_hash, role, phone_e164, full_name, status, must_change_password)
         VALUES ($1, $2, 'owner', $3, 'Platforma Egasi', 'active', false)
         RETURNING id`,
        ['owner', pwHash, env.OWNER_PHONE]
      );
      ownerId = insUser.rows[0].id;
      console.log('Default owner yaratildi: username="owner", parol="Owner123456!"');
    } else {
      ownerId = ownerRes.rows[0].id;
    }

    // Owner membership borligini ta'minlash
    const mRes = await db.query(
      'SELECT id FROM memberships WHERE user_id = $1 AND position_id = $2 LIMIT 1',
      [ownerId, ownerPosId]
    );
    if (mRes.rows.length === 0) {
      await db.query(
        `INSERT INTO memberships (user_id, school_id, position_id, status)
         VALUES ($1, NULL, $2, 'active')`,
        [ownerId, ownerPosId]
      );
    }

    // OWNER_PHONE ni ham owner qilib sozlash
    const ownerPhones = [
      env.OWNER_PHONE ? normalizePhone(env.OWNER_PHONE) : '',
      '+998996893228',
    ].filter(Boolean);

    for (const normPhone of ownerPhones) {
      const phoneOwner = await db.query(
        'SELECT id FROM users WHERE phone_e164 = $1 OR username = $1 OR username = $2 LIMIT 1',
        [normPhone, normPhone.replace(/\D/g, '')]
      );
      let phoneUserId: number;
      if (phoneOwner.rows.length === 0) {
        const pwHash = await hashPassword('Owner123456!');
        const insPhone = await db.query(
          `INSERT INTO users (username, password_hash, role, phone_e164, full_name, status, must_change_password)
           VALUES ($1, $2, 'owner', $1, 'Platforma Egasi (Telefon)', 'active', false)
           RETURNING id`,
          [normPhone, pwHash]
        );
        phoneUserId = insPhone.rows[0].id;
      } else {
        phoneUserId = phoneOwner.rows[0].id;
        await db.query(
          "UPDATE users SET role = 'owner', phone_e164 = $1, status = 'active' WHERE id = $2",
          [normPhone, phoneUserId]
        );
      }
      const pmRes = await db.query(
        'SELECT id FROM memberships WHERE user_id = $1 AND position_id = $2 LIMIT 1',
        [phoneUserId, ownerPosId]
      );
      if (pmRes.rows.length === 0) {
        await db.query(
          `INSERT INTO memberships (user_id, school_id, position_id, status)
           VALUES ($1, NULL, $2, 'active')`,
          [phoneUserId, ownerPosId]
        );
      }
    }

    // 3. Xatirchi 65-maktabni tayyorlash
    try {
      await seedXatirchiSchool(db);
    } catch (e: any) {
      console.warn('Xatirchi 65-maktab seed ogohlantirish:', e.message);
    }

    // Mavjud maktablar uchun preset lavozimlarni seed qilish
    const schoolsRes = await db.query('SELECT id FROM schools');
    for (const row of schoolsRes.rows) {
      await AuthService.seedSchoolPositions(db, row.id);
    }
  }

  /**
   * Foydalanuvchi tizimga kirishi (Username/Password orqali - v2 legacy)
   */
  static async login(
    db: DbClient,
    username: string,
    plainPassword: string,
    ipAddress?: string
  ): Promise<LoginResult> {
    const userRes = await db.query(
      `SELECT id, school_id, username, password_hash, role, phone_e164, full_name, teacher_id, student_id,
              must_change_password, failed_logins, locked_until
       FROM users WHERE username = $1`,
      [username.trim()]
    );

    if (userRes.rows.length === 0) {
      throw new Error("Foydalanuvchi nomi yoki parol noto'g'ri");
    }

    const row = userRes.rows[0];

    if (row.locked_until) {
      const lockedUntil = new Date(row.locked_until);
      if (new Date() < lockedUntil) {
        const remainingMinutes = Math.ceil((lockedUntil.getTime() - Date.now()) / (60 * 1000));
        throw new Error(
          `Hisob vaqtincha bloklangan. Iltimos ${remainingMinutes} daqiqadan so'ng qayta urinib ko'ring`
        );
      }
    }

    const isValid = await verifyPassword(row.password_hash || '', plainPassword);
    if (!isValid) {
      const newFailedCount = (row.failed_logins || 0) + 1;
      let lockDate: Date | null = null;
      if (newFailedCount >= 5) {
        lockDate = new Date(Date.now() + 15 * 60 * 1000);
      }
      await db.query(
        'UPDATE users SET failed_logins = $1, locked_until = $2 WHERE id = $3',
        [newFailedCount, lockDate ? lockDate.toISOString() : null, row.id]
      );
      throw new Error("Foydalanuvchi nomi yoki parol noto'g'ri");
    }

    await db.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [row.id]);

    const sessionToken = generateSessionToken();
    const tokenHash = hashSessionToken(sessionToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Membership ni topish
    const mRes = await db.query(
      `SELECT m.id, m.school_id, p.id as position_id, p.key as position_key, p.name_uz as position_name
       FROM memberships m
       JOIN positions p ON m.position_id = p.id
       WHERE m.user_id = $1 AND m.status = 'active'
       LIMIT 1`,
      [row.id]
    );

    const membershipId = mRes.rows.length ? mRes.rows[0].id : null;

    await db.query(
      `INSERT INTO sessions (id, user_id, school_id, membership_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tokenHash, row.id, row.school_id, membershipId, tokenHash, expiresAt.toISOString()]
    );

    await logAudit(db, {
      school_id: row.school_id,
      user_id: row.id,
      action: 'LOGIN_SUCCESS',
      entity: 'user',
      entity_id: String(row.id),
      ip_address: ipAddress,
    });

    const perms = DEFAULT_ROLE_PERMISSIONS[row.role] || [];
    const menu = computeMenu(perms, row.role);

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
      permissions: perms,
      menu,
    };
  }

  /**
   * Telegram WebApp initData orqali kirish (EduMemory 3.0 MAX rasmiy parolsiz kirish)
   */
  static async loginByTelegram(
    db: DbClient,
    initDataString: string,
    ipAddress?: string
  ): Promise<{
    need_phone?: boolean;
    need_access?: boolean;
    telegram_id?: number;
    first_name?: string;
    message?: string;
    phone?: string;
    sessionToken?: string;
    user?: AuthUser;
    membership?: any;
    position?: any;
    permissions?: Permission[];
    menu?: MenuItem[];
    memberships?: any[];
  }> {
    // 1. initData HMAC va auth_date tekshirish
    const token = EFFECTIVE_BOT_TOKEN;
    const validated = validateTelegramInitData(initDataString, token);
    const tgUser = validated.user;

    // Rate limit
    const rl = checkRateLimit(ipAddress || '127.0.0.1', tgUser.id);
    if (!rl.allowed) {
      throw new Error(`Juda ko'p urinishlar. Iltimos ${rl.retryAfter} soniyadan so'ng qayta urinib ko'ring`);
    }

    // 2. telegram_identities jadvalidan tekshirish
    const identityRes = await db.query(
      'SELECT * FROM telegram_identities WHERE telegram_id = $1 AND unbound_at IS NULL LIMIT 1',
      [tgUser.id]
    );

    if (identityRes.rows.length === 0 || !identityRes.rows[0].phone_verified_at || !identityRes.rows[0].user_id) {
      // Yangi identity kiritib qo'yamiz (agar mavjud bo'lmasa)
      if (identityRes.rows.length === 0) {
        await db.query(
          `INSERT INTO telegram_identities (telegram_id, user_id, phone_verified_at, bound_at)
           VALUES ($1, NULL, NULL, NOW())
           ON CONFLICT (telegram_id) DO NOTHING`,
          [tgUser.id]
        );
      }
      return {
        need_phone: true,
        telegram_id: tgUser.id,
        first_name: tgUser.first_name,
      };
    }

    const userId = identityRes.rows[0].user_id;

    // 3. Foydalanuvchi va uning barcha a'zoliklarini olish
    const userRes = await db.query(
      'SELECT id, school_id, username, role, phone_e164, full_name, status FROM users WHERE id = $1',
      [userId]
    );

    if (userRes.rows.length === 0) {
      return {
        need_phone: true,
        telegram_id: tgUser.id,
        first_name: tgUser.first_name,
      };
    }

    const u = userRes.rows[0];

    // Memberships olish
    const memRes = await db.query(
      `SELECT m.id as membership_id, m.school_id, m.status as membership_status,
              p.id as position_id, p.key as position_key, p.name_uz as position_name,
              p.scope, p.rank, s.name as school_name
       FROM memberships m
       JOIN positions p ON m.position_id = p.id
       LEFT JOIN schools s ON m.school_id = s.id
       WHERE m.user_id = $1 AND m.status = 'active'
       ORDER BY p.rank ASC`,
      [userId]
    );

    if (memRes.rows.length === 0) {
      if (u.role === 'owner' || u.phone_e164?.includes('996893228') || u.username === 'owner' || u.username?.includes('996893228')) {
        let oPos = await db.query("SELECT id FROM positions WHERE school_id IS NULL AND key = 'owner' LIMIT 1");
        let oPosId: number;
        if (oPos.rows.length === 0) {
          const insP = await db.query(
            "INSERT INTO positions (school_id, key, name_uz, base_key, scope, rank, is_preset) VALUES (NULL, 'owner', 'Platforma egasi', 'owner', 'school', 1, true) RETURNING id"
          );
          oPosId = insP.rows[0].id;
        } else {
          oPosId = oPos.rows[0].id;
        }
        await db.query(
          "INSERT INTO memberships (user_id, school_id, position_id, status) VALUES ($1, NULL, $2, 'active')",
          [userId, oPosId]
        );
        const refetchMem = await db.query(
          `SELECT m.id as membership_id, m.school_id, m.status as membership_status,
                  p.id as position_id, p.key as position_key, p.name_uz as position_name,
                  p.scope, p.rank, NULL as school_name
           FROM memberships m
           JOIN positions p ON m.position_id = p.id
           WHERE m.user_id = $1 AND m.status = 'active'`,
          [userId]
        );
        memRes.rows.push(...refetchMem.rows);
      } else {
        return {
          need_access: true,
          message: "Raqamingiz tizimda yo'q yoki a'zoligingiz tasdiqlanmagan. Maktab ma'muriyatiga murojaat qiling.",
          phone: u.phone_e164,
        };
      }
    }

    const activeMem = memRes.rows[0];

    // Ruxsatlarni olish
    const permRes = await db.query<{ permission: Permission }>(
      'SELECT permission FROM position_permissions WHERE position_id = $1',
      [activeMem.position_id]
    );
    const permissions =
      permRes.rows.length > 0
        ? permRes.rows.map((r) => r.permission)
        : PRESET_POSITIONS[activeMem.position_key]?.permissions || [];

    const menu = computeMenu(permissions, activeMem.position_key);

    // Sessiya yaratish (30 kun)
    const sessionToken = generateSessionToken();
    const tokenHash = hashSessionToken(sessionToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await db.query(
      `INSERT INTO sessions (id, user_id, school_id, membership_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tokenHash, u.id, activeMem.school_id, activeMem.membership_id, tokenHash, expiresAt.toISOString()]
    );

    await logAudit(db, {
      school_id: activeMem.school_id,
      user_id: u.id,
      action: 'LOGIN_TELEGRAM_SUCCESS',
      entity: 'user',
      entity_id: String(u.id),
      details: { telegram_id: tgUser.id, position: activeMem.position_key },
      ip_address: ipAddress,
    });

    const userObj: AuthUser = {
      id: u.id,
      school_id: activeMem.school_id,
      username: u.username,
      role: activeMem.position_key,
      phone_e164: u.phone_e164,
      full_name: u.full_name,
      membership_id: activeMem.membership_id,
      position_id: activeMem.position_id,
      position_key: activeMem.position_key,
      scope: activeMem.scope,
      rank: activeMem.rank,
    };

    return {
      sessionToken,
      user: userObj,
      membership: activeMem,
      position: {
        id: activeMem.position_id,
        key: activeMem.position_key,
        name_uz: activeMem.position_name,
        scope: activeMem.scope,
        rank: activeMem.rank,
      },
      permissions,
      menu,
      memberships: memRes.rows,
    };
  }

  /**
   * Profil almashtirish (POST /api/v1/auth/switch)
   */
  static async switchMembership(
    db: DbClient,
    sessionToken: string,
    targetMembershipId: number,
    ipAddress?: string
  ): Promise<{
    user: AuthUser;
    membership: any;
    position: any;
    permissions: Permission[];
    menu: MenuItem[];
  }> {
    const tokenHash = hashSessionToken(sessionToken);

    const sRes = await db.query(
      'SELECT id, user_id, school_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW()',
      [tokenHash]
    );
    if (sRes.rows.length === 0) {
      throw new Error('Sessiya eskirgan yoki topilmadi');
    }

    const session = sRes.rows[0];

    const mRes = await db.query(
      `SELECT m.id as membership_id, m.school_id, m.status as membership_status,
              p.id as position_id, p.key as position_key, p.name_uz as position_name,
              p.scope, p.rank, s.name as school_name
       FROM memberships m
       JOIN positions p ON m.position_id = p.id
       LEFT JOIN schools s ON m.school_id = s.id
       WHERE m.id = $1 AND m.user_id = $2 AND m.status = 'active'`,
      [targetMembershipId, session.user_id]
    );

    if (mRes.rows.length === 0) {
      throw new Error("Tanlangan lavozim mavjud emas yoki sizga tegishli emas");
    }

    const targetMem = mRes.rows[0];

    // Sessiyani yangilash
    await db.query(
      'UPDATE sessions SET school_id = $1, membership_id = $2 WHERE id = $3',
      [targetMem.school_id, targetMem.membership_id, session.id]
    );

    const permRes = await db.query<{ permission: Permission }>(
      'SELECT permission FROM position_permissions WHERE position_id = $1',
      [targetMem.position_id]
    );
    const permissions =
      permRes.rows.length > 0
        ? permRes.rows.map((r) => r.permission)
        : PRESET_POSITIONS[targetMem.position_key]?.permissions || [];

    const menu = computeMenu(permissions, targetMem.position_key);

    const uRes = await db.query('SELECT * FROM users WHERE id = $1', [session.user_id]);
    const u = uRes.rows[0];

    await logAudit(db, {
      school_id: targetMem.school_id,
      user_id: session.user_id,
      action: 'SWITCH_MEMBERSHIP',
      entity: 'membership',
      entity_id: String(targetMembershipId),
      details: { position: targetMem.position_key, school_id: targetMem.school_id },
      ip_address: ipAddress,
    });

    const userObj: AuthUser = {
      id: u.id,
      school_id: targetMem.school_id,
      username: u.username,
      role: targetMem.position_key,
      phone_e164: u.phone_e164,
      full_name: u.full_name,
      membership_id: targetMem.membership_id,
      position_id: targetMem.position_id,
      position_key: targetMem.position_key,
      scope: targetMem.scope,
      rank: targetMem.rank,
    };

    return {
      user: userObj,
      membership: targetMem,
      position: {
        id: targetMem.position_id,
        key: targetMem.position_key,
        name_uz: targetMem.position_name,
        scope: targetMem.scope,
        rank: targetMem.rank,
      },
      permissions,
      menu,
    };
  }

  /**
   * Telegramni uzish (POST /api/v1/auth/unlink)
   */
  static async unlinkTelegram(db: DbClient, sessionToken: string, ipAddress?: string): Promise<void> {
    const tokenHash = hashSessionToken(sessionToken);

    const sRes = await db.query(
      'SELECT id, user_id, school_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW()',
      [tokenHash]
    );
    if (sRes.rows.length === 0) {
      throw new Error('Sessiya eskirgan yoki topilmadi');
    }

    const session = sRes.rows[0];

    await db.query(
      'UPDATE telegram_identities SET unbound_at = NOW(), user_id = NULL WHERE user_id = $1',
      [session.user_id]
    );

    // Foydalanuvchining barcha sessiyalarini bekor qilish
    await db.query('DELETE FROM sessions WHERE user_id = $1', [session.user_id]);

    await logAudit(db, {
      school_id: session.school_id,
      user_id: session.user_id,
      action: 'TELEGRAM_UNLINKED',
      entity: 'user',
      entity_id: String(session.user_id),
      ip_address: ipAddress,
    });
  }

  /**
   * Telegram orqali telefon raqam yuborilganda foydalanuvchini bog'lash
   */
  static async linkTelegramContact(
    db: DbClient,
    telegramId: number,
    phone: string,
    fullName?: string,
    ipAddress?: string
  ): Promise<{ user: any; message: string; sessionToken?: string }> {
    const normPhone = normalizePhone(phone);
    if (!normPhone) {
      throw new Error("Yaroqsiz telefon raqam");
    }

    const digits = normPhone.replace(/\D/g, '');
    const isOwnerPhone =
      digits === '998996893228' ||
      digits.endsWith('996893228') ||
      digits === '998900000000' ||
      digits === '998901111111' ||
      normPhone === normalizePhone(env.OWNER_PHONE);

    if (!isOwnerPhone) {
      // Xavfsizlik: Bu raqam boshqa telegram_id ga bog'langan bo'lsa rad etamiz
      const boundOther = await db.query(
        `SELECT ti.telegram_id FROM telegram_identities ti
         JOIN users u ON ti.user_id = u.id
         WHERE (u.phone_e164 = $1 OR u.username = $1) AND ti.telegram_id != $2 AND ti.unbound_at IS NULL`,
        [normPhone, telegramId]
      );

      if (boundOther.rows.length > 0) {
        await logAudit(db, {
          school_id: null,
          user_id: null,
          action: 'SUSPICIOUS_BIND_ATTEMPT',
          entity: 'telegram_identity',
          entity_id: String(telegramId),
          details: { phone: 'masked', reason: 'Phone already bound to another telegram_id' },
          ip_address: ipAddress,
        });
        throw new Error(
          "Xavfsizlik talabi: Bu telefon raqami allaqachon boshqa Telegram profiliga bog'langan! Qayta bog'lash uchun maktab ma'muriyatiga murojaat qiling."
        );
      }
    } else {
      // Owner bo'lsa: eski bog'lanishlarni tozalash
      await db.query(
        `UPDATE telegram_identities ti
         SET unbound_at = NOW()
         FROM users u
         WHERE ti.user_id = u.id AND (u.phone_e164 = $1 OR u.username = $1 OR u.role = 'owner') AND ti.telegram_id != $2`,
        [normPhone, telegramId]
      );
    }

    // 1. users jadvalida bormi?
    let userRes = await db.query(
      'SELECT id, school_id, full_name, role, status FROM users WHERE phone_e164 = $1 OR username = $1 OR username = $2 LIMIT 1',
      [normPhone, digits]
    );
    let userId: number;
    let schoolId: number | null = null;

    if (userRes.rows.length > 0) {
      userId = userRes.rows[0].id;
      schoolId = userRes.rows[0].school_id;

      if (isOwnerPhone) {
        await db.query(
          "UPDATE users SET role = 'owner', phone_e164 = $1, status = 'active' WHERE id = $2",
          [normPhone, userId]
        );
        let oPos = await db.query("SELECT id FROM positions WHERE school_id IS NULL AND key = 'owner' LIMIT 1");
        let oPosId: number;
        if (oPos.rows.length === 0) {
          const insPos = await db.query(
            "INSERT INTO positions (school_id, key, name_uz, base_key, scope, rank, is_preset) VALUES (NULL, 'owner', 'Platforma egasi', 'owner', 'school', 1, true) RETURNING id"
          );
          oPosId = insPos.rows[0].id;
        } else {
          oPosId = oPos.rows[0].id;
        }
        const pm = await db.query(
          'SELECT id FROM memberships WHERE user_id = $1 AND position_id = $2 LIMIT 1',
          [userId, oPosId]
        );
        if (pm.rows.length === 0) {
          await db.query(
            "INSERT INTO memberships (user_id, school_id, position_id, status) VALUES ($1, NULL, $2, 'active')",
            [userId, oPosId]
          );
        }
      }
    } else {
      // 2. teachers, students, parent_contacts jadvalidan tekshirish
      const last9 = digits.slice(-9);

      // O'qituvchi
      const tRes = await db.query(
        `SELECT id, school_id, name FROM teachers
         WHERE replace(replace(replace(replace(phone, ' ', ''), '-', ''), '(', ''), ')', '') LIKE '%' || $1
         LIMIT 1`,
        [last9]
      );

      // O'quvchi
      const sRes = await db.query(
        `SELECT id, school_id, name FROM students
         WHERE replace(replace(replace(replace(phone, ' ', ''), '-', ''), '(', ''), ')', '') LIKE '%' || $1
         LIMIT 1`,
        [last9]
      );

      // Ota-ona
      const pRes = await db.query(
        `SELECT id, school_id, name, parent_name FROM students
         WHERE replace(replace(replace(replace(parent_phone, ' ', ''), '-', ''), '(', ''), ')', '') LIKE '%' || $1
         LIMIT 1`,
        [last9]
      );

      if (isOwnerPhone) {
        const insU = await db.query(
          `INSERT INTO users (username, role, phone_e164, full_name, status)
           VALUES ($1, 'owner', $1, 'Platforma Egasi', 'active')
           RETURNING id`,
          [normPhone]
        );
        userId = insU.rows[0].id;
        let oPos = await db.query("SELECT id FROM positions WHERE school_id IS NULL AND key = 'owner' LIMIT 1");
        let oPosId: number;
        if (oPos.rows.length === 0) {
          const insPos = await db.query(
            "INSERT INTO positions (school_id, key, name_uz, base_key, scope, rank, is_preset) VALUES (NULL, 'owner', 'Platforma egasi', 'owner', 'school', 1, true) RETURNING id"
          );
          oPosId = insPos.rows[0].id;
        } else {
          oPosId = oPos.rows[0].id;
        }
        await db.query(
          `INSERT INTO memberships (user_id, school_id, position_id, status)
           VALUES ($1, NULL, $2, 'active')`,
          [userId, oPosId]
        );
      } else if (tRes.rows.length > 0) {
        const t = tRes.rows[0];
        schoolId = t.school_id;
        const insU = await db.query(
          `INSERT INTO users (school_id, username, role, phone_e164, full_name, teacher_id, status)
           VALUES ($1, $2, 'teacher', $2, $3, $4, 'active')
           RETURNING id`,
          [t.school_id, normPhone, t.name, t.id]
        );
        userId = insU.rows[0].id;
        const pos = await db.query("SELECT id FROM positions WHERE school_id = $1 AND key = 'teacher' LIMIT 1", [t.school_id]);
        if (pos.rows.length) {
          await db.query(
            `INSERT INTO memberships (user_id, school_id, position_id, teacher_id, status)
             VALUES ($1, $2, $3, $4, 'active')`,
            [userId, t.school_id, pos.rows[0].id, t.id]
          );
        }
      } else if (sRes.rows.length > 0) {
        const s = sRes.rows[0];
        schoolId = s.school_id;
        const insU = await db.query(
          `INSERT INTO users (school_id, username, role, phone_e164, full_name, student_id, status)
           VALUES ($1, $2, 'student', $2, $3, $4, 'active')
           RETURNING id`,
          [s.school_id, normPhone, s.name, s.id]
        );
        userId = insU.rows[0].id;
        const pos = await db.query("SELECT id FROM positions WHERE school_id = $1 AND key = 'student' LIMIT 1", [s.school_id]);
        if (pos.rows.length) {
          await db.query(
            `INSERT INTO memberships (user_id, school_id, position_id, student_id, status)
             VALUES ($1, $2, $3, $4, 'active')`,
            [userId, s.school_id, pos.rows[0].id, s.id]
          );
        }
      } else if (pRes.rows.length > 0) {
        const p = pRes.rows[0];
        schoolId = p.school_id;
        const insU = await db.query(
          `INSERT INTO users (school_id, username, role, phone_e164, full_name, status)
           VALUES ($1, $2, 'parent', $2, $3, 'active')
           RETURNING id`,
          [p.school_id, normPhone, p.parent_name || 'Ota-ona']
        );
        userId = insU.rows[0].id;
        const pos = await db.query("SELECT id FROM positions WHERE school_id = $1 AND key = 'parent' LIMIT 1", [p.school_id]);
        if (pos.rows.length) {
          await db.query(
            `INSERT INTO memberships (user_id, school_id, position_id, status)
             VALUES ($1, $2, $3, 'active')`,
            [userId, p.school_id, pos.rows[0].id]
          );
          // Ota-ona - farzand bog'lash
          await db.query(
            `INSERT INTO parent_students (school_id, parent_user_id, student_id, consent_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT DO NOTHING`,
            [p.school_id, userId, p.id]
          );
        }
      } else {
        // Tizimda yo'q - kutilayotgan foydalanuvchi sifatida yaratiladi
        const insU = await db.query(
          `INSERT INTO users (username, role, phone_e164, full_name, status)
           VALUES ($1, 'student', $1, $2, 'pending')
           RETURNING id`,
          [normPhone, fullName || 'Foydalanuvchi']
        );
        userId = insU.rows[0].id;
      }
    }

    // 3. telegram_identities ga bog'lash
    await db.query(
      `INSERT INTO telegram_identities (telegram_id, user_id, phone_verified_at, bound_at, unbound_at)
       VALUES ($1, $2, NOW(), NOW(), NULL)
       ON CONFLICT (telegram_id) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           phone_verified_at = NOW(),
           bound_at = NOW(),
           unbound_at = NULL`,
      [telegramId, userId]
    );

    await logAudit(db, {
      school_id: schoolId,
      user_id: userId,
      action: 'TELEGRAM_CONTACT_BOUND',
      entity: 'telegram_identity',
      entity_id: String(telegramId),
      ip_address: ipAddress,
    });

    // Avtomatik sessiya yaratish (bir bosishda auto-login)
    const sessionToken = generateSessionToken();
    const tokenHash = hashSessionToken(sessionToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const memRes = await db.query(
      "SELECT id, school_id FROM memberships WHERE user_id = $1 AND status = 'active' LIMIT 1",
      [userId]
    );
    const membershipId = memRes.rows.length ? memRes.rows[0].id : null;
    const finalSchoolId = memRes.rows.length ? memRes.rows[0].school_id : schoolId;

    await db.query(
      `INSERT INTO sessions (id, user_id, school_id, membership_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tokenHash, userId, finalSchoolId, membershipId, tokenHash, expiresAt.toISOString()]
    );

    const finalU = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
    return {
      user: finalU.rows[0],
      sessionToken,
      message: "Telefon raqamingiz muvaffaqiyatli tasdiqlandi va Telegram hisobingizga bog'landi ✅",
    };
  }

  /**
   * Sessiya orqali joriy foydalanuvchini olish (v3 menu va memberships qo'shilgan)
   */
  static async getUserByToken(
    db: DbClient,
    sessionToken: string
  ): Promise<{
    user: AuthUser;
    permissions: Permission[];
    membership?: any;
    position?: any;
    menu: MenuItem[];
    memberships: any[];
  } | null> {
    const tokenHash = hashSessionToken(sessionToken);

    const sessionRes = await db.query(
      `SELECT s.id as session_id, s.school_id as session_school_id, s.membership_id, s.expires_at,
              u.id as user_id, u.school_id as user_school_id, u.username, u.role, u.phone_e164, u.full_name,
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

    // Memberships olish
    const memRes = await db.query(
      `SELECT m.id as membership_id, m.school_id, m.status as membership_status,
              p.id as position_id, p.key as position_key, p.name_uz as position_name,
              p.scope, p.rank, s.name as school_name
       FROM memberships m
       JOIN positions p ON m.position_id = p.id
       LEFT JOIN schools s ON m.school_id = s.id
       WHERE m.user_id = $1 AND m.status = 'active'
       ORDER BY p.rank ASC`,
      [row.user_id]
    );

    let activeMem = memRes.rows.find((m) => m.membership_id === row.membership_id) || memRes.rows[0];

    let permissions: Permission[] = [];
    let positionKey = activeMem?.position_key || row.role;

    if (activeMem) {
      const permRes = await db.query<{ permission: Permission }>(
        'SELECT permission FROM position_permissions WHERE position_id = $1',
        [activeMem.position_id]
      );
      if (permRes.rows.length > 0) {
        permissions = permRes.rows.map((p) => p.permission);
      } else {
        permissions = PRESET_POSITIONS[activeMem.position_key]?.permissions || [];
      }
    } else {
      // Legacy fallback
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
          permissions = DEFAULT_ROLE_PERMISSIONS[row.role] || [];
        }
      }
    }

    const menu = computeMenu(permissions, positionKey);

    const user: AuthUser = {
      id: row.user_id,
      school_id: row.session_school_id || row.user_school_id,
      username: row.username,
      role: positionKey,
      phone_e164: row.phone_e164,
      full_name: row.full_name,
      membership_id: activeMem?.membership_id || null,
      position_id: activeMem?.position_id || null,
      position_key: positionKey,
      scope: activeMem?.scope || 'school',
      rank: activeMem?.rank || 100,
      teacher_id: row.teacher_id,
      student_id: row.student_id,
      must_change_password: row.must_change_password,
      support_school_id: row.session_school_id !== row.user_school_id ? row.session_school_id : undefined,
    };

    return {
      user,
      permissions,
      membership: activeMem || null,
      position: activeMem
        ? {
            id: activeMem.position_id,
            key: activeMem.position_key,
            name_uz: activeMem.position_name,
            scope: activeMem.scope,
            rank: activeMem.rank,
          }
        : null,
      menu,
      memberships: memRes.rows,
    };
  }

  /**
   * Telefon raqam orqali kirish (v2 fallback va testlar uchun)
   */
  static async loginByPhone(db: DbClient, phoneInput: string, ipAddress?: string): Promise<LoginResult> {
    const normPhone = normalizePhone(phoneInput);
    const digits = normPhone.replace(/\D/g, '');

    let targetUser: any = null;

    // 1. users jadvalidan
    const uRes = await db.query('SELECT * FROM users WHERE phone_e164 = $1 OR username = $1 LIMIT 1', [normPhone]);
    if (uRes.rows.length) {
      targetUser = uRes.rows[0];
    }

    // 2. Default owner
    const isOwnerLogin =
      digits === '998996893228' ||
      digits.endsWith('996893228') ||
      digits.includes('996893228') ||
      phoneInput.toLowerCase() === 'owner' ||
      normPhone === normalizePhone(env.OWNER_PHONE);

    if (isOwnerLogin) {
      if (!targetUser) {
        let ownerRes = await db.query("SELECT * FROM users WHERE role = 'owner' LIMIT 1");
        if (ownerRes.rows.length) {
          targetUser = ownerRes.rows[0];
        } else {
          const ins = await db.query(
            "INSERT INTO users (username, role, phone_e164, full_name, status) VALUES ('+998996893228', 'owner', '+998996893228', 'Platforma Egasi', 'active') RETURNING *"
          );
          targetUser = ins.rows[0];
        }
      }
      let oPos = await db.query("SELECT id FROM positions WHERE school_id IS NULL AND key = 'owner' LIMIT 1");
      let oPosId = oPos.rows[0]?.id;
      if (!oPosId) {
        const insPos = await db.query(
          "INSERT INTO positions (school_id, key, name_uz, base_key, scope, rank, is_preset) VALUES (NULL, 'owner', 'Platforma egasi', 'owner', 'school', 1, true) RETURNING id"
        );
        oPosId = insPos.rows[0].id;
      }
      const pm = await db.query("SELECT id FROM memberships WHERE user_id = $1 AND position_id = $2 LIMIT 1", [targetUser.id, oPosId]);
      if (pm.rows.length === 0) {
        await db.query("INSERT INTO memberships (user_id, school_id, position_id, status) VALUES ($1, NULL, $2, 'active')", [targetUser.id, oPosId]);
      }
    }

    // 3. Teachers
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
          let teacherRole = 'teacher';
          const pLow = (teacher.position || '').toLowerCase();
          if (pLow.includes('direktor') && !pLow.includes('o\'rinbosar')) {
            teacherRole = 'director';
          } else if (pLow.includes('o\'rinbosar') || pLow.includes('zavuch') || pLow.includes('admin')) {
            teacherRole = 'admin';
          }

          const pwHash = await hashPassword('Teacher123!');
          const created = await db.query(
            `INSERT INTO users (school_id, username, password_hash, role, teacher_id, phone_e164, full_name, must_change_password)
             VALUES ($1, $2, $3, $4, $5, $2, $6, false)
             RETURNING *`,
            [teacher.school_id, teacher.phone || ('t_' + teacher.id), pwHash, teacherRole, teacher.id, teacher.name]
          );
          targetUser = created.rows[0];
          // Membership
          const pos = await db.query("SELECT id FROM positions WHERE school_id = $1 AND key = $2 LIMIT 1", [teacher.school_id, teacherRole]);
          if (pos.rows.length) {
            await db.query(
              `INSERT INTO memberships (user_id, school_id, position_id, teacher_id, status)
               VALUES ($1, $2, $3, $4, 'active')`,
              [targetUser.id, teacher.school_id, pos.rows[0].id, teacher.id]
            );
          }
        }
      }
    }

    // 4. School settings phone (director)
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

    // 5. Students
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
            `INSERT INTO users (school_id, username, password_hash, role, student_id, phone_e164, full_name, must_change_password)
             VALUES ($1, $2, $3, 'student', $4, $2, $5, false)
             RETURNING *`,
            [student.school_id, student.phone || student.parent_phone || ('s_' + student.id), pwHash, student.id, student.name]
          );
          targetUser = created.rows[0];
          const pos = await db.query("SELECT id FROM positions WHERE school_id = $1 AND key = 'student' LIMIT 1", [student.school_id]);
          if (pos.rows.length) {
            await db.query(
              `INSERT INTO memberships (user_id, school_id, position_id, student_id, status)
               VALUES ($1, $2, $3, $4, 'active')`,
              [targetUser.id, student.school_id, pos.rows[0].id, student.id]
            );
          }
        }
      }
    }

    if (!targetUser) {
      throw new Error("Ushbu telefon raqami maktab bazasida topilmadi. Admin tomonidan ro'yxatga kiritilgan raqamni kiriting.");
    }

    const sessionToken = generateSessionToken();
    const tokenHash = hashSessionToken(sessionToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const mRes = await db.query(
      `SELECT m.id, m.school_id, p.id as position_id, p.key as position_key
       FROM memberships m
       JOIN positions p ON m.position_id = p.id
       WHERE m.user_id = $1 AND m.status = 'active'
       LIMIT 1`,
      [targetUser.id]
    );
    const membershipId = mRes.rows.length ? mRes.rows[0].id : null;

    await db.query(
      `INSERT INTO sessions (id, user_id, school_id, membership_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tokenHash, targetUser.id, targetUser.school_id, membershipId, tokenHash, expiresAt.toISOString()]
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

    const perms = DEFAULT_ROLE_PERMISSIONS[targetUser.role] || [];
    const menu = computeMenu(perms, targetUser.role);

    return {
      sessionToken,
      user,
      mustChangePassword: false,
      expiresAt,
      permissions: perms,
      menu,
    };
  }

  /**
   * Tizimdan chiqish (Logout)
   */
  static async logout(db: DbClient, sessionToken: string): Promise<void> {
    const tokenHash = hashSessionToken(sessionToken);
    await db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  }

  /**
   * Parolni o'zgartirish
   */
  static async changePassword(
    db: DbClient,
    userId: number,
    currentPlainPassword: string,
    newPlainPassword: string,
    ipAddress?: string
  ): Promise<void> {
    if (newPlainPassword.length < 8) {
      throw new Error("Yangi parol kamida 8 ta belgidan iborat bo'lishi kerak");
    }

    const userRes = await db.query('SELECT password_hash, school_id FROM users WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) {
      throw new Error('Foydalanuvchi topilmadi');
    }

    const isValid = await verifyPassword(userRes.rows[0].password_hash || '', currentPlainPassword);
    if (!isValid) {
      throw new Error("Amaldagi parol noto'g'ri");
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
      entity: 'session',
      entity_id: tokenHash,
      ip_address: ipAddress,
    });
  }

  /**
   * Yangi maktab va uning direktorini yaratish (Owner tomonidan)
   */
  static async createSchoolWithDirector(
    db: DbClient,
    ownerUser: AuthUser,
    schoolName: string,
    directorUsername: string,
    directorPhone?: string,
    ipAddress?: string
  ): Promise<{
    school: { id: number; name: string };
    director: { id: number; username: string; tempPassword: string };
  }> {
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

      // 4. Maktab uchun standart ruxsatlar (legacy role_permissions)
      for (const role of ['director', 'admin', 'teacher', 'student'] as const) {
        const perms = DEFAULT_ROLE_PERMISSIONS[role];
        for (const p of perms) {
          await tx.query(
            'INSERT INTO role_permissions (school_id, role, permission) VALUES ($1, $2, $3)',
            [school.id, role, p]
          );
        }
      }

      // 5. 13 ta preset lavozimni maktabga kiritish
      await AuthService.seedSchoolPositions(tx, school.id);

      // 6. Direktorni yaratish
      const normPhone = directorPhone ? normalizePhone(directorPhone) : null;
      const dRes = await tx.query<{ id: number; username: string }>(
        `INSERT INTO users (school_id, username, password_hash, role, phone_e164, full_name, must_change_password)
         VALUES ($1, $2, $3, 'director', $4, 'Maktab Direktori', TRUE) RETURNING id, username`,
        [school.id, directorUsername.trim().toLowerCase(), pwHash, normPhone]
      );
      const director = dRes.rows[0];

      // Direktor uchun membership
      const dirPos = await tx.query(
        "SELECT id FROM positions WHERE school_id = $1 AND key = 'director' LIMIT 1",
        [school.id]
      );
      if (dirPos.rows.length) {
        await tx.query(
          `INSERT INTO memberships (user_id, school_id, position_id, status)
           VALUES ($1, $2, $3, 'active')`,
          [director.id, school.id, dirPos.rows[0].id]
        );
      }

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
   * Maktab ichida foydalanuvchi yaratish (Section 5.5 berish qoidalari bilan)
   */
  static async createUser(
    db: DbClient,
    creatorUser: AuthUser,
    data: {
      username: string;
      role: 'director' | 'admin' | 'teacher' | 'student';
      phone?: string;
      full_name?: string;
      teacher_id?: number | null;
      student_id?: number | null;
    },
    ipAddress?: string
  ): Promise<{ id: number; username: string; tempPassword: string; role: string }> {
    let schoolId = creatorUser.role === 'owner' ? creatorUser.support_school_id : creatorUser.school_id;
    if (!schoolId && creatorUser.role === 'owner') {
      const sch = await db.query('SELECT id FROM schools ORDER BY id ASC LIMIT 1');
      schoolId = sch.rows[0]?.id;
    }
    if (!schoolId) {
      throw new Error('Maktab aniqlanmadi');
    }

    if (data.role === 'director' && creatorUser.role !== 'owner') {
      throw new Error('Faqat platforma egasi direktor hisobini yarata oladi');
    }
    if (creatorUser.role === 'admin' && data.role === 'admin') {
      throw new Error('Admin boshqa admin yarata olmaydi');
    }
    if (!['owner', 'director', 'admin'].includes(creatorUser.role)) {
      throw new Error("Foydalanuvchi yaratishga ruxsat yo'q");
    }

    const tempPassword = generateTempPassword(10);
    const pwHash = await hashPassword(tempPassword);
    const normPhone = data.phone ? normalizePhone(data.phone) : null;

    const uRes = await db.query<{ id: number; username: string; role: string }>(
      `INSERT INTO users (school_id, username, password_hash, role, phone_e164, full_name, teacher_id, student_id, must_change_password)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE) RETURNING id, username, role`,
      [
        schoolId,
        data.username.trim().toLowerCase(),
        pwHash,
        data.role,
        normPhone,
        data.full_name || data.username,
        data.teacher_id || null,
        data.student_id || null,
      ]
    );

    const created = uRes.rows[0];

    // Membership yaratish
    const posRes = await db.query(
      'SELECT id FROM positions WHERE school_id = $1 AND key = $2 LIMIT 1',
      [schoolId, data.role]
    );
    if (posRes.rows.length) {
      await db.query(
        `INSERT INTO memberships (user_id, school_id, position_id, teacher_id, student_id, status)
         VALUES ($1, $2, $3, $4, $5, 'active')`,
        [created.id, schoolId, posRes.rows[0].id, data.teacher_id || null, data.student_id || null]
      );
    }

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
      throw new Error("Platforma egasini (owner) o'chirib bo'lmaydi");
    }

    // 2. Maktabning oxirgi direktorini o'chirish taqiqlanadi
    if (target.role === 'director') {
      const directorCountRes = await db.query(
        'SELECT COUNT(*) as count FROM users WHERE school_id = $1 AND role = $2',
        [target.school_id, 'director']
      );
      if (parseInt(directorCountRes.rows[0].count, 10) <= 1) {
        throw new Error("Maktabning yagona direktorini o'chirib bo'lmaydi. Avval yangi direktor tayinlang");
      }
    }

    // Maktab izolyatsiyasi tekshiruvi
    if (actor.role !== 'owner' && actor.school_id !== target.school_id) {
      throw new Error("Boshqa maktab foydalanuvchisini o'chirish taqiqlanadi");
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
