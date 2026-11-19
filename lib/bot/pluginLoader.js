const fs = require('fs');
const path = require('path');
/**
 * PEMUAT PLUGIN — memuat plugins/<kategori>/*.js, membuat indeks command, dan meneruskan event socket ke plugin.
 * Hot-reload (muat ulang otomatis saat file berubah) aktif bawaan; dapat diatur dengan config.hotReload atau .hotreload on|off.
 * Pengelola file (svplug/editplug/delplug/getplug) ada di lib/pluginManager.js.
 */
const { logInfo, logWarn, logError, logSuccess, logDebug } = require('../core/logger');

// lib/bot/ → root proyek butuh tiga level naik (bot → lib → root)
const pluginsDir = path.join(__dirname, '..', '..', 'plugins');
const plugins = new Map();            // 'kategori/file.js' -> plugin
const commandIndex = new Map();       // 'command' -> plugin
const watchers = new Map();           // dir -> FSWatcher
const timers = new Map();             // debounce

const isCategoryDir = (name) => !name.startsWith('.') && !name.startsWith('_') && fs.statSync(path.join(pluginsDir, name)).isDirectory();

const prettifyName = (s) => String(s).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function normalizeCommands(plugin) {
    if (!plugin.command) return [];
    return (Array.isArray(plugin.command) ? plugin.command : [plugin.command]).map((c) => String(c).toLowerCase());
}

/** Muat satu file plugin. Mengembalikan { plugin } atau { error }. */
function loadPluginFile(fullPath, category) {
    try {
        delete require.cache[require.resolve(fullPath)];
        const plugin = require(fullPath);
        if (!plugin || typeof plugin !== 'object') throw new Error('module.exports harus berupa object');
        const hasCmd = Boolean(plugin.command);
        const hasHook = typeof plugin.before === 'function' || typeof plugin.all === 'function' || (plugin.events && typeof plugin.events === 'object');
        if (!hasCmd && !hasHook) throw new Error('plugin harus punya "command", hook before()/all(), atau events{}');
        if (hasCmd && typeof plugin.execute !== 'function') throw new Error('plugin dengan "command" wajib punya fungsi execute()');
        plugin.category = String(plugin.category || category).toLowerCase();
        plugin.commands = normalizeCommands(plugin);
        // Nama fitur untuk menu. Plugin tanpa `name` diberi nama otomatis dari command pertamanya.
        if (hasCmd) {
            const given = typeof plugin.name === 'string' && plugin.name.trim();
            plugin.name = (given || prettifyName(plugin.commands[0] || path.basename(fullPath, '.js'))).trim().slice(0, 40);
            plugin.nameAuto = !given;
            if (!given) logWarn('PLUGIN', `${category}/${path.basename(fullPath)}: belum punya "name" → memakai "${plugin.name}"`);
        }
        plugin.filePath = fullPath;
        plugin.fileName = path.basename(fullPath);
        return { plugin };
    } catch (error) {
        delete require.cache[fullPath];
        return { error };
    }
}

function rebuildIndex() {
    commandIndex.clear();
    for (const [key, plugin] of plugins) {
        for (const cmd of plugin.commands || []) {
            if (commandIndex.has(cmd) && commandIndex.get(cmd) !== plugin) {
                logWarn('PLUGIN', `Command ".${cmd}" ganda: ${key} menimpa ${commandIndex.get(cmd).category}/${commandIndex.get(cmd).fileName}`);
            }
            commandIndex.set(cmd, plugin);
        }
    }
}

function loadPlugins({ silent = false } = {}) {
    plugins.clear();
    if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir, { recursive: true });
    let failed = 0;
    for (const category of fs.readdirSync(pluginsDir).filter(isCategoryDir).sort()) {
        const dir = path.join(pluginsDir, category);
        for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
            const { plugin, error } = loadPluginFile(path.join(dir, file), category);
            if (error) { failed++; logError('PLUGIN-ERR', `${category}/${file}: ${error.message}`); continue; }
            plugins.set(`${category}/${file}`, plugin);
        }
    }
    rebuildIndex();
    if (!silent) logSuccess('PLUGINS', `Memuat ${plugins.size} plugin • ${commandIndex.size} command${failed ? ` • ${failed} GAGAL` : ''}`);
    return plugins;
}

