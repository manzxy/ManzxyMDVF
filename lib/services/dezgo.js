/**
 * lib/dezgo.js — Klien API Dezgo (dezgo.com) untuk AI image generation.
 * Diadaptasi dari gist ayashiiiyo (text2image, image2image, remove-background).
 * CommonJS, tanpa dependency eksternal (pakai fetch + FormData bawaan Node 18+).
 *
 * Catatan: model upscale & remove-background tidak lagi terdaftar di /info,
 * tapi endpoint-nya tetap dipakai sesuai gist aslinya.
 */
const { createHash, randomUUID, randomBytes } = require('crypto');
const { readFileSync, existsSync } = require('fs');

const BASE_URL = 'https://api.dezgo.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const SH_KEY_B64 = 'xO5LptfWq/+QLDc2zJ+dzhYE7xOTtgu09G3z6y/yuZPjQ12+K9LdcIg4raDgtpeN5MpBpnKPl+Ga\n2I4zEHRmlw==';

/* ───────────── Auth headers (sama seperti gist) ───────────── */
function guidToBytes(uuidStr) {
    const buf = Buffer.from(uuidStr.replace(/-/g, ''), 'hex');
    const d1 = Buffer.alloc(4);
    d1.writeUInt32LE(buf.readUInt32BE(0), 0);
    const d2 = Buffer.alloc(2);
    d2.writeUInt16LE(buf.readUInt16BE(4), 0);
    const d3 = Buffer.alloc(2);
    d3.writeUInt16LE(buf.readUInt16BE(6), 0);
    return Buffer.concat([d1, d2, d3, buf.subarray(8, 16)]);
}

function calculateHToken(nonceStr, arg0 = Buffer.alloc(0)) {
    const key = Buffer.from(SH_KEY_B64, 'base64');
    const hashArg0 = createHash('sha512').update(arg0).digest();
    const guidBytes = guidToBytes(nonceStr);
    for (let i = 0; i < 64; i++) key[i] ^= hashArg0[i];
    for (let j = 0; j < 16; j++) key[j] ^= guidBytes[j];
    return createHash('sha512').update(key).digest('base64');
}

function generateAuthHeaders(methodName, extraHeaders = {}) {
    const nonce = randomUUID();
    return {
        'User-Agent': USER_AGENT,
        'Origin': 'https://dezgo.com',
        'Referer': 'https://dezgo.com/',
        'X-CToken': randomBytes(16).toString('base64'),
        'X-WToken': BigInt('0x' + randomBytes(8).toString('hex')).toString(),
        'X-HToken': calculateHToken(nonce),
        'X-NToken': nonce,
        'X-D-Method': methodName,
        'X-Dezgo-Web': '1',
        'X-V': '5',
        ...extraHeaders
    };
}

/* ───────────── Submit job (auto-retry saat server penuh / 499) ───────────── */
async function postWithRetry(endpoint, buildFormData, maxRetries = 15) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const resp = await fetch(`${BASE_URL}/${endpoint}`, {
            method: 'POST',
            headers: generateAuthHeaders(endpoint, { 'X-Dezgo-Async': '1' }),
            body: buildFormData()
        });

        // 499 = antrean penuh, body berisi detik tunggu yang disarankan
        if (resp.status === 499) {
            let delaySec = 5;
            try {
                const parsed = parseInt((await resp.text()).trim(), 10);
                if (!isNaN(parsed) && parsed > 0) delaySec = Math.max(5, parsed);
            } catch {}
            await new Promise((r) => setTimeout(r, delaySec * 1000));
            continue;
        }

        if (!resp.ok) throw new Error(`${endpoint} gagal (HTTP ${resp.status}): ${await resp.text()}`);

        const json = await resp.json();
        if (!json.id) throw new Error('Dezgo tidak mengembalikan job ID');
        return json.id;
    }
    throw new Error(`Antrean Dezgo penuh terus (${maxRetries}x percobaan). Coba lagi nanti.`);
}

