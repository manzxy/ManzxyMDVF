/* ═══════════════════════════════════════════════════════════════════════
   DATA & HALAMAN
   Dashboard, monitor, jadibot, topup, premium, referral, order, profil, database.
   ───────────────────────────────────────────────────────────────────────
   Bagian dari bundle panel. Server menggabungkan js/*.js berurutan menjadi
   /panel/app.js, jadi browser tetap memuat SATU file (1 request).
   Urutan ditentukan awalan angka pada nama file. Semua modul berbagi satu
   skop global — jangan menambah "use strict" di sini (sudah di 00-core.js).
   ═══════════════════════════════════════════════════════════════════════ */

/* ───────────── data ───────────── */

async function refreshMe() {
    try {
        ME = await api('/api/me');
        renderDash(); renderBalance(); renderTopupPacks(); updateJadibotPage(); renderProfile();
        const acc = ME.account || {};
        $('hdr-user').textContent = acc.waNumber ? '+' + acc.waNumber : (acc.displayName || acc.email || '-');
        $('hdr-bot').textContent = (ME.bot?.botName || 'MANZXYMD').toUpperCase();
        $('ft-bot').textContent = ME.bot?.botName || 'ManzxyMD';
        $('ft-version').textContent = 'v' + (ME.bot?.version || '');
        renderAvatar('hdr', acc);
        renderSideIdentity(acc);
        renderAccountTags(acc);
        applyOwnerTab();
        renderPanic();
        renderApiKey();
        refreshDashTraffic();
        refreshToday();
        renderHeatmap();
        renderCommandStats();
        renderExpireBanner();
        renderWidget();
        if (typeof renderOnboardingChecklist === 'function') renderOnboardingChecklist();
        if (ME?.prefs) applyLang(ME.prefs.lang);
        if (ME?.account?.isSub) {
            const bar = $('panic-banner');
            if (bar) { bar.classList.remove('hidden'); bar.innerHTML = '👁 <strong>MODE PANTAU</strong> — akun sub dari ' + esc(ME.account.parentName || 'akun induk') + '. Hanya bisa melihat.'; }
        }
    } catch (err) { toast(err.message); }
}

function renderBalance() {
    const bal = ME?.account?.wa?.balance ?? 0;
    $('hdr-balance').textContent = fmtRp(bal);
    // topbar punya chip saldo sendiri di layar sempit (modul 45-shell)
    if (typeof setBalanceText === 'function') setBalanceText(fmtRp(bal));
    $('jb-balance').textContent = fmtRp(bal);
    $('kpi-balance').textContent = fmtRp(bal);
}

function renderAvatar(prefix, acc) {
    const img = $(prefix + '-avatar'), ini = $(prefix + '-initial');
    const name = acc?.displayName || acc?.email || '?';
    if (acc?.avatar) { img.src = acc.avatar; img.classList.remove('hidden'); ini.classList.add('hidden'); }
    else { img.classList.add('hidden'); ini.classList.remove('hidden'); ini.textContent = (name[0] || '?').toUpperCase(); }
}

/* ───────────── tag akun (owner / premium) ─────────────
 * Satu sumber kebenaran untuk semua tempat: kartu identitas sidebar,
 * topbar, dan label menu. Dulu badge hanya dibuat di halaman Profil,
 * jadi di shell tidak pernah muncul sama sekali.
 */

const TAG_META = {
    owner: { label: 'OWNER', cls: 'badge-owner', ico: '👑', title: 'Akun owner — akses penuh panel' },
    prem: { label: 'PREMIUM', cls: 'badge-prem', ico: '⭐', title: 'Langganan premium aktif' }
};

/** Daftar tag aktif untuk sebuah akun /api/me. */
function accountTags(acc) {
    const list = [];
    if (!acc) return list;
    if (acc.role === 'owner' || acc.isAdmin) list.push('owner');
    if (acc.plan === 'premium' || acc.wa?.premium) list.push('prem');
    return list;
}

/** HTML chip tag, dipakai sidebar & topbar. */
function tagsHtml(acc, { compact = false } = {}) {
    return accountTags(acc).map((k) => {
        const t = TAG_META[k];
        return `<span class="badge ${t.cls} tag-chip${compact ? ' tag-chip-sm' : ''}" title="${esc(t.title)}">` +
            `<span class="tag-ico">${t.ico}</span>${t.label}</span>`;
    }).join('');
}

/** Kartu identitas di kepala sidebar: avatar + nama + tag. */
function renderSideIdentity(acc) {
    const box = $('side-tags');
    if (box) box.innerHTML = tagsHtml(acc);

    const img = $('side-ava-img'), ini = $('side-ava-ini');
    if (!img || !ini) return;
    const name = acc?.displayName || acc?.email || '?';
    if (acc?.avatar) {
        img.src = acc.avatar;
        img.classList.remove('hidden');
        ini.classList.add('hidden');
    } else {
        img.classList.add('hidden');
        ini.classList.remove('hidden');
        ini.textContent = (name[0] || '?').toUpperCase();
    }
}

/** Tag ringkas di topbar + penanda pada item menu. */
function renderAccountTags(acc) {
    const top = $('top-tags');
    if (top) top.innerHTML = tagsHtml(acc, { compact: true });

    // menu Premium: tandai kalau langganan sedang aktif
    const premTag = $('tag-premium');
    if (premTag) premTag.classList.toggle('hidden', !(acc?.plan === 'premium' || acc?.wa?.premium));

    // menu Owner: hanya owner yang melihatnya, jadi ROOT selalu relevan
    const ownerTag = $('tag-owner-menu');
    if (ownerTag) ownerTag.classList.toggle('hidden', !(acc?.role === 'owner' || acc?.isAdmin));
}

/* ───────────── dashboard: grafik aktivitas 24 jam ───────────── */

let dashTraf = null;

async function refreshDashTraffic() {
    try { dashTraf = await api('/api/traffic?hours=24'); } catch { return; }
    renderDashTraffic();
}

