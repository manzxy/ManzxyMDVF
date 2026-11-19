/**
 * Eval & Exec (Root Owner saja) — satu file berisi mesin eval JS, exec shell, dan jalan pintas tanpa prefix:
 *   .eval <kode>   atau  > kode        → JavaScript (await, return, console.log)
 *   .exec <perintah> atau $ perintah   → shell di folder bot
 * Output TANPA batas: dipecah per ±60.000 karakter; > 180.000 karakter dikirim sebagai file .txt.
 */
const util = require('util');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const config = require('../../config');
const { logWarn } = require('../../lib/core/logger');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const ROOT = path.join(__dirname, '..', '..');
const CHUNK = 60000;
const FILE_THRESHOLD = 180000;

const fmt = (v) => (typeof v === 'string' ? v : util.inspect(v, { depth: 2, maxArrayLength: 50, breakLength: 80 }));

function withTimeout(promise, ms) {
    let t;
    return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`Timeout setelah ${ms / 1000} detik`)), ms); })]).finally(() => clearTimeout(t));
}

/** Jalankan kode JS: ekspresi (`1+1`) atau pernyataan (`const a=1; return a`), mendukung await & console.log. */
async function runEval(code, scope = {}, timeoutMs = 60000) {
    const logs = [];
    const fakeConsole = {};
    for (const k of ['log', 'info', 'warn', 'error', 'debug']) fakeConsole[k] = (...a) => logs.push(a.map(fmt).join(' '));
    const full = {
        require, fs, path, util, process, console: fakeConsole,
        db: require('../../lib/data/database'), config,
        jadibot: require('../../lib/bot/jadibotManager'), loader: require('../../lib/bot/pluginLoader'), payment: require('../../lib/billing/payment'),
        ...scope
    };
    const names = Object.keys(full);
    let fn;
    try { fn = new AsyncFunction(...names, `return (${code})`); }
    catch { fn = new AsyncFunction(...names, code); }
    const t0 = Date.now();
    const result = await withTimeout(fn(...names.map((n) => full[n])), timeoutMs);
    const parts = [];
    if (logs.length) parts.push(logs.join('\n'));
    if (result !== undefined || !logs.length) parts.push(fmt(result));
    return { output: parts.join('\n'), ms: Date.now() - t0 };
}

/** Jalankan perintah shell (tidak interaktif, ada batas waktu). */
function runExec(command, { timeoutMs = (config.exec?.timeoutSec || 120) * 1000, cwd = ROOT } = {}) {
    return new Promise((resolve) => {
        const t0 = Date.now();
        exec(command, { cwd, timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024, killSignal: 'SIGKILL', env: { ...process.env, TERM: 'dumb', CI: '1' } }, (err, stdout, stderr) => {
            resolve({ stdout: String(stdout || ''), stderr: String(stderr || ''), code: err ? (err.code ?? 1) : 0, killed: Boolean(err?.killed), ms: Date.now() - t0 });
        });
    });
}

function chunkText(text, size = CHUNK) {
    const out = [];
    while (text.length > size) {
        let cut = text.lastIndexOf('\n', size);
        if (cut < size * 0.5) cut = size;
        out.push(text.slice(0, cut));
        text = text.slice(cut).replace(/^\n/, '');
    }
    out.push(text);
    return out;
}

