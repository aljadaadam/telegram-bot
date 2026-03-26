const axios = require('axios');
const fs = require('fs');
const path = require('path');

const DOWNLOADS_DIR = path.join(__dirname, '..', 'downloads');

if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

/**
 * Detect which platform a URL belongs to
 */
function detectPlatform(url) {
  const platforms = [
    { name: 'tiktok', patterns: [/tiktok\.com/, /vm\.tiktok\.com/] },
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
 * Download video using primary API (cobalt.tools)
 */
async function downloadWithCobalt(url) {
  try {
    const response = await axios.post('https://api.cobalt.tools/api/json', {
      url: url,
      vCodec: 'h264',
      vQuality: '720',
      aFormat: 'mp3',
      isNoTTWatermark: true,
    }, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    if (response.data && response.data.url) {
      return { url: response.data.url, filename: response.data.filename || null };
    }

    if (response.data && response.data.picker) {
      const firstItem = response.data.picker[0];
      return { url: firstItem.url, filename: null };
    }

    return null;
  } catch (error) {
    console.error('Cobalt API error:', error.message);
    return null;
  }
}

/**
 * Download video using fallback API (allsaver-style)
 */
async function downloadWithFallbackAPI(url) {
  try {
    const encodedUrl = encodeURIComponent(url);
    const response = await axios.get(
      `https://social-download-all-in-one.p.rapidapi.com/v1/social/autolink?url=${encodedUrl}`,
      {
        headers: {
          'x-rapidapi-host': 'social-download-all-in-one.p.rapidapi.com',
          'x-rapidapi-key': 'RAPIDAPI_KEY_HERE',
        },
        timeout: 30000,
      }
    );

    if (response.data && response.data.medias && response.data.medias.length > 0) {
      const video = response.data.medias.find(m => m.type === 'video');
      if (video) {
        return { url: video.url, filename: null };
      }
    }
    return null;
  } catch (error) {
    console.error('Fallback API error:', error.message);
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
    maxContentLength: 50 * 1024 * 1024, // 50MB limit
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });
  return Buffer.from(response.data);
}

/**
 * Main download function - tries multiple methods
 */
async function getVideoDownload(url) {
  // Try cobalt first (free, no key needed)
  let result = await downloadWithCobalt(url);
  if (result) return result;

  // Fallback (needs RapidAPI key)
  result = await downloadWithFallbackAPI(url);
  if (result) return result;

  return null;
}

module.exports = {
  detectPlatform,
  extractUrl,
  getVideoDownload,
  downloadVideoBuffer,
};
