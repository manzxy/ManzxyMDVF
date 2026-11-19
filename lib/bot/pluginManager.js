/**
 * PENGELOLA FILE PLUGIN — dipakai .svplug / .editplug / .getplug / .delplug / .listplug.
 * Simpan aman: cek sintaks → tulis → muat ulang → bila gagal dimuat, isi lama dikembalikan.
 * Tidak ada folder backup; menghapus plugin bersifat permanen.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripCodeFence } = require('../core/utils');
const { pluginsDir, findPlugin, loadPluginFile, loadPlugins } = require('./pluginLoader');

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/i;
const MAX_CODE_BYTES = 256 * 1024;

const isValidName = (s) => NAME_RE.test(String(s || ''));

/** Daftar seluruh file plugin di disk. */
function listFiles() {
    const out = [];
    if (!fs.existsSync(pluginsDir)) return out;
    for (const category of fs.readdirSync(pluginsDir).sort()) {
        const dir = path.join(pluginsDir, category);
        if (category.startsWith('.') || category.startsWith('_') || !fs.statSync(dir).isDirectory()) continue;
        for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
            const full = path.join(dir, file);
            out.push({ category, file, name: file.slice(0, -3), path: full, size: fs.statSync(full).size });
        }
    }
    return out;
}

/**
 * Cari plugin dari input: "kategori/nama", "nama" (file), atau nama command.
 * Mengembalikan array kandidat (kosong = tidak ada, >1 = ambigu).
 */
function resolve(input) {
    const q = String(input || '').trim().toLowerCase().replace(/\.js$/, '');
    if (!q) return [];
    const files = listFiles();
    if (q.includes('/')) {
        const [cat, name] = q.split('/');
        return files.filter((f) => f.category === cat && f.name.toLowerCase() === name);
    }
    let found = files.filter((f) => f.name.toLowerCase() === q);
    if (found.length) return found;
    const byCmd = findPlugin(q);
    if (byCmd) found = files.filter((f) => f.path === byCmd.filePath);
    return found;
}

/** Cek sintaks CommonJS tanpa menjalankan kode. Mengembalikan null jika valid, atau pesan error. */
function checkSyntax(code, filename = 'plugin.js') {
    try {
        new vm.Script(`(function (exports, require, module, __filename, __dirname) {${code}\n})`, { filename });
        return null;
    } catch (err) {
        const line = (err.stack || '').split('\n')[0];
        return `${err.name}: ${err.message}${line && line.includes(':') ? `\n(${line})` : ''}`;
    }
}

