/**
 * Plugin: Backup Source Code (Menggunakan adm-zip)
 * Fungsi: Membuat arsip .zip dari source code bot dan mengirimkannya via WA.
 * Fitur : Mengecualikan node_modules, session, jadibot, dan file backup ini sendiri.
 * Akses : ROOT OWNER ONLY
 */
const fs = require('fs');
const path = require('path');

let AdmZip;
try {
    AdmZip = require('adm-zip');
} catch (err) {
    AdmZip = null;
}

module.exports = {
    name: 'Backup Source Code',
    command: ['backupsc', 'backup'],
    category: 'owner',
    rootOwner: true, // WAJIB TRUE! Hanya root owner yang bisa membackup SC
    description: 'Backup source code bot ke format .zip (via adm-zip)',
    usage: '.backupsc',
    
    async execute(sock, m, { reply }) {
        if (!AdmZip) {
            return reply(`❌ *Modul 'adm-zip' belum terpasang!*\n\nSilakan buka terminal/console VPS kamu dan ketik:\n\`npm i adm-zip\``);
        }

        await reply('⏳ Sedang membaca dan mem-packing file source code... Mohon tunggu sebentar.');

        try {
            const date = new Date();
            const timestamp = `${date.getFullYear()}${(date.getMonth()+1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}_${date.getHours()}${date.getMinutes()}`;
            
            const outputName = `Backup_Bot_${timestamp}.zip`;
            const outputPath = path.join(process.cwd(), outputName);
            const rootDir = process.cwd();

            const zip = new AdmZip();

            // Fungsi rekursif untuk membaca seluruh folder dan file
            function addFolderToZip(dirPath, currentZipPath = '') {
                const items = fs.readdirSync(dirPath);

                for (const item of items) {
                    const fullPath = path.join(dirPath, item);
                    const relativePath = path.join(currentZipPath, item).replace(/\\/g, '/'); // Normalisasi path (Linux/Windows)

                    // 🛑 DAFTAR PENGECUALIAN (EXCLUDE)
                    if (
                        relativePath.startsWith('node_modules') || 
                        relativePath.startsWith('session') || 
                        relativePath.startsWith('auth_info') || // Opsi tambahan jika session Baileys bernama ini
                        relativePath.startsWith('jadibot') ||
                        relativePath.startsWith('.git') ||
                        relativePath === 'plugins/owner/backupsc.js' || // Abaikan file plugin ini sendiri (path lama: plugins/backup.js)
                        relativePath === 'database.json' || 
                        relativePath.endsWith('.zip') || 
                        relativePath.endsWith('.tar.gz')
                    ) {
                        continue; // Lewati file/folder ini
                    }

                    const stat = fs.statSync(fullPath);
                    if (stat.isDirectory()) {
                        // Jika berupa folder, masuk lebih dalam
                        addFolderToZip(fullPath, relativePath);
                    } else {
                        // Jika berupa file, tambahkan ke dalam arsip zip
                        let targetDir = path.dirname(relativePath).replace(/\\/g, '/');
                        if (targetDir === '.') targetDir = ''; // Taruh di root zip jika file ada di root folder
                        
                        zip.addLocalFile(fullPath, targetDir);
                    }
                }
            }

            // Mulai proses scanning dari folder root
            addFolderToZip(rootDir);

            // Simpan zip ke disk (lokal) sementara
            zip.writeZip(outputPath);

            // Cek keberhasilan dan ukuran
            if (!fs.existsSync(outputPath)) {
                throw new Error("Gagal menulis file zip ke penyimpanan lokal.");
            }

            const stats = fs.statSync(outputPath);
            const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);
            
            await reply(`✅ *Proses ZIP Selesai!*\n\n📦 Nama: ${outputName}\n📊 Ukuran: ${fileSizeMB} MB\n\n_Sedang mengunggah dokumen ke obrolan..._`);
            
            // Kirim ke WhatsApp
            await sock.sendMessage(m.key.remoteJid, {
                document: { url: outputPath },
                mimetype: 'application/zip',
                fileName: outputName,
                caption: '📦 Ini file backup source code bot kamu.\n_(node_modules, session, jadibot, dan plugin backup ini telah diabaikan)_'
            }, { quoted: m });

            // Hapus file zip setelah berhasil terkirim
            if (fs.existsSync(outputPath)) {
                fs.unlinkSync(outputPath);
            }

        } catch (err) {
            await reply(`❌ *Terjadi Kesalahan:*\n${err.message}`);
        }
    }
};
