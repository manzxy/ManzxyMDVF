/**
 * ALUR SATU PESAN — handleIncomingMessage():
 *   saring (duplikat / lama / bot sendiri) → baca teks semua jenis pesan → identitas & owner → database →
 *   hook before() → cari command → cek akses (owner, grup, admin, DAFTAR, PREMIUM, limit) → plugin.execute()
 * Semua kalimat penolakan ada di handler/texts.js.
 */
const { jidNormalizedUser } = require('../lib/wa/waCompat');
const config = require('../config');
const db = require('../lib/data/database');
const botSettings = require('../lib/core/botSettings');
const messageStore = require('../lib/core/messageStore');
const { isLid, resolveJid } = require('../lib/core/jid');
const { findPlugin, getPluginsByCategory, getHooks, loadPlugins } = require('../lib/bot/pluginLoader');
const { logCommand, logMessage, logError, logInfo, logWarn } = require('../lib/core/logger');
const { button } = require('../lib/wa/rich');
const { msgDedupeCache, getCachedGroupMetadata, commandQueue } = require('../lib/core/jid');
const { numberOf } = require('../lib/core/utils');
const TEXT = require('./texts');
const { extractAllText, extractQuotedInfo, parseCommandAndPrefix } = require('./parser');
const { resolveIdentity, participantMatches, needsRegister } = require('./access');
const { onGroupStub } = require('./groupDetect');


async function handleStatus(sock, m) {
    if (!m.message || m.key.fromMe) return;
    if (botSettings.get(sock).autoReadStatus) {
        try { await sock.readMessages([m.key]); } catch (err) { logWarn('STATUS', `Gagal melihat status: ${err.message}`); }
    }
}

