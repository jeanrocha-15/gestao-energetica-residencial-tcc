import { env } from 'cloudflare:workers';
import { getDatabase } from '@/db';
import { isAdmin, oauthMissing, oauthReady, oauthConfiguration } from '@/lib/tuya-authorization';
import { armCollector } from '@/lib/tuya-collection';

/** Entrega informações técnicas somente depois da autorização de administrador no servidor. */
export async function adminTuya(request:Request,userId:string) {
  if (!isAdmin(userId)) return new Response('Acesso restrito ao administrador.',{status:403});
  if (request.method==='POST') {
    if (request.headers.get('sec-fetch-site')==='cross-site' || request.headers.get('origin')!==new URL(request.url).origin || !request.headers.get('content-type')?.includes('application/json')) return new Response('Origem inválida.',{status:403});
    const body=await request.json() as {action?:string};
    if (body.action!=='collect') return new Response('Ação inválida.',{status:400});
    // Solicita a execução ao backend; sair da página não cancela a coleta.
    await getDatabase().prepare('INSERT INTO tuya_sync_state(user_id,next_run_at) SELECT user_id,0 FROM tuya_connections WHERE 1 ON CONFLICT(user_id) DO UPDATE SET next_run_at=0').run();
    await armCollector();
    return Response.json({message:'Coleta solicitada ao backend. Ela começará em até um minuto, mesmo com esta página fechada.'},{headers:{'Cache-Control':'no-store'}});
  }
  if (request.method!=='GET') return new Response('Método inválido.',{status:405});
  const collector=env.TUYA_COLLECTOR?await (await env.TUYA_COLLECTOR.get(env.TUYA_COLLECTOR.idFromName('tuya-12h')).fetch('http://collector/status')).json():null;
  const jobs=await getDatabase().prepare('SELECT user_id,last_attempt_at,last_success_at,next_run_at,status,message FROM tuya_sync_state').all();
  let configurationIssue:string|null=null;
  try { oauthConfiguration(userId); } catch (error) { configurationIssue=error instanceof Error?error.message:'Configuração inválida.'; }
  return Response.json({oauthReady:oauthReady(),missing:oauthMissing(),configurationIssue,collector,jobs:jobs.results},{headers:{'Cache-Control':'no-store'}});
}

/** Página restrita com diagnóstico e instruções; segredos continuam exclusivos do arquivo privado no servidor. */
export function adminTuyaHtml() {
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Administração Tuya</title><style>body{font:16px system-ui;max-width:900px;margin:30px auto;padding:20px;background:#f4f7f6;color:#203348}code,pre{overflow-wrap:anywhere;white-space:pre-wrap}button{padding:12px;margin:10px 0}li{margin:12px 0}</style><h1>Desenvolvedor / administrador — Tuya</h1><a href="/configuracoes">Voltar ao sistema</a><p>Esta página e sua API exigem o administrador definido no servidor. As contas registradas normalmente são usuários finais.</p><ol><li>Defina <code>LOCAL_ADMIN_USER_ID</code> com o ID da sua conta local.</li><li>Na Tuya, habilite <strong>Configure OAuth 2.0 Authorization</strong> em Devices → Link App Account e use a chave específica de App Authorization.</li><li>Configure exclusivamente no <code>.dev.vars</code> do servidor: <code>TUYA_OAUTH_CLIENT_ID</code>, <code>TUYA_OAUTH_CLIENT_SECRET</code>, <code>TUYA_OAUTH_IDENTIFIER</code>, <code>TUYA_OAUTH_AUTHORIZE_URL</code>, <code>TUYA_OAUTH_REDIRECT_URI</code>, <code>TUYA_ENDPOINT</code> e <code>TUYA_TOKEN_KEY</code> (32 bytes aleatórios em hexadecimal).</li><li>Cadastre o retorno <code>http://127.0.0.1:5173/api/integrations/tuya/callback</code> na Tuya e use esse mesmo endereço local no navegador. Copie a URL H5 oficial fornecida na configuração OAuth. O UID é obtido automaticamente na autorização, sem preenchimento pelo usuário.</li><li>Reinicie <code>pnpm dev</code>. Preserve a chave de cifragem para conseguir renovar os tokens salvos. Credenciais antigas continuam privadas e atendem apenas ao vínculo legado.</li></ol><p>A coleta roda no backend a cada 12 horas; o computador e o servidor local precisam permanecer ligados. Após editar código, reinicie o servidor para reativar os alarmes locais. Consulte INTEGRACAO-TUYA.md para permissões e limitações do retorno local.</p><button id="collect">Solicitar coleta agora no backend</button><button id="refresh">Atualizar diagnóstico</button><p id="message" role="status"></p><pre id="diagnostic"></pre><script>
/** Carrega o diagnóstico restrito sem apresentar valores de credenciais. */
async function refresh(){const r=await fetch('/api/admin/tuya',{cache:'no-store'});document.getElementById('diagnostic').textContent=JSON.stringify(await r.json(),null,2);}
/** Enfileira coleta real; o alarme continua depois de fechar a página. */
document.getElementById('collect').onclick=async()=>{const r=await fetch('/api/admin/tuya',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'collect'})});const d=await r.json();document.getElementById('message').textContent=d.message||'Falha ao solicitar coleta.';await refresh();};
document.getElementById('refresh').onclick=refresh;refresh();</script></html>`;
}
