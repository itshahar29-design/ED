import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { SchoolService } from './school.service.js';
import { AuthService } from '../auth/auth.service.js';
import { can } from '../auth/permissions.js';
import { DbClient } from '../../db/client.js';

async function getAuth(request: FastifyRequest, db: DbClient) {
  const token = request.cookies.sessionId || request.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  return await AuthService.getUserByToken(db, token);
}

function getEffectiveSchoolId(user: any): number {
  if (user.role === 'owner') {
    if (!user.support_school_id) {
      throw new Error('Platforma egasi (owner) uchun avval yordam rejimida maktab tanlanishi shart');
    }
    return user.support_school_id;
  }
  if (!user.school_id) throw new Error('Maktab aniqlanmadi');
  return user.school_id;
}

export async function schoolRoutes(app: FastifyInstance) {
  const db: DbClient = (app as any).db;

  // ================= YEARS =================
  app.get('/api/v1/years', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);
    const years = await SchoolService.listYears(db, schoolId);
    return reply.send({ status: 'ok', data: years });
  });

  app.post('/api/v1/years', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'MANAGE_SETTINGS', { type: 'settings', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    const schema = z.object({ name: z.string().min(1, 'Nom kiriting') });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.errors[0].message });

    try {
      const year = await SchoolService.createYear(db, schoolId, parsed.data.name);
      return reply.send({ status: 'ok', data: year });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.post('/api/v1/years/:id/current', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'MANAGE_SETTINGS', { type: 'settings', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    try {
      const year = await SchoolService.setCurrentYear(db, schoolId, Number(request.params.id));
      return reply.send({ status: 'ok', data: year });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // ================= SUBJECTS =================
  app.get('/api/v1/subjects', async (request: FastifyRequest<{ Querystring: { arc?: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);
    const subjects = await SchoolService.listSubjects(db, schoolId, request.query.arc === '1');
    return reply.send({ status: 'ok', data: subjects });
  });

  app.post('/api/v1/subjects', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'MANAGE_SUBJECTS', { type: 'subject', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    const schema = z.object({
      name: z.string().min(1, 'Fan nomini kiriting'),
      code: z.string().optional(),
      color: z.string().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.errors[0].message });

    try {
      const subject = await SchoolService.createSubject(db, schoolId, parsed.data.name, parsed.data.code, parsed.data.color);
      return reply.send({ status: 'ok', data: subject });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.put('/api/v1/subjects/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'MANAGE_SUBJECTS', { type: 'subject', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    const schema = z.object({
      name: z.string().min(1, 'Fan nomini kiriting'),
      code: z.string().optional(),
      color: z.string().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.errors[0].message });

    try {
      const subject = await SchoolService.updateSubject(db, schoolId, Number(request.params.id), parsed.data.name, parsed.data.code, parsed.data.color);
      return reply.send({ status: 'ok', data: subject });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.patch('/api/v1/subjects/:id/status', async (request: FastifyRequest<{ Params: { id: string }; Body: { status: 'a' | 'x' } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'MANAGE_SUBJECTS', { type: 'subject', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    try {
      const subject = await SchoolService.setSubjectStatus(db, schoolId, Number(request.params.id), request.body.status);
      return reply.send({ status: 'ok', data: subject });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.delete('/api/v1/subjects/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'MANAGE_SUBJECTS', { type: 'subject', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    try {
      const res = await SchoolService.deleteSubject(db, schoolId, Number(request.params.id));
      return reply.send({ status: 'ok', message: 'Fan o\'chirildi', data: res });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // ================= TEACHERS =================
  app.get('/api/v1/teachers', async (request: FastifyRequest<{ Querystring: { arc?: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'VIEW_TEACHERS', { type: 'teacher', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    const teachers = await SchoolService.listTeachers(db, schoolId, request.query.arc === '1');
    return reply.send({ status: 'ok', data: teachers });
  });

  app.post('/api/v1/teachers', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'MANAGE_TEACHERS', { type: 'teacher', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    const schema = z.object({
      name: z.string().min(1, 'Ism kiriting'),
      code: z.string().optional(),
      phone: z.string().optional(),
      pos: z.string().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.errors[0].message });

    try {
      const teacher = await SchoolService.createTeacher(db, schoolId, parsed.data.name, parsed.data.code, parsed.data.phone, parsed.data.pos);
      return reply.send({ status: 'ok', data: teacher });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.put('/api/v1/teachers/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'MANAGE_TEACHERS', { type: 'teacher', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    const schema = z.object({
      name: z.string().min(1, 'Ism kiriting'),
      code: z.string().optional(),
      phone: z.string().optional(),
      pos: z.string().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.errors[0].message });

    try {
      const teacher = await SchoolService.updateTeacher(db, schoolId, Number(request.params.id), parsed.data.name, parsed.data.code, parsed.data.phone, parsed.data.pos);
      return reply.send({ status: 'ok', data: teacher });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.patch('/api/v1/teachers/:id/status', async (request: FastifyRequest<{ Params: { id: string }; Body: { status: 'a' | 'x' } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'MANAGE_TEACHERS', { type: 'teacher', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    try {
      const teacher = await SchoolService.setTeacherStatus(db, schoolId, Number(request.params.id), request.body.status);
      return reply.send({ status: 'ok', data: teacher });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.delete('/api/v1/teachers/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'MANAGE_TEACHERS', { type: 'teacher', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    try {
      const res = await SchoolService.deleteTeacher(db, schoolId, Number(request.params.id));
      return reply.send({ status: 'ok', message: 'O\'qituvchi o\'chirildi', data: res });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // ================= CLASSES =================
  app.get('/api/v1/classes', async (request: FastifyRequest<{ Querystring: { arc?: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);
    const classes = await SchoolService.listClasses(db, schoolId, request.query.arc === '1');
    return reply.send({ status: 'ok', data: classes });
  });

  app.post('/api/v1/classes', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'MANAGE_CLASSES', { type: 'class', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    const schema = z.object({
      name: z.string().min(1, 'Sinf nomini kiriting'),
      yid: z.coerce.number().optional(),
      tid: z.coerce.number().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.errors[0].message });

    try {
      let yearId = parsed.data.yid;
      if (!yearId) {
        const years = await SchoolService.listYears(db, schoolId);
        yearId = years.find((y: any) => y.on)?.id || years[0]?.id;
      }
      if (!yearId) throw new Error('Avval o\'quv yili yarating');

      const cl = await SchoolService.createClass(db, schoolId, yearId, parsed.data.name, parsed.data.tid);
      return reply.send({ status: 'ok', data: cl });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.put('/api/v1/classes/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'MANAGE_CLASSES', { type: 'class', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    const schema = z.object({
      name: z.string().min(1, 'Sinf nomini kiriting'),
      tid: z.coerce.number().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.errors[0].message });

    try {
      const cl = await SchoolService.updateClass(db, schoolId, Number(request.params.id), parsed.data.name, parsed.data.tid);
      return reply.send({ status: 'ok', data: cl });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.patch('/api/v1/classes/:id/status', async (request: FastifyRequest<{ Params: { id: string }; Body: { status: 'a' | 'x' } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'MANAGE_CLASSES', { type: 'class', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    try {
      const cl = await SchoolService.setClassStatus(db, schoolId, Number(request.params.id), request.body.status);
      return reply.send({ status: 'ok', data: cl });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.delete('/api/v1/classes/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'MANAGE_CLASSES', { type: 'class', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    try {
      const res = await SchoolService.deleteClass(db, schoolId, Number(request.params.id));
      return reply.send({ status: 'ok', message: 'Sinf o\'chirildi', data: res });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // ================= STUDENTS =================
  app.get('/api/v1/students', async (request: FastifyRequest<{ Querystring: { arc?: string; cid?: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'VIEW_STUDENTS', { type: 'student', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    const students = await SchoolService.listStudents(
      db,
      schoolId,
      request.query.arc === '1',
      request.query.cid ? Number(request.query.cid) : undefined
    );
    return reply.send({ status: 'ok', data: students });
  });

  app.post('/api/v1/students', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'CREATE_STUDENTS', { type: 'student', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    const schema = z.object({
      name: z.string().min(1, 'Ism kiriting'),
      cid: z.coerce.number().int().positive('Sinfni tanlang'),
      code: z.string().optional(),
      phone: z.string().optional(),
      parent: z.string().optional(),
      pphone: z.string().optional(),
      tg: z.string().optional(),
      dob: z.string().optional(),
      enr: z.string().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.errors[0].message });

    try {
      const student = await SchoolService.createStudent(db, schoolId, {
        class_id: parsed.data.cid,
        name: parsed.data.name,
        code: parsed.data.code,
        phone: parsed.data.phone,
        parent_name: parsed.data.parent,
        parent_phone: parsed.data.pphone,
        tg_username: parsed.data.tg,
        dob: parsed.data.dob,
        enrolled_at: parsed.data.enr,
      });
      return reply.send({ status: 'ok', data: student });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.post('/api/v1/students/bulk', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'CREATE_STUDENTS', { type: 'student', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    const schema = z.object({
      cid: z.coerce.number().int().positive('Sinfni tanlang'),
      names: z.union([z.string(), z.array(z.string())]),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.errors[0].message });

    try {
      const result = await SchoolService.createStudentsBulk(db, schoolId, parsed.data.cid, parsed.data.names);
      return reply.send({ status: 'ok', ...result });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.put('/api/v1/students/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'EDIT_STUDENTS', { type: 'student', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    const schema = z.object({
      name: z.string().min(1, 'Ism kiriting'),
      cid: z.coerce.number().int().positive('Sinfni tanlang'),
      phone: z.string().optional(),
      parent: z.string().optional(),
      pphone: z.string().optional(),
      tg: z.string().optional(),
      dob: z.string().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.errors[0].message });

    try {
      const student = await SchoolService.updateStudent(db, schoolId, Number(request.params.id), {
        class_id: parsed.data.cid,
        name: parsed.data.name,
        phone: parsed.data.phone,
        parent_name: parsed.data.parent,
        parent_phone: parsed.data.pphone,
        tg_username: parsed.data.tg,
        dob: parsed.data.dob,
      });
      return reply.send({ status: 'ok', data: student });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.patch('/api/v1/students/:id/status', async (request: FastifyRequest<{ Params: { id: string }; Body: { status: 'a' | 'x' } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'EDIT_STUDENTS', { type: 'student', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    try {
      const student = await SchoolService.setStudentStatus(db, schoolId, Number(request.params.id), request.body.status);
      return reply.send({ status: 'ok', data: student });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.delete('/api/v1/students/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'DELETE_STUDENTS', { type: 'student', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    try {
      const res = await SchoolService.deleteStudent(db, schoolId, Number(request.params.id));
      return reply.send({ status: 'ok', message: 'O\'quvchi o\'chirildi', data: res });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // ================= ASSIGNMENTS =================
  app.get('/api/v1/assignments', async (request: FastifyRequest<{ Querystring: { tid?: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    const asgs = await SchoolService.listAssignments(
      db,
      schoolId,
      request.query.tid ? Number(request.query.tid) : undefined
    );
    return reply.send({ status: 'ok', data: asgs });
  });

  app.post('/api/v1/assignments', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'MANAGE_TEACHERS', { type: 'teacher', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    const schema = z.object({
      tid: z.coerce.number().int().positive('O\'qituvchini tanlang'),
      sid: z.coerce.number().int().positive('Fanni tanlang'),
      cid: z.coerce.number().int().positive('Sinfni tanlang'),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.errors[0].message });

    try {
      const asg = await SchoolService.createAssignment(db, schoolId, parsed.data.tid, parsed.data.sid, parsed.data.cid);
      return reply.send({ status: 'ok', data: asg });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.delete('/api/v1/assignments/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'MANAGE_TEACHERS', { type: 'teacher', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    try {
      const res = await SchoolService.deleteAssignment(db, schoolId, Number(request.params.id));
      return reply.send({ status: 'ok', message: 'Biriktirish olib tashlandi', data: res });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // ================= SCHEDULE SLOTS =================
  app.get('/api/v1/schedule', async (request: FastifyRequest<{ Querystring: { cid?: string; tid?: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    const slots = await SchoolService.listSchedule(
      db,
      schoolId,
      request.query.cid ? Number(request.query.cid) : undefined,
      request.query.tid ? Number(request.query.tid) : undefined
    );
    return reply.send({ status: 'ok', data: slots });
  });

  app.post('/api/v1/schedule', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'MANAGE_SCHEDULE', { type: 'schedule', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    const schema = z.object({
      aid: z.coerce.number().int().positive('Biriktirishni tanlang'),
      d: z.coerce.number().int().min(0).max(6),
      n: z.coerce.number().int().min(0),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.errors[0].message });

    try {
      const slot = await SchoolService.setScheduleSlot(db, schoolId, parsed.data.aid, parsed.data.d, parsed.data.n);
      return reply.send({ status: 'ok', data: slot });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  app.delete('/api/v1/schedule/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const auth = await getAuth(request, db);
    if (!auth) return reply.status(401).send({ error: 'Avtorizatsiya talab qilinadi' });
    const schoolId = getEffectiveSchoolId(auth.user);

    if (!can(auth.user, 'MANAGE_SCHEDULE', { type: 'schedule', school_id: schoolId }, { permissions: auth.permissions })) {
      return reply.status(403).send({ error: 'Ruxsat yo\'q' });
    }

    try {
      const res = await SchoolService.deleteScheduleSlot(db, schoolId, Number(request.params.id));
      return reply.send({ status: 'ok', message: 'Dars jadvaldan olib tashlandi', data: res });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });
}
