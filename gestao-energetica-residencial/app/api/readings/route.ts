import { getDatabase } from '@/db';
import { validateReading } from '@/lib/readings';
export const dynamic = 'force-dynamic';
/** Cria respostas JSON privadas, sem armazenar medições em caches compartilhados. */
const json = (body: unknown, status = 200) => Response.json(body, {status, headers:{'Cache-Control':'private, no-store'}});
/** Identifica o proprietário pelos cabeçalhos inseridos pela camada de autenticação. */
function identify(request: Request) { return request.headers.get('oai-authenticated-user-id'); }
/** Rejeita alterações vindas de outro site ou enviadas em um formato inesperado. */
function mutationError(request: Request) {
  const origin=request.headers.get('origin');
  if (request.headers.get('sec-fetch-site') === 'cross-site' || (origin && origin !== new URL(request.url).origin)) return json({error:'Origem da solicitação inválida.'},403);
  if (!request.headers.get('content-type')?.includes('application/json')) return json({error:'Formato da solicitação inválido.'},415);
}
/** Traduz falhas do banco em mensagens úteis, sem expor detalhes internos ao navegador. */
function databaseError(error: unknown) {
  console.error('readings storage error', error);
  if (String(error).includes('UNIQUE constraint')) return json({error:'Já existe uma medição para essa data, cômodo e circuito. Edite o registro existente.'},409);
  return json({error:'Não foi possível acessar as medições. Tente novamente.'},503);
}
/** Consulta os registros manuais e automáticos do usuário autenticado para compor o painel. */
export async function GET(request: Request) {
  const userId=identify(request); if(!userId) return json({error:'Entre na sua conta para acessar as medições.'},401);
  try { const result=await getDatabase().prepare("SELECT id,date,room,circuit,kwh,'manual' AS source FROM readings WHERE user_id = ? UNION ALL SELECT id,date,room,circuit,kwh,'tuya' AS source FROM tuya_readings WHERE user_id = ? ORDER BY date DESC").bind(userId,userId).all(); return json({readings:result.results}); } catch(error){return databaseError(error);}
}
/** Valida e cria ou atualiza uma medição manual pertencente ao usuário conectado. */
async function save(request: Request, update: boolean) {
  const userId=identify(request); if(!userId) return json({error:'Entre na sua conta para salvar medições.'},401);
  const blocked=mutationError(request);if(blocked)return blocked;
  let data;try{data=validateReading(await request.json());}catch(error){return json({error:error instanceof Error?error.message:'Dados inválidos.'},400);}
  try {
    const db=getDatabase(),now=new Date().toISOString();
    if(update){
      const result=await db.prepare('UPDATE readings SET date=?, room=?, circuit=?, kwh=?, updated_at=? WHERE id=? AND user_id=?').bind(data.date,data.room,data.circuit,data.kwh,now,data.id,userId).run();
      if(!result.meta.changes)return json({error:'Medição não encontrada. Atualize a página.'},404);
    } else {
      const existing=await db.prepare('SELECT id,date,room,circuit,kwh FROM readings WHERE id=? AND user_id=?').bind(data.id,userId).first();
      if(existing){ if(JSON.stringify(existing)===JSON.stringify(data)) return json({reading:existing}); return json({error:'Este registro já existe. Edite a medição.'},409); }
      await db.prepare('INSERT INTO readings (id,user_id,date,room,circuit,kwh,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(data.id,userId,data.date,data.room,data.circuit,data.kwh,now,now).run();
    }
    return json({reading:data},update?200:201);
  }catch(error){return databaseError(error);}
}
/** Encaminha o cadastro de uma nova medição manual. */
export const POST = (request: Request) => save(request,false);
/** Encaminha a edição de uma medição manual existente. */
export const PUT = (request: Request) => save(request,true);
/** Exclui somente a medição manual identificada e pertencente ao usuário autenticado. */
export async function DELETE(request: Request) {
  const userId=identify(request);if(!userId)return json({error:'Entre na sua conta para excluir medições.'},401);
  const blocked=mutationError(request);if(blocked)return blocked;
  let id: unknown;try{const body: unknown=await request.json();id=body&&typeof body==='object'&&'id' in body?body.id:null;}catch{return json({error:'Solicitação inválida.'},400);}
  if(typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id))return json({error:'Identificador inválido.'},400);
  try{await getDatabase().prepare('DELETE FROM readings WHERE id=? AND user_id=?').bind(id,userId).run();return json({deleted:true});}catch(error){return databaseError(error);}
}
