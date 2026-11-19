/**
 * Server HTTP kecil: keep-alive (/) dan health (/health).
 */
const http = require('http');
const config = require('../../config');
const { logInfo, logWarn } = require('./logger');

let server = null;

function start() {
    if (!config.enableKeepAliveServer || server) return;
    server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'online', botName: config.botName, version: config.version, uptime: Math.floor(process.uptime()), panel: '/panel' }));
    });
    server.on('error', (err) => logWarn('SERVER', `Gagal membuka port ${config.port}: ${err.message}`));
    server.listen(config.port, () => logInfo('SERVER', `HTTP aktif di port ${config.port}`));
}

function stop() { try { server?.close(); } catch {} server = null; }

module.exports = { start, stop, get server() { return server; } };
