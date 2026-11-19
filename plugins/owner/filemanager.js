/**
 * Plugin: File Manager (Root Access)
 * Fungsi: svfl (Save File), gtfl (Get File), dlfl (Delete File), edfl (Edit File)
 * Akses : ROOT OWNER ONLY (Sangat Berbahaya)
 */
const fs = require('fs');
const path = require('path');

module.exports = {
    name: 'File Manager',
    command: ['svfl', 'gtfl', 'dlfl', 'edfl'],
    category: 'owner',
    rootOwner: true, // WAJIB TRUE! Agar tidak sembarang orang bisa otak-atik file server
    description: 'Kelola file bot (Save, Get, Delete, Edit) di seluruh folder',
    usage: '.svfl <path> <teks> | .gtfl <path>',
    
    async execute(sock, m, { command, args, text, reply, quoted, prefix }) {
        if (!args[0]) {
            return reply(`*📂 PANDUAN FILE MANAGER*\n\n` +
                `• *Simpan/Buat File:*\n  \`${prefix}svfl <path_file> <teks>\`\n  _(atau reply teks dengan perintah ${prefix}svfl <path_file>)_\n\n` +
                `• *Lihat Isi File:*\n  \`${prefix}gtfl <path_file>\`\n\n` +
                `• *Hapus File:*\n  \`${prefix}dlfl <path_file>\`\n\n` +
                `• *Edit File (Replace Teks):*\n  \`${prefix}edfl <path_file> | teks_lama | teks_baru\``);
        }

        // Ambil root direktori bot (contoh: /home/container atau C:\bot)
        const rootDir = process.cwd();
        
        // Gabungkan root path dengan argumen path yang diinput
        const targetPath = path.resolve(rootDir, args[0]);
        
        // KEAMANAN TAMBAHAN: Cegah Directory Traversal (mundur ke folder sistem linux/windows)
        if (!targetPath.startsWith(rootDir)) {
            return reply('❌ *Akses Ditolak:* Kamu tidak diizinkan mengubah file di luar folder root bot.');
        }

        try {
            /* ───────────────────────── 1. SAVE FILE (.svfl) ───────────────────────── */
            if (command === 'svfl') {
                let content = quoted ? quoted.text : args.slice(1).join(' ');
                
                if (!content) {
                    return reply('❌ Masukkan teks atau *reply* pesan yang berisi teks untuk disimpan ke dalam file.');
                }
                
                // Buat folder secara rekursif jika belum ada (misal: plugins/baru/fitur.js)
                const dir = path.dirname(targetPath);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                
                fs.writeFileSync(targetPath, content, 'utf8');
                return reply(`✅ *BERHASIL DISIMPAN*\n\n📁 Path: \`${args[0]}\`\n📊 Ukuran: ${content.length} karakter`);
            }
            
            /* ───────────────────────── 2. GET FILE (.gtfl) ───────────────────────── */
            if (command === 'gtfl') {
                if (!fs.existsSync(targetPath)) return reply(`❌ File tidak ditemukan di:\n\`${args[0]}\``);
                
                const stat = fs.statSync(targetPath);
                if (stat.isDirectory()) return reply('❌ Path tersebut mengarah ke Folder, bukan File.');
                
                const content = fs.readFileSync(targetPath, 'utf8');
                
                // Jika file terlalu besar (> 50.000 karakter), kirim sebagai file dokumen
                if (content.length > 50000) {
                    return await sock.sendMessage(m.key.remoteJid, { 
                        document: fs.readFileSync(targetPath), 
                        fileName: path.basename(targetPath), 
                        mimetype: 'text/plain',
                        caption: `📄 File terlalu panjang, dikirim sebagai dokumen.`
                    }, { quoted: m });
                }
                
                return reply(content);
            }
            
            /* ───────────────────────── 3. DELETE FILE (.dlfl) ───────────────────────── */
            if (command === 'dlfl') {
                if (!fs.existsSync(targetPath)) return reply(`❌ File tidak ditemukan di:\n\`${args[0]}\``);
                
                const stat = fs.statSync(targetPath);
                if (stat.isDirectory()) {
                    return reply('❌ Path tersebut adalah folder. Hapus manual untuk mencegah kehilangan data berantai.');
                }
                
                fs.unlinkSync(targetPath);
                return reply(`✅ *FILE BERHASIL DIHAPUS*\n\n🗑️ Path: \`${args[0]}\``);
            }
            
            /* ───────────────────────── 4. EDIT FILE (.edfl) ───────────────────────── */
            if (command === 'edfl') {
                if (!fs.existsSync(targetPath)) return reply(`❌ File tidak ditemukan di:\n\`${args[0]}\``);
                
                // Ambil string mentah tanpa args[0] (path)
                const restText = text.slice(args[0].length).trim();
                const parts = restText.split('|');
                
                if (parts.length < 2) {
                    return reply(`❌ *Format Edit Salah!*\n\nGunakan format pemisah \`|\`\nContoh: \`${prefix}edfl lib/utils.js | const lama = 1 | const baru = 2\``);
                }
                
                const oldText = parts[0].trim();
                const newText = parts.slice(1).join('|').trim(); // Gabungkan sisa jaga-jaga teks barunya juga mengandung '|'
                
                let content = fs.readFileSync(targetPath, 'utf8');
                
                if (!content.includes(oldText)) {
                    return reply(`❌ *Gagal Edit:* Teks:\n\n\`\`\`${oldText}\`\`\`\n\nTidak ditemukan di dalam file tersebut. Pastikan kapitalisasi dan spasinya sama persis.`);
                }
                
                content = content.replace(oldText, newText);
                fs.writeFileSync(targetPath, content, 'utf8');
                
                return reply(`✅ *BERHASIL DIEDIT*\n\n📁 Path: \`${args[0]}\`\nBagian yang kamu pilih berhasil diganti dengan teks baru.`);
            }
            
        } catch (err) {
            return reply(`❌ *TERJADI KESALAHAN SISTEM*\n\n\`\`\`${err.message}\`\`\``);
        }
    }
};
