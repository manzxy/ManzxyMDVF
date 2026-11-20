/* ═══════════════════════════════════════════════════════════════════════
   BOOT
   Event delegation, modal pairing, 2FA, switch tema, auto-refresh, onBoot().
   ───────────────────────────────────────────────────────────────────────
   Bagian dari bundle panel. Server menggabungkan js/*.js berurutan menjadi
   /panel/app.js, jadi browser tetap memuat SATU file (1 request).
   Urutan ditentukan awalan angka pada nama file. Semua modul berbagi satu
   skop global — jangan menambah "use strict" di sini (sudah di 00-core.js).
   ═══════════════════════════════════════════════════════════════════════ */

/* ───────────── event delegation (pengganti inline onclick, aman untuk CSP) ───────────── */

document.addEventListener('click', (e) => {
    // navigasi halaman via data-goto (termasuk yang dibuat dinamis di empty state)
    const goto = e.target.closest('[data-goto]');
    if (goto) { e.preventDefault(); switchPage(goto.dataset.goto); return; }

    // banner masa aktif: tombol tutup dibuat dinamis oleh 55-extra.js
    if (e.target.closest('#btn-expire-close')) return dismissExpireBanner();

    // aksi admin (data-adm / data-acc) dicek dulu
    const rev = e.target.closest('[data-revert]');
    if (rev) return revertAudit(rev.dataset.revert);
    const rvses = e.target.closest('[data-revses]');
    if (rvses) return revokeSession(rvses.dataset.revses);
    const dlsub = e.target.closest('[data-delsub]');
    if (dlsub) return deleteSub(dlsub.dataset.delsub);
    const dlv = e.target.closest('[data-delv]');
    if (dlv) return deleteVoucher(dlv.dataset.delv);
    const dpk = e.target.closest('[data-delpk]');
    if (dpk) return removePasskey(dpk.dataset.delpk);
    const dadm = e.target.closest('[data-deladm]');
    if (dadm) return delBotAdmin(dadm.dataset.deladm);
    const adm = e.target.closest('[data-adm]');
    if (adm) return adminUserAction(adm.dataset.adm, adm.dataset.num);
    const acc = e.target.closest('[data-acc]');
    if (acc) return adminAccountAction(acc.dataset.acc, acc.dataset.id, acc.dataset.role);

    // database explorer: klik kartu koleksi (dicek dulu, sebelum return data-act)
    const colCard = e.target.closest('[data-dbcol]');
    if (colCard) return selectDbCollection(colCard.dataset.dbcol);

    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const num = el.dataset.num;
    if (act === 'stop') actStop(num, false);
    else if (act === 'start') actStart(num);
    else if (act === 'mode') actMode(num);
    else if (act === 'delete') actStop(num, true);
    else if (act === 'pack') selectPack(el.dataset.id);
    else if (act === 'unlink') unlinkProvider(el.dataset.provider);
    else if (act === 'events') openEvents(num);
    else if (act === 'botset') openBotSet(num);
    else if (act === 'showcode') showPairingModal(el.dataset.num, el.dataset.code);
    else if (act === 'copy-code') copyPairingCode();
    else if (act === 'close-modal') closePairingModal();
});

/* ───────────── modal pairing (kode tampil di web, bukan dikirim ke WA) ───────────── */

let pairPollTimer = null;
let pairNumber = null;

const prettyCode = (code) => (String(code || '').match(/.{1,4}/g) || []).join('-');

function showPairingModal(number, code) {
    pairNumber = number;
    $('pm-number').textContent = '+' + number;
    $('pm-code').textContent = prettyCode(code || '········');
    $('pair-status').textContent = 'Menunggu kamu memasukkan kode di WhatsApp…';
    $('pair-status').className = 'pm-status waiting';
    $('pm-steps').classList.remove('hidden');
    $('pm-done').classList.add('hidden');
    $('modal-pairing').classList.remove('hidden');
    startPairPoll();
}

function closePairingModal() {
    $('modal-pairing').classList.add('hidden');
    clearInterval(pairPollTimer);
    pairPollTimer = null;
    pairNumber = null;
    refreshMe(); refreshMonitor();
}

function copyPairingCode() {
    const code = $('pm-code').textContent.replace(/-/g, '');
    if (navigator.clipboard) navigator.clipboard.writeText(code).then(() => toast('Kode disalin!'));
    else toast('Salin manual: ' + code);
}

