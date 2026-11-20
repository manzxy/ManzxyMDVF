/* ═══════════════════════════════════════════════════════════════════════
   HALAMAN TAMBAHAN
   Katalog command, laporan pendapatan owner, banner masa aktif.
   ───────────────────────────────────────────────────────────────────────
   Bagian dari bundle panel. Server menggabungkan js/*.js berurutan menjadi
   /panel/app.js, jadi browser tetap memuat SATU file (1 request).
   Urutan ditentukan awalan angka pada nama file. Semua modul berbagi satu
   skop global — jangan menambah "use strict" di sini (sudah di 00-core.js).
   ═══════════════════════════════════════════════════════════════════════ */

/* ───────────── banner masa aktif (dashboard) ─────────────
 * Data datang dari /api/me → expiring[]. Ditampilkan di atas konten supaya
 * user sadar botnya mau habis sebelum benar-benar berhenti.
 */

const EXPIRE_META = {
    jadibot: { ico: '🤖', label: 'Jadibot', page: 'monitor' },
    premium: { ico: '⭐', label: 'Premium', page: 'premium' }
};

function renderExpireBanner() {
    const el = $('expire-banner');
    if (!el) return;
    // auto-refresh /api/me tiap 45 detik tidak boleh memunculkan lagi banner
    // yang sudah ditutup user di sesi ini.
    let closed = false;
    try { closed = sessionStorage.getItem('mz_expire_closed') === '1'; } catch {}
    if (closed) { el.classList.add('hidden'); el.innerHTML = ''; return; }

    const rows = ME?.expiring || [];
    if (!rows.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }

    const urgent = rows.filter((r) => r.daysLeft <= 2).length;
    el.className = 'expire-banner' + (urgent ? ' urgent' : '');
    el.innerHTML = `
        <span class="expire-ico">${urgent ? '⚠️' : '⏳'}</span>
        <div class="expire-main">
            <strong>${rows.length} masa aktif hampir habis</strong>
            <div class="expire-list">${rows.slice(0, 4).map((r) => {
                const m = EXPIRE_META[r.kind] || { ico: '•', label: r.kind };
                const when = r.daysLeft <= 1 ? 'hari ini' : `${r.daysLeft} hari lagi`;
                return `<button class="expire-item" data-goto="${m.page}">${m.ico} ${esc(m.label)} <b>${esc(r.label)}</b> — ${when}</button>`;
            }).join('')}</div>
        </div>
        <button class="btn btn-sm expire-close" id="btn-expire-close" type="button" aria-label="Tutup">✕</button>`;
    el.classList.remove('hidden');
}

function dismissExpireBanner() {
    const el = $('expire-banner');
    if (el) el.classList.add('hidden');
    try { sessionStorage.setItem('mz_expire_closed', '1'); } catch {}
}

/* ───────────── katalog command ───────────── */

let cmdCatalog = null;
let cmdCategory = '';

async function refreshCommands() {
    const el = $('cmd-catalog');
    if (!el) return;
    if (cmdCatalog) { renderCmdCatalog(); return; }
    try {
        cmdCatalog = await api('/api/commands');
        renderCmdChips();
        renderCmdCatalog();
    } catch (err) { el.innerHTML = `<p class="empty">Gagal memuat: ${esc(err.message)}</p>`; }
}

function renderCmdChips() {
    const el = $('cmd-chips');
    if (!el || !cmdCatalog) return;
    $('cmd-catalog-total').textContent = `${cmdCatalog.total} plugin · ${cmdCatalog.totalCommands} command`;
    el.innerHTML = `<button class="cat-chip${cmdCategory ? '' : ' active'}" data-cat="">Semua <b>${cmdCatalog.total}</b></button>` +
        (cmdCatalog.categories || []).map((c) =>
            `<button class="cat-chip${cmdCategory === c.id ? ' active' : ''}" data-cat="${esc(c.id)}">${esc(c.label)} <b>${c.count}</b></button>`
        ).join('');
}

function renderCmdCatalog() {
    const el = $('cmd-catalog');
    if (!el || !cmdCatalog) return;
    const q = ($('cmd-q')?.value || '').toLowerCase().trim();
    const prefix = cmdCatalog.prefix || '.';

    const cats = (cmdCatalog.categories || [])
        .filter((c) => !cmdCategory || c.id === cmdCategory)
        .map((c) => ({
            ...c,
            commands: c.commands.filter((p) => {
                if (!q) return true;
                return p.name.toLowerCase().includes(q)
                    || p.description.toLowerCase().includes(q)
                    || p.commands.some((x) => x.toLowerCase().includes(q));
            })
        }))
        .filter((c) => c.commands.length);

    if (!cats.length) {
        el.innerHTML = `<p class="empty">Tidak ada command yang cocok dengan “${esc(q)}”.</p>`;
        return;
    }

    el.innerHTML = cats.map((c) => `
        <div class="cmd-cat">
            <div class="cmd-cat-head"><h4>${esc(c.label)}</h4><span class="muted small">${c.commands.length} plugin</span></div>
            <div class="cmd-grid">
                ${c.commands.map((p) => `
                    <div class="cmd-card">
                        <div class="cmd-card-top">
                            <span class="cmd-card-name">${esc(p.name)}</span>
                            <span class="cmd-card-tags">
                                ${p.premium ? '<span class="badge badge-prem">PREMIUM</span>' : ''}
                                ${p.owner ? '<span class="badge badge-owner">OWNER</span>' : ''}
                                ${p.admin ? '<span class="badge">ADMIN</span>' : ''}
                                ${p.groupOnly ? '<span class="badge">GRUP</span>' : ''}
                            </span>
                        </div>
                        <p class="cmd-card-desc">${esc(p.description || '—')}</p>
                        <div class="cmd-card-foot">
                            <code class="mono">${esc(prefix + p.commands[0])}</code>
                            ${p.commands.length > 1 ? `<span class="muted small">+${p.commands.length - 1} alias</span>` : ''}
                            ${p.hits ? `<span class="muted small">${p.hits.toLocaleString('id-ID')}× dipakai</span>` : ''}
                        </div>
                    </div>`).join('')}
            </div>
        </div>`).join('');
}

