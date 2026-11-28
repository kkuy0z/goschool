require("dotenv").config({path:require("path").resolve(__dirname,"../../../.env")});
const mysql=require("mysql2/promise");
const amqp=require("amqplib");

const pool=mysql.createPool({
  host:process.env.MYSQL_HOST||"127.0.0.1",
  port:Number(process.env.MYSQL_PORT||3306),
  user:process.env.MYSQL_USER,
  password:process.env.MYSQL_PASSWORD,
  database:process.env.MYSQL_DATABASE||"goschool",
  waitForConnections:true,
  connectionLimit:5
});
const QUEUE="goschool.cardapio.import";
const allowedDays=new Set(["segunda","terca","quarta","quinta","sexta","sabado","domingo"]);
const allowedCategories=new Set(["cafe_manha","almoco","lanche"]);

function numberOrNull(value){
  if(value===undefined||value===null||String(value).trim()==="") return null;
  const n=Number(String(value).replace(",","."));
  if(!Number.isFinite(n)||n<0) throw new Error("Valor nutricional inválido.");
  return n;
}
function parseAllergens(value){
  if(!value) return [];
  if(Array.isArray(value)) return value;
  const text=String(value).trim();
  if(!text) return [];
  try { const parsed=JSON.parse(text); if(Array.isArray(parsed)) return parsed; } catch {}
  return text.split(/[;,]/).map(x=>x.trim()).filter(Boolean);
}
async function processImport(message){
  const {importacaoId,usuarioId,rows}=message;
  const conn=await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute("UPDATE cardapio_importacoes SET status='processando' WHERE id=?",[importacaoId]);
    for(let i=0;i<rows.length;i++){
      const row=rows[i];
      const nome=String(row.nome||"").trim();
      const categoria=String(row.categoria||"").trim();
      const dia=String(row.dia_semana||"").trim().toLowerCase();
      if(nome.length<2||nome.length>180||!allowedCategories.has(categoria)||!allowedDays.has(dia)) throw new Error("Linha "+(i+2)+": nome, categoria ou dia inválido.");
      const horario=String(row.horario||"").trim()||null;
      const calorias=numberOrNull(row.calorias);
      const proteina=numberOrNull(row.proteina);
      const carboidrato=numberOrNull(row.carboidrato);
      const imagem=String(row.imagem||"").trim()||null;
      const alergicos=parseAllergens(row.alergicos);
      const [result]=await conn.execute(
        "INSERT INTO refeicoes(nome,descricao,categoria,dia_semana,horario,calorias,proteina,carboidrato,imagem,alergicos,observacoes,criado_por) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        [nome,String(row.descricao||"").trim()||null,categoria,dia,horario,calorias,proteina,carboidrato,imagem,JSON.stringify(alergicos),String(row.observacoes||"").trim()||null,usuarioId]
      );
    }
    await conn.execute("UPDATE cardapio_importacoes SET status='concluida',linhas_importadas=?,concluido_em=CURRENT_TIMESTAMP WHERE id=?",[rows.length,importacaoId]);
    await conn.commit();
  } catch(error) {
    await conn.rollback();
    await pool.execute("UPDATE cardapio_importacoes SET status='falhou',linhas_importadas=0,erros=?,concluido_em=CURRENT_TIMESTAMP WHERE id=?",[JSON.stringify([{erro:error.message}]),importacaoId]);
    console.error("[cardapio-worker] importação falhou:",importacaoId,error.message);
  } finally { conn.release(); }
}
async function main(){
  if(!process.env.RABBITMQ_URL) throw new Error("Configure RABBITMQ_URL.");
  const connection=await amqp.connect(process.env.RABBITMQ_URL);
  const channel=await connection.createChannel();
  await channel.assertQueue(QUEUE,{durable:true});
  channel.prefetch(1);
  console.log("[cardapio-worker] aguardando importações Excel...");
  channel.consume(QUEUE,async msg=>{
    if(!msg) return;
    try {
      const payload=JSON.parse(msg.content.toString("utf8"));
      await processImport(payload);
      channel.ack(msg);
    } catch(error) {
      console.error("[cardapio-worker] mensagem inválida:",error.message);
      channel.nack(msg,false,false);
    }
  });
}
main().catch(error=>{console.error("[cardapio-worker] inicialização:",error);process.exit(1);});
