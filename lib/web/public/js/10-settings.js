/* ═══════════════════════════════════════════════════════════════════════
   PENGATURAN & FITUR AKUN
   Auto-reply, jadwal, passkey, notifikasi, webhook, sub-akun, broadcast, voucher, backup.
   ───────────────────────────────────────────────────────────────────────
   Bagian dari bundle panel. Server menggabungkan js/*.js berurutan menjadi
   /panel/app.js, jadi browser tetap memuat SATU file (1 request).
   Urutan ditentukan awalan angka pada nama file. Semua modul berbagi satu
   skop global — jangan menambah "use strict" di sini (sudah di 00-core.js).
   ═══════════════════════════════════════════════════════════════════════ */

/* ───────────── pengaturan bot: auto-reply + jadwal ───────────── */

let bsNumber = '';
let bsRules = [];

function openBotSet(number) {
    bsNumber = number;
    $('modal-botset').classList.remove('hidden');
    $('bs-title').textContent = `⚙ PENGATURAN +${number}`;
    $('bs-s-jid').value = ''; $('bs-s-text').value = '';
    loadBotSet();
    loadBotAdmins();
    loadBotText();
}

async function loadBotSet() {
    try {
        const [ar, sc] = await Promise.all([
            api(`/api/jadibot/autoreply?number=${bsNumber}`),
            api(`/api/jadibot/schedule?number=${bsNumber}`)
        ]);
        $('bs-ar-on').checked = !!ar.enabled;
        $('bs-ar-fallback').value = ar.fallback || '';
        bsRules = (ar.rules || []).map((r) => ({ key: r.key, reply: r.reply }));
        renderBsRules();
        renderBsSched(sc.rows || []);
    } catch (err) { toast(err.message); }
}

function renderBsRules() {
    const el = $('bs-rules');
    el.innerHTML = bsRules.length ? bsRules.map((r, i) => `
        <div class="bs-rule">
          <input class="inp" data-rk="${i}" value="${esc(r.key)}" placeholder="kata kunci" style="max-width:150px">
          <input class="inp" data-rr="${i}" value="${esc(r.reply)}" placeholder="balasan otomatis">
          <button class="btn btn-sm btn-danger-soft" data-delrule="${i}" title="Hapus aturan">✕</button>
        </div>`).join('') : '<p class="empty">Belum ada aturan — pesan berisi kata kunci akan dibalas otomatis.</p>';
}

function renderBsSched(rows) {
    const el = $('bs-sched');
    el.innerHTML = rows.length ? rows.map((r) => `
        <div class="ev-row"><span class="ev-ico">${r.status === 'sent' ? '✅' : r.status === 'missed' ? '⚠️' : '⏰'}</span>
        <span class="ev-main"><b>${esc(r.text.slice(0, 60))}${r.text.length > 60 ? '…' : ''}</b>
        <small>${esc(r.jid)} · ${esc(r.atText)} · ${r.repeat === 'daily' ? 'harian' : 'sekali'} · ${r.status}</small></span>
        <button class="btn btn-sm btn-danger-soft" data-delsched="${r.id}" title="Hapus jadwal">✕</button></div>`).join('')
        : '<p class="empty">Belum ada pesan terjadwal.</p>';
}

async function saveAutoReply() {
    const rules = bsRules.map((r, i) => ({
        key: (document.querySelector(`[data-rk="${i}"]`)?.value || r.key).trim(),
        reply: (document.querySelector(`[data-rr="${i}"]`)?.value || r.reply).trim()
    })).filter((r) => r.key && r.reply);
    try {
        await api(`/api/jadibot/autoreply?number=${bsNumber}`, { method: 'POST', body: { enabled: $('bs-ar-on').checked, rules, fallback: $('bs-ar-fallback').value } });
        toast('Auto-reply tersimpan 🤖');
        $('modal-botset').classList.add('hidden');
    } catch (err) { toast(err.message); }
}

async function addSchedule() {
    const jid = $('bs-s-jid').value.trim();
    const text = $('bs-s-text').value.trim();
    const atV = $('bs-s-at').value;
    if (!jid || !text || !atV) return toast('Lengkapi tujuan, isi pesan, dan waktunya.');
    const at = new Date(atV).getTime();
    try {
        await api(`/api/jadibot/schedule?number=${bsNumber}`, { method: 'POST', body: { jid, text, at, repeat: $('bs-s-repeat').value } });
        toast('Jadwal dibuat ⏰');
        $('bs-s-jid').value = ''; $('bs-s-text').value = '';
        loadBotSet();
    } catch (err) { toast(err.message); }
}

