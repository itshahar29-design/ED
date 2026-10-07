# EduMemory 3.0 MAX — «Dahshat+» topshiriq (Antigravity uchun)

> Bu fayl v2 va oddiy v3 ni **to'liq almashtiradi**. Faqat shu fayl amal qiladi. v2 dagi hamma muhim qoida bu yerga ko'chirilgan (3-bo'lim).
> **Ikki qism:** **I qism** (1–16-bo'lim, M0–M7) — yadro, **shart**. **II qism** (17–32-bo'lim, M8–M13) — MAX modullari, faqat M7 tugagach.
> Bot: **@EduMemoryBot** (`https://t.me/EduMemoryBot`). Til: asosiy **o'zbekcha (lotin)**; II qismda rus va kirill qo'shiladi (B3).

---

## 0. Ish tartibi — buyruq sifatida

1. **Avval ish papkasini tekshir.** `server/`, `package.json`, `docker-compose.yml` bor bo'lsa — bu v2 natijasi. U holda **noldan yozma**: audit qil, kamchiligini top, migratsiya bilan yangila. Yo'q bo'lsa — noldan qur.
2. `index.html` ni (vanilla JS, ~62 KB, build yo'q) **boshidan oxirigacha o'qi**. Bu ishlayotgan, tasdiqlangan frontend. Ko'rinishi va oqimi **o'zgarmasin**. Framework va build qo'shma. Faylni `app.css` / `app.js` / modullarga bo'lish mumkin.
3. Kod yozishdan oldin qisqa **reja + DB sxemasi** yoz. Tasdiq kutma, davom et. Noaniq joyda **eng sodda yechimni** tanla va `README.md` → «Qarorlar» bo'limiga **bir qator** yoz.
4. Bosqichma-bosqich ishla (14-bo'lim). Har bosqich oxirida testlarni ishga tushir va hisobot ber (15-bo'lim).
5. Foydalanuvchi **texnik emas**. README oddiy tilda, buyruqlar nusxalab ishlatiladigan bo'lsin.
6. **Yolg'on «ishladi» dema.** Sinamagan narsangni «SINALMADI» deb yoz. Halol hisobot — eng muhim talab.
7. Bot tokeni, domen, serverni **sen o'ylab topma**. Ularni foydalanuvchidan so'ra (15-bo'lim oxirida ro'yxat).
8. **Tartib:** avval I qism (M0–M7) to'liq tugasin va `main` yashil bo'lsin. II qismga (MAX) **shundan keyin** o't (17-bo'lim).
9. Har bosqich oxirida ildizdagi **`STATUS.md`** ni yangila (qaerda to'xtading, keyingi qadam, qizil testlar). Limit tugasa ham ish yo'qolmasin.

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
| **M7** | **I qism yakuni:** hamma test, E2E, yuklama testi, xavfsizlik ko'rigi, `README`. Shu nuqtada tizim to'liq ishlasin va `main` yashil bo'lsin |
| **M8** | 🟢 A0 matn normalizatsiyasi · A1 o'qituvchi almashtirish · A2 yozuv tarixi + audit zanjiri · A3 PWA/offline |
| **M9** | 🟡 B1 real vaqt (SSE) · B2 chorak, analitika, PDF/XLSX |
| **M10** | 🟡 B3 ko'p tillilik (uz/ru/kirill) · B5 maxfiylik |
| **M11** | 🟡 B4 kuzatuvchanlik, CI/CD, zaxira mashqi, yuklama |
| **M12** | 🔴 C1 jadval generatori · C2 hududiy kuzatuvchi |
| **M13** | 🟢 Qizil jamoa (31 hujum) · mutatsion va xossa testlar · yakuniy hisobot |

## 15. Hisobot shakli va tugallash mezoni

**Har bosqichda:** nima qilindi · qaysi testlar o'tdi (son bilan) · **nimani sina olmading** · keyingi qadam uchun menga nima kerak.

**«I qism tugadi» deyish uchun hammasi bajarilgan bo'lsin:**
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


---
---

# II QISM — MAX modullari (M8–M13)

> **To'xta.** M7 tugab, hamma testlar yashil va `main` ishlaydigan holatda bo'lmaguncha bu qismga **o'tma**.
> Bu qism — **kuchli, lekin xavfli** kengaytma. Shuning uchun qat'iy intizom kerak (17-bo'lim).

## 17. MAX ishlash intizomi

1. **Har modul — alohida git branch (yoki worktree) + alohida feature flag.** Flag: `feature_flags(school_id, key, on)`. Flag o'chiq bo'lsa tizim v3 yadrosidek ishlaydi.
2. **Regressiya darvozasi.** Modul `main` ga faqat shunda qo'shiladi: eski testlarning **hammasi** yashil + modulning yangi testlari yashil + qisqa hisobot. Bitta eski test qizarsa — modulni qo'shma.
3. **Checkpoint.** Har modul/bosqich oxirida ildizda **`STATUS.md`** ni yangila:
   - hozirgi holat (qaysi modul, qaysi qadam)
   - keyingi 5 qadam
   - ochiq xatolar va **qizil testlar**
   - qaror qilinmagan savollar
   Limit/vaqt tugab qolsa, boshqa sessiya **faqat `STATUS.md` ni o'qib** davom eta olsin.
4. **Tier tartibi:** 🟢 A → 🟡 B → 🔴 C. Vaqt yetmasa C ni **tashla**, lekin sababini `STATUS.md` ga yoz.
5. **Parallel agentlar bo'lsa:** papkalarni bo'l (`server/`, `public/`, `tests/`, `docs/`). Migratsiya fayllari **vaqt tamg'ali** bo'lsin (to'qnashmasin). Bir fayl — bitta agent.
6. **Sifat > miqdor.** 6 ta to'liq sinalgan modul — 11 ta yarim-tayyor moduldan yaxshi. «Ishladi» deb faqat **test bilan isbotlanganini** ayt.
7. Yangi ruxsat qo'shilsa: `position_permissions` presetlari, `menu.ts`, rol×amal matritsasi va snapshot testlarni **darhol** yangila.

## 18. Modullar xaritasi

| Kod | Modul | Tier | Bosqich | Flag |
|---|---|---|---|---|
| A0 | O'zbekcha matn normalizatsiyasi | 🟢 | M8 | — (doim yoqiq) |
| A1 | O'qituvchi almashtirish | 🟢 | M8 | `substitutions` |
| A2 | Yozuv tarixi + audit zanjiri | 🟢 | M8 | — (doim yoqiq) |
| A3 | PWA + offline sinxronizatsiya | 🟢 | M8 | `offline` |
| B1 | Real vaqt (SSE) | 🟡 | M9 | `realtime` |
| B2 | Chorak, analitika, PDF/XLSX | 🟡 | M9 | `analytics` |
| B3 | Ko'p tillilik (uz / ru / kirill) | 🟡 | M10 | `i18n` |
| B5 | Maxfiylik: eksport, anonimlash | 🟡 | M10 | `privacy` |
| B4 | Kuzatuvchanlik, CI/CD, zaxira mashqi, yuklama | 🟡 | M11 | — |
| C1 | Jadval generatori (solver) + jadval versiyalari | 🔴 | M12 | `timetable_gen` |
| C2 | Hududiy kuzatuvchi (ko'p maktab, anonim) | 🔴 | M12 | `district` |
| — | Qizil jamoa + mutatsion/xossa testlar | 🟢 | M13 | — |

**Yangi menyular** (5.4 jadvaliga qo'shiladi; `menu.ts` da, qo'lda emas):

| Menyu | Ko'rinish sharti | Modul |
|---|---|---|
| Almashtirish | `MANAGE_SUBSTITUTIONS` | A1 |
| Tarix (yozuv yonidagi 🕘) | davomatni ko'rish huquqi | A2 |
| Hozir (jonli taxta) | `VIEW_REPORTS` + maktab qamrovi | B1 |
| Eksportlar | `EXPORT_DATA` | B2 |
| Mening ma'lumotlarim | lavozim `parent` | B5 |
| O'chirish so'rovlari | `MANAGE_USERS` | B5 |
| Jadval generatsiyasi | `MANAGE_SCHEDULE` | C1 |
| Hududiy panel | `VIEW_DISTRICT` | C2 |

---

## 19. A0 — O'zbekcha matn normalizatsiyasi 🟢

**Muammo:** `Oʻrinbosar`, `O'rinbosar`, `Oʼrinbosar`, `O‘rinbosar` — odam uchun bir xil, kompyuter uchun to'rt xil. Qidiruv va dublikat tekshiruvi buziladi.

- `normalizeUz(s)`: NFKC → kichik harf → barcha apostrof-o'xshashlar (`' ʻ ʼ ’ ‘ ´ ′` va backtick) → bitta `'` → ortiqcha bo'shliq yig'iladi.
- **Kirill → lotin** (faqat qidiruv uchun): `Каримов` ≈ `Karimov`, `Ўктам` ≈ `O'ktam`, `Ғайрат` ≈ `G'ayrat`.
- Jadvallarga `name_norm` ustuni (o'quvchi, o'qituvchi, sinf, fan). **Foydalanuvchiga kiritilgani o'zgarishsiz ko'rsatiladi.**
- Qidiruv: `pg_trgm` indeksi (noaniq qidiruv: `Karimof` → `Karimov`). Dublikat tekshiruvi `name_norm` bo'yicha.
- **Ism tartibi ogohlantirishi:** `Karimov Ali` ≈ `Ali Karimov` (so'zlar to'plami bir xil) → «Shunga o'xshash o'quvchi bor».
- **Testlar:** 4 ta apostrof varianti teng · `norm(norm(x)) == norm(x)` (idempotent, xossa testi) · kirill/lotin qidiruv · 1000 o'quvchida qidiruv < 100 ms.

## 20. A1 — O'qituvchi almashtirish 🟢

**Hayotiy holat:** o'qituvchi kasal. 3-darsga boshqa o'qituvchi kirishi kerak. Hozir bunday imkon yo'q.

**Ma'lumot:**
- `teacher_absences(school_id, teacher_id, date_from, date_to, reason, created_by)`
- `substitutions(school_id, date, schedule_slot_id, planned_teacher_id, substitute_teacher_id, reason, created_by, status)` — unikal `(school_id, date, schedule_slot_id)`
- `attendance_sessions.teacher_id` = **haqiqatda dars bergan**, `planned_teacher_id` = jadvaldagi

**Yangi ruxsat:** `MANAGE_SUBSTITUTIONS` (zavuch, direktor, admin). Ruxsatlar soni **26** ga chiqadi.

**Qoidalar:**
1. O'qituvchi «yo'q» deb belgilansa, tizim **ta'sirlangan darslar ro'yxatini** ko'rsatadi.
2. `GET /substitutions/suggest?date=&slot=` nomzodlarni **tartiblaydi**: (1) shu soatda bo'sh → (2) shu fanni biladi → (3) shu sinfda ilgari dars bergan → (4) haftalik yuklamasi kam.
3. Almashtirilgan darsda `MARK_ATTENDANCE` huquqi **faqat o'sha sana+slot uchun** almashtiruvchiga o'tadi. Asl o'qituvchi yoza olmaydi. Hammasi `can()` ichida.
4. Almashtiruvchi band bo'lsa — rad. Tekshiruv **tranzaksiyada** + `pg_advisory_xact_lock`. Ikki zavuch bir vaqtda turli odamni qo'ysa — **bittasi yutadi**, ikkinchisi `409`.
5. Botda xabar: almashtiruvchiga, sinf rahbariga (ma'lumot uchun), asl o'qituvchiga.
6. Hisobotda: «O'rniga o'tilgan darslar» (o'qituvchi bo'yicha). Foiz hisobi o'zgarmaydi.
7. Mavjud davomat sessiyasi bor kunga almashtirish qo'yilsa — snapshot **buzilmaydi**, o'zgarish tarixga yoziladi.

**Testlar:** almashtiruvchi yozadi, asl o'qituvchi yozolmaydi (`403`) · band odam rad · parallel 2 ta tayinlash · almashtirish bekor qilinsa huquq qaytadi · begona maktab o'qituvchisi nomzod bo'lmaydi · tarix to'g'ri saqlanadi.

## 21. A2 — Yozuv tarixi va buzilmas audit 🟢

### 21.1 Har bir belgining tarixi
- `attendance_record_history` (**faqat qo'shiladi**): `session_id, student_id, old, new, changed_by, source, at`.
- `source`: `manual | excuse | excuse_request | substitute | import | sync | system`.
- UI: har o'quvchi yonida «🕘 Tarix» → «Anvar A. · 08:52 · Keldi → Yo'q».

### 21.2 Hash zanjirli audit
- `audit_log` ga: `seq` (maktab bo'yicha), `prev_hash`, `hash = sha256(prev_hash || canonical_json(row))`.
- Parallel yozuvlarda **zanjir shoxlanmasin**: maktab bo'yicha `pg_advisory_xact_lock` bilan ketma-ketlashtir.
- **DB darajasida himoya:** ikki rol — `app_rw` va `app_migrator`. `app_rw` uchun `audit_log`, `*_history`, `audit_anchors` jadvallarida **faqat INSERT/SELECT**; `UPDATE`/`DELETE` → `permission denied`.
- `GET /audit/verify` (`VIEW_AUDIT`): zanjirni qayta hisoblaydi, **birinchi uzilgan `seq`** ni qaytaradi.
- **Kunlik «muhr»:** 00:05 da har maktabning oxirgi hash'i `audit_anchors` ga yoziladi va **owner'ga botda** yuboriladi (`hash` + yozuvlar soni).

**Testlar:** superuser bilan bitta qatorni o'zgartir → `verify` aynan shu `seq` ni topadi · `app_rw` bilan `UPDATE audit_log` → xato · **50 parallel yozuv** → zanjir butun · bo'sh maktabda `verify` yashil.

## 22. A3 — PWA va haqiqiy offline sinxronizatsiya 🟢

**Maqsad:** maktabda internet uziladi. Davomat **yo'qolmasin**, **ikki marta yozilmasin**, ziddiyat **yashirin yutilmasin**.

1. **Service Worker:** ilova qobig'ini keshlaydi, versiyali; yangi versiya chiqsa «Yangilash» tugmasi. `manifest.webmanifest` (o'zbekcha nom, ikonalar).
2. **IndexedDB `outbox`** (localStorage emas): `{id (=Idempotency-Key), method, url, body, baseVersion, createdAt, status, attempts}`.
3. **Qayta yuborish:** bir resurs ichida **tartib bilan**, eksponensial kutish (jitter bilan). `4xx` (409 va 429 dan tashqari) — «xato» ro'yxatiga, foydalanuvchi qarori bilan.
4. **Idempotency-Key** qamrovi: `(foydalanuvchi, metod, yo'l)`. 24 soat saqlanadi. **Bir xil kalit + boshqa body → `422`.** Boshqa foydalanuvchi kaliti hech qachon javob qaytarmaydi.
5. **`409` ziddiyat oynasi** (3 tomonlama): «Boshlang'ich · Sizniki · Serverniki» — har o'quvchi uchun: [Meniki] [Serverniki]. Hech narsa jimgina ustiga yozilmaydi.
6. **Indikator** (sarlavhada): `✓ sinxron` · `⏳ 3 ta kutmoqda` · `⚠ 1 ta ziddiyat`.
7. Telegram WebView'da Service Worker ishlashi platformaga qarab farq qiladi. **Sinab ko'r.** Ishlamasa — SW'siz sahifa ichidagi IndexedDB navbati (zaxira). Qarorni «Qarorlar»ga yoz.

**Playwright testlari:** offline'da belgilash → online → **aynan 1 marta** yoziladi · bir so'rov 3 marta takror yuborilsa 1 ta yozuv · sahifa offline'da qayta yuklansa navbat saqlanadi · sinxron o'rtasida tab yopilsa → keyin davom etadi · ziddiyat oqimi (ikki qurilma bir darsga).

---

## 23. B1 — Real vaqt (SSE) 🟡

- **Postgres `LISTEN/NOTIFY`** → `GET /events` (Server-Sent Events). **Redis yo'q.**
- Xabar kichik: faqat `{type, ids}`. Mijoz o'zi qayta so'raydi (huquq tekshiruvi shu orqali).
- `Last-Event-ID` bilan **uzilgandan keyin qayta tiklash**, 25 soniyalik heartbeat, foydalanuvchiga ≤ 3 ulanish.
- **«Hozir» taxtasi** (zavuch, direktor): bugungi darslar kataklari — `belgilanmagan / qoralama / saqlangan`, sonlari bilan, 2 soniyada yangilanadi.
- **Yumshoq qulf (presence):** «Anvar A. hozir belgilayapti» (TTL 60 s). **Bloklamaydi**, faqat 409 ni kamaytiradi.
- Ota-ona faqat **o'z farzandlari** voqealarini oladi.

**Testlar:** boshqa maktab voqeasi **hech qachon** oqimga tushmaydi · ruxsatsiz voqea filtrlanadi · uzilib qayta ulanganda o'tkazib yuborilgan voqea qaytadi · 500 parallel ulanishda xotira barqaror.

## 24. B2 — Chorak, analitika, PDF/XLSX 🟡

**Chorak:** `terms(school_id, year_id, name, date_from, date_to)`. Maktab o'zi kiritadi (sanalarni **qattiq yozma**).

**Tezlik uchun:** `attendance_daily_summary(school_id, date, class_id, subject_id, p, a, l, e)` — davomat saqlanganda **o'sha tranzaksiyada** yangilanadi. Hisobotlar shundan o'qiydi. Sekin so'rovlar uchun `EXPLAIN` natijasi va indekslar hisobotga qo'shiladi.

**Analitika:**
- haftalik trend (sinf/maktab)
- **issiqlik xaritasi:** hafta kuni × dars raqami (qaysi soatda ko'p qoldiriladi)
- parallel sinflar solishtiruvi (5-A va 5-B)
- eng ko'p qoldirilgan fan/dars TOP-10
- chorak bo'yicha taqqoslash

**Eksport:**
- **XLSX** (`exceljs`): varaqlar `Xulosa`, `Batafsil`, `Sinflar`; foiz **jonli formula** bilan; sarlavha qotirilgan.
- **PDF «Davomat bayonnomasi»:** maktab sarlavhasi, davr, jadval, **imzo joylari** (Direktor, Sinf rahbari). Shrift **Noto Sans** (`ʻ`, `ʼ` belgilari bor). Test: PDF matnida `Oʻquvchi`, `Gʻaffor` to'g'ri chiqadi.
- 🔴 Ixtiyoriy: hujjatda **QR** → `GET /verify/<token>` — hujjat tizimdan chiqqani va hash'i. (Qalbakilashtirishga qarshi.)
- Katta eksport **asinxron**: `exports` jadvali (holat), 10 daqiqalik imzolangan havola, fayl 1 soatdan keyin o'chadi. Rate limit.

## 25. B3 — Ko'p tillilik 🟡

- Tillar: **`uz` (lotin, asosiy), `ru`, `uz-Cyrl` (kirill)**.
- `t(key, params)`, JSON lug'atlar. Til: `users.lang`; boshlang'ich qiymat Telegram `language_code` dan (`ru`→ru, `uz`→uz).
- **Kirill avtomatik:** `latnToCyrl()` — `sh→ш, ch→ч, oʻ→ў, gʻ→ғ, ng→нг`, so'z boshidagi `e→э`, `ye/yo/yu/ya`, istisnolar lug'ati. **Faqat interfeys matni uchun, ismlar uchun emas.**
- Bot xabarlari ham tilga qarab (`parent_contacts.lang`). Sana va oy nomlari tilga mos.
- **Testlar:** hamma kalit **hamma tilda** bor (yo'q bo'lsa CI qizaradi) · kodda **qattiq yozilgan o'zbekcha matn yo'q** (grep testi) · 30 ta so'zlik kirill «oltin» testi · sana formati.

## 26. B5 — Maxfiylik va ma'lumot huquqlari 🟡

- **Ota-ona «Mening ma'lumotlarim»:** o'ziga ko'rinadigan ma'lumot — JSON va PDF.
- **O'chirish so'rovi:** `erasure_requests` → direktor tasdiqlaydi → **anonimlash**: ism → `O'quvchi #4821`, telefon/Telegram/izoh o'chadi, **statistika qoladi**.
- **Saqlash muddati:** bitiruvchi/arxiv o'quvchi N yildan keyin (sozlama, default 3) anonimlanadi. Avval **quruq yurgizish** (nima o'zgarishini ko'rsatadi), keyin tasdiq.
- **Rozilik versiyasi:** `consents(version, text_hash, accepted_at)`. Matn o'zgarsa — qayta rozilik.
- **README «Joylashuv va qonun» bo'limi:** O'zbekistonda shaxsga doir ma'lumotlar to'g'risidagi qonun talablari (jumladan, fuqarolar ma'lumotini mamlakat ichidagi serverda saqlash talabi bor-yo'qligi) **huquqshunos bilan tekshirilsin** deb yoz. O'zing «talab shunday» deb **da'vo qilma**.
- **Test:** anonimlashdan keyin **hamma matn ustunlarini skanerla** — asl ism va telefon **hech qayerda qolmasin** (loglar, history, outbox, audit payload ham).

## 27. B4 — Kuzatuvchanlik, CI/CD, zaxira mashqi, yuklama 🟡

**Kuzatuvchanlik**
- `pino` logi, **redaction**: telefon, `initData`, `chat_id`, token logga tushmaydi. **Test:** E2E dan keyin yig'ilgan loglarni `+998\d{9}` va `hash=` ga skanerla — 0 ta.
- `/healthz` (jonli) va `/readyz` (DB + bot).
- `/metrics` (Prometheus, **himoyalangan**): outbox navbat uzunligi, yuborish kechikishi, `429` soni, kirish muvaffaqiyat/xato, `409` ulushi, SSE ulanishlari.
- `docker compose --profile monitoring` (Prometheus + Grafana, tayyor dashboard va **ogohlantirish qoidalari fayli**).

**CI/CD** (`.github/workflows/ci.yml`)
- lint · typecheck · unit · integration (testcontainers) · E2E · `npm audit` · Docker tasviri skani (Trivy) · SBOM.
- Docker: ko'p bosqichli, **root bo'lmagan** foydalanuvchi, faqat o'qiladigan fayl tizimi.
- `deploy.sh`: **avval migratsiya, keyin almashtirish**; muvaffaqiyatsiz bo'lsa avtomatik orqaga.

**Zaxira mashqi**
- `pg_dump` → **`age`** bilan shifrlash. Saqlash: 7 kunlik / 4 haftalik / 6 oylik.
- **`scripts/restore-drill.sh`:** zaxirani **vaqtinchalik bazaga** tiklaydi, `count(*)` tekshiradi, `audit/verify` ni ishga tushiradi. README'da **RPO va RTO** yoz (🔴 ixtiyoriy: WAL arxivi bilan RPO ≤ 5 daqiqa).

**Yuklama (k6)**
- 5 000 o'quvchi, 200 o'qituvchi, **soat 08:00 cho'qqisi** (hamma bir vaqtda davomat saqlaydi).
- Chegara: **p95 < 400 ms**, xato < 0.1%.
- 3 000 ta Telegram xabar navbati **25/s** dan oshmay, `429` bo'ronisiz yuboriladi.

## 28. C1 — Jadval generatori 🔴

### 28.1 Avval: jadval versiyalari
`schedule_versions(school_id, effective_from, name)`. `schedule_slots` shu versiyaga tegishli. Davomat sessiyasi **o'sha sanada amal qilgan versiya** slotiga bog'lanadi. Yangi jadval qo'llanganda **o'tgan sanalar tarixi buzilmaydi**.

### 28.2 Kirish ma'lumoti
- `assignments.hours_per_week` (sinf × fan uchun soat)
- `teacher_unavailable(teacher_id, day, slot_no)`
- `subject_rules(subject_id, max_per_day, no_last_slot, prefer_morning, allow_double)`
- `class_limits(class_id, max_lessons_per_day)`

### 28.3 Cheklovlar
**Qat'iy (buzilmasin):** o'qituvchi bir slotda bitta sinfda · sinfda bir slotda bitta dars · soatlar aniq · bo'sh bo'lmagan slot · kuniga maksimum.
**Yumshoq (ball bilan):** o'qituvchi «oynalari» (bo'sh darslar) kam · og'ir fanlar erta · bir fan ketma-ket kunlarda emas, tekis taqsimlangan · kun yuklamasi muvozanatli.

### 28.4 Algoritm
- Worker thread'da. **Tasodifiy urug'** (`seed`) bilan **takrorlanadigan** natija. Vaqt chegarasi (default 20 s).
- Qurish: eng cheklangan darsdan boshlab, orqaga qaytish (backtracking) + oldinga tekshiruv; keyin yaxshilash (simulated annealing, almashtirish harakatlari).
- Natija: `{timetable, hardViolations[], softScore, breakdown}`.
- **Mumkin bo'lmasa — tushuntir:** «5-A Fizika: 3 soat kerak, lekin Aliyevda faqat 2 ta bo'sh slot bor».

### 28.5 UI
«Jadval generatsiyasi» ustasi: cheklovlar → ishga tushirish (progress SSE orqali) → **joriy jadval bilan farq** ko'rinishi → qo'llash (bitta tranzaksiya, `effective_from` bilan).

### 28.6 Testlar
- `scripts/gen-demo-school.ts`: **12 sinf, 28 o'qituvchi, 15 fan, 6 kun, 7 dars** → CI da **< 30 s**, **0 qat'iy buzilish**.
- **Xossa testi** (`fast-check`): tasodifiy kichik misollarda qaytgan har qanday jadval qat'iy cheklovlarni **buzmaydi**.
- Mumkin bo'lmagan misolda tushuntirish qaytadi.
- Qo'llangandan keyin eski sanalar davomati **o'zgarmagan**.

## 29. C2 — Hududiy kuzatuvchi 🔴

**Holat:** tuman ta'lim bo'limi inspektori 40 ta maktabni ko'rishi kerak — lekin **hech bir o'quvchining ismini emas**.

- `school_groups` (tuman/hudud), `school_group_members`. Lavozim `district_observer`, ruxsat `VIEW_DISTRICT` (**27** ta ruxsat).
- **Qatorlarni emas, faqat agregatlarni** qaytaradigan SQL funksiyalar (`SECURITY DEFINER`, tor huquq). Natijada **ism, telefon, o'quvchi ID yo'q**.
- Panel: maktablar jadvali (foiz, davomat olinmagan darslar), 30 kunlik trend, **anomaliya** (maktab foizi hudud o'rtachasidan 2σ past), hisobot topshirmagan maktablar.
- **RLS testi:** `district_observer` `SELECT * FROM students` qilsa **0 qator**. Boshqa hududning maktabi ko'rinmaydi.
- **Bahsli qaror:** maktab direktori o'z maktabining hududiy panelda ko'rinishini o'chira oladimi? Buni o'zing hal qilma — `STATUS.md` ga «foydalanuvchidan so'ralsin» deb yoz. Default: **o'chira olmaydi**, faqat owner boshqaradi.

---

## 30. M13 — Qizil jamoa (hujum testlari) 🟢

**O'zing hujumchi bo'l.** `tests/redteam/` da skriptlar yoz. **Har bir hujum muvaffaqiyatsiz bo'lishi va hech qanday ma'lumot sizdirmasligi kerak.** Natija jadvali hisobotga kiradi.

| № | Hujum | Kutilgan natija |
|---|---|---|
| 1 | **IDOR:** OpenAPI dan **hamma** `:id` li endpointlarni avtomatik aylanib, boshqa maktab ID'sini yubor | `404` (mavjudligini ham oshkor qilmasin) |
| 2 | **Mass assignment:** body ga `school_id, role, position_id, status, created_by` qo'sh | e'tiborga olinmaydi / `422` |
| 3 | `initData` takrori (eskirgan), boshqa token bilan imzolangan, `user.id` o'zgartirilgan | `401` |
| 4 | Forward qilingan **begona kontakt** (`contact.user_id ≠ from.id`) | rad |
| 5 | Qurbonning ro'yxatdagi raqamini egallashga urinish | kirish yo'q |
| 6 | Idempotency-Key'ni **boshqa foydalanuvchi/maktab** kaliti bilan takrorlash | javob sizmaydi |
| 7 | **SQL injection:** qidiruv, `sort`, `order_by`, filtr, CSV parametrlari | `order_by` oq ro'yxat, hammasi parametrli |
| 8 | **Saqlangan XSS:** ism, izoh, maktab/fan nomi (`<img src=x onerror=…>`) | UI, PDF, XLSX, botda **escape** (bot `parse_mode=HTML` bo'lsa ham) |
| 9 | CSV/XLSX **formula** (`=HYPERLINK`, `@`, tab, CR) | zararsizlantiriladi |
| 10 | **RLS aylanib o'tish:** so'rov ichidan `app.school_id` ni o'zgartirish; **ulanish puli ifloslanishi** (pul hajmi = 1 bilan tekshir) | `SET LOCAL` har tranzaksiyada tiklanadi |
| 11 | Parallel `POST/DELETE excuse` poygasi | yaxlitlik saqlanadi |
| 12 | **50 parallel** `PUT sessions` | aynan 1 ta yutadi, qolgani `409` |
| 13 | SSE: boshqa maktab / begona farzand kanaliga obuna | voqea kelmaydi |
| 14 | Bot `callback_data` soxtalash: boshqa arizaning ID'sini yuborish | server reviewer ruxsati va qamrovni tekshiradi |
| 15 | Webhook'ga `secret_token`siz POST | `401` |
| 16 | `startapp=student_123` deep link | ruxsat tekshiriladi |
| 17 | Lavozim o'zgargandan keyin **eski sessiya** | darhol bekor |
| 18 | `X-Forwarded-For` soxtalab rate limit aylanish | `trustProxy` faqat Caddy |
| 19 | Katta body, chuqur JSON, `/import` da zip-bomba | limit (JSON 5 MB) |
| 20 | Import ichida `__proto__`, zararli rang, katta ID | rad |
| 21 | Eksport yuklashda yo'l aylanish (`../`) | rad |
| 22 | Ota-ona ketma-ket `GET /students/:id` bilan **bolalarni sanash** | faqat o'z farzandlari |
| 23 | O'qituvchi hisobot filtri (`sid, tid, stid`) orqali begona sinf | `403` / bo'sh |
| 24 | App roli bilan `UPDATE audit_log` | `permission denied` |
| 25 | O'qituvchi **o'zini** almashtiruvchi qilib belgilash | `403` |
| 26 | Ariza: begona farzandga · 14 kundan ortiq · kuniga 3 tadan ortiq | rad |
| 27 | Ruxsati yo'q foydalanuvchi menyu yashirin sahifa API'sini to'g'ridan chaqiradi | `403` |
| 28 | **Guruh orqali sizdirish:** botni guruhga qo'shib `/start` yuborish | javob yo'q, bot chiqib ketadi |
| 29 | **Egasi sifatida RLS aylanib o'tish:** ilova roli jadval egasi yoki `BYPASSRLS` bo'lsa | server ishga tushmaydi |
| 30 | `join_code` va taklif kodini **brute-force** | rate limit va blok |
| 31 | **Clickjacking:** boshqa saytdan iframe ichida ochish | `frame-ancestors` rad etadi |

## 31. Mutatsion va xossa testlari 🟢

**Mutatsion test** (`Stryker`) — quyidagi modullarda **mutatsion ball ≥ 85%**:
`can()` · `menu.ts` · `initData` tekshiruvi · telefon normallashtirish · foiz hisobi · sababli/bekor qilish mantig'i · `normalizeUz` · berish qoidalari (5.5).

**Xossa testlari** (`fast-check`):

| Xossa | Ma'nosi |
|---|---|
| `norm(norm(x)) == norm(x)` | normallashtirish idempotent |
| `excuse` keyin `undo` | qo'lda qo'yilgan `e` **bundan mustasno**, holat avvalgiga qaytadi |
| foiz ∈ [0, 100] | va `a` ni kamaytirsang foiz **kamaymaydi** |
| rol × amal | har ruxsat qo'shilganda hech qaysi **boshqa** lavozim ruxsati o'zgarmaydi |
| berish qoidasi | hech kim o'zidan **kuchli ruxsat** bera olmaydi |
| jadval | generatordan chiqqan har qanday jadval qat'iy cheklovlarni buzmaydi |

**Qamrov:** server yadrosida (`auth, can, attendance, excuse, outbox`) satr qamrovi **≥ 85%**. Raqam hisobotga.

## 32. MAX tugallash mezoni va hisobot

**Har modul oxirida hisobot (qisqa):**

| Maydon | Mazmuni |
|---|---|
| Modul | kod + nom |
| Holat | ✅ tugadi / 🟡 qisman / ❌ tashlandi (sababi) |
| Testlar | o'tgan/jami (son bilan) |
| **Sinalmadi** | nimani sina olmading |
| Regressiya | eski testlar: yashil/qizil |
| Keyingi qadam | menga nima kerak |

**«MAX tugadi» deyish uchun:**
- [ ] M7 mezonlari (15-bo'lim) **hali ham** yashil
- [ ] A0–A3 to'liq: almashtirish ishlaydi, audit zanjiri `verify` dan o'tadi, offline sinxron Playwright'da isbotlangan
- [ ] B1, B2, B3, B5, B4 — yoki tashlangan bo'lsa **sababi `STATUS.md` da**
- [ ] C1, C2 — bajarilgan yoki **ochiq aytib tashlangan**
- [ ] Qizil jamoa jadvali: **31 hujumning hammasi** muvaffaqiyatsiz (ya'ni himoya ishladi) yoki topilgan teshik **tuzatilgan va testga aylangan**
- [ ] Mutatsion ball ≥ 85%, qamrov ≥ 85%
- [ ] Yuklama testi raqamlari hisobotda (p95, xato %)
- [ ] `restore-drill.sh` haqiqiy zaxirada **bir marta ishga tushirilgan**
- [ ] `STATUS.md` va README yangilangan, repoda sir yo'q

**Halol qoida (yana bir bor):** bajarmagan narsani «bajardim» dema. Tashlangan modul — kamchilik emas. **Yolg'on hisobot — kamchilik.**
