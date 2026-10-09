import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AuthService } from './auth.service.js';
import { AuthUser, Permission } from './permissions.js';
import { MenuItem } from './menu.js';
import { DbClient } from '../../db/client.js';
import { EFFECTIVE_BOT_USERNAME } from '../../config/env.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
    permissions?: Permission[];
    menu?: MenuItem[];
    sessionToken?: string;
  }
}

const loginSchema = z.object({
  username: z.string().optional(),
  password: z.string().optional(),
  phone: z.string().optional(),
});

const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Amaldagi parolni kiriting'),
  new_password: z.string().min(8, "Yangi parol kamida 8 ta belgidan iborat bo'lishi kerak"),
});

const supportModeSchema = z.object({
  school_id: z.coerce.number().int().positive("Maktab ID noto'g'ri"),
});

const telegramAuthSchema = z.object({
  initData: z.string().min(1, 'initData majburiy'),
});

const switchMembershipSchema = z.object({
  membership_id: z.coerce.number().int().positive().optional(),
  membershipId: z.coerce.number().int().positive().optional(),
});

export async function authRoutes(app: FastifyInstance) {
  const db: DbClient = (app as any).db;

  // Initial owner va 13 ta preset lavozimlarni yaratish
  await AuthService.seedInitialOwner(db);

  // 1. Telegram WebApp parolsiz kirish (EduMemory 3.0 MAX asosiy kirish yo'li)
  app.post('/api/v1/auth/telegram', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = telegramAuthSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.errors[0].message });
    }

    try {
      const result = await AuthService.loginByTelegram(db, parsed.data.initData, request.ip);

      if (result.need_phone) {
        return reply.send({
          status: 'need_phone',
          need_phone: true,
          telegram_id: result.telegram_id,
          first_name: result.first_name,
          bot_username: EFFECTIVE_BOT_USERNAME,
          message: "Iltimos, avval @EduMemoryBot orqali telefon raqamingizni tasdiqlang",
        });
      }

      if (result.need_access) {
        return reply.send({
          status: 'need_access',
          need_access: true,
          message: result.message,
          phone: result.phone,
        });
      }

      // httpOnly Secure SameSite=Lax cookie o'rnatish
      reply.setCookie('sessionId', result.sessionToken!, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60, // 30 kun
      });

      return reply.send({
        status: 'ok',
        token: result.sessionToken,
        sessionToken: result.sessionToken,
        user: result.user,
        membership: result.membership,
        position: result.position,
        permissions: result.permissions,
        menu: result.menu,
        memberships: result.memberships,
      });
    } catch (err: any) {
      return reply.status(401).send({ error: err.message || 'Telegram orqali kirishda xatolik' });
    }
  });

  // 2. Profil (membership) almashtirish
  app.post('/api/v1/auth/switch', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies.sessionId || request.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return reply.status(401).send({ error: "Avtorizatsiyadan o'tilmagan" });
    }

    const parsed = switchMembershipSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.errors[0].message });
    }

    const targetId = parsed.data.membership_id || parsed.data.membershipId;
    if (!targetId) {
      return reply.status(400).send({ error: 'membership_id ko\'rsatilishi shart' });
    }

    try {
      const switched = await AuthService.switchMembership(db, token, targetId, request.ip);
      return reply.send({
        status: 'ok',
        user: switched.user,
        membership: switched.membership,
        position: switched.position,
        permissions: switched.permissions,
        menu: switched.menu,
      });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // 3. Telegramni uzish (Unlink)
  app.post('/api/v1/auth/unlink', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies.sessionId || request.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return reply.status(401).send({ error: "Avtorizatsiyadan o'tilmagan" });
    }

    try {
      await AuthService.unlinkTelegram(db, token, request.ip);
      reply.clearCookie('sessionId', { path: '/' });
      return reply.send({ status: 'ok', message: 'Telegram profili uzildi' });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // 4. Me (joriy foydalanuvchi ma'lumoti)
  app.get('/api/v1/auth/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies.sessionId || request.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return reply.status(401).send({ error: "Avtorizatsiyadan o'tilmagan" });
    }

    const authData = await AuthService.getUserByToken(db, token);
    if (!authData) {
      reply.clearCookie('sessionId', { path: '/' });
      return reply.status(401).send({ error: 'Sessiya eskirgan yoki yaroqsiz' });
    }

    return reply.send({
      status: 'ok',
      user: authData.user,
      membership: authData.membership,
      position: authData.position,
      permissions: authData.permissions,
      menu: authData.menu,
      memberships: authData.memberships,
    });
  });

  // 5. Login (Telefon raqam yoki Username/Password orqali - v2 legacy)
  app.post('/api/v1/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.errors[0].message });
    }

    try {
      const ip = request.ip;
      let result;

      if (parsed.data.username && parsed.data.password) {
        result = await AuthService.login(db, parsed.data.username, parsed.data.password, ip);
      } else {
        return reply.status(401).send({ error: "Xavfsizlik talabi: Tizimga kirish faqat Telegram bot orqali amalga oshiriladi" });
      }

      reply.setCookie('sessionId', result.sessionToken, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60,
      });

      return reply.send({
        status: 'ok',
        token: result.sessionToken,
        sessionToken: result.sessionToken,
        user: result.user,
        permissions: result.permissions,
        menu: result.menu,
        must_change_password: false,
      });
    } catch (err: any) {
      return reply.status(401).send({ error: err.message || 'Kirishda xatolik' });
    }
  });

  // 6. Logout
  app.post('/api/v1/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies.sessionId || request.sessionToken || request.headers.authorization?.replace('Bearer ', '');
    if (token) {
      await AuthService.logout(db, token);
    }
    reply.clearCookie('sessionId', { path: '/' });
    return reply.send({ status: 'ok', message: 'Tizimdan chiqildi' });
  });

  // 7. Parolni o'zgartirish
  app.post('/api/v1/auth/change-password', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies.sessionId || request.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return reply.status(401).send({ error: "Avtorizatsiyadan o'tilmagan" });
    }

    const authData = await AuthService.getUserByToken(db, token);
    if (!authData) {
      return reply.status(401).send({ error: 'Sessiya yaroqsiz' });
    }

    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.errors[0].message });
    }

    try {
      await AuthService.changePassword(
        db,
        authData.user.id,
        parsed.data.current_password,
        parsed.data.new_password,
        request.ip
      );
      return reply.send({ status: 'ok', message: 'Parol muvaffaqiyatli yangilandi' });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // 8. Owner Support Mode (Yordam rejimi)
  app.post('/api/v1/auth/support-mode', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies.sessionId || request.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return reply.status(401).send({ error: "Avtorizatsiyadan o'tilmagan" });
    }

    const authData = await AuthService.getUserByToken(db, token);
    if (!authData || authData.user.role !== 'owner') {
      return reply.status(403).send({ error: 'Faqat platforma egasi (owner) uchun' });
    }

    const parsed = supportModeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.errors[0].message });
    }

    try {
      await AuthService.enterSupportMode(db, token, authData.user, parsed.data.school_id, request.ip);
      return reply.send({ status: 'ok', message: "Maktab yordam rejimiga o'tildi", school_id: parsed.data.school_id });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // 9. Owner Exit Support Mode
  app.post('/api/v1/auth/exit-support-mode', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies.sessionId || request.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return reply.status(401).send({ error: "Avtorizatsiyadan o'tilmagan" });
    }

    const authData = await AuthService.getUserByToken(db, token);
    if (!authData || authData.user.role !== 'owner') {
      return reply.status(403).send({ error: 'Faqat platforma egasi (owner) uchun' });
    }

    try {
      await AuthService.exitSupportMode(db, token, authData.user, request.ip);
      return reply.send({ status: 'ok', message: 'Yordam rejimidan chiqildi' });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // 10. Direct auto-login URL (from Telegram bot)
  app.get('/api/v1/auth/direct-login', async (request: FastifyRequest<{ Querystring: { token?: string } }>, reply: FastifyReply) => {
    const token = request.query.token;
    if (!token) {
      return reply.redirect('/?err=token_required');
    }

    const authData = await AuthService.getUserByToken(db, token);
    if (!authData) {
      return reply.redirect('/?err=invalid_token');
    }

    reply.setCookie('sessionId', token, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60,
    });

    return reply.redirect('/');
  });
}