function startPairPoll() {
    clearInterval(pairPollTimer);
    pairPollTimer = setInterval(async () => {
        if (!pairNumber || $('modal-pairing').classList.contains('hidden')) return clearInterval(pairPollTimer);
        try {
            const s = await api('/api/jadibot/status?number=' + encodeURIComponent(pairNumber));
            if (s.pairingCode && $('pm-code').textContent.includes('·')) {
                $('pm-code').textContent = prettyCode(s.pairingCode);
            }
            if (s.connected || s.state === 'open') {
                $('pair-status').textContent = '✅ Terhubung! Bot siap dipakai.';
                $('pair-status').className = 'pm-status ok';
                $('pm-steps').classList.add('hidden');
                $('pm-done').classList.remove('hidden');
                clearInterval(pairPollTimer);
                notify('Bot terhubung ✅', `+${pairNumber} siap dipakai.`);
                refreshMe();
            } else if (s.state === 'pairing') {
                $('pair-status').textContent = 'Menunggu kamu memasukkan kode di WhatsApp…';
                $('pair-status').className = 'pm-status waiting';
            } else {
                $('pair-status').textContent = 'Status: ' + (s.state || 'connecting') + '…';
                $('pair-status').className = 'pm-status waiting';
            }
        } catch { /* biarkan polling lanjut */ }
    }, 4000);
}

/* ───────────── 2FA TOTP (profil) ───────────── */

async function setup2fa() {
    const btn = $('btn-2fa-setup');
    btn.disabled = true;
    try {
        const r = await api('/api/profile/2fa/setup', { method: 'POST', body: {} });
        $('twofa-setup').classList.remove('hidden');
        $('tfa-secret').textContent = r.secret.replace(/(.{4})/g, '$1 ').trim();
        if (r.qrDataUrl) { $('tfa-qr').src = r.qrDataUrl; $('tfa-qr').classList.remove('hidden'); }
        else $('tfa-qr').classList.add('hidden');
        $('tfa-link').href = r.otpauth;
    } catch (err) { toast(err.message); }
    finally { btn.disabled = false; }
}

async function enable2fa() {
    const token = $('tfa-token').value.trim();
    if (token.length !== 6) return toast('Masukkan 6 angka dari aplikasi authenticator.');
    try {
        await api('/api/profile/2fa/enable', { method: 'POST', body: { token } });
        toast('2FA aktif! 🔒');
        $('twofa-setup').classList.add('hidden');
        $('tfa-token').value = '';
        refreshMe();
    } catch (err) { toast(err.message); }
}

async function disable2fa() {
    const token = $('tfa-off-token').value.trim();
    if (token.length !== 6) return toast('Masukkan kode 2FA untuk konfirmasi.');
    if (!(await askConfirm('Matikan 2FA? Akun hanya dilindungi password.', { ok: 'YA, MATIKAN', danger: true }))) return;
    try {
        await api('/api/profile/2fa/disable', { method: 'POST', body: { token } });
        toast('2FA dimatikan.');
        $('tfa-off-token').value = '';
        refreshMe();
    } catch (err) { toast(err.message); }
}

/* ───────────── boot ───────────── */

document.getElementById('form-login').addEventListener('submit', doLogin);
document.getElementById('form-register').addEventListener('submit', doRegister);
document.getElementById('form-reset').addEventListener('submit', doReset);
document.getElementById('link-forgot').addEventListener('click', () => setAuthTab('reset'));
document.getElementById('link-back-login').addEventListener('click', () => setAuthTab('login'));
document.getElementById('btn-send-reset-otp').addEventListener('click', sendResetOtp);
document.getElementById('tab-login').addEventListener('click', () => setAuthTab('login'));
document.getElementById('tab-register').addEventListener('click', () => setAuthTab('register'));
document.getElementById('btn-logout').addEventListener('click', () => logout(false));

/* command palette */
document.getElementById('palette-in').addEventListener('input', (e) => { paletteIdx = 0; renderPalette(e.target.value); });
document.getElementById('palette-in').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); paletteIdx = Math.min(paletteItems.length - 1, paletteIdx + 1); renderPalette(e.target.value); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); paletteIdx = Math.max(0, paletteIdx - 1); renderPalette(e.target.value); }
    else if (e.key === 'Enter') { e.preventDefault(); runPaletteItem(paletteIdx); }
});
document.getElementById('palette-list').addEventListener('click', (e) => {
    const btn = e.target.closest('.palette-item');
    if (btn) runPaletteItem(Number(btn.dataset.i));
});
$('palette').addEventListener('click', (e) => { if (e.target.id === 'palette') closePalette(); });
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if ($('palette').classList.contains('hidden')) openPalette(); else closePalette();
    } else if (e.key === 'Escape') {
        if (!$('palette').classList.contains('hidden')) closePalette();
        if (!$('modal-confirm').classList.contains('hidden')) settleConfirm(false);
    } else if (e.key === '?' && !e.ctrlKey && !e.metaKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) {
        e.preventDefault();
        openPalette();
    }
});

