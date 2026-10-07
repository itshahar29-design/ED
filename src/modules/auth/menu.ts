export interface MenuItem {
  id: string;
  title: string;
  icon: string;
  path: string;
}

export function computeMenu(permissions: string[], positionKey: string): MenuItem[] {
  const permSet = new Set(permissions);
  const items: MenuItem[] = [];

  // Boshqaruv (dash) - hamma uchun
  items.push({ id: 'dash', title: 'Boshqaruv', icon: '📊', path: '#dash' });

  // Maktablar - faqat MANAGE_PLATFORM
  if (permSet.has('MANAGE_PLATFORM')) {
    items.push({ id: 'schools', title: 'Maktablar', icon: '🏛️', path: '#schools' });
  }

  // Foydalanuvchilar - MANAGE_USERS
  if (permSet.has('MANAGE_USERS')) {
    items.push({ id: 'users', title: 'Foydalanuvchilar', icon: '👥', path: '#users' });
  }

  // Kirish so'rovlari - APPROVE_ACCESS
  if (permSet.has('APPROVE_ACCESS')) {
    items.push({ id: 'access_requests', title: "Kirish so'rovlari", icon: '📥', path: '#access_requests' });
  }

  // Farzandlarim - faqat parent
  if (positionKey === 'parent') {
    items.push({ id: 'children', title: 'Farzandlarim', icon: '👶', path: '#children' });
  }

  // Sinflar - MANAGE_CLASSES yoki sinf qamrovida VIEW_STUDENTS
  if (permSet.has('MANAGE_CLASSES') || permSet.has('VIEW_STUDENTS')) {
    items.push({ id: 'classes', title: 'Sinflar', icon: '🏫', path: '#classes' });
  }

  // O'quvchilar - VIEW_STUDENTS
  if (permSet.has('VIEW_STUDENTS')) {
    items.push({ id: 'students', title: "O'quvchilar", icon: '🎓', path: '#students' });
  }

  // O'qituvchilar - VIEW_TEACHERS
  if (permSet.has('VIEW_TEACHERS')) {
    items.push({ id: 'teachers', title: "O'qituvchilar", icon: '👨‍🏫', path: '#teachers' });
  }

  // Fanlar - MANAGE_SUBJECTS
  if (permSet.has('MANAGE_SUBJECTS')) {
    items.push({ id: 'subjects', title: 'Fanlar', icon: '📚', path: '#subjects' });
  }

  // Jadval - MANAGE_SCHEDULE yoki o'z jadvali (teacher/student/parent)
  if (
    permSet.has('MANAGE_SCHEDULE') ||
    ['teacher', 'class_leader', 'dept_head', 'student', 'parent'].includes(positionKey)
  ) {
    items.push({ id: 'schedule', title: 'Jadval', icon: '📅', path: '#schedule' });
  }

  // Kalendar - MANAGE_CALENDAR
  if (permSet.has('MANAGE_CALENDAR')) {
    items.push({ id: 'calendar', title: 'Kalendar', icon: '🗓️', path: '#calendar' });
  }

  // Davomat - MARK_ATTENDANCE
  if (permSet.has('MARK_ATTENDANCE')) {
    items.push({ id: 'attendance', title: 'Davomat', icon: '✅', path: '#attendance' });
  }

  // Sababli - EXCUSE_ANY / EXCUSE_OWN_CLASS / EXCUSE_ILLNESS
  if (permSet.has('EXCUSE_ANY') || permSet.has('EXCUSE_OWN_CLASS') || permSet.has('EXCUSE_ILLNESS')) {
    items.push({ id: 'excuses', title: 'Sababli', icon: '📝', path: '#excuses' });
  }

  // Arizalar - REVIEW_EXCUSE_REQUESTS yoki SUBMIT_EXCUSE_REQUEST
  if (permSet.has('REVIEW_EXCUSE_REQUESTS') || permSet.has('SUBMIT_EXCUSE_REQUEST')) {
    items.push({ id: 'requests', title: 'Arizalar', icon: '📩', path: '#requests' });
  }

  // Xabar - SEND_MESSAGES
  if (permSet.has('SEND_MESSAGES')) {
    items.push({ id: 'messages', title: 'Xabar', icon: '✉️', path: '#messages' });
  }

  // Xavf ro'yxati - VIEW_RISK
  if (permSet.has('VIEW_RISK')) {
    items.push({ id: 'risk', title: "Xavf ro'yxati", icon: '⚠️', path: '#risk' });
  }

  // Hisobot - VIEW_REPORTS
  if (permSet.has('VIEW_REPORTS')) {
    items.push({ id: 'reports', title: 'Hisobot', icon: '📈', path: '#reports' });
  }

  // Audit - VIEW_AUDIT
  if (permSet.has('VIEW_AUDIT')) {
    items.push({ id: 'audit', title: 'Audit', icon: '📋', path: '#audit' });
  }

  // Maktab sozlamalari - MANAGE_SETTINGS
  if (permSet.has('MANAGE_SETTINGS')) {
    items.push({ id: 'settings', title: 'Maktab sozlamalari', icon: '⚙️', path: '#settings' });
  }

  // Telegram holati - MANAGE_USERS yoki MANAGE_PLATFORM
  if (permSet.has('MANAGE_USERS') || permSet.has('MANAGE_PLATFORM')) {
    items.push({ id: 'telegram_status', title: 'Telegram holati', icon: '✈️', path: '#telegram_status' });
  }

  // Profil - hamma uchun
  items.push({ id: 'profile', title: 'Profil', icon: '👤', path: '#profile' });

  return items;
}