async function delSchedule(id) {
    try {
        await api(`/api/jadibot/schedule/delete?number=${bsNumber}`, { method: 'POST', body: { id } });
        toast('Jadwal dihapus.');
        loadBotSet();
    } catch (err) { toast(err.message); }
}

/* ───────────── passkey / WebAuthn ───────────── */

const b64uEnc = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uDec = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

const passkeySupported = () => window.PublicKeyCredential !== undefined && window.isSecureContext;

async function loadPasskeys() {
    const el = $('pf-passkeys');
    if (!el) return;
    if (!passkeySupported()) {
        el.innerHTML = '<p class="empty">Passkey butuh HTTPS atau localhost.</p>';
        $('btn-passkey-add').classList.add('hidden');
        $('btn-passkey-login').classList.add('hidden');
        return;
    }
    try {
        const d = await api('/api/profile/passkey');
        el.innerHTML = (d.rows || []).length ? d.rows.map((p) => `
            <div class="session-row"><span class="session-main"><b>${esc(p.name)}</b><small>daftar ${esc(p.atText)}</small></span>
            <button class="btn btn-sm btn-danger-soft" data-delpk="${esc(p.id)}" title="Hapus passkey">✕</button></div>`).join('')
            : '<p class="empty">Belum ada passkey terdaftar.</p>';
    } catch { el.innerHTML = '<p class="empty">Gagal memuat passkey.</p>'; }
}

async function registerPasskey() {
    try {
        const opts = await api('/api/profile/passkey/start', { method: 'POST', body: {} });
        const cred = await navigator.credentials.create({
            publicKey: {
                challenge: b64uDec(opts.challenge),
                rp: opts.rp,
                user: { id: b64uDec(opts.user.id), name: opts.user.name, displayName: opts.user.displayName },
                pubKeyCredParams: opts.pubKeyCredParams,
                authenticatorSelection: opts.authenticatorSelection,
                timeout: opts.timeout,
                attestation: opts.attestation
            }
        });
        const result = await api('/api/profile/passkey/finish', {
            method: 'POST',
            body: { id: cred.id, rawId: cred.id, type: cred.type, response: {
                clientDataJSON: b64uEnc(cred.response.clientDataJSON),
                attestationObject: b64uEnc(cred.response.attestationObject)
            } }
        });
        toast(`Passkey terdaftar (${result.total}) 🔐`);
        loadPasskeys();
    } catch (err) { toast(err.name === 'NotAllowedError' ? 'Pendaftaran dibatalkan.' : err.message); }
}

async function removePasskey(id) {
    if (!(await askConfirm('Hapus passkey ini?', { ok: 'YA, HAPUS', danger: true }))) return;
    try {
        await api('/api/profile/passkey/delete', { method: 'POST', body: { id } });
        toast('Passkey dihapus.');
        loadPasskeys();
    } catch (err) { toast(err.message); }
}

async function loginPasskey() {
    const email = $('login-email').value.trim();
    if (!email) return showAuthMsg('error', 'Isi email dulu, lalu tekan passkey.');
    hideAuthMsg();
    try {
        const opts = await api('/api/auth/passkey/start', { method: 'POST', body: { email } });
        const cred = await navigator.credentials.get({
            publicKey: {
                challenge: b64uDec(opts.challenge),
                rpId: opts.rpId,
                allowCredentials: (opts.allowCredentials || []).map((c) => ({ type: c.type, id: b64uDec(c.id) })),
                userVerification: opts.userVerification,
                timeout: opts.timeout
            }
        });
        const r = await api('/api/auth/passkey/finish', {
            method: 'POST',
            body: { email, id: cred.id, rawId: cred.id, type: cred.type, response: {
                clientDataJSON: b64uEnc(cred.response.clientDataJSON),
                authenticatorData: b64uEnc(cred.response.authenticatorData),
                signature: b64uEnc(cred.response.signature)
            } }
        });
        enterApp(r.token);
    } catch (err) {
        showAuthMsg('error', err.name === 'NotAllowedError' ? 'Login passkey dibatalkan.' : err.message);
    }
}

/* ───────────── admin bot & menu kustom (modal botset) ───────────── */

