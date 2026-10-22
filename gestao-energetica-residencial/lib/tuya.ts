import { env } from 'cloudflare:workers';
import { getDatabase } from '@/db';
import { roomIds, circuitNames } from '@/lib/readings';
import { counterDelta, decodePoint, decodePoints, numericValue, type TuyaSpecification, type TuyaStatus } from './tuya-values';

export type Configuration = { clientId: string; secret: string; endpoint: string; userId: string; appUid: string; identifier?:string; oauth?:boolean };
type RemoteDevice = { id: string; name?: string; model?: string; product_name?: string; category?: string; online?: boolean; uid?: string };
type Mapping = { user_id: string; device_id: string; account_key: string; room: string; circuit: string; energy_code: string | null; energy_mode: string; since: number; last_log_at: number };
const endpoints = ['https://openapi.tuyaus.com', 'https://openapi-ueaz.tuyaus.com', 'https://openapi.tuyaeu.com', 'https://openapi-weaz.tuyaeu.com', 'https://openapi.tuyacn.com', 'https://openapi.tuyain.com'];
let cachedToken: { key: string; token: string; expires: number } | undefined;
let pendingToken: { key: string; promise: Promise<string> } | undefined;

/** Expõe apenas nomes das configurações ausentes; valores privados nunca saem do servidor. */
export function configurationStatus() {
  const required = ['TUYA_CLIENT_ID','TUYA_CLIENT_SECRET','TUYA_ENDPOINT','TUYA_USER_ID','TUYA_APP_UID'] as const;
  return required.filter(key => !env[key]?.trim());
}
/** Usa a conta vinculada oficialmente por QR na plataforma e restringe seu acesso ao proprietário local. */
export function configuration(): Configuration {
  const missing = configurationStatus();
  if (missing.length) throw new Error(`Integração não configurada. Preencha ${missing.join(', ')} em .dev.vars e reinicie pnpm dev.`);
  const endpoint = env.TUYA_ENDPOINT!.trim().replace(/\/$/, '');
  if (!endpoints.includes(endpoint)) throw new Error('TUYA_ENDPOINT não corresponde a um centro de dados oficial permitido.');
  const appUid = env.TUYA_APP_UID!.trim();
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(appUid)) throw new Error('TUYA_APP_UID inválido. Copie o UID da conta vinculada no projeto Tuya.');
  return { clientId:env.TUYA_CLIENT_ID!.trim(), secret:env.TUYA_CLIENT_SECRET!.trim(), endpoint, userId:env.TUYA_USER_ID!.trim(), appUid };
}
/** Converte bytes em hexadecimal para hashes e assinatura oficial HMAC-SHA256. */
function hex(bytes: ArrayBuffer) { return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2,'0')).join(''); }
/** Calcula identificadores não reversíveis sem persistir credenciais nem tokens. */
async function digest(value: string) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))); }
/** Distingue a conta/projeto real para invalidar vínculos quando a configuração privada mudar. */
export async function accountKey(config: Configuration) { return digest(`${config.endpoint}|${config.clientId}|${config.appUid}`); }

