require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { detectPlatform, extractUrl, getVideoDownload, downloadVideoBuffer } = require('./downloader');

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN || BOT_TOKEN === 'your_telegram_bot_token_here') {
  console.error('ERROR: Set BOT_TOKEN in .env file');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

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

// Handle video links
bot.on('message', async (msg) => {
  if (!msg.text || msg.text.startsWith('/')) return;

  const chatId = msg.chat.id;
  const url = extractUrl(msg.text);

  if (!url) return;

  const platform = detectPlatform(url);

  if (!platform) {
    bot.sendMessage(chatId, '❌ هذا الرابط غير مدعوم. أرسل /help لمعرفة المنصات المدعومة.');
    return;
  }

  const platformName = PLATFORM_NAMES[platform] || platform;
  const statusMsg = await bot.sendMessage(chatId, `⏳ جاري تحميل الفيديو من ${platformName}...`);

  try {
    const result = await getVideoDownload(url);

    if (!result || !result.url) {
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

    try {
      // Try sending by URL first (faster)
      await bot.sendVideo(chatId, result.url, {
        caption: `✅ تم التحميل من ${platformName}\n🤖 @YourBotUsername`,
        supports_streaming: true,
      });
    } catch {
      // If sending by URL fails, download buffer and send
      const buffer = await downloadVideoBuffer(result.url);

      if (buffer.length > 50 * 1024 * 1024) {
        await bot.editMessageText(
          '❌ حجم الفيديو أكبر من 50 ميجابايت. لا يمكن إرساله عبر تليجرام.',
          { chat_id: chatId, message_id: statusMsg.message_id }
        );
        return;
      }

      await bot.sendVideo(chatId, buffer, {
        caption: `✅ تم التحميل من ${platformName}\n🤖 @YourBotUsername`,
        supports_streaming: true,
      }, {
        filename: 'video.mp4',
        contentType: 'video/mp4',
      });
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
