#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { watchProject } = require('../lib/core/projectWatcher');

const root = path.resolve(__dirname, '..');
// Edisi free pairing-only: flag --qr lama diterjemahkan ke --pairing.
const botArgs = process.argv.slice(2).map((a) => (a === '--qr' ? '--pairing' : a));
// Baca lokasi data dari konfigurasi tanpa menjalankan bot di proses supervisor.
function dataPaths() {
    delete require.cache[require.resolve('../config')];
    const config = require('../config');
    require('../lib/core/configDefaults').apply(config);
    return [config.sessionName, config.database.path, path.dirname(path.resolve(root, config.database.path))]
        .map((entry) => path.resolve(root, entry))
        .filter((full) => full !== root && full.startsWith(root + path.sep));
}
let child;
let stopping = false;
let restarting = false;
let restartRequested = false;
let killTimer;

function start() {
    if (stopping) return;
    restarting = false;
    restartRequested = false;
    child = spawn(process.execPath, ['--expose-gc', path.join(root, 'index.js'), ...botArgs], {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, MANZXY_SUPERVISED: '1' }
    });
    child.on('error', (error) => console.error('[RELOAD] Gagal menjalankan bot:', error));
    child.on('exit', (code, signal) => {
        clearTimeout(killTimer);
        child = null;
        if (stopping) return;
        if (restarting || restartRequested) {
            console.log('[RELOAD] Menjalankan bot kembali...');
            start();
        } else {
            console.error(`[RELOAD] Bot berhenti (${signal || code}). Menunggu perubahan file untuk mencoba lagi.`);
        }
    });
}

function stopChild() {
    if (!child || child.killed) return;
    const current = child;
    current.kill('SIGTERM');
    killTimer = setTimeout(() => {
        if (child === current) {
            console.error('[RELOAD] Bot tidak berhenti dalam 10 detik; memaksa penghentian.');
            current.kill('SIGKILL');
        }
    }, 10000);
    killTimer.unref();
}

function requestRestart(file) {
    if (stopping) return;
    if (file === 'config.js') watch();
    console.log(`[RELOAD] Perubahan: ${file}. Memuat ulang seluruh bot...`);
    restartRequested = true;
    if (!child || restarting) return;
    restarting = true;
    stopChild();
}

let closeWatcher;

function watch() {
    closeWatcher?.();
    try {
        closeWatcher = watchProject(root, requestRestart, { ignoredPaths: dataPaths() });
    } catch (error) {
        console.error('[WATCH] Gagal membaca konfigurasi; tetap memantau kode:', error.message);
        closeWatcher = watchProject(root, requestRestart);
    }
}

watch();
start();

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        if (stopping) return;
        stopping = true;
        closeWatcher?.();
        if (child) {
            stopChild();
            child.once('exit', () => process.exit(0));
        } else process.exit(0);
    });
}