function renderDashTraffic() {
    const svg = $('dash-bars');
    if (!svg || !dashTraf) return;
    drawTrafficBars(svg, dashTraf.series || []);
    const has = (dashTraf.series || []).some((s) => s.messages > 0 || s.commands > 0);
    const nd = $('dash-traf-nodata');
    if (nd) nd.classList.toggle('hidden', has);
}

/* ───────────── ringkasan hari ini vs kemarin ───────────── */

async function refreshToday() {
    let d = null;
    try { d = await api('/api/today'); } catch { return; }
    const set = (id, val, chgId, change, suffix = '') => {
        const el = $(id); if (el) el.textContent = val + suffix;
        const c = $(chgId);
        if (!c) return;
        const n = Number(change) || 0;
        c.textContent = `${n >= 0 ? '▲' : '▼'} ${Math.abs(n)}% vs kemarin`;
        c.className = 'stat-foot ' + (n >= 0 ? 'up' : 'down');
    };
    set('today-rev', d.revenue?.text || 'Rp 0', 'today-rev-chg', d.revenue?.change);
    set('today-cmd', Number(d.commands?.today || 0).toLocaleString('id-ID'), 'today-cmd-chg', d.commands?.change);
    set('today-msg', Number(d.messages?.today || 0).toLocaleString('id-ID'), 'today-msg-chg', d.messages?.change);
    set('today-user', Number(d.users?.today || 0).toLocaleString('id-ID'), 'today-user-chg', d.users?.change);
}

/* ───────────── dashboard ───────────── */

function renderDash() {
    const wa = ME?.account?.wa || {};
    const acc = ME?.account || {};
    $('kpi-messages').textContent = Number(wa.stats?.messages ?? ME?.monitor?.botMessages ?? 0).toLocaleString('id-ID');
    $('kpi-commands').textContent = Number(ME?.monitor?.botCommands ?? 0).toLocaleString('id-ID');
    $('kpi-pay').textContent = ME?.paymentEnabled ? 'Aktif' : 'Nonaktif';
    $('kpi-webacc').textContent = (ME.stats?.accounts || 0).toLocaleString('id-ID');
    $('kpi-number').textContent = wa.number ? '+' + wa.number : 'Belum tertaut';
    $('kpi-role').textContent = acc.role === 'owner' ? 'OWNER' : (wa.role || 'USER').toUpperCase();
    $('kpi-prem').textContent = wa.premium ? 'AKTIF' : '-';
    $('dash-welcome').textContent = `Halo, ${acc.displayName || acc.email || 'User'} 👋`;
    const chip = $('free-chip');
    if (chip) chip.classList.toggle('hidden', !acc.jadibotFree);

    const bots = ME?.account?.jadibots || [];
    $('st-online').textContent = bots.filter((b) => b.connected).length;
    $('st-total').textContent = `dari ${bots.length} total`;
    $('st-pairing').textContent = bots.filter((b) => b.state === 'pairing').length;
    const max = ME?.prices?.max ?? ME?.bot?.maxJadibot ?? 0;
    const used = ME?.prices?.slotsUsed ?? 0;
    $('st-slots').textContent = `${used}/${max}`;
    $('st-uptime').textContent = ME?.monitor?.uptimeText || '-';
    $('st-traffic').textContent = `${Number(ME?.monitor?.botMessages ?? 0).toLocaleString('id-ID')} pesan`;

    const dash = $('dash-bots');
    if (!bots.length) {
        dash.innerHTML = '<div class="empty-state"><div class="empty-ico">🤖</div><p class="empty">Belum ada jadibot.</p>' +
            '<a class="btn btn-primary" href="#" data-goto="jadibot">BUAT JADIBOT PERTAMA →</a></div>';
    }
    else dash.innerHTML = bots.slice(0, 6).map((b) => {
        const cls = b.connected ? 'on' : (b.state === 'pairing' ? 'pending' : 'off');
        return `<div class="mini-bot"><span>+${esc(b.number)}</span><span class="status-dot ${cls}"></span></div>`;
    }).join('');

    $('wa-warning').classList.toggle('hidden', Boolean(acc.waVerified));
}

/* ───────────── monitor ───────────── */

async function refreshMonitor() {
    $('monitor-list').innerHTML = skeletonRows(3, 'sk-bot');
    try {
        const m = await api('/api/monitor');
        MON = m;
        $('mon-online').textContent = m.summary?.online ?? 0;
        $('mon-pairing').textContent = m.summary?.pairing ?? 0;
        $('mon-offline').textContent = m.summary?.offline ?? 0;
        renderBotList(m.bots || []);
    } catch (err) { toast(err.message); }
}

let monFilter = '';