async function loadBotAdmins() {
    try {
        const d = await api(`/api/jadibot/admins?number=${bsNumber}`);
        const el = $('bs-admins');
        el.innerHTML = (d.admins || []).length ? d.admins.map((n) => `
            <div class="ev-row"><span class="ev-ico">👤</span>
            <span class="ev-main"><b>+${esc(n)}</b><small>admin bot</small></span>
            <button class="btn btn-sm btn-danger-soft" data-deladm="${esc(n)}" title="Hapus admin">✕</button></div>`).join('')
            : '<p class="empty">Belum ada admin tambahan.</p>';
    } catch (err) { $('bs-admins').innerHTML = `<p class="empty">${esc(err.message)}</p>`; }
}

async function addBotAdmin() {
    const num = $('bs-adm-add').value.replace(/[^0-9]/g, '');
    if (!num) return toast('Isi nomor admin dulu.');
    try {
        await api(`/api/jadibot/admins?number=${bsNumber}`, { method: 'POST', body: { add: num } });
        toast('Admin ditambahkan 👥');
        $('bs-adm-add').value = '';
        loadBotAdmins();
    } catch (err) { toast(err.message); }
}

async function delBotAdmin(num) {
    try {
        await api(`/api/jadibot/admins?number=${bsNumber}`, { method: 'POST', body: { remove: num } });
        toast('Admin dihapus.');
        loadBotAdmins();
    } catch (err) { toast(err.message); }
}

async function loadBotText() {
    try {
        const d = await api(`/api/jadibot/bottext?number=${bsNumber}`);
        $('bs-menu').value = d.menu || '';
        $('bs-welcome').value = d.welcome || '';
    } catch { /* abaikan */ }
}

async function saveBotText() {
    try {
        await api(`/api/jadibot/bottext?number=${bsNumber}`, { method: 'POST', body: { menu: $('bs-menu').value, welcome: $('bs-welcome').value } });
        toast('Menu & sambutan tersimpan 📝');
    } catch (err) { toast(err.message); }
}

/* ───────────── notifikasi Telegram / Discord ───────────── */

async function loadChatNotify() {
    const sel = $('cn-platform');
    if (!sel) return;
    try {
        const d = await api('/api/profile/chatnotify');
        sel.value = d.platform || 'none';
        $('cn-token').value = d.token || '';
        $('cn-chatid').value = d.chatId || '';
        $('cn-url').value = d.url || '';
        cnToggle();
    } catch { sel.value = 'none'; cnToggle(); }
}

function cnToggle() {
    const p = $('cn-platform').value;
    $('cn-tg').classList.toggle('hidden', p !== 'telegram');
    $('cn-dc').classList.toggle('hidden', p !== 'discord');
}

async function saveChatNotify() {
    const body = { platform: $('cn-platform').value, token: $('cn-token').value.trim(), chatId: $('cn-chatid').value.trim(), url: $('cn-url').value.trim() };
    try {
        await api('/api/profile/chatnotify', { method: 'POST', body });
        toast(body.platform === 'none' ? 'Notifikasi chat dimatikan.' : 'Notifikasi chat disimpan 📢');
    } catch (err) { toast(err.message); }
}

async function testChatNotify() {
    try {
        const d = await api('/api/profile/chatnotify/test', { method: 'POST', body: {} });
        toast(d.ok ? 'Tes terkirim! Cek chat-mu ✅' : `Gagal: HTTP ${d.status}`);
    } catch (err) { toast(err.message); }
}

/* ───────────── perangkat login ───────────── */

async function loadSessions() {
    const el = $('pf-sessions');
    if (!el) return;
    try {
        const d = await api('/api/profile/sessions');
        const rows = d.rows || [];
        el.innerHTML = rows.length ? rows.map((s) => {
            const cur = Store.token && s.head && String(Store.token).startsWith(s.head);
            return `
            <div class="session-row${cur ? ' current' : ''}">
              <span class="session-main"><b>${esc(s.ua.split(')')[0] || 'Browser')}${s.ua.includes(')') ? ')' : ''}${cur ? ' <span class="badge-cur">perangkat ini</span>' : ''}</b>
                <small>${esc(s.ip)} · masuk ${esc(s.atText)}</small></span>
              ${cur ? '' : `<button class="btn btn-sm btn-danger-soft" data-revses="${s.id}" title="Cabut sesi ini">✕</button>`}
            </div>`;
        }).join('') : '<p class="empty">Tidak ada sesi aktif lain.</p>';
    } catch (err) { el.innerHTML = `<p class="empty">${esc(err.message)}</p>`; }
}

