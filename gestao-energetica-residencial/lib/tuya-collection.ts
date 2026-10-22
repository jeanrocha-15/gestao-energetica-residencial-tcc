import { env } from 'cloudflare:workers';
import { getDatabase } from '@/db';
import { synchronize } from './tuya';
import { userConfiguration } from './tuya-authorization';

export const COLLECTION_INTERVAL=12*60*60*1000;
/** Retorna datas persistidas sem confundir uma tentativa com uma coleta concluída. */
export async function collectionStatus(userId:string) {
  return await getDatabase().prepare('SELECT last_attempt_at AS lastAttemptAt,last_success_at AS lastSuccessAt,next_run_at AS nextRunAt,status,message FROM tuya_sync_state WHERE user_id=?').bind(userId).first()
    || {lastAttemptAt:null,lastSuccessAt:null,nextRunAt:null,status:'pending',message:'Aguardando coleta.'};
}
/** Executa uma coleta real e grava seu resultado; falhas não atualizam a data de sucesso. */
export async function runCollection(userId:string) {
  const db=getDatabase(),lockId='collect:'+userId,token=crypto.randomUUID();
  const lease=await db.prepare('INSERT INTO tuya_locks(user_id,token,expires_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE tuya_locks.expires_at<?').bind(lockId,token,Date.now()+3600000,Date.now()).run();
  if (!lease.meta.changes) throw new Error('Coleta em andamento.');
  try { return await performCollection(userId); }
  finally { await db.prepare('DELETE FROM tuya_locks WHERE user_id=? AND token=?').bind(lockId,token).run(); }
}
/** Persiste tentativa e resultado sob o lock da conta, sem sobrescrever o sucesso de outra execução. */
async function performCollection(userId:string) {
  const db=getDatabase(),now=Date.now();
  await db.prepare("INSERT INTO tuya_sync_state(user_id,last_attempt_at,next_run_at,status,message) VALUES(?,?,?,'running','Coleta em andamento.') ON CONFLICT(user_id) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,next_run_at=excluded.next_run_at,status='running',message=excluded.message").bind(userId,now,now+COLLECTION_INTERVAL).run();
  try {
    const result=await synchronize(await userConfiguration(userId));
    const failures=result.devices.filter(device=>'error' in device && device.error).length;
    const successful=result.devices.length>0 && failures===0;
    const status=failures?'partial':successful?'success':'pending';
    const message=failures?'Alguns dispositivos não puderam ser atualizados.':successful?'Dados consultados com sucesso.':'Associe seus dispositivos para coletar dados.';
    await db.prepare('UPDATE tuya_sync_state SET last_success_at=CASE WHEN ? THEN ? ELSE last_success_at END,status=?,message=? WHERE user_id=?').bind(successful?1:0,Date.now(),status,message,userId).run();
    // Detalhes técnicos de erros não são repassados à interface do usuário final.
    return {...result,devices:result.devices.map(device=>('error' in device && device.error)?{id:device.id,name:device.name,error:true,message:'Dados indisponíveis. Tente novamente ou contate o administrador.'}:device),collection:await collectionStatus(userId)};
  } catch {
    await db.prepare("UPDATE tuya_sync_state SET status='error',message='Não foi possível atualizar. Reconecte a conta ou contate o administrador.' WHERE user_id=?").bind(userId).run();
    throw new Error('Não foi possível atualizar. Reconecte a conta ou contate o administrador.');
  }
}
/** Coleta apenas contas vencidas na agenda; o lock existente protege medições contra execução simultânea. */
export async function collectDue() {
  const users=await getDatabase().prepare('SELECT c.user_id FROM tuya_connections c LEFT JOIN tuya_sync_state s ON s.user_id=c.user_id WHERE COALESCE(s.next_run_at,0)<=?').bind(Date.now()).all<{user_id:string}>();
  for (const user of users.results) { try { await runCollection(user.user_id); } catch { /* A falha já foi persistida e não impede outras contas. */ } }
}
/** Ativa o alarme local persistente; a interface não é responsável por manter o coletor rodando. */
export async function armCollector() {
  if (!env.TUYA_COLLECTOR) throw new Error('Coletor local indisponível.');
  return env.TUYA_COLLECTOR.get(env.TUYA_COLLECTOR.idFromName('tuya-12h')).fetch('http://collector/arm');
}
/** Reagenda uma associação nova para a próxima verificação do backend. */
export async function requestCollection(userId:string) {
  await getDatabase().prepare('INSERT INTO tuya_sync_state(user_id,next_run_at) VALUES(?,0) ON CONFLICT(user_id) DO UPDATE SET next_run_at=0').bind(userId).run();
  await armCollector();
}
