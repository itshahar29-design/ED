export const ALL_PERMISSIONS = [
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
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

export type UserRole = 'owner' | 'director' | 'admin' | 'teacher' | 'student';

export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  owner: [...ALL_PERMISSIONS],
  director: [...ALL_PERMISSIONS],
  admin: ALL_PERMISSIONS.filter((p) => p !== 'MANAGE_SETTINGS'),
  teacher: ['VIEW_STUDENTS', 'MARK_ATTENDANCE', 'VIEW_REPORTS', 'EXPORT_DATA'],
  student: ['VIEW_REPORTS'],
};

export interface AuthUser {
  id: number;
  school_id: number | null;
  username: string;
  role: UserRole;
  teacher_id?: number | null;
  student_id?: number | null;
  must_change_password?: boolean;
  support_school_id?: number | null;
}

export interface ResourceContext {
  permissions?: Permission[];
  teacherAssignments?: Array<{ class_id: number; subject_id: number; teacher_id: number }>;
  teacherLeadClassIds?: number[];
}

export interface ResourceDescriptor {
  type: 'school' | 'user' | 'student' | 'teacher' | 'class' | 'subject' | 'schedule' | 'attendance' | 'report' | 'settings' | 'general';
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
  action: Permission | 'SUPPORT_MODE' | 'MANAGE_USERS' | 'VIEW_SELF',
  resource?: ResourceDescriptor,
  context?: ResourceContext
): boolean {
  if (!user) return false;

  // 1. Owner platforma boshqaruvchisi
  if (user.role === 'owner') {
    // Owner har qanday platforma amaliga ega.
    // Agar muayyan maktab resursiga murojaat qilayotgan bo'lsa, yordam rejimida (support mode) bo'lishi kerak yoki global ko'rish
    if (resource?.school_id && user.support_school_id && user.support_school_id !== resource.school_id) {
      return false;
    }
    return true;
  }

  // 2. Maktab izolyatsiyasi tekshiruvi (Begona maktabga kirish qat'iy taqiqlanadi)
  const effectiveSchoolId = user.school_id;
  if (resource?.school_id !== undefined && resource.school_id !== null) {
    if (effectiveSchoolId !== resource.school_id) {
      return false; // Cross-tenant access strictly denied
    }
  }

  // 3. Ruxsatlar ro'yxatini aniqlash
  const grantedPermissions = context?.permissions || DEFAULT_ROLE_PERMISSIONS[user.role] || [];

  // Ruxsat tekshirish (agar action Permission ro'yxatida bo'lsa)
  if (ALL_PERMISSIONS.includes(action as Permission)) {
    if (!grantedPermissions.includes(action as Permission)) {
      return false;
    }
  }

  // 4. Qamrov (scope) bo'yicha tekshiruvlar:
  // Director va Admin o'z maktabidagi barcha tegishli resurslarga ruxsatga ega
  if (user.role === 'director' || user.role === 'admin') {
    // Admin MANAGE_SETTINGS qila olmaydi (agar alohida ruxsat berilmagan bo'lsa)
    if (action === 'MANAGE_SETTINGS' && !grantedPermissions.includes('MANAGE_SETTINGS')) {
      return false;
    }
    return true;
  }

  // Teacher qamrovi:
  // - Faqat o'ziga biriktirilgan (assignments) sinf/fanlar va o'zi rahbar bo'lgan sinflar
  if (user.role === 'teacher') {
    if (action === 'MANAGE_SETTINGS' || action === 'MANAGE_TEACHERS' || action === 'MANAGE_CLASSES' || action === 'DELETE_STUDENTS') {
      return false;
    }

    if (resource) {
      // Dars davomatini belgilash: faqat dars o'qituvchisi (assignments.teacher_id == user.teacher_id)
      if (action === 'MARK_ATTENDANCE') {
        if (resource.teacher_id && user.teacher_id && resource.teacher_id !== user.teacher_id) {
          // Sinf rahbari ham to'g'ridan-to'g'ri dars davomatini qo'ya olmaydi (faqat sababli qila oladi)
          return false;
        }
      }

      // O'quvchi ma'lumotlarini ko'rish yoki tahrirlash:
      // Faqat o'qituvchiga biriktirilgan sinflardagi o'quvchilar yoki o'zi rahbar bo'lgan sinflar
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

  // Student qamrovi:
  // - Faqat o'zi (student_id == user.student_id)
  if (user.role === 'student') {
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

  return false;
}
