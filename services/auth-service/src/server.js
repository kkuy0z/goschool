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
const multer = require("multer");
const XLSX = require("xlsx");
const amqp = require("amqplib");
const { OAuth2Client } = require("google-auth-library");

const app = express();
const PORT = Number(process.env.PORT || process.env.AUTH_PORT || 4001);

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
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

const allowedDomains = new Set([
  "aluno.mg.gov.br",
  "educacao.mg.gov.br",
]);

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
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET não está configurado.");
  }

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
  let etapa = "validacao-inicial";

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

    etapa = "validacao-google";

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

    etapa = "consulta-usuario";

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
        erro:
          "Conta não habilitada. Procure a coordenação para realizar seu cadastro institucional.",
      });
    }

    if (!["aluno", "professor", "adm"].includes(user.tipo)) {
      return res.status(403).json({
        erro: "Perfil institucional inválido.",
      });
    }

    etapa = "criacao-sessao";
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
    console.error("[auth] Google sign-in failed:", {
      etapa,
      name: error.name,
      code: error.code,
      message: error.message,
    });

    // Erros na validação do token Google são 401.
    // Erros de banco, sessão ou configuração são falhas internas (500).
    const status = etapa === "validacao-google" ? 401 : 500;

    return res.status(status).json({
      erro:
        status === 401
          ? "Não foi possível validar a credencial Google."
          : "Falha interna no serviço de autenticação.",
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

    const claims = jwt.verify(
      req.cookies[COOKIE_NAME] || "",
      JWT_SECRET,
      {
        issuer: "goschool-auth",
      },
    );

    const [rows] = await pool.execute(
      `SELECT id, nome, email, tipo, ativo
       FROM usuarios
       WHERE id = ?
       LIMIT 1`,
      [claims.sub],
    );

    const user = rows[0];

    if (!user || !user.ativo) {
      return res.status(401).json({
        sucesso: false,
      });
    }

    return res.json({
      sucesso: true,
      usuario: publicUser(user),
    });
  } catch {
    return res.status(401).json({
      sucesso: false,
    });
  }
});

app.post("/api/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });

  res.json({
    sucesso: true,
  });
});

async function requireAdmin(req, res, next) {
  try {
    if (!JWT_SECRET) {
      return res.status(503).json({
        erro: "Autenticação não configurada.",
      });
    }

    const claims = jwt.verify(
      req.cookies[COOKIE_NAME] || "",
      JWT_SECRET,
      {
        issuer: "goschool-auth",
      },
    );

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
      erro:
        "Use um e-mail institucional @aluno.mg.gov.br ou @educacao.mg.gov.br.",
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
      erro:
        "Use um e-mail institucional @aluno.mg.gov.br ou @educacao.mg.gov.br.",
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
      erro:
        "Para cadastrar aluno, registre o consentimento e os dados do responsável legal.",
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
    ? require("crypto")
        .createHash("sha256")
        .update(consentText)
        .digest("hex")
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
      erro:
        "Não foi possível concluir o cadastro. Verifique a configuração do banco.",
    });
  }
});


const DIAS_CARDAPIO = ["segunda","terca","quarta","quinta","sexta","sabado","domingo"];
const CATEGORIAS_CARDAPIO = ["cafe_manha","almoco","lanche"];
const ALERGENICOS_CARDAPIO = ["Glúten","Leite","Ovos","Peixe","Crustáceos","Moluscos","Amendoim","Soja","Castanhas","Aipo","Mostarda","Gergelim","Sulfitos","Lupino"];

