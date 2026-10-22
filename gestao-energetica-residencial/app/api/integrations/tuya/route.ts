import { isConnected, listDevices, inspectDevice, saveMapping } from '@/lib/tuya';
import { beginAuthorization, isAdmin, oauthReady, userConfiguration } from '@/lib/tuya-authorization';
import { collectionStatus, requestCollection, runCollection } from '@/lib/tuya-collection';
export const dynamic = 'force-dynamic';

/** Cria respostas privadas; o usuário final não recebe configurações técnicas ou segredos. */
function json(body:unknown,status=200) { return Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}}); }
/** Mostra o vínculo do próprio usuário, a última coleta e a disponibilidade do consentimento oficial. */
export async function GET(request:Request) {
  const user=request.headers.get('oai-authenticated-user-id');
  if (!user) return json({error:'Entre na sua conta local.'},401);
  let connected=false;
  try { connected=await isConnected(await userConfiguration(user)); } catch { /* Configuração privada ausente não é exibida ao usuário final. */ }
  const canConnect=oauthReady();
  return json({configured:canConnect||connected,canConnect,connected,admin:isAdmin(user),devices:[],collection:await collectionStatus(user),message:connected?'Conta conectada. Seus dados são coletados pelo servidor a cada 12 horas.':canConnect?'Conecte e autorize sua conta Tuya/Smart Life.':'Integração indisponível. Solicite a configuração ao administrador.'});
}
/** Permite consentimento e ações apenas sobre a conta autorizada do próprio usuário. */
export async function POST(request:Request) {
  const user=request.headers.get('oai-authenticated-user-id');
  if (!user) return json({error:'Entre na sua conta local.'},401);
  const origin=request.headers.get('origin');
  if (request.headers.get('sec-fetch-site')==='cross-site' || (origin && origin!==new URL(request.url).origin)) return json({error:'Origem inválida.'},403);
  if (!request.headers.get('content-type')?.includes('application/json')) return json({error:'Envie JSON.'},415);
  let input:Record<string,unknown>;
  try { const value:unknown=await request.json(); if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error(); input=value as Record<string,unknown>; }
  catch { return json({error:'Solicitação inválida.'},400); }
  if (!['connect','discover','inspect','mapping','sync'].includes(String(input.action))) return json({error:'Ação inválida.'},400);
  try {
    if (input.action==='connect') return await beginAuthorization(request,user);
    const config=await userConfiguration(user);
    switch(input.action) {
      case 'discover': return json(await listDevices(config));
      case 'inspect': return json({device:await inspectDevice(config,input.deviceId)});
      case 'mapping': { const result=await saveMapping(config,input); await requestCollection(user); return json(result); }
      case 'sync': return json(await runCollection(user));
    }
  } catch { return json({error:'Não foi possível concluir. Verifique a autorização da sua conta ou contate o administrador.'},503); }
  return json({error:'Ação inválida.'},400);
}
