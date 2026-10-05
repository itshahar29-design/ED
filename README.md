# EduMemory — Ko'p maktabli davomat boshqaruv tizimi (v2)

EduMemory — maktablar uchun mo'ljallangan, ko'p foydalanuvchili, xavfsiz va real vaqtda ishlovchi zamonaviy davomat tizimi backend platformasi. Tizim har bir maktab ma'lumotlarini alohida izolyatsiyada saqlaydi, bir vaqtda bir nechta o'qituvchi davomat olishini ziddiyatsiz ta'minlaydi va ota-onalarga Telegram orqali farzandining davomati haqida avtomatik xabar yuboradi.

---

## 1. Texnologiyalar steki

- **Server platformasi**: Node.js 20+ LTS, TypeScript
- **Web freymvork**: Fastify (yuqori tezlik, past resurs sarfi)
- **Ma'lumotlar bazasi**: PostgreSQL 16 (kompozit kalitlar va Row Level Security — RLS himoyasi)
- **Validatsiya**: Zod (qat'iy sxemalar)
- **Parollarni shifrlash**: Argon2id (eng xavfsiz zamonaviy standart)
- **Sessiyalar**: Server bazasida saqlanuvchi sessiyalar + `httpOnly`, `Secure`, `SameSite=Lax` cookie
- **Telegram Bot**: grammY freymvorki
- **Testlash**: Vitest + PostgreSQL 16 WebAssembly (`@electric-sql/pglite`) — haqiqiy SQL va RLS siyosatlari bilan
- **Konteynerizatsiya**: Docker & Docker Compose

---

## 2. Tizim talablari va Ishga tushirish

Hech qanday murakkab dasturlarni o'rnatish shart emas. Faqatgina kompyuterda **Docker Desktop** (yoki Docker Engine) o'rnatilgan bo'lsa kifoya.

### 2.1. Bir buyruq bilan ishga tushirish (Docker Compose)

Terminal yoki buyruqlar qatorida loyiha papkasiga kiring va quyidagi buyruqni bering:

```bash
docker compose up -d --build
```

Bunda:
1. PostgreSQL 16 ma'lumotlar bazasi avtomatik yaratiladi va ishga tushadi.
2. Barcha jadvallar va RLS xavfsizlik siyosatlari bazada yaratiladi.
3. Dasturiy ta'minot kompilyatsiya qilinadi va `http://localhost:3000` manzilida ochiladi.
4. Foydalanuvchi interfeysi (`index.html`) ham to'g'ridan-to'g'ri serverdan taqdim etiladi.

### 2.2. Dastur to'xtatish va qayta ishga tushirish

```bash
# To'xtatish:
docker compose down

# Qayta ishga tushirish:
docker compose up -d
```

### 2.3. Ishlab chiquvchilar (Developer) rejimi:

Agar dasturchi sifatida Node.js muhitida ishlatmoqchi bo'lsangiz:

```bash
npm install
npm run dev
```

Testlarni ishga tushirish:
```bash
npm test
```

---

## 3. Dastlabki kirish va Tizimdan foydalanish

Tizim birinchi marta ishga tushganda platforma egasi (Superuser/Owner) hisobi avtomatik yaratiladi:
- **Kirish manzili**: `http://localhost:3000`
- **Login**: `owner`
- **Boshlang'ich parol**: `Owner123456!`

> [!IMPORTANT]
> Birinchi marta tizimga kirilganda xavfsizlik yuzasidan yangi shaxsiy parol o'rnatish majburiydir!

### 3.1. Maktab va Direktor yaratish
1. Owner hisobida kiring va yuqori menyudagi **«Maktablar»** sahifasiga o'ting.
2. Maktab nomi (masalan, *«5-sonli umumta'lim maktabi»*) va direktor foydalanuvchi nomini (masalan, *«dir_5»*) kiriting.
3. Tizim ekranda direktor uchun bir martalik **vaqtinchalik parol**ni ko'rsatadi. Ushbu parolni saqlab oling.
4. Tizimdan chiqib (`Chiqish` tugmasi), yangi direktor hisobiga kiring. Birinchi kirishda direktor yangi shaxsiy parol qo'yadi.

### 3.2. Maktab ma'lumotlarini to'ldirish
1. **O'quv yili**: Joriy o'quv yilini kiriting (masalan, *2026-2027*).
2. **Fanlar**: Dars beriladigan fanlarni qo'shing.
3. **O'qituvchilar**: O'qituvchilarni kiritib, ularga login hisobi oching (**«Foydalanuvchilar»** sahifasida).
4. **Sinflar**: Yangi sinflar (masalan, *7-A*, *9-B*) oching va sinf rahbarini tayinlang.
5. **O'quvchilar**: O'quvchilarni yakka holda yoki **«Ommaviy kiritish (Bulk)»** oynasida ro'yxat shaklida bitta tugma bilan yuklang.
6. **Biriktirish va Dars jadvali**: O'qituvchilarni fan va sinflarga biriktiring, so'ng haftalik dars jadvaliga darslarni joylashtiring.

### 3.3. Davomat olish va Optimistic Locking
- O'qituvchi o'ziga biriktirilgan darslarga kirib, o'quvchilar davomatini belgilaydi (`p` - keldi, `a` - kelmadi, `l` - kechikdi, `e` - sababli).
- Davomat har bir harakatda avtomatik saqlanadi (`version` ustuni orqali nazorat qilinadi). Agar ikki o'qituvchi yoki administrator bir vaqtda tahrirlasa, versiya to'qnashuvi aniqlanadi (HTTP 409) va ma'lumotlar yo'qolishi oldi olinadi.
- Internet uzilib qolgan taqdirda, o'qituvchi qo'ygan davomat belgisi brauzerda vaqtinchalik navbatda saqlanadi va internet paydo bo'lishi bilan serverga avtomatik yetkaziladi.

### 3.4. Sinf rahbari tomonidan dars qoldirganlarni sababli qilish
- Sinf rahbari, direktor yoki admin davomat bo'limida **«Sababli qilish»** tugmasini bosishi mumkin.
- Belgilangan sabab (*Kasallik*, *Oilaviy sabab*, *Tadbir/musobaqa*, *Boshqa*) bilan o'quvchining o'sha kundagi barcha `a` (kelmadi) darslari bir zumda `e` (sababli) holatiga o'tkaziladi.
- Agar sabab asossiz deb topilsa, **«Bekor qilish»** orqali faqat avtomatik sababli qilingan darslar yana `a` ga qaytariladi (qo'lda qo'yilgan sababli belgilariga tegilmaydi).

---

## 4. Telegram Bot orqali Ota-onalarga xabar yuborish

EduMemory ota-onalarga har darsdan so'ng yoki kun oxirida (soat 15:00 da) farzandining davomati haqida ixcham, tushunarli hisobot xabarini yuboradi.

### 4.1. BotFather orqali bot yaratish
1. Telegramda [@BotFather](https://t.me/BotFather) botini oching.
2. `/newbot` buyrug'ini yuboring va botingizga nom hamda username bering (masalan: `MeningMaktabimBot`).
3. BotFather bergan maxfiy tokenni oling (masalan, `7123456789:AAH...`).
4. Loyiha papkasidagi `.env` faylini ochib, quyidagi qatorlarni to'ldiring:
   ```env
   TELEGRAM_BOT_TOKEN=7123456789:AAH...
   TELEGRAM_BOT_USERNAME=MeningMaktabimBot
   ```
5. Serverni qayta ishga tushiring: `docker compose up -d`

### 4.2. Ota-onani tizimga ulash tartibi
Telegram qoidalariga ko'ra bot foydalanuvchiga birinchi bo'lib yozolmaydi. Shu sababli tizimda xavfsiz taklif mexanizmi joriy etilgan:
1. Maktab ma'muri o'quvchi ma'lumotlarida ota-ona telefon raqamini kiritadi.
2. O'quvchi kartochkasida **«Havola yaratish»** tugmasi bosiladi. Tizim bir martalik taklif havolasini yaratadi (masalan: `https://t.me/MeningMaktabimBot?start=inv_abc123`). Havola 7 kun amal qiladi.
3. Ota-ona havolani ochib, botda **«Start»** tugmasini bosadi va o'z telefon kontaktini yuboradi (`📱 Kontaktni yuborish`).
4. **Tekshiruv**:
   - Agar ota-onaning Telegram raqami maktab bazasidagi raqam bilan to'liq mos kelsa, darhol bog'lanadi va xabarnomalar yoqiladi.
   - Agar raqam boshqa bo'lsa, xavfsizlik yuzasidan so'rov maktab ma'muriyatiga tasdiqlash uchun yuboriladi (`pending` holatda). Administrator uni tasdiqlagach xabarnomalar faollashadi.
5. Ota-ona istalgan paytda botga `/stop` deb yozib, xabarnomalarni to'xtatishi mumkin.

### 4.3. Yuboriladigan xabar ko'rinishi
Farzand dars qoldirganda:
```
📚 Assalomu alaykum! Aliyev Valijon (7-A) 5-oktyabr kuni:
❌ 2-dars Matematika — kelmadi
⏰ 3-dars Fizika — kechikdi
ℹ️ 4-dars Tarix — sababli qoldirdi
Qolgan darslarda qatnashdi ✅
```
Barcha darslarga qatnashganda:
```
📚 Assalomu alaykum! Aliyev Valijon (7-A) 5-oktyabr kuni:
Barcha darslarda (5 ta) qatnashdi ✅
```

---

## 5. Zaxira nusxa olish (Backup) va Qayta tiklash (Restore)

Bolalar davomati va maktab hisoboti yo'qolib ketmasligi uchun tizim AES-256 shifrlash kaliti bilan zaxiralash imkoniyatiga ega.

### 5.1. Linux / macOS muhitida:

**Zaxira olish (Backup):**
```bash
chmod +x ./scripts/backup.sh
./scripts/backup.sh
```
Fayl `./backups/edumemory_backup_YYYYMMDD_HHMMSS.sql.gz.enc` nomida shifrlangan holatda saqlanadi.

**Zaxiradan qayta tiklash (Restore):**
```bash
chmod +x ./scripts/restore.sh
./scripts/restore.sh ./backups/edumemory_backup_20261005_120000.sql.gz.enc
```

**Kunlik avtomatik zaxiralashni sozlash (Cron):**
Har kuni kechasi soat 02:00 da avtomatik zaxira olish uchun serverda `crontab -e` ga quyidagi qatorni qo'shing:
```cron
0 2 * * * cd /yo'l/edumemory && ./scripts/backup.sh >> ./backups/backup.log 2>&1
```

### 5.2. Windows (PowerShell) muhitida:

**Zaxira olish:**
```powershell
.\scripts\backup.ps1
```

**Zaxiradan qayta tiklash:**
```powershell
.\scripts\restore.ps1 -BackupFile .\backups\edumemory_backup_20261005_120000.sql.gz.enc
```

---

## 6. Xavfsizlik va Ma'lumotlar himoyasi

1. **Ko'p maktabli (Multi-tenant) xavfsizlik**: Har bir jadvalda `school_id` mavjud. Barcha tashqi kalitlar kompozit `(school_id, id)` shaklida yaratilgan bo'lib, bir maktab boshqa maktab ma'lumotlariga bog'lana olmaydi.
2. **PostgreSQL Row Level Security (RLS)**: Dasturiy ta'minotda xato yuz bersa ham, ma'lumotlar bazasi darajasida RLS boshqa maktab yozuvlarini ko'rish yoki tahrirlashni butunlay taqiqlaydi.
3. **Bolalar shaxsiy ma'lumotlari daxlsizligi**: Tizim loglarida o'quvchilarning ismlari yoki telefon raqamlari saqlanmaydi. O'qituvchilar interfeysida ota-onalarning Telegram `chat_id` raqamlari ko'rsatilmaydi.
4. **Parol xavfsizligi**: Barcha parollar zamonaviy xalqaro xavfsizlik standarti — `argon2id` algoritmi bilan shifrlanadi.
5. **Brute-force himoyasi**: 5 marta ketma-ket xato parol kiritilsa, foydalanuvchi hisobi avtomatik ravishda 15 daqiqaga bloklanadi.
6. **CSV Formula-Injection himoyasi**: Hisobotlarni Excel yoki boshqa dasturlarga eksport qilganda, nomlar va matnlar ichidagi `=`, `+`, `-`, `@` belgilarining oldiga `'` belgisi qo'yiladi. Bu orqali zararli formulalar ishga tushishi oldi olingan.
7. **Production HTTPS (SSL)**: Jonli serverda tizimni Caddy yoki Nginx orqali ishlatish tavsiya etiladi.
   *Caddyfile namunasi:*
   ```caddyfile
   edumemory.maktab.uz {
       reverse_proxy localhost:3000
   }
   ```

---

## 7. Qarorlar (Decisions)

1. **ID generatsiyasi**: Har bir maktab uchun frontenddagi moslikni va oddiy raqamlanishni saqlash maqsadida jadvallarda `id SERIAL/BIGSERIAL` ishlatiladi, global xavfsizlik va izolyatsiya esa `(school_id, id)` kompozit kaliti hamda PostgreSQL RLS orqali ta'minlanadi.
2. **PostgreSQL RLS implementatsiyasi**: `SET LOCAL app.school_id = '<id>'` tranzaksiya darajasida o'rnatiladi. Platforma owneri (superuser) yordam rejimida kirganda ham maqsadli maktab ID'si o'rnatiladi va har bir bunday kirish `audit_log`ga muhrlanadi.
3. **Optimistic Locking**: Davomat sessiyalarida `version` butun sonli ustun bo'lib, har bir o'zgartirishda `+1` qilinadi. Agar mijoz yuborgan versiya bazadagidan farq qilsa, HTTP 409 qaytariladi va joriy ma'lumotlar foydalanuvchiga taqdim etiladi.
4. **Vaqt mintaqasi (Timezone)**: Barcha sanalar va "bugun" hisobi serverda qat'iy `Asia/Tashkent` vaqt mintaqasi bo'yicha `YYYY-MM-DD` DATE formatida hisoblanadi.
5. **Eski ma'lumotlar bilan 100% moslik**: GET `/api/v1/bootstrap` mavjud `index.html` kutayotgan barcha strukturalarni (`school`, `years`, `subjects`, `teachers`, `classes`, `students`, `assigns`, `sched`, `ses`, `excuse`, `perm`, `sent`) to'liq qaytaradi.
6. **Test muhiti**: Testlar haqiqiy PostgreSQL SQL va RLS siyosatlarini tekshirish uchun nol tashqi bog'liqlik bilan ishlaydigan PostgreSQL 16 WebAssembly (`@electric-sql/pglite`) orqali to'liq sinovdan o'tkaziladi.
7. **Login bloklash siyosati**: 5 ta ketma-ket muvaffaqiyatsiz login urinishidan so'ng hisob 15 daqiqaga bloklanadi va `audit_log`ga yoziladi.
8. **RLS ijrosi**: PostgreSQL superuser RLS'ni aylanib o'tmasligi uchun tenant tranzaksiyalarida `SET LOCAL ROLE edumemory_app; SET LOCAL app.school_id = ...` ishlatiladi.
9. **Jadval va biriktirishlar yaxlitligi**: Biriktirish (`assignments`) olib tashlanganda, jadvaldagi barcha bog'liq darslar tozalanadi, lekin o'tilgan davomat tarixi to'liq saqlanib qoladi (`attendance_sessions` dagi snapshot o'zgarmaydi).
10. **Idempotency va takroriy so'rovlar**: `Idempotency-Key` sarlavhasi yordamida tarmoq uzilishlarida qayta yuborilgan so'rovlar bazada takrorlanmaydi, oldingi saqlangan javob keshdan qaytariladi.
11. **CSV formula-injection himoyasi**: Eksport qilingan CSV fayllarda katak qiymati `=`, `+`, `-`, `@` belgilari bilan boshlansa, Excel va elektron jadvallarda formula sifatida ishga tushib ketmasligi uchun oldiga `'` belgisi qo'yiladi.
12. **Frontend ma'lumotlar oqimi**: Butun JSON'ni serverga bitta PUT qilish o'rniga har bir amal alohida REST API endpointga o'tkazildi (`/classes`, `/students`, `/teachers`, `/subjects`, `/schedule`, `/assignments`, `/attendance/sessions`, `/attendance/excuse`, `/settings`, `/permissions`). Demo rejimdagi rol tanlash faqat `?dev=1` parametrida ko'rsatiladi.
13. **Offline davomat navbati**: Tarmoq uzilganda davomat belgilari brauzer xotirasiga (`edm_offline_queue`) saqlanadi va internet tiklanganda (`online` hodisasida) avtomatik serverga yuboriladi (ziddiyat bo'lsa 409 xabari bildiriladi).
14. **Zaxira nusxalarini shifrlash**: Zaxira nusxalar AES-256-CBC algoritmi va PBKDF2 kalit iteratsiyasi bilan shifrlanadi, zaxira fayllari o'g'irlangan taqdirda ham bolalar ma'lumotlari ochilmaydi.
