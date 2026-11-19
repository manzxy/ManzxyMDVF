# Inventory — ManzxyMD Web (audit responsive mobile/tablet/desktop)

Tujuan run ini: **menyamakan tampilan mobile vs desktop di semua halaman web** dan memperbaiki
bug tampilan yang masih ada. Fokus utama = reflow di 390x844 (mobile), 768x1024 (tablet),
1440x900 (desktop). Viewport tambahan 360x800 untuk HP kecil.

## Cara menjangkau state

- **Auth view** panel: buka `/panel` tanpa token → `#view-auth` (login). Tab: MASUK / DAFTAR /
  lupa password (`#form-reset`). Modal: passkey login (`#modal-passkey`), 2FA muncul saat login
  akun 2FA (tidak bisa tanpa akun 2FA — diuji via DOM class toggle).
- **App view** panel: set `localStorage.mz_token` + mock API via `network route` → `#view-app`
  dengan 12 tab: dashboard, monitor, jadibot, premium, referral, topup, orders, owner,
  system, database, logs, profile. Owner/admin tabs tersembunyi untuk role user.
- **Modal**: pairing (`#modal-pairing`), confirm (`#modal-confirm`), command palette
  (`Ctrl+K`), tour onboarding (muncul saat pertama masuk app, `mz_tour_done` belum diset).
- **Landing**: `/` (root) — harga di-inject server.
- **Status**: `/status` — halaman statis, data server-side.
- **Docs**: `/docs` → `docs.html`.
- **Offline**: `offline.html` — ditampilkan service worker saat offline.
- **Error/empty**: panel dengan API gagal (route abort), daftar kosong (mock `[]`).

## Halaman & layout

| Slug | Route | Layout | Catatan |
|---|---|---|---|
| landing | `/` | satu kolom, hero + fitur + harga | CSS inline sendiri, dark mode otomatis |
| panel-auth | `/panel` (tanpa sesi) | card + aside (auth-wrap 2 kolom) | style.css |
| panel-app | `/panel` (sesi) | topbar + tabs + content grid | 12 halaman, modal, palette |
| status | `/status` | card tunggal terpusat | CSS inline sendiri |
| docs | `/docs` | satu kolom panjang | style.css? (perlu cek) |
| offline | service worker | card tunggal | CSS inline sendiri |

## Component groups

- topbar (brand, balance chip, avatar, logout)
- tabs nav (12 tab, wrap di ≤820px)
- card / stat / grid-2..4
- form (lbl, inp, btn, otp-row, field-hint)
- modal-backdrop + modal (pairing, confirm, passkey, botset, events, db-raw)
- list rows (admin-row, session-row, audit-row, log-row, order-card, lb-row, pkg-row)
- toast, alert (green/red/yellow), panic-banner
- sys graphs, heatmap, db-grid, cmd-row

## Design system

Token di `:root` style.css (warna, radius, shadow). Tidak ada enforcement script; test
`tests/web-security.test.js` menguji keamanan, bukan layout. Perbaikan harus masuk
style.css / media query bersama, bukan patch per-halaman.

## Run sebelumnya

Tidak ada `docs/ux-visual/run-history.json` — run pertama. Bug `pm-status` ganda sudah
diperbaiki di run sebelumnya (bukan bagian run ini).
