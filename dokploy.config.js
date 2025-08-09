module.exports = {
  // Configuração do Dokploy
  port: 4000,
  buildCommand: "npm run build",
  startCommand: "npm run start",
  healthCheck: "/",
  environment: "production"
}
