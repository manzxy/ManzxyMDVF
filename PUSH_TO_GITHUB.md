# Push edisi gratis ke GitHub

Repo sudah siap dan ter-commit lokal:
- Folder: `/root/manzxy-free-20261119_150307`
- Branch: `master`
- Commit: `096d9d3`
- Jumlah file: 218
- Status: bersih (sisa folder `docs/ux-visual/**/shots/` sengaja tidak dimasukkan)

## Sebelum push

Ganti placeholder di bawah:
- `<USER>` = username / organisasi GitHub kamu
- `<REPO>` = nama repo, mis. `manzxymd-free`

Kalau repo belum ada, buat dulu di https://github.com/new (disarankan **private** dulu;
buka public setelah yakin tidak ada kredensial yang tertinggal).

## Perintah (jalankan di server)

```bash
cd /root/manzxy-free-20261119_150307

# 1. Set remote
git remote add origin https://github.com/<USER>/<REPO>.git

# 2. Rename branch ke main (opsional, tapi umum dipakai GitHub)
git branch -M main

# 3. Push
git push -u origin main
```

Kalau GitHub minta login saat push, pakai **Personal Access Token** sebagai password:
- Buat token di https://github.com/settings/tokens (scope: `repo`)
- Saat diminta username: masukkan `<USER>`
- Saat diminta password: masukkan token (bukan password akun)

Atau simpan kredensial sekali pakai:

```bash
git config --global credential.helper store
# push pertama akan tanya user + token, lalu tersimpan
```

## Setelah push

Cek hasil:
```bash
git remote -v
git log --oneline -1
```

Atau buka `https://github.com/<USER>/<REPO>` di browser.

## Catatan penting

- Bot produksi di `/root/ManzxyBase` **tidak berubah** (billing live tetap jalan).
- Edisi gratis ini: semua user diperlakukan Premium, limit harian 0 (unlimited),
  plugin premium tidak diblokir, `freeForPremium: true`.
- Nomor owner & pairing sudah diganti placeholder `6281234567890` —
  **ganti ke nomor asli di `config.js` setelah di-clone** kalau dipakai.
- `.env`, sesi WhatsApp, database, backup, dan screenshot QA **tidak ikut** ke GitHub.
- Versi premium akan dibuat terpisah dari repo ini.
