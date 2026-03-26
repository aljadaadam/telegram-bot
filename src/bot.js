require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const { detectPlatform, extractUrl, getVideoDownload, downloadVideoBuffer, cleanupFile } = require('./downloader');
const { trackUser, recordDownload, getStats, getAllUserIds, getUserCount } = require('./tracker');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(id => Number(id.trim())).filter(Boolean);

if (!BOT_TOKEN || BOT_TOKEN === 'your_telegram_bot_token_here') {
  console.error('ERROR: Set BOT_TOKEN in .env file');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Graceful shutdown
const shutdown = (signal) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  bot.stopPolling().then(() => {
    console.log('Bot polling stopped.');
    process.exit(0);
  });
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});

const PLATFORM_NAMES = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  twitter: 'Twitter / X',
  youtube: 'YouTube',
  facebook: 'Facebook',
  pinterest: 'Pinterest',
  snapchat: 'Snapchat',
  threads: 'Threads',
  likee: 'Likee',
};

const SUPPORTED_LIST = Object.values(PLATFORM_NAMES).join('\n• ');

// /start command
bot.onText(/\/start/, (msg) => {
  trackUser(msg);

  const welcomeMessage = `
مرحباً! 👋

أنا بوت تحميل فيديوهات من السوشل ميديا بدون علامة مائية 🎬

📌 المنصات المدعومة:
• ${SUPPORTED_LIST}

📝 طريقة الاستخدام:
أرسل رابط الفيديو مباشرة وسأقوم بتحميله لك!

مثال:
https://www.tiktok.com/@user/video/123456
  `.trim();

  bot.sendMessage(msg.chat.id, welcomeMessage);
});

// /help command
bot.onText(/\/help/, (msg) => {
  const helpMessage = `
📖 المساعدة:

1️⃣ انسخ رابط الفيديو من أي منصة مدعومة
2️⃣ الصقه هنا في المحادثة
3️⃣ انتظر قليلاً وسيصلك الفيديو

⚠️ ملاحظات:
• الحد الأقصى لحجم الفيديو: 50 ميجابايت
• بعض الفيديوهات الخاصة لا يمكن تحميلها
• تأكد أن الرابط صحيح وكامل

📌 المنصات المدعومة:
• ${SUPPORTED_LIST}
  `.trim();

  bot.sendMessage(msg.chat.id, helpMessage);
});

// Helper: check if user is admin
function isAdmin(userId) {
  return ADMIN_IDS.includes(userId);
}

// /myid - Get your Telegram user ID
bot.onText(/\/myid/, (msg) => {
  bot.sendMessage(msg.chat.id, `🆔 الآي دي الخاص بك: \`${msg.from.id}\``, { parse_mode: 'Markdown' });
});

// /admin - Admin dashboard
bot.onText(/\/admin/, (msg) => {
  if (!isAdmin(msg.from.id)) return;

  const s = getStats();

  const platformLines = s.platformStats.map(([name, count]) => `  ${name}: ${count}`).join('\n') || '  لا توجد بيانات';
  const dailyLines = s.last7Days.map(d => `  ${d.date}: ${d.count}`).join('\n');
  const topLines = s.topUsers.map((u, i) =>
    `  ${i + 1}. ${u.firstName}${u.username ? ' @' + u.username : ''} — ${u.downloads} تحميل`
  ).join('\n') || '  لا يوجد';

  const text = `
📊 لوحة تحكم الأدمن

👥 إجمالي المستخدمين: ${s.totalUsers}
👤 النشطين اليوم: ${s.activeToday}

📥 إجمالي التحميلات: ${s.totalDownloads}
📥 تحميلات اليوم: ${s.todayDownloads}

📱 حسب المنصة:
${platformLines}

📈 آخر 7 أيام:
${dailyLines}

🏆 أكثر المستخدمين تحميلاً:
${topLines}

⚙️ أوامر الأدمن:
/admin — الإحصائيات
/broadcast <رسالة> — إرسال رسالة لجميع المستخدمين
/users — عدد المستخدمين
  `.trim();

  bot.sendMessage(msg.chat.id, text);
});

// /users - Quick user count
bot.onText(/\/users/, (msg) => {
  if (!isAdmin(msg.from.id)) return;
  bot.sendMessage(msg.chat.id, `👥 عدد المستخدمين: ${getUserCount()}`);
});