async function sendOutput(sock, jid, text, quoted, fileName = 'output.txt') {
    text = String(text ?? '').replace(/\x1b\[[0-9;]*m/g, '').trimEnd() || '(kosong)';
    if (text.length > FILE_THRESHOLD) {
        return await sock.sendMessage(jid, { document: Buffer.from(text, 'utf8'), mimetype: 'text/plain', fileName, caption: `📄 Output ${text.length.toLocaleString('id-ID')} karakter — dikirim sebagai file agar utuh.` }, { quoted });
    }
    for (const part of chunkText(text, CHUNK - 10)) await sock.sendMessage(jid, { text: '```' + part + '```' }, { quoted });
}

function formatExec(r) {
    const body = [r.stdout, r.stderr && `[stderr]\n${r.stderr}`].filter(Boolean).join('\n');
    const status = r.killed ? '⏱️ dihentikan (timeout)' : r.code === 0 ? '✅ selesai' : `❌ exit code ${r.code}`;
    return { text: body, footer: `${status} • ${r.ms} ms` };
}

const errText = (err) => String(err.stack || err.message);

module.exports = {
    name: 'Eval & Exec',
    command: ['eval', 'ev', 'exec', 'sh', 'bash', 'shell'],
    category: 'owner',
    description: 'Jalankan JavaScript / perintah shell, output tanpa batas (jalan pintas: "> kode", "$ perintah")',
    usage: '.eval <kode> • .exec <perintah>',
    rootOwner: true,      // WAJIB root owner: owner jadibot TIDAK boleh menjalankan kode di server

    async execute(sock, m, ctx) {
        const { from, text, command, reply, senderNumber } = ctx;
        const isEval = command === 'eval' || command === 'ev';

        if (!text) {
            return await reply(isEval
                ? '*🧪 EVAL*\nContoh:\n• `.eval 1+1`\n• `.eval await db.summary()`\n• `.eval const u = db.getUser("628xx"); return u.limit`\n\nTanpa prefix: `> kode`\nVariabel: sock, m, ctx, db, config, jadibot, loader, payment, fs, path, require\nOutput tidak dipotong (otomatis dipecah / dikirim sebagai file bila sangat besar).'
                : `*💻 EXEC*\nContoh:\n• \`.exec ls -la\`\n• \`.exec pm2 ls\`\n• \`.exec free -m && df -h\`\n• \`.exec npm i axios\`\n\nTanpa prefix: \`$ perintah\`\nTidak interaktif • batas waktu ${config.exec.timeoutSec} dtk • output tidak dipotong.`);
        }

        if (isEval) {
            logWarn('EVAL', `+${senderNumber}: ${text.slice(0, 120)}`);
            try {
                const r = await runEval(text, { sock, m, ctx });
                await sendOutput(sock, from, r.output, m, 'eval-output.txt');
                await reply(`✅ ${r.ms} ms`);
            } catch (err) { await reply(`❌ *ERROR:*\n\`\`\`${errText(err)}\`\`\``); }
            return;
        }
        logWarn('EXEC', `+${senderNumber}: ${text.slice(0, 160)}`);
        const r = formatExec(await runExec(text));
        await sendOutput(sock, from, r.text, m, 'exec-output.txt');
        await reply(r.footer);
    },

    /** Jalan pintas tanpa prefix: "> kode" / "=> kode" (eval) dan "$ perintah" (exec). */
    async before(m, ctx) {
        const { sock, from, body, isRootOwner } = ctx;
        if (!isRootOwner || !body) return false;
        const ev = body.match(/^=?>\s+([\s\S]+)$/);
        const ex = body.match(/^\$\s+([\s\S]+)$/);
        if (!ev && !ex) return false;

        if (ev) {
            logWarn('EVAL', `+${ctx.senderNumber} (>): ${ev[1].slice(0, 120)}`);
            try { const r = await runEval(ev[1], { sock, m, ctx }); await sendOutput(sock, from, r.output, m, 'eval-output.txt'); }
            catch (err) { await sock.reply(from, `❌ \`\`\`${errText(err)}\`\`\``, m); }
            return true;
        }
        logWarn('EXEC', `+${ctx.senderNumber} ($): ${ex[1].slice(0, 160)}`);
        const r = formatExec(await runExec(ex[1]));
        await sendOutput(sock, from, r.text, m, 'exec-output.txt');
        await sock.reply(from, r.footer, m);
        return true;
    },

    // Untuk pengujian
    _runExec: runExec, _chunkText: chunkText
};
