import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createTestDb, DbClient } from '../src/db/client.js';

describe('M0: Reja, sxema, Docker, bo\'sh server', () => {
  let app: FastifyInstance;
  let testDb: DbClient;

  beforeAll(async () => {
    testDb = await createTestDb();
    app = await buildApp({ db: testDb });
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (testDb) await testDb.close();
  });

  it('1. Bo\'sh server ishga tushishi va /api/v1/health 200 qaytarishi kerak', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.service).toBe('EduMemory Backend');
    expect(body.version).toBe('2.0.0');
    expect(body.timezone).toBe('Asia/Tashkent');
  });

  it('2. GET / so\'rovi index.html faylini qaytarishi kerak', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('EduMemory');
    expect(res.body).toContain('edm_school_v1');
  });

  it('3. DB sxemasidagi barcha asosiy jadvallar yaratilgan bo\'lishi kerak', async () => {
    const tablesRes = await testDb.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';`
    );
    const tableNames = tablesRes.rows.map(r => r.table_name);

    const requiredTables = [
      'schools',
      'school_settings',
      'years',
      'subjects',
      'teachers',
      'classes',
      'students',
      'assignments',
      'schedule_slots',
      'attendance_sessions',
      'attendance_records',
      'attendance_excuses',
      'users',
      'sessions',
      'role_permissions',
      'telegram_invites',
      'parent_contacts',
      'outbox_messages',
      'audit_log',
      'idempotency_keys'
    ];

    for (const tbl of requiredTables) {
      expect(tableNames, `Jadval mavjud bo'lishi kerak: ${tbl}`).toContain(tbl);
    }
  });

  it('4. Dockerfile va docker-compose.yml fayllari to\'g\'ri mavjud bo\'lishi kerak', () => {
    const dockerfilePath = path.join(process.cwd(), 'Dockerfile');
    const composePath = path.join(process.cwd(), 'docker-compose.yml');
    const dockerignorePath = path.join(process.cwd(), '.dockerignore');

    expect(fs.existsSync(dockerfilePath)).toBe(true);
    expect(fs.existsSync(composePath)).toBe(true);
    expect(fs.existsSync(dockerignorePath)).toBe(true);

    const composeContent = fs.readFileSync(composePath, 'utf8');
    expect(composeContent).toContain('postgres:16-alpine');
    expect(composeContent).toContain('edumemory');
    expect(composeContent).toContain('3000');
  });
});
