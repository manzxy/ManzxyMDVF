/* ═══════════════════════════════════════════════════════════════════════
   AUTENTIKASI
   Login, daftar, OTP, reset password, SSE realtime.
   ───────────────────────────────────────────────────────────────────────
   Bagian dari bundle panel. Server menggabungkan js/*.js berurutan menjadi
   /panel/app.js, jadi browser tetap memuat SATU file (1 request).
   Urutan ditentukan awalan angka pada nama file. Semua modul berbagi satu
   skop global — jangan menambah "use strict" di sini (sudah di 00-core.js).
   ═══════════════════════════════════════════════════════════════════════ */

/* ───────────── auth (login / register) ───────────── */

function setAuthTab(which) {
    $('tab-login').classList.toggle('active', which === 'login');
    $('tab-register').classList.toggle('active', which === 'register');
    $('form-login').classList.toggle('hidden', which !== 'login');
    $('form-register').classList.toggle('hidden', which !== 'register');
    const rf = $('form-reset');
    if (rf) rf.classList.toggle('hidden', which !== 'reset');
    hideAuthMsg();
}

function hideAuthMsg() {
    $('auth-error').classList.add('hidden');
    $('auth-ok').classList.add('hidden');
}

function showAuthMsg(kind, text) {
    const el = $('auth-' + kind);
    el.textContent = text;
    el.classList.remove('hidden');
}

async function doLogin(ev) {
    ev.preventDefault();
    const btn = $('btn-login');
    btn.disabled = true; btn.textContent = 'MASUK…';
    hideAuthMsg();
    try {
        const r = await api('/api/auth/login', {
            method: 'POST',
            body: {
                email: $('login-email').value.trim(),
                password: $('login-pass').value,
                totp: $('login-2fa').value.trim()
            }
        });
        Store.token = r.token;
        $('login-2fa-wrap').classList.add('hidden');
        $('login-2fa').value = '';
        enterApp(r.token);
    } catch (err) {
        if (String(err.message).includes('2FA') || err.needs2fa) $('login-2fa-wrap').classList.remove('hidden');
        showAuthMsg('error', err.message);
    } finally { btn.disabled = false; btn.textContent = 'MASUK →'; }
}

async function doRegister(ev) {
    ev.preventDefault();
    const pass = $('reg-pass').value;
    const waNumber = ($('reg-wa').value || '').replace(/[^0-9]/g, '');
    const otpCode = ($('reg-otp').value || '').replace(/\D/g, '');
    if (pass !== $('reg-pass2').value) return showAuthMsg('error', 'Konfirmasi password tidak cocok.');
    if (waNumber.length < 10) return showAuthMsg('error', 'Nomor WhatsApp wajib diisi (format 08xx).');
    if (otpCode.length !== 6) return showAuthMsg('error', 'Klik KIRIM OTP lalu masukkan 6 angka dari WhatsApp.');
    const btn = $('btn-register');
    btn.disabled = true; btn.textContent = 'MEMBUAT AKUN…';
    hideAuthMsg();
    try {
        const r = await api('/api/auth/register', {
            method: 'POST',
            body: {
                email: $('reg-email').value.trim(),
                password: pass,
                displayName: $('reg-name').value.trim(),
                waNumber,
                otp: otpCode,
                refCode: ($('reg-ref').value || '').trim().toUpperCase() || undefined
            }
        });
        Store.token = r.token;
        enterApp(r.token);
        const ref = r.referral;
        if (ref && ref.status === 'rejected') toast('Akun dibuat. Bonus referral tidak berlaku: ' + ref.reason, 5000);
        else toast('Akun dibuat! Nomor WhatsApp sudah terverifikasi ✅');
    } catch (err) {
        showAuthMsg('error', err.message);
    } finally { btn.disabled = false; btn.textContent = 'BUAT AKUN →'; }
}

/* ── cek kode referral sebelum daftar ── */
async function checkRefCode(code) {
    const clean = String(code || '').trim().toUpperCase();
    const hint = $('reg-ref-hint');
    if (!hint) return;
    if (!clean) {
        hint.textContent = 'Punya kode dari teman? Isi di sini untuk dapat bonus saldo.';
        hint.style.color = '';
        return;
    }
    try {
        const r = await api('/api/referral/check?code=' + encodeURIComponent(clean));
        hint.textContent = `Kode valid — diundang oleh ${r.referrer}. Kamu dapat ${fmtRp(r.bonus)} saldo.`;
        hint.style.color = 'var(--ok)';
    } catch (err) {
        hint.textContent = err.message;
        hint.style.color = 'var(--err)';
    }
}

/* ── OTP saat daftar ── */
let otpCooldownTimer = null;

async function sendRegisterOtp() {
    const btn = $('btn-send-otp');
    const waNumber = ($('reg-wa').value || '').replace(/[^0-9]/g, '');
    if (waNumber.length < 10) return showAuthMsg('error', 'Isi nomor WhatsApp dulu (contoh 08123456789).');
    hideAuthMsg();
    btn.disabled = true;
    btn.textContent = 'MENGIRIM…';
    try {
        const r = await api('/api/auth/otp/send', { method: 'POST', body: { waNumber } });
        $('reg-otp-wrap').classList.remove('hidden');
        $('reg-otp').focus();
        const menit = Math.max(1, Math.round((r.ttlSec || 300) / 60));
        $('reg-otp-hint').textContent = `Kode dikirim ke WhatsApp +${r.number}. Berlaku ${menit} menit.`;
        showAuthMsg('ok', `Kode OTP terkirim ke WhatsApp +${r.number} 📲`);
        startOtpCooldown(60);
    } catch (err) {
        showAuthMsg('error', err.message);
        btn.disabled = false; btn.textContent = 'KIRIM OTP';
    }
}

