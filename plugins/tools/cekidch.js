/**
 * Plugin: Cek ID Channel
 * Fungsi: Mendapatkan ID dan metadata WhatsApp Channel dari link atau pesan yang diteruskan (forward).
 */
module.exports = {
    name: 'Cek ID Channel',
    command: ['cekidch', 'idch', 'channelid'],
    category: 'tools',
    description: 'Cek ID WhatsApp Channel dari link atau pesan forward',
    usage: '.cekidch <link_channel> atau reply pesan forward dari channel',
    
    async execute(sock, m, { text, reply, quoted, prefix, command }) {
        let channelInfo = null;

        await reply('⏳ Sedang memproses data channel...');

        try {
            // 1. CEK DARI PESAN YANG DI-REPLY (FORWARD MESSAGE DARI CHANNEL)
            if (quoted && quoted.message) {
                const qMsg = quoted.message;
                const type = Object.keys(qMsg).find(k => k !== 'messageContextInfo');
                
                if (type && qMsg[type]?.contextInfo?.forwardedNewsletterMessageInfo) {
                    const nlInfo = qMsg[type].contextInfo.forwardedNewsletterMessageInfo;
                    channelInfo = {
                        id: nlInfo.newsletterJid,
                        name: nlInfo.newsletterName,
                        source: 'Forwarded Message'
                    };
                }
            }

            // 2. CEK DARI LINK YANG DIKIRIM (URL WHATSAPP CHANNEL)
            const inviteRegex = /(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/([a-zA-Z0-9_-]+)/i;
            const match = text ? text.match(inviteRegex) : null;

            if (match) {
                const inviteCode = match[1];
                try {
                    // Fetch metadata dari server WhatsApp menggunakan invite code
                    const meta = await sock.newsletterMetadata("invite", inviteCode);
                    
                    if (meta) {
                        channelInfo = {
                            id: meta.id,
                            name: meta.name,
                            subscribers: meta.subscribers || 0,
                            description: meta.description || 'Tidak ada deskripsi',
                            verified: meta.verification === 'VERIFIED',
                            status: meta.state || 'ACTIVE',
                            source: 'Invite Link'
                        };
                    }
                } catch (err) {
                    return reply(`❌ *Gagal mengambil metadata channel.*\nPastikan link valid dan channel tersebut bersifat publik.`);
                }
            }

            // JIKA DATA TIDAK DITEMUKAN DARI KEDUANYA
            if (!channelInfo) {
                let guide = `*📂 PANDUAN CEK ID CHANNEL*\n\n`;
                guide += `Ada 2 cara menggunakan fitur ini:\n\n`;
                guide += `*1. Menggunakan Link:*\n`;
                guide += `Ketik: \`${prefix}${command} https://whatsapp.com/channel/xxx\`\n\n`;
                guide += `*2. Menggunakan Reply:*\n`;
                guide += `Teruskan (Forward) pesan dari Channel ke sini, lalu balas (reply) pesan tersebut dengan mengetik \`${prefix}${command}\``;
                
                return reply(guide);
            }

            // 3. SUSUN DAN TAMPILKAN HASILNYA
            let output = `📢 *CHANNEL INFO*\n`;
            output += `──────────────────────\n\n`;
            output += `📛 *Nama:* ${channelInfo.name} ${channelInfo.verified ? '☑️' : ''}\n`;
            output += `🆔 *ID Channel:*\n\`${channelInfo.id}\`\n\n`;
            
            // Tampilkan metadata tambahan jika didapatkan dari Link
            if (channelInfo.source === 'Invite Link') {
                output += `👥 *Pengikut:* ${channelInfo.subscribers.toLocaleString('id-ID')}\n`;
                output += `🟢 *Status:* ${channelInfo.status}\n`;
                
                if (channelInfo.description !== 'Tidak ada deskripsi') {
                    const desc = channelInfo.description.length > 200 
                        ? channelInfo.description.slice(0, 200) + '...' 
                        : channelInfo.description;
                    output += `📝 *Deskripsi:*\n${desc}\n\n`;
                }
            } else {
                output += `_💡 Tip: Untuk melihat info lengkap (Pengikut, Deskripsi), gunakan metode Link Channel._\n\n`;
            }

            output += `──────────────────────\n`;
            output += `_Diambil via: ${channelInfo.source}_`;

            await reply(output);

        } catch (err) {
            await reply(`❌ *Terjadi Kesalahan:*\n${err.message}`);
        }
    }
};
