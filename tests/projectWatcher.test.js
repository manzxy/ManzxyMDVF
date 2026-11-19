const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { watchProject } = require('../lib/core/projectWatcher');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeout = 3500) {
    const end = Date.now() + timeout;
    while (!predicate() && Date.now() < end) await delay(30);
    assert.ok(predicate(), 'event perubahan tidak diterima sebelum batas waktu');
}

test('memantau perubahan file di semua folder sumber dan folder baru, tanpa data runtime', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manzxy-watch-'));
    const code = path.join(root, 'handler');
    const data = path.join(root, 'session');
    fs.mkdirSync(code);
    fs.mkdirSync(data);
    const events = [];
    const close = watchProject(root, (file) => events.push(file), { debounceMs: 40 });
    try {
        fs.writeFileSync(path.join(code, 'message.js'), 'module.exports = 1;');
        await waitFor(() => events.includes(path.join('handler', 'message.js')));
        events.length = 0;
        fs.writeFileSync(path.join(data, 'creds.json'), '{}');
        await delay(140);
        assert.deepEqual(events, []);
        const newDir = path.join(root, 'custom');
        fs.mkdirSync(newDir);
        await waitFor(() => events.includes('custom'));
        events.length = 0;
        fs.writeFileSync(path.join(newDir, 'feature.js'), 'module.exports = 1;');
        await waitFor(() => events.includes(path.join('custom', 'feature.js')));
    } finally {
        close();
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('direktori data kustom dikecualikan tanpa mengabaikan file lain', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manzxy-watch-'));
    const data = path.join(root, 'private-data');
    fs.mkdirSync(data);
    const events = [];
    const close = watchProject(root, (file) => events.push(file), { debounceMs: 40, ignoredPaths: [data] });
    try {
        fs.writeFileSync(path.join(data, 'db.json'), '{}');
        await delay(140);
        assert.deepEqual(events, []);
        fs.writeFileSync(path.join(root, 'README.md'), 'updated');
        await waitFor(() => events.includes('README.md'));
    } finally {
        close();
        fs.rmSync(root, { recursive: true, force: true });
    }
});