/* ───────────── Polling hasil job ───────────── */
async function pollAsyncJob(jobId, maxAttempts = 60, intervalMs = 3000) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((r) => setTimeout(r, intervalMs));
        const resp = await fetch(`${BASE_URL}/async/${jobId}`, {
            headers: generateAuthHeaders(`async/${jobId}`, { 'X-Dezgo-Id': jobId })
        });
        const contentType = resp.headers.get('content-type') || '';

        if (resp.status === 200 && contentType.includes('image/')) {
            const buf = Buffer.from(await resp.arrayBuffer());
            return { status: true, jobId, buffer: buf, size: buf.length, contentType };
        }
        if (resp.status !== 202) throw new Error(`Polling gagal (HTTP ${resp.status}): ${await resp.text()}`);
    }
    throw new Error('Timeout menunggu hasil dari Dezgo.');
}

/* ───────────── Persiapan input gambar (Buffer / path / URL) ───────────── */
function mimeFromName(filename) {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    return 'image/jpeg';
}

async function prepareImageInput(imageInput) {
    if (typeof imageInput === 'string' && /^https?:\/\//.test(imageInput)) {
        const resp = await fetch(imageInput, { headers: { 'User-Agent': USER_AGENT } });
        if (!resp.ok) throw new Error(`Gagal mengunduh gambar: HTTP ${resp.status}`);
        const inputBuf = Buffer.from(await resp.arrayBuffer());
        const filename = new URL(imageInput).pathname.split('/').pop() || 'image.jpg';
        return { inputBuf, filename, mimeType: mimeFromName(filename) };
    }
    if (Buffer.isBuffer(imageInput) || imageInput instanceof Uint8Array) {
        return { inputBuf: Buffer.from(imageInput), filename: 'image.jpg', mimeType: 'image/jpeg' };
    }
    if (typeof imageInput === 'string' && existsSync(imageInput)) {
        const inputBuf = readFileSync(imageInput);
        const filename = imageInput.split(/[\\/]/).pop() || 'image.jpg';
        return { inputBuf, filename, mimeType: mimeFromName(filename) };
    }
    throw new Error('imageInput harus Buffer, path file, atau URL');
}

/* ───────────── API publik ───────────── */

async function getModels(functionFilter = null) {
    const resp = await fetch(`${BASE_URL}/info`, { headers: { 'User-Agent': USER_AGENT } });
    if (!resp.ok) throw new Error(`Gagal mengambil daftar model: HTTP ${resp.status}`);
    const json = await resp.json();
    const models = json.models || [];
    if (!functionFilter) return models;
    return models.filter((m) => Array.isArray(m.functions) && m.functions.includes(functionFilter));
}

/** Daftar model text2image & image2image yang tersedia saat ini. */
async function listUsableModels() {
    const models = await getModels();
    const pick = (fn) => models.filter((m) => (m.functions || []).includes(fn)).map((m) => m.id);
    return { text2image: pick('text2image'), image2image: pick('image2image') };
}

/**
 * Text → Image.
 * options: { model, negative_prompt, guidance, sampler, seed, width, height, steps, maxAttempts, intervalMs }
 */
async function text2image(prompt, options = {}) {
    if (!prompt) throw new Error('prompt wajib diisi');
    const model = options.model || 'stablediffusion_1_5';
    const buildFormData = () => {
        const formData = new FormData();
        formData.append('prompt', prompt);
        formData.append('model', model);
        if (options.negative_prompt) formData.append('negative_prompt', options.negative_prompt);
        if (options.guidance !== undefined) formData.append('guidance', String(options.guidance));
        if (options.sampler) formData.append('sampler', options.sampler);
        if (options.seed !== undefined) formData.append('seed', String(options.seed));
        if (options.width) formData.append('width', String(options.width));
        if (options.height) formData.append('height', String(options.height));
        if (options.steps) formData.append('steps', String(options.steps));
        return formData;
    };
    const jobId = await postWithRetry('text2image', buildFormData);
    return pollAsyncJob(jobId, options.maxAttempts, options.intervalMs);
}

/**
 * Image → Image.
 * options: { model, strength (0-1, default 0.7), negative_prompt, guidance, sampler, seed, maxAttempts, intervalMs }
 */
