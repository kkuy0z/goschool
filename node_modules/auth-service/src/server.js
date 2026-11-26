const path = require("path");
const dotenv = require("dotenv");

// services/auth-service/src/server.js -> raiz do GoSchool/.env
dotenv.config({
  path: path.resolve(__dirname, "../../../.env"),
});

const express = require("express");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const mysql = require("mysql2/promise");
const { OAuth2Client } = require("google-auth-library");

const app = express();
const PORT = Number(process.env.AUTH_PORT || 4001);

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID?.trim();
const JWT_SECRET = process.env.JWT_SECRET;
const COOKIE_NAME = "goschool_session";

const oauth = new OAuth2Client(CLIENT_ID || undefined);

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE || "goschool",
  waitForConnections: true,
  connectionLimit: 10,
});

app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.use(cookieParser());

const allowedDomains = new Set(["aluno.mg.gov.br", "educacao.mg.gov.br"]);

function secureCookie() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 8 * 60 * 60 * 1000,
  };
}

function issueSession(res, user) {
  const token = jwt.sign(
    {
      sub: String(user.id),
      email: user.email,
      role: user.tipo,
    },
    JWT_SECRET,
    {
      expiresIn: "8h",
      issuer: "goschool-auth",
    },
  );

  res.cookie(COOKIE_NAME, token, secureCookie());
}

function publicUser(row) {
  return {
    id: row.id,
    nome: row.nome,
    email: row.email,
    tipo: row.tipo,
  };
}

function isAuthConfigured() {
  return Boolean(CLIENT_ID && JWT_SECRET);
}

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "auth-service",
  });
});

// Diagnóstico da configuração. Não retorna o Client Secret.
app.get("/api/auth/config", (_req, res) => {
  if (!CLIENT_ID) {
    return res.status(503).json({
      erro: "Login institucional não configurado.",
    });
  }

  return res.json({
    clientId: CLIENT_ID,
  });
});

app.post("/auth/google/callback", async (req, res) => {
  try {
    if (!isAuthConfigured()) {
      return res.status(503).json({
        erro: "Autenticação não configurada no servidor.",
      });
    }

    const credential = req.body?.credential;

    if (
      typeof credential !== "string" ||
      credential.length === 0 ||
      credential.length > 10000
    ) {
      return res.status(400).json({
        erro: "Credencial inválida.",
      });
    }

    const ticket = await oauth.verifyIdToken({
      idToken: credential,
      audience: CLIENT_ID,
    });

    const claims = ticket.getPayload();

    if (!claims?.email || claims.email_verified !== true) {
      return res.status(401).json({
        erro: "Conta Google não verificada.",
      });
    }

    const email = claims.email.toLowerCase();
    const domain = email.split("@").pop();

    if (!allowedDomains.has(domain)) {
      return res.status(403).json({
        erro: "Use sua conta Google institucional.",
      });
    }

    // O perfil é definido pelo cadastro institucional no banco.
    const [rows] = await pool.execute(
      `SELECT id, nome, email, tipo, ativo
       FROM usuarios
       WHERE LOWER(email) = ?
       LIMIT 1`,
      [email],
    );

    const user = rows[0];

    if (!user || !user.ativo) {
      return res.status(403).json({
        erro: "Conta não habilitada. Procure a coordenação para realizar seu cadastro institucional.",
      });
    }

    if (!["aluno", "professor", "adm"].includes(user.tipo)) {
      return res.status(403).json({
        erro: "Perfil institucional inválido.",
      });
    }

    issueSession(res, user);

    return res.json({
      sucesso: true,
      usuario: publicUser(user),
      destino:
        user.tipo === "adm"
          ? "/adm.html"
          : user.tipo === "professor"
            ? "/professor.html"
            : "/aluno.html",
    });
  } catch (error) {
    console.error("[auth] Google sign-in failed:", error.message);

    return res.status(401).json({
      erro: "Não foi possível validar a conta institucional.",
    });
  }
});

