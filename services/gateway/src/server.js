require('dotenv').config();
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const app = express();
const PORT = Number(process.env.GATEWAY_PORT || 3000);
const authTarget = process.env.AUTH_SERVICE_URL || 'http://127.0.0.1:4001';

app.disable('x-powered-by');
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'gateway' }));
app.use(createProxyMiddleware({
  target: authTarget,
  changeOrigin: true,
  ws: false,
  pathFilter: ['/api/auth/**', '/api/me', '/api/logout', '/auth/**'],
  on: { error: (_err, _req, res) => res.status(502).json({ erro: 'Serviço de autenticação indisponível.' }) }
}));
app.listen(PORT, () => console.log(`Gateway listening on :${PORT}`));