async function handleIncomingMessage(sock, m) {
    try {
        let remote = m?.key?.remoteJid;
        if (!remote) return;

        // PANIC MODE (kill switch dari web panel): semua pesan diabaikan kecuali dari root owner,
        // supaya owner tetap bisa mengendalikan bot lewat WhatsApp saat darurat.
        if (db.data.settings?.panic) {
            const senderJid = m.key.participant || remote;
            const senderNum = numberOf(senderJid);
            const roots = config.ownerNumber.map((v) => String(v).replace(/[^0-9]/g, ''));
            if (!roots.includes(senderNum)) return;
        }

        // STATUS: status buatan akun bot sendiri yang berisi perintah (mis. posting ".ping") dijalankan seperti chat ke diri sendiri;
        // balasannya masuk ke chat bot sendiri (status tidak bisa dibalas). Status orang lain → hanya auto-lihat status.
        if (remote === 'status@broadcast') {
            if (!m.key.fromMe || !m.message || config.statusCommand === false) return await handleStatus(sock, m);
            const probe = parseCommandAndPrefix(extractAllText(m).body);
            if (!probe || !findPlugin(probe.command)) return await handleStatus(sock, m);
            remote = sock.getBotJid ? sock.getBotJid() : jidNormalizedUser(sock.user?.id || '');
            m = { ...m, key: { ...m.key, remoteJid: remote } };
        }
        // SALURAN: perintah yang diketik pemilik akun di saluran miliknya dilayani; pesan pengikut saluran diabaikan.
        if (remote.endsWith('@newsletter') && !(m.key.fromMe && config.channelCommand !== false)) return;
        if (!m.message) { if (m.messageStubType && remote.endsWith('@g.us')) await onGroupStub(sock, m); return; }
        if (m.key.id && msgDedupeCache.has(m.key.id)) return;
        if (m.key.id) msgDedupeCache.set(m.key.id, true);

        // Abaikan pesan lama (saat bot offline) agar command lama tidak dieksekusi ulang
        const ts = Number(m.messageTimestamp?.toNumber ? m.messageTimestamp.toNumber() : m.messageTimestamp) || 0;
        if (ts && Date.now() / 1000 - ts > config.ignoreOldSeconds) return;
        // Pesan keluar bot sendiri (Baileys mengirimnya balik sebagai event) → jangan diproses sebagai perintah
        if (m.key.fromMe && (sock.isOwnSent?.(m.key.id) || String(m.key.id || '').startsWith('BAE5'))) return;

        // Baca otomatis (pengaturan .setting autoread)
        if (!m.key.fromMe && botSettings.get(sock).autoRead) sock.readMessages([m.key]).catch(() => {});

        let { body, mtype, unwrapped, kind, data } = extractAllText(m);
        if (kind === 'unknown' || kind === 'protocol') return;
        if (kind === 'poll') messageStore.remember(m);          // dibutuhkan untuk membaca suara polling

        const from = remote;
        const isGroup = from.endsWith('@g.us');
        const botJid = sock.getBotJid ? sock.getBotJid() : jidNormalizedUser(sock.user?.id || '');
        const botNumber = numberOf(botJid);

        const identity = await resolveIdentity(sock, m, isGroup, botJid);
        const { jid: sender, number: senderNumber } = identity;

        const rootOwners = config.ownerNumber.map((v) => String(v).replace(/[^0-9]/g, ''));
        const isRootOwner = rootOwners.includes(senderNumber) || (!sock.isJadibot && (m.key.fromMe || senderNumber === botNumber));
        // Di jadibot: owner = nomor yang mengetik .jadibot (bukan akun yang dijadikan bot),
        // kecuali config.jadibot.botAccountIsOwner = true.
        const isOwner = sock.isJadibot
            ? Boolean(isRootOwner || senderNumber === sock.jadibotOwner || (Array.isArray(sock.jadibotAdmins) && sock.jadibotAdmins.includes(senderNumber)) || (config.jadibot.botAccountIsOwner && (m.key.fromMe || senderNumber === botNumber)))
            : Boolean(isRootOwner || m.key.fromMe || senderNumber === botNumber);
        const isSelfMode = sock.isJadibot ? sock.selfMode !== false : config.selfMode;
        if (isSelfMode && !isOwner) return;

        // Klik tombol / pilih list → catat di console (membantu memastikan klik sampai ke bot)
        if (kind === 'buttonreply' || kind === 'listreply') {
            logInfo('TOMBOL', `Klik diterima: "${body}" dari +${senderNumber}${m.key.fromMe ? ' (akun sendiri)' : ''}`);
        }

        const pushname = m.pushName || (m.key.fromMe ? config.ownerName : 'User');
        const botLabel = sock.isJadibot ? `JADIBOT +${sock.jadibotNumber}` : 'MAIN';

        // ── database ──
        const user = db.getUser(senderNumber, { name: m.key.fromMe ? undefined : m.pushName, jid: sender, lid: identity.lid });
        const group = isGroup ? db.getGroup(from) : null;
        db.recordMessage({ user, group });

        if (user?.banned.active && !isOwner) return;
        if (group?.banned.active && !isOwner) return;
        if (db.data.settings.maintenance && !isRootOwner) return;

        // EDISI GRATIS: semua user diperlakukan Premium & unlimited.
        const isPremium = true;
        const isUnlimited = true;
        const isRegistered = Boolean(user?.registered);

        logMessage({ pushname, senderNumber, isGroup, groupName: group?.name, mtype, body, botLabel });

        // statistik pesan per jadibot (dashboard panel web)
        if (sock.isJadibot && sock.jadibotNumber) db.recordBotMessage(sock.jadibotNumber, 'in');

        // menu kustom per jadibot (message builder dari panel web)
        if (sock.isJadibot && body) {
            const probeMenu = parseCommandAndPrefix(body);
            if (probeMenu && ['menu', 'help', 'start'].includes(probeMenu.command) && !probeMenu.text) {
                const recMenu = db.data.jadibots?.[sock.jadibotNumber];
                if (recMenu?.menuText) {
                    await sock.sendMessage(from, { text: recMenu.menuText });
                    return;
                }
            }
        }

        // auto-reply per jadibot (diatur dari panel web) — dilewati bila pesan berupa command
        if (sock.isJadibot && !m.key.fromMe && body && !body.startsWith(config.prefix)) {
            const ar = db.data.jadibots?.[sock.jadibotNumber]?.autoReply;
            if (ar?.enabled) {
                const low = String(body).toLowerCase();
                const rule = (ar.rules || []).find((r) => r.key && low.includes(String(r.key).toLowerCase()));
                const replyText = rule ? String(rule.reply || '') : String(ar.fallback || '');
                if (replyText) {
                    await sock.sendMessage(from, { text: replyText });
                    return;
                }
            }
        }

        const quoted = extractQuotedInfo(unwrapped);
        const lidMeta = (g) => getCachedGroupMetadata(sock, g);
        const toJid = (id) => resolveJid(sock, id, { groupJid: isGroup ? from : '', getMetadata: lidMeta });
        if (quoted?.sender && isLid(quoted.sender)) quoted.sender = await toJid(quoted.sender);     // LID → JID
        const baseCtx = {
            from, sender, senderNumber, botNumber, pushname, body, mtype, quoted, isGroup, toJid, isOwner, isRootOwner, isSelfMode,
            user, group, db, config, botLabel, senderLid: identity.lid, isPremium, isUnlimited, isRegistered,
            msgKind: kind, msgData: data, texts: TEXT, botSettings,
            // API ramah untuk plugin: kirim/balas/react/download tanpa isi jid & quoted manual
            client: require('../lib/wa/waWrapper').createClient({ sock, from, m, toJid })
        };

        // ── hook before() ──
        for (const p of getHooks('before')) {
            try { if (await p.before(m, { sock, ...baseCtx }) === true) return; } catch (err) { logError(`BEFORE:${p.fileName}`, err); }
        }

        const parsed = parseCommandAndPrefix(body, group?.settings.prefix);
        if (!parsed) return;
        const { usedPrefix, command, args, text } = parsed;
        const plugin = findPlugin(command);
        if (!plugin) return;

        const queued = commandQueue.push(async () => {
            const startTime = Date.now();
            let status = 'OK';
            let groupMetadata = null;
            let groupName = '';
            let isAdmin = false;
            let isBotAdmin = false;

            if (isGroup) {
                groupMetadata = await getCachedGroupMetadata(sock, from);
                groupName = groupMetadata?.subject || group?.name || 'Grup';
                if (groupMetadata) {
                    db.getGroup(from, { name: groupMetadata.subject, owner: groupMetadata.owner, description: groupMetadata.desc, size: groupMetadata.participants?.length });
                    const me = { number: botNumber, lid: sock.user?.lid };
                    for (const p of groupMetadata.participants || []) {
                        const admin = p.admin === 'admin' || p.admin === 'superadmin';
                        if (!admin) continue;
                        if (participantMatches(p, identity)) isAdmin = true;
                        if (participantMatches(p, me)) isBotAdmin = true;
                    }
                }
            }

            const prefix = usedPrefix || config.prefix;
            const reply = async (teks, opts = {}) => await sock.reply(from, teks, m, opts);
            const deny = async (msg) => { status = 'DITOLAK'; await reply(msg); };
            const denyButton = async (title, bodyText, buttons) => {
                status = 'DITOLAK';
                await sock.sendUniversalButton(from, { title, body: bodyText, footer: config.footerText }, buttons, m);
            };
            let typingShown = false;

            try {
                if (plugin.rootOwner && !isRootOwner) return await deny(TEXT.rootOwnerOnly);
                if (plugin.owner && !isOwner) return await deny(TEXT.ownerOnly);
                if (plugin.group && !isGroup) return await deny(TEXT.groupOnly);
                if (plugin.private && isGroup) return await deny(TEXT.privateOnly);
                if (plugin.admin && !(isAdmin || isOwner)) return await deny(TEXT.adminOnly);
                if (plugin.botAdmin && !isBotAdmin) return await deny(TEXT.botAdminOnly);

                // Wajib daftar (plugin `register: true` atau config.register.enforce)
                if (!isOwner && !isRegistered && needsRegister(plugin)) {
                    return await denyButton('🔐 BELUM TERDAFTAR', TEXT.registerRequired(prefix), [button.copy('📋 Salin contoh daftar', `${prefix}daftar ${String(pushname).replace(/[^\p{L}\p{N} ]/gu, '').trim().slice(0, 20) || 'Nama'}.17`)]);
                }
                // Fitur premium (plugin `premium: true`)
                // EDISI GRATIS: plugin premium tidak diblokir.
                // if (plugin.premium && !isPremium && !isOwner) { ... }

                if (group?.disabledCommands.includes(command) && !isOwner) return;
                if (group?.settings.mute && !isOwner && !isAdmin) return;
                if (group?.settings.adminOnly && !isOwner && !isAdmin) return;

                // Limit harian (user biasa saja). Biaya: plugin.limit, atau 1 kecuali kategori gratis.
                const cost = plugin.limit !== undefined ? Number(plugin.limit) : (config.limit.freeCategories.includes(plugin.category) ? 0 : 1);
                if (cost > 0 && !isUnlimited && user && user.limit.used + cost > user.limit.max) {
                    status = 'LIMIT';
                    return await sock.sendUniversalButton(from, {
                        title: TEXT.limitTitle,
                        body: TEXT.limitBody(user.limit.used, user.limit.max),
                        footer: config.footerText
                    }, [button.quick('⭐ Beli Premium', `${prefix}buyprem`)], m);
                }

                // "mengetik..." / "merekam suara..." sesuai pengaturan bot
                typingShown = true;
                botSettings.showActivity(sock, from);

                const result = await plugin.execute(sock, m, {
                    ...baseCtx, botNumber, args, text, command, prefix, groupMetadata, groupName, isAdmin, isBotAdmin, reply,
                    getPluginsByCategory, loadPlugins, handleIncomingMessage
                });
                if (cost > 0 && !isUnlimited && user && result !== false) { user.limit.used += cost; db.markDirty(); }     // dipotong hanya bila sukses (plugin return false = tidak dipotong)
                db.recordCommand({ user, group, command: plugin.commands[0] || command });
            } catch (err) {
                status = 'ERROR';
                logError(`PLUGIN:${plugin.category}/${plugin.fileName}`, err);
                // Error upload media ("reading 'attrs'" dll) → sambung ulang otomatis + pesan ramah, bukan stack error
                const mediaErr = require('../lib/wa/connectionGuard').POISON_RE.test(String(err?.message));
                if (mediaErr) sock.reportMediaFailure?.(err);
                try { await sock.reply(from, mediaErr ? TEXT.mediaRecovering : TEXT.commandError(command, err.message), m); } catch {}
            } finally {
                if (typingShown) botSettings.clearActivity(sock, from);
                logCommand({
                    command, prefix, args, pushname, senderNumber, isGroup, groupName, isOwner, botLabel, mtype,
                    execTime: Date.now() - startTime, status, queue: commandQueue.size
                });
            }
        });
        if (!queued) { try { await sock.reply(from, TEXT.busy, m); } catch {} }
    } catch (err) { logError('HANDLER', err); }
}


module.exports = { handleIncomingMessage };