function diaAtualCardapio() {
  const dia = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "America/Sao_Paulo" }).format(new Date()).toLowerCase();
  return ({monday:"segunda",tuesday:"terca",wednesday:"quarta",thursday:"quinta",friday:"sexta",saturday:"sabado",sunday:"domingo"})[dia];
}
function normalizarRefeicao(row) {
  let alergicos = row.alergicos;
  if (typeof alergicos === "string") { try { alergicos = JSON.parse(alergicos); } catch { alergicos = []; } }
  return {...row, alertaAlergia: Boolean(row.alertaAlergia), calorias: row.calorias === null ? null : Number(row.calorias), proteina: row.proteina === null ? null : Number(row.proteina), carboidrato: row.carboidrato === null ? null : Number(row.carboidrato), alergicos: Array.isArray(alergicos) ? alergicos : [], horario: row.horario ? String(row.horario).slice(0,5) : null};
}
async function autenticarCardapio(req, res, next) {
  try {
    if (!JWT_SECRET) return res.status(503).json({erro:"Autenticação não configurada."});
    const claims = jwt.verify(req.cookies[COOKIE_NAME] || "", JWT_SECRET, {issuer:"goschool-auth"});
    const [rows] = await pool.execute("SELECT id, tipo, ativo FROM usuarios WHERE id = ? LIMIT 1", [claims.sub]);
    const user = rows[0];
    if (!user || !user.ativo) return res.status(401).json({erro:"Sessão inválida ou conta inativa."});
    req.cardapioUser = user;
    return next();
  } catch { return res.status(401).json({erro:"Faça login para acessar o cardápio."}); }
}
function exigirAdminCardapio(req,res,next) {
  if (req.cardapioUser?.tipo !== "adm") return res.status(403).json({erro:"Apenas administradores podem alterar o cardápio."});
  return next();
}
function validarDadosRefeicao(body) {
  const nome = String(body?.nome || "").trim();
  const categoria = String(body?.categoria || "").trim();
  if (nome.length < 2 || nome.length > 180) return "Informe um nome entre 2 e 180 caracteres.";
  if (!CATEGORIAS_CARDAPIO.includes(categoria)) return "Categoria inválida.";
  if (body.dia_semana && !DIAS_CARDAPIO.includes(body.dia_semana)) return "Dia da semana inválido.";
  for (const campo of ["calorias","proteina","carboidrato"]) {
    if (body[campo] !== null && body[campo] !== undefined && body[campo] !== "" && (!Number.isFinite(Number(body[campo])) || Number(body[campo]) < 0)) return "Os valores nutricionais devem ser números positivos.";
  }
  if (body.imagem && String(body.imagem).length > 1500000) return "A imagem excede o limite permitido.";
  if (body.imagem && !/^https?:\/\//i.test(String(body.imagem)) && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/i.test(String(body.imagem))) return "Informe uma URL HTTP/HTTPS ou selecione uma imagem JPG, PNG ou WebP.";
  if (body.alergicos !== undefined && (!Array.isArray(body.alergicos) || body.alergicos.some(x => typeof x !== "string" || x.length > 80))) return "Lista de alergênicos inválida.";
  return null;
}
function valoresRefeicao(body, userId) {
  return [String(body.nome).trim(), String(body.descricao || "").trim() || null, body.categoria, body.dia_semana || null, body.horario || null, body.calorias === "" || body.calorias == null ? null : Number(body.calorias), body.proteina === "" || body.proteina == null ? null : Number(body.proteina), body.carboidrato === "" || body.carboidrato == null ? null : Number(body.carboidrato), body.imagem || null, JSON.stringify(body.alergicos || []), String(body.observacoes || "").trim() || null, userId];
}
app.use("/api/cardapio", autenticarCardapio);
app.get("/api/cardapio/categorias", (_req,res) => res.json({sucesso:true,alergicos:ALERGENICOS_CARDAPIO}));
app.get("/api/cardapio/hoje", async (_req,res) => {
  try {
    const [rows] = await pool.execute("SELECT f.*, EXISTS(SELECT 1 FROM refeicao_ingredientes ri JOIN ingrediente_restricoes ir ON ir.ingrediente_id=ri.ingrediente_id JOIN usuario_restricoes ur ON ur.restricao_id=ir.restricao_id WHERE ri.refeicao_id=f.id AND ur.usuario_id=?) AS alertaAlergia FROM refeicoes f WHERE f.dia_semana = ? ORDER BY f.horario, f.id", [req.cardapioUser.id,diaAtualCardapio()]);
    res.json({sucesso:true,cardapio:rows.map(normalizarRefeicao)});
  } catch (e) { console.error("[cardapio] hoje:",e.message); res.status(500).json({sucesso:false,erro:"Não foi possível carregar o cardápio de hoje."}); }
});
app.get("/api/cardapio/semana", async (_req,res) => {
  try {
    const [rows] = await pool.execute("SELECT f.*, EXISTS(SELECT 1 FROM refeicao_ingredientes ri JOIN ingrediente_restricoes ir ON ir.ingrediente_id=ri.ingrediente_id JOIN usuario_restricoes ur ON ur.restricao_id=ir.restricao_id WHERE ri.refeicao_id=f.id AND ur.usuario_id=?) AS alertaAlergia FROM refeicoes f ORDER BY FIELD(f.dia_semana,'segunda','terca','quarta','quinta','sexta','sabado','domingo'), f.horario, f.id", [req.cardapioUser.id]);
    const cardapio = Object.fromEntries(DIAS_CARDAPIO.map(dia=>[dia,[]]));
    rows.map(normalizarRefeicao).forEach(item=>{if(item.dia_semana) cardapio[item.dia_semana].push(item);});
    res.json({sucesso:true,cardapio});
  } catch (e) { console.error("[cardapio] semana:",e.message); res.status(500).json({sucesso:false,erro:"Não foi possível carregar o cardápio semanal."}); }
});
app.get("/api/cardapio/:id([0-9]+)", async (req,res) => {
  const id=Number(req.params.id);
  if (!Number.isSafeInteger(id)||id<=0) return res.status(400).json({sucesso:false,erro:"ID inválido."});
  try {
    const [rows]=await pool.execute("SELECT f.*, EXISTS(SELECT 1 FROM refeicao_ingredientes ri JOIN ingrediente_restricoes ir ON ir.ingrediente_id=ri.ingrediente_id JOIN usuario_restricoes ur ON ur.restricao_id=ir.restricao_id WHERE ri.refeicao_id=f.id AND ur.usuario_id=?) AS alertaAlergia FROM refeicoes f WHERE f.id=? LIMIT 1",[req.cardapioUser.id,id]);
    if(!rows.length) return res.status(404).json({sucesso:false,erro:"Refeição não encontrada."});
    res.json({sucesso:true,cardapio:normalizarRefeicao(rows[0])});
  } catch(e) { console.error("[cardapio] detalhe:",e.message); res.status(500).json({sucesso:false,erro:"Não foi possível consultar a refeição."}); }
});
app.post("/api/cardapio", exigirAdminCardapio, async (req,res) => {
  const erro=validarDadosRefeicao(req.body); if(erro) return res.status(400).json({sucesso:false,erro});
  try {
    const values=valoresRefeicao(req.body,req.cardapioUser.id);
    const [result]=await pool.execute("INSERT INTO refeicoes (nome,descricao,categoria,dia_semana,horario,calorias,proteina,carboidrato,imagem,alergicos,observacoes,criado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",values);
    res.status(201).json({sucesso:true,id:result.insertId,mensagem:"Refeição cadastrada."});
  } catch(e) { console.error("[cardapio] criar:",e.message); res.status(500).json({sucesso:false,erro:"Não foi possível cadastrar a refeição."}); }
});
app.put("/api/cardapio/:id", exigirAdminCardapio, async (req,res) => {
  const id=Number(req.params.id); if(!Number.isSafeInteger(id)||id<=0) return res.status(400).json({sucesso:false,erro:"ID inválido."});
  const erro=validarDadosRefeicao(req.body); if(erro) return res.status(400).json({sucesso:false,erro});
  try {
    const values=valoresRefeicao(req.body,req.cardapioUser.id);
    const [result]=await pool.execute("UPDATE refeicoes SET nome=?,descricao=?,categoria=?,dia_semana=?,horario=?,calorias=?,proteina=?,carboidrato=?,imagem=?,alergicos=?,observacoes=? WHERE id=?",[...values.slice(0,11),id]);
    if(!result.affectedRows) { const [rows]=await pool.execute("SELECT id FROM refeicoes WHERE id=?",[id]); if(!rows.length) return res.status(404).json({sucesso:false,erro:"Refeição não encontrada."}); }
    res.json({sucesso:true,mensagem:"Refeição atualizada."});
  } catch(e) { console.error("[cardapio] atualizar:",e.message); res.status(500).json({sucesso:false,erro:"Não foi possível atualizar a refeição."}); }
});
app.delete("/api/cardapio/:id", exigirAdminCardapio, async (req,res) => {
  const id=Number(req.params.id); if(!Number.isSafeInteger(id)||id<=0) return res.status(400).json({sucesso:false,erro:"ID inválido."});
  try { const [result]=await pool.execute("DELETE FROM refeicoes WHERE id=?",[id]); if(!result.affectedRows) return res.status(404).json({sucesso:false,erro:"Refeição não encontrada."}); res.json({sucesso:true,mensagem:"Refeição excluída."}); }
  catch(e) { console.error("[cardapio] excluir:",e.message); res.status(500).json({sucesso:false,erro:"Não foi possível excluir a refeição."}); }
});



/* Cardápio administrativo: ingredientes, restrições e rastreio de importações. */
app.get("/api/cardapio/admin/ingredientes", exigirAdminCardapio, async (_req,res) => {
  try {
    const [rows] = await pool.execute("SELECT id,nome,ativo FROM ingredientes ORDER BY nome");
    res.json({sucesso:true,ingredientes:rows});
  } catch(e) { console.error("[cardapio] ingredientes:",e.message); res.status(500).json({sucesso:false,erro:"Execute a migration-cardapio-admin.sql antes de usar ingredientes."}); }
});
app.post("/api/cardapio/admin/ingredientes", exigirAdminCardapio, async (req,res) => {
  const nome=String(req.body?.nome||"").trim();
  if(nome.length<2||nome.length>120) return res.status(400).json({sucesso:false,erro:"Informe um ingrediente entre 2 e 120 caracteres."});
  try {
    const [r]=await pool.execute("INSERT INTO ingredientes(nome) VALUES(?)",[nome]);
    res.status(201).json({sucesso:true,id:r.insertId});
  } catch(e) { res.status(e.code==="ER_DUP_ENTRY"?409:500).json({sucesso:false,erro:e.code==="ER_DUP_ENTRY"?"Ingrediente já cadastrado.":"Não foi possível cadastrar o ingrediente."}); }
});
app.get("/api/cardapio/restricoes", async (_req,res) => {
  try {
    const [rows]=await pool.execute("SELECT id,nome,descricao FROM restricoes_alimentares WHERE ativo=1 ORDER BY nome");
    res.json({sucesso:true,restricoes:rows});
  } catch(e) { res.status(500).json({sucesso:false,erro:"Não foi possível carregar as restrições alimentares."}); }
});
app.get("/api/cardapio/admin/restricoes", exigirAdminCardapio, async (_req,res) => {
  try {
    const [rows]=await pool.execute("SELECT id,nome,descricao,ativo FROM restricoes_alimentares ORDER BY nome");
    res.json({sucesso:true,restricoes:rows});
  } catch(e) { console.error("[cardapio] restrições:",e.message); res.status(500).json({sucesso:false,erro:"Execute a migration-cardapio-admin.sql antes de usar restrições."}); }
});
app.post("/api/cardapio/admin/restricoes", exigirAdminCardapio, async (req,res) => {
  const nome=String(req.body?.nome||"").trim(), descricao=String(req.body?.descricao||"").trim();
  if(nome.length<2||nome.length>120) return res.status(400).json({sucesso:false,erro:"Informe uma restrição entre 2 e 120 caracteres."});
  try {
    const [r]=await pool.execute("INSERT INTO restricoes_alimentares(nome,descricao) VALUES(?,?)",[nome,descricao||null]);
    res.status(201).json({sucesso:true,id:r.insertId});
  } catch(e) { res.status(e.code==="ER_DUP_ENTRY"?409:500).json({sucesso:false,erro:e.code==="ER_DUP_ENTRY"?"Restrição já cadastrada.":"Não foi possível cadastrar a restrição."}); }
});
app.put("/api/cardapio/admin/ingredientes/:id/restricoes", exigirAdminCardapio, async (req,res) => {
  const id=Number(req.params.id), restricoes=Array.isArray(req.body?.restricaoIds)?req.body.restricaoIds.map(Number):null;
  if(!Number.isSafeInteger(id)||id<1||!restricoes||restricoes.some(x=>!Number.isSafeInteger(x)||x<1)) return res.status(400).json({sucesso:false,erro:"Informe ingredientes e restrições válidos."});
  const conn=await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [ingredient]=await conn.execute("SELECT id FROM ingredientes WHERE id=? FOR UPDATE",[id]);
    if(!ingredient.length) { await conn.rollback(); return res.status(404).json({sucesso:false,erro:"Ingrediente não encontrado."}); }
    await conn.execute("DELETE FROM ingrediente_restricoes WHERE ingrediente_id=?",[id]);
    for(const rid of [...new Set(restricoes)]) await conn.execute("INSERT INTO ingrediente_restricoes(ingrediente_id,restricao_id) VALUES(?,?)",[id,rid]);
    await conn.commit(); res.json({sucesso:true});
  } catch(e) { await conn.rollback(); res.status(500).json({sucesso:false,erro:"Não foi possível atualizar os vínculos."}); }
  finally { conn.release(); }
});
app.put("/api/cardapio/admin/refeicoes/:id/ingredientes", exigirAdminCardapio, async (req,res) => {
  const id=Number(req.params.id), ingredientes=Array.isArray(req.body?.ingredienteIds)?req.body.ingredienteIds.map(Number):null;
  if(!Number.isSafeInteger(id)||id<1||!ingredientes||ingredientes.some(x=>!Number.isSafeInteger(x)||x<1)) return res.status(400).json({sucesso:false,erro:"Informe uma refeição e ingredientes válidos."});
  const conn=await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [meal]=await conn.execute("SELECT id FROM refeicoes WHERE id=? FOR UPDATE",[id]);
    if(!meal.length) { await conn.rollback(); return res.status(404).json({sucesso:false,erro:"Refeição não encontrada."}); }
    await conn.execute("DELETE FROM refeicao_ingredientes WHERE refeicao_id=?",[id]);
    for(const iid of [...new Set(ingredientes)]) await conn.execute("INSERT INTO refeicao_ingredientes(refeicao_id,ingrediente_id) VALUES(?,?)",[id,iid]);
    await conn.commit(); res.json({sucesso:true});
  } catch(e) { await conn.rollback(); res.status(500).json({sucesso:false,erro:"Não foi possível atualizar os ingredientes da refeição."}); }
  finally { conn.release(); }
});

