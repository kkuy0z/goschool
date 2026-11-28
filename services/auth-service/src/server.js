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
const ALERGENICOS_CARDAPIO = ["Glúten","Leite","Ovos","Peixe","Crustáceos","Moluscos","Amendoim","Soja","Castanhas","Aipo","Mostarda","Gergelim","Sulfitos","Lupino","Abóbora"];

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
app.get("/api/cardapio/categorias", async (_req,res) => {
  try {
    const [rows] = await pool.execute("SELECT nome FROM restricoes_alimentares WHERE ativo=1 ORDER BY nome");
    const alergicos = [...new Map([...ALERGENICOS_CARDAPIO, ...rows.map(row=>String(row.nome).trim())].filter(Boolean).map(nome=>[nome.normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase(),nome])).values()];
    res.json({sucesso:true,alergicos});
  } catch(e) {
    console.error("[cardapio] alergênicos:",e.message);
    res.json({sucesso:true,alergicos:ALERGENICOS_CARDAPIO});
  }
});
app.post("/api/cardapio/admin/alergenicos", exigirAdminCardapio, async (req,res) => {
  const nome=String(req.body?.nome||"").trim().replace(/\\s+/g," ");
  if(nome.length<2||nome.length>120) return res.status(400).json({sucesso:false,erro:"Informe um alergênico entre 2 e 120 caracteres."});
  try {
    const [existing] = await pool.execute("SELECT id FROM restricoes_alimentares WHERE LOWER(nome)=LOWER(?) LIMIT 1",[nome]);
    if(existing.length) return res.status(409).json({sucesso:false,erro:"Esse alergênico já está cadastrado."});
    const [result] = await pool.execute("INSERT INTO restricoes_alimentares(nome,descricao) VALUES(?,?)",[nome,"Alergênico do cardápio"]);
    res.status(201).json({sucesso:true,id:result.insertId,nome});
  } catch(e) {
    console.error("[cardapio] cadastrar alergênico:",e.message);
    res.status(e.code==="ER_DUP_ENTRY"?409:500).json({sucesso:false,erro:e.code==="ER_DUP_ENTRY"?"Esse alergênico já está cadastrado.":"Não foi possível cadastrar o alergênico."});
  }
});
app.get("/api/cardapio/hoje", async (req,res) => {
  try {
    const [rows] = await pool.execute("SELECT f.*, EXISTS(SELECT 1 FROM refeicao_ingredientes ri JOIN ingrediente_restricoes ir ON ir.ingrediente_id=ri.ingrediente_id JOIN usuario_restricoes ur ON ur.restricao_id=ir.restricao_id WHERE ri.refeicao_id=f.id AND ur.usuario_id=?) AS alertaAlergia FROM refeicoes f WHERE f.dia_semana = ? ORDER BY f.horario, f.id", [req.cardapioUser.id,diaAtualCardapio()]);
    res.json({sucesso:true,cardapio:rows.map(normalizarRefeicao)});
  } catch (e) {
    console.error("[cardapio] hoje:", {
      message: e.message, code: e.code, errno: e.errno,
      sqlMessage: e.sqlMessage, sqlState: e.sqlState, stack: e.stack
    });
    res.status(500).json({sucesso:false,erro:"Não foi possível carregar o cardápio de hoje."});
  }
});
app.get("/api/cardapio/semana", async (req,res) => {
  try {
    const [rows] = await pool.execute("SELECT f.*, EXISTS(SELECT 1 FROM refeicao_ingredientes ri JOIN ingrediente_restricoes ir ON ir.ingrediente_id=ri.ingrediente_id JOIN usuario_restricoes ur ON ur.restricao_id=ir.restricao_id WHERE ri.refeicao_id=f.id AND ur.usuario_id=?) AS alertaAlergia FROM refeicoes f ORDER BY FIELD(f.dia_semana,'segunda','terca','quarta','quinta','sexta','sabado','domingo'), f.horario, f.id", [req.cardapioUser.id]);
    const cardapio = Object.fromEntries(DIAS_CARDAPIO.map(dia=>[dia,[]]));
    rows.map(normalizarRefeicao).forEach(item=>{if(item.dia_semana) cardapio[item.dia_semana].push(item);});
    res.json({sucesso:true,cardapio});
  } catch (e) {
    console.error("[cardapio] semana:", {
      message: e.message, code: e.code, errno: e.errno,
      sqlMessage: e.sqlMessage, sqlState: e.sqlState, stack: e.stack
    });
    res.status(500).json({sucesso:false,erro:"Não foi possível carregar o cardápio semanal."});
  }
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


/* Reservas de ambientes e recursos escolares. */
async function requireReservaUser(req, res, next) {
  try {
    if (!JWT_SECRET) return res.status(503).json({ sucesso: false, erro: "Autenticação não configurada." });
    const claims = jwt.verify(req.cookies[COOKIE_NAME] || "", JWT_SECRET, { issuer: "goschool-auth" });
    const [rows] = await pool.execute("SELECT id,nome,tipo,ativo FROM usuarios WHERE id=? LIMIT 1", [claims.sub]);
    const user = rows[0];
    if (!user || !user.ativo) return res.status(401).json({ sucesso: false, erro: "Sessão inválida." });
    if (!["professor", "adm"].includes(user.tipo)) return res.status(403).json({ sucesso: false, erro: "Reservas disponíveis apenas para professores e administração." });
    req.reservaUser = user;
    next();
  } catch {
    return res.status(401).json({ sucesso: false, erro: "Faça login para acessar as reservas." });
  }
}

app.get("/api/reservas/recursos", requireReservaUser, async (_req, res) => {
  try {
    const [recursos] = await pool.execute("SELECT id,nome,descricao,localizacao,capacidade FROM recursos_reserva WHERE ativo=1 AND nome IN ('Retroprojetor','Multimídia','Informática') ORDER BY FIELD(nome,'Retroprojetor','Multimídia','Informática')");
    res.json({ sucesso: true, recursos });
  } catch (e) {
    console.error("[reservas] listar recursos:", e.message);
    res.status(500).json({ sucesso: false, erro: "Não foi possível carregar os ambientes." });
  }
});

app.get("/api/reservas", requireReservaUser, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT r.id,r.recurso_id,r.usuario_id,r.titulo,r.finalidade,DATE_FORMAT(r.data_inicio, '%Y-%m-%d %H:%i:%s') AS data_inicio,DATE_FORMAT(r.data_fim, '%Y-%m-%d %H:%i:%s') AS data_fim,r.status,r.observacao_admin,r.criado_em,
              rr.nome AS recurso_nome,rr.localizacao, u.nome AS usuario_nome
       FROM reservas r JOIN recursos_reserva rr ON rr.id=r.recurso_id JOIN usuarios u ON u.id=r.usuario_id
       WHERE r.data_inicio >= CURDATE() ORDER BY r.data_inicio ASC LIMIT 500`,
      [],
    );
    res.json({ sucesso: true, reservas: rows });
  } catch (e) {
    console.error("[reservas] listar:", e.message);
    res.status(500).json({ sucesso: false, erro: "Não foi possível carregar as reservas." });
  }
});

app.post("/api/reservas", requireReservaUser, async (req, res) => {
  const recursoId = Number(req.body?.recurso_id);
  const titulo = String(req.body?.titulo || "").trim();
  const finalidade = String(req.body?.finalidade || "").trim();
  const inicioRaw = String(req.body?.data_inicio || "").trim();
  const fimRaw = String(req.body?.data_fim || "").trim();
  const inicio = new Date(inicioRaw);
  const fim = new Date(fimRaw);
  if (!Number.isSafeInteger(recursoId) || recursoId < 1 || titulo.length < 3 || titulo.length > 180 ||
      !inicioRaw || !fimRaw || Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime()) || fim <= inicio) {
    return res.status(400).json({ sucesso: false, erro: "Informe ambiente, título e um período válido (término posterior ao início)." });
  }
  const periodosEscolares = [["07:00","07:50"],["07:50","08:40"],["08:40","09:30"],["09:45","10:35"],["10:35","11:25"],["13:00","13:50"],["13:50","14:40"],["14:40","15:30"],["15:45","16:35"],["16:35","17:25"]];
  const dataInicio = inicioRaw.slice(0, 10);
  const dataFim = fimRaw.slice(0, 10);
  const horaInicio = inicioRaw.slice(11, 16);
  const horaFim = fimRaw.slice(11, 16);
  const horarioEscolarValido = dataInicio === dataFim && periodosEscolares.some(([a,b]) => a === horaInicio && b === horaFim);
  if (!horarioEscolarValido) return res.status(400).json({ sucesso: false, erro: "Selecione um horário escolar válido. Intervalos e períodos fora da grade não podem ser reservados." });
  const diaReserva = new Date(`${dataInicio}T12:00:00`).getDay();
  if (diaReserva === 0 || diaReserva === 6) return res.status(400).json({ sucesso: false, erro: "Reservas só podem ser feitas de segunda a sexta-feira." });
  const hojeLocal = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (dataInicio < hojeLocal) return res.status(400).json({ sucesso: false, erro: "Não é permitido reservar datas anteriores a hoje." });
  if (inicio <= new Date()) return res.status(400).json({ sucesso: false, erro: "A reserva precisa começar no futuro." });
  if (finalidade.length > 4000) return res.status(400).json({ sucesso: false, erro: "A finalidade deve ter até 4.000 caracteres." });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [resource] = await conn.execute("SELECT id FROM recursos_reserva WHERE id=? AND ativo=1 AND nome IN ('Retroprojetor','Multimídia','Informática') FOR UPDATE", [recursoId]);
    if (!resource.length) {
      await conn.rollback();
      return res.status(404).json({ sucesso: false, erro: "Ambiente não encontrado ou inativo." });
    }
    const [conflicts] = await conn.execute(
      "SELECT id FROM reservas WHERE recurso_id=? AND status IN ('PENDENTE','CONFIRMADA') AND data_inicio < ? AND data_fim > ? LIMIT 1",
      [recursoId, fimRaw.replace('T',' '), inicioRaw.replace('T',' ')],
    );
    if (conflicts.length) {
      await conn.rollback();
      return res.status(409).json({ sucesso: false, erro: "Este ambiente já possui uma reserva nesse intervalo." });
    }
    const [result] = await conn.execute(
      "INSERT INTO reservas (recurso_id,usuario_id,titulo,finalidade,data_inicio,data_fim,status) VALUES (?,?,?,?,?,?,'CONFIRMADA')",
      [recursoId, req.reservaUser.id, titulo, finalidade || null, inicioRaw.replace('T',' '), fimRaw.replace('T',' ')],
    );
    await conn.commit();
    res.status(201).json({ sucesso: true, id: result.insertId, mensagem: "Reserva confirmada e realizada com sucesso." });
  } catch (e) {
    await conn.rollback();
    console.error("[reservas] criar:", e.message);
    res.status(500).json({ sucesso: false, erro: "Não foi possível criar a reserva." });
  } finally {
    conn.release();
  }
});


app.patch("/api/reservas/:id/status", requireReservaUser, async (req, res) => {
  if (req.reservaUser.tipo !== "adm") return res.status(403).json({ sucesso: false, erro: "Somente a administração pode decidir solicitações." });
  const id = Number(req.params.id);
  const status = String(req.body?.status || "").toUpperCase();
  const observacao = String(req.body?.observacao || "").trim();
  if (!Number.isSafeInteger(id) || id < 1 || !["CONFIRMADA", "REJEITADA"].includes(status)) {
    return res.status(400).json({ sucesso: false, erro: "Informe uma reserva e decisão válidas." });
  }
  try {
    const [result] = await pool.execute(
      "UPDATE reservas SET status=?,observacao_admin=?,decidido_por=?,decidido_em=NOW() WHERE id=? AND status='PENDENTE'",
      [status, observacao || null, req.reservaUser.id, id],
    );
    if (!result.affectedRows) return res.status(409).json({ sucesso: false, erro: "A reserva não existe ou já foi decidida." });
    res.json({ sucesso: true, mensagem: status === "CONFIRMADA" ? "Reserva confirmada." : "Solicitação rejeitada." });
  } catch (e) {
    console.error("[reservas] decidir:", e.message);
    res.status(500).json({ sucesso: false, erro: "Não foi possível atualizar a solicitação." });
  }
});

app.delete("/api/reservas/:id", requireReservaUser, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ sucesso: false, erro: "ID inválido." });
  try {
    const [result] = await pool.execute(
      "UPDATE reservas SET status='CANCELADA',cancelado_por=?,cancelado_em=NOW() WHERE id=? AND status IN ('PENDENTE','CONFIRMADA') AND (usuario_id=? OR ?='adm')",
      [req.reservaUser.id, id, req.reservaUser.id, req.reservaUser.tipo],
    );
    if (!result.affectedRows) return res.status(404).json({ sucesso: false, erro: "Reserva não encontrada ou não pode ser cancelada." });
    res.json({ sucesso: true, mensagem: "Reserva cancelada." });
  } catch (e) {
    console.error("[reservas] cancelar:", e.message);
    res.status(500).json({ sucesso: false, erro: "Não foi possível cancelar a reserva." });
  }
});

app.post("/api/reservas/recursos", requireReservaUser, async (req, res) => {
  return res.status(403).json({ sucesso: false, erro: "O catálogo é fixo: Retroprojetor, Multimídia e Informática." });
  const nome = String(req.body?.nome || "").trim();
  const localizacao = String(req.body?.localizacao || "").trim();
  const descricao = String(req.body?.descricao || "").trim();
  const capacidade = req.body?.capacidade === "" || req.body?.capacidade == null ? null : Number(req.body.capacidade);
  if (nome.length < 2 || nome.length > 160 || (capacidade !== null && (!Number.isInteger(capacidade) || capacidade < 1))) {
    return res.status(400).json({ sucesso: false, erro: "Informe um nome válido e capacidade inteira positiva." });
  }
  try {
    const [result] = await pool.execute(
      "INSERT INTO recursos_reserva (nome,descricao,localizacao,capacidade,criado_por) VALUES (?,?,?,?,?)",
      [nome, descricao || null, localizacao || null, capacidade, req.reservaUser.id],
    );
    res.status(201).json({ sucesso: true, id: result.insertId });
  } catch (e) {
    res.status(e.code === "ER_DUP_ENTRY" ? 409 : 500).json({ sucesso: false, erro: e.code === "ER_DUP_ENTRY" ? "Já existe um ambiente com esse nome." : "Não foi possível cadastrar o ambiente." });
  }
});



async function autenticarDesperdicio(req, res, next) {
  try {
    if (!JWT_SECRET) return res.status(503).json({ sucesso: false, erro: "Autenticação não configurada." });
    const claims = jwt.verify(req.cookies[COOKIE_NAME] || "", JWT_SECRET, { issuer: "goschool-auth" });
    const [rows] = await pool.execute("SELECT id, tipo, ativo FROM usuarios WHERE id = ? LIMIT 1", [claims.sub]);
    const user = rows[0];
    if (!user || !user.ativo) return res.status(401).json({ sucesso: false, erro: "Sessão inválida ou conta inativa." });
    if (user.tipo !== "adm") return res.status(403).json({ sucesso: false, erro: "Apenas a Coordenação pode acessar o dashboard de desperdício." });
    req.desperdicioUser = user;
    return next();
  } catch {
    return res.status(401).json({ sucesso: false, erro: "Faça login com uma conta administrativa." });
  }
}


const desperdicioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, /\\.xlsx$/i.test(file.originalname)),
});

function dataExcelParaISO(valor) {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return valor.toISOString().slice(0, 10);
  }
  if (typeof valor === "number" && Number.isFinite(valor)) {
    const data = XLSX.SSF.parse_date_code(valor);
    if (!data) return null;
    return `${String(data.y).padStart(4, "0")}-${String(data.m).padStart(2, "0")}-${String(data.d).padStart(2, "0")}`;
  }
  const texto = String(valor ?? "").trim();
  let match = texto.match(/^(\\d{4})-(\\d{1,2})-(\\d{1,2})$/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  match = texto.match(/^(\\d{1,2})[/.](\\d{1,2})[/.](\\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return null;
}

function numeroExcel(valor) {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : NaN;
  const texto = String(valor ?? "").trim().replace(",", ".");
  return texto === "" ? NaN : Number(texto);
}

app.post("/api/desperdicio/importar-excel", autenticarDesperdicio, desperdicioUpload.single("arquivo"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ sucesso: false, erro: "Selecione uma planilha .xlsx de até 5 MB." });
  }

  let conn;
  try {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true });
    const primeiraAba = workbook.SheetNames[0];
    if (!primeiraAba) return res.status(400).json({ sucesso: false, erro: "A planilha não contém uma aba." });

    const linhas = XLSX.utils.sheet_to_json(workbook.Sheets[primeiraAba], { defval: "", raw: true });
    if (!linhas.length) return res.status(400).json({ sucesso: false, erro: "A planilha está vazia." });

    const normalizarChave = (chave) => String(chave).trim().toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").replace(/\\s+/g, "_");
    const dados = linhas.map((linha) => Object.fromEntries(Object.entries(linha).map(([chave, valor]) => [normalizarChave(chave), valor])));
    const obrigatorias = ["data", "refeicao", "alimentos_preparados_kg", "alimentos_descartados_kg"];
    const colunas = Object.keys(dados[0]);
    const faltantes = obrigatorias.filter((coluna) => !colunas.includes(coluna));
    if (faltantes.length) {
      return res.status(400).json({ sucesso: false, erro: "Colunas obrigatórias ausentes: " + faltantes.join(", ") });
    }

    const validos = [];
    const erros = [];
    dados.forEach((linha, indice) => {
      const numeroLinha = indice + 2;
      const data = dataExcelParaISO(linha.data);
      const refeicao = String(linha.refeicao ?? "").trim();
      const preparados = numeroExcel(linha.alimentos_preparados_kg);
      const descartados = numeroExcel(linha.alimentos_descartados_kg);
      if (!data || Number.isNaN(Date.parse(data + "T00:00:00Z")) || data < "2000-01-01" || data > new Date().toISOString().slice(0, 10)) {
        erros.push({ linha: numeroLinha, erro: "Data inválida ou futura. Use AAAA-MM-DD ou DD/MM/AAAA." });
      }
      if (!refeicao || refeicao.length > 120) erros.push({ linha: numeroLinha, erro: "Refeição deve ter entre 1 e 120 caracteres." });
      if (!Number.isFinite(preparados) || preparados <= 0) erros.push({ linha: numeroLinha, erro: "Alimentos preparados deve ser maior que zero." });
      if (!Number.isFinite(descartados) || descartados < 0 || descartados > preparados) erros.push({ linha: numeroLinha, erro: "Descarte deve ser zero ou maior e não pode superar o preparado." });
      if (data && refeicao && refeicao.length <= 120 && Number.isFinite(preparados) && preparados > 0 && Number.isFinite(descartados) && descartados >= 0 && descartados <= preparados) {
        validos.push([data, refeicao, preparados, descartados, req.desperdicioUser.id]);
      }
    });

    if (erros.length) return res.status(422).json({ sucesso: false, erro: "A planilha contém dados inválidos. Nenhuma linha foi importada.", erros: erros.slice(0, 100) });

    conn = await pool.getConnection();
    await conn.beginTransaction();
    for (const registro of validos) {
      await conn.execute(
        "INSERT INTO desperdicio_registros (data_ref, refeicao, alimentos_preparados_kg, alimentos_descartados_kg, criado_por) VALUES (?, ?, ?, ?, ?)",
        registro,
      );
    }
    await conn.commit();
    return res.json({ sucesso: true, importados: validos.length, mensagem: `${validos.length} registro(s) importado(s) com sucesso.` });
  } catch (error) {
    if (conn) await conn.rollback();
    console.error("[desperdicio] importar Excel:", error.message);
    return res.status(500).json({ sucesso: false, erro: "Não foi possível importar a planilha." });
  } finally {
    if (conn) conn.release();
  }
});

app.get("/api/desperdicio/dashboard", autenticarDesperdicio, async (req, res) => {
  const periodo = String(req.query.periodo || "semana");
  const dias = { hoje: 1, semana: 7, mes: 30, ano: 365 };
  if (!Object.hasOwn(dias, periodo)) {
    return res.status(400).json({ sucesso: false, erro: "Período inválido. Use hoje, semana, mes ou ano." });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT data_ref, refeicao,
              SUM(alimentos_preparados_kg) AS preparados,
              SUM(alimentos_descartados_kg) AS descartados,
              COUNT(*) AS registros
       FROM desperdicio_registros
       WHERE data_ref >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         AND data_ref <= CURDATE()
       GROUP BY data_ref, refeicao
       ORDER BY data_ref ASC, refeicao ASC`,
      [dias[periodo] - 1],
    );
    const [configRows] = await pool.execute(
      "SELECT limite_taxa_percentual FROM desperdicio_configuracoes WHERE id = 1 LIMIT 1",
    );
    const limite = Number(configRows[0]?.limite_taxa_percentual ?? 10);
    const porDia = new Map();
    const porRefeicao = new Map();
    let preparados = 0;
    let descartados = 0;
    let registros = 0;

    for (const row of rows) {
      const dia = String(row.data_ref).slice(0, 10);
      const prep = Number(row.preparados);
      const desc = Number(row.descartados);
      preparados += prep;
      descartados += desc;
      registros += Number(row.registros);
      porDia.set(dia, (porDia.get(dia) || 0) + desc);
      const atual = porRefeicao.get(row.refeicao) || { nome: row.refeicao, kg: 0, preparados: 0 };
      atual.kg += desc;
      atual.preparados += prep;
      porRefeicao.set(row.refeicao, atual);
    }

    const taxa = preparados > 0 ? (descartados / preparados) * 100 : 0;
    const refeicoes = [...porRefeicao.values()].sort((a, b) => b.kg - a.kg);
    const ingredientes = refeicoes.map(item => ({
      nome: item.nome,
      kg: Number(item.kg.toFixed(3)),
      percentual: item.preparados > 0 ? Number(((item.kg / item.preparados) * 100).toFixed(1)) : 0,
    }));
    const labels = [...porDia.keys()];
    const alertas = taxa > limite
      ? [{ nivel: "erro", mensagem: `Taxa de desperdício de ${taxa.toFixed(1)}% acima do limite institucional de ${limite.toFixed(1)}%.` }]
      : [{ nivel: "sucesso", mensagem: `Taxa dentro do limite institucional de ${limite.toFixed(1)}%.` }];

    return res.json({
      sucesso: true,
      demo: false,
      kpis: {
        totalDesperdicio: Number(descartados.toFixed(3)),
        refeicoesServidas: registros,
        taxaDesperdicio: Number(taxa.toFixed(1)),
        // Não existe preço/custo por refeição no banco; não estimar economia sem essa base.
        economiaEstimada: 0,
      },
      graficos: {
        evolucao: { labels, data: labels.map(dia => Number(porDia.get(dia).toFixed(3))) },
        distribuicao: { labels: ingredientes.map(item => item.nome), data: ingredientes.map(item => item.kg) },
      },
      alertas,
      tabelas: { ingredientes },
      resumo: {
        maiorDesperdicio: ingredientes[0]?.nome || "--",
        menorDesperdicio: ingredientes.length ? [...ingredientes].sort((x, y) => x.kg - y.kg)[0].nome : "--",
      },
    });
  } catch (error) {
    console.error("[desperdicio] dashboard:", error.message);
    return res.status(500).json({ sucesso: false, erro: "Não foi possível carregar o dashboard de desperdício. Verifique se a migração do banco foi executada." });
  }
});

app.listen(PORT, () => {
  console.log(`Auth Service listening on :${PORT}`);
  console.log(`GOOGLE_CLIENT_ID carregado: ${Boolean(CLIENT_ID)}`);
  console.log(`JWT_SECRET carregado: ${Boolean(JWT_SECRET)}`);
});