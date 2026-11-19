/**
 * Pinterest Scraper — faithful CJS port of:
 * https://gist.github.com/ayashiiiyo/5d179be9ed7eab3a8fa3d591de3abd8d
 *
 * Exports: search, getPin, extractPinId, lens, downloadMedia
 */

const { existsSync, readFileSync } = require('node:fs');
const axios = require('axios');

const BASE_URL = 'https://www.pinterest.com';
const RESOURCE_BASE = 'https://www.pinterest.com/resource';
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let sessionCookies = '';
let csrfToken = '';

async function ensureSession() {
  if (sessionCookies && csrfToken) {
    return { cookies: sessionCookies, csrf: csrfToken };
  }
  const res = await axios.get(BASE_URL, {
    headers: { 'User-Agent': DEFAULT_UA },
    timeout: 15000,
    validateStatus: () => true
  });
  const rawCookies = res.headers['set-cookie'] || [];
  const map = {};
  for (const c of rawCookies) {
    const parts = c.split(';')[0].split('=');
    if (parts.length === 2) {
      map[parts[0].trim()] = parts[1].trim();
    }
  }
  sessionCookies = Object.entries(map).map(([k, v]) => `${k}=${v}`).join('; ');
  csrfToken = map['csrftoken'] || '';
  return { cookies: sessionCookies, csrf: csrfToken };
}

function getHeaders(customCookies = null, handler = 'www/[username]/[slug].js', referer = BASE_URL) {
  const cookieStr = customCookies || sessionCookies;
  const csrf = cookieStr.match(/csrftoken=([^;]+)/)?.[1] || csrfToken;
  return {
    'User-Agent': DEFAULT_UA,
    'Accept': 'application/json, text/javascript, */*, q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
    'X-CSRFToken': csrf,
    'X-Pinterest-AppState': 'active',
    'X-Pinterest-PWS-Handler': handler,
    'Referer': referer,
    'Cookie': cookieStr
  };
}

/* Pinterest punya dua bentuk ID pin:
 *   numerik  → 1122100063465519972   (lama, bisa dibaca PinResource)
 *   opaque   → e1_AfqPShxgpKNvetMLnCypA9ctRt7M...  (baru, hanya hidup di klien)
 * Keduanya harus diterima; pembeda ini dipakai untuk memilih jalur resolusi.
 */
const NUMERIC_ID = /^\d+$/;
const OPAQUE_ID = /^[A-Za-z0-9_-]{10,}$/;
const PIN_PATH = /\/pin\/([A-Za-z0-9_-]{6,})/;

const isNumericId = (v) => NUMERIC_ID.test(String(v ?? '').trim());
const isOpaqueId = (v) => {
  const s = String(v ?? '').trim();
  return !NUMERIC_ID.test(s) && OPAQUE_ID.test(s);
};

async function extractPinId(input) {
  if (!input || typeof input !== 'string') {
    throw new Error('Input URL atau ID diperlukan');
  }
  const clean = input.trim();

  // ID langsung, numerik maupun opaque
  if (isNumericId(clean) || isOpaqueId(clean)) return clean;

  // pin.it short link → ikuti redirect sampai dapat URL pin
  if (/pin\.it\//i.test(clean)) {
    const res = await axios.get(clean, {
      headers: { 'User-Agent': DEFAULT_UA },
      timeout: 15000,
      maxRedirects: 10,
      validateStatus: () => true
    });
    const finalUrl = res.request?.res?.responseUrl || res.request?._redirectable?._currentUrl || '';
    const m = finalUrl.match(PIN_PATH);
    if (m) return m[1];
  }

  // URL pin biasa, termasuk id.pinterest.com dan varian regional
  const match = clean.match(PIN_PATH);
  if (match) return match[1];

  throw new Error('Tidak bisa membaca ID pin dari input itu');
}

async function resolveVideoDirectUrl(m3u8Url) {
  if (!m3u8Url || !m3u8Url.endsWith('.m3u8')) return m3u8Url;
  try {
    const res = await axios.get(m3u8Url, {
      headers: { 'User-Agent': DEFAULT_UA, 'Referer': BASE_URL },
      timeout: 15000,
      validateStatus: () => true
    });
    if (res.status !== 200) return m3u8Url;
    const text = String(res.data);
    const subPlaylists = text.match(/[A-Za-z0-9_-]+\.m3u8/g) || [];
    if (subPlaylists.length === 0) return m3u8Url;
    const bestSub = subPlaylists[subPlaylists.length - 1];
    const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
    const subRes = await axios.get(baseUrl + bestSub, {
      headers: { 'User-Agent': DEFAULT_UA, 'Referer': BASE_URL },
      timeout: 15000,
      validateStatus: () => true
    });
    if (subRes.status !== 200) return m3u8Url;
    const subText = String(subRes.data);
    const cmfvMatch = subText.match(/URI="([^"]+\.cmfv)"/);
    if (cmfvMatch) {
      return baseUrl + cmfvMatch[1];
    }
  } catch {}
  return m3u8Url;
}