async function revokeSession(id) {
    try {
        await api('/api/profile/sessions/revoke', { method: 'POST', body: { id } });
        toast('Sesi dicabut.');
        loadSessions();
    } catch (err) { toast(err.message); }
}

async function revokeAllSessions() {
    if (!(await askConfirm('Keluar dari semua perangkat lain? Perangkat ini tetap masuk.', { ok: 'YA, CABUT SEMUA' }))) return;
    try {
        const d = await api('/api/profile/sessions/revoke', { method: 'POST', body: { all: true } });
        toast(`${d.revoked} sesi dicabut.`);
        loadSessions();
    } catch (err) { toast(err.message); }
}

/* ───────────── webhook event ───────────── */

const WH_LABELS = { topup: '💰 Saldo masuk', bot_online: '✅ Bot online', bot_offline: '❌ Bot offline', jadibot_created: '🤖 Jadibot baru', sewa_habis: '⌛ Sewa habis', test: '🧪 Tes' };

async function loadWebhook() {
    const box = $('wh-events');
    if (!box) return;
    try {
        const d = await api('/api/profile/webhook');
        $('wh-url').value = d.url || '';
        $('wh-secret').value = '';
        $('wh-secret').placeholder = d.hasSecret ? 'secret tersimpan (biarkan kosong = tetap)' : 'rahasia-mu';
        box.innerHTML = (d.events || []).map((e) => `
            <label class="sys-toggle"><input type="checkbox" data-whev="${e}" ${d.eventsOn.includes(e) ? 'checked' : ''}>
            <span>${WH_LABELS[e] || e}</span></label>`).join('');
    } catch (err) { box.innerHTML = `<p class="empty">${esc(err.message)}</p>`; }
}

async function saveWebhook() {
    const events = [...document.querySelectorAll('[data-whev]:checked')].map((c) => c.dataset.whev);
    const body = { url: $('wh-url').value.trim(), events };
    const secret = $('wh-secret').value.trim();
    if (secret) body.secret = secret;
    try {
        await api('/api/profile/webhook', { method: 'POST', body });
        toast('Webhook disimpan 🪝');
        loadWebhook();
    } catch (err) { toast(err.message); }
}

async function testWebhook() {
    try {
        const d = await api('/api/profile/webhook/test', { method: 'POST', body: {} });
        toast(d.ok ? `Tes terkirim! HTTP ${d.status} ✅` : `Gagal: ${d.error || 'HTTP ' + d.status}`);
    } catch (err) { toast(err.message); }
}

/* ───────────── sub-akun ───────────── */

async function loadSubs() {
    const el = $('pf-subs');
    if (!el) return;
    try {
        const d = await api('/api/profile/subs');
        el.innerHTML = (d.rows || []).length ? d.rows.map((r) => `
            <div class="session-row">
              <span class="session-main"><b>${esc(r.name)}</b><small>${esc(r.email)} · ${esc(r.lastText)}</small></span>
              <button class="btn btn-sm btn-danger-soft" data-delsub="${r.id}" title="Hapus sub-akun">✕</button>
            </div>`).join('') : '<p class="empty">Belum ada sub-akun.</p>';
    } catch (err) { el.innerHTML = `<p class="empty">${esc(err.message)}</p>`; }
}

async function addSub() {
    const email = $('sub-email').value.trim();
    const password = $('sub-pass').value;
    if (!email || !password) return toast('Isi email & password dulu.');
    try {
        await api('/api/profile/subs', { method: 'POST', body: { email, password } });
        toast('Sub-akun dibuat — bagikan loginnya 👥');
        $('sub-email').value = ''; $('sub-pass').value = '';
        loadSubs();
    } catch (err) { toast(err.message); }
}

async function deleteSub(id) {
    if (!(await askConfirm('Hapus sub-akun ini?', { ok: 'YA, HAPUS', danger: true }))) return;
    try {
        await api('/api/profile/subs/delete', { method: 'POST', body: { id } });
        toast('Sub-akun dihapus.');
        loadSubs();
    } catch (err) { toast(err.message); }
}

/* ───────────── timeline insiden bot ───────────── */

const EV_LABELS = { online: '✅ Online', offline: '❌ Terputus', expired: '⌛ Sewa habis', deleted: '🗑 Dihapus', error: '⚠️ Error', info: '• Info' };

