/**
 * OMNIFY ANIME API — klien untuk https://anime.omnifylabs.sbs
 *
 * API ini menyediakan metadata + link streaming anime & donghua (sub Indo).
 * Semua request wajib membawa header `X-API-Key`.
 *
 * Catatan penting soal streaming:
 *   `stream_url` mengarah ke file MP4 utuh (360p ≈ 225 MB, 1080p ≈ 1.3 GB).
 *   Ukuran itu jauh di atas batas kirim WhatsApp, jadi bot TIDAK mengirim file
 *   video — bot mengirim poster + info + link yang bisa dibuka di browser.
 *
 * Semua fungsi mengembalikan data yang sudah dinormalisasi supaya plugin tidak
 * perlu tahu bentuk mentah respons API.
 */
const axios = require('axios');

const BASE = 'https://anime.omnifylabs.sbs';

/** API key: utamakan env (jangan simpan kunci di source). */
const API_KEY = process.env.OMNIFY_ANIME_KEY
    || process.env.OMNIFY_API_KEY
    || 'omni_prod_9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c';

const http = axios.create({
    baseURL: BASE,
    timeout: 20000,
    headers: { 'X-API-Key': API_KEY, 'User-Agent': 'ManzxyMD/8.12.0' },
    // API membalas JSON; biarkan axios mem-parse.
    responseType: 'json',
});

/* ───────────────────────────── cache ───────────────────────────── */

/**
 * Cache sederhana dengan TTL. Metadata anime jarang berubah, jadi cache
 * memotong panggilan berulang (mis. `.anime` lalu `.animeep` untuk judul sama).
 */
const cache = new Map();
const CACHE_MAX = 300;

function cacheGet(key) {
    const hit = cache.get(key);
    if (!hit) return null;
    if (Date.now() > hit.exp) { cache.delete(key); return null; }
    return hit.value;
}

function cacheSet(key, value, ttlMs) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { value, exp: Date.now() + ttlMs });
}

/* ───────────────────────────── request ───────────────────────────── */

class AnimeError extends Error {
    constructor(message, { status, endpoint } = {}) {
        super(message);
        this.name = 'AnimeError';
        this.status = status;
        this.endpoint = endpoint;
    }
}

/**
 * Panggil endpoint API dengan retry ringan untuk gangguan sementara.
 * @param {string} path  contoh: '/anime/search'
 * @param {object} params
 * @param {{ttl?:number, tries?:number}} opts
 */
async function request(path, params = {}, opts = {}) {
    const { ttl = 5 * 60 * 1000, tries = 3 } = opts;
    const key = path + '?' + JSON.stringify(params);

    const cached = cacheGet(key);
    if (cached) return cached;

    let lastErr;
    for (let i = 0; i < tries; i++) {
        try {
            const res = await http.get(path, { params });
            const body = res.data;

            if (!body || body.success !== true) {
                throw new AnimeError(body?.message || 'API membalas tanpa data.', {
                    status: res.status, endpoint: path,
                });
            }
            const out = { data: body.data, pagination: body.pagination || null, meta: { name: body.name, version: body.version } };
            cacheSet(key, out, ttl);
            return out;
        } catch (err) {
            lastErr = err;
            const status = err?.response?.status;
            // 4xx (selain 429) tidak akan berubah bila diulang.
            if (status && status >= 400 && status < 500 && status !== 429) break;
            if (i < tries - 1) await new Promise((r) => setTimeout(r, 700 * (i + 1)));
        }
    }

    const status = lastErr?.response?.status;
    if (status === 401 || status === 403) throw new AnimeError('API key ditolak. Set OMNIFY_ANIME_KEY di .env.', { status, endpoint: path });
    if (status === 404) throw new AnimeError('Data tidak ditemukan di API.', { status, endpoint: path });
    if (lastErr?.code === 'ECONNABORTED') throw new AnimeError('API terlalu lama merespons. Coba lagi.', { status, endpoint: path });
    throw new AnimeError(lastErr?.message || 'Gagal menghubungi API anime.', { status, endpoint: path });
}

/* ───────────────────────────── normalisasi ───────────────────────────── */

const str = (v, fallback = '') => (v === null || v === undefined ? fallback : String(v));