async function search(query, options = {}) {
  if (!query || typeof query !== 'string') {
    throw new Error('Search query is required');
  }
  await ensureSession();
  const q = query.trim();
  const pageSize = options.pageSize || 25;
  const scope = options.scope || 'pins';
  const sourceUrl = `/search/${scope}/?q=${encodeURIComponent(q)}`;

  const data = {
    options: {
      query: q,
      scope,
      page_size: pageSize,
      bookmarks: options.bookmarks || []
    },
    context: {}
  };

  const params = new URLSearchParams({
    source_url: sourceUrl,
    data: JSON.stringify(data)
  });

  const url = `${RESOURCE_BASE}/BaseSearchResource/get/?${params.toString()}`;
  const headers = getHeaders(options.cookies, `www/search/${scope}.js`, `${BASE_URL}${sourceUrl}`);

  const res = await axios.get(url, { headers, timeout: 25000, validateStatus: () => true });
  if (res.status !== 200) {
    throw new Error(`Pinterest search failed: HTTP ${res.status}`);
  }

  const json = res.data;
  const raw = json.resource_response?.data?.results || [];

  // Buang duplikat (Pinterest kerap mengulang pin yang sama antar blok) dan
  // pin tanpa gambar, supaya jumlah yang dilaporkan jujur.
  const seen = new Set();
  const results = [];
  for (const p of raw) {
    if (!p?.id || seen.has(p.id)) continue;
    const orig = p.images?.orig?.url || p.images?.['736x']?.url || p.images?.['564x']?.url || null;
    if (!orig) continue;
    seen.add(p.id);
    const isGif = /\.gif(\?|$)/i.test(orig);
    const isVideo = Boolean(p.is_video || p.videos);
    const title = (p.title || p.grid_title || p.seo_alt_text || p.description || '').trim();
    results.push({
      id: p.id,
      title: title.slice(0, 200),
      description: (p.description || '').trim(),
      url: `${BASE_URL}/pin/${p.id}/`,
      type: isVideo ? 'video' : (isGif ? 'gif' : 'image'),
      isVideo,
      isGif,
      image: orig,
      thumbnail: p.images?.['236x']?.url || orig,
      width: p.images?.orig?.width || null,
      height: p.images?.orig?.height || null,
      dominantColor: p.dominant_color || null,
      pinner: p.pinner ? {
        username: p.pinner.username,
        fullName: p.pinner.full_name || '',
        avatar: p.pinner.image_medium_url || null
      } : null
    });
  }

  // Bookmark halaman berikutnya. Pinterest mengembalikan STRING di
  // resource_response.bookmark, padahal request berikutnya mengharapkan ARRAY.
  // Tanpa dibungkus, halaman 2 mengembalikan halaman 1 lagi (persis kejadian
  // yang membuat -more tidak berguna).
  const rawBookmark = json.resource_response?.bookmark
    ?? json.resource?.options?.bookmarks
    ?? null;
  const nextBookmarks = rawBookmark
    ? (Array.isArray(rawBookmark) ? rawBookmark : [rawBookmark])
    : [];

  return {
    query: q,
    scope,
    count: results.length,
    bookmarks: nextBookmarks,
    hasMore: nextBookmarks.length > 0,
    results
  };
}