async function openEvents(number) {
    $('modal-events').classList.remove('hidden');
    $('ev-title').textContent = `⏱ RIWAYAT +${number}`;
    $('ev-list').innerHTML = '<p class="empty">Memuat…</p>';
    $('ev-stats').innerHTML = '';
    try {
        api(`/api/jadibot/stats?number=${number}`).then((st) => {
            const max = Math.max(1, ...(st.days || []).map((d) => d.in + d.out));
            $('ev-stats').innerHTML = '<label class="lbl">📊 Pesan 7 hari</label>' + (st.days || []).map((d) => `
                <div class="cmd-row"><span class="cmd-name" style="min-width:78px">${d.date.slice(5)}</span>
                <span class="cmd-bar"><i style="width:${Math.round(((d.in + d.out) / max) * 100)}%"></i></span>
                <b class="cmd-count">${d.in}/${d.out}</b></div>`).join('') +
                '<p class="field-hint">masuk/keluar per hari</p>';
        }).catch(() => {});
        const d = await api(`/api/jadibot/events?number=${number}`);
        $('ev-list').innerHTML = (d.rows || []).length ? d.rows.map((e) => `
            <div class="ev-row"><span class="ev-ico">${esc(EV_LABELS[e.type] || e.type)}</span>
            <span class="ev-main"><b>${esc(e.note || e.type)}</b><small>${esc(e.atText)}</small></span></div>`).join('')
            : '<p class="empty">Belum ada kejadian tercatat.</p>';
    } catch (err) { $('ev-list').innerHTML = `<p class="empty">${esc(err.message)}</p>`; }
}

/* ───────────── broadcast (owner) ───────────── */

let bcTimer = null;

async function sendBroadcast() {
    const text = $('bc-text').value.trim();
    if (!text) return toast('Tulis pesan dulu.');
    if (!(await askConfirm(`Kirim broadcast ke ${$('bc-target').selectedOptions[0].text}? Pastikan pesan sudah benar.`, { title: 'BROADCAST', ok: 'YA, KIRIM', danger: true }))) return;
    try {
        const d = await api('/api/admin/broadcast', { method: 'POST', body: { target: $('bc-target').value, text, delayMin: Number($('bc-delay').value) || 0 } });
        toast(`Broadcast dimulai — ${d.total} tujuan 📣`);
        pollBroadcast();
    } catch (err) { toast(err.message); }
}

async function cancelBroadcast() {
    try { await api('/api/admin/broadcast/cancel', { method: 'POST', body: {} }); toast('Broadcast dibatalkan.'); } catch (err) { toast(err.message); }
}

async function pollBroadcast() {
    clearInterval(bcTimer);
    const tick = async () => {
        let d;
        try { d = await api('/api/admin/broadcast/status'); } catch { return; }
        const s = d.state;
        const el = $('bc-progress');
        if (!el) return clearInterval(bcTimer);
        if (!s) { el.innerHTML = ''; return; }
        el.innerHTML = s.running
            ? `<div class="bc-bar"><i style="width:${Math.round(((s.sent + s.failed) / Math.max(1, s.total)) * 100)}%"></i></div>
               <small class="muted">terkirim ${s.sent}/${s.total} · gagal ${s.failed}${s.cancel ? ' · Membatalkan…' : ''}</small>`
            : `<small class="muted">Selesai: ${s.sent}/${s.total} terkirim, ${s.failed} gagal.</small>`;
        if (!s.running) clearInterval(bcTimer);
    };
    await tick();
    bcTimer = setInterval(tick, 3000);
}

/* ───────────── laporan harian (owner) ───────────── */

async function loadDailyReport() {
    try {
        const d = await api('/api/admin/dailyreport');
        renderDailyReport(d);
    } catch { /* abaikan */ }
}

function renderDailyReport(d) {
    const state = $('dr-state');
    const btn = $('btn-dr');
    const hourEl = $('dr-hour');
    if (hourEl && d.hour !== undefined) hourEl.textContent = d.hour;
    if (state) { state.textContent = d.enabled ? 'AKTIF — laporan tiap malam' : 'OFF'; state.className = 'panic-state ' + (d.enabled ? 'on' : 'off'); }
    if (btn) btn.textContent = d.enabled ? 'MATIKAN LAPORAN' : 'AKTIFKAN LAPORAN';
}