/* panic mode + audit (owner) */
document.getElementById('btn-panic').addEventListener('click', togglePanic);
document.getElementById('btn-refresh-audit').addEventListener('click', refreshAudit);

/* personal API key */
document.getElementById('btn-apikey-gen').addEventListener('click', () => apiKeyAction('generate'));
document.getElementById('btn-apikey-revoke').addEventListener('click', () => apiKeyAction('revoke'));
document.getElementById('btn-apikey-copy').addEventListener('click', copyApiKey);

/* backup sesi */
document.getElementById('btn-sesi-export').addEventListener('click', exportMySession);
document.getElementById('btn-sesi-import').addEventListener('click', importMySession);

/* live log */
document.getElementById('log-filter').addEventListener('change', (e) => { logFilter = e.target.value; renderLogLines(); });
document.getElementById('btn-log-pause').addEventListener('click', toggleLogPause);
document.getElementById('log-search').addEventListener('input', (e) => { logSearch = e.target.value; renderLogLines(); });

/* perangkat login, webhook, sub-akun */
document.getElementById('btn-sessions-all').addEventListener('click', revokeAllSessions);
document.getElementById('btn-wh-save').addEventListener('click', saveWebhook);
document.getElementById('btn-wh-test').addEventListener('click', testWebhook);
document.getElementById('btn-sub-add').addEventListener('click', addSub);

/* tombol passkey di halaman login (butuh secure context) */
if (passkeySupported()) document.getElementById('btn-passkey-login').classList.remove('hidden');

/* preferensi tampilan */
document.getElementById('pf-lang').addEventListener('change', (e) => setLang(e.target.value));

/* CSV */
document.getElementById('btn-csv-orders').addEventListener('click', () => downloadCsv('orders'));
document.getElementById('btn-csv-ledger').addEventListener('click', () => downloadCsv('ledger'));

/* broadcast + laporan harian (owner) */
document.getElementById('btn-bc-send').addEventListener('click', sendBroadcast);
document.getElementById('btn-bc-cancel').addEventListener('click', cancelBroadcast);
document.getElementById('btn-dr').addEventListener('click', toggleDailyReport);
document.getElementById('bc-text').addEventListener('input', bcPreview);

/* voucher + backup + widget */
document.getElementById('btn-voucher').addEventListener('click', redeemVoucher);
document.getElementById('btn-v-add').addEventListener('click', createVoucher);
document.getElementById('btn-backup-dl').addEventListener('click', downloadBackup);
document.getElementById('btn-widget-copy').addEventListener('click', copyWidget);

/* pengaturan bot (auto-reply + jadwal) */
document.getElementById('bs-ar-add').addEventListener('click', () => { bsRules.push({ key: '', reply: '' }); renderBsRules(); });
document.getElementById('bs-save').addEventListener('click', saveAutoReply);
document.getElementById('bs-s-add').addEventListener('click', addSchedule);
document.getElementById('bs-close').addEventListener('click', () => $('modal-botset').classList.add('hidden'));
$('modal-botset').addEventListener('click', (e) => {
    if (e.target.id === 'modal-botset') e.target.classList.add('hidden');
    const dr = e.target.closest('[data-delrule]');
    if (dr) { bsRules.splice(Number(dr.dataset.delrule), 1); renderBsRules(); }
    const ds = e.target.closest('[data-delsched]');
    if (ds) delSchedule(ds.dataset.delsched);
});

/* notifikasi chat */
document.getElementById('cn-platform').addEventListener('change', cnToggle);
document.getElementById('btn-cn-save').addEventListener('click', saveChatNotify);
document.getElementById('btn-cn-test').addEventListener('click', testChatNotify);

/* passkey */
document.getElementById('btn-passkey-add').addEventListener('click', registerPasskey);
document.getElementById('btn-passkey-login').addEventListener('click', loginPasskey);