async function getPin(urlOrId, options = {}) {
  await ensureSession();
  const pinId = await extractPinId(urlOrId);

  const data = {
    options: {
      id: pinId,
      field_set_key: 'detailed'
    },
    context: {}
  };

  const sourceUrl = `/pin/${pinId}/`;
  const params = new URLSearchParams({
    source_url: sourceUrl,
    data: JSON.stringify(data)
  });

  const url = `${RESOURCE_BASE}/PinResource/get/?${params.toString()}`;
  const headers = getHeaders(options.cookies, 'www/pin/[id].js', `${BASE_URL}${sourceUrl}`);

  const res = await axios.get(url, { headers, timeout: 25000, validateStatus: () => true });
  const p = res.status === 200 ? res.data?.resource_response?.data : null;

  if (!p) {
    // Bedakan dua kegagalan yang butuh penanganan berbeda di plugin:
    // ID opaque tidak akan pernah bisa dibaca lewat PinResource, sedangkan
    // NOT_FOUND berarti pinnya memang sudah dihapus.
    const opaque = isOpaqueId(pinId);
    const err = new Error(opaque
      ? 'Pin ini memakai ID model baru yang tidak bisa dibaca langsung oleh server'
      : `Pin ${pinId} tidak ditemukan (HTTP ${res.status})`);
    err.code = opaque ? 'OPAQUE_ID' : 'NOT_FOUND';
    err.pinId = pinId;
    throw err;
  }

  const origImage = p.images?.orig?.url || p.images?.['736x']?.url || null;
  const isGif = Boolean(origImage && origImage.endsWith('.gif'));
  const isVideo = Boolean(p.is_video || p.videos);

  let isCarousel = false;
  let carouselItems = [];

  if (p.carousel_data && Array.isArray(p.carousel_data.carousel_slots)) {
    isCarousel = true;
    carouselItems = p.carousel_data.carousel_slots.map((s, idx) => ({
      index: idx,
      title: s.title || '',
      details: s.details || '',
      url: s.images?.['736x']?.url || s.images?.['564x']?.url || s.images?.orig?.url || null
    })).filter((it) => it.url !== null);
  } else if (p.story_pin_data && Array.isArray(p.story_pin_data.pages)) {
    isCarousel = true;
    p.story_pin_data.pages.forEach((page, idx) => {
      (page.blocks || []).forEach((b) => {
        const u = b.image?.images?.originals?.url || b.image?.images?.['736x']?.url;
        if (u) {
          carouselItems.push({
            index: idx,
            title: page.title || '',
            url: u
          });
        }
      });
    });
  }

  let videoData = null;
  if (isVideo) {
    const vlist = p.videos?.video_list || {};
    const bestFormatKey = Object.keys(vlist).find((k) => k === 'V_720P') || Object.keys(vlist)[0];
    const bestVariant = bestFormatKey ? vlist[bestFormatKey] : null;
    if (bestVariant && bestVariant.url) {
      const directUrl = await resolveVideoDirectUrl(bestVariant.url);
      videoData = {
        hlsUrl: bestVariant.url,
        downloadUrl: directUrl,
        width: bestVariant.width || null,
        height: bestVariant.height || null,
        duration: bestVariant.duration || p.videos?.duration || null
      };
    }
  }

  let mediaType = 'image';
  if (isCarousel) mediaType = 'carousel';
  else if (isVideo) mediaType = 'video';
  else if (isGif) mediaType = 'gif';

  return {
    id: p.id,
    url: `${BASE_URL}/pin/${p.id}/`,
    title: p.title || p.grid_title || '',
    description: p.description || '',
    type: mediaType,
    isCarousel,
    isVideo,
    isGif,
    image: origImage,
    video: videoData,
    carousel: isCarousel ? carouselItems : null,
    pinner: p.pinner ? {
      username: p.pinner.username,
      fullName: p.pinner.full_name || '',
      avatar: p.pinner.image_medium_url || null
    } : null,
    board: p.board ? {
      id: p.board.id,
      name: p.board.name,
      url: p.board.url ? `${BASE_URL}${p.board.url}` : null
    } : null,
    dominantColor: p.dominant_color || null,
    createdAt: p.created_at || null
  };
}

async function uploadLocalImage(filePath) {
  const fileBytes = readFileSync(filePath);
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files[]"; filename="image.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
    fileBytes,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);

  const res = await axios.post('https://uguu.se/upload', body, {
    headers: {
      'User-Agent': DEFAULT_UA,
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    },
    timeout: 30000,
    validateStatus: () => true
  });

  if (res.status !== 200) {
    throw new Error(`Image upload failed: HTTP ${res.status}`);
  }

  const json = res.data;
  const url = json.files?.[0]?.url;
  if (!url) {
    throw new Error('Image host returned empty URL');
  }
  return url;
}

