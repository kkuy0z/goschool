const path = require("path");
const dotenv = require("dotenv");

// Ajuste relativo à estrutura services/Gateway/src/server.js
dotenv.config({
  path: path.resolve(__dirname, "../../../.env"),
});

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();
const PORT = Number(process.env.GATEWAY_PORT || 3000);
const authTarget = process.env.AUTH_SERVICE_URL || "http://127.0.0.1:4001";

app.disable("x-powered-by");

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "gateway",
  });
});

const authPaths = [
  "/api/auth",
  "/api/admin",
  "/api/me",
  "/api/logout",
  "/auth",
];

const authProxy = createProxyMiddleware({
  target: authTarget,
  changeOrigin: true,
  ws: false,

  // Inclui tanto a rota exata quanto suas subrotas.
  pathFilter: (requestPath) => {
    const pathname = requestPath.split("?")[0];

    return authPaths.some(
      (route) => pathname === route || pathname.startsWith(`${route}/`),
    );
  },

  on: {
    error: (_error, _req, res) => {
      if (res && typeof res.status === "function") {
        res.status(502).json({
          erro: "Serviço de autenticação indisponível.",
        });
      }
    },
  },
});

app.use(authProxy);
app.get(/^\/Admin\/usuario\/\d+\/?$/, (_req, res) => {
  res.sendFile(path.resolve(__dirname, "../../../public/usuario.html"));
});

app.use(
  express.static(path.resolve(__dirname, "../../../public"), {
    extensions: ["html"],
  }),
);

app.get("/", (_req, res) => {
  res.sendFile(path.resolve(__dirname, "../../../public/inicio.html"));
});

app.listen(PORT, () => {
  console.log(`Gateway listening on :${PORT}`);
  console.log(`Auth Service target: ${authTarget}`);
});
