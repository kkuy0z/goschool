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

// O frontend fica em uma única pasta (public). Estas rotas preservam os
// endereços usados pelos menus e encaminham cada painel para seu HTML real.
const pageAliases = new Map([
  ["/Aluno", "aluno.html"],
  ["/Professor", "professor.html"],
  ["/Admin", "adm.html"],
  ["/Admin/usuarios", "usuarios.html"],
  ["/Cardapio", "cardapio.html"],
  ["/Reservas", "reservas.html"],
  ["/Configuracoes", "config.html"],
  ["/Desperdicio", "desperdicio.html"],
  ["/Cadastro", "cadastro.html"],
  ["/login", "login.html"],
]);

app.get([...pageAliases.keys()], (req, res) => {
  const file = pageAliases.get(req.path);
  if (!file) return res.status(404).end();
  return res.sendFile(path.resolve(__dirname, "../../../public", file));
});
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