async function analyzeVisualQuery(imageInput) {
  let targetUrl = null;

  if (typeof imageInput === 'string') {
    if (existsSync(imageInput)) {
      targetUrl = await uploadLocalImage(imageInput);
    } else if (imageInput.startsWith('http://') || imageInput.startsWith('https://')) {
      targetUrl = imageInput;
    }
  }

  if (!targetUrl) {
    return null;
  }

  const bingUrl = `https://www.bing.com/images/search?view=detailv2&iss=SBI&form=L2MS03&sbisrc=UrlPaste&q=imgurl:${encodeURIComponent(targetUrl)}`;
  const res = await axios.get(bingUrl, {
    headers: { 'User-Agent': DEFAULT_UA },
    timeout: 20000,
    validateStatus: () => true
  });

  if (res.status !== 200) {
    return null;
  }

  const html = String(res.data);
  const match = html.match(/format=rss(?:&amp;|&)q=([^&"]+)/);
  if (match) {
    return decodeURIComponent(match[1].replace(/\+/g, ' '));
  }

  const queryMatch = html.match(/data-query="([^"]+)"/);
  if (queryMatch) {
    return queryMatch[1];
  }

  return null;
}

async function lens(input, options = {}) {
  if (!input) {
    throw new Error('Input is required (Pin URL, Pin ID, Image URL, or local image path)');
  }

  if (typeof input === 'string' && (input.includes('pinterest.com/pin/') || input.includes('pin.it/'))) {
    const pin = await getPin(input, options);
    const query = pin.title || pin.description || 'aesthetic';
    const related = await search(query, { pageSize: options.pageSize || 20 });
    return {
      type: 'pin',
      sourcePin: pin,
      searchQuery: query,
      results: related.results
    };
  }

  const query = await analyzeVisualQuery(input);
  if (!query) {
    throw new Error('Could not extract visual query from image');
  }

  const searchResults = await search(query, { pageSize: options.pageSize || 20 });
  return {
    type: 'visual_search',
    recognizedQuery: query,
    results: searchResults.results
  };
}

/* ── cache hasil search per chat (dipakai pinse.js & pinget.js) ──
 * Hasil search sudah membawa URL originals lengkap, jadi inilah sumber
 * utama untuk .pinget <nomor> — tidak perlu menyentuh PinResource lagi.
 */
const searchCache = new Map();
const CACHE_TTL = 30 * 60 * 1000;

function cacheRemember(chatId, results, meta = {}) {
  searchCache.set(chatId, { results, meta, at: Date.now() });
}

function cacheRecall(chatId) {
  const r = searchCache.get(chatId);
  return r && Date.now() - r.at < CACHE_TTL ? r.results : null;
}

/** Info pencarian terakhir di chat ini: { query, bookmarks, at }. */
function cacheMeta(chatId) {
  const r = searchCache.get(chatId);
  return r && Date.now() - r.at < CACHE_TTL ? r.meta : null;
}

async function downloadMedia(url, options = {}) {
  if (!url || typeof url !== 'string') {
    throw new Error('URL diperlukan');
  }
  const attempts = Number.isFinite(options.retries) ? options.retries : 2;
  let lastErr;

  for (let i = 0; i <= attempts; i++) {
    try {
      const res = await axios.get(url, {
        headers: {
          'User-Agent': DEFAULT_UA,
          'Referer': BASE_URL,
          'Accept': 'image/*,video/*,*/*'
        },
        responseType: 'arraybuffer',
        timeout: options.timeout || 60000,
        maxContentLength: 60 * 1024 * 1024,
        maxRedirects: 5,
        validateStatus: () => true
      });
      if (res.status !== 200) throw new Error(`Unduhan gagal: HTTP ${res.status}`);
      const buf = Buffer.from(res.data);
      if (!buf.length) throw new Error('Berkas kosong');
      return buf;
    } catch (err) {
      lastErr = err;
      if (i < attempts) await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw lastErr;
}

/**
 * getPin yang tidak melempar untuk pin yang memang tidak bisa dibaca server.
 * Mengembalikan null supaya pemanggil bisa jatuh ke data cache.
 */
async function resolvePin(urlOrId, options = {}) {
  try {
    return await getPin(urlOrId, options);
  } catch (err) {
    if (err.code === 'OPAQUE_ID' || err.code === 'NOT_FOUND') return null;
    throw err;
  }
}

module.exports = {
  getPin,
  resolvePin,
  search,
  extractPinId,
  lens,
  downloadMedia,
  cacheRemember,
  cacheRecall,
  cacheMeta,
  isNumericId,
  isOpaqueId,
  BASE_URL,
  DEFAULT_UA
};