function reloadFile(category, filename) {
    const fullPath = path.join(pluginsDir, category, filename);
    const key = `${category}/${filename}`;
    if (!fs.existsSync(fullPath)) {
        if (plugins.delete(key)) { rebuildIndex(); logInfo('HOT-RELOAD', `Dihapus: ${key}`); }
        return;
    }
    const { plugin, error } = loadPluginFile(fullPath, category);
    if (error) return logError('HOT-RELOAD', `${key}: ${error.message} (versi lama tetap dipakai)`);
    plugins.set(key, plugin);
    rebuildIndex();
    logInfo('HOT-RELOAD', `Diperbarui: ${key}`);
}

function watchDir(dir, onEvent) {
    if (watchers.has(dir)) return;
    try {
        const w = fs.watch(dir, { persistent: false }, onEvent);
        w.on('error', () => { watchers.delete(dir); });
        watchers.set(dir, w);
    } catch (err) { logDebug('WATCH', err.message); }
}

let watching = false;

function watchPlugins() {
    if (watching || !fs.existsSync(pluginsDir)) return;
    watching = true;
    const watchCategory = (category) => {
        const dir = path.join(pluginsDir, category);
        if (watchers.has(dir)) return;
        watchDir(dir, (_evt, filename) => {
            if (!filename || !filename.endsWith('.js')) return;
            const key = `${category}/${filename}`;
            clearTimeout(timers.get(key));
            timers.set(key, setTimeout(() => { timers.delete(key); reloadFile(category, filename); }, 300));
        });
        // File bisa dibuat sebelum watcher folder baru terpasang: muat semuanya langsung.
        for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
            if (!plugins.has(`${category}/${file}`)) reloadFile(category, file);
        }
    };
    fs.readdirSync(pluginsDir).filter(isCategoryDir).forEach(watchCategory);
    // kategori (folder) baru yang dibuat saat bot berjalan, mis. lewat .svplug
    watchDir(pluginsDir, () => {
        setTimeout(() => {
            try { fs.readdirSync(pluginsDir).filter(isCategoryDir).forEach(watchCategory); } catch {}
        }, 300);
    });
}

/** Hentikan pemantauan file (tidak ada muat ulang otomatis lagi). */
function unwatchPlugins() {
    for (const w of watchers.values()) { try { w.close(); } catch {} }
    watchers.clear();
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    watching = false;
}

const isWatching = () => watching;

const findPlugin = (cmd) => commandIndex.get(String(cmd || '').toLowerCase()) || null;

function getPluginsByCategory() {
    const grouped = {};
    for (const [, plugin] of plugins) {
        if (!plugin.commands?.length) continue;
        (grouped[plugin.category] ||= []).push(plugin);
    }
    return grouped;
}

const getHooks = (name) => [...plugins.values()].filter((p) => typeof p[name] === 'function');


/* ───────────── Event socket oleh plugin ─────────────
 * Seluruh event socket dikumpulkan di handler.js (bindEvents). Handler memanggil emitPluginEvent() sehingga
 * plugin tetap bisa mendaftarkan penangan lewat `events: { 'group-participants.update': async (sock, payload) => {} }`.
 * Plugin dicari saat event terjadi → hot-reload / plugin baru langsung berlaku.
 * Nama event: group-participants.update, groups.update, group.join-request, call, messages.delete,
 * messages.reaction, presence.update, poll.vote (suara polling terdekripsi, dibuat oleh handler).
 */
function emitPluginEvent(name, sock, payload) {
    for (const p of plugins.values()) {
        const fn = p.events?.[name];
        if (typeof fn !== 'function') continue;
        Promise.resolve().then(() => fn(sock, payload)).catch((err) => logError(`EVENT:${p.fileName}`, err));
    }
}

module.exports = {
    plugins, commandIndex, pluginsDir,
    loadPlugins, loadPluginFile, reloadFile, watchPlugins, unwatchPlugins, isWatching,
    findPlugin, getPluginsByCategory, getHooks, emitPluginEvent
};
