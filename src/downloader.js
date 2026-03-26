const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const DOWNLOADS_DIR = path.join(__dirname, '..', 'downloads');

if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Detect which platform a URL belongs to
 */
function detectPlatform(url) {
  const platforms = [
    { name: 'tiktok', patterns: [/tiktok\.com/, /vm\.tiktok\.com/, /vt\.tiktok\.com/] },
    { name: 'instagram', patterns: [/instagram\.com/, /instagr\.am/] },
    { name: 'twitter', patterns: [/twitter\.com/, /x\.com/] },
    { name: 'youtube', patterns: [/youtube\.com/, /youtu\.be/] },
    { name: 'facebook', patterns: [/facebook\.com/, /fb\.watch/] },
    { name: 'pinterest', patterns: [/pinterest\.com/, /pin\.it/] },
    { name: 'snapchat', patterns: [/snapchat\.com/] },
    { name: 'threads', patterns: [/threads\.net/] },
    { name: 'likee', patterns: [/likee\.video/, /l\.likee\.video/] },
  ];

  for (const platform of platforms) {
    for (const pattern of platform.patterns) {
      if (pattern.test(url)) return platform.name;
    }
  }
  return null;
}

/**
 * Extract URLs from text
 */
function extractUrl(text) {
  const urlRegex = /https?:\/\/[^\s]+/gi;
  const matches = text.match(urlRegex);
  return matches ? matches[0] : null;
}

/**
 * Download video using yt-dlp (supports all platforms)
 */
function downloadWithYtDlp(url) {
  return new Promise((resolve, reject) => {
    const outputTemplate = path.join(DOWNLOADS_DIR, `%(id)s.%(ext)s`);

    const args = [
      '--no-warnings',
      '--no-playlist',
      '-f', 'best[ext=mp4][filesize<50M]/best[ext=mp4]/best[filesize<50M]/best',
      '-o', outputTemplate,
      '--max-filesize', '50M',
      '--socket-timeout', '30',
      '--retries', '3',
      '--print', 'after_move:filepath',
      url,
    ];

    console.log(`yt-dlp downloading: ${url}`);

    execFile('yt-dlp', args, { timeout: 120000 }, (error, stdout, stderr) => {
      if (error) {
        console.error('yt-dlp error:', error.message);
        if (stderr) console.error('yt-dlp stderr:', stderr.trim());
        return reject(error);
      }

      const filePath = stdout.trim().split('\n').pop();
      if (filePath && fs.existsSync(filePath)) {
        console.log(`yt-dlp downloaded: ${filePath}`);
        resolve(filePath);
      } else {
        reject(new Error('yt-dlp: output file not found'));
      }
    });
  });
}

/**
 * TikTok - tikwm.com API (free, no key, fast for TikTok)
 */
async function downloadTikTok(url) {
  try {
    const response = await axios.post('https://www.tikwm.com/api/',
      new URLSearchParams({ url, count: 12, cursor: 0, web: 1, hd: 1 }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
        },
        timeout: 15000,
      }
    );

    const data = response.data;
    if (data && data.data) {
      const videoPath = data.data.hdplay || data.data.play;
      if (videoPath) {
        const videoUrl = videoPath.startsWith('http') ? videoPath : `https://www.tikwm.com${videoPath}`;
        return { url: videoUrl, filename: null };
      }
    }
    return null;
  } catch (error) {
    console.error('TikWM API error:', error.message);
    return null;
  }
}

/**
 * Download video buffer from URL
 */
async function downloadVideoBuffer(videoUrl) {
  const response = await axios.get(videoUrl, {
    responseType: 'arraybuffer',
    timeout: 120000,
    maxContentLength: 50 * 1024 * 1024,
    headers: {
      'User-Agent': USER_AGENT,
      'Referer': 'https://www.tiktok.com/',
    },
  });
  return Buffer.from(response.data);
}

/**
 * Clean up downloaded file
 */
function cleanupFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (e) {
    console.error('Cleanup error:', e.message);
  }
}

/**
 * Main download function
 * Returns either { url } for remote video or { filePath } for local file
 */
async function getVideoDownload(url) {
  const platform = detectPlatform(url);

  // For TikTok, try tikwm first (faster, no watermark)
  if (platform === 'tiktok') {
    const result = await downloadTikTok(url);
    if (result) return result;
  }

  // Use yt-dlp for all platforms (most reliable)
  try {
    const filePath = await downloadWithYtDlp(url);
    return { filePath, filename: path.basename(filePath) };
  } catch (error) {
    console.error('yt-dlp failed:', error.message);
  }

  return null;
}

module.exports = {
  detectPlatform,
  extractUrl,
  getVideoDownload,
  downloadVideoBuffer,
  cleanupFile,
};
