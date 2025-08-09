const express = require('express');
const app = express();

// Importa rotas
const diagnostic = require('./routes/diagnostic');
app.use('/api', diagnostic);

// Healthcheck direto (redundância)
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Sobe o servidor na porta 3001 e em todas as interfaces
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API rodando na porta ${PORT}`);
});
