import { env } from 'cloudflare:workers';
import { getDatabase } from '@/db';
import { accountKey, configuration, signedGet, type Configuration } from './tuya';
import { authorizationPage, authorizationAddress } from './tuya-oauth-url';

const required=['TUYA_OAUTH_CLIENT_ID','TUYA_OAUTH_CLIENT_SECRET','TUYA_OAUTH_IDENTIFIER','TUYA_OAUTH_AUTHORIZE_URL','TUYA_OAUTH_REDIRECT_URI','TUYA_ENDPOINT','TUYA_TOKEN_KEY'] as const;
type Account={user_id:string;account_key:string;app_uid:string;tokens:string;expires_at:number};
type Tokens={access_token:string;refresh_token:string;expire_time:number;uid?:string};

/** O papel administrador só pode ser atribuído pela configuração privada do servidor. */
export function isAdmin(userId:string) { return Boolean(env.LOCAL_ADMIN_USER_ID?.trim() && userId===env.LOCAL_ADMIN_USER_ID.trim()); }
/** Lista nomes de campos somente para a rota restrita de administração. */
export function oauthMissing() { return required.filter(name=>!env[name]?.trim()); }
/** Valida a configuração privada e aceita apenas destinos oficiais e retorno ao servidor local. */
export function oauthConfiguration(userId:string,appUid=''):Configuration {
  if (oauthMissing().length) throw new Error('OAuth não configurado pelo administrador.');
  const endpoint=env.TUYA_ENDPOINT!.trim().replace(/\/$/,'');
  if (!['https://openapi.tuyaus.com','https://openapi-ueaz.tuyaus.com','https://openapi.tuyaeu.com','https://openapi-weaz.tuyaeu.com','https://openapi.tuyacn.com','https://openapi.tuyain.com'].includes(endpoint)) throw new Error('Centro de dados inválido.');
  authorizationPage(env.TUYA_OAUTH_AUTHORIZE_URL!.trim());
  const callback=new URL(env.TUYA_OAUTH_REDIRECT_URI!.trim());
  if (!['http:','https:'].includes(callback.protocol) || !['127.0.0.1','localhost'].includes(callback.hostname) || callback.pathname!=='/api/integrations/tuya/callback' || callback.search || callback.hash || callback.username || callback.password) throw new Error('Callback local inválido.');
  if (!/^[a-f0-9]{64}$/i.test(env.TUYA_TOKEN_KEY!.trim())) throw new Error('TUYA_TOKEN_KEY deve conter 32 bytes em hexadecimal.');
  return {clientId:env.TUYA_OAUTH_CLIENT_ID!.trim(),secret:env.TUYA_OAUTH_CLIENT_SECRET!.trim(),identifier:env.TUYA_OAUTH_IDENTIFIER!.trim(),endpoint,userId,appUid,oauth:true};
}
/** Retorna somente disponibilidade, sem valores nem nomes de variáveis para o usuário final. */
export function oauthReady() { try { oauthConfiguration(''); return true; } catch { return false; } }
/** Calcula hashes usados para estados e sessões sem persistir seus valores originais. */
async function hash(value:string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join(''); }
/** Importa a chave privada de cifragem; ela permanece fora do banco e do navegador. */
async function encryptionKey() {
  const secret=env.TUYA_TOKEN_KEY?.trim() || '';
  if (!/^[a-f0-9]{64}$/i.test(secret)) throw new Error('Chave de proteção indisponível.');
  return crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/../g)!,part=>parseInt(part,16)),{name:'AES-GCM'},false,['encrypt','decrypt']);
}
/** Cifra tokens com nonce novo e vincula o conteúdo ao usuário local, impedindo troca entre contas. */
async function seal(userId:string,tokens:Tokens) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(userId)},await encryptionKey(),new TextEncoder().encode(JSON.stringify(tokens)));
  return JSON.stringify({iv:Array.from(iv),data:Array.from(new Uint8Array(bytes))});
}
/** Decifra somente no servidor; nunca devolve access_token ou refresh_token nas respostas públicas. */
async function unseal(account:Account):Promise<Tokens> {
  const payload=JSON.parse(account.tokens);
  const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(payload.iv),additionalData:new TextEncoder().encode(account.user_id)},await encryptionKey(),new Uint8Array(payload.data));
  return JSON.parse(new TextDecoder().decode(bytes));
}
/** Resolve a autorização do próprio usuário, preservando o vínculo antigo do proprietário já configurado. */
export async function userConfiguration(userId:string) {
  const row=await getDatabase().prepare('SELECT * FROM tuya_oauth_accounts WHERE user_id=?').bind(userId).first<Account>();
  if (row) {
    const config=oauthConfiguration(userId,row.app_uid);
    if (row.account_key!==await accountKey(config)) throw new Error('Autorize novamente sua conta.');
    return config;
  }
  const legacy=configuration();
  if (legacy.userId!==userId) throw new Error('Conecte sua própria conta Tuya/Smart Life.');
  return legacy;
}
/** Inicia consentimento oficial, com estado aleatório, sessão vinculada e cookie temporário HttpOnly. */
export async function beginAuthorization(request:Request,userId:string) {
  const config=oauthConfiguration(userId), callback=new URL(env.TUYA_OAUTH_REDIRECT_URI!.trim());
  if (new URL(request.url).origin!==callback.origin) throw new Error('Abra o sistema no endereço local configurado pelo administrador.');
  const session=request.headers.get('cookie')?.match(/(?:^|;\s*)energy_session=([a-f0-9-]{72})/)?.[1];
  if (!session) throw new Error('Entre novamente na sua conta local.');
  const state=crypto.randomUUID()+crypto.randomUUID(),db=getDatabase();
  await db.prepare('DELETE FROM tuya_oauth_states WHERE expires_at<? OR user_id=?').bind(Date.now(),userId).run();
  await db.prepare('INSERT INTO tuya_oauth_states(state_hash,user_id,session_hash,expires_at) VALUES(?,?,?,?)').bind(await hash(state),userId,await hash(session),Date.now()+600000).run();
  const authorizationUrl=authorizationAddress(env.TUYA_OAUTH_AUTHORIZE_URL!.trim(),config.clientId,callback.href,state);
  // client_id é o identificador público exigido pelo OAuth; nenhum segredo segue no redirecionamento.
  return Response.json({authorizationUrl},{headers:{'Cache-Control':'no-store','Set-Cookie':`tuya_oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/api/integrations/tuya/callback; Max-Age=600${callback.protocol==='https:'?'; Secure':''}`}});
}
/** Consome o estado uma única vez e troca o código oficial sem depender do cookie Strict no retorno externo. */
export async function finishAuthorization(request:Request) {
  const url=new URL(request.url),state=url.searchParams.get('state'),code=url.searchParams.get('code');
  const cookie=request.headers.get('cookie')?.match(/(?:^|;\s*)tuya_oauth_state=([a-f0-9-]{72})/)?.[1];
  if (!state || state!==cookie || !/^[a-f0-9-]{72}$/.test(state)) throw new Error('Autorização inválida ou expirada.');
  const db=getDatabase();
  const pending=await db.prepare('DELETE FROM tuya_oauth_states WHERE state_hash=? AND expires_at>? RETURNING user_id,session_hash').bind(await hash(state),Date.now()).first<{user_id:string;session_hash:string}>();
  if (!pending || !code || code.length>2048 || url.searchParams.has('error')) throw new Error('Autorização cancelada ou expirada.');
  const session=await db.prepare('SELECT user_id FROM local_sessions WHERE token_hash=? AND user_id=? AND expires_at>?').bind(pending.session_hash,pending.user_id,Date.now()).first();
  if (!session) throw new Error('Sua sessão local expirou. Entre e tente novamente.');
  const config=oauthConfiguration(pending.user_id);
  if (url.origin+url.pathname!==env.TUYA_OAUTH_REDIRECT_URI!.trim()) throw new Error('Retorno de autorização inválido.');
  const tokens=await signedGet<Tokens>(config,'/v1.0/token','',{grant_type:'2',code});
  if (!tokens.access_token || !tokens.refresh_token || !Number.isFinite(tokens.expire_time) || tokens.expire_time<=0 || !/^[a-zA-Z0-9_-]{1,100}$/.test(tokens.uid || '')) throw new Error('A Tuya não retornou uma autorização válida.');
  config.appUid=tokens.uid!;
  const key=await accountKey(config),cipher=await seal(config.userId,tokens);
  // A unicidade evita que a mesma conta seja associada silenciosamente a dois usuários locais.
  await db.batch([
    db.prepare('INSERT INTO tuya_oauth_accounts(user_id,account_key,app_uid,tokens,expires_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET account_key=excluded.account_key,app_uid=excluded.app_uid,tokens=excluded.tokens,expires_at=excluded.expires_at').bind(config.userId,key,config.appUid,cipher,Date.now()+tokens.expire_time*1000),
    db.prepare('INSERT INTO tuya_connections(user_id,account_key,connected_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET account_key=excluded.account_key,connected_at=excluded.connected_at').bind(config.userId,key,new Date().toISOString()),
    db.prepare("INSERT INTO tuya_sync_state(user_id,next_run_at) VALUES(?,0) ON CONFLICT(user_id) DO UPDATE SET next_run_at=0,last_success_at=NULL,status='pending',message='Conta autorizada. Aguardando coleta.'").bind(config.userId),
  ]);
}
/** Renova tokens expirados no servidor e serializa a rotação também entre coletor e requisições da interface. */
export async function oauthToken(config:Configuration,force=false):Promise<string> {
  const db=getDatabase(),lockId='oauth:'+config.userId,lockToken=crypto.randomUUID();
  let initialCipher:string|undefined;
  for (let attempt=0;attempt<100;attempt++) {
    const row=await db.prepare('SELECT * FROM tuya_oauth_accounts WHERE user_id=?').bind(config.userId).first<Account>();
    if (!row || row.account_key!==await accountKey(config)) throw new Error('Autorize novamente sua conta.');
    if (initialCipher===undefined) initialCipher=row.tokens;
    const tokens=await unseal(row);
    if (row.expires_at>Date.now()+60000 && (!force || row.tokens!==initialCipher)) return tokens.access_token;
    const lease=await db.prepare('INSERT INTO tuya_locks(user_id,token,expires_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE tuya_locks.expires_at<?').bind(lockId,lockToken,Date.now()+60000,Date.now()).run();
    if (!lease.meta.changes) { await new Promise(resolve=>setTimeout(resolve,200)); continue; }
    try {
      // Outra execução pode ter renovado enquanto este pedido aguardava o lock.
      const current=await db.prepare('SELECT tokens FROM tuya_oauth_accounts WHERE user_id=?').bind(config.userId).first<{tokens:string}>();
      if (current?.tokens!==row.tokens) continue;
      const renewed=await signedGet<Tokens>(config,`/v1.0/token/${encodeURIComponent(tokens.refresh_token)}`);
      if (!renewed.access_token || !renewed.refresh_token || !Number.isFinite(renewed.expire_time) || renewed.expire_time<=0 || (renewed.uid && renewed.uid!==row.app_uid)) throw new Error('Autorize novamente sua conta.');
      const saved=await db.prepare('UPDATE tuya_oauth_accounts SET tokens=?,expires_at=? WHERE user_id=? AND tokens=?').bind(await seal(config.userId,renewed),Date.now()+renewed.expire_time*1000,config.userId,row.tokens).run();
      if (!saved.meta.changes) throw new Error('A autorização foi alterada. Tente novamente.');
      return renewed.access_token;
    } finally { await db.prepare('DELETE FROM tuya_locks WHERE user_id=? AND token=?').bind(lockId,lockToken).run(); }
  }
  throw new Error('Renovação em andamento. Tente novamente.');
}
