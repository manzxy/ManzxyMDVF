/* ═══════════════════════════════════════════════════════════════════════
   FONDASI
   Konstanta, state global, helper (toast, escape, modal konfirmasi, i18n).
   ───────────────────────────────────────────────────────────────────────
   Bagian dari bundle panel. Server menggabungkan js/*.js berurutan menjadi
   /panel/app.js, jadi browser tetap memuat SATU file (1 request).
   Urutan ditentukan awalan angka pada nama file. Semua modul berbagi satu
   skop global — jangan menambah "use strict" di sini (sudah di 00-core.js).
   ═══════════════════════════════════════════════════════════════════════ */

/* ManzxyMD Web Panel — client logic (v2: email/password + OAuth + profil) */
'use strict';

const $ = (id) => document.getElementById(id);

const Store = {
    get token() { return localStorage.getItem('mz_token'); },
    set token(v) { v ? localStorage.setItem('mz_token', v) : localStorage.removeItem('mz_token'); }
};

let ME = null;          // data /api/me
let MON = null;         // snapshot monitor terakhir
let qrTimer = null;
let qrTrxId = null;

/* ───────────── helpers ───────────── */

const fmtRp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, ms = 2600) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.add('hidden'), ms);
}

/* ───────────── modal konfirmasi (pengganti confirm() native) ───────────── */

let cfResolve = null;

function askConfirm(msg, { title = 'KONFIRMASI', ok = 'YA, LANJUT', danger = false } = {}) {
    return new Promise((resolve) => {
        cfResolve = resolve;
        $('cf-title').textContent = title;
        $('cf-msg').textContent = msg;
        const yes = $('cf-yes');
        yes.textContent = ok;
        yes.className = 'btn btn-block ' + (danger ? 'btn-danger' : 'btn-primary');
        $('modal-confirm').classList.remove('hidden');
        yes.focus();
    });
}

function settleConfirm(val) {
    if (!cfResolve) return;
    const r = cfResolve; cfResolve = null;
    $('modal-confirm').classList.add('hidden');
    r(val);
}

/* ───────────── notifikasi browser (opsional) ───────────── */

const notifPref = () => { try { return localStorage.getItem('mz_notif') === '1'; } catch { return false; } };

/** Beri notifikasi hanya bila diaktifkan user & tab sedang tidak terlihat. */
function notify(title, body) {
    if (!notifPref() || !('Notification' in window) || Notification.permission !== 'granted') return;
    if (!document.hidden) return;
    try { new Notification(title, { body, icon: '/panel/icon.svg' }); } catch {}
}

async function toggleNotifications() {
    const box = $('pf-notif');
    if (!box) return;
    if (box.checked) {
        if (!('Notification' in window)) { box.checked = false; return toast('Browser ini tidak mendukung notifikasi.'); }
        let perm = Notification.permission;
        if (perm === 'default') { try { perm = await Notification.requestPermission(); } catch { perm = 'denied'; } }
        if (perm !== 'granted') {
            box.checked = false;
            try { localStorage.removeItem('mz_notif'); } catch {}
            return toast('Izin notifikasi ditolak browser.');
        }
        try { localStorage.setItem('mz_notif', '1'); } catch {}
        toast('Notifikasi diaktifkan 🔔');
    } else {
        try { localStorage.removeItem('mz_notif'); } catch {}
        toast('Notifikasi dimatikan.');
    }
}

function renderNotifPref() {
    const box = $('pf-notif');
    if (box) box.checked = notifPref();
}

/* ───────────── preferensi: bahasa ───────────── */

/* ───────────── dua bahasa (ID/EN) ───────────── */

const I18N = {
    en: {
        DASHBOARD: 'DASHBOARD', MONITOR: 'MONITOR', JADIBOT: 'SUB-BOTS', '⭐ PREMIUM': '⭐ PREMIUM',
        '🎁 REFERRAL': '🎁 REFERRAL', 'TOPUP SALDO': 'ADD CREDIT', TRANSAKSI: 'TRANSACTIONS',
        '👑 OWNER': '👑 OWNER', '💻 SISTEM': '💻 SYSTEM', '🗄️ DATABASE': '🗄️ DATABASE', '📜 LOG': '📜 LOG', PROFIL: 'PROFILE',
        'AKTIVITAS 24 JAM TERAKHIR': 'LAST 24H ACTIVITY', 'HEATMAP 7 HARI': '7-DAY HEATMAP',
        'COMMAND TERPOPULER': 'TOP COMMANDS', 'JADIBOT TERBARU': 'LATEST SUB-BOTS',
        'Monitor Jadibot': 'Sub-bot Monitor', 'Buat Jadibot': 'Create Sub-bot', 'Riwayat Transaksi': 'Transaction History',
        'Profil': 'Profile', '🏆 LEADERBOARD REFERRAL': '🏆 REFERRAL LEADERBOARD',
        'BELI DENGAN SALDO': 'BUY WITH CREDIT', '⟳ REFRESH': '⟳ REFRESH',
        'Cari nomor…': 'Search number…'
    }
};

let LANG = 'id';

function applyLang(lang) {
    LANG = I18N[lang] ? lang : 'id';
    try { localStorage.setItem('mz_lang', LANG); } catch {}
    const dict = I18N[LANG];
    if (!dict || LANG === 'id') {
        // kembalikan teks asli dari atribut data-i18n-id (disimpan saat pertama kali ganti)
        document.querySelectorAll('[data-i18n]').forEach((el) => { if (el.dataset.i18nId) el.textContent = el.dataset.i18nId; });
    } else {
        document.querySelectorAll('[data-i18n]').forEach((el) => {
            if (!el.dataset.i18nId) el.dataset.i18nId = el.textContent;
            const key = el.dataset.i18nId.trim();
            if (dict[key]) el.textContent = dict[key];
        });
    }
    document.documentElement.setAttribute('lang', LANG);
}

async function setLang(lang) {
    applyLang(lang);
    try { await api('/api/profile/prefs', { method: 'POST', body: { lang } }); } catch { /* offline — tetap simpan lokal */ }
}

/* ───────────── analitik command ───────────── */

async function renderCommandStats() {
    const el = $('cmd-stats');
    if (!el) return;
    try {
        const d = await api('/api/commandstats');
        const max = Math.max(1, ...(d.top || []).map((c) => c.count));
        $('cmd-total').textContent = `${d.total.toLocaleString('id-ID')} command · ${d.unique} jenis`;
        el.innerHTML = (d.top || []).length
            ? d.top.map((c) => `
                <div class="cmd-row"><span class="cmd-name mono">${esc(c.command)}</span>
                <span class="cmd-bar"><i style="width:${Math.round((c.count / max) * 100)}%"></i></span>
                <b class="cmd-count">${c.count}</b></div>`).join('')
            : '<p class="empty">Belum ada command dijalankan.</p>';
    } catch { el.innerHTML = '<p class="empty">Gagal memuat.</p>'; }
}