function renderBotList(bots) {
    const el = $('monitor-list');
    const list = monFilter ? bots.filter((b) => String(b.number).includes(monFilter)) : bots;
    if (!list.length) {
        el.innerHTML = bots.length
            ? `<div class="empty-state"><p class="empty">Tidak ada jadibot yang cocok "${esc(monFilter)}".</p></div>`
            : '<div class="empty-state"><div class="empty-ico">🤖</div><p class="empty">Tidak ada jadibot.</p><a class="btn btn-primary" href="#" data-goto="jadibot">BUAT JADIBOT →</a></div>';
        return;
    }
    el.innerHTML = list.map((b) => {
        const cls = b.connected ? 'online' : (b.state === 'pairing' ? 'pairing' : 'offline');
        const badge = b.connected ? 'ONLINE' : (b.state === 'pairing' ? 'PAIRING' : (b.state || 'off').toUpperCase());
        return `
        <div class="bot-card ${cls}">
          <div class="bot-head">
            <span class="bot-number">+${esc(b.number)}</span>
            <span class="bot-status ${cls}">${badge}</span>
            ${b.health ? `<span class="health h-${b.health.score >= 80 ? 'ok' : b.health.score >= 60 ? 'mid' : 'bad'}" title="Skor kesehatan: uptime, reconnect, masa aktif">${b.health.score} · ${b.health.label}</span>` : ''}
          </div>
          <div class="bot-info">
            <span>Mode: <b>${b.selfMode ? 'Self (owner)' : 'Public'}</b></span>
            <span>Uptime: <b>${esc(b.uptimeText)}</b></span>
            <span>Masa aktif: <b>${esc(b.expireText)}</b></span>
            <span>Owner: <b>+${esc(b.owner)}</b></span>
          </div>
          <div class="bot-actions">
            ${b.connected ? `<button class="btn btn-sm" data-act="stop" data-num="${esc(b.number)}">MATIKAN</button>` : ''}
            ${b.state !== 'pairing' ? `<button class="btn btn-sm" data-act="start" data-num="${esc(b.number)}">NYALAKAN</button>` : (b.pairingCode ? `<button class="btn btn-sm" data-act="showcode" data-num="${esc(b.number)}" data-code="${esc(b.pairingCode)}"><span class=\"ic\">🔑</span> LIHAT KODE</button>` : '')}
            <button class="btn btn-sm" data-act="mode" data-num="${esc(b.number)}">${b.selfMode ? 'PUBLIC' : 'SELF'}</button>
            <button class="btn btn-sm btn-danger-soft" data-act="delete" data-num="${esc(b.number)}">HAPUS</button>
            <button class="btn btn-sm" data-act="events" data-num="${esc(b.number)}" title="Riwayat kejadian bot"><span class=\"ic\">⏱</span> RIWAYAT</button>
            <button class="btn btn-sm" data-act="botset" data-num="${esc(b.number)}" title="Auto-reply & pesan terjadwal"><span class=\"ic\">⚙</span> ATUR</button>
          </div>
        </div>`;
    }).join('');
}

/* ───────────── jadibot actions ───────────── */

async function actStart(number) {
    try {
        const r = await api('/api/jadibot/start', { method: 'POST', body: { number } });
        if (r.code) return showPairingModal(number, r.code);
        toast(`+${number} sedang disambungkan…`);
        refreshMonitor(); refreshMe();
    } catch (err) { toast(err.message); }
}

async function actStop(number, del) {
    const stopCall = () => api('/api/jadibot/stop', { method: 'POST', body: { number, deleteSession: del } });
    if (del) {
        // hapus = tidak bisa dibatalkan setelah jalan → kasih jendela urungkan 5 detik
        await undoable(`Menghapus jadibot +${number}`, async () => {
            await stopCall();
            toast(`+${number} dihapus`);
            refreshMonitor(); refreshMe();
        });
        return;
    }
    if (!(await askConfirm(`Matikan jadibot +${number}?`, { title: 'MATIKAN JADIBOT', ok: 'YA, MATIKAN' }))) return;
    try {
        await stopCall();
        toast(`+${number} dimatikan`);
        refreshMonitor(); refreshMe();
    } catch (err) { toast(err.message); }
}

async function actMode(number) {
    const b = (MON?.bots || (ME?.account?.jadibots || [])).find((x) => x.number === number);
    if (!b) return;
    try {
        await api('/api/jadibot/mode', { method: 'POST', body: { number, selfMode: !b.selfMode } });
        toast(`Mode +${number} → ${b.selfMode ? 'PUBLIC' : 'SELF'}`);
        refreshMonitor(); refreshMe();
    } catch (err) { toast(err.message); }
}

function updateJadibotPage() {
    const prices = ME?.prices;
    if (!prices) return;
    const acc = ME?.account || {};
    const isFree = Boolean(acc.jadibotFree);

    // pilihan durasi dinamis dari paket yang diatur owner
    const sel = $('jb-duration-saldo');
    const prev = sel.value;
    const rows = prices.rows || [];
    sel.innerHTML = rows.map((r) =>
        `<option value="${esc(r.id)}">${esc(r.label)} — ${esc(r.priceText)}</option>`
    ).join('') || '<option value="">— paket belum diatur owner —</option>';
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;

    // durasi custom (hari bebas) menimpa paket bila diisi
    const maxDays = prices.maxDays || 3650;
    const customInp = $('jb-days-custom');
    if (customInp) customInp.max = String(maxDays);
    const customDays = Math.round(Number(customInp?.value)) || 0;
    if ($('jb-custom-hint')) {
        $('jb-custom-hint').textContent = customDays > 0
            ? `Custom ${customDays} hari — ${(prices.perDayText || '-')} / hari` + (customDays > maxDays ? ` (maks ${maxDays} hari!)` : '')
            : `Kosongkan bila pakai paket di atas. Harga ${prices.perDayText || '-'} / hari (min 1, maks ${maxDays} hari).`;
    }

    const p = rows.find((r) => r.id === sel.value);
    let priceText;
    if (isFree) priceText = 'GRATIS';
    else if (customDays > 0) {
        const base = customDays * (prices.perDay || 0);
        const disc = prices.discount || 0;
        priceText = fmtRp(Math.ceil(base * (100 - disc) / 100)) + (disc ? ` (diskon ${disc}%)` : '');
    } else priceText = p ? p.priceText : '-';
    $('jb-price').textContent = priceText;
    $('jb-balance').textContent = fmtRp(ME?.account?.wa?.balance ?? 0);

    // Header kartu + tombol menyesuaikan status owner/premium
    const head = document.querySelector('#page-jadibot .card .card-title');
    if (head) head.textContent = isFree ? 'GRATIS UNTUK KAMU' : 'PAKAI SALDO';
    const btn = $('btn-buy-jadibot');
    if (btn) btn.textContent = isFree ? 'AKTIFKAN JADIBOT (GRATIS)' : 'BELI DENGAN SALDO';
    const muted = head?.parentElement?.querySelector('.muted');
    if (muted) muted.textContent = isFree
        ? 'Akunmu gratis jadibot — aktif tanpa bayar & tanpa memotong saldo.'
        : 'Langsung aktif tanpa menunggu pembayaran.';

    const pt = $('price-table');
    pt.innerHTML = (prices.rows || []).map((r, i) =>
        `<div class="price-row${i === 0 ? ' hot' : ''}"><span>${esc(r.label)} (${r.days} hari)</span><strong>${isFree ? 'GRATIS' : esc(r.priceText)}</strong></div>`
    ).join('') +
    `<div class="price-row"><span>Durasi lain</span><strong>${isFree ? 'GRATIS' : (prices.perDayText || '-') + '/hari'}</strong></div>` +
    `<div class="price-row free"><span>Status kamu</span><strong>${isFree ? '🆓 GRATIS' : 'Berbayar'}</strong></div>`;
}

async function buyJadibot() {
    const number = $('jb-number-saldo').value.replace(/[^0-9]/g, '');
    if (!ME?.prices) { try { await refreshMe(); } catch {} }   // pastikan daftar harga sudah termuat
    const customInp = $('jb-days-custom');
    const customDays = Math.round(Number(customInp?.value)) || 0;
    const selDays = Number($('jb-duration-saldo')?.value) || 0;
    const days = customDays > 0 ? customDays : selDays;
    const maxDays = ME?.prices?.maxDays || 3650;
    if (number.length < 8 || number.length > 15) return toast('Nomor tidak valid (62xxx…).');
    if (customDays < 0 || (customDays > 0 && customDays > maxDays)) return toast(`Durasi custom maksimal ${maxDays} hari.`);
    if (days < 1) return toast('Pilih durasi dulu — paket di dropdown atau isi durasi custom.');
    const isFree = Boolean(ME?.account?.jadibotFree);
    const btn = $('btn-buy-jadibot');
    btn.disabled = true; btn.textContent = 'MEMPROSES…';
    $('buy-result').innerHTML = '';
    try {
        // Owner / premium: gratis, saldo tidak disentuh. User biasa: lewat /api/jadibot/buy.
        const r = isFree
            ? await api('/api/jadibot/free', { method: 'POST', body: { number, days } })
            : await api('/api/jadibot/buy', { method: 'POST', body: { number, days } });
        // Kode pairing tampil di web — bukan dikirim ke nomor WA
        if (r.code) { showPairingModal(number, r.code); return; }
        if (r.deliveredTo === 'restored') {
            $('buy-result').innerHTML = '<div class="alert alert-green mt-sm">Sesi tersimpan ditemukan, bot sedang disambungkan kembali.</div>';
            toast('Jadibot aktif kembali!');
        } else {
            $('buy-result').innerHTML = '<div class="alert alert-green mt-sm">Jadibot dibuat.</div>';
        }
        refreshMe(); refreshMonitor();
    } catch (err) {
        $('buy-result').innerHTML = `<div class="alert alert-red mt-sm">${esc(err.message)}</div>`;
    } finally {
        btn.disabled = false;
        btn.textContent = isFree ? 'AKTIFKAN JADIBOT (GRATIS)' : 'BELI DENGAN SALDO';
    }
}

/* ───────────── topup ───────────── */

function renderTopupPacks() {
    const packs = ME?.topup || [];
    $('topup-packages').innerHTML = packs.map((p) => `
        <div class="pack" data-id="${p.id}" data-act="pack">
          <div class="pay-label">Bayar ${fmtRp(p.pay)}</div>
          <div class="pay-credit">+${fmtRp(p.credit)} saldo</div>
          ${p.credit > p.pay ? `<div class="pay-bonus">BONUS ${Math.round((p.credit - p.pay) / p.pay * 100)}%</div>` : ''}
        </div>`).join('') || '<p class="empty">Pembayaran belum diaktifkan.</p>';
    // status pembayaran → tombol custom & paket ikut mati
    const payOff = ME?.paymentEnabled === false;
    const customBtn = $('btn-topup-custom');
    const customInp = $('topup-custom');
    if (customBtn) customBtn.disabled = payOff;
    if (customInp) customInp.disabled = payOff;
    if (payOff && customBtn) customBtn.title = 'Pembayaran QRIS belum aktif';
}

async function startTopup(body, { keepPack = null } = {}) {
    document.querySelectorAll('.pack').forEach((p) => p.classList.toggle('selected', keepPack && p.dataset.id === keepPack));
    $('topup-notice').classList.add('hidden');
    $('qr-empty').classList.add('hidden');
    $('qr-active').classList.remove('hidden');
    $('qr-img').src = '';
    $('qr-status').textContent = 'Membuat tagihan…';
    try {
        const r = await api('/api/topup/create', { method: 'POST', body });
        $('qr-amount').textContent = r.amountText;
        $('qr-credit').textContent = r.creditText;
        $('qr-status').textContent = 'Menunggu pembayaran';
        $('qr-trx').textContent = r.trxId;
        const q = await api('/api/qr?trxId=' + encodeURIComponent(r.trxId));
        $('qr-img').src = q.dataUrl;
        qrTrxId = r.trxId;
        startQrPoll();
    } catch (err) {
        $('topup-notice').textContent = err.message;
        $('topup-notice').classList.remove('hidden');
        $('qr-empty').classList.remove('hidden');
        $('qr-active').classList.add('hidden');
    }
}

async function selectPack(id) {
    $('topup-custom').value = '';
    return startTopup({ packageId: id }, { keepPack: id });
}

async function submitCustomTopup() {
    const inp = $('topup-custom');
    const n = Math.round(Number(inp.value));
    if (!Number.isFinite(n) || n < 1000) return toast('Minimal topup custom Rp 1.000.');
    if (n > 5000000) return toast('Maksimal topup custom Rp 5.000.000.');
    return startTopup({ packageId: 'custom', amount: n });
}

function startQrPoll() {
    clearInterval(qrTimer);
    qrTimer = setInterval(async () => {
        if (!qrTrxId) return;
        try {
            const s = await api('/api/topup/status?trxId=' + encodeURIComponent(qrTrxId));
            $('qr-status').textContent = (s.statusLabel || s.status).toUpperCase();
            if (s.status === 'done') {
                clearInterval(qrTimer);
                toast('Saldo masuk: ' + s.creditText + ' 🎉');
                notify('Saldo masuk 💰', s.creditText + ' sudah masuk ke akunmu.');
                refreshMe();
            } else if (s.status === 'expired' || s.status === 'cancelled') {
                clearInterval(qrTimer);
            }
        } catch {}
    }, 4000);
}

async function checkQrNow() {
    if (!qrTrxId) return;
    try {
        const s = await api('/api/topup/status?trxId=' + encodeURIComponent(qrTrxId));
        $('qr-status').textContent = (s.statusLabel || s.status).toUpperCase();
        if (s.status === 'done') { toast('Saldo masuk: ' + s.creditText); refreshMe(); }
        else toast('Status: ' + (s.statusLabel || s.status));
    } catch (err) { toast(err.message); }
}

/* ───────────── premium ───────────── */

let PREM = null;
let premQrTimer = null;
let premQrTrx = null;

async function refreshPremium() {
    try {
        PREM = await api('/api/premium');
        renderPremium();
    } catch (err) { toast(err.message); }
}

function renderPremium() {
    const p = PREM;
    if (!p) return;
    const me = p.me || {};
    const isFree = Boolean(p.free);
    $('pm-status').textContent = me.active ? '⭐ AKTIF' : 'Tidak aktif';
    $('pm-expire').textContent = me.expireText || '-';

    const bal = p.balance || 0;
    $('pm-mybalance').textContent = fmtRp(bal);
    if ($('pm-balance')) $('pm-balance').textContent = fmtRp(bal);

    // dropdown paket
    const sel = $('pm-package');
    const prev = sel.value;
    const packs = p.packages || [];
    sel.innerHTML = packs.map((k) =>
        `<option value="${esc(k.id)}">${esc(k.label)} — ${isFree ? 'GRATIS' : esc(k.priceText)}${k.percent && !isFree ? ` (hemat ${k.percent}%)` : ''}</option>`
    ).join('') || '<option value="">— premium nonaktif —</option>';
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;

    // tabel harga QRIS
    $('pm-price-table').innerHTML = packs.map((k, i) =>
        `<div class="price-row${i === 1 ? ' hot' : ''}"><span>${esc(k.label)}</span><strong>${isFree ? 'GRATIS' : esc(k.priceText)}</strong></div>`
    ).join('') + `<div class="price-row"><span>Harga per hari</span><strong>${isFree ? 'GRATIS' : esc(p.perDayText)}</strong></div>`;

    // Jalur gratis: tombol & judul menyesuaikan, QRIS disembunyikan
    const btn = $('btn-buy-prem');
    if (btn) btn.textContent = isFree ? 'AKTIFKAN PREMIUM (GRATIS)' : 'BELI PREMIUM';
    const qrisBtn = $('btn-buy-prem-qris');
    if (qrisBtn) qrisBtn.textContent = isFree ? 'GRATIS — TIDAK PERLU QRIS' : 'BUAT QRIS';
    if (qrisBtn) qrisBtn.disabled = isFree;
    const freeNote = $('pm-free-note');
    if (freeNote) {
        freeNote.classList.toggle('hidden', !isFree);
        if (isFree) freeNote.textContent = '🆓 Akunmu gratis premium — pilih durasi lalu klik AKTIFKAN. Saldo tidak dipotong.';
    }

    updatePremPrice();
}

function premDays() {
    const custom = Math.round(Number($('pm-days-custom').value)) || 0;
    if (custom > 0) return Math.min(custom, 3650);
    return Number($('pm-package').value) || 0;
}

function updatePremPrice() {
    const p = PREM;
    if (!p) return;
    const days = premDays();
    const customDays = Math.round(Number($('pm-days-custom').value)) || 0;
    const perDay = p.perDay || 0;
    const disc = p.discount || 0;
    const isFree = Boolean(p.free);
    if ($('pm-custom-hint')) {
        $('pm-custom-hint').textContent = isFree
            ? 'Kamu gratis premium — pilih durasi berapa pun, saldo tidak dipotong.'
            : customDays > 0
                ? `Custom ${customDays} hari — ${p.perDayText} / hari`
                : `Kosongkan bila pakai paket di atas. ${p.perDayText} / hari (maks 3650 hari).`;
    }
    if (days < 1) {
        $('pm-price').textContent = '-';
        $('pm-qris-amount').textContent = '-';
        return;
    }
    if (isFree) {
        $('pm-price').textContent = 'GRATIS';
        $('pm-qris-amount').textContent = 'GRATIS';
        return;
    }
    // paket memakai harga promo dari server; custom dihitung per hari
    const pack = (p.packages || []).find((k) => k.days === days && !customDays);
    const base = pack ? pack.price : Math.ceil(perDay * days * (100 - disc) / 100);
    const text = fmtRp(base) + (disc && !pack ? ` (diskon ${disc}%)` : '');
    $('pm-price').textContent = text;
    $('pm-qris-amount').textContent = pack ? pack.priceText : fmtRp(base);
}

async function buyPremium() {
    const days = premDays();
    if (days < 1) return toast('Pilih paket atau isi durasi custom dulu.');
    const target = ($('pm-target').value || '').replace(/[^0-9]/g, '');
    const btn = $('btn-buy-prem');
    btn.disabled = true; btn.textContent = 'MEMPROSES…';
    $('pm-result').innerHTML = '';
    try {
        const r = await api('/api/premium/buy', { method: 'POST', body: { days, target: target || undefined } });
        $('pm-result').innerHTML = `<div class="alert alert-green">✅ Premium aktif${r.free ? ' (gratis)' : ` — ${esc(r.priceText)}`}!\nSampai <strong>${esc(r.expireText)}</strong>${r.target && r.target !== (ME?.account?.wa?.number) ? ` untuk +${esc(r.target)}` : ''}.</div>`;
        toast('Premium aktif ⭐');
        refreshMe(); refreshPremium();
    } catch (err) {
        $('pm-result').innerHTML = `<div class="alert alert-red">${esc(err.message)}</div>`;
    } finally {
        btn.disabled = false; btn.textContent = 'BELI PREMIUM';
    }
}

async function buyPremiumQris() {
    const days = premDays();
    if (days < 1) return toast('Pilih paket atau isi durasi custom dulu.');
    const btn = $('btn-buy-prem-qris');
    btn.disabled = true; btn.textContent = 'MEMBUAT…';
    $('pm-qr-empty').classList.add('hidden');
    $('pm-qr-active').classList.remove('hidden');
    $('pm-qr-img').src = '';
    $('pm-qr-status').textContent = 'Membuat tagihan…';
    try {
        const r = await api('/api/premium/qris', { method: 'POST', body: { days } });
        $('pm-qr-total').textContent = r.amountText;
        $('pm-qr-trx').textContent = r.trxId;
        $('pm-qr-status').textContent = 'Menunggu pembayaran';
        const q = await api('/api/qr?trxId=' + encodeURIComponent(r.trxId));
        $('pm-qr-img').src = q.dataUrl;
        premQrTrx = r.trxId;
        startPremQrPoll();
    } catch (err) {
        $('pm-qr-active').classList.add('hidden');
        $('pm-qr-empty').classList.remove('hidden');
        toast(err.message);
    } finally {
        btn.disabled = false; btn.textContent = 'BUAT QRIS';
    }
}

function startPremQrPoll() {
    clearInterval(premQrTimer);
    premQrTimer = setInterval(async () => {
        if (!premQrTrx) return;
        try {
            const s = await api('/api/topup/status?trxId=' + encodeURIComponent(premQrTrx));
            $('pm-qr-status').textContent = (s.statusLabel || s.status).toUpperCase();
            if (s.status === 'done') {
                clearInterval(premQrTimer);
                toast('Premium aktif ⭐');
                notify('Premium aktif ⭐', 'Pembayaran diterima — premium sudah aktif.');
                $('pm-result').innerHTML = '<div class="alert alert-green">✅ Pembayaran diterima — premium aktif!</div>';
                refreshMe(); refreshPremium();
            } else if (s.status === 'expired' || s.status === 'cancelled') {
                clearInterval(premQrTimer);
            }
        } catch {}
    }, 4000);
}

async function checkPremQrNow() {
    if (!premQrTrx) return;
    try {
        const s = await api('/api/topup/status?trxId=' + encodeURIComponent(premQrTrx));
        $('pm-qr-status').textContent = (s.statusLabel || s.status).toUpperCase();
        if (s.status === 'done') { toast('Premium aktif ⭐'); refreshPremium(); }
        else toast('Status: ' + (s.statusLabel || s.status));
    } catch (err) { toast(err.message); }
}

/* ───────────── referral ───────────── */

let REF = null;

async function refreshReferral() {
    $('ref-list').innerHTML = skeletonRows(3);
    try {
        REF = await api('/api/referral');
        renderReferral();
    } catch (err) { toast(err.message); }
}

function renderReferral() {
    const r = REF;
    if (!r) return;
    $('ref-code').textContent = r.code || '·······';
    $('ref-link').textContent = r.link || '—';
    $('ref-bonus-referee').textContent = fmtRp(r.bonusReferee || 0);
    $('ref-bonus-referrer').textContent = fmtRp(r.bonusReferrer || 0);
    $('ref-total').textContent = r.total || 0;
    $('ref-paid').textContent = fmtRp(r.paid || 0);
    const remain = Math.max(0, (r.dailyLimit || 0) - (r.dailyUsed || 0));
    $('ref-remain').textContent = remain;
    $('ref-daily').textContent = `dari ${r.dailyLimit || 0} / hari`;

    const el = $('ref-list');
    const rows = r.rows || [];
    if (!rows.length) { el.innerHTML = '<p class="empty">Belum ada undangan. Bagikan kode kamu!</p>'; return; }
    el.innerHTML = rows.map((x) => {
        const cls = x.status === 'paid' ? 'done' : (x.status === 'pending' ? 'pending' : 'expired');
        const label = x.status === 'paid' ? 'BONUS MASUK' : (x.status === 'pending' ? 'MENUNGGU' : 'GAGAL');
        return `<div class="mini-bot">
            <span>${esc(x.name)} <small class="muted">• ${esc(x.atText)}</small>${x.reason ? `<br><small class="muted">${esc(x.reason)}</small>` : ''}</span>
            <span style="display:flex;gap:8px;align-items:center">
              <strong class="small">${esc(x.bonusText)}</strong>
              <span class="badge ${cls}">${label}</span>
            </span>
          </div>`;
    }).join('');
}

function copyText(text, okMsg) {
    const done = () => toast(okMsg);
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else fallbackCopy(text, done);
}

function fallbackCopy(text, done) {
    try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        done();
    } catch { toast('Gagal menyalin — salin manual ya.'); }
}

/* ───────────── orders ───────────── */

async function refreshOrders() {
    $('orders-list').innerHTML = skeletonRows(3, 'sk-order');
    $('ledger-list').innerHTML = skeletonRows(3);
    try {
        const [r, led] = await Promise.all([api('/api/orders'), api('/api/ledger')]);
        renderOrders(r.orders || []);
        renderLedger(led || {});
    } catch (err) { toast(err.message); }
}

function renderLedger(d) {
    const el = $('ledger-list');
    if (!el) return;
    if (!d.linked) {
        el.innerHTML = '<div class="empty-state"><p class="empty">Tautkan &amp; verifikasi nomor WhatsApp di Profil untuk melihat riwayat saldo.</p></div>';
        return;
    }
    const rows = d.rows || [];
    if (!rows.length) { el.innerHTML = '<p class="empty">Belum ada perubahan saldo tercatat.</p>'; return; }
    el.innerHTML = rows.map((l) => `
        <div class="ledger-row">
          <span class="ledger-ico">${esc(l.kindLabel)}</span>
          <span class="ledger-note"><strong class="${l.amount > 0 ? 'in' : 'out'}">${esc(l.amountText)}</strong>
            <small>${esc(l.note || l.kindLabel)} · saldo ${esc(l.balanceText)}</small></span>
          <small class="ledger-at">${esc(l.atText)}</small>
        </div>`).join('');
}

function renderOrders(list) {
    const el = $('orders-list');
    if (!list.length) {
        el.innerHTML = '<div class="empty-state"><div class="empty-ico">🧾</div><p class="empty">Belum ada transaksi.</p><a class="btn btn-primary" href="#" data-goto="topup">TOPUP SALDO →</a></div>';
        return;
    }
    el.innerHTML = list.map((o) => {
        const icon = { jadibot: '🤖', rent: '🏷️', prem: '⭐', renew: '🔄', topup: '💰' }[o.type] || '•';
        const target = o.type === 'topup' ? 'Topup saldo' : (o.type === 'renew' ? (o.targetLabel || o.kind) : (o.targetLabel || '+' + o.target));
        return `
        <div class="order-card">
          <div class="order-main">
            <div class="order-title">${icon} ${esc(target)}</div>
            <div class="order-sub">${esc(o.trxId)}<br>${esc(o.createdText)}</div>
          </div>
          <div class="order-right">
            <span class="order-amount">${esc(o.amountText)}</span>
            <span class="badge ${esc(o.status)}">${esc(o.statusLabel)}</span>
          </div>
        </div>`;
    }).join('');
}

/* ───────────── profile ───────────── */

function renderProfile() {
    const acc = ME?.account;
    if (!acc) return;
    $('pf-name').textContent = acc.displayName || acc.email || 'Tanpa nama';
    $('pf-email').textContent = acc.email || '(belum ada email)';
    $('pf-display').value = acc.displayName || '';
    $('pf-wa').value = acc.waNumber || '';
    $('pf-avatarurl').value = acc.avatar || '';
    renderAvatar('pf', acc);
    loadSessions();
    loadWebhook();
    loadSubs();
    loadChatNotify();
    loadPasskeys();
    if (ME?.prefs) $('pf-lang').value = ME.prefs.lang || 'id';

    const badges = [];
    const tags = tagsHtml(acc);
    if (tags) badges.push(tags);
    if (acc.verified) badges.push('<span class="badge badge-ok">EMAIL ✔</span>');
    if (acc.waVerified) badges.push('<span class="badge badge-ok">WA ✔</span>');
    $('pf-badges').innerHTML = badges.join(' ') || '';

    // password
    $('pw-status').textContent = acc.hasPassword ? '✔ Password email sudah aktif.' : 'Akun ini belum punya password (login lewat OAuth). Buat sekarang supaya bisa login tanpa OAuth.';
    $('pw-cur-label').textContent = acc.hasPassword ? 'Password saat ini' : 'Password baru';

    // 2FA
    const on = Boolean(acc.totpEnabled);
    $('tfa-status').textContent = on
        ? '🔒 2FA aktif — login butuh kode dari aplikasi authenticator.'
        : 'Belum aktif. Aktifkan supaya login butuh kode kedua selain password (disarankan untuk owner).';
    $('twofa-off').classList.toggle('hidden', on);
    $('twofa-on').classList.toggle('hidden', !on);
    $('twofa-setup').classList.add('hidden');

    renderNotifPref();

    // providers
    const items = (acc.providers || []).map((p) => `
        <div class="provider-row">
          <span class="provider-name">${p.provider === 'google' ? '⚙ Google' : '🐙 GitHub'} <small>${esc(p.email || '')}</small></span>
          <button class="btn btn-sm" data-act="unlink" data-provider="${esc(p.provider)}">LEPAS</button>
        </div>`).join('');
    const oauthBtns = Object.entries(ME.providers || {}).filter(([, v]) => v.enabled)
        .map(([id]) => `<a class="btn btn-sm" href="/api/auth/${id}/start">+ ${id === 'google' ? 'Google' : 'GitHub'}</a>`).join('');
    $('pf-providers').innerHTML = items
        ? items + `<div class="divider-sm"></div>` + oauthBtns
        : '<p class="empty">Belum ada akun tertaut.</p>' + (oauthBtns || '<p class="field-hint">Login Google/GitHub belum diaktifkan owner.</p>');

    // logs
    const logs = ME.logs || [];
    $('pf-logs').innerHTML = logs.length
        ? logs.map((l) => `<div class="log-row"><span>${esc(l.action)}</span><small>${esc(l.atText)}</small></div>`).join('')
        : '<p class="empty">Belum ada aktivitas.</p>';
}

async function saveProfile() {
    const waNumber = ($('pf-wa').value || '').replace(/[^0-9]/g, '');
    const otpCode = ($('pf-otp').value || '').replace(/\D/g, '');
    const waChanged = waNumber !== String(ME?.account?.waNumber || '');
    if (waChanged && waNumber && otpCode.length !== 6) {
        return toast('Klik KIRIM OTP lalu masukkan 6 angka dari WhatsApp.');
    }
    const body = {
        displayName: $('pf-display').value.trim(),
        waNumber,
        avatar: $('pf-avatarurl').value.trim()
    };
    if (waChanged && otpCode) body.otp = otpCode;
    const btn = $('btn-save-profile');
    btn.disabled = true; btn.textContent = 'MENYIMPAN…';
    try {
        const r = await api('/api/profile', { method: 'POST', body });
        ME.account = r.account;
        renderProfile(); renderDash(); renderBalance();
        renderSideIdentity(ME.account); renderAccountTags(ME.account);
        $('pf-otp').value = '';
        $('pf-otp-wrap').classList.add('hidden');
        if (r.cleared) {
            $('profile-msg').innerHTML = '<div class="alert alert-green mt-sm">Nomor WhatsApp dilepas dari akun ini.</div>';
            toast('Nomor WhatsApp dilepas');
        } else {
            $('profile-msg').innerHTML = '<div class="alert alert-green mt-sm">Profil tersimpan' + (waChanged && waNumber ? ' — nomor WhatsApp terverifikasi ✅' : '') + '.</div>';
            toast('Profil tersimpan');
        }
        $('hdr-user').textContent = r.account.waNumber ? '+' + r.account.waNumber : (r.account.displayName || r.account.email);
    } catch (err) {
        $('profile-msg').innerHTML = `<div class="alert alert-red mt-sm">${esc(err.message)}</div>`;
    } finally { btn.disabled = false; btn.textContent = 'SIMPAN PROFIL'; }
}

/* ── OTP untuk ganti nomor di Profil ── */
async function sendProfileOtp() {
    const btn = $('btn-pf-otp');
    const waNumber = ($('pf-wa').value || '').replace(/[^0-9]/g, '');
    if (waNumber.length < 10) return toast('Isi nomor WhatsApp dulu (contoh 08123456789).');
    if (waNumber === String(ME?.account?.waNumber || '')) return toast('Nomor itu sudah terhubung ke akun ini.');
    btn.disabled = true; btn.textContent = 'MENGIRIM…';
    try {
        const r = await api('/api/profile/wa/otp', { method: 'POST', body: { waNumber } });
        $('pf-otp-wrap').classList.remove('hidden');
        $('pf-otp').focus();
        $('pf-wa-hint').textContent = `Kode dikirim ke WhatsApp +${r.number}. Berlaku ${Math.max(1, Math.round((r.ttlSec || 300) / 60))} menit, lalu klik SIMPAN PROFIL.`;
        toast('Kode OTP terkirim 📲');
        startProfileOtpCooldown(60);
    } catch (err) {
        toast(err.message);
        btn.disabled = false; btn.textContent = 'KIRIM OTP';
    }
}

let pfOtpTimer = null;
function startProfileOtpCooldown(sec) {
    const btn = $('btn-pf-otp');
    let left = sec;
    clearInterval(pfOtpTimer);
    btn.disabled = true;
    btn.textContent = `KIRIM ULANG (${left})`;
    pfOtpTimer = setInterval(() => {
        left--;
        if (left <= 0) {
            clearInterval(pfOtpTimer);
            btn.disabled = false;
            btn.textContent = 'KIRIM ULANG OTP';
            return;
        }
        btn.textContent = `KIRIM ULANG (${left})`;
    }, 1000);
}

async function savePassword() {
    const nw = $('pw-new').value;
    if (nw !== $('pw-new2').value) return $('pw-msg').innerHTML = '<div class="alert alert-red mt-sm">Konfirmasi password tidak cocok.</div>';
    const btn = $('btn-save-pw');
    btn.disabled = true;
    try {
        await api('/api/profile/password', { method: 'POST', body: { currentPassword: $('pw-current').value, newPassword: nw } });
        $('pw-msg').innerHTML = '<div class="alert alert-green mt-sm">Password diperbarui.</div>';
        $('pw-current').value = ''; $('pw-new').value = ''; $('pw-new2').value = '';
        refreshMe();
    } catch (err) {
        $('pw-msg').innerHTML = `<div class="alert alert-red mt-sm">${esc(err.message)}</div>`;
    } finally { btn.disabled = false; }
}

async function unlinkProvider(provider) {
    if (!(await askConfirm(`Lepas akun ${provider}?`, { ok: 'YA, LEPAS' }))) return;
    try {
        await api('/api/profile/unlink', { method: 'POST', body: { provider } });
        refreshMe();
    } catch (err) { toast(err.message); }
}

async function deleteAccount() {
    await undoable('Menghapus akun selamanya', async () => {
        await api('/api/profile/delete', { method: 'POST', body: { confirm: 'HAPUS' } });
        logout(true);
        toast('Akun dihapus.');
    });
}

/* ───────────── database explorer (khusus owner) ───────────── */

const dbState = { col: '', q: '', page: 1, pages: 1 };

async function refreshDbPage() {
    if (!ME?.account?.isAdmin) return;
    try {
        const r = await api('/api/admin/db');
        $('db-updated').textContent = r.updatedAtText || '-';
        $('db-totalkb').textContent = (r.totalKB || 0) + ' KB';
        const el = $('db-collections');
        el.innerHTML = (r.collections || []).map((c) => `
            <div class="db-col${dbState.col === c.key ? ' selected' : ''}" data-dbcol="${esc(c.key)}">
              <strong class="db-col-name">${esc(c.key)}</strong>
              <span class="db-col-count">${Number(c.count).toLocaleString('id-ID')}</span>
              <small>${esc(c.note || '')} • ${c.sizeKB} KB</small>
            </div>`).join('') || '<p class="empty">Database kosong.</p>';
        if (dbState.col) await loadDbItems();
    } catch (err) { toast(err.message); }
}

async function selectDbCollection(col) {
    dbState.col = col;
    dbState.q = '';
    dbState.page = 1;
    $('db-search').value = '';
    $('db-viewer-title').textContent = 'KOLEKSI: ' + col.toUpperCase();
    document.querySelectorAll('.db-col').forEach((c) => c.classList.toggle('selected', c.dataset.dbcol === col));
    $('db-raw-card').classList.add('hidden');
    await loadDbItems();
}

async function loadDbItems() {
    if (!dbState.col) return toast('Pilih koleksi dulu.');
    const el = $('db-items');
    el.innerHTML = '<p class="empty">Memuat…</p>';
    try {
        const params = new URLSearchParams({ col: dbState.col, page: dbState.page, limit: 25 });
        if (dbState.q) params.set('q', dbState.q);
        const r = await api('/api/admin/db/view?' + params.toString());
        dbState.page = r.page; dbState.pages = r.pages;
        $('db-page-info').textContent = r.total
            ? `Hal. ${r.page}/${r.pages} • ${r.total} entri`
            : '0 entri';
        if (!(r.items || []).length) { el.innerHTML = '<p class="empty">Tidak ada entri cocok.</p>'; return; }
        el.innerHTML = r.items.map((it) => `
            <details class="db-entry">
              <summary><span class="db-key mono">${esc(it.key)}</span><span class="db-open">lihat</span></summary>
              <pre class="db-json mono">${esc(prettyJson(it.json))}</pre>
            </details>`).join('');
    } catch (err) {
        el.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
    }
}

const prettyJson = (s) => { try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; } };

async function showDbRaw() {
    if (!dbState.col) return toast('Pilih koleksi dulu.');
    try {
        const r = await api('/api/admin/db/raw?col=' + encodeURIComponent(dbState.col));
        $('db-raw-col').textContent = r.col + '.json';
        $('db-raw').textContent = r.json;
        $('db-raw-card').classList.remove('hidden');
        $('db-raw-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) { toast(err.message); }
}

function dbSearchInput() {
    clearTimeout(window._dbq);
    window._dbq = setTimeout(() => {
        dbState.q = $('db-search').value.trim();
        dbState.page = 1;
        loadDbItems();
    }, 350);
}