/** Tebak nama command & kategori dari isi kode plugin. */
function guessMeta(code) {
    const cmd = code.match(/command\s*:\s*\[?\s*['"`]([a-z0-9_-]+)['"`]/i);
    const cat = code.match(/category\s*:\s*['"`]([a-z0-9_-]+)['"`]/i);
    return { command: cmd ? cmd[1].toLowerCase() : '', category: cat ? cat[1].toLowerCase() : '' };
}

/**
 * Tulis plugin baru / timpa yang lama dengan aman.
 * Urutan: validasi → tulis → muat ulang → (gagal? isi lama dikembalikan / file baru dihapus).
 */
function savePlugin(category, name, code) {
    if (!isValidName(category) || !isValidName(name)) throw new Error('Nama/kategori hanya boleh huruf, angka, "-" dan "_" (maks 40 karakter).');
    category = category.toLowerCase();
    name = name.toLowerCase();
    if (Buffer.byteLength(code) > MAX_CODE_BYTES) throw new Error('Kode terlalu besar (maks 256 KB).');
    if (!code.trim()) throw new Error('Kode kosong.');

    const syntaxErr = checkSyntax(code, `${category}/${name}.js`);
    if (syntaxErr) throw new Error(`Sintaks tidak valid, plugin TIDAK disimpan.\n${syntaxErr}`);

    const dir = path.join(pluginsDir, category);
    const full = path.join(dir, `${name}.js`);
    if (path.relative(pluginsDir, full).startsWith('..')) throw new Error('Path tidak valid.');
    fs.mkdirSync(dir, { recursive: true });

    const existed = fs.existsSync(full);
    const old = existed ? fs.readFileSync(full, 'utf8') : null;
    fs.writeFileSync(full, code.endsWith('\n') ? code : code + '\n');

    const { plugin, error } = loadPluginFile(full, category);
    if (error) {
        if (existed) fs.writeFileSync(full, old); else fs.unlinkSync(full);
        loadPlugins({ silent: true });
        throw new Error(`Plugin gagal dimuat, dikembalikan seperti semula.\n${error.message}`);
    }
    loadPlugins({ silent: true });
    return { existed, path: full, category, name, commands: plugin.commands, size: Buffer.byteLength(code) };
}

/** Hapus file plugin (permanen, tanpa backup). */
function deletePlugin(entry) {
    fs.unlinkSync(entry.path);
    loadPlugins({ silent: true });
}

/** Ganti teks di dalam plugin. Mengembalikan kode baru + jumlah penggantian (belum ditulis). */
function replaceInCode(code, search, replacement, all = false) {
    if (!search) throw new Error('Teks yang dicari kosong.');
    const count = code.split(search).length - 1;
    if (count === 0) throw new Error('Teks yang dicari tidak ditemukan di plugin.');
    if (count > 1 && !all) throw new Error(`Teks ditemukan ${count}x. Perjelas teks pencarian, atau tambah opsi --all untuk mengganti semuanya.`);
    return { code: all ? code.split(search).join(replacement) : code.replace(search, () => replacement), count };
}

/**
 * Pecah teks command plugin. Baris pertama = "<nama> [--flag]", baris berikutnya = isi/kode.
 * Jika baris pertama terlihat seperti kode, seluruh teks dianggap isi (tanpa nama).
 */
function parseInput(text) {
    const lines = String(text || '').split('\n');
    const toks = lines[0].trim().split(/\s+/).filter(Boolean);
    const flags = new Set(toks.filter((t) => t.startsWith('--')).map((t) => t.toLowerCase()));
    const rest = toks.filter((t) => !t.startsWith('--'));
    const valid = rest.length <= 1 && rest.every((t) => /^[a-z0-9_-]+(\/[a-z0-9_-]+)?(\.js)?$/i.test(t));
    if (!valid) {
        // satu token tanpa karakter kode tapi berisi "..", "/" di awal, atau "\\" → upaya path tidak valid
        const bad = rest.length === 1 && /^[^\s=(){};'"`]+$/.test(rest[0]) && /(\.\.|^\/|\\)/.test(rest[0]);
        return { nameArg: '', flags: new Set(), body: String(text || '').trim(), invalidName: bad ? rest[0] : '' };
    }
    return { nameArg: (rest[0] || '').replace(/\.js$/i, ''), flags, body: lines.slice(1).join('\n').trim() };
}

/** Ambil kode dari pesan yang di-reply: file .js (dokumen) atau teks biasa. */
async function readQuotedCode(quoted) {
    if (!quoted) return null;
    const doc = quoted.message?.documentMessage;
    if (doc) {
        if (Number(doc.fileLength) > MAX_CODE_BYTES) throw new Error('File terlalu besar (maks 256 KB).');
        const { downloadContentFromMessage } = require('../wa/mediaDownload');
        const stream = await downloadContentFromMessage(doc, 'document');
        const chunks = [];
        let total = 0;
        for await (const c of stream) {
            total += c.length;
            if (total > MAX_CODE_BYTES) throw new Error('File terlalu besar (maks 256 KB).');
            chunks.push(c);
        }
        return { code: stripCodeFence(Buffer.concat(chunks).toString('utf8')), fileName: String(doc.fileName || '').replace(/\.js$/i, ''), from: 'file' };
    }
    if (quoted.text) return { code: stripCodeFence(quoted.text), fileName: '', from: 'teks' };
    return null;
}

module.exports = {
    parseInput, readQuotedCode, isValidName, listFiles, resolve, checkSyntax, guessMeta,
    savePlugin, deletePlugin, replaceInCode, MAX_CODE_BYTES
};