/** Ringkas satu item daftar anime. */
function normalizeList(item = {}) {
    return {
        id: str(item.id),
        title: str(item.title, 'Tanpa judul'),
        altTitles: Array.isArray(item.alt_titles) ? item.alt_titles : [],
        poster: str(item.poster),
        banner: str(item.banner),
        rating: str(item.rating, '-'),
        type: str(item.type, '-'),
        origin: str(item.origin, '-'),
        status: str(item.status, '-'),
        genres: Array.isArray(item.genres) ? item.genres : [],
        views: Number(item.views) || 0,
        favorites: Number(item.favorites) || 0,
        currentEpisode: item.current_episode ?? null,
        qualities: Array.isArray(item.available_qualities) ? item.available_qualities : [],
        updatedAt: str(item.updated_at),
        uploadedAgo: str(item.uploaded_ago),
    };
}

/** Normalisasi detail anime (termasuk episode, karakter, relasi, unduhan). */
function normalizeDetail(d = {}) {
    const episodes = (Array.isArray(d.episodes) ? d.episodes : []).map((e) => ({
        number: Number(e.episode_number) || 0,
        title: str(e.title, `Episode ${e.episode_number ?? ''}`.trim()),
        id: str(e.episode_id),
        releasedAt: str(e.released_at),
        uploadedAgo: str(e.uploaded_ago),
    }));

    const characters = (Array.isArray(d.characters) ? d.characters : []).map((c) => ({
        name: str(c.name),
        role: str(c.role),
        image: str(c.image),
        // API menyertakan pengisi suara; sebelumnya dibuang.
        voiceActor: str(c.voice_actor?.name),
        voiceActorImage: str(c.voice_actor?.image),
    }));

    const relations = (Array.isArray(d.relations) ? d.relations : []).map((r) => ({
        type: str(r.relation_type),
        title: str(r.title),
        kind: str(r.type),
        status: str(r.status),
        rating: str(r.rating, '-'),
        poster: str(r.poster),
        // ID relasi dipakai supaya judul terkait bisa langsung dibuka.
        animeId: str(r.anime_id),
    }));

    // Jadwal tayang berikutnya (khusus status Ongoing). Bentuk API:
    //   next_airing: { episode: 1181, airing_at: 1798985760 }
    // airing_at adalah detik Unix, bukan milidetik.
    const na = d.next_airing;
    const nextAiring = na && (na.episode || na.airing_at)
        ? {
            episode: Number(na.episode) || 0,
            at: Number(na.airing_at) ? new Date(Number(na.airing_at) * 1000) : null,
        }
        : null;

    // downloads.episodes[].downloads[].links[] → ratakan per episode
    const downloads = (Array.isArray(d.downloads?.episodes) ? d.downloads.episodes : []).map((ep) => ({
        title: str(ep.title),
        qualities: (Array.isArray(ep.downloads) ? ep.downloads : []).map((q) => ({
            quality: str(q.quality),
            links: (Array.isArray(q.links) ? q.links : []).map((l) => ({
                server: str(l.server),
                url: str(l.url),
            })),
        })),
    }));

    return {
        id: str(d.id),
        title: str(d.title, 'Tanpa judul'),
        altTitles: Array.isArray(d.alt_titles) ? d.alt_titles : [],
        synopsis: str(d.synopsis),
        poster: str(d.poster),
        banner: str(d.banner),
        rating: str(d.rating, '-'),
        status: str(d.status, '-'),
        type: str(d.type, '-'),
        origin: str(d.origin, '-'),
        duration: str(d.duration, '-'),
        studio: str(d.studio, '-'),
        season: str(d.season, '-'),
        genres: Array.isArray(d.genres) ? d.genres : [],
        views: Number(d.views) || 0,
        favorites: Number(d.favorites) || 0,
        updatedAt: str(d.updated_at),
        uploadedAgo: str(d.uploaded_ago),
        trailerUrl: str(d.trailer_url),
        nextAiring,
        episodes,
        characters,
        relations,
        downloads,
    };
}

/* ───────────────────────────── endpoint ───────────────────────────── */

/** Daftar anime berdasarkan jenis daftar. */
async function list(kind, { page = 1, perPage = 10 } = {}) {
    const allowed = ['completed', 'ongoing', 'latest', 'recommendations', 'donghua', 'movies', 'adult', 'list'];
    const path = `/anime/${allowed.includes(kind) ? kind : 'latest'}`;
    const r = await request(path, { page, per_page: perPage });
    return { items: (r.data || []).map(normalizeList), pagination: r.pagination };
}

