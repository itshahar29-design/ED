import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AuthService } from './auth.service.js';
import { AuthUser, Permission, can } from './permissions.js';
import { DbClient } from '../../db/client.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
    permissions?: Permission[];
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
  new_password: z.string().min(8, 'Yangi parol kamida 8 ta belgidan iborat bo\'lishi kerak'),
});

const supportModeSchema = z.object({
  school_id: z.coerce.number().int().positive('Maktab ID noto\'g\'ri'),
});

export async function authRoutes(app: FastifyInstance) {
  const db: DbClient = (app as any).db;

  // Initial owner yaratish
  await AuthService.seedInitialOwner(db);

  // 1. Login (Telefon raqam yoki Username/Password orqali)
  app.post('/api/v1/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.errors[0].message });
    }

    try {
      const ip = request.ip;
      let result;

      // Agar telefon yuborilgan bo'lsa yoki parol kiritilmagan bo'lsa -> telefon orqali kirish
      const phoneInput = parsed.data.phone || (!parsed.data.password ? parsed.data.username : undefined);

      if (phoneInput) {
        result = await AuthService.loginByPhone(db, phoneInput, ip);
      } else if (parsed.data.username && parsed.data.password) {
        result = await AuthService.login(db, parsed.data.username, parsed.data.password, ip);
      } else {
        return reply.status(400).send({ error: 'Telefon raqamingizni kiriting' });
      }

      // httpOnly cookie o'rnatish
      reply.setCookie('sessionId', result.sessionToken, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60, // 30 kun
      });

      return reply.send({
        status: 'ok',
        user: result.user,
        must_change_password: false,
      });
    } catch (err: any) {
      return reply.status(401).send({ error: err.message || 'Kirishda xatolik' });
    }
  });

  // 2. Logout
  app.post('/api/v1/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies.sessionId || request.sessionToken;
    if (token) {
      await AuthService.logout(db, token);
    }
    reply.clearCookie('sessionId', { path: '/' });
    return reply.send({ status: 'ok', message: 'Tizimdan chiqildi' });
  });

  // 3. Me (joriy foydalanuvchi ma'lumoti)
  app.get('/api/v1/auth/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies.sessionId || request.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return reply.status(401).send({ error: 'Avtorizatsiyadan o\'tilmagan' });
    }

    const authData = await AuthService.getUserByToken(db, token);
    if (!authData) {
      reply.clearCookie('sessionId', { path: '/' });
      return reply.status(401).send({ error: 'Sessiya eskirgan yoki yaroqsiz' });
    }

    return reply.send({
      status: 'ok',
      user: authData.user,
      permissions: authData.permissions,
    });
  });

  // 4. Parolni o'zgartirish
  app.post('/api/v1/auth/change-password', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies.sessionId || request.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return reply.status(401).send({ error: 'Avtorizatsiyadan o\'tilmagan' });
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

  // 5. Owner Support Mode (Yordam rejimi)
  app.post('/api/v1/auth/support-mode', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies.sessionId || request.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return reply.status(401).send({ error: 'Avtorizatsiyadan o\'tilmagan' });
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
      return reply.send({ status: 'ok', message: 'Maktab yordam rejimiga o\'tildi', school_id: parsed.data.school_id });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // 6. Owner Exit Support Mode
  app.post('/api/v1/auth/exit-support-mode', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies.sessionId || request.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return reply.status(401).send({ error: 'Avtorizatsiyadan o\'tilmagan' });
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
}