/* ───────────── laporan pendapatan (owner) ───────────── */

async function refreshRevenue() {
    if (!ME?.account?.isAdmin) return;
    try {
        const d = await api('/api/admin/revenue');
        renderRevenue(d);
    } catch (err) { /* diam: kartu tetap menampilkan strip */ }
}

function renderRevenue(d) {
    $('rev-month').textContent = d.thisMonth.totalText;
    $('rev-month-sub').textContent = `${d.thisMonth.count} transaksi`;
    $('rev-last').textContent = d.lastMonth.totalText;
    $('rev-growth').textContent = d.growth === null ? 'belum ada pembanding' : (d.growth >= 0 ? `▲ ${d.growth}%` : `▼ ${Math.abs(d.growth)}%`);
    $('rev-growth').className = 'stat-foot ' + (d.growth === null ? '' : d.growth >= 0 ? 'up' : 'down');
    $('rev-proj').textContent = d.projection.totalText;
    $('rev-proj-sub').textContent = `hari ${d.projection.dayOfMonth}/${d.projection.daysInMonth}`;
    $('rev-all').textContent = d.totalAll.totalText;
    $('rev-all-sub').textContent = `${d.totalAll.count} order lunas`;

    renderRevenueBars(d.months || []);

    const max = Math.max(1, ...(d.byType || []).map((t) => t.total));
    $('rev-bytype').innerHTML = (d.byType || []).length
        ? d.byType.map((t) => `
            <div class="cmd-row">
                <span class="cmd-name">${esc(t.label)}</span>
                <span class="cmd-bar"><i style="width:${Math.round((t.total / max) * 100)}%"></i></span>
                <b class="cmd-count">${fmtRp(t.total)}</b>
            </div>`).join('')
        : '<p class="empty">Belum ada pendapatan tercatat.</p>';
}

/* ───────────── Onboarding checklist (progres tersimpan) ─────────────
 * Progres tur disimpan di localStorage (mz_tour_step / mz_tour_done).
 * Checklist ini mencerminkan langkah yang sudah dilewati dan bisa
 * dibuka ulang lewat tombol "Lanjutkan tur".
 */

function renderOnboardingChecklist() {
    const el = $('onboarding-list');
    if (!el) return;
    let done = false, step = 0;
    try {
        done = localStorage.getItem('mz_tour_done') === '1';
        step = Math.max(0, Math.min(4, Number(localStorage.getItem('mz_tour_step') || 0)));
    } catch {}
    const items = (typeof TOUR_STEPS !== 'undefined' ? TOUR_STEPS : []).slice(1);
    const completed = done ? items.length : step;
    const cnt = $('onboarding-count');
    if (cnt) cnt.textContent = `${completed}/${items.length} selesai`;

    el.innerHTML = items.map((s, i) => {
        const ok = i < completed;
        return `<div class="onb-item${ok ? ' done' : ''}">
            <span class="onb-check">${ok ? '✓' : (i + 1)}</span>
            <span class="onb-label">${esc(s.title.replace(/^\d\/\d\s*—\s*/, ''))}</span>
        </div>`;
    }).join('') +
    `<button class="btn btn-sm mt-sm" type="button" id="onb-resume">${done ? '🔁 Ulangi tur' : '▶ Lanjutkan tur'}</button>`;

    const btn = $('onb-resume');
    if (btn) btn.addEventListener('click', () => {
        if (done) { try { localStorage.removeItem('mz_tour_done'); localStorage.removeItem('mz_tour_step'); } catch {} }
        if (typeof startTour === 'function') startTour();
    });
}

/* ───────────── Live Activity Feed ─────────────
 * Timeline real-time dari SSE (/api/events). Event datang dari store.log
 * lewat event bus di server, jadi semua aksi panel otomatis muncul di sini.
 * Disimpan di memori (maks 30 entri), tidak menulis localStorage.
 */