app.get("/api/me", async (req, res) => {
  try {
    if (!JWT_SECRET) {
      return res.status(503).json({
        erro: "Autenticação não configurada.",
      });
    }

    const claims = jwt.verify(req.cookies[COOKIE_NAME] || "", JWT_SECRET, {
      issuer: "goschool-auth",
    });

    const [rows] = await pool.execute(
      `SELECT id, nome, email, tipo, ativo
       FROM usuarios
       WHERE id = ?
       LIMIT 1`,
      [claims.sub],
    );

    const user = rows[0];

    if (!user || !user.ativo) {
      return res.status(401).json({ sucesso: false });
    }

    return res.json({
      sucesso: true,
      usuario: publicUser(user),
    });
  } catch {
    return res.status(401).json({ sucesso: false });
  }
});

app.post("/api/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });

  res.json({ sucesso: true });
});

async function requireAdmin(req, res, next) {
  try {
    if (!JWT_SECRET) {
      return res.status(503).json({
        erro: "Autenticação não configurada.",
      });
    }

    const claims = jwt.verify(req.cookies[COOKIE_NAME] || "", JWT_SECRET, {
      issuer: "goschool-auth",
    });

    const [rows] = await pool.execute(
      `SELECT id, tipo, ativo
       FROM usuarios
       WHERE id = ?
       LIMIT 1`,
      [claims.sub],
    );

    const user = rows[0];

    if (!user || !user.ativo) {
      return res.status(401).json({
        erro: "Sessão inválida ou conta inativa.",
      });
    }

    if (user.tipo !== "adm") {
      return res.status(403).json({
        erro: "Apenas a Coordenação pode cadastrar usuários.",
      });
    }

    req.auth = claims;
    return next();
  } catch {
    return res.status(401).json({
      erro: "Faça login com uma conta administrativa.",
    });
  }
}

app.get("/api/admin/usuarios", requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT
         id,
         nome,
         email,
         tipo AS role,
         ativo,
         NULL AS ultimo_acesso
       FROM usuarios
       ORDER BY nome ASC`,
    );

    return res.json({
      sucesso: true,
      usuarios: rows.map((usuario) => ({
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        role: usuario.role,
        ativo: Boolean(usuario.ativo),
        ultimo_acesso: usuario.ultimo_acesso,
      })),
    });
  } catch (error) {
    console.error("[auth] Failed to list users:", error.message);

    return res.status(500).json({
      sucesso: false,
      erro: "Não foi possível consultar os usuários.",
    });
  }
});

app.get("/api/admin/usuarios/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({
      sucesso: false,
      erro: "Identificador de usuário inválido.",
    });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT id, nome, email, tipo, ativo
       FROM usuarios
       WHERE id = ?
       LIMIT 1`,
      [id],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        sucesso: false,
        erro: "Usuário não encontrado.",
      });
    }

    const usuario = rows[0];

    return res.json({
      sucesso: true,
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        tipo: usuario.tipo,
        ativo: Boolean(usuario.ativo),
      },
    });
  } catch (error) {
    console.error("[auth] Failed to get user:", error.message);

    return res.status(500).json({
      sucesso: false,
      erro: "Não foi possível consultar o usuário.",
    });
  }
});

