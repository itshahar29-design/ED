export const DDL_SCHEMA = `
-- EduMemory PostgreSQL 16 Database Schema
-- Multi-tenant isolation with composite foreign keys and Row Level Security (RLS)

-- 1. Schools
CREATE TABLE IF NOT EXISTS schools (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) UNIQUE,
  join_code VARCHAR(32) UNIQUE,
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
  status VARCHAR(10) NOT NULL DEFAULT 'draft',
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
  source VARCHAR(50) NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, id),
  UNIQUE (id),
  UNIQUE (school_id, student_id, date),
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT
);

-- 13. Users (Global identity & v2 fallback)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  school_id INT REFERENCES schools(id) ON DELETE CASCADE,
  username VARCHAR(100) UNIQUE,
  password_hash TEXT,
  role VARCHAR(20),
  teacher_id INT,
  student_id INT,
  phone_e164 VARCHAR(30) UNIQUE,
  full_name VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
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
  membership_id INT,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 15. Role Permissions (v2 legacy)
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

-- 17. Parent Contacts (v2 legacy and direct link)
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
  student_id INT,
  user_id INT,
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

-- 21. Telegram Identities (v3)
CREATE TABLE IF NOT EXISTS telegram_identities (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  phone_verified_at TIMESTAMPTZ,
  bound_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unbound_at TIMESTAMPTZ
);

-- 22. Positions (v3)
CREATE TABLE IF NOT EXISTS positions (
  id SERIAL PRIMARY KEY,
  school_id INT REFERENCES schools(id) ON DELETE CASCADE,
  key VARCHAR(50) NOT NULL,
  name_uz VARCHAR(100) NOT NULL,
  base_key VARCHAR(50),
  scope VARCHAR(50) NOT NULL DEFAULT 'school',
  rank INT NOT NULL DEFAULT 100,
  is_preset BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 23. Position Permissions (v3)
CREATE TABLE IF NOT EXISTS position_permissions (
  position_id INT NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  permission VARCHAR(50) NOT NULL,
  PRIMARY KEY (position_id, permission)
);

-- 24. Memberships (v3)
CREATE TABLE IF NOT EXISTS memberships (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  school_id INT REFERENCES schools(id) ON DELETE CASCADE,
  position_id INT NOT NULL REFERENCES positions(id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  invited_phone VARCHAR(30),
  invited_by INT REFERENCES users(id) ON DELETE SET NULL,
  invite_code_hash TEXT,
  invite_expires_at TIMESTAMPTZ,
  teacher_id INT,
  student_id INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 25. Parent Students (v3)
CREATE TABLE IF NOT EXISTS parent_students (
  id SERIAL PRIMARY KEY,
  school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  parent_user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id INT NOT NULL,
  consent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, parent_user_id, student_id),
  FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE CASCADE
);

-- 26. Access Requests (v3)
CREATE TABLE IF NOT EXISTS access_requests (
  id SERIAL PRIMARY KEY,
  school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note TEXT NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  decided_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ
);

-- 27. Excuse Requests (v3 - Feature 6-A)
CREATE TABLE IF NOT EXISTS excuse_requests (
  id SERIAL PRIMARY KEY,
  school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id INT NOT NULL,
  parent_user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  reason VARCHAR(100) NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  reviewed_by INT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE CASCADE
);

-- 28. School Calendar (v3 - Feature 6-B)
CREATE TABLE IF NOT EXISTS school_calendar (
  id SERIAL PRIMARY KEY,
  school_id INT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  kind VARCHAR(30) NOT NULL DEFAULT 'holiday',
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 29. Notification Settings (v3 - Feature 6-B)
CREATE TABLE IF NOT EXISTS notification_settings (
  school_id INT PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  daily_summary_time VARCHAR(10) NOT NULL DEFAULT '09:30',
  teacher_reminder_minutes INT NOT NULL DEFAULT 15,
  deputy_escalation_hours INT NOT NULL DEFAULT 2,
  risk_alert_threshold INT NOT NULL DEFAULT 75,
  enabled JSONB NOT NULL DEFAULT '{"teacher_reminder": true, "deputy_escalation": true, "risk_alert": true, "daily_summary": true}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migration helpers for existing databases
DO $$
BEGIN
  ALTER TABLE schools ADD COLUMN IF NOT EXISTS join_code VARCHAR(32) UNIQUE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_e164 VARCHAR(30) UNIQUE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(255);
  ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
  ALTER TABLE users ALTER COLUMN username DROP NOT NULL;
  ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
  ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS status VARCHAR(10) NOT NULL DEFAULT 'draft';
  ALTER TABLE sessions ADD COLUMN IF NOT EXISTS membership_id INT;
  ALTER TABLE attendance_excuses ADD COLUMN IF NOT EXISTS source VARCHAR(50) NOT NULL DEFAULT 'manual';
  ALTER TABLE outbox_messages ALTER COLUMN student_id DROP NOT NULL;
  ALTER TABLE outbox_messages ADD COLUMN IF NOT EXISTS user_id INT;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_students_class ON students(school_id, class_id);
CREATE INDEX IF NOT EXISTS idx_assignments_teacher ON assignments(school_id, teacher_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_student ON attendance_records(school_id, student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_date ON attendance_sessions(school_id, date);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_tg_identities_tg_id ON telegram_identities(telegram_id);
CREATE INDEX IF NOT EXISTS idx_tg_identities_user_id ON telegram_identities(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_global_key ON positions(key) WHERE school_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_school_key ON positions(school_id, key) WHERE school_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_school ON memberships(school_id);
CREATE INDEX IF NOT EXISTS idx_memberships_phone ON memberships(invited_phone);
CREATE INDEX IF NOT EXISTS idx_parent_students_parent ON parent_students(parent_user_id);
CREATE INDEX IF NOT EXISTS idx_parent_students_student ON parent_students(school_id, student_id);
CREATE INDEX IF NOT EXISTS idx_access_requests_school ON access_requests(school_id);
CREATE INDEX IF NOT EXISTS idx_access_requests_user ON access_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_excuse_requests_school ON excuse_requests(school_id);
CREATE INDEX IF NOT EXISTS idx_excuse_requests_student ON excuse_requests(school_id, student_id);
CREATE INDEX IF NOT EXISTS idx_excuse_requests_parent ON excuse_requests(parent_user_id);
CREATE INDEX IF NOT EXISTS idx_school_calendar_school_dates ON school_calendar(school_id, date_from, date_to);

-- Row Level Security (RLS) Setup
DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'years', 'subjects', 'teachers', 'classes', 'students',
    'assignments', 'schedule_slots', 'attendance_sessions',
    'attendance_records', 'attendance_excuses', 'role_permissions',
    'parent_contacts', 'outbox_messages',
    'positions', 'parent_students', 'access_requests',
    'excuse_requests', 'school_calendar', 'notification_settings'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %I;', tbl);
      IF tbl = 'positions' THEN
        EXECUTE format(
          'CREATE POLICY tenant_isolation_policy ON %I ' ||
          'USING (school_id = NULLIF(current_setting(''app.school_id'', true), '''')::integer OR school_id IS NULL) ' ||
          'WITH CHECK (school_id = NULLIF(current_setting(''app.school_id'', true), '''')::integer);',
          tbl
        );
      ELSE
        EXECUTE format(
          'CREATE POLICY tenant_isolation_policy ON %I ' ||
          'USING (school_id = NULLIF(current_setting(''app.school_id'', true), '''')::integer) ' ||
          'WITH CHECK (school_id = NULLIF(current_setting(''app.school_id'', true), '''')::integer);',
          tbl
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;

  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'edumemory_app') THEN
      CREATE ROLE edumemory_app;
    END IF;
    GRANT USAGE ON SCHEMA public TO edumemory_app;
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO edumemory_app;
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO edumemory_app;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;
`;
