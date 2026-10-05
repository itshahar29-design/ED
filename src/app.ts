import fastify, { FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { env } from './config/env.js';
import { DbClient, getDb } from './db/client.js';

export interface BuildAppOptions {
  db?: DbClient;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = fastify({
    logger: env.NODE_ENV !== 'test',
  });

  const db = options.db || (await getDb());
  app.decorate('db', db);

  // Security headers
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: false, // allow inline scripts in index.html
  });

  // CORS
  await app.register(fastifyCors, {
    origin: true,
    credentials: true,
  });

  // Cookies
  await app.register(fastifyCookie, {
    secret: env.COOKIE_SECRET,
  });

  // Rate Limiting (max 200 requests per minute per IP)
  await app.register(fastifyRateLimit, {
    max: 200,
    timeWindow: '1 minute',
  });

  // Health check endpoint
  app.get('/api/v1/health', async (request, reply) => {
    return {
      status: 'ok',
      service: 'EduMemory Backend',
      version: '2.0.0',
      timestamp: new Date().toISOString(),
      timezone: env.TIMEZONE,
    };
  });

  // Auth routes
  const { authRoutes } = await import('./modules/auth/auth.routes.js');
  await app.register(authRoutes);

  // School CRUD routes
  const { schoolRoutes } = await import('./modules/school/school.routes.js');
  await app.register(schoolRoutes);

  // Attendance & Reports routes
  const { attendanceRoutes } = await import('./modules/attendance/attendance.routes.js');
  await app.register(attendanceRoutes);

  // Bootstrap, Import, Export, Settings, Users, Schools routes
  const { bootstrapRoutes } = await import('./modules/bootstrap/bootstrap.routes.js');
  await app.register(bootstrapRoutes);

  // Telegram routes
  const { telegramRoutes } = await import('./modules/telegram/telegram.routes.js');
  await app.register(telegramRoutes);

  // Serve index.html and static files from root
  const rootDir = process.cwd();
  await app.register(fastifyStatic, {
    root: rootDir,
    index: false,
    serve: false,
  });

  app.get('/', async (request, reply) => {
    const indexPath = path.join(rootDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      reply.type('text/html');
      return fs.createReadStream(indexPath);
    }
    return reply.status(404).send('index.html not found');
  });

  return app;
}
