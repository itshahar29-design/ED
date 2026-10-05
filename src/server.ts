import { buildApp } from './app.js';
import { env } from './config/env.js';
import { initBot } from './modules/telegram/bot.js';

async function start() {
  try {
    const app = await buildApp();
    await app.listen({ port: env.PORT, host: env.HOST });
    console.log(`🚀 EduMemory Backend ishga tushdi: http://${env.HOST}:${env.PORT}`);

    // Telegram Botni ishga tushirish (agar token ko'rsatilgan bo'lsa)
    if (env.TELEGRAM_BOT_TOKEN) {
      const db = (app as any).db;
      const bot = initBot(db);
      if (bot) {
        bot.start({
          onStart: (botInfo) => {
            console.log(`🤖 Telegram bot ishga tushdi: @${botInfo.username}`);
          },
        });

        const stopAll = async () => {
          console.log('\nTo\'xtatilmoqda...');
          await bot.stop();
          await app.close();
          process.exit(0);
        };

        process.once('SIGINT', stopAll);
        process.once('SIGTERM', stopAll);
      }
    }

    // 24/7 Keep-Alive (Render yoki tashqi hostingda uxlab qolmaslik mexanizmi)
    const keepAliveUrl = process.env.RENDER_EXTERNAL_URL || process.env.KEEP_ALIVE_URL;
    if (keepAliveUrl) {
      const pingUrl = `${keepAliveUrl.replace(/\/$/, '')}/api/v1/health`;
      console.log(`⏱️ 24/7 Keep-Alive yoqildi: ${pingUrl}`);
      setInterval(async () => {
        try {
          await fetch(pingUrl);
        } catch {
          // xatolik bo'lsa server to'xtamasligi uchun
        }
      }, 10 * 60 * 1000); // har 10 daqiqada o'zini o'zi uyg'otib turadi
    }
  } catch (err) {
    console.error('Serverni ishga tushirishda xatolik:', err);
    process.exit(1);
  }
}

start();
