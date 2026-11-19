#!/usr/bin/env bash
#
# Setup lengkap: domain manzxy.biz.id → panel bot (port 3000)
# Jalankan setelah `cloudflared tunnel login` berhasil (cert.pem ada).
#
#   bash scripts/setup-domain.sh
#
set -e

DOMAIN="manzxy.biz.id"
SUBDOMAIN="panel"                     # → panel.manzxy.biz.id
HOSTNAME="${SUBDOMAIN}.${DOMAIN}"
TUNNEL="manzxymd"
PORT="${PORT:-3000}"
CF_DIR="$HOME/.cloudflared"

cyan() { printf '\033[36m%s\033[0m\n' "$*"; }
green() { printf '\033[32m✅ %s\033[0m\n' "$*"; }
red() { printf '\033[31m❌ %s\033[0m\n' "$*"; }

cyan "═══ 1. Cek prasyarat ═══"

if ! command -v cloudflared >/dev/null; then
    red "cloudflared belum terinstall"
    echo "   curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cf.deb && dpkg -i /tmp/cf.deb"
    exit 1
fi
green "cloudflared $(cloudflared --version | awk '{print $3}')"

if [ ! -f "$CF_DIR/cert.pem" ]; then
    red "Belum login. Jalankan dulu: cloudflared tunnel login"
    exit 1
fi
green "Sertifikat Cloudflare ditemukan"

# Panel harus hidup
if ! curl -sf -m 5 "http://127.0.0.1:${PORT}/api/health" >/dev/null; then
    red "Panel tidak merespons di port ${PORT}"
    echo "   Cek: pm2 status && pm2 logs ManzxyMD --lines 30"
    exit 1
fi
green "Panel hidup di port ${PORT}"

cyan ""
cyan "═══ 2. Buat / pakai tunnel '${TUNNEL}' ═══"

EXISTING_ID=$(cloudflared tunnel list --output json 2>/dev/null | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
try{const l=JSON.parse(s);const t=l.find(x=>x.name===process.argv[1]);if(t)process.stdout.write(t.id);}catch{}
})' "$TUNNEL")

if [ -n "$EXISTING_ID" ]; then
    TUNNEL_ID="$EXISTING_ID"
    green "Tunnel sudah ada: $TUNNEL_ID"
else
    cloudflared tunnel create "$TUNNEL"
    TUNNEL_ID=$(cloudflared tunnel list --output json | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
try{const l=JSON.parse(s);const t=l.find(x=>x.name===process.argv[1]);if(t)process.stdout.write(t.id);}catch{}
})' "$TUNNEL")
    green "Tunnel dibuat: $TUNNEL_ID"
fi

CRED="${CF_DIR}/${TUNNEL_ID}.json"
[ -f "$CRED" ] || { red "File kredensial tidak ada: $CRED"; exit 1; }

cyan ""
cyan "═══ 3. Tulis config.yml ═══"

cat > "$CF_DIR/config.yml" <<EOF
# Dibuat otomatis oleh scripts/setup-domain.sh
tunnel: ${TUNNEL_ID}
credentials-file: ${CRED}

ingress:
  - hostname: ${HOSTNAME}
    service: http://localhost:${PORT}
  - service: http_status:404
EOF
green "$CF_DIR/config.yml"

cyan ""
cyan "═══ 4. DNS record ${HOSTNAME} ═══"

cloudflared tunnel route dns "$TUNNEL" "$HOSTNAME" 2>&1 | sed 's/^/   /' || true
green "CNAME ${HOSTNAME} → ${TUNNEL_ID}.cfargotunnel.com"

cyan ""
cyan "═══ 5. Pasang sebagai service ═══"

mkdir -p /etc/cloudflared
cp "$CF_DIR/config.yml" /etc/cloudflared/config.yml
cp "$CRED" /etc/cloudflared/ 2>/dev/null || true

# Sesuaikan path kredensial untuk service (dijalankan sebagai root)
sed -i "s#credentials-file: ${CRED}#credentials-file: /etc/cloudflared/$(basename "$CRED")#" /etc/cloudflared/config.yml

cloudflared service install 2>&1 | sed 's/^/   /' || true
systemctl enable cloudflared >/dev/null 2>&1 || true
systemctl restart cloudflared
sleep 3
systemctl is-active cloudflared >/dev/null && green "Service cloudflared aktif" || red "Service gagal start — cek: journalctl -u cloudflared -n 30"

cyan ""
cyan "═══ 6. Uji akses ═══"

echo "   menunggu DNS propagasi..."
for i in $(seq 1 12); do
    CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 8 "https://${HOSTNAME}/api/health" || echo 000)
    if [ "$CODE" = "200" ]; then
        green "https://${HOSTNAME}/api/health → 200"
        break
    fi
    sleep 5
done

echo ""
curl -s -m 8 "https://${HOSTNAME}/api/health" 2>/dev/null | head -c 300 || true
echo ""
curl -s -o /dev/null -w "   /panel → HTTP %{http_code}\n" -m 8 "https://${HOSTNAME}/panel" || true

cyan ""
cyan "═══ SELESAI ═══"
cat <<EOF

Panel:  https://${HOSTNAME}/panel

Langkah terakhir — set environment di PM2:

  pm2 restart ManzxyMD --update-env

Dan pastikan ecosystem.config.js berisi:

  WEB_PANEL_URL: 'https://${HOSTNAME}'
  GOOGLE_CLIENT_ID: '...'
  GOOGLE_CLIENT_SECRET: '...'
  GITHUB_CLIENT_ID: '...'
  GITHUB_CLIENT_SECRET: '...'

Redirect URI untuk OAuth:

  https://${HOSTNAME}/api/auth/google/callback
  https://${HOSTNAME}/api/auth/github/callback

EOF