app.patch("/api/admin/usuarios/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const nome = String(req.body?.nome || "").trim();
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();
  const tipo = String(req.body?.tipo || "").trim();
  const ativo = req.body?.ativo;

  if (!Number.isSafeInteger(id) || id <= 0) {
    return res.status(400).json({
      sucesso: false,
      erro: "Identificador de usuário inválido.",
    });
  }

  if (nome.length < 2 || nome.length > 160) {
    return res.status(400).json({
      sucesso: false,
      erro: "Informe um nome entre 2 e 160 caracteres.",
    });
  }

  if (
    email.length > 254 ||
    !/^[^\s@]+@(?:aluno|educacao)\.mg\.gov\.br$/i.test(email)
  ) {
    return res.status(400).json({
      sucesso: false,
      erro: "Use um e-mail institucional @aluno.mg.gov.br ou @educacao.mg.gov.br.",
    });
  }

  if (!["aluno", "professor", "adm"].includes(tipo)) {
    return res.status(400).json({
      sucesso: false,
      erro: "Selecione um perfil válido.",
    });
  }

  if (typeof ativo !== "boolean") {
    return res.status(400).json({
      sucesso: false,
      erro: "Informe se a conta está ativa.",
    });
  }

  try {
    const [result] = await pool.execute(
      `UPDATE usuarios
       SET nome = ?, email = ?, tipo = ?, ativo = ?
       WHERE id = ?`,
      [nome, email, tipo, ativo, id],
    );

    if (result.affectedRows === 0) {
      const [rows] = await pool.execute(
        "SELECT id FROM usuarios WHERE id = ? LIMIT 1",
        [id],
      );

      if (rows.length === 0) {
        return res.status(404).json({
          sucesso: false,
          erro: "Usuário não encontrado.",
        });
      }
    }

    return res.json({
      sucesso: true,
      mensagem: "Usuário atualizado com sucesso.",
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        sucesso: false,
        erro: "Já existe um usuário cadastrado com esse e-mail.",
      });
    }

    console.error("[auth] Failed to update user:", error.message);

    return res.status(500).json({
      sucesso: false,
      erro: "Não foi possível atualizar o usuário.",
    });
  }
});

app.post("/api/admin/usuarios", requireAdmin, async (req, res) => {
  const nome = String(req.body?.nome || "").trim();
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();
  const tipo = String(req.body?.tipo || "").trim();

  const guardianName = String(req.body?.responsavelNome || "").trim();
  const guardianRelation = String(req.body?.responsavelVinculo || "").trim();
  const consent = req.body?.consentimento === true;

  if (nome.length < 2 || nome.length > 160) {
    return res.status(400).json({
      erro: "Informe um nome entre 2 e 160 caracteres.",
    });
  }

  if (
    email.length > 254 ||
    !/^[^\s@]+@(?:aluno|educacao)\.mg\.gov\.br$/i.test(email)
  ) {
    return res.status(400).json({
      erro: "Use um e-mail institucional @aluno.mg.gov.br ou @educacao.mg.gov.br.",
    });
  }

  if (!["aluno", "professor", "adm"].includes(tipo)) {
    return res.status(400).json({
      erro: "Selecione um perfil válido.",
    });
  }

  if (
    tipo === "aluno" &&
    (!consent || guardianName.length < 2 || guardianRelation.length < 2)
  ) {
    return res.status(400).json({
      erro: "Para cadastrar aluno, registre o consentimento e os dados do responsável legal.",
    });
  }

  const consentText =
    tipo === "aluno"
      ? JSON.stringify({
          alunoEmail: email,
          guardianName,
          guardianRelation,
          consent: true,
          recordedAt: new Date().toISOString(),
        })
      : null;

  const consentHash = consentText
    ? require("crypto").createHash("sha256").update(consentText).digest("hex")
    : null;

  try {
    await pool.execute(
      `INSERT INTO usuarios
        (
          nome,
          email,
          tipo,
          ativo,
          consentimento_responsavel,
          consentimento_em,
          responsavel_nome,
          responsavel_vinculo,
          consentimento_hash
        )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nome,
        email,
        tipo,
        true,
        tipo === "aluno" ? true : null,
        tipo === "aluno" ? new Date() : null,
        tipo === "aluno" ? guardianName : null,
        tipo === "aluno" ? guardianRelation : null,
        consentHash,
      ],
    );

    return res.status(201).json({
      sucesso: true,
      mensagem:
        "Cadastro institucional criado. O usuário já pode entrar com o Google institucional.",
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        erro: "Já existe um cadastro com esse e-mail.",
      });
    }

    console.error("[auth] Institutional enrollment failed:", error.message);

    return res.status(500).json({
      erro: "Não foi possível concluir o cadastro. Verifique a configuração do banco.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Auth Service listening on :${PORT}`);
  console.log(`GOOGLE_CLIENT_ID carregado: ${Boolean(CLIENT_ID)}`);
});