function startOtpCooldown(sec, btn = $('btn-send-otp')) {
    let left = sec;
    clearInterval(otpCooldownTimer);
    btn.disabled = true;
    btn.textContent = `KIRIM ULANG (${left})`;
    otpCooldownTimer = setInterval(() => {
        left--;
        if (left <= 0) {
            clearInterval(otpCooldownTimer);
            btn.disabled = false;
            btn.textContent = 'KIRIM ULANG OTP';
            return;
        }
        btn.textContent = `KIRIM ULANG (${left})`;
    }, 1000);
}

/* ───────────── SSE realtime (status monitor didorong server) ───────────── */

let evtSource = null;
const evtPrevStates = {};

function startEvents() {
    if (evtSource || typeof EventSource === 'undefined') return;
    try {
        evtSource = new EventSource('/api/events');
        evtSource.addEventListener('monitor', (e) => {
            let d = null;
            try { d = JSON.parse(e.data); } catch { return; }
            MON = d;
            // deteksi transisi offline → online untuk notifikasi
            for (const b of d.bots || []) {
                const prev = evtPrevStates[b.number];
                if (prev && !prev.connected && b.connected) notify('Bot terhubung ✅', `+${b.number} siap dipakai.`);
                evtPrevStates[b.number] = { connected: Boolean(b.connected) };
            }
            const active = document.querySelector('.tab.active')?.dataset.page;
            if (active !== 'monitor') return;
            $('mon-online').textContent = d.summary?.online ?? 0;
            $('mon-pairing').textContent = d.summary?.pairing ?? 0;
            $('mon-offline').textContent = d.summary?.offline ?? 0;
            renderBotList(d.bots || []);
        });
        // Live Activity Feed — isi awal timeline saat koneksi dibuka.
        evtSource.addEventListener('activity:init', (e) => {
            let d = null;
            try { d = JSON.parse(e.data); } catch { return; }
            if (typeof activityInit === 'function') activityInit(d.items || []);
        });
        // Event baru: masuk timeline + toast + badge sidebar.
        evtSource.addEventListener('activity', (e) => {
            let d = null;
            try { d = JSON.parse(e.data); } catch { return; }
            if (typeof pushActivity === 'function') pushActivity(d);
        });
        // kalau koneksi putus, EventSource menyambung ulang sendiri (retry: 5000)
    } catch { /* SSE opsional — polling manual tetap ada */ }
}

function stopEvents() {
    if (evtSource) { try { evtSource.close(); } catch {} evtSource = null; }
}

/* ── lupa password: OTP ke nomor terdaftar → password baru ── */

async function sendResetOtp() {
    const btn = $('btn-send-reset-otp');
    const waNumber = ($('reset-wa').value || '').replace(/[^0-9]/g, '');
    if (waNumber.length < 10) return showAuthMsg('error', 'Isi nomor WhatsApp yang tertaut ke akun (contoh 08123456789).');
    hideAuthMsg();
    btn.disabled = true; btn.textContent = 'MENGIRIM…';
    try {
        const r = await api('/api/auth/forgot', { method: 'POST', body: { waNumber } });
        $('reset-otp-wrap').classList.remove('hidden');
        $('reset-otp').focus();
        $('reset-otp-hint').textContent = `Kode dikirim ke WhatsApp +${r.number}. Berlaku ${Math.max(1, Math.round((r.ttlSec || 300) / 60))} menit.`;
        showAuthMsg('ok', `Kode OTP terkirim ke WhatsApp +${r.number} 📲`);
        startOtpCooldown(60, btn);
    } catch (err) {
        showAuthMsg('error', err.message);
        btn.disabled = false; btn.textContent = 'KIRIM OTP';
    }
}

async function doReset(ev) {
    ev.preventDefault();
    const waNumber = ($('reset-wa').value || '').replace(/[^0-9]/g, '');
    const otpCode = ($('reset-otp').value || '').replace(/\D/g, '');
    const pass = $('reset-pass').value;
    if (waNumber.length < 10) return showAuthMsg('error', 'Isi nomor WhatsApp dulu.');
    if (otpCode.length !== 6) return showAuthMsg('error', 'Klik KIRIM OTP lalu masukkan 6 angka dari WhatsApp.');
    if (pass !== $('reset-pass2').value) return showAuthMsg('error', 'Konfirmasi password tidak cocok.');
    const btn = $('btn-reset');
    btn.disabled = true; btn.textContent = 'MENYIMPAN…';
    hideAuthMsg();
    try {
        const r = await api('/api/auth/reset', { method: 'POST', body: { waNumber, otp: otpCode, newPassword: pass } });
        Store.token = r.token;
        $('reset-otp-wrap').classList.add('hidden');
        $('reset-otp').value = ''; $('reset-pass').value = ''; $('reset-pass2').value = '';
        enterApp(r.token);
        toast('Password baru tersimpan & kamu sudah masuk ✅');
    } catch (err) {
        showAuthMsg('error', err.message);
    } finally { btn.disabled = false; btn.textContent = 'SIMPAN PASSWORD BARU →'; }
}

