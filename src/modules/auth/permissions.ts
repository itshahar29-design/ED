export const ALL_PERMISSIONS = [
  // 13 from v2
  'VIEW_STUDENTS',
  'CREATE_STUDENTS',
  'EDIT_STUDENTS',
  'DELETE_STUDENTS',
  'VIEW_TEACHERS',
  'MANAGE_TEACHERS',
  'MANAGE_SUBJECTS',
  'MANAGE_CLASSES',
  'MANAGE_SCHEDULE',
  'MARK_ATTENDANCE',
  'VIEW_REPORTS',
  'EXPORT_DATA',
  'MANAGE_SETTINGS',
  // 12 new from v3
  'MANAGE_USERS',
  'APPROVE_ACCESS',
  'VIEW_AUDIT',
  'VIEW_CONTACTS',
  'SEND_MESSAGES',
  'EXCUSE_ANY',
  'EXCUSE_OWN_CLASS',
  'EXCUSE_ILLNESS',
  'REVIEW_EXCUSE_REQUESTS',
  'SUBMIT_EXCUSE_REQUEST',
  'VIEW_RISK',
  'MANAGE_CALENDAR',
  // Platform management
  'MANAGE_PLATFORM',
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

export type UserRole =
  | 'owner'
  | 'director'
  | 'deputy_academic'
  | 'deputy_edu'
  | 'admin'
  | 'teacher'
  | 'class_leader'
  | 'dept_head'
  | 'psychologist'
  | 'nurse'
  | 'observer'
  | 'student'
  | 'parent';

export interface PositionPreset {
  key: string;
  name_uz: string;
  rank: number;
  scope: 'school' | 'own_classes' | 'own_subjects' | 'own_children' | 'self';
  permissions: Permission[];
}

export const PRESET_POSITIONS: Record<string, PositionPreset> = {
  owner: {
    key: 'owner',
    name_uz: 'Platforma egasi',
    rank: 1,
    scope: 'school',
    permissions: [...ALL_PERMISSIONS],
  },
  director: {
    key: 'director',
    name_uz: 'Maktab direktori',
    rank: 10,
    scope: 'school',
    permissions: ALL_PERMISSIONS.filter((p) => p !== 'MANAGE_PLATFORM'),
  },
  deputy_academic: {
    key: 'deputy_academic',
    name_uz: "O'quv ishlari bo'yicha direktor o'rinbosari",
    rank: 20,
    scope: 'school',
    permissions: [
      'VIEW_STUDENTS',
      'CREATE_STUDENTS',
      'EDIT_STUDENTS',
      'DELETE_STUDENTS',
      'VIEW_TEACHERS',
      'MANAGE_TEACHERS',
      'MANAGE_SUBJECTS',
      'MANAGE_CLASSES',
      'MANAGE_SCHEDULE',
      'MARK_ATTENDANCE',
      'VIEW_REPORTS',
      'EXPORT_DATA',
      'EXCUSE_ANY',
      'REVIEW_EXCUSE_REQUESTS',
      'VIEW_RISK',
      'SEND_MESSAGES',
      'MANAGE_CALENDAR',
      'VIEW_CONTACTS',
      'APPROVE_ACCESS',
    ],
  },
  deputy_edu: {
    key: 'deputy_edu',
    name_uz: "Ma'naviy-ma'rifiy ishlar bo'yicha direktor o'rinbosari",
    rank: 25,
    scope: 'school',
    permissions: [
      'VIEW_STUDENTS',
      'VIEW_TEACHERS',
      'VIEW_REPORTS',
      'EXPORT_DATA',
      'EXCUSE_ANY',
      'REVIEW_EXCUSE_REQUESTS',
      'VIEW_RISK',
      'SEND_MESSAGES',
      'VIEW_CONTACTS',
    ],
  },
  admin: {
    key: 'admin',
    name_uz: "Administrator (ma'mur)",
    rank: 30,
    scope: 'school',
    permissions: ALL_PERMISSIONS.filter(
      (p) => p !== 'MANAGE_PLATFORM' && p !== 'MANAGE_SETTINGS' && p !== 'VIEW_AUDIT'
    ),
  },
  teacher: {
    key: 'teacher',
    name_uz: "Fan o'qituvchisi",
    rank: 50,
    scope: 'own_classes',
    permissions: ['VIEW_STUDENTS', 'MARK_ATTENDANCE', 'VIEW_REPORTS', 'EXPORT_DATA'],
  },
  class_leader: {
    key: 'class_leader',
    name_uz: 'Sinf rahbari',
    rank: 45,
    scope: 'own_classes',
    permissions: [
      'VIEW_STUDENTS',
      'MARK_ATTENDANCE',
      'VIEW_REPORTS',
      'EXPORT_DATA',
      'EXCUSE_OWN_CLASS',
      'REVIEW_EXCUSE_REQUESTS',
      'VIEW_RISK',
      'SEND_MESSAGES',
      'VIEW_CONTACTS',
    ],
  },
  dept_head: {
    key: 'dept_head',
    name_uz: 'Metodbirlashma rahbari',
    rank: 48,
    scope: 'own_subjects',
    permissions: ['VIEW_STUDENTS', 'MARK_ATTENDANCE', 'VIEW_REPORTS', 'EXPORT_DATA'],
  },
  psychologist: {
    key: 'psychologist',
    name_uz: 'Maktab psixologi',
    rank: 60,
    scope: 'school',
    permissions: ['VIEW_STUDENTS', 'VIEW_RISK', 'VIEW_REPORTS'],
  },
  nurse: {
    key: 'nurse',
    name_uz: 'Tibbiyot hamshirasi',
    rank: 70,
    scope: 'school',
    permissions: ['VIEW_STUDENTS', 'EXCUSE_ILLNESS'],
  },
  observer: {
    key: 'observer',
    name_uz: 'Kuzatuvchi / inspektor',
    rank: 80,
    scope: 'school',
    permissions: ['VIEW_REPORTS'],
  },
  student: {
    key: 'student',
    name_uz: "O'quvchi",
    rank: 90,
    scope: 'self',
    permissions: ['VIEW_REPORTS'],
  },
  parent: {
    key: 'parent',
    name_uz: 'Ota-ona',
    rank: 95,
    scope: 'own_children',
    permissions: ['VIEW_REPORTS', 'SUBMIT_EXCUSE_REQUEST'],
  },
};

// Legacy fallback map for v2 tests
export const DEFAULT_ROLE_PERMISSIONS: Record<string, Permission[]> = {
  owner: PRESET_POSITIONS.owner.permissions,
  director: PRESET_POSITIONS.director.permissions,
  admin: PRESET_POSITIONS.admin.permissions,
  teacher: PRESET_POSITIONS.teacher.permissions,
  student: PRESET_POSITIONS.student.permissions,
};

export interface AuthUser {
  id: number;
  school_id: number | null;
  username?: string;
  role: string;
  phone_e164?: string;
  full_name?: string;
  membership_id?: number | null;
  position_id?: number | null;
  position_key?: string;
  scope?: string;
  rank?: number;
  teacher_id?: number | null;
  student_id?: number | null;
  must_change_password?: boolean;
  support_school_id?: number | null;
}

export interface ResourceContext {
  permissions?: Permission[];
  teacherAssignments?: Array<{ class_id: number; subject_id: number; teacher_id: number }>;
  teacherLeadClassIds?: number[];
  parentStudentIds?: number[];
  excuseReason?: string;
}

export interface ResourceDescriptor {
  type:
    | 'school'
    | 'user'
    | 'student'
    | 'teacher'
    | 'class'
    | 'subject'
    | 'schedule'
    | 'attendance'
    | 'report'
    | 'settings'
    | 'general';
  school_id?: number | null;
  student_id?: number | null;
  teacher_id?: number | null;
  class_id?: number | null;
  subject_id?: number | null;
}

/**
 * Markaziy avtorizatsiya funksiyasi: can(user, action, resource, context)
 * Standart holatda (default): taqiqlash (false).
 */
export function can(
  user: AuthUser,
  action: Permission | 'SUPPORT_MODE' | 'VIEW_SELF',
  resource?: ResourceDescriptor,
  context?: ResourceContext
): boolean {
  if (!user) return false;

  const roleOrPos = user.position_key || user.role;

  // 1. Owner platforma boshqaruvchisi
  if (roleOrPos === 'owner') {
    if (resource?.school_id && user.support_school_id && user.support_school_id !== resource.school_id) {
      return false;
    }
    return true;
  }

  // 2. Maktab izolyatsiyasi tekshiruvi (Begona maktabga kirish qat'iy taqiqlanadi)
  const effectiveSchoolId = user.school_id;
  if (resource?.school_id !== undefined && resource.school_id !== null) {
    if (effectiveSchoolId !== resource.school_id) {
      return false;
    }
  }

  // 3. Ruxsatlar ro'yxatini aniqlash
  const grantedPermissions =
    context?.permissions ||
    PRESET_POSITIONS[roleOrPos]?.permissions ||
    DEFAULT_ROLE_PERMISSIONS[roleOrPos] ||
    [];

  // Ruxsat tekshirish (agar action Permission ro'yxatida bo'lsa)
  if (ALL_PERMISSIONS.includes(action as Permission)) {
    if (!grantedPermissions.includes(action as Permission)) {
      return false;
    }
  }

  // 4. Maxsus holatlar va qamrovlar:
  if (roleOrPos === 'director') {
    return true;
  }

  if (roleOrPos === 'admin') {
    if (action === 'MANAGE_SETTINGS' && !grantedPermissions.includes('MANAGE_SETTINGS')) {
      return false;
    }
    if (action === 'VIEW_AUDIT' && !grantedPermissions.includes('VIEW_AUDIT')) {
      return false;
    }
    return true;
  }

  // Hamshira: faqat "Kasallik" sababi bilan
  if (roleOrPos === 'nurse') {
    if (action === 'EXCUSE_ILLNESS') {
      if (context?.excuseReason && context.excuseReason !== 'Kasallik') {
        return false;
      }
      return true;
    }
  }

  // Sinf rahbari: faqat o'z sinfi uchun
  if (action === 'EXCUSE_OWN_CLASS') {
    if (resource?.class_id && context?.teacherLeadClassIds) {
      if (!context.teacherLeadClassIds.includes(resource.class_id)) {
        return false;
      }
    }
  }

  // O'qituvchi / Sinf rahbari / Metodbirlashma
  if (roleOrPos === 'teacher' || roleOrPos === 'class_leader' || roleOrPos === 'dept_head') {
    if (
      action === 'MANAGE_SETTINGS' ||
      action === 'MANAGE_TEACHERS' ||
      action === 'MANAGE_CLASSES' ||
      action === 'DELETE_STUDENTS'
    ) {
      return false;
    }

    if (resource) {
      // Dars davomatini belgilash: faqat dars o'qituvchisi
      if (action === 'MARK_ATTENDANCE') {
        if (resource.teacher_id && user.teacher_id && resource.teacher_id !== user.teacher_id) {
          return false;
        }
      }

      // O'quvchi ma'lumotlarini ko'rish:
      if (resource.class_id && user.teacher_id) {
        const isLead = context?.teacherLeadClassIds?.includes(resource.class_id);
        const isAssigned = context?.teacherAssignments?.some((a) => a.class_id === resource.class_id);
        if (!isLead && !isAssigned) {
          return false;
        }
      }
    }

    return true;
  }

  // Student qamrovi: faqat o'zi
  if (roleOrPos === 'student') {
    if (action === 'VIEW_REPORTS') {
      if (resource?.student_id && user.student_id && resource.student_id !== user.student_id) {
        return false;
      }
      return true;
    }
    if (action === 'VIEW_STUDENTS') {
      if (resource?.student_id && user.student_id && resource.student_id === user.student_id) {
        return true;
      }
      return false;
    }
    return false;
  }

  // Parent qamrovi: faqat o'z farzandlari
  if (roleOrPos === 'parent') {
    if (action === 'VIEW_REPORTS' || action === 'SUBMIT_EXCUSE_REQUEST') {
      if (resource?.student_id && context?.parentStudentIds) {
        if (!context.parentStudentIds.includes(resource.student_id)) {
          return false;
        }
      }
      return true;
    }
    return false;
  }

  return true;
}