const FEED_META = {
    register:           { ico: '👤', label: 'Akun baru',      tone: 'blue',   page: null },
    login:              { ico: '🔑', label: 'Login',          tone: 'grey',   page: null },
    wa_verified_otp:    { ico: '✅', label: 'WA terverifikasi', tone: 'green', page: 'profile' },
    jadibot_start:      { ico: '🤖', label: 'Jadibot start',   tone: 'blue',   page: 'monitor' },
    jadibot_free:       { ico: '🆓', label: 'Jadibot gratis',  tone: 'green',  page: 'jadibot' },
    jadibot_buy:        { ico: '🤖', label: 'Jadibot dibeli',  tone: 'green',  page: 'jadibot' },
    jadibot_delete:     { ico: '🗑️', label: 'Jadibot dihapus', tone: 'red',    page: 'jadibot' },
    jadibot_stop:       { ico: '⏹️', label: 'Jadibot dimatikan', tone: 'grey', page: 'jadibot' },
    jadibot_import:     { ico: '📥', label: 'Jadibot diimpor', tone: 'blue',   page: 'jadibot' },
    topup_create:       { ico: '💰', label: 'Topup dibuat',    tone: 'yellow', page: 'orders' },
    voucher_redeem:     { ico: '🎟️', label: 'Voucher ditukar', tone: 'green',  page: 'orders' },
    premium_free:       { ico: '⭐', label: 'Premium gratis',  tone: 'green',  page: 'premium' },
    premium_buy:        { ico: '⭐', label: 'Premium dibeli',  tone: 'green',  page: 'premium' },
    premium_qris:       { ico: '⭐', label: 'Premium QRIS',    tone: 'yellow', page: 'premium' },
    broadcast:          { ico: '📢', label: 'Broadcast',      tone: 'blue',   page: null }
};
// Aksi yang layak memunculkan toast + menaikkan badge transaksi.
const FEED_TOAST = new Set(['topup_create', 'voucher_redeem', 'premium_buy',
    'premium_free', 'jadibot_buy', 'jadibot_free']);
const FEED_BADGE = new Set(['topup_create', 'voucher_redeem', 'premium_buy',
    'premium_free', 'jadibot_buy']);

let ACTIVITY = [];
let feedUnread = 0;
const FEED_MAX = 30;

function feedTime(at) {
    const d = new Date(Number(at) || Date.now());
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function renderActivity() {
    const el = $('activity-feed');
    if (!el) return;
    if (!ACTIVITY.length) {
        el.innerHTML = '<p class="empty">Belum ada aktivitas. Event akan muncul di sini secara langsung.</p>';
        return;
    }
    el.innerHTML = ACTIVITY.map((it) => {
        const meta = FEED_META[it.action] || { ico: '•', label: it.action, tone: 'grey', page: null };
        const detail = it.detail ? `<span class="feed-detail">${esc(String(it.detail).slice(0, 90))}</span>` : '';
        const jump = meta.page ? `<button class="feed-jump" data-goto="${meta.page}" title="Buka ${esc(meta.label)}">→</button>` : '';
        return `<div class="feed-item">
            <span class="feed-ico tone-${meta.tone}">${meta.ico}</span>
            <span class="feed-body"><b>${esc(meta.label)}</b>${detail}</span>
            <span class="feed-time">${feedTime(it.at)}</span>${jump}
        </div>`;
    }).join('');
}

function activityInit(items) {
    ACTIVITY = (items || []).slice(0, FEED_MAX);
    renderActivity();
}

function pushActivity(entry) {
    if (!entry || !entry.action) return;
    ACTIVITY.unshift({ ...entry, at: entry.at || Date.now() });
    if (ACTIVITY.length > FEED_MAX) ACTIVITY.length = FEED_MAX;
    renderActivity();

    const meta = FEED_META[entry.action];
    if (FEED_TOAST.has(entry.action)) {
        const label = meta ? meta.label : entry.action;
        toast(`${meta?.ico || '🔔'} ${label}${entry.detail ? ' — ' + String(entry.detail).slice(0, 60) : ''}`);
    }
    if (FEED_BADGE.has(entry.action)) {
        feedUnread++;
        updateFeedBadge();
    }
}

function updateFeedBadge() {
    const b = $('badge-orders');
    if (!b) return;
    b.textContent = feedUnread > 99 ? '99+' : String(feedUnread);
    b.classList.toggle('hidden', feedUnread <= 0);
}

function clearFeedBadge() {
    feedUnread = 0;
    updateFeedBadge();
}

function renderRevenueBars(months) {
    const svg = $('rev-bars');
    if (!svg) return;
    const W = 900, H = 180, pad = 24;
    const max = Math.max(1, ...months.map((m) => m.total));
    const bw = (W - pad * 2) / Math.max(1, months.length);
    const bars = months.map((m, i) => {
        const h = Math.round(((m.total / max) * (H - pad * 2)) || 0);
        const x = pad + i * bw + bw * 0.18;
        const w = bw * 0.64;
        const y = H - pad - h;
        return `<rect x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${h}" rx="4" class="rev-bar"><title>${esc(m.label)}: ${fmtRp(m.total)} (${m.count})</title></rect>
                <text x="${(x + w / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="rev-lab">${esc(m.label)}</text>`;
    }).join('');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = bars;
}