const cardapioUpload = multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1},fileFilter:(_req,file,cb)=>cb(null,/\\.xlsx$/i.test(file.originalname))});
const CARDAPIO_IMPORT_QUEUE = "goschool.cardapio.import";
app.post("/api/cardapio/admin/importar-excel", exigirAdminCardapio, cardapioUpload.single("arquivo"), async (req,res) => {
  if(!req.file) return res.status(400).json({sucesso:false,erro:"Envie uma planilha .xlsx de até 5 MB."});
  if(!process.env.RABBITMQ_URL) return res.status(503).json({sucesso:false,erro:"Importação assíncrona indisponível: configure RABBITMQ_URL no serviço."});
  let connection;
  try {
    const workbook=XLSX.read(req.file.buffer,{type:"buffer",cellDates:false});
    const first=workbook.SheetNames[0];
    if(!first) return res.status(400).json({sucesso:false,erro:"A planilha não contém uma aba."});
    const rows=XLSX.utils.sheet_to_json(workbook.Sheets[first],{defval:"",raw:false});
    if(!rows.length) return res.status(400).json({sucesso:false,erro:"A planilha está vazia."});
    const required=["nome","categoria","dia_semana"];
    const headers=Object.keys(rows[0]).map(x=>String(x).trim().toLowerCase());
    const missing=required.filter(x=>!headers.includes(x));
    if(missing.length) return res.status(400).json({sucesso:false,erro:"Colunas obrigatórias ausentes: "+missing.join(", ")});
    const normalized=rows.map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[String(k).trim().toLowerCase(),v])));
    const validation=[];
    normalized.forEach((row,index)=>{
      const n=String(row.nome||"").trim(), cat=String(row.categoria||"").trim(), day=String(row.dia_semana||"").trim().toLowerCase();
      if(n.length<2||n.length>180) validation.push({linha:index+2,erro:"Nome inválido."});
      if(!CATEGORIAS_CARDAPIO.includes(cat)) validation.push({linha:index+2,erro:"Categoria inválida."});
      if(!DIAS_CARDAPIO.includes(day)) validation.push({linha:index+2,erro:"Dia da semana inválido."});
    });
    if(validation.length) return res.status(422).json({sucesso:false,erro:"A planilha contém dados inválidos.",erros:validation.slice(0,100)});
    connection=await amqp.connect(process.env.RABBITMQ_URL);
    const channel=await connection.createConfirmChannel();
    await channel.assertQueue(CARDAPIO_IMPORT_QUEUE,{durable:true});
    const [created]=await pool.execute("INSERT INTO cardapio_importacoes(arquivo_nome,status,total_linhas,criado_por) VALUES(?,'recebida',?,?)",[req.file.originalname,normalized.length,req.cardapioUser.id]);
    channel.sendToQueue(CARDAPIO_IMPORT_QUEUE,Buffer.from(JSON.stringify({importacaoId:created.insertId,usuarioId:req.cardapioUser.id,rows:normalized})),{persistent:true,contentType:"application/json"});
    await channel.waitForConfirms();
    await channel.close(); await connection.close();
    return res.status(202).json({sucesso:true,importacaoId:created.insertId,status:"recebida",totalLinhas:normalized.length});
  } catch(e) {
    if(connection) try{await connection.close();}catch{}
    console.error("[cardapio] upload excel:",e.message);
    return res.status(500).json({sucesso:false,erro:"Não foi possível enfileirar a importação. Verifique o serviço RabbitMQ."});
  }
});

