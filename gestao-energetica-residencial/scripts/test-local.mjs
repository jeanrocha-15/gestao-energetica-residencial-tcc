import './sites-env.mjs';
import './test-tuya-values.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID,randomBytes } from 'node:crypto';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { estimateCost, flagPerKwh, tariffForDate } from '../public/energy-cost.js';

const cli = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const common = ['--config', 'wrangler.local.json', '--persist-to', '.wrangler/test-state'];
const base = 'http://127.0.0.1:5174';
let server, output = '',adminId='',oauthSetup=false;
// Chaves sem conta remota, usadas somente para validar início/cancelamento e segurança local do protocolo.
const oauthTestValues={TUYA_OAUTH_CLIENT_ID:'test-'+randomUUID(),TUYA_OAUTH_CLIENT_SECRET:randomUUID(),TUYA_OAUTH_IDENTIFIER:'test.local',TUYA_OAUTH_AUTHORIZE_URL:'https://auth.tuya.com/?app_schema=test',TUYA_OAUTH_REDIRECT_URI:base+'/api/integrations/tuya/callback',TUYA_ENDPOINT:'https://openapi.tuyaus.com',TUYA_TOKEN_KEY:randomBytes(32).toString('hex')};
/** Executa os comandos exclusivamente no banco isolado dos testes. */
async function migrate() {
  const child = spawn(process.execPath, [cli, 'd1', 'migrations', 'apply', 'DB', '--local', ...common], { stdio: 'pipe', env: { ...process.env, CI:'true' } });
  let log = ''; child.stdout.on('data', chunk => log += chunk); child.stderr.on('data', chunk => log += chunk);
  const [code] = await once(child, 'exit'); assert.equal(code, 0, log);
}
/** Testa o trigger no D1 isolado, sem fingir conexão com aparelhos ou alterar o banco de uso. */
async function testEnergyPersistence() {
  const owner='test-'+randomUUID();
  const event=`INSERT OR IGNORE INTO tuya_energy_events(user_id,device_id,event_key,date,room,circuit,kwh,event_time) VALUES('${owner}','test-device','event-1','2026-09-29','sala','Iluminação',0.25,1790700000000);`;
  const sql=event+event+event.replaceAll('event-1','event-2')+
    `SELECT COUNT(*) AS count,SUM(kwh) AS kwh FROM tuya_readings WHERE user_id='${owner}';`+
    `SELECT COUNT(*) AS count FROM tuya_energy_events WHERE user_id='${owner}';`+
    `DELETE FROM tuya_energy_events WHERE user_id='${owner}'; DELETE FROM tuya_readings WHERE user_id='${owner}';`;
  const child=spawn(process.execPath,[cli,'d1','execute','DB','--local',...common,'--json','--command',sql],{stdio:'pipe',env:{...process.env,CI:'true'}});
  let stdout='',stderr=''; child.stdout.on('data',chunk=>stdout+=chunk); child.stderr.on('data',chunk=>stderr+=chunk);
  const [code]=await once(child,'exit'); assert.equal(code,0,stderr);
  const result=JSON.parse(stdout);
  assert.deepEqual(result[3].results,[{count:1,kwh:0.5}]);
  assert.deepEqual(result[4].results,[{count:2}]);
  console.log('OK: D1 real isolado soma eventos distintos e ignora reenvios sem duplicar energia.');
}
/** Consulta apenas o D1 de testes para verificar o coletor sem abrir página ou disparar a API de coleta. */
async function testSql(sql) {
  const child=spawn(process.execPath,[cli,'d1','execute','DB','--local',...common,'--json','--command',sql],{stdio:'pipe',env:{...process.env,CI:'true'}});
  let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
  const [code]=await once(child,'exit');assert.equal(code,0,stderr);return JSON.parse(stdout);
}
/** Espera uma condição observável por tempo limitado, sem assumir que o servidor já iniciou. */
async function until(condition, message, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(message + '\n' + output.slice(-5000));
}
/** Inicia a API real em porta separada e espera o endpoint de login responder. */
async function start() {
  output = '';
  server = spawn(process.execPath, [cli, 'dev', '--name', 'gestao-energetica-test', '--local', '--ip', '127.0.0.1', '--port', '5174', '--inspector-port', '9235', ...common,...(adminId?['--var','LOCAL_ADMIN_USER_ID:'+adminId]:[]),...(oauthSetup?Object.entries(oauthTestValues).flatMap(([key,value])=>['--var',key+':'+value]):[])], { stdio:'pipe', env:{ ...process.env, CI:'true' } });
  server.stdout.on('data', chunk => output += chunk); server.stderr.on('data', chunk => output += chunk);
  await until(async () => { try { return (await fetch(base + '/login')).status === 200; } catch { return false; } }, 'Servidor de teste não iniciou.');
}
/** Encerra somente a árvore de processos criada pelo teste, inclusive workerd no Windows. */
async function stop() {
  if (!server || server.exitCode !== null) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio:'ignore' });
    await once(killer, 'exit');
  } else { server.kill('SIGTERM'); await once(server, 'exit'); }
}
/** Faz chamadas autenticadas e valida o código HTTP sem imprimir senha ou cookie. */
async function api(path, method = 'GET', body, cookie = '', status = 200, extra = {}) {
  const response = await fetch(base + path, { method, headers:{ 'Content-Type':'application/json', Cookie:cookie, ...extra }, body:body === undefined ? undefined : JSON.stringify(body), redirect:'manual' });
  const text = await response.text();
  assert.ok(response.headers.get('content-type')?.includes('application/json'), `${method} ${path}: ${response.status} ${text}`);
  const data = JSON.parse(text);
  assert.equal(response.status, status, JSON.stringify(data));
  return { data, cookie:response.headers.get('set-cookie')?.split(';')[0] };
}
/** Executa os módulos reais da interface em DOM de teste e envia suas requisições para a API real. */
async function testInterface(cookie) {
  const html = await (await fetch(base + '/', { headers:{ Cookie:cookie } })).text();
  const { window, document } = parseHTML(html);
  let path = '/';
  const location = { get pathname(){ return path; }, assign(value){ path = value; } };
  const history = { pushState(_state, _title, value){ path = value; } };
  // O DOM de teste não implementa diálogos e layout visual; estes métodos simulam apenas abertura e fechamento.
  window.HTMLElement.prototype.showModal = function(){ this.setAttribute('open', ''); };
  window.HTMLElement.prototype.close = function(){ this.removeAttribute('open'); };
  const context = vm.createContext({ document, window, location, history, console, crypto:globalThis.crypto, Intl, Date, URL, setInterval:()=>0, AbortController, confirm:()=>true, estimateCost, tariffForDate, flagPerKwh,
    fetch:(url, options={}) => fetch(base + url, { ...options, headers:{ ...options.headers, Cookie:cookie } }) });
  window.scrollTo = () => {};
  const pageModule = readFileSync(new URL('../public/local-pages.js', import.meta.url), 'utf8').replace(/^import .*;$/m, '').replaceAll('export ', '');
  vm.runInContext(pageModule, context);
  // Carrega o módulo real da Tuya; nenhuma resposta da nuvem é simulada neste teste.
  vm.runInContext(readFileSync(new URL('../public/tuya-integration.js', import.meta.url), 'utf8').replaceAll('export ', ''), context);
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*;$/gm, '');
  vm.runInContext(script, context);
  await until(() => document.getElementById('load-status').textContent === 'Medições carregadas.' && document.getElementById('tariff-list').children.length === 2, 'Interface não carregou dados.');
  const sidebar = document.querySelector('.side');
  for (const route of ['/medicoes','/historico','/comparacao','/tarifas','/configuracoes','/']) {
    const link = document.querySelector(`.side nav a[href="${route}"]`);
    const event = new window.Event('click', { bubbles:true }); event.button = 0;
    link.dispatchEvent(event);
    assert.equal(location.pathname, route); assert.equal(document.querySelector('.side'), sidebar); assert.equal(link.getAttribute('aria-current'), 'page');
    for (const section of document.querySelectorAll('[data-pages]')) assert.equal(section.hidden, !section.dataset.pages.split(',').includes(route));
  }
  assert.match(document.getElementById('kpi-cost').textContent, /26,25/);
  assert.match(document.getElementById('cost-parts').textContent, /TE.*TUSD.*Bandeira.*PIS.*COFINS.*ICMS/s);
  document.querySelector('[data-metric="cost"]').click();
  assert.match(document.getElementById('history-total').textContent, /26,25/);
  document.querySelector('[data-source="demo"]').click();
  for (const period of [7,30,90]) {
    document.querySelector(`[data-period="${period}"]`).click();
    assert.equal(document.querySelector(`[data-period="${period}"]`).getAttribute('aria-pressed'), 'true');
  }
  assert.match(document.getElementById('kpi-cost').textContent, /Sem tarifa/);
  assert.match(document.getElementById('chart').textContent, /Sem tarifa válida/);
  document.querySelector('[data-metric="energy"]').click();
  assert.ok(document.querySelector('#chart rect'));
  document.querySelector('[data-chart="line"]').click();
  assert.ok(document.querySelector('#chart .chart-line'));
  document.querySelector('[data-group="circuits"]').click();
  assert.match(document.getElementById('compare-sub').textContent, /circuito/);
  // Verifica as explicações sem depender de um mouse real ou do layout visual do navegador.
  const helpButtons = document.querySelectorAll('#tariff-form .help-button');
  assert.equal(helpButtons.length, 8);
  for (const button of helpButtons) {
    const tip = document.getElementById(button.getAttribute('aria-controls'));
    assert.equal(tip.hidden, true);
    button.click(); assert.equal(tip.hidden, false); assert.equal(button.getAttribute('aria-expanded'), 'true');
    button.click(); assert.equal(tip.hidden, true);
    button.parentElement.dispatchEvent(new window.Event('mouseenter')); assert.equal(tip.hidden, false);
    button.parentElement.dispatchEvent(new window.Event('mouseleave')); assert.equal(tip.hidden, true);
    button.parentElement.dispatchEvent(new window.Event('focusin')); assert.equal(tip.hidden, false);
    const escape = new window.Event('keydown', { bubbles:true }); escape.key = 'Escape';
    button.dispatchEvent(escape); assert.equal(tip.hidden, true);
  }
  assert.ok(!html.includes('IS-M1108'));
  assert.equal(document.getElementById('connect-tuya').textContent, 'Dispositivos inteligentes');
  document.getElementById('connect-tuya').click();
  await until(() => document.getElementById('devices-list').children.length === 1, 'Cadastro de dispositivos não carregou.');
  assert.match(document.getElementById('devices-list').textContent, /Fabricante independente/);
  assert.match(document.getElementById('devices-list').textContent, /Integração não configurada/);
  assert.equal(document.getElementById('tuya-integration').hidden, false);
  assert.equal(document.getElementById('tuya-connect').textContent, 'Conectar Tuya/Smart Life');
  assert.doesNotMatch(document.getElementById('tuya-integration').textContent,/Access ID|Access Secret|\.dev.vars|TUYA_|endpoint|UID/);
  assert.match(document.getElementById('tuya-last-update').textContent,/Última atualização/);
  console.log('OK: ajudas por clique/hover/teclado, dispositivos genéricos e ausência de integração fictícia.');
  console.log('OK: rotas, menu persistente, filtros 7/30/90, gráficos, comparação, custos e ausência de tarifa no DOM.');
}