class TuyaError extends Error {
  /** Preserva somente o código da Tuya e uma orientação local, sem propagar payloads privados. */
  constructor(public code: string) {
    const advice: Record<string,string> = { '1106':'Permissão negada: confira serviços autorizados, UID, vínculo da conta e centro de dados.', '1004':'Assinatura rejeitada: confira Access ID, Access Secret e relógio do Windows.', '1010':'Token expirado ou inválido.', '1011':'Token inválido.', '28841002':'Serviço sem autorização ou assinatura expirada no projeto Tuya.', '2009':'A API não suporta esta operação para o dispositivo/projeto.' };
    super(`Tuya ${code}: ${advice[code] || 'Consulta recusada. Confira as permissões e a assinatura dos serviços na plataforma.'}`);
  }
}
/** Ordena parâmetros e assina sua forma canônica conforme os SDKs oficiais, com timeout e sem redirecionamento. */
export async function signedGet<T>(config: Configuration, path: string, token = '', query: Record<string,string> = {}): Promise<T> {
  const params = new URLSearchParams(query); params.sort();
  const target = path + (params.size ? `?${params.toString()}` : '');
  // A Tuya assina valores sem percent-encoding; a URL de transporte continua codificada.
  // Isso importa para cursores de paginação que contenham +, / ou =.
  const canonical = path + (params.size ? '?' + [...params].map(([name,value])=>`${name}=${value}`).join('&') : '');
  const encoder = new TextEncoder(), timestamp = String(Date.now()), nonce = crypto.randomUUID();
  const contentHash = await digest('');
  const key = await crypto.subtle.importKey('raw', encoder.encode(config.secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const signature = hex(await crypto.subtle.sign('HMAC', key, encoder.encode(config.clientId + token + timestamp + nonce + (config.identifier || '') + `GET\n${contentHash}\n\n${canonical}`))).toUpperCase();
  let response: Response;
  try {
    response = await fetch(config.endpoint + target, { headers:{ client_id:config.clientId, t:timestamp, nonce, sign_method:'HMAC-SHA256', sign:signature, ...(token ? {access_token:token} : {}) }, redirect:'error', signal:AbortSignal.timeout(15000) });
  } catch { throw new Error('Não foi possível alcançar a API Tuya em 15 segundos. Confira a conexão e o centro de dados.'); }
  if (!response.ok) throw new Error(`API Tuya indisponível (HTTP ${response.status}). Tente novamente mais tarde.`);
  let data: { success:boolean; result:T; code?: string | number };
  try { data = await response.json(); } catch { throw new Error('A Tuya retornou uma resposta inválida.'); }
  if (!data.success) throw new TuyaError(String(data.code || 'desconhecido').replace(/[^a-zA-Z0-9_-]/g,''));
  return data.result;
}
/** Mantém o token apenas em memória e compartilha uma renovação entre requisições simultâneas. */
async function accessToken(config: Configuration, force=false): Promise<string> {
  if (config.oauth) return (await import('./tuya-authorization')).oauthToken(config,force);
  const key = await digest(`${config.endpoint}|${config.clientId}|${config.secret}`);
  if (cachedToken?.key === key && cachedToken.expires > Date.now()) return cachedToken.token;
  if (pendingToken?.key === key) return pendingToken.promise;
  const promise = (async () => {
    const result = await signedGet<{access_token:string; expire_time:number}>(config,'/v1.0/token','',{grant_type:'1'});
    if (!result?.access_token || !Number.isFinite(result.expire_time)) throw new Error('Resposta de autenticação Tuya inválida.');
    cachedToken = { key, token:result.access_token, expires:Date.now() + Math.max(0,result.expire_time-60)*1000 };
    return result.access_token;
  })();
  pendingToken = { key, promise };
  try { return await promise; } finally { if (pendingToken?.promise === promise) pendingToken = undefined; }
}
/** Repete somente uma leitura idempotente quando a Tuya informa expiração do token. */
async function get<T>(config: Configuration, path: string, query: Record<string,string> = {}): Promise<T> {
  try { return await signedGet<T>(config,path,await accessToken(config),query); }
  catch (error) {
    if (!(error instanceof TuyaError) || !['1010','1011'].includes(error.code)) throw error;
    cachedToken = undefined;
    return signedGet<T>(config,path,await accessToken(config,true),query);
  }
}
/** Descobre dispositivos da conta informada, percorrendo as páginas sem devolver local_key ou IP. */
async function discover(config: Configuration): Promise<RemoteDevice[]> {
  const found = new Map<string,RemoteDevice>();
  try {
    for (let page=1; page<=100; page++) {
      const list = await get<RemoteDevice[]>(config,`/v1.0/users/${config.appUid}/devices`,{page_no:String(page),page_size:'50'});
      if (!Array.isArray(list)) throw new Error('Formato inesperado na lista de dispositivos Tuya.');
      const before = found.size;
      for (const device of list) if (/^[a-zA-Z0-9_-]{1,100}$/.test(device.id)) found.set(device.id,device);
      if (list.length < 50) return [...found.values()];
      if (found.size === before) throw new Error('A Tuya repetiu a página de dispositivos; descoberta interrompida para evitar lista incompleta.');
    }
    throw new Error('A conta excede o limite de 5.000 dispositivos desta consulta.');
  } catch (error) {
    // Alguns projetos concedem descoberta somente pela API de usuários associados.
    if (!(error instanceof TuyaError) || error.code !== '1106') throw error;
    found.clear();
    let cursor = '';
    for (let page=0; page<100; page++) {
      const result = await get<{ devices:RemoteDevice[]; has_more:boolean; last_row_key:string }>(config,'/v1.0/iot-01/associated-users/devices',{size:'50',...(cursor?{last_row_key:cursor}:{})});
      if (!Array.isArray(result?.devices)) throw new Error('Lista de usuários associados inválida.');
      for (const item of result.devices) {
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(item.id)) continue;
        const device = item.uid ? item : await get<RemoteDevice>(config,`/v1.0/devices/${item.id}`);
        // O token do projeto pode enxergar outras contas; só a conta privada configurada é aceita.
        if (device.uid === config.appUid) found.set(device.id,device);
      }
      if (!result.has_more) return [...found.values()];
      if (!result.last_row_key || result.last_row_key === cursor) throw new Error('Paginação de dispositivos Tuya inconsistente.');
      cursor = result.last_row_key;
    }
    throw new Error('A descoberta excedeu o limite de páginas.');
  }
}
/** Expõe somente os campos necessários do dispositivo real; modelo ausente continua ausente. */
function publicDevice(device: RemoteDevice) {
  return { id:device.id, name:device.name || null, model:device.model || null, type:device.category || null, product:device.product_name || null, online:typeof device.online==='boolean'?device.online:null };
}
/** Busca o vínculo salvo e confere se corresponde à conta configurada atualmente. */
export async function isConnected(config: Configuration) {
  const row = await getDatabase().prepare('SELECT account_key FROM tuya_connections WHERE user_id=?').bind(config.userId).first<{account_key:string}>();
  return row?.account_key === await accountKey(config);
}
/** Consulta o vínculo e as associações sem realizar consultas à nuvem no carregamento da página. */
export async function integrationState(config: Configuration) {
  return { configured:true, connected:await isConnected(config), devices:[], message:'Use Conectar Tuya/Smart Life para verificar a conta real e buscar os dispositivos.' };
}
/** Verifica o acesso real antes de persistir o vínculo local da conta e devolver a lista descoberta. */
export async function connect(config: Configuration) {
  const devices = await discover(config);
  if (!devices.length) throw new Error('Nenhum dispositivo acessível nesta conta. Vincule a conta com QR na plataforma, confirme UID, região e permissões; nenhum vínculo local foi criado.');
  await getDatabase().prepare('INSERT INTO tuya_connections(user_id,account_key,connected_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET account_key=excluded.account_key,connected_at=excluded.connected_at').bind(config.userId,await accountKey(config),new Date().toISOString()).run();
  return listResult(config,devices);
}
/** Combina a lista real com associações persistidas, sem fabricar dispositivos ou telemetria. */
async function listResult(config: Configuration, list: RemoteDevice[]) {
  const result = await getDatabase().prepare('SELECT * FROM tuya_mappings WHERE user_id=? AND account_key=?').bind(config.userId,await accountKey(config)).all<Mapping>();
  return { configured:true, connected:true, devices:list.map(device=>{
    const row=result.results.find(mapping=>mapping.device_id===device.id);
    return {...publicDevice(device),mapping:row?{room:row.room,circuit:row.circuit,energyCode:row.energy_code,energyMode:row.energy_mode,since:row.since}:null};
  }), message:`${list.length} dispositivo(s) retornado(s) pela API Tuya.`, checkedAt:new Date().toISOString() };
}
/** Atualiza a descoberta somente para um vínculo já verificado. */
export async function listDevices(config: Configuration) {
  if (!await isConnected(config)) throw new Error('Conecte primeiro a conta Tuya/Smart Life.');
  return listResult(config,await discover(config));
}
/** Revalida a presença na conta a cada operação; IDs arbitrários do cliente não autorizam acesso. */
async function requireDevice(config: Configuration, deviceId: unknown, list?: RemoteDevice[]) {
  if (!await isConnected(config)) throw new Error('Conecte primeiro a conta Tuya/Smart Life.');
  if (typeof deviceId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(deviceId)) throw new Error('ID do dispositivo inválido.');
  const device = (list || await discover(config)).find(item=>item.id===deviceId);
  if (!device) throw new Error('Dispositivo não pertence à conta vinculada ou seu acesso foi removido.');
  return device;
}
/** Consulta detalhes, especificações e estados reais; não reutiliza um valor antigo como leitura atual. */
async function inspect(config: Configuration, device: RemoteDevice) {
  const details = await get<RemoteDevice>(config,`/v1.0/devices/${device.id}`);
  const [specification,status] = await Promise.all([
    get<{status:TuyaSpecification[]}>(config,`/v1.1/devices/${device.id}/specifications`),
    get<TuyaStatus[]>(config,`/v1.0/devices/${device.id}/status`),
  ]);
  if (!Array.isArray(specification?.status) || !Array.isArray(status)) throw new Error('A Tuya não retornou especificações e estados válidos para este dispositivo.');
  const points = decodePoints(specification.status,status);
  return { ...publicDevice(details), points, checkedAt:new Date().toISOString(), energyAvailable:points.some(point=>point.kind==='energy'), message:points.some(point=>point.kind==='energy')?'Consulte a natureza do ponto de energia antes de habilitar a coleta.':'Este dispositivo não expõe medição de energia em unidade reconhecida pela API. Nenhum kWh foi inventado.' };
}
/** Disponibiliza telemetria sanitizada de um dispositivo que realmente pertence à conta. */
export async function inspectDevice(config: Configuration, id: unknown) { return inspect(config,await requireDevice(config,id)); }
/** Serializa sincronizações e edições para não atribuir energia a dois ambientes simultaneamente. */
async function locked<T>(config: Configuration, operation: () => Promise<T>): Promise<T> {
  const db=getDatabase(), token=crypto.randomUUID(), now=Date.now();
  const lock=await db.prepare('INSERT INTO tuya_locks(user_id,token,expires_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE tuya_locks.expires_at<?').bind(config.userId,token,now+3600000,now).run();
  if (!lock.meta.changes) throw new Error('Já existe uma operação Tuya em andamento. Aguarde e tente novamente.');
  try { return await operation(); }
  finally { await db.prepare('DELETE FROM tuya_locks WHERE user_id=? AND token=?').bind(config.userId,token).run(); }
}
/** Salva ambiente, circuito e a semântica explicitamente confirmada do ponto de energia real. */
export async function saveMapping(config: Configuration, input: Record<string,unknown>) {
  return locked(config,async () => {
    const device=await requireDevice(config,input.deviceId);
    if (typeof input.room!=='string'||!roomIds.includes(input.room)||typeof input.circuit!=='string'||!circuitNames.includes(input.circuit)) throw new Error('Selecione um ambiente e circuito válidos.');
    if (!['none','cumulative','incremental'].includes(String(input.energyMode))) throw new Error('Tipo de energia inválido.');
    let code: string | null=null;
    if (input.energyMode!=='none') {
      const snapshot=await inspect(config,device);
      const point=snapshot.points.find(item=>item.code===input.energyCode && item.kind==='energy' && item.scale!==null);
      if (!point) throw new Error('Selecione um ponto de energia com unidade e escala fornecidas pela API.');
      if (point.code==='add_ele' && input.energyMode!=='incremental') throw new Error('add_ele é incremental; não pode ser tratado como contador acumulado.');
      if (input.confirmed!==true) throw new Error('Confirme o significado do ponto de energia conforme o fabricante.');
      code=point.code;
    }
    const key=await accountKey(config), db=getDatabase();
    const previous=await db.prepare('SELECT * FROM tuya_mappings WHERE user_id=? AND device_id=?').bind(config.userId,device.id).first<Mapping>();
    const same=previous && previous.account_key===key && previous.room===input.room && previous.circuit===input.circuit && previous.energy_code===code && previous.energy_mode===input.energyMode;
    await db.prepare('INSERT INTO tuya_mappings(user_id,device_id,account_key,room,circuit,energy_code,energy_mode,since,last_log_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,device_id) DO UPDATE SET account_key=excluded.account_key,room=excluded.room,circuit=excluded.circuit,energy_code=excluded.energy_code,energy_mode=excluded.energy_mode,since=excluded.since,last_log_at=excluded.last_log_at').bind(config.userId,device.id,key,input.room,input.circuit,code,String(input.energyMode),same?previous.since:Date.now(),same?previous.last_log_at:0).run();
    return { saved:true, message:'Associação salva. Registros anteriores foram preservados; mudanças passam a valer a partir de agora.' };
  });
}
/** Converte um instante real do provedor para a data civil usada pelo dashboard. */
function localDate(timestamp: number) { return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date(timestamp)); }

