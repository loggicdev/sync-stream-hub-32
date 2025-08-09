const express = require('express');
const app = express();

// Importa rotas
const diagnostic = require('./routes/diagnostic');
app.use('/api', diagnostic);

// ...existing code...

// Sobe o servidor na porta 4000 e em todas as interfaces
const PORT = process.env.PORT || 4000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API rodando na porta ${PORT}`);
});