// /broadcast - Send message to all users
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;

  const broadcastText = match[1];
  const userIds = getAllUserIds();
  let sent = 0;
  let failed = 0;

  const statusMsg = await bot.sendMessage(msg.chat.id, `📤 جاري الإرسال لـ ${userIds.length} مستخدم...`);

  for (const userId of userIds) {
    try {
      await bot.sendMessage(userId, broadcastText);
      sent++;
    } catch {
      failed++;
    }
    // Rate limit: 30 messages per second max
    if ((sent + failed) % 25 === 0) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  await bot.editMessageText(
    `✅ تم الإرسال!\n📤 نجح: ${sent}\n❌ فشل: ${failed}`,
    { chat_id: msg.chat.id, message_id: statusMsg.message_id }
  );
});

// Handle video links
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;

  const chatId = msg.chat.id;
  const url = extractUrl(msg.text);

  if (!url) return;

  trackUser(msg);

  const platform = detectPlatform(url);

  if (!platform) {
    bot.sendMessage(chatId, '❌ هذا الرابط غير مدعوم. أرسل /help لمعرفة المنصات المدعومة.');
    return;
  }

  const platformName = PLATFORM_NAMES[platform] || platform;
  const statusMsg = await bot.sendMessage(chatId, `⏳ جاري تحميل الفيديو من ${platformName}...`);

  try {
    const result = await getVideoDownload(url);

    if (!result || (!result.url && !result.filePath)) {
      await bot.editMessageText(
        '❌ لم أتمكن من تحميل هذا الفيديو. تأكد أن الرابط صحيح والفيديو عام.',
        { chat_id: chatId, message_id: statusMsg.message_id }
      );
      return;
    }

    await bot.editMessageText(
      '📥 جاري إرسال الفيديو...',
      { chat_id: chatId, message_id: statusMsg.message_id }
    );

    if (result.filePath) {
      // yt-dlp downloaded to local file
      const fileSize = fs.statSync(result.filePath).size;
      if (fileSize > 50 * 1024 * 1024) {
        cleanupFile(result.filePath);
        await bot.editMessageText(
          '❌ حجم الفيديو أكبر من 50 ميجابايت. لا يمكن إرساله عبر تليجرام.',
          { chat_id: chatId, message_id: statusMsg.message_id }
        );
        return;
      }

      await bot.sendVideo(chatId, result.filePath, {
        caption: `✅ تم التحميل من ${platformName}`,
        supports_streaming: true,
      });

      cleanupFile(result.filePath);
      recordDownload(msg.from.id, platform);
    } else {
      // Remote URL
      try {
        await bot.sendVideo(chatId, result.url, {
          caption: `✅ تم التحميل من ${platformName}`,
          supports_streaming: true,
        });
      } catch {
        const buffer = await downloadVideoBuffer(result.url);

        if (buffer.length > 50 * 1024 * 1024) {
          await bot.editMessageText(
            '❌ حجم الفيديو أكبر من 50 ميجابايت. لا يمكن إرساله عبر تليجرام.',
            { chat_id: chatId, message_id: statusMsg.message_id }
          );
          return;
        }

        await bot.sendVideo(chatId, buffer, {
          caption: `✅ تم التحميل من ${platformName}`,
          supports_streaming: true,
        }, {
          filename: 'video.mp4',
          contentType: 'video/mp4',
        });
      }
    }

    // Record download for remote URL
    if (!result.filePath) {
      recordDownload(msg.from.id, platform);
    }

    // Delete the status message after sending
    try {
      await bot.deleteMessage(chatId, statusMsg.message_id);
    } catch {
      // Ignore if can't delete
    }

  } catch (error) {
    console.error('Download error:', error.message);

    const errorMessage = error.message.includes('timeout')
      ? '⏱️ انتهت مهلة التحميل. حاول مرة أخرى لاحقاً.'
      : '❌ حدث خطأ أثناء تحميل الفيديو. حاول مرة أخرى.';

    try {
      await bot.editMessageText(errorMessage, {
        chat_id: chatId,
        message_id: statusMsg.message_id,
      });
    } catch {
      await bot.sendMessage(chatId, errorMessage);
    }
  }
});

// Error handling
bot.on('polling_error', (error) => {
  console.error('Polling error:', error.code, error.message);
});

console.log('🤖 Bot is running...');
