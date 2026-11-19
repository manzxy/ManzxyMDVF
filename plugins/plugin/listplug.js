module.exports = {
    name: 'List Plugin',
    command: ['listplug', 'listplugin', 'plugins'],
    category: 'owner',
    order: 5,
    description: 'Melihat seluruh daftar plugin yang terpasang di sistem bot',
    usage: '.listplug',
    rootOwner: true, // Hanya Root Owner
    
    async execute(sock, m, ctx) {
        const { reply } = ctx;
        const grouped = ctx.getPluginsByCategory();
        
        let totalPlugins = 0;
        let totalCommands = 0;
        const sections = [];

        // Looping dan mengurutkan kategori sesuai abjad
        for (const [cat, list] of Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0]))) {
            totalPlugins += list.length;
            totalCommands += list.reduce((acc, p) => acc + (p.commands ? p.commands.length : 0), 0);
            
            // Menyusun nama command utama dari masing-masing plugin ke samping (koma)
            const pluginNames = list.map(p => p.commands?.[0] || p.name).sort();
            
            sections.push(`│ ◦ *${cat.toUpperCase()}* ( ${list.length} )\n│   └ ${pluginNames.join(', ')}`);
        }

        // Output akhir yang digabung jadi 1 kotak rapi
        const output = `╭─「 *SYSTEM PLUGINS* 」
│ ⬡ *Kategori:* ${Object.keys(grouped).length}
│ ⬡ *Plugin:* ${totalPlugins} File
│ ⬡ *Command:* ${totalCommands} Cmds
├──────────────
${sections.join('\n│\n')}
╰──────────────`;

        await reply(output);
    }
};
