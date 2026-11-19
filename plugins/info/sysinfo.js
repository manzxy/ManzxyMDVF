const { runtime, formatBytes } = require('../../lib/core/utils');
const sysinfo = require('../../lib/services/sysinfo');

function bar(percent, width = 10) {
    const p = Math.max(0, Math.min(100, percent));
    const filled = Math.round((p / 100) * width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
}

module.exports = {
    name: 'Info Sistem',
    command: ['sysinfo', 'ram', 'spek', 'specs'],
    category: 'info',
    description: 'Spesifikasi lengkap server: CPU, RAM, disk, OS, runtime, jaringan',
    usage: '.sysinfo',
    limit: 0,
    async execute(sock, m, { reply, db, text }) {
        const s = sysinfo.snapshot();
        const arg = (text || '').toLowerCase().trim();
        const brief = arg === 'brief' || arg === 'singkat';
        const out = [];

        if (!brief) out.push('*══════ SPESIFIKASI SERVER ══════*', '');

        if (!brief) {
            out.push('*🖥️ HOST*');
            out.push(`OS      : ${s.host.os}`);
            out.push(`Kernel  : ${s.host.kernel}`);
            out.push(`Arsitek : ${s.cpu.arch} (${s.cpu.bits})`);
            out.push(`Hostname: ${s.host.hostname}`);
            out.push(`Lingkup : ${s.host.environment.label}`);
            out.push('');

            out.push('*⚙️ CPU*');
            out.push(`Model   : ${s.cpu.model}`);
            out.push(`Core    : ${s.cpu.cores} vCPU @ ${s.cpu.mhz ? `${s.cpu.mhz} MHz` : '-'}`);
            const ld = (k) => Number(s.cpu.load[k] ?? s.cpu.load[String(k)] ?? 0) || 0;
            out.push(`Load    : ${ld(1).toFixed(2)} / ${ld(5).toFixed(2)} / ${ld(15).toFixed(2)}`);
            if (s.cpu.temp) out.push(`Suhu    : ${s.cpu.temp}°C`);
            out.push('');

            out.push('*🧠 RAM*');
            out.push(`Total   : ${formatBytes(s.memory.total)}`);
            out.push(`Terpakai: ${formatBytes(s.memory.used)} [${bar(s.memory.percent)}] ${s.memory.percent.toFixed(1)}%`);
            out.push(`Bebas   : ${formatBytes(s.memory.free)}`);
            out.push('');

            if (s.disk.length) {
                out.push('*💾 DISK*');
                for (const d of s.disk) {
                    out.push(`${d.mount} : ${formatBytes(d.used)} / ${formatBytes(d.total)} (${d.percent}%)`);
                    out.push(`      sisa ${formatBytes(d.avail)} · ${d.device}`);
                }
                out.push('');
            }

            out.push('*🌐 JARINGAN*');
            if (s.network.ipv4.length) {
                for (const i of s.network.ipv4) out.push(`  ${i.name}: ${i.address}`);
            } else out.push('  (tidak ada IPv4 terdeteksi)');
            if (s.network.ports.length) out.push(`Port listen: ${s.network.ports.join(', ')}`);
            out.push('');

            out.push('*🧩 RUNTIME BOT*');
            out.push(`Node    : ${s.runtime.node} (${s.host.platform})`);
            out.push(`Bot RAM : ${formatBytes(s.runtime.rss)} (heap ${formatBytes(s.runtime.heapUsed)})`);
            out.push(`Uptime  : ${runtime(s.runtime.uptimeBot)} (server ${runtime(s.runtime.uptimeSystem)})`);
            out.push(`PID     : ${s.runtime.pid}`);
        }

        out.push('');
        out.push('*📊 DATA BOT*');
        out.push(`Database: ${Object.keys(db.data.users).length} user, ${Object.keys(db.data.groups).length} grup`);
        out.push('');
        out.push('_Detail lengkap ada di panel web → tab SISTEM._');

        await reply(out.join('\n').replace(/\n{3,}/g, '\n\n'));
    }
};