try {
  await migrate(); await testEnergyPersistence(); await start();
  await api('/api/readings', 'GET', undefined, '', 401, { 'oai-authenticated-user-id':'forjado' });
  const password = randomUUID(), email = `${randomUUID()}@test.local`;
  const first = await api('/api/auth/register', 'POST', { email, password }); const cookie = first.cookie;
  // Verifica autenticação e falhas reais de configuração sem chamar ou simular a nuvem Tuya.
  await api('/api/integrations/tuya','GET',undefined,'',401);
  await api('/api/integrations/tuya','POST',{action:'sync'},'',401);
  await api('/api/integrations/tuya','POST',{action:'sync'},cookie,403,{Origin:'https://invalid.test'});
  await api('/api/integrations/tuya','POST',{action:'invalid'},cookie,400);
  const tuyaResponse=await fetch(base+'/api/integrations/tuya',{headers:{Cookie:cookie}});
  assert.ok([200,403].includes(tuyaResponse.status));
  if (tuyaResponse.status===200) {
    const integration=await tuyaResponse.json();
    if (!integration.configured) {
      assert.equal(integration.connected,false);
      assert.deepEqual(integration.devices,[]);
      await api('/api/integrations/tuya','POST',{action:'connect'},cookie,503);
    }
  }
  await api('/api/auth/login', 'POST', { email, password:'incorreta' }, '', 401);
  const login = await api('/api/auth/login', 'POST', { email, password }); assert.ok(login.cookie);
  const second = await api('/api/auth/register', 'POST', { email:`${randomUUID()}@test.local`, password:randomUUID() });
  // Cadastro comum e cabeçalhos forjados não concedem acesso administrativo.
  for (const path of ['/admin/tuya','/api/admin/tuya']) {
    assert.equal((await fetch(base+path,{headers:{Cookie:cookie,'oai-authenticated-user-id':'admin'}})).status,403);
    assert.equal((await fetch(base+path,{headers:{Cookie:second.cookie}})).status,403);
  }
  const deniedCallback=await fetch(base+'/api/integrations/tuya/callback?code=invalid&state=invalid',{redirect:'manual'});
  assert.equal(deniedCallback.status,200);assert.match(await deniedCallback.text(),/tuya=error/);
  adminId=(await api('/api/auth/me','GET',undefined,cookie)).data.id;
  await stop();await start();
  assert.equal((await fetch(base+'/admin/tuya',{headers:{Cookie:cookie}})).status,200);
  assert.equal((await fetch(base+'/api/admin/tuya',{headers:{Cookie:second.cookie}})).status,403);
  const adminStatus=(await api('/api/admin/tuya','GET',undefined,cookie)).data;
  assert.equal(adminStatus.collector.intervalHours,12);
  const secondaryId=(await api('/api/auth/me','GET',undefined,second.cookie)).data.id;
  // Fixture apenas de banco: conta sem credenciais deve registrar falha real, nunca sucesso de nuvem fictício.
  await testSql(`INSERT INTO tuya_connections(user_id,account_key,connected_at) VALUES('${secondaryId}','unconfigured-test','2026-09-29');`);
  await api('/api/admin/tuya','POST',{action:'collect'},cookie,200,{Origin:base});
  let job;
  await until(async()=>{
    job=(await testSql(`SELECT * FROM tuya_sync_state WHERE user_id='${secondaryId}';`))[0].results[0];
    return job?.status==='error';
  },'Alarme do backend não executou sem página aberta.',90000);
  assert.equal(job.last_success_at,null);
  assert.equal(job.next_run_at-job.last_attempt_at,12*60*60*1000);
  const attempt=job.last_attempt_at;
  await stop();await start();
  const persisted=(await api('/api/integrations/tuya','GET',undefined,second.cookie)).data;
  assert.equal(persisted.collection.lastAttemptAt,attempt);
  assert.equal(persisted.collection.lastSuccessAt,null);
  assert.equal(persisted.admin,false);
  assert.ok(!('missing' in persisted));
  await testSql(`DELETE FROM tuya_connections WHERE user_id='${secondaryId}'; DELETE FROM tuya_sync_state WHERE user_id='${secondaryId}';`);
  console.log('OK: admin restrito, callback inválido rejeitado, alarme sem navegador, intervalo de 12 horas e agenda persistida.');
  oauthSetup=true;await stop();await start();
  const consent=await api('/api/integrations/tuya','POST',{action:'connect'},second.cookie,200,{Origin:base});
  const redirect=new URL(consent.data.authorizationUrl),state=redirect.searchParams.get('state');
  assert.equal(redirect.origin,'https://auth.tuya.com');
  assert.equal(redirect.searchParams.get('client_id'),oauthTestValues.TUYA_OAUTH_CLIENT_ID);
  assert.equal(redirect.searchParams.get('redirect_uri'),base+'/api/integrations/tuya/callback');
  assert.equal(redirect.searchParams.get('app_schema'),'test');
  assert.ok(state && /^[a-f0-9-]{72}$/.test(state));
  assert.ok(!consent.data.authorizationUrl.includes(oauthTestValues.TUYA_OAUTH_CLIENT_SECRET));
  const pending=(await testSql(`SELECT state_hash,user_id FROM tuya_oauth_states WHERE user_id='${secondaryId}';`))[0].results;
  assert.equal(pending.length,1);assert.notEqual(pending[0].state_hash,state);
  // Cookie de outro navegador não aceita a autorização e não consome o estado válido.
  const wrongCookie=await fetch(base+'/api/integrations/tuya/callback?state='+state+'&error=access_denied',{headers:{Cookie:cookie}});
  assert.match(await wrongCookie.text(),/tuya=error/);
  assert.equal((await testSql(`SELECT COUNT(*) AS count FROM tuya_oauth_states WHERE user_id='${secondaryId}';`))[0].results[0].count,1);
  const cancelled=await fetch(base+'/api/integrations/tuya/callback?state='+state+'&error=access_denied',{headers:{Cookie:consent.cookie}});
  assert.match(await cancelled.text(),/tuya=error/);
  assert.equal((await testSql(`SELECT COUNT(*) AS count FROM tuya_oauth_states WHERE user_id='${secondaryId}';`))[0].results[0].count,0);
  // Reutilização falha antes de qualquer chamada de token à nuvem.
  const replay=await fetch(base+'/api/integrations/tuya/callback?state='+state+'&code=invalid',{headers:{Cookie:consent.cookie}});
  assert.match(await replay.text(),/tuya=error/);
  const afterCancel=(await api('/api/integrations/tuya','GET',undefined,second.cookie)).data;
  assert.equal(afterCancel.connected,false);assert.equal(afterCancel.canConnect,true);
  assert.equal((await testSql(`SELECT COUNT(*) AS count FROM tuya_oauth_accounts WHERE user_id='${secondaryId}';`))[0].results[0].count,0);
  console.log('OK: início OAuth, estado privado vinculado ao usuário, cancelamento e replay rejeitado; nenhuma resposta Tuya simulada.');
  // A origem declarada e um status enviado pelo cliente nunca devem simular uma conexão real.
  const device = { id:randomUUID(), name:'Medidor de teste', manufacturer:'Fabricante independente', model:'Modelo de teste', room:'Residência', circuit:'Quadro geral', identifier:'aparelho-local-01', dataSource:'API pretendida', integrationStatus:'Conectado' };
  await api('/api/devices','GET',undefined,'',401);
  const createdDevice = await api('/api/devices','POST',device,cookie,201);
  assert.equal(createdDevice.data.device.integrationStatus,'Integração não configurada');
  await api('/api/devices','PUT',{...device,name:'Medidor atualizado'},cookie);
  assert.equal((await api('/api/devices','GET',undefined,cookie)).data.devices[0].name,'Medidor atualizado');
  await api('/api/devices','POST',{...device,id:randomUUID(),manufacturer:''},cookie,400);
  await api('/api/devices','POST',{...device,id:randomUUID()},cookie,403,{Origin:'https://invalid.test'});
  assert.equal((await api('/api/devices','GET',undefined,second.cookie)).data.devices.length,0);
  await api('/api/devices','PUT',device,second.cookie,404);
  await api('/api/devices','DELETE',{id:device.id},second.cookie,404);
  for (const page of ['/','/medicoes','/historico','/comparacao','/tarifas','/configuracoes']) assert.equal((await fetch(base + page, { headers:{ Cookie:cookie } })).status, 200);
  const reading = { id:randomUUID(), date:'2026-09-01', room:'shared', circuit:'Tomadas gerais', kwh:10 };
  await api('/api/readings','POST',reading,cookie,201);
  await api('/api/readings','POST',{ ...reading,id:randomUUID() },cookie,409);
  await api('/api/readings','PUT',{ ...reading,kwh:12 },cookie);
  await api('/api/readings','PUT',reading,cookie);
  await api('/api/readings','POST',{ ...reading,id:randomUUID(),date:'2026-09-02' },cookie,201);
  const config = { te:0.3,tusd:0.5,pis:1,cofins:4,icms:20,flag:'Amarela',flagValue:10,flagUnit:'BRL_100_KWH',others:[{name:'Teste',value:0.1}],taxModel:'outside-v1' };
  const firstTariff = { id:randomUUID(),startDate:'2026-09-01',endDate:'2026-09-01',config };
  await api('/api/tariffs','POST',firstTariff,cookie,201);
  await api('/api/tariffs','POST',{...firstTariff,id:randomUUID()},cookie,409);
  await api('/api/tariffs','POST',{...firstTariff,id:randomUUID(),startDate:'2026-02-30'},cookie,400);
  await api('/api/tariffs','POST',{...firstTariff,id:randomUUID(),config:{...config,te:-1}},cookie,400);
  await api('/api/tariffs','POST',{...firstTariff,id:randomUUID()},cookie,403,{Origin:'https://invalid.test'});
  const nextTariff = { ...firstTariff,id:randomUUID(),startDate:'2026-09-02',endDate:'2026-09-02',config:{...config,flag:'Vermelha Patamar 1',flagValue:20} };
  await api('/api/tariffs','POST',nextTariff,cookie,201);
  for (const flag of ['Verde','Amarela','Vermelha Patamar 1','Vermelha Patamar 2']) await api('/api/tariffs','PUT',{...nextTariff,config:{...nextTariff.config,flag}},cookie);
  await api('/api/tariffs','PUT',nextTariff,cookie);
  await api('/api/tariffs','PUT',{...nextTariff,startDate:'2026-09-01'},cookie,409);
  const stored = (await api('/api/tariffs','GET',undefined,cookie)).data.tariffs;
  assert.deepEqual(stored.find(t=>t.id===firstTariff.id).config,config);
  assert.equal(flagPerKwh(config),0.1); assert.equal(flagPerKwh({...config,flagValue:0.1,flagUnit:'BRL_KWH'}),0.1);
  assert.equal(estimateCost(10,tariffForDate(stored,'2026-09-01')).total,12.5);
  assert.ok(Math.abs(estimateCost(10,tariffForDate(stored,'2026-09-02')).total-13.75)<1e-10);
  assert.equal(estimateCost(10,tariffForDate(stored,'2026-09-03')),null);
  assert.equal((await api('/api/readings','GET',undefined,second.cookie)).data.readings.length,0);
  assert.equal((await api('/api/tariffs','GET',undefined,second.cookie)).data.tariffs.length,0);
  await api('/api/tariffs','DELETE',{id:firstTariff.id},second.cookie,404);
  await api('/api/readings','PUT',reading,second.cookie,404);
  console.log('OK: autenticação, isolamento por usuário, CRUD, duplicatas, quatro bandeiras, conflitos, conversão e custos por data.');
  await testInterface(cookie);
  await stop(); await start();
  assert.equal((await api('/api/readings','GET',undefined,cookie)).data.readings.length,2);
  assert.equal((await api('/api/tariffs','GET',undefined,cookie)).data.tariffs.length,2);
  assert.equal((await api('/api/devices','GET',undefined,cookie)).data.devices[0].integrationStatus,'Integração não configurada');
  await api('/api/devices','DELETE',{id:device.id},cookie);
  assert.equal((await api('/api/devices','GET',undefined,cookie)).data.devices.length,0);
  console.log('OK: medições, tarifas e sessão persistem após reiniciar o servidor.');
  for (const record of (await api('/api/readings','GET',undefined,cookie)).data.readings) await api('/api/readings','DELETE',{id:record.id},cookie);
  for (const tariff of stored) await api('/api/tariffs','DELETE',{id:tariff.id},cookie);
  assert.equal((await api('/api/readings','GET',undefined,cookie)).data.readings.length,0);
  assert.equal((await api('/api/tariffs','GET',undefined,cookie)).data.tariffs.length,0);
  await api('/api/auth/logout','POST',undefined,cookie);
  await api('/api/readings','GET',undefined,cookie,401);
  console.log('OK: exclusão e encerramento de sessão. Todos os testes passaram.');
} catch (error) { await new Promise(resolve => setTimeout(resolve, 1000)); console.error(output.slice(-15000)); throw error; }
finally { await stop(); }