/** Importa eventos incrementais reportados (tipo 7), com deduplicação no banco e paginação oficial. */
async function collectIncremental(config: Configuration, mapping: Mapping, point: ReturnType<typeof decodePoint>) {
  const now=Date.now(), start=Math.max(mapping.since,mapping.last_log_at-60000,now-7*86400000);
  let cursor='', lastEvent='', imported=0;
  const seen=new Set<string>();
  for (let page=0;page<50;page++) {
    const result=await get<{logs:{code:string;value:unknown;event_time:unknown;event_id?:unknown;row?:string;status?:string}[];has_next:boolean;next_row_key?:string}>(config,`/v1.0/devices/${mapping.device_id}/logs`,{type:'7',codes:mapping.energy_code!,start_time:String(start),end_time:String(now),size:'100',...(cursor?{start_row_key:cursor,last_row_key:cursor,...(lastEvent?{last_event_time:lastEvent}:{})}:{})});
    if (!Array.isArray(result?.logs)) throw new Error('A API não retornou eventos de energia válidos. Nenhum valor de status foi somado.');
    for (const event of result.logs) {
      const time=numericValue(event.event_time);
      if (event.code!==mapping.energy_code || (event.event_id!==undefined && Number(event.event_id)!==7) || (event.status!==undefined && String(event.status)!=='1')) continue;
      if (time===null || !Number.isInteger(time) || time<start || time>now) continue;
      const converted=decodePoint({code:point.code,type:point.type,values:JSON.stringify({scale:point.scale,unit:point.unit})},event.value).normalized;
      if (converted===null || converted<0 || converted>10000) throw new Error('Evento de energia inválido; não foi convertido em consumo.');
      const eventKey=await digest(`${mapping.account_key}|${point.code}|${event.row || `${time}|${String(event.value)}`}`);
      const saved=await getDatabase().prepare('INSERT OR IGNORE INTO tuya_energy_events(user_id,device_id,event_key,date,room,circuit,kwh,event_time) VALUES(?,?,?,?,?,?,?,?)').bind(config.userId,mapping.device_id,eventKey,localDate(time),mapping.room,mapping.circuit,converted,time).run();
      imported+=saved.meta.changes || 0;
    }
    if (!result.has_next) {
      await getDatabase().prepare('UPDATE tuya_mappings SET last_log_at=? WHERE user_id=? AND device_id=?').bind(now,config.userId,mapping.device_id).run();
      return `${imported} evento(s) novo(s) de energia importado(s). Cobertura limitada aos eventos disponíveis desde a associação (até 7 dias por consulta).`;
    }
    const next=result.next_row_key || result.logs.at(-1)?.row;
    if (!next || seen.has(next)) throw new Error('A Tuya não disponibilizou uma próxima página válida; importação parcial preservada sem duplicar eventos.');
    seen.add(next); cursor=next; lastEvent=String(result.logs.at(-1)?.event_time || '');
  }
  throw new Error('Limite de páginas atingido. Os eventos já importados foram preservados; sincronize novamente.');
}
/** Alimenta as tabelas automáticas existentes com energia real, nunca com potência estimada ou valores ausentes. */
export async function synchronize(config: Configuration) {
  return locked(config,async () => {
    if (!await isConnected(config)) throw new Error('Conecte a conta primeiro.');
    const list=await discover(config), key=await accountKey(config), db=getDatabase();
    const mappings=(await db.prepare('SELECT * FROM tuya_mappings WHERE user_id=? AND account_key=?').bind(config.userId,key).all<Mapping>()).results;
    const results=[];
    for (const mapping of mappings) {
      let name=list.find(device=>device.id===mapping.device_id)?.name || mapping.device_id;
      try {
        const device=await requireDevice(config,mapping.device_id,list), snapshot=await inspect(config,device);
        name=snapshot.name || name;
        if (mapping.energy_mode==='none') { results.push({id:device.id,name,message:'Ambiente associado; coleta de energia não habilitada.',snapshot}); continue; }
        const point=snapshot.points.find(item=>item.code===mapping.energy_code && item.kind==='energy');
        if (!point || point.scale===null) throw new Error('O ponto de energia não está disponível com unidade/escala válida.');
        if (mapping.energy_mode==='incremental') {
          results.push({id:device.id,name,message:await collectIncremental(config,mapping,point),snapshot}); continue;
        }
        if (snapshot.online!==true) throw new Error('Dispositivo offline ou status online desconhecido; nenhum contador foi atualizado.');
        if (point.normalized===null || point.normalized<0) throw new Error('Contador sem leitura válida.');
        const date=localDate(Date.now()), fingerprint=JSON.stringify([key,mapping.room,mapping.circuit,mapping.energy_code,point.scale,point.unit,mapping.since]);
        const previous=await db.prepare('SELECT total,date,mapping FROM tuya_counters WHERE user_id=? AND device_id=?').bind(config.userId,device.id).first<{total:number;date:string;mapping:string}>();
        const {continuous,delta}=counterDelta(previous,point.normalized,date,fingerprint);
        if (delta>10000) throw new Error('Variação acima de 10.000 kWh; confira o ponto selecionado.');
        const statements=[db.prepare('INSERT INTO tuya_counters(user_id,device_id,total,date,mapping,checked_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,device_id) DO UPDATE SET total=excluded.total,date=excluded.date,mapping=excluded.mapping,checked_at=excluded.checked_at').bind(config.userId,device.id,point.normalized,date,fingerprint,new Date().toISOString())];
        // Contador e delta são gravados na mesma transação; dia sem leitura não vira zero.
        if (delta>0) statements.push(db.prepare('INSERT INTO tuya_readings(id,user_id,device_id,date,room,circuit,kwh) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,device_id,date,room,circuit) DO UPDATE SET kwh=tuya_readings.kwh+excluded.kwh').bind(crypto.randomUUID(),config.userId,device.id,date,mapping.room,mapping.circuit,delta));
        await db.batch(statements);
        results.push({id:device.id,name,message:continuous?`Atualizado: +${delta.toFixed(6)} kWh.`:'Referência registrada. A próxima diferença no mesmo dia alimentará o dashboard.',snapshot});
      } catch (error) { results.push({id:mapping.device_id,name,error:true,message:error instanceof Error?error.message:'Falha na consulta real.'}); }
    }
    return { devices:results, message:mappings.length?'Consulta real concluída. Confira avisos por dispositivo; o consumo representa somente intervalos ou eventos disponíveis.':'Associe um dispositivo a ambiente e circuito para habilitar a coleta.' };
  });
}
