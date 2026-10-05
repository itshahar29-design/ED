export const DDL_SCHEMA = `
-- EduMemory PostgreSQL 16 Database Schema
-- Multi-tenant isolation with composite foreign keys and Row Level Security (RLS)

-- 1. Schools
CREATE TABLE IF NOT EXISTS schools (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. School Settings
CREATE TABLE IF NOT EXISTS school_settings (
  school_id INT PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL DEFAULT 'Maktab',
  addr TEXT NOT NULL DEFAULT '',
  phone VARCHAR(50) NOT NULL DEFAULT '',
  logo VARCHAR(10) NOT NULL DEFAULT '🎓',
  days JSONB NOT NULL DEFAULT '[0, 1, 2, 3, 4]'::jsonb,
  times JSONB NOT NULL DEFAULT '["08:00-08:45","08:55-09:40","09:50-10:35","10:45-11:30","11:40-12:25","12:35-13:20"]'::jsonb,
  tg_send_mode VARCHAR(30) NOT NULL DEFAULT 'end_of_day',
  tg_send_time VARCHAR(10) NOT NULL DEFAULT '15:00',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Academic Years
CREATE TABLE IF NOT EXISTS years (
  school_id INT NOT NULL,
  id SERIAL,
  name VARCHAR(100) NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(10) NOT NULL DEFAULT 'a',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, id),
  UNIQUE (id),
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
);

-- 4. Subjects
CREATE TABLE IF NOT EXISTS subjects (
  school_id INT NOT NULL,
  id SERIAL,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) NOT NULL,
  color VARCHAR(20) NOT NULL DEFAULT '#3b5bdb',
  status VARCHAR(10) NOT NULL DEFAULT 'a',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, id),
  UNIQUE (id),
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
);

-- 5. Teachers
CREATE TABLE IF NOT EXISTS teachers (
  school_id INT NOT NULL,
  id SERIAL,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) NOT NULL,
  phone VARCHAR(50) NOT NULL DEFAULT '',
  position VARCHAR(100) NOT NULL DEFAULT 'O''qituvchi',
  status VARCHAR(10) NOT NULL DEFAULT 'a',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, id),
  UNIQUE (id),
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
);

-- 6. Classes
CREATE TABLE IF NOT EXISTS classes (
  school_id INT NOT NULL,
  id SERIAL,
  year_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  leader_teacher_id INT,
  status VARCHAR(10) NOT NULL DEFAULT 'a',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, id),
  UNIQUE (id),
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, year_id) REFERENCES years(school_id, id) ON DELETE RESTRICT
);

-- 7. Students
CREATE TABLE IF NOT EXISTS students (
  school_id INT NOT NULL,
  id SERIAL,
  class_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) NOT NULL,
  phone VARCHAR(50) NOT NULL DEFAULT '',
  parent_name VARCHAR(255) NOT NULL DEFAULT '',
  parent_phone VARCHAR(50) NOT NULL DEFAULT '',
  tg_username VARCHAR(100) NOT NULL DEFAULT '',
  dob DATE,
  enrolled_at DATE NOT NULL DEFAULT CURRENT_DATE,
  status VARCHAR(10) NOT NULL DEFAULT 'a',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, id),
  UNIQUE (id),
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, class_id) REFERENCES classes(school_id, id) ON DELETE RESTRICT
);

-- 8. Assignments (O'qituvchi - Fan - Sinf)
CREATE TABLE IF NOT EXISTS assignments (
  school_id INT NOT NULL,
  id SERIAL,
  teacher_id INT NOT NULL,
  subject_id INT NOT NULL,
  class_id INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, id),
  UNIQUE (id),
  UNIQUE (school_id, class_id, subject_id),
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, teacher_id) REFERENCES teachers(school_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (school_id, subject_id) REFERENCES subjects(school_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (school_id, class_id) REFERENCES classes(school_id, id) ON DELETE RESTRICT
);

-- 9. Schedule Slots
CREATE TABLE IF NOT EXISTS schedule_slots (
  school_id INT NOT NULL,
  id SERIAL,
  assignment_id INT NOT NULL,
  class_id INT NOT NULL,
  teacher_id INT NOT NULL,
  day INT NOT NULL CHECK (day >= 0 AND day <= 6),
  slot_no INT NOT NULL CHECK (slot_no >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, id),
  UNIQUE (id),
  UNIQUE (school_id, teacher_id, day, slot_no),
  UNIQUE (school_id, class_id, day, slot_no),
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, assignment_id) REFERENCES assignments(school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, class_id) REFERENCES classes(school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, teacher_id) REFERENCES teachers(school_id, id) ON DELETE CASCADE
);

-- 10. Attendance Sessions
CREATE TABLE IF NOT EXISTS attendance_sessions (
  school_id INT NOT NULL,
  id SERIAL,
  date DATE NOT NULL,
  schedule_slot_id INT,
  class_id INT NOT NULL,
  subject_id INT NOT NULL,
  teacher_id INT NOT NULL,
  slot_no INT NOT NULL,
  year_id INT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, id),
  UNIQUE (id),
  UNIQUE (school_id, date, schedule_slot_id),
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, schedule_slot_id) REFERENCES schedule_slots(school_id, id) ON DELETE SET NULL
);

-- 11. Attendance Records
CREATE TABLE IF NOT EXISTS attendance_records (
  school_id INT NOT NULL,
  session_id INT NOT NULL,
  student_id INT NOT NULL,
  status VARCHAR(2) NOT NULL CHECK (status IN ('p', 'a', 'l', 'e')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, session_id, student_id),
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, session_id) REFERENCES attendance_sessions(school_id, id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT
);

-- 12. Attendance Excuses
CREATE TABLE IF NOT EXISTS attendance_excuses (
  school_id INT NOT NULL,
  id SERIAL,
  student_id INT NOT NULL,
  date DATE NOT NULL,
  reason VARCHAR(100) NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by INT NOT NULL,
  session_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, id),
  UNIQUE (id),
  UNIQUE (school_id, student_id, date),
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT
);

-- 13. Users
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  school_id INT REFERENCES schools(id) ON DELETE CASCADE,
  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'director', 'admin', 'teacher', 'student')),
  teacher_id INT,
  student_id INT,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  failed_logins INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 14. Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(128) PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school_id INT REFERENCES schools(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 15. Role Permissions
CREATE TABLE IF NOT EXISTS role_permissions (
  school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL,
  permission VARCHAR(50) NOT NULL,
  PRIMARY KEY (school_id, role, permission)
);

-- 16. Telegram Invites
CREATE TABLE IF NOT EXISTS telegram_invites (
  code VARCHAR(64) PRIMARY KEY,
  school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id INT NOT NULL,
  phone VARCHAR(50) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE CASCADE
);

-- 17. Parent Contacts
CREATE TABLE IF NOT EXISTS parent_contacts (
  school_id INT NOT NULL,
  id SERIAL,
  student_id INT NOT NULL,
  phone VARCHAR(50) NOT NULL,
  telegram_chat_id BIGINT,
  status VARCHAR(30) NOT NULL DEFAULT 'disconnected',
  consent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, id),
  UNIQUE (id),
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE CASCADE
);

-- 18. Outbox Messages
CREATE TABLE IF NOT EXISTS outbox_messages (
  id SERIAL PRIMARY KEY,
  school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id INT NOT NULL,
  date DATE NOT NULL,
  phone VARCHAR(50) NOT NULL DEFAULT '',
  telegram_chat_id BIGINT,
  text TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  error_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  UNIQUE (school_id, student_id, date)
);

-- 19. Audit Log
CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  school_id INT REFERENCES schools(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  entity VARCHAR(100) NOT NULL,
  entity_id VARCHAR(100),
  details JSONB,
  ip_address VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 20. Idempotency Keys
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key VARCHAR(255) PRIMARY KEY,
  school_id INT REFERENCES schools(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  path VARCHAR(255) NOT NULL,
  response_code INT NOT NULL,
  response_body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_students_class ON students(school_id, class_id);
CREATE INDEX IF NOT EXISTS idx_assignments_teacher ON assignments(school_id, teacher_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_student ON attendance_records(school_id, student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_date ON attendance_sessions(school_id, date);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Row Level Security (RLS) Setup
-- Enable RLS on all tenant-isolated tables
DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'years', 'subjects', 'teachers', 'classes', 'students',
    'assignments', 'schedule_slots', 'attendance_sessions',
    'attendance_records', 'attendance_excuses', 'role_permissions',
    'parent_contacts', 'outbox_messages'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %I;', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_policy ON %I ' ||
      'USING (school_id = NULLIF(current_setting(''app.school_id'', true), '''')::integer) ' ||
      'WITH CHECK (school_id = NULLIF(current_setting(''app.school_id'', true), '''')::integer);',
      tbl
    );
  END LOOP;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'edumemory_app') THEN
    CREATE ROLE edumemory_app;
  END IF;
  GRANT USAGE ON SCHEMA public TO edumemory_app;
  GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO edumemory_app;
  GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO edumemory_app;
END $$;
`;