async function image2image(imageInput, prompt, options = {}) {
    if (!prompt) throw new Error('prompt wajib diisi');
    const { inputBuf, filename, mimeType } = await prepareImageInput(imageInput);
    const model = options.model || 'stablediffusion_1_5';
    const strength = options.strength !== undefined ? options.strength : 0.7;
    const buildFormData = () => {
        const formData = new FormData();
        formData.append('prompt', prompt);
        formData.append('model', model);
        formData.append('strength', String(strength));
        formData.append('init_image', new Blob([inputBuf], { type: mimeType }), filename);
        if (options.negative_prompt) formData.append('negative_prompt', options.negative_prompt);
        if (options.guidance !== undefined) formData.append('guidance', String(options.guidance));
        if (options.sampler) formData.append('sampler', options.sampler);
        if (options.seed !== undefined) formData.append('seed', String(options.seed));
        return formData;
    };
    const jobId = await postWithRetry('image2image', buildFormData);
    return pollAsyncJob(jobId, options.maxAttempts, options.intervalMs);
}

/**
 * Remove background.
 * options: { mode: 'transparent' | 'mono' | 'linear' | 'blur', maxAttempts, intervalMs }
 */
async function removeBg(imageInput, options = {}) {
    const { inputBuf, filename, mimeType } = await prepareImageInput(imageInput);
    const mode = options.mode || 'transparent';
    const buildFormData = () => {
        const formData = new FormData();
        formData.append('mode', mode);
        formData.append('image', new Blob([inputBuf], { type: mimeType }), filename);
        return formData;
    };
    const jobId = await postWithRetry('remove-background', buildFormData);
    return pollAsyncJob(jobId, options.maxAttempts, options.intervalMs);
}

/**
 * Upscale (bonus, ikut gist).
 * options: { model: 'real_esrgan_x2plus' | 'real_esrgan_x4plus' | ..., maxAttempts, intervalMs }
 */
async function upscale(imageInput, options = {}) {
    const { inputBuf, filename, mimeType } = await prepareImageInput(imageInput);
    const model = options.model || 'real_esrgan_x2plus';
    const buildFormData = () => {
        const formData = new FormData();
        formData.append('model', model);
        formData.append('image', new Blob([inputBuf], { type: mimeType }), filename);
        return formData;
    };
    const jobId = await postWithRetry('upscale', buildFormData);
    return pollAsyncJob(jobId, options.maxAttempts, options.intervalMs);
}

/**
 * Upload gambar ke host publik agar bisa dipakai sebagai URL di rich response
 * (rich.image butuh URL publik, bukan buffer). Primary: lunara, fallback: uguu.se.
 * @returns {Promise<string>} URL publik gambar
 */
async function uploadImage(inputBuf, filename = 'image.jpg') {
    const buf = Buffer.isBuffer(inputBuf) ? inputBuf : Buffer.from(inputBuf);

    // 1) lunara.softbotz.my.id (sudah dipakai plugin .tourl)
    try {
        const form = new FormData();
        form.append('file', new Blob([buf], { type: 'image/jpeg' }), filename);
        const resp = await fetch('https://lunara.softbotz.my.id/upload', { method: 'POST', body: form, signal: AbortSignal.timeout(60000) });
        if (resp.ok) {
            const json = await resp.json();
            if (json?.file_url) return json.file_url;
        }
    } catch {}

    // 2) fallback: uguu.se (multipart manual, sama seperti lib/pinterest.js)
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2);
    const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files[]"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`),
        buf,
        Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    const resp = await fetch('https://uguu.se/upload', {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body,
        signal: AbortSignal.timeout(60000)
    });
    if (!resp.ok) throw new Error(`Upload gambar gagal: HTTP ${resp.status}`);
    const json = await resp.json();
    const url = json?.files?.[0]?.url || json?.url;
    if (!url) throw new Error('Upload gambar gagal: URL tidak diterima');
    return url;
}

module.exports = { getModels, listUsableModels, text2image, image2image, removeBg, upscale, uploadImage };