async function toggleDailyReport() {
    const on = $('dr-state').classList.contains('off');
    try {
        const d = await api('/api/admin/dailyreport', { method: 'POST', body: { on } });
        renderDailyReport(d);
        toast(on ? 'Laporan harian diaktifkan 📬' : 'Laporan harian dimatikan.');
    } catch (err) { toast(err.message); }
}

/* ───────────── leaderboard referral ───────────── */

async function renderLeaderboard() {
    const el = $('ref-leaderboard');
    if (!el) return;
    try {
        const d = await api('/api/referral/leaderboard');
        const medal = ['🥇', '🥈', '🥉'];
        el.innerHTML = (d.rows || []).length ? d.rows.map((r) => `
            <div class="lb-row"><span class="lb-rank">${medal[r.rank - 1] || '#' + r.rank}</span>
            <span class="lb-main"><b>${esc(r.name)}</b><small>${esc(r.masked)}</small></span>
            <b class="lb-total">${r.total} invite</b></div>`).join('')
            : '<p class="empty">Belum ada yang mengundang — jadilah yang pertama! 🏆</p>';
    } catch { el.innerHTML = '<p class="empty">Gagal memuat.</p>'; }
}

/* ───────────── export CSV ───────────── */

async function downloadCsv(kind) {
    try {
        const res = await fetch(`/api/export/${kind}.csv`, { headers: { Authorization: 'Bearer ' + Store.token } });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Gagal membuat CSV.');
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${kind}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
        toast('CSV diunduh ⬇');
    } catch (err) { toast(err.message); }
}

/* ───────────── tur onboarding ───────────── */

const TOUR_STEPS = [
    { ico: '👋', title: 'SELAMAT DATANG!', text: 'Ini panel ManzxyMD. Tur singkat 4 langkah — lewati kalau sudah paham.' },
    { ico: '🧭', title: '1/4 — MENU SAMPING', text: 'Semua halaman ada di sidebar kiri. Di HP, ketuk tombol menu di kiri atas atau "Lainnya" di bar bawah.' },
    { ico: '🤖', title: '2/4 — JADIBOT', text: 'Menu JADIBOT: beli atau pairing nomor WhatsApp kedua jadi bot sendiri. Pakai saldo atau QRIS.' },
    { ico: '💰', title: '3/4 — TOPUP SALDO', text: 'Menu TOPUP SALDO: isi saldo lewat QRIS, saldo masuk otomatis & tercatat di riwayat.' },
    { ico: '⌨️', title: '4/4 — CTRL+K', text: 'Tekan Ctrl+K kapan saja untuk lompat cepat ke halaman/aksi mana pun. Selamat memakai! 🎉' }
];

let tourIdx = 0;

/** Progres tur disimpan per langkah supaya bisa dilanjutkan kapan saja. */
function loadTourStep() {
    try { return Math.max(0, Math.min(TOUR_STEPS.length - 1, Number(localStorage.getItem('mz_tour_step') || 0))); }
    catch { return 0; }
}
function saveTourStep(i) {
    try { localStorage.setItem('mz_tour_step', String(i)); } catch {}
}

function startTour() {
    tourIdx = loadTourStep();
    $('tour').classList.remove('hidden');
    renderTour();
}

function renderTour() {
    const s = TOUR_STEPS[tourIdx];
    if (!s) return endTour(true);
    saveTourStep(tourIdx);
    $('tour-ico').textContent = s.ico;
    $('tour-title').textContent = s.title;
    $('tour-text').textContent = s.text;
    $('tour-next').textContent = tourIdx >= TOUR_STEPS.length - 1 ? 'SELESAI ✓' : 'LANJUT →';
    // indikator progres: langkah sudah dilewati ditandai ✓
    const prog = $('tour-progress');
    if (prog) {
        prog.innerHTML = TOUR_STEPS.slice(1).map((_, i) =>
            `<i class="tour-dot${i < tourIdx - 1 ? ' done' : (i === tourIdx - 1 ? ' now' : '')}"></i>`).join('');
    }
    renderOnboardingChecklist();
}

function endTour(done) {
    $('tour').classList.add('hidden');
    try {
        localStorage.setItem('mz_tour_done', '1');
        localStorage.setItem('mz_tour_step', String(TOUR_STEPS.length - 1));
    } catch {}
    renderOnboardingChecklist();
    if (done) toast('Tur selesai — selamat memakai! 🎉');
}

