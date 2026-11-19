# Membuat Panel Web Online — DNS + HTTPS (Reverse Proxy)

Masalah yang pernah terjadi: `panel.manzxy.biz.id` → **DNS_PROBE_FINISHED_NXDOMAIN**
(subdomain belum dibuat/diarahkan ke server). Ikuti langkah berikut berurutan.

## 1. DNS — arahkan subdomain ke server

Di pengelola domain (tempat `manzxy.biz.id` dibeli, mis. Cloudflare):

| Tipe | Nama | Isi | TTL |
|------|------|-----|-----|
| A | `panel` | IP publik VPS (mis. `203.0.113.10`) | Auto |

Kalau memakai Cloudflare proxy (awan oranye), nanti mode SSL/Site harus
**Full (strict)** supaya tidak loop redirect.

Cek sudah merespons (bisa butuh beberapa menit):

```bash
dig +short panel.manzxy.biz.id     # harus keluar IP VPS
```

## 2. HTTPS — pasang reverse proxy di VPS

Panel bot berjalan di `http://127.0.0.1:PORT` (default PORT 3000, lihat `.env`).
Reverse proxy memberi HTTPS + memforward ke port itu.

### Opsi A — Caddy (paling mudah, sertifikat otomatis)

```bash
sudo apt install -y caddy
```

`/etc/caddy/Caddyfile`:

```caddy
panel.manzxy.biz.id {
    reverse_proxy 127.0.0.1:3000
}
```

```bash
sudo systemctl reload caddy
```

Selesai — sertifikat Let's Encrypt diterbitkan otomatis.

### Opsi B — Nginx + certbot

`/etc/nginx/sites-available/panel`:

```nginx
server {
    listen 80;
    server_name panel.manzxy.biz.id;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        # penting untuk SSE (/api/events — monitor realtime panel):
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/panel /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d panel.manzxy.biz.id     # HTTPS otomatis
```

> `proxy_buffering off` wajib agar halaman MONITOR realtime (SSE) tidak tersendat.
> Caddy sudah menangani ini sendiri.

## 3. Set alamat panel

Set DNS + HTTPS jalan, pastikan alamat panel tercatat (dipakai redirect URI
OAuth & link referral):

- Lewat panel: **Owner → Alamat panel** → `https://panel.manzxy.biz.id`
- Atau lewat `.env`: `WEB_PANEL_URL=https://panel.manzxy.biz.id` lalu
  `pm2 restart ManzxyMD --update-env`

## 4. OAuth callback

Di konsol Google/GitHub, callback URL mengikuti alamat panel:

- Google : `https://panel.manzxy.biz.id/api/auth/google/callback`
- GitHub : `https://panel.manzxy.biz.id/api/auth/github/callback`

## 5. Verifikasi

```bash
curl -sI https://panel.manzxy.biz.id/health | head -3     # HTTP/2 200
curl -s https://panel.manzxy.biz.id/health                # JSON status online
```

Buka `https://panel.manzxy.biz.id` → landing page; `/panel` → panel login.
