# EduMemory 3.0 MAX — Loyiha Holati (STATUS.md)

> Oxirgi yangilanish: 2026-10-07
> Maqsad: EduMemory 3.0 MAX «Dahshat+» mezonlari bo'yicha I qism (M0–M6) to'liq yakunlandi va Renderga joylandi.

---

## 1. Hozirgi bosqich: **M0–M6 YAKUNLANDI (75/75 TEST YASHIL, BUILD 0 XATO)**

### Bajarilgan ishlar:
1. **[M0] DB Sxemasi (PostgreSQL 16 + RLS):**
   - Barcha v3 jadvallari: `telegram_identities`, `positions`, `position_permissions`, `memberships`, `parent_students`, `access_requests`, `excuse_requests`, `school_calendar`, `notification_settings`.
   - `attendance_sessions.status` ('draft' | 'submitted') qo'shildi.
   - `outbox_messages` jadvali Telegram xabarlar navbati uchun sozlandi.

2. **[M1] Telegram Auth & Parolsiz Kirish:**
   - Telegram WebApp `initData` HMAC-SHA256 tekshiruvi.
   - Kontakt ulashish orqali 1-soniyalik **Avto-kirish** (Direct-login session token + Telegram Mini App avtomatik sinxronizatsiyasi).
   - `npm run owner:link` break-glass CLI buyrug'i.
   - 18 ta test to'liq o'tgan.

3. **[M2] 13 ta Preset Lavozim va Ruxsatlar Matritsasi:**
   - `owner`, `director`, `deputy_academic`, `deputy_edu`, `admin`, `teacher`, `class_leader`, `dept_head`, `psychologist`, `nurse`, `observer`, `student`, `parent`.
   - 25 ta nozik ruxsatlar (`can()` funksiyasi) va dinamik `menu.ts`.
   - Foydalanuvchilar va Kirish so'rovlari (`access_requests`) to'liq CRUD.
   - 14 ta test to'liq o'tgan.

4. **[M3] Davomat (K5 mezonlari):**
   - `draft` vs `submitted` statuslari.
   - Dars tugashidan oldin yoki dars kuni bo'lmaganda submission cheklovlari.
   - O'quvchini sababli (`e`) qilish va bekor qilish.
   - Excel/CSV eksportda formula injection (`=`, `+`, `-`, `@`) himoyasi.
   - 11 ta test to'liq o'tgan.

5. **[M4] Frontend (Mini App & Vanilla JS):**
   - `index.html` K1–K16 mezonlari to'liq qamrab olindi.
   - Telegram WebApp SDK: MainButton, BackButton, HapticFeedback, safe-area.
   - Avtomatik login tekshiruvi va polling (kontakt ulashilganda 2 soniyada kirish).
   - 8 ta test to'liq o'tgan.

6. **[M5] Telegram Bot & Ota-ona Arizalari (Feature 6-A):**
   - Ota-onalar arizasi (`POST /excuse-requests`, `POST /excuse-requests/:id/decide`).
   - Tasdiqlanganda o'tmishdagi `a` davomat avtomatik `e` ga aylanadi (`source='ariza#<id>'`).
   - Kelgusi sanalarga o'qituvchi davomat olganda avtomatik `e` qo'yiladi.
   - 13 ta test to'liq o'tgan.

7. **[M6] Nazorat Markazi (Feature 6-B Control Center):**
   - 15 daqiqalik o'qituvchiga dars topshirish eslatmasi.
   - 2 soatlik o'quv ishlari bo'yicha o'rinbosarga (zavuch) eskalatsiya xabarnomasi.
   - Xavf signali (ketma-ket 3 kun kelmagan yoki davomati <75% bo'lgan o'quvchilar).
   - Har kuni soat 09:30 da direktor va o'rinbosarga avtomatik xulosa.
   - Maktab kalendari (`isSchoolDay`) integratsiyasi.
   - 7 ta test to'liq o'tgan.

---

## 2. Test va Kompilyatsiya Natijalari:
- **Testlar:** 75/75 o'tgan (100% yashil).
- **TypeScript:** `npm run build` 0 ta xato bilan kompilyatsiya bo'ladi.
