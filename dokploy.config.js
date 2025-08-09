module.exports = {
  // Configuração do Dokploy
  port: process.env.PORT || 80,
  buildCommand: "npm run build",
  startCommand: "npm run start",
  healthCheck: "/",
  environment: "production"
}