app.get("/api/cardapio/admin/importacoes", exigirAdminCardapio, async (_req,res) => {
  try {
    const [rows]=await pool.execute("SELECT id,arquivo_nome,status,total_linhas,linhas_importadas,erros,criado_em,concluido_em FROM cardapio_importacoes ORDER BY criado_em DESC LIMIT 50");
    res.json({sucesso:true,importacoes:rows});
  } catch(e) { console.error("[cardapio] importações:",e.message); res.status(500).json({sucesso:false,erro:"Execute a migration-cardapio-admin.sql antes de consultar importações."}); }
});

app.put("/api/cardapio/minhas-restricoes", async (req,res) => {
  const ids=Array.isArray(req.body?.restricaoIds)?req.body.restricaoIds.map(Number):null;
  if(!ids||ids.some(id=>!Number.isSafeInteger(id)||id<1)) return res.status(400).json({sucesso:false,erro:"Lista de restrições inválida."});
  const conn=await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute("DELETE FROM usuario_restricoes WHERE usuario_id=?",[req.cardapioUser.id]);
    for(const id of [...new Set(ids)]) await conn.execute("INSERT INTO usuario_restricoes(usuario_id,restricao_id) SELECT ?,id FROM restricoes_alimentares WHERE id=? AND ativo=1",[req.cardapioUser.id,id]);
    await conn.commit(); res.json({sucesso:true});
  } catch(e) { await conn.rollback(); res.status(500).json({sucesso:false,erro:"Não foi possível salvar suas restrições."}); }
  finally { conn.release(); }
});
app.get("/api/cardapio/minhas-restricoes", async (req,res) => {
  try {
    const [rows]=await pool.execute("SELECT r.id,r.nome,r.descricao FROM usuario_restricoes ur JOIN restricoes_alimentares r ON r.id=ur.restricao_id WHERE ur.usuario_id=? AND r.ativo=1 ORDER BY r.nome",[req.cardapioUser.id]);
    res.json({sucesso:true,restricoes:rows});
  } catch(e) { res.status(500).json({sucesso:false,erro:"Não foi possível consultar suas restrições."}); }
});

app.listen(PORT, () => {
  console.log(`Auth Service listening on :${PORT}`);
  console.log(`GOOGLE_CLIENT_ID carregado: ${Boolean(CLIENT_ID)}`);
  console.log(`JWT_SECRET carregado: ${Boolean(JWT_SECRET)}`);
});