/** Anime populer. period: all | today | weekly | monthly */
async function popular({ period = 'all', page = 1, perPage = 10 } = {}) {
    const p = ['all', 'today', 'weekly', 'monthly'].includes(period) ? period : 'all';
    const r = await request('/anime/popular', { period: p, page, per_page: perPage });
    return { items: (r.data || []).map(normalizeList), pagination: r.pagination, period: p };
}

/** Cari anime berdasarkan kata kunci. */
async function search(query, { page = 1, perPage = 10 } = {}) {
    const q = String(query || '').trim();
    if (!q) throw new AnimeError('Kata kunci pencarian kosong.');
    const r = await request('/anime/search', { q, page, per_page: perPage });
    return { items: (r.data || []).map(normalizeList), pagination: r.pagination, query: q };
}

/** Saran judul (autocomplete) — ringan, untuk salah ketik. */
async function suggest(query) {
    const q = String(query || '').trim();
    if (!q) return [];
    const r = await request('/anime/suggest', { q }, { ttl: 10 * 60 * 1000 });
    return (r.data || []).map(normalizeList);
}

/** Detail lengkap satu anime. */
async function detail(id) {
    const key = String(id || '').trim();
    if (!key) throw new AnimeError('ID anime kosong.');
    const r = await request('/anime/detail', { id: key }, { ttl: 15 * 60 * 1000 });
    if (!r.data) throw new AnimeError('Detail anime tidak ditemukan.');
    return normalizeDetail(r.data);
}

/** Daftar semua genre. */
async function genres({ adult = false } = {}) {
    const r = await request('/anime/genres', adult ? { adult: 'only' } : {}, { ttl: 24 * 60 * 60 * 1000 });
    return (r.data || []).map((g) => ({ name: str(g.name), slug: str(g.slug) }));
}

/** Anime per genre. */
async function byGenre(slug, { page = 1, perPage = 10 } = {}) {
    const s = String(slug || '').trim().toLowerCase();
    if (!s) throw new AnimeError('Genre kosong.');
    const r = await request(`/anime/genre/${encodeURIComponent(s)}`, { page, per_page: perPage });
    return { items: (r.data || []).map(normalizeList), pagination: r.pagination, genre: s };
}

/** Filter lanjutan: genre, status, type. */
async function filter({ genre, status, type, page = 1, perPage = 10 } = {}) {
    const params = { page, per_page: perPage };
    if (genre) params.genre = String(genre).toLowerCase();
    if (status) params.status = String(status).toLowerCase();
    if (type) params.type = String(type).toLowerCase();
    const r = await request('/anime/filter', params);
    return { items: (r.data || []).map(normalizeList), pagination: r.pagination };
}

/**
 * Katalog lengkap (/anime/list). Berbeda dari daftar lain: endpoint ini
 * mengembalikan seluruh isi database (total_items), bukan hanya yang terbaru.
 */
async function catalog({ page = 1, perPage = 20 } = {}) {
    const r = await request('/anime/list', { page, per_page: perPage });
    return { items: (r.data || []).map(normalizeList), pagination: r.pagination };
}

/** Anime acak. */
async function random({ limit = 5 } = {}) {
    const n = Math.min(Math.max(Number(limit) || 5, 1), 20);
    const r = await request('/anime/random', { limit: n }, { ttl: 0 });
    return (r.data || []).map(normalizeList);
}

/** Jadwal rilis per hari. day: senin..minggu (atau nama Inggris).
 *
 * Bentuk respons API: data = [{ day: 'Senin', items: [ { id, title, air_time, ... } ] }]
 * Jadi hasilnya diratakan dan jam tayangnya ikut dibawa.
 */
async function schedule(day = 'senin') {
    const d = String(day || 'senin').trim().toLowerCase();
    const r = await request('/anime/schedule', { day: d }, { ttl: 60 * 60 * 1000 });
    const groups = Array.isArray(r.data) ? r.data : [];

    const out = [];
    for (const group of groups) {
        const items = Array.isArray(group?.items) ? group.items : [];
        for (const item of items) {
            out.push({
                ...normalizeList(item),
                airTime: str(item.air_time),
                day: str(group?.day, d),
            });
        }
    }
    return out;
}

/** Link trailer (YouTube) satu anime. */
async function trailer(id) {
    const key = String(id || '').trim();
    if (!key) throw new AnimeError('ID anime kosong.');
    const r = await request('/anime/trailer', { id: key }, { ttl: 24 * 60 * 60 * 1000 });
    return {
        animeId: str(r.data?.anime_id),
        title: str(r.data?.title),
        youtubeId: str(r.data?.youtube_id),
        url: str(r.data?.trailer_url),
    };
}

/** Stream satu episode (semua server & kualitas). */
async function episode(episodeId) {
    const key = String(episodeId || '').trim();
    if (!key) throw new AnimeError('ID episode kosong.');
    const r = await request('/anime/episode', { id: key }, { ttl: 10 * 60 * 1000 });
    const d = r.data || {};
    const streams = (Array.isArray(d.streams) ? d.streams : []).map((s) => ({
        server: str(s.server, 'Server'),
        quality: str(s.quality, '-'),
        url: str(s.stream_url),
        format: str(s.format),
    }));
    return {
        episodeId: str(d.episode_id),
        animeId: str(d.anime_id),
        number: Number(d.episode_number) || 0,
        hasNext: Boolean(d.has_next_episode),
        hasPrev: Boolean(d.has_prev_episode),
        // ID tetangga episode: dipakai untuk tombol "episode berikutnya"
        // tanpa perlu memuat ulang detail anime.
        nextEpisodeId: str(d.next_episode_id),
        prevEpisodeId: str(d.prev_episode_id),
        streams,
    };
}

/**
 * Cari satu anime yang paling mungkin dimaksud user.
 *
 * API mengurutkan hasil berdasarkan popularitas, jadi "attack on titan" bisa
 * mengembalikan OVA lebih dulu daripada seri utamanya. Di sini hasil diberi
 * skor: judul persis > diawali kata kunci > mengandung kata kunci, lalu yang
 * judulnya paling pendek (seri utama biasanya lebih pendek dari spin-off).
 */
async function findBest(query) {
    const q = String(query || '').trim();
    if (!q) throw new AnimeError('Kata kunci pencarian kosong.');

    const hasil = await search(q, { perPage: 20 });
    if (!hasil.items.length) return null;

    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const target = norm(q);

    const scored = hasil.items.map((item) => {
        const t = norm(item.title);
        let score = 0;
        if (t === target) score = 100;
        else if (t.startsWith(target)) score = 80;
        else if (t.includes(target)) score = 60;
        else score = 40;
        // Judul lebih pendek = lebih mungkin seri utama.
        score -= Math.min(t.length / 100, 5);
        // Beri sedikit nilai untuk yang punya banyak episode (seri, bukan OVA).
        if (item.currentEpisode) score += 2;
        return { item, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0].item;
}

/* ───────────────────────── cache hasil per chat ───────────────────────── */

/**
 * Menyimpan hasil daftar terakhir per chat supaya user bisa memilih dengan
 * nomor (`.anime 2`) tanpa mengetik ulang judul atau ID.
 */
const resultCache = new Map();
const RESULT_TTL = 30 * 60 * 1000;

function remember(chatId, items) {
    if (!chatId || !Array.isArray(items) || !items.length) return;
    if (resultCache.size > 500) resultCache.delete(resultCache.keys().next().value);
    resultCache.set(chatId, { items, at: Date.now() });
}

function recall(chatId) {
    const r = resultCache.get(chatId);
    if (!r) return null;
    if (Date.now() - r.at > RESULT_TTL) { resultCache.delete(chatId); return null; }
    return r.items;
}

/* ───────────────────────────── util tampilan ───────────────────────────── */

/** 742723 → "742.7K" */
function fmtCount(n) {
    const v = Number(n) || 0;
    if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return String(v);
}

/** 225819939 → "215.4 MB" */
function fmtBytes(b) {
    const v = Number(b) || 0;
    if (v >= 1024 ** 3) return (v / 1024 ** 3).toFixed(1) + ' GB';
    if (v >= 1024 ** 2) return (v / 1024 ** 2).toFixed(1) + ' MB';
    if (v >= 1024) return (v / 1024).toFixed(1) + ' KB';
    return v + ' B';
}

/** Potong teks panjang tanpa memotong kata di tengah. */
function truncate(text, max = 400) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    if (s.length <= max) return s;
    const cut = s.slice(0, max);
    const sp = cut.lastIndexOf(' ');
    return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + '…';
}

/** Hari ini dalam bahasa Indonesia (untuk .animejadwal tanpa argumen). */
function todayName() {
    return ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'][new Date().getDay()];
}

module.exports = {
    BASE, AnimeError,
    list, popular, search, suggest, detail, genres, byGenre, filter,
    catalog, random, schedule, trailer, episode, findBest,
    fmtCount, fmtBytes, truncate, todayName,
    normalizeList, normalizeDetail,
    remember, recall,
};