/* admin bot + menu kustom */
document.getElementById('bs-adm-btn').addEventListener('click', addBotAdmin);
document.getElementById('bs-text-save').addEventListener('click', saveBotText);

/* modal riwayat bot */
document.getElementById('ev-close').addEventListener('click', () => $('modal-events').classList.add('hidden'));
$('modal-events').addEventListener('click', (e) => { if (e.target.id === 'modal-events') e.target.classList.add('hidden'); });

/* tur onboarding */
document.getElementById('tour-next').addEventListener('click', () => { tourIdx++; renderTour(); });
document.getElementById('tour-skip').addEventListener('click', () => endTour(false));

document.getElementById('cf-yes').addEventListener('click', () => settleConfirm(true));
document.getElementById('cf-no').addEventListener('click', () => settleConfirm(false));
document.getElementById('modal-confirm').addEventListener('click', (e) => { if (e.target.id === 'modal-confirm') settleConfirm(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('modal-confirm').classList.contains('hidden')) settleConfirm(false); });
document.getElementById('mon-q').addEventListener('input', (e) => {
    monFilter = (e.target.value || '').replace(/[^0-9]/g, '');
    renderBotList(MON?.bots || []);
});
document.getElementById('pf-notif').addEventListener('change', toggleNotifications);
document.getElementById('btn-buy-jadibot').addEventListener('click', buyJadibot);
document.getElementById('btn-check-qr').addEventListener('click', checkQrNow);
document.getElementById('btn-refresh-monitor').addEventListener('click', refreshMonitor);
document.getElementById('jb-duration-saldo').addEventListener('change', () => { const c = $('jb-days-custom'); if (c) c.value = ''; updateJadibotPage(); });
document.getElementById('jb-days-custom').addEventListener('input', updateJadibotPage);
document.getElementById('btn-send-otp').addEventListener('click', sendRegisterOtp);
document.getElementById('btn-pf-otp').addEventListener('click', sendProfileOtp);
document.getElementById('pf-wa').addEventListener('input', () => {
    const has = !document.getElementById('pf-otp-wrap').classList.contains('hidden');
    if (has) document.getElementById('pf-otp').value = '';
});
document.getElementById('reg-wa').addEventListener('input', () => {
    // nomor berubah setelah OTP diminta → kode lama untuk nomor lain, minta ulang
    const has = !document.getElementById('reg-otp-wrap').classList.contains('hidden');
    if (has) document.getElementById('reg-otp').value = '';
});
document.getElementById('btn-refresh-prem').addEventListener('click', refreshPremium);
document.getElementById('btn-buy-prem').addEventListener('click', buyPremium);
document.getElementById('btn-buy-prem-qris').addEventListener('click', buyPremiumQris);
document.getElementById('btn-check-prem-qr').addEventListener('click', checkPremQrNow);
document.getElementById('pm-package').addEventListener('change', () => { const c = $('pm-days-custom'); if (c) c.value = ''; updatePremPrice(); });
document.getElementById('pm-days-custom').addEventListener('input', updatePremPrice);
document.getElementById('btn-refresh-ref').addEventListener('click', refreshReferral);
document.getElementById('btn-ref-copy').addEventListener('click', () => copyText($('ref-code').textContent, 'Kode referral disalin 📋'));
document.getElementById('btn-ref-copylink').addEventListener('click', () => copyText($('ref-link').textContent, 'Link undangan disalin 📋'));
document.getElementById('reg-ref').addEventListener('blur', (e) => checkRefCode(e.target.value));
document.getElementById('reg-ref').addEventListener('input', (e) => {
    const v = e.target.value.toUpperCase().trim();
    e.target.value = v;
    if (v.length >= 4) checkRefCode(v); else checkRefCode('');
});
const ftYear = document.getElementById('ft-year');
if (ftYear) ftYear.textContent = String(new Date().getFullYear());
document.getElementById('btn-topup-custom').addEventListener('click', submitCustomTopup);
document.getElementById('topup-custom').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitCustomTopup(); } });
document.getElementById('btn-save-profile').addEventListener('click', saveProfile);
document.getElementById('btn-save-pw').addEventListener('click', savePassword);
document.getElementById('btn-save-slots').addEventListener('click', saveSlots);
document.getElementById('btn-save-promo').addEventListener('click', savePromo);
document.getElementById('btn-refresh-owner').addEventListener('click', refreshOwner);
/* Listener halaman SISTEM — pakai guard supaya tidak crash kalau HTML
 * versi lama masih ter-cache di browser (elemen belum ada). */
