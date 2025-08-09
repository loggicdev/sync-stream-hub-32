const express = require('express');
const router = express.Router();
const os = require('os');
const { exec } = require('child_process');

// Healthcheck endpoint
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Informações básicas do sistema
router.get('/info', (req, res) => {
  res.json({
    timestamp: new Date().toISOString(),
    platform: os.platform(),
    arch: os.arch(),
    cpus: os.cpus().length,
    memory: {
      total: os.totalmem(),
      free: os.freemem()
    },
    uptime: os.uptime(),
    env: process.env,
    cwd: process.cwd()
  });
});

// Executa comandos básicos (restrito)
router.post('/exec', (req, res) => {
  const allowed = ['docker ps', 'dokploy status', 'ls', 'whoami', 'uptime'];
  const cmd = req.body && req.body.cmd;
  if (!cmd || !allowed.includes(cmd)) {
    return res.status(400).json({ error: 'Comando não permitido', allowed });
  }
  exec(cmd, { timeout: 5000 }, (err, stdout, stderr) => {
    if (err) {
      return res.status(500).json({ error: err.message, stderr });
    }
    res.json({ stdout });
  });
});

// Retorna logs recentes do sistema
router.get('/logs', (req, res) => {
  exec('tail -n 100 /var/log/syslog', { timeout: 5000 }, (err, stdout, stderr) => {
    if (err) {
      return res.status(500).json({ error: err.message, stderr });
    }
    res.json({ logs: stdout });
  });
});

// Testa conexão SSH (exemplo)
router.post('/ssh', (req, res) => {
  const host = req.body && req.body.host;
  if (!host) return res.status(400).json({ error: 'Host não informado' });
  exec(`ssh -o ConnectTimeout=5 ${host} echo ok`, (err, stdout, stderr) => {
    if (err) {
      return res.status(500).json({ error: err.message, stderr });
    }
    res.json({ result: stdout.trim() });
  });
});

module.exports = router;
