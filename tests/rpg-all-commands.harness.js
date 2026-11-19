/**
 * HARNESS — jalankan SEMUA command RPG lewat plugin.execute() dengan socket tiruan.
 * Bukan test otomatis; dipakai untuk mencari error runtime nyata:
 *   node tests/rpg-all-commands.harness.js
 * Keluaran: ringkasan OK / ERROR / DITOLAK per command.
 */
const path = require('path');

const replies = [];
const sock = {
    user: { id: '628111111111:1@s.whatsapp.net' },
    reply: async (a, b) => { replies.push(String(b ?? a)); return { key: { id: 'x' } }; },
    sendMessage: async (from, msg) => { replies.push(`[IMAGE] ${msg.caption || ''}`); return { key: { id: 'y' } }; },
    profilePictureUrl: async () => { throw new Error('no pp'); },
    readMessages: async () => {},
    getBotJid: () => '628111111111@s.whatsapp.net'
};

const db = require('../lib/data/database');
db.load();
db.markDirty = () => {};

const NUMBER = '628999888777';

function getUser() {
    const u = db.getUser(NUMBER, { name: 'Tester' });
    u.registered = true;
    u.regName = 'Tester';
    return u;
}

const suites = [
    ['rpg', ['rpg daftar warrior']],
    ['rpg', ['rpg']],
    ['rpg', ['rpg alloc str 3']],
    ['hunt', ['hunt']],
    ['hunt', ['hunt meadow']],
    ['hunt', ['hunt slime']],
    ['hunt', ['hunt --skill']],
    ['boss', ['boss']],
    ['inventory', ['inv']],
    ['inventory', ['use potion_s']],
    ['inventory', ['equip wooden_sword']],
    ['inventory', ['unequip weapon']],
    ['shop', ['shop']],
    ['shop', ['buy potion_s 2']],
    ['shop', ['sell potion_s 1']],
    ['craft', ['craft']],
    ['dungeon', ['dungeon']],
    ['raid', ['raid']],
    ['raid', ['tournament']],
    ['skill', ['skill']],
    ['skill', ['skill list']],
    ['skill', ['skill use second_wind']],
    ['heal', ['heal']],
    ['dailyrpg', ['dailyrpg']],
    ['dailyrpg', ['dailyrpg mingguan']],
    ['dailyrpg', ['dailyrpg klaim 1']],
    ['achieve', ['achieve']],
    ['bounty', ['bounty']],
    ['codex', ['codex']],
    ['event', ['event']],
    ['guild', ['guild']],
    ['party', ['party']],
    ['pet', ['pet']],
    ['rank', ['rank']],
    ['region', ['region']],
    ['season', ['season']],
    ['story', ['story']],
    ['monsters', ['monsters']],
    ['enchant', ['enchant']],
    ['prestige', ['prestige']],
    ['profile', ['profile']],
    ['profile', ['profile text']]
];

const pluginLoader = require('../lib/bot/pluginLoader');
pluginLoader.loadPlugins({ silent: true });

async function runOne(cmdline) {
    const parts = cmdline.trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    const plugin = pluginLoader.getPlugins ? null : null;
    const found = require('../lib/bot/pluginLoader').findPlugin(command);
    if (!found) return { status: 'MISSING' };
    const args = parts.slice(1);
    const user = getUser();
    const m = { key: { remoteJid: `${NUMBER}@s.whatsapp.net`, fromMe: false, id: 'ABC' }, pushName: 'Tester', message: {} };
    const ctx = {
        command, args, text: args.join(' '), prefix: '.',
        user, db, m,
        from: `${NUMBER}@s.whatsapp.net`,
        sender: `${NUMBER}@s.whatsapp.net`, senderNumber: NUMBER,
        pushname: 'Tester', isGroup: false, group: null,
        isOwner: true, isRootOwner: true, isPremium: true, isUnlimited: true, isRegistered: true,
        reply: sock.reply,
        config: require('../config')
    };
    const before = replies.length;
    try {
        await found.execute(sock, m, ctx);
        return { status: 'OK', out: replies.slice(before).join('\n') };
    } catch (err) {
        return { status: 'ERROR', err: `${err.message}\n${(err.stack || '').split('\n').slice(1, 4).join('\n')}`, out: replies.slice(before).join('\n') };
    }
}

(async () => {
    let ok = 0, bad = 0, missing = 0;
    for (const [, lines] of suites) {
        for (const line of lines) {
            const r = await runOne(line);
            if (r.status === 'OK') { ok++; console.log(`✅ .${line}`); if (process.env.SHOW) console.log('----\n' + (r.out || '(no reply)') + '\n----'); }
            else if (r.status === 'MISSING') { missing++; console.log(`⚠️  .${line} (plugin tidak ada)`); }
            else {
                bad++;
                console.log(`❌ .${line}\n   ${r.err}`);
                if (r.out) console.log(`   reply: ${r.out.split('\n').slice(0, 3).join(' | ').slice(0, 300)}`);
            }
        }
    }
    console.log(`\n== ${ok} OK • ${bad} ERROR • ${missing} MISSING ==`);
    process.exit(bad ? 1 : 0);
})();