const btnRefreshSys = document.getElementById('btn-refresh-sys');
if (btnRefreshSys) btnRefreshSys.addEventListener('click', () => refreshSysinfo(true));
const sysAutoEl = document.getElementById('sys-auto');
if (sysAutoEl) sysAutoEl.addEventListener('change', toggleSysAuto);
document.querySelectorAll('.sys-range .chip-btn').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.sys-range .chip-btn').forEach((x) => x.classList.toggle('active', x === b));
    sysRange = Number(b.dataset.range) || 0;
    renderSysGraphs();
}));
document.querySelectorAll('#sys-traf-range .chip-btn').forEach((b) => b.addEventListener('click', async () => {
    document.querySelectorAll('#sys-traf-range .chip-btn').forEach((x) => x.classList.toggle('active', x === b));
    trafHours = Number(b.dataset.hours) || 24;
    await refreshTraffic();
}));
document.getElementById('btn-save-google').addEventListener('click', () => saveOauthProvider('google'));
document.getElementById('btn-save-github').addEventListener('click', () => saveOauthProvider('github'));
document.getElementById('btn-refresh-db').addEventListener('click', refreshDbPage);
document.getElementById('btn-db-prev').addEventListener('click', () => { if (dbState.page > 1) { dbState.page--; loadDbItems(); } });
document.getElementById('btn-db-next').addEventListener('click', () => { if (dbState.page < dbState.pages) { dbState.page++; loadDbItems(); } });
document.getElementById('btn-db-raw').addEventListener('click', showDbRaw);
document.getElementById('btn-db-raw-close').addEventListener('click', () => $('db-raw-card').classList.add('hidden'));
document.getElementById('db-search').addEventListener('input', dbSearchInput);
document.getElementById('btn-add-pkg').addEventListener('click', addPackageRow);
document.getElementById('btn-save-pkg').addEventListener('click', savePackages);
document.getElementById('ad-packages').addEventListener('input', pkgInputEvents);
document.getElementById('ad-packages').addEventListener('click', pkgInputEvents);
document.getElementById('ad-user-q').addEventListener('input', () => { clearTimeout(window._uq); window._uq = setTimeout(refreshOwnerUsers, 350); });
document.getElementById('btn-delete-account').addEventListener('click', deleteAccount);
document.getElementById('btn-2fa-setup').addEventListener('click', setup2fa);
document.getElementById('btn-2fa-enable').addEventListener('click', enable2fa);
document.getElementById('btn-2fa-disable').addEventListener('click', disable2fa);
document.getElementById('btn-profile').addEventListener('click', () => switchPage('profile'));
/* Tema: 3 mode (terang / sistem / gelap). theme.js sudah memuat preferensi
 * sebelum render; di sini hanya sinkronkan state aktif tombol & handle klik. */
(function initThemeSwitch() {
    var wrap = document.getElementById('theme-switch');
    if (!wrap || !window.ManzxyTheme) return;
    function sync() {
        var mode = window.ManzxyTheme.mode();
        wrap.querySelectorAll('.theme-opt').forEach(function (b) {
            var on = b.dataset.mode === mode;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }
    wrap.addEventListener('click', function (e) {
        var btn = e.target.closest('.theme-opt');
        if (!btn) return;
        window.ManzxyTheme.set(btn.dataset.mode);
        sync();
    });
    sync();
})();
document.querySelectorAll('a[data-goto]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); switchPage(a.dataset.goto); }));
document.querySelectorAll('.tab[data-page]').forEach((t) => t.addEventListener('click', () => switchPage(t.dataset.page)));

/* ───────────── halaman tambahan (katalog, banner masa aktif) ─────────────
 * Semua pakai guard: HTML lama yang masih ter-cache di browser tidak boleh
 * membuat seluruh bundle gagal di baris ini. */
const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };

on('cmd-q', 'input', () => { clearTimeout(window._cq); window._cq = setTimeout(renderCmdCatalog, 200); });
on('cmd-chips', 'click', (e) => {
    const chip = e.target.closest('.cat-chip');
    if (!chip) return;
    cmdCategory = chip.dataset.cat || '';
    renderCmdChips();
    renderCmdCatalog();
});

// auto-refresh
setInterval(() => { if (Store.token && !$('view-app').classList.contains('hidden')) refreshMe(); }, 45000);


/* jalankan panel */
onBoot();
