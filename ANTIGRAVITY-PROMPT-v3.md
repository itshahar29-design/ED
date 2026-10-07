# EduMemory 3.0 — «Dahshat» topshiriq (Antigravity uchun)

> Bu fayl v2 ni **to'liq almashtiradi**. Faqat shu fayl amal qiladi. v2 dagi hamma muhim qoida bu yerga ko'chirilgan (3-bo'lim).
> Bot: **@EduMemoryBot** (`https://t.me/EduMemoryBot`). Til: butun UI va xatolar **o'zbekcha (lotin)**.

---

## 0. Ish tartibi — buyruq sifatida

1. **Avval ish papkasini tekshir.** `server/`, `package.json`, `docker-compose.yml` bor bo'lsa — bu v2 natijasi. U holda **noldan yozma**: audit qil, kamchiligini top, migratsiya bilan yangila. Yo'q bo'lsa — noldan qur.
2. `index.html` ni (vanilla JS, ~62 KB, build yo'q) **boshidan oxirigacha o'qi**. Bu ishlayotgan, tasdiqlangan frontend. Ko'rinishi va oqimi **o'zgarmasin**. Framework va build qo'shma. Faylni `app.css` / `app.js` / modullarga bo'lish mumkin.
3. Kod yozishdan oldin qisqa **reja + DB sxemasi** yoz. Tasdiq kutma, davom et. Noaniq joyda **eng sodda yechimni** tanla va `README.md` → «Qarorlar» bo'limiga **bir qator** yoz.
4. Bosqichma-bosqich ishla (14-bo'lim). Har bosqich oxirida testlarni ishga tushir va hisobot ber (15-bo'lim).
5. Foydalanuvchi **texnik emas**. README oddiy tilda, buyruqlar nusxalab ishlatiladigan bo'lsin.
6. **Yolg'on «ishladi» dema.** Sinamagan narsangni «SINALMADI» deb yoz. Halol hisobot — eng muhim talab.
7. Bot tokeni, domen, serverni **sen o'ylab topma**. Ularni foydalanuvchidan so'ra (15-bo'lim oxirida ro'yxat).

## 1. Maqsad

Maktab davomat tizimi — **Telegram Mini App**. Hozir hamma narsa brauzer xotirasida (`localStorage`, `edm_school_v1`), login yo'q, Telegram xabari qo'lda.

**3.0 da kerak:**

| # | Talab |
|---|---|
| 1 | **Telegramda telefon raqam ulashish orqali kirish** (parolsiz) |
| 2 | Har kimga **lavozimiga mos menyu** ochilishi |
| 3 | **Tayyor lavozimlar** (13 ta preset) + direktor o'zi yangisini yarata olishi |
| 4 | Ko'p maktab, umumiy baza, haqiqiy ruxsatlar |
| 5 | Bot ota-onaga va xodimlarga o'zi xabar yuborishi |
| 6 | **2 ta yangi imkoniyat** (6-bo'lim) |
| 7 | Eski frontend **kamchiliklarini tuzatish** (7-bo'lim) |

## 2. Texnologiya (qat'iy)

Node.js 20 + TypeScript + Fastify · PostgreSQL 16 · Drizzle ORM (yoki Prisma) · zod · grammY · Vitest + haqiqiy Postgres (testcontainers) · Playwright (E2E) · Docker Compose (`docker compose up` bilan hammasi ishga tushsin, frontend ham serverdan berilsin).

- **Redis yo'q.** Navbat = `outbox_messages` (`FOR UPDATE SKIP LOCKED`). Rejalashtirgich = `pg-boss` yoki `node-cron` (soddasini tanla).
- **Parol yo'q.** Argon2 kerak emas. Kirish = Telegram (4-bo'lim).
- Sessiya: serverda `sessions` jadvali + `httpOnly; Secure; SameSite=Lax` cookie. Telegram WebView cookie'ni saqlamasa — `Authorization: Bearer` (xuddi shu sessiya tokeni, 12 soat). Qaysini tanlaganingni testdan keyin «Qarorlar»ga yoz.
- Bot: production'da **webhook** (`secret_token` sarlavhasi tekshiriladi), dev'da long polling.

## 3. Temir qoidalar (v2 dan — o'zgarmaydi)

### 3.1 Ko'p maktab (tenant)
- Har ma'lumot jadvalida `school_id`. Barcha FK **kompozit** `(school_id, id)`.
- **PostgreSQL RLS**: har tranzaksiyada `SET LOCAL app.school_id`. Ilova xato qilsa ham baza begona maktabni bermasin.
- Global jadvallar (`users`, `telegram_identities`, `schools`, `memberships`) uchun alohida RLS siyosati.
- Owner maktabga faqat «yordam rejimi»da kiradi va bu **auditga** yoziladi.

### 3.2 Avtorizatsiya — bitta joyda
- Bitta `can(ctx, action, resource)`. **Default: taqiqlash.**
- Tekshiruv: lavozim ruxsatlari + qamrov (scope). Frontendni yashirish xavfsizlik **emas** — har endpointda server tekshiradi.

### 3.3 Davomat yaxlitligi
- `attendance_sessions` unikal: `(school_id, date, schedule_slot_id)`. Yozish = upsert.
- Sessiyada sinf/fan/o'qituvchi/dars raqami **nusxalanadi** (snapshot).
- **Optimistic locking**: `version`. Eskirgan versiya → `409` + yangi holat.
- **Kelajak sanaga yozish taqiqlanadi.** «Bugun»ni **server** hisoblaydi (Asia/Tashkent), sana `DATE` turida.
- POST'larda `Idempotency-Key`.
- Holatlar: `p` keldi, `a` yo'q, `l` kechikdi, `e` sababli. **Foiz = (jami − a) / jami.**

### 3.4 Sababli qilish
- `attendance_excuses(school_id, student_id, date, reason, note, created_by, session_ids[], source, created_at)`.
- Bitta tranzaksiya: `a` → `e`, o'zgargan sessiyalar `session_ids` ga yoziladi.
- Bekor qilish: faqat `session_ids` dagi `e` lar `a` bo'ladi (**qo'lda qo'yilgan `e` ga tegilmaydi**).
- Dars o'qituvchisi keyin qayta `a` qo'ysa, sessiya excuse'dan chiqariladi (audit bilan).
- Sabablar: Kasallik, Oilaviy sabab, Tadbir/musobaqa, Boshqa (+ izoh).

### 3.5 Jadval qoidalari bazada
- `schedule_slots`: unikal `(teacher_id, day, slot_no)` va `(class_id, day, slot_no)`. `(class_id, subject_id)` unikal.
- Darslar faqat mavjud `assignments` dan. Biriktirish olib tashlansa jadval ketadi, **davomat tarixi qoladi**.

### 3.6 Arxiv / o'chirish
- Soft-delete (`active/archived`). Haqiqiy o'chirish faqat tarixsiz yozuvga. FK `ON DELETE RESTRICT`.
- O'quvchisi bor sinf o'chirilmaydi. Arxivdagi sinfga o'quvchi tiklanmaydi.

---

## 4. YANGI — Telegram raqam orqali kirish

### 4.1 G'oya
**Bir marta raqam ulashasan — keyin hech narsa so'ramaydi.** Mini App har ochilganda Telegram yangi `initData` beradi, server uni tekshirib sessiyani o'zi tiklaydi.

### 4.2 Qat'iy xavfsizlik qoidalari
> ⚠️ **Telefon raqam `initData` ichida YO'Q.** Raqamni brauzerdan (JS'dan) kelgan qiymatga **hech qachon ishonma**.

1. **Kimligi** = `initData` (HMAC) bilan tasdiqlangan `telegram_id`.
2. **Raqami** = faqat **bot qabul qilgan `message.contact`** dan olinadi, va faqat `contact.user_id === message.from.id` bo'lsa. Boshqaning kontakti → rad et: «Faqat o'z raqamingizni ulashing».
3. `initData` tekshiruvi (rasmiy algoritm):
   - `secret = HMAC_SHA256(key="WebAppData", data=BOT_TOKEN)`
   - `data_check_string` = `hash` dan boshqa barcha maydonlar, alifbo tartibida, `key=value`, `\n` bilan
   - `hex(HMAC_SHA256(secret, data_check_string)) === hash` → **`timingSafeEqual`** bilan
   - `auth_date` **≤ 1 soat** bo'lsin (eskirgan bo'lsa rad)
4. `/auth/*` ga rate limit: IP bo'yicha 10/daq, `telegram_id` bo'yicha 5/daq.
5. `initData`, telefon, `chat_id` — **loglarga yozilmaydi.**

### 4.3 Oqim

```
Mini App ochiladi → POST /auth/telegram {initData}
  ├─ hash/auth_date xato ............... 401
  ├─ telegram_id ma'lum, raqam tasdiqlangan → memberships tekshiriladi (4.4)
  └─ raqam yo'q → {need_phone:true}
        │
        ▼
   «📱 Raqamni ulashish» tugmasi
     1) Telegram.WebApp.requestContact()   (Bot API 6.9+; isVersionAtLeast('6.9') bilan tekshir)
     2) Bot kontakt xabarini oladi → 4.2-qoida bo'yicha tekshiradi → raqamni saqlaydi
     3) Zaxira yo'l (MAJBURIY, birinchi darajali): botga o'tish
        https://t.me/EduMemoryBot?start=login → bot `request_contact` tugmasini ko'rsatadi
     4) Ilova qayta POST /auth/telegram qiladi (yoki 2 soniyada bir so'rab turadi)
```

- **Tekshir:** `requestContact` dan keyin bot kontaktni xabar sifatida olishini va `contactRequested` hodisasi ma'lumotini **rasmiy hujjatdan** (core.telegram.org/bots/webapps) o'qib sinab ko'r. Ishonchsiz bo'lsa — zaxira yo'l (3) asosiy bo'lsin. Natijani «Qarorlar»ga yoz.
- Brauzerda (Telegramsiz) ochilsa: «Telegram orqali oching» sahifasi + `t.me/EduMemoryBot` tugmasi. **Boshqa kirish yo'li yo'q**, faqat 4.6.

### 4.4 Raqam → shaxs (moslashtirish)

Raqam **E.164** ga keltiriladi (`+998XXXXXXXXX`). Qabul qil: `90 123 45 67`, `998901234567`, `+998 (90) 123-45-67`. Faqat normallashtirilgan qiymat solishtiriladi.

Server raqamni **oldindan ro'yxatdan o'tkazilgan** joylardan qidiradi:

| Manba | Natija |
|---|---|
| `memberships.invited_phone` (xodim taklifi) | o'sha lavozim |
| `teachers.phone` | `teacher` (+ sinf rahbari bo'lsa `class_leader`) |
| `students.phone` | `student` |
| `parent_contacts.phone` | `parent` — shu raqamli **hamma farzandlar** |

Natija:

| Holat | Nima bo'ladi |
|---|---|
| 0 ta moslik | Kirish **yo'q**. «Raqamingiz tizimda yo'q. Maktab ma'muriyatiga bering.» Ixtiyoriy: **maktab kodi** (`schools.join_code`) kiritsa → `access_requests` (kutilmoqda), admin tasdiqlab lavozim beradi |
| 1 ta | Darhol sessiya + o'sha lavozim menyusi |
| 2+ ta (masalan o'qituvchi ham ota-ona; ikki maktabda ishlaydi) | **Profil tanlash** ekrani. Keyin menyudan «Profilni almashtirish» (`POST /auth/switch`) |

**Himoya qoidalari:**
- Bir `telegram_id` = bitta shaxs, bir raqam = bitta shaxs.
- Raqam boshqa `telegram_id` ga bog'langan bo'lsa → **blok** + direktor/adminga bot xabari («Shubhali ulanish urinishi»). Faqat `MANAGE_USERS` egasi aniq «qayta bog'lash» qila oladi (SIM almashgan holat).
- **Yuqori lavozim** (`director`, `deputy_*`, `admin`) birinchi bog'lanishi: taklif qilgan odam (owner/director) botda **tasdiqlamaguncha** faol bo'lmaydi.
- Taklif havolasi: `t.me/EduMemoryBot?start=inv_<kod>` (bir martalik, 7 kun). Raqam mos kelmasa → admin tasdig'ini kutadi.
- Lavozim o'zgarsa yoki hisob to'xtatilsa: sessiyalar **darhol** bekor, foydalanuvchiga bot xabari.
- «Telegramni uzish» tugmasi (foydalanuvchi o'zi) va admin uchun «Uzish».

### 4.5 Birinchi owner
- `.env`: `OWNER_PHONE=+998…`. Server ishga tushganda shu raqamli `owner` memberships (kutilmoqda) yaratadi. Egasi @EduMemoryBot ga raqam ulashsa — owner bo'ladi.
- **Tizim ownersiz qolmasin.** Owner'ni hech kim o'zgartira olmaydi.

### 4.6 Favqulodda kirish (break-glass)
`npm run owner:link` → **bir martalik** kirish havolasi (10 daqiqa) serverning konsoliga chiqadi. Audit'ga yoziladi. Boshqa parol/yashirin eshik **yo'q**.

### 4.7 Dev rejim
`DEV_LOGIN=1` faqat `NODE_ENV=development` da ishlaydi. **Production'da `DEV_LOGIN=1` bo'lsa server ishga tushmasin** (xato bilan to'xtasin). Test uchun `scripts/fake-initdata.ts` — test tokeni bilan imzolangan soxta `initData` yasaydi.

---

## 5. YANGI — Lavozimlar va menyular

### 5.1 Model
**Shaxs** (`users`: telegram_id + raqam) → **a'zolik** (`memberships`: maktab + lavozim + bog'lanish) → **lavozim** (`positions`) → **ruxsatlar** → **menyu**.

**Menyu qo'lda yozilmaydi — ruxsatdan hisoblanadi** (`menu.ts` dagi bitta jadval, 5.4). Server `GET /auth/me` da `{profile, position, permissions[], menu[]}` qaytaradi. Frontend navigatsiyani **shundan** chizadi. Server baribir har endpointni `can()` bilan tekshiradi.

### 5.2 Tayyor lavozimlar (preset)

Har yangi maktabga avtomatik yaratiladi. Direktor ruxsatlarni maktab uchun o'zgartira oladi (5.5 cheklovlari bilan).

| Kalit | Lavozim | Qamrov | Asosiy huquqlar |
|---|---|---|---|
| `owner` | Platforma egasi | hamma maktab | hammasi + `MANAGE_PLATFORM` |
| `director` | Maktab direktori | o'z maktabi | hammasi (platformadan tashqari) |
| `deputy_academic` | O'quv ishlari bo'yicha direktor o'rinbosari | maktab | o'quvchi/o'qituvchi/fan/sinf/jadval, davomat, hisobot, sababli, xavf, xabar, kalendar |
| `deputy_edu` | Ma'naviy-ma'rifiy ishlar bo'yicha direktor o'rinbosari | maktab | ko'rish, hisobot, sababli, ariza ko'rib chiqish, xavf, xabar |
| `admin` | Administrator (ma'mur) | maktab | direktorniki, lekin **sozlama va audit yo'q** |
| `teacher` | Fan o'qituvchisi | o'z biriktirmasi | o'z darslari davomati, o'z sinflari hisoboti |
| `class_leader` | Sinf rahbari | o'z sinfi | `teacher` + sababli, ariza, xavf, xabar (**faqat o'z sinfi**) |
| `dept_head` | Metodbirlashma rahbari | o'z fanlari | `teacher` + o'z fanlari bo'yicha hisobot |
| `psychologist` | Maktab psixologi | maktab | faqat ko'rish: o'quvchilar, xavf, hisobot |
| `nurse` | Tibbiyot hamshirasi | maktab | faqat «**Kasallik**» sababli qilish |
| `observer` | Kuzatuvchi / inspektor | maktab | faqat hisobot (ko'rish) |
| `student` | O'quvchi | o'zi | o'z davomati va jadvali |
| `parent` | Ota-ona | o'z farzandlari | farzand davomati, jadval, ariza yuborish |

- **`class_leader` — hosila lavozim.** Alohida tanlanmaydi: `teacher` bo'lib, `classes.leader_teacher_id` unga ko'rsatsa, ruxsatlari avtomatik qo'shiladi.
- Direktor **maxsus lavozim** yarata oladi: preset'dan nusxa (`base_key`) + nom + ruxsatlar + qamrov (`school | own_classes | own_subjects | own_children | self`).

### 5.3 Ruxsatlar (25 ta)

**v2 dan 13:** `VIEW_STUDENTS, CREATE_STUDENTS, EDIT_STUDENTS, DELETE_STUDENTS, VIEW_TEACHERS, MANAGE_TEACHERS, MANAGE_SUBJECTS, MANAGE_CLASSES, MANAGE_SCHEDULE, MARK_ATTENDANCE, VIEW_REPORTS, EXPORT_DATA, MANAGE_SETTINGS`

**Yangi 12:**

| Ruxsat | Nima uchun |
|---|---|
| `MANAGE_USERS` | xodim taklif qilish, lavozim berish, Telegramni uzish |
| `APPROVE_ACCESS` | kutilayotgan kirish so'rovlarini tasdiqlash |
| `VIEW_AUDIT` | audit jurnalini ko'rish |
| `VIEW_CONTACTS` | ota-ona/o'quvchi **telefonini** ko'rish (boshqalarga maskalanadi: `+998 90 *** ** 12`) |
| `SEND_MESSAGES` | ota-ona/xodimlarga qo'lda xabar |
| `EXCUSE_ANY` | istalgan sinfda istalgan sabab bilan sababli qilish |
| `EXCUSE_OWN_CLASS` | faqat o'z sinfida |
| `EXCUSE_ILLNESS` | faqat «Kasallik» sababi bilan |
| `REVIEW_EXCUSE_REQUESTS` | ota-ona arizasini qabul/rad |
| `SUBMIT_EXCUSE_REQUEST` | ota-ona ariza yuborish |
| `VIEW_RISK` | xavf ro'yxati |
| `MANAGE_CALENDAR` | bayram/ta'til kalendari |

(`MANAGE_PLATFORM` — faqat `owner`, jadvalda yo'q, tahrirlanmaydi.)

### 5.4 Menyu qoidalari (`menu.ts`)

| Menyu | Ko'rinish sharti |
|---|---|
| Boshqaruv (dash) | hamma |
| Maktablar | `MANAGE_PLATFORM` |
| Foydalanuvchilar | `MANAGE_USERS` |
| Kirish so'rovlari | `APPROVE_ACCESS` |
| Sinflar | `MANAGE_CLASSES` yoki sinf qamrovida `VIEW_STUDENTS` |
| O'quvchilar | `VIEW_STUDENTS` |
| O'qituvchilar | `VIEW_TEACHERS` |
| Fanlar | `MANAGE_SUBJECTS` |
| Jadval | `MANAGE_SCHEDULE` yoki o'z jadvali (teacher/student/parent) |
| Kalendar | `MANAGE_CALENDAR` |
| Davomat | `MARK_ATTENDANCE` |
| Sababli | `EXCUSE_ANY` / `EXCUSE_OWN_CLASS` / `EXCUSE_ILLNESS` |
| Arizalar | `REVIEW_EXCUSE_REQUESTS` yoki `SUBMIT_EXCUSE_REQUEST` |
| Xabar | `SEND_MESSAGES` |
| Xavf ro'yxati | `VIEW_RISK` |
| Hisobot | `VIEW_REPORTS` |
| Audit | `VIEW_AUDIT` |
| Maktab sozlamalari | `MANAGE_SETTINGS` |
| Telegram holati | `MANAGE_USERS` yoki `MANAGE_PLATFORM` |
| Farzandlarim | lavozim `parent` |
| Profil | hamma (profil almashtirish, Telegramni uzish) |

### 5.5 Berish qoidalari (huquq oshirib yuborishdan himoya)
- Lavozimni faqat shunday kishi bera oladi: berilayotgan lavozimning **barcha ruxsatlari berayotganning ruxsatlari ichida** bo'lsin va `rank` pastroq bo'lsin.
- Kim kimni yaratadi: owner → maktab + direktor; director → o'rinbosarlar, admin, o'qituvchi, psixolog, hamshira, kuzatuvchi; admin va `deputy_academic` → o'qituvchi, o'quvchi, ota-ona ma'lumoti.
- **Oxirgi director / owner o'chirilmaydi, pasaytirilmaydi.**
- Direktor `MANAGE_USERS` va `MANAGE_SETTINGS` ni o'zidan ola olmaydi.
- Har bir lavozim o'zgarishi auditga yoziladi va shaxsga botda xabar boradi.

### 5.6 Yangi sahifalar
- **Foydalanuvchilar**: ro'yxat, lavozim, Telegram holati (`✈ ulangan / ⏳ kutilmoqda / ○ ulanmagan`), taklif (raqam + lavozim), lavozim almashtirish, to'xtatish, Telegramni uzish, taklif havolasini nusxalash.
- **Kirish so'rovlari**: tasdiqlash / rad / lavozim tanlash.
- **Maktablar** (owner): maktab + direktor yaratish, `join_code`.
- **Telegram holati**: ulangan/kutilayotgan soni, navbat holati, xatolar.
- O'qituvchi, o'quvchi, ota-ona formalarida **telefon majburiy** (kirish uchun) va yonida ulanish nishoni.

---

## 6. YANGI — Ikki qo'shimcha imkoniyat

### A. Ota-ona arizasi (sababli so'rovi)
Ota-ona Mini App'da **«Arizalar»** → farzandni tanlaydi → sana (bugundan **14 kun oldinga** gacha) → sabab (4 ta) + izoh → yuboradi.

- Jadval: `excuse_requests(school_id, student_id, parent_user_id, date_from, date_to, reason, note, status, reviewed_by, created_at)`; `status`: `pending | approved | rejected | cancelled`.
- Sinf rahbariga botda xabar + **inline tugmalar** [✅ Qabul] [❌ Rad]. Veb'dan ham ko'rib chiqsa bo'ladi.
- **Qabul qilingan ariza kelajak sanalarni oldindan «sababli» qiladi — lekin yozuv yaratmaydi.** O'qituvchi o'sha kuni `a` qo'ysa, server uni avtomatik `e` ga aylantiradi va `attendance_excuses` ga `source='ariza#<id>'` bilan yozadi (audit: «avtomatik»). O'tgan sana uchun qabul — 3.4 dagi oddiy sababli qilish.
- Himoya: ota-ona faqat **o'z farzandlari** uchun; kuniga farzand boshiga ≤ 3 ariza; ota-ona roziligi (`consent_at`) bo'lishi shart.
- Ota-onaga qaror haqida bot xabari.

### B. Nazorat markazi (avtomatik eslatma va signal)
Bitta rejalashtirgich, uchta kichik qism. **Vaqt yetmasa B3 ni oxirgiga qoldir.**

1. **Eslatma.** Dars tugaganidan **15 daqiqa** keyin davomat `submitted` bo'lmasa — o'qituvchiga bot xabari (bir marta). 2 soatdan keyin ham bo'lmasa — zavuch (`deputy_academic`) ga umumiy ro'yxat.
2. **Xavf signali.** O'quvchi **ketma-ket 3 dars kuni** `a` bo'lsa yoki 30 kunda foiz **< 75%** bo'lsa — sinf rahbari, psixolog va `VIEW_RISK` egalariga xabar. Bir o'quvchiga 7 kunda ko'pi bilan 1 marta (dedupe). «Xavf ro'yxati» menyusida ham ko'rinadi.
3. **Kunlik xulosa.** Direktor va zavuchga `HH:MM` (default 09:30): maktab davomati %, davomat olinmagan darslar, eng past 3 sinf.

**Kalendar (B ning sharti):** `school_calendar(school_id, date_from, date_to, kind, name)` — `kind`: `holiday | break | no_lessons`. Bayram, ta'til va dars bo'lmagan kunlarda eslatma/xulosa/ota-ona xabari **yuborilmaydi**, `lessons()` ham bo'sh qaytadi. Sozlama: maktab har bir bildirishnomani alohida o'chira oladi.

---

## 7. Frontend kamchiliklari — hammasini tuzat

Bular `index.html` ni o'qib **topilgan haqiqiy muammolar**. Har biriga test yoz.

| ID | Muammo (joyi) | Tuzatish |
|---|---|---|
| K1 | «Rol:» tanlagich (`render()` dagi `sel("role")`) — istalgan kishi **owner** bo'lib oladi | Olib tashla. Rol = serverdan. Faqat `?dev=1` + `DEV_LOGIN` da |
| K2 | `can()` faqat brauzerda; `D` hamma ma'lumotni yuklaydi, teacher filtri UI'da | Server `can()` + `/bootstrap` rolga qarab **kesadi** |
| K3 | `save()` **butun** JSON'ni yozadi — ko'p foydalanuvchida boshqalar ishini o'chiradi | Har amal alohida endpoint. Butun JSON'ni `PUT` qilish **taqiqlanadi** |
| K4 | ID = `D.n++` — qurilmalarda to'qnashadi | Bazada ID |
| K5 | **`A.open` darsni shunchaki ochsa `autoSave()` hammani «Keldi» qilib saqlaydi** — yolg'on hisobot va yolg'on «barcha darslarda qatnashdi ✅» xabari | Ochganda **hech narsa yozilmasin**. Boshlang'ich holat «belgilanmagan». Sessiya `draft → submitted`; hisobot va xabarga faqat `submitted` kiradi. «Hammasi keldi» alohida bosiladi |
| K6 | `A.tg` — «Yuborilgan» belgisi tugma **bosilishi bilanoq** qo'yiladi (yuborilmagan bo'lsa ham) | Holat `outbox_messages` dan: `queued / sent / failed` |
| K7 | `TODAY` — qurilma soati, o'zgarmas konstanta; Mini App tunda ochiq qolsa eskiradi | «Bugun» serverdan (`/bootstrap.today`), `visibilitychange` va har 60 s da yangila |
| K8 | `s.color` **escape qilinmagan** (`lessonCard`, `pSchedule`, `pSubjects`) — zaxira JSON orqali atribut/CSS injeksiya | Server: `^#[0-9a-fA-F]{6}$`. Frontend: baribir `esc()` |
| K9 | Har qator uchun `tally(recs())` hamma sessiyani aylanadi (O(o'quvchi × sessiya)); `input` har harfda to'liq `render()` | Hisob **serverda**. Ro'yxatlar sahifalanadi (50/sahifa). Qidiruv `debounce 250ms`. Faqat o'zgargan qismni yangila |
| K10 | `render()` hamma DOM'ni qayta yozadi, fokusni qo'lda tiklaydi — telefonda klaviatura yopilib qoladi | Qidiruv inputini DOM'da saqla |
| K11 | `seed()` — har yangi brauzerda soxta o'quvchilar | Production'da **bo'sh**. Birinchi ishga tushirish ustasi (maktab → sinf → fan → o'qituvchi). `SEED_DEMO=1` faqat dev |
| K12 | `undoexc` faqat `ui.date` bilan; qayta tahrirdan keyin `excuse.k` eskirib qoladi | 3.4 qoidasi: `session_ids`, `DELETE /attendance/excuse/:studentId/:date` |
| K13 | `tgLink` → `t.me/+998…` — raqamni bilmaydigan odamga ishlamaydi; xabar qo'lda «Paste» | Bot o'zi yuboradi (10-bo'lim) |
| K14 | Bayram/ta'til yo'q — `lessons()` faqat `school.days` ga qaraydi | `school_calendar` (6-B) |
| K15 | Mini App moslashuvi yo'q | 11-bo'lim |
| K16 | Offline yo'q | 11-bo'lim, 5-band |

---

## 8. Ma'lumot modeli

**v2 dan:** `schools, school_settings, years, subjects, teachers, classes, students, parent_contacts, assignments, schedule_slots, attendance_sessions, attendance_records, attendance_excuses, outbox_messages, audit_log, telegram_invites`.

**3.0 da o'zgaradi/qo'shiladi:**

| Jadval | Mazmuni |
|---|---|
| `users` | global shaxs: `id, phone_e164 (unikal), full_name, status` |
| `telegram_identities` | `telegram_id (unikal), user_id, phone_verified_at, bound_at, unbound_at` |
| `positions` | `school_id, key, name_uz, base_key, scope, rank, is_preset` |
| `position_permissions` | `position_id, permission` (v2 `role_permissions` o'rnini bosadi) |
| `memberships` | `user_id, school_id (NULL=owner), position_id, status (invited/pending/active/suspended), invited_phone, invited_by, teacher_id?, student_id?` |
| `parent_students` | `parent_user_id, student_id, consent_at` |
| `access_requests` | `school_id, user_id, note, status, decided_by` |
| `excuse_requests` | 6-A |
| `school_calendar` | 6-B |
| `notification_settings` | maktab bo'yicha yoqish/o'chirish va vaqtlar |
| `sessions` | `user_id, membership_id, expires_at, ...` |

- Migratsiyalar **orqaga qaytariladigan** bo'lsin. `attendance_sessions` ga `status` (`draft/submitted`) qo'sh (K5).
- Frontend JSON shakli (`import` / `bootstrap` moslik uchun) v2 dagidek qoladi (`v, n, theme, me, log, school, years, subjects, teachers, classes, students, assigns, sched, ses, excuse, perm, sent`). `perm` endi lavozim bo'yicha.
- Loglarda ism, telefon, `chat_id` bo'lmasin.

## 9. API (`/api/v1`, zod bilan)

- **Auth:** `POST /auth/telegram`, `POST /auth/switch`, `POST /auth/logout`, `POST /auth/unlink`, `GET /auth/me`.
- `GET /bootstrap` — rolga **kesilgan** ma'lumot + `today` + `menu`.
- **CRUD + arxiv:** `schools` (owner), `users`, `memberships`, `positions` (+ `/permissions`), `access-requests`, `years`, `subjects`, `teachers`, `classes`, `students` (+ `POST /students/bulk`), `assignments`, `schedule`, `calendar`.
- **Davomat:** `GET /attendance?date=`, `PUT /attendance/sessions/:slotId/:date` (version bilan), `POST /attendance/sessions/:slotId/:date/submit`, `POST /attendance/excuse`, `DELETE /attendance/excuse/:studentId/:date`.
- **Arizalar:** `POST /excuse-requests`, `GET /excuse-requests`, `POST /excuse-requests/:id/decide`.
- **Hisobot:** `GET /reports`, `GET /reports.csv` (formula-injection himoyasi: `= + - @ \t \r` bilan boshlansa oldiga `'`), `GET /risk`.
- `POST /import` (eski `edm_school_v1` JSON, **idempotent**), `GET /export`.
- `settings`, `audit` (faqat o'qish), `notification-settings`.

## 10. Telegram bot (@EduMemoryBot)

- Buyruqlar: `/start`, `/menu`, `/help`, `/stop`, `/unlink`. Menyu tugmasi `setChatMenuButton` → Mini App URL.
- **Rozilik:** ota-ona birinchi ulanganda: «Farzandingiz davomati haqida xabar olishga rozimisiz?» [Roziman] → `consent_at`. `/stop` — xabarni to'xtatadi (kirishni emas), hurmat qilinadi.
- Bir ota-onaga bir nechta farzand, bir farzandga bir nechta ota-ona.
- **Yuborish:** «har dars saqlanganda» yoki «kun oxirida HH:MM» (default 15:00).
- `outbox_messages`: holat, urinishlar, xato matni; takror yubormaslik kaliti (`student+date`).
- **Limitlar** (rasmiy): ~30 xabar/s umumiy, **bitta chatga ≤ 1/s**. O'zimizda xavfsiz chegara: **25/s**. `429` da `retry_after` kut. `403` (bot bloklangan) → kontakt faolsizlanadi.
- Dam olish, bayram va davomat olinmagan kunga **yuborilmaydi**. Faqat `submitted` sessiyalar hisobga olinadi (K5).
- Xabar boshida «📚 {Maktab nomi}». Matn (o'zgarmaydi):

```
Assalomu alaykum! {ism} ({sinf}) {kun}-{oy} kuni:
❌ 2-dars Matematika — kelmadi
⏰ 3-dars Fizika — kechikdi
ℹ️ 4-dars Tarix — sababli qoldirdi
Qolgan darslarda qatnashdi ✅
```
Hammasi kelgan bo'lsa: `... barcha darslarda (N ta) qatnashdi ✅`

- Token faqat `.env` da: `BOT_TOKEN`, `BOT_USERNAME=EduMemoryBot`, `PUBLIC_URL`, `WEBHOOK_SECRET`, `OWNER_PHONE`.

## 11. Frontendni ulash va Mini App

1. **Kirish ekrani** + `GET /bootstrap` (`Store` obyekti `function load()` oldida).
2. Har amal → alohida endpoint: `msave/form` → CRUD, `arch`, `del`, `doas/unas` → assignments, `setc/clrc` → schedule, `autoSave` → `PUT sessions`, `doexc/undoexc` → excuse, `dobulk` → students/bulk, `ssch` → settings, `perm` → lavozim ruxsatlari, `tg` → outbox.
3. Amaldan keyin serverdan yangi holat olinadi, UI shundan chiziladi. **Ko'rinish va oqim o'zgarmasin.**
4. Navigatsiya `GET /auth/me.menu` dan. Menyuda yo'q sahifaga to'g'ridan kirsa — «Ruxsat yo'q».
5. **Offline:** davomat navbati `localStorage`da; internet kelganda qayta yuboriladi; `409` bo'lsa foydalanuvchiga ko'rsat.
6. **Mini App:**
   - `Telegram.WebApp.ready()` va `expand()`
   - Telegram mavzu ranglariga moslash (mavjud tungi/kunduzgi rejim saqlansin)
   - `safeAreaInset` / `contentSafeAreaInset` (8.0+), pastki nav ostida
   - `BackButton` — ichki sahifalarda
   - `HapticFeedback` — belgilash va saqlashda
   - Versiyani `isVersionAtLeast` bilan tekshir, eski mijozda zaxira yo'l
7. **Tekshiruv:** brauzerda **390×844** (telefon) va **1280×800** da ekran suratlarini ol.

## 12. Xavfsizlik

### 12.1 Asosiy

- Bolalar shaxsiy ma'lumoti: keraksizini saqlama. Telefon `VIEW_CONTACTS` siz maskalanadi.
- CSRF (SameSite + maxsus sarlavha), strict CORS, helmet + **CSP** (`telegram.org/js/telegram-web-app.js` ga ruxsat), rate limit, hamma kirish zod bilan.
- Ota-ona roziligi va `/stop` hurmat qilinadi.
- HTTPS yo'riqnomasi (Caddy), kunlik shifrlangan DB zaxira + **tiklash buyrug'i** README'da.
- Maktab o'z ma'lumotini eksport qila oladi.
- Repoda **hech qanday sir** yo'q (`.env.example` faqat nomlar bilan).

### 12.2 Qo'shimcha himoya (MAJBURIY — har biri testga aylansin)

| № | Qoida | Nima uchun |
|---|---|---|
| 1 | Ilova bazaga **oddiy rol** bilan ulanadi: **superuser emas, jadval egasi ham emas**. Jadvallarda `ENABLE` **va `FORCE ROW LEVEL SECURITY`**. Migratsiya alohida rol bilan. Server ishga tushganda tekshir (`pg_roles`: `rolsuper`, `rolbypassrls`; jadval egasi) — buzilgan bo'lsa **ishga tushmasin** | Egasi/superuser uchun RLS **ishlamaydi** — himoya jimgina yo'qoladi |
| 2 | **Bot faqat shaxsiy chatda** (`chat.type === 'private'`). Guruh/kanalga qo'shilsa — hech narsa yubormaydi va `leaveChat` qiladi | Bola ma'lumoti guruhga tushmasin |
| 3 | `frame-ancestors` — **faqat Telegram** domenlari (rasmiy hujjat va amalda tekshir). Boshqa saytlar iframe qila olmaydi | Telegram Web Mini App'ni iframe'da ochishi mumkin; helmet standarti uni **buzadi**, butunlay ochiq qoldirsang — clickjacking |
| 4 | Iframe ichida `SameSite=Lax` cookie yuborilmasligi mumkin → `SameSite=None; Secure` yoki Bearer. **Ikkala muhitda** (telefon, Telegram Web) sinab ko'r | Kirish Telegram Web'da jimgina buzilmasin |
| 5 | Taklif kodi (`inv_`) = `crypto.randomBytes(16)`, bazada **hash**, bir martalik. `join_code` odam yozadi: ≥ 8 belgi, `telegram_id` bo'yicha 5 urinish/soat, 5 xatodan keyin blok, direktor almashtira oladi | Taxmin qilib kirishga qarshi |
| 6 | Sessiya: cookie `__Host-` prefiksi; TTL 7 kun (sliding), mutlaq 30 kun; token bazada **hash**; foydalanuvchiga ≤ 5 faol sessiya; logout hammasini bekor qiladi | Sessiya o'g'irlansa zarar kam |
| 7 | **Token oqsa — tartib** (README «Favqulodda»): BotFather `/revoke` → yangi token → `.env` → webhook va `secret_token` almashtirish → hamma sessiya bekor | Tez va xatosiz reaksiya |
| 8 | Sirlar: `.env` ruxsati `600`, `gitleaks` pre-commit, xato xabarlarida sir yo'q | Tasodifiy oqish |
| 9 | Bog'liqliklar: `npm ci` + lockfile; `npm audit --omit=dev` da **yuqori/kritik** topilma bo'lsa to'xta; keraksiz paket qo'shma | Ta'minot zanjiri |
| 10 | DB diski shifrlangan (VPS provayderi yoki LUKS) — README'da. 🔴 Ixtiyoriy: telefon ustuni ilova darajasida shifrlanadi + qidiruv uchun HMAC indeks | Server yoki zaxira oqsa |
| 11 | `docs/THREAT-MODEL.md` (STRIDE: Telegram kirish, bot, DB, eksport, import) va `SECURITY.md` (zaiflik haqida xabar berish) | Xavf ongli boshqariladi |

## 13. Majburiy testlar

**v2 dan:** begona maktabga API orqali/ID taxmin qilib kirib bo'lmasligi · RLS'siz ham izolyatsiya · teacher boshqa sinfga davomat qo'ya olmasligi · bir o'qituvchi bir vaqtda ikki sinfda bo'la olmasligi · kelajak sana rad · bir vaqtda ikki yozuvda `409` · sababli va bekor qilish (qo'lda `e` ga tegmaslik) · foiz hisobi · oxirgi director/owner himoyasi · import ikki marta → dublikat yo'q · takror xabar yo'q.

**Yangi:**

| Soha | Test |
|---|---|
| initData | soxta hash → 401 · eskirgan `auth_date` → 401 · boshqa bot tokeni bilan imzolangan → 401 |
| Kontakt | `contact.user_id ≠ from.id` → rad · brauzer yuborgan raqamga ishonilmaydi |
| Moslik | tizimda yo'q raqam → kirish yo'q + `access_request` · raqam boshqa `telegram_id` da → blok + ogohlantirish |
| Profil | 2+ a'zolik → tanlash va menyu almashishi · lavozim o'zgarsa eski sessiya bekor |
| Menyu | **har bir preset uchun** menyu snapshot testi (`menu = f(ruxsat)`) |
| Ruxsat | **rol × amal matritsasi**, preset jadvalidan avtomatik hosil bo'ladi · menyuda yo'q endpointga to'g'ridan so'rov → `403` |
| Qamrov | teacher boshqa o'qituvchi sinfini ko'ra olmaydi · parent faqat o'z farzandlarini ko'radi · `class_leader` faqat o'z sinfida sababli qiladi · hamshira faqat «Kasallik» |
| Berish | o'zidan kuchli lavozim bera olmaslik (5.5) |
| Ariza | qabul qilingan ariza `a` → `e` ga avtomatik aylantiradi, `source` yoziladi · 4-ariza/kun rad |
| Nazorat | eslatma **bir marta** ketadi · bayramda ketmaydi · xavf signali dedupe |
| K5 | darsni ochish **hech qanday yozuv yaratmaydi** |
| K8 | zararli `color` rad etiladi |
| Dev | `NODE_ENV=production` + `DEV_LOGIN=1` → server ishga tushmaydi |
| RLS | ilova roli bilan `app.school_id` o'rnatmasdan `SELECT` → **0 qator** · superuser/jadval egasi bilan ulansa server **ishga tushmaydi** |
| Bot | guruh chatida `/start` → javob yo'q, bot chiqib ketadi |
| Kodlar | `join_code` ni 6 marta xato kiritish → blok · taklif kodi ikkinchi marta ishlamaydi |
| Sarlavhalar | `frame-ancestors` faqat Telegram · cookie bayroqlari (`__Host-`, `Secure`, `HttpOnly`) |
| Sirlar | `gitleaks` repoda 0 topilma |
| Yuklama | 1000 o'quvchi / 40 o'qituvchi / 1 yillik davomat — ro'yxat va hisobot **p95 < 500 ms** |
| E2E | Playwright + `fake-initdata`: direktor, o'qituvchi, ota-ona to'liq yo'li |

## 14. Bosqichlar (har birining oxirida to'xta va hisobot ber)

| Bosqich | Mazmun |
|---|---|
| **M0** | Audit (v2 bormi?), reja, sxema, Docker, bo'sh server, K-ro'yxat tasdig'i |
| **M1** | Identifikatsiya: `users/memberships/positions`, Telegram kirish (4-bo'lim), `can()`, RLS, audit, break-glass |
| **M2** | Lavozim presetlari + menyu + berish qoidalari, CRUD, biriktirish, jadval qoidalari, arxiv, «Foydalanuvchilar» va «Kirish so'rovlari» |
| **M3** | Davomat (**K5 tuzatilgan**), sababli, hisobot, CSV, kalendar |
| **M4** | `/bootstrap`, `/import`, frontend integratsiyasi, K1–K12, Mini App moslashuvi |
| **M5** | Bot: ota-ona ulanishi/roziligi, navbat, xabar yuborish; **6-A ariza** |
| **M6** | **6-B nazorat markazi**, zaxira, README, `.env.example`, o'rnatish yo'riqnomasi (Caddy + webhook) |
| **M7** | Yakuniy: hamma test, E2E, yuklama testi, xavfsizlik ko'rigi, `README` «Qarorlar» tozalash |

## 15. Hisobot shakli va tugallash mezoni

**Har bosqichda:** nima qilindi · qaysi testlar o'tdi (son bilan) · **nimani sina olmading** · keyingi qadam uchun menga nima kerak.

**«Tugadi» deyish uchun hammasi bajarilgan bo'lsin:**
- [ ] `docker compose up` bilan hammasi ko'tariladi
- [ ] `owner:link` bilan owner kiradi, maktab va direktor yaratadi
- [ ] Direktor **@EduMemoryBot** ga raqam ulashadi → **direktor menyusi** ochiladi
- [ ] Ro'yxatdagi o'qituvchi raqam ulashadi → **o'qituvchi menyusi** (boshqa hech narsa yo'q)
- [ ] Ota-ona raqam ulashadi → **faqat o'z farzandlari**
- [ ] Tizimda yo'q raqam → kirish **yo'q**
- [ ] 13 preset lavozimning har biri uchun menyu va ruxsat testi yashil
- [ ] K1–K16 hammasi tuzatilgan yoki sababi bilan «Qarorlar»da yozilgan
- [ ] 6-A va 6-B ishlaydi (yoki B3 nima uchun tashlangani yozilgan)
- [ ] Hamma testlar yashil, E2E o'tgan, yuklama testi raqami hisobotda
- [ ] Repoda sir yo'q, README oddiy tilda

**Foydalanuvchidan so'ra (o'zing o'ylab topma):** bot tokeni (BotFather) · HTTPS domen · server (VPS) · `OWNER_PHONE` · maktab nomi, manzili, dars vaqtlari.

---

## 16. Taqiqlar (buzma!)

- ❌ Parol, yashirin kirish yo'li, «vaqtincha» ochiq endpoint.
- ❌ Raqamni brauzer/JS'dan olish.
- ❌ Butun JSON'ni serverga `PUT` qilish.
- ❌ Menyuni qo'lda yozish (faqat `menu.ts`).
- ❌ Sinamasdan «ishladi» deyish.
- ❌ Frontend ko'rinishi va oqimini sezdirmay o'zgartirish.
- ❌ Token/telefon/`chat_id` ni loglarga yoki repoga yozish.
- ❌ Savol berib to'xtab qolish — eng sodda yechimni tanla va «Qarorlar»ga yoz.
