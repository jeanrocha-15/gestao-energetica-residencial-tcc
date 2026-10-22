import { flagPerKwh } from './energy-cost.js';
export let tariffs = [];
let refreshDashboard;
const tariffHelp = {
  te: 'TE é o valor da energia consumida. Procure “Tarifa de Energia” ou “TE” no detalhamento da conta, em R$/kWh.',
  tusd: 'TUSD é o valor pelo uso da rede de distribuição. Procure “Uso do Sistema de Distribuição” ou “TUSD”, em R$/kWh.',
  pis: 'PIS é um tributo. Procure a alíquota (%) no quadro de tributos da conta; não confunda com o valor em reais.',
  cofins: 'COFINS é um tributo. Procure a alíquota (%) no quadro de tributos da conta; não confunda com o valor em reais.',
  icms: 'ICMS é um imposto estadual. Procure a alíquota (%) na seção de tributos ou informações fiscais da conta.',
  flag: 'Procure “Bandeira tarifária” na conta: verde, amarela ou vermelha (patamar 1 ou 2). Confira também o adicional e sua unidade.',
  validity: 'São as datas em que estes valores valem. Confira a vigência informada na conta ou no comunicado da distribuidora; não use a data de vencimento.',
};
let helpId = 0;
/** Cria ajuda acessível por clique, teclado e mouse, com texto independente do rótulo do campo. */
function helpButton(key) {
  if (!tariffHelp[key]) return '';
  const id = `tariff-help-${++helpId}`;
  return `<span class="tariff-help"><button type="button" class="help-button" aria-label="Ajuda: ${key === 'validity' ? 'vigência' : key === 'flag' ? 'bandeira' : key.toUpperCase()}" aria-expanded="false" aria-controls="${id}" aria-describedby="${id}">?</button><span class="help-text" id="${id}" role="tooltip" hidden>${tariffHelp[key]}</span></span>`;
}
/** Escapa conteúdo cadastrado antes de inseri-lo no HTML das tabelas. */
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
/** Envia configurações ao banco por API autenticada, apresentando erros de validação. */
async function request(method = 'GET', body) {
  const response = await fetch('/api/tariffs', { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
/** Recarrega as vigências persistidas e recalcula o painel sem localStorage. */
export async function loadTariffs() {
  try {
    tariffs = (await request()).tariffs;
    document.getElementById('tariff-status').textContent = tariffs.length ? `${tariffs.length} configurações salvas. Vigências inclusivas.` : 'Nenhuma tarifa cadastrada. Os custos ficam indisponíveis até cadastrar uma vigência.';
    renderTariffs();
  } catch (error) {
    tariffs = [];
    document.getElementById('tariff-status').textContent = error.message;
  }
  refreshDashboard();
}
/** Mostra histórico de configurações com comandos distintos para correção e nova vigência. */
function renderTariffs() {
  document.getElementById('tariff-list').innerHTML = tariffs.map(t => `<tr><td>${escape(t.startDate)} a ${escape(t.endDate)}</td><td>${escape(t.config.flag)}</td><td>${t.config.te.toFixed(6)}</td><td>${t.config.tusd.toFixed(6)}</td><td>${flagPerKwh(t.config).toFixed(6)}</td><td><button class="link-btn" data-tariff-edit="${t.id}">Editar</button><button class="link-btn" data-tariff-copy="${t.id}">Nova vigência / bandeira</button><button class="link-btn danger" data-tariff-delete="${t.id}">Excluir</button></td></tr>`).join('');
}
/** Cria os campos numéricos sem valores regulatórios presumidos. */
function numericField(name, label, max) {
  return `<div class="field"><span><label for="tariff-${name}">${label}</label> ${helpButton(name)}</span><input id="tariff-${name}" name="${name}" type="number" min="0" max="${max}" step="any" required></div>`;
}
/** Mostra ou oculta a dica, mantendo o estado acessível do botão sincronizado. */
function showHelp(wrapper, visible) {
  wrapper.querySelector('.help-text').hidden = !visible;
  wrapper.querySelector('button').setAttribute('aria-expanded', String(visible));
}
/** Permite consultar dicas por hover, foco ou clique; Escape fecha a explicação. */
function setupHelp() {
  for (const wrapper of document.querySelectorAll('.tariff-help')) {
    wrapper.addEventListener('mouseenter', () => showHelp(wrapper, true));
    wrapper.addEventListener('mouseleave', () => { if (wrapper.dataset.pinned !== 'true') showHelp(wrapper, false); });
    wrapper.addEventListener('focusin', () => showHelp(wrapper, true));
    wrapper.addEventListener('focusout', event => { if (!wrapper.contains(event.relatedTarget)) { wrapper.dataset.pinned = 'false'; showHelp(wrapper, false); } });
    wrapper.querySelector('button').addEventListener('click', () => {
      wrapper.dataset.pinned = String(wrapper.dataset.pinned !== 'true');
      showHelp(wrapper, wrapper.dataset.pinned === 'true');
    });
    wrapper.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); wrapper.dataset.pinned = 'false'; showHelp(wrapper, false); } });
  }
}

const deviceFields = [['name','Nome'],['manufacturer','Fabricante'],['model','Modelo'],['room','Cômodo ou abrangência'],['circuit','Circuito'],['identifier','Identificador do dispositivo'],['dataSource','Origem dos dados']];
let registeredDevices = [];
/** Consulta o cadastro genérico; nenhuma chamada deste cadastro conecta equipamentos. */
async function deviceRequest(method = 'GET', body) {
  const response = await fetch('/api/devices', { method, headers: { 'Content-Type':'application/json' }, body:body ? JSON.stringify(body) : undefined, cache:'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
/** Carrega os dispositivos do usuário e exibe o estado real de ausência de integração. */
async function loadDevices() {
  const status = document.getElementById('devices-status');
  status.textContent = 'Carregando dispositivos…';
  try {
    registeredDevices = (await deviceRequest()).devices;
    document.getElementById('devices-list').innerHTML = registeredDevices.map(device => `<article class="device-card"><h3>${escape(device.name)}</h3><dl>${deviceFields.slice(1).map(([key,label])=>`<div><dt>${label}</dt><dd>${escape(device[key])}</dd></div>`).join('')}<div><dt>Status da integração</dt><dd>${escape(device.integrationStatus)}</dd></div></dl><button type="button" class="link-btn" data-device-edit="${device.id}">Editar</button><button type="button" class="link-btn danger" data-device-delete="${device.id}">Excluir</button></article>`).join('');
    status.textContent = registeredDevices.length ? `${registeredDevices.length} dispositivo(s) cadastrado(s). Cadastro não inicia coleta automática.` : 'Nenhum dispositivo cadastrado. Integração não configurada.';
  } catch (error) { status.textContent = error.message; }
}
/** Preenche o formulário de metadados sem aceitar credenciais ou status de conexão inventados. */
function editDevice(id) {
  const form = document.getElementById('device-form'), device = registeredDevices.find(item => item.id === id);
  form.reset(); form.dataset.id = device?.id || crypto.randomUUID(); form.dataset.edit = String(Boolean(device));
  for (const [key] of deviceFields) form.elements.namedItem(key).value = device?.[key] || '';
  document.getElementById('device-form-title').textContent = device ? 'Editar dispositivo' : 'Cadastrar dispositivo';
  document.getElementById('device-error').textContent = '';
  form.hidden = false;
  form.elements.namedItem('name').focus();
}
/** Monta o cadastro genérico dentro da área existente de dispositivos inteligentes. */
function mountDevices() {
  document.getElementById('device-manager').innerHTML = `<button type="button" class="primary-btn" id="new-device">+ Cadastrar dispositivo</button><p id="devices-status" role="status"></p><form id="device-form" hidden><h3 id="device-form-title">Cadastrar dispositivo</h3><div class="form-grid">${deviceFields.map(([key,label])=>`<label class="field">${label}<input name="${key}" maxlength="160" required${key==='room'?' placeholder="Ex.: sala, residência ou equipamento"':key==='dataSource'?' placeholder="Ex.: leitura manual, arquivo ou API pretendida"':''}></label>`).join('')}<label class="field wide">Status da integração<input value="Integração não configurada" readonly></label></div><p>Informe apenas o código de identificação, nunca senha, token ou chave de acesso. A origem dos dados é descritiva e não configura uma conexão.</p><p id="device-error" class="status error" role="alert"></p><button type="submit" class="primary-btn" id="save-device">Salvar dispositivo</button> <button type="button" class="secondary-btn" id="cancel-device">Cancelar</button></form><div id="devices-list"></div>`;
  document.getElementById('new-device').addEventListener('click', () => editDevice());
  document.getElementById('cancel-device').addEventListener('click', () => { document.getElementById('device-form').hidden = true; });
  document.getElementById('device-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget, save = document.getElementById('save-device');
    if (save.disabled) return;
    save.disabled = true;
    try {
      const body = { id:form.dataset.id };
      for (const [key] of deviceFields) body[key] = form.elements.namedItem(key).value;
      await deviceRequest(form.dataset.edit === 'true' ? 'PUT' : 'POST', body);
      form.hidden = true; await loadDevices();
    } catch (error) { document.getElementById('device-error').textContent = error.message; }
    finally { save.disabled = false; }
  });
  document.getElementById('devices-list').addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.deviceEdit) editDevice(button.dataset.deviceEdit);
    if (button.dataset.deviceDelete && confirm('Excluir este cadastro de dispositivo? As medições existentes serão preservadas.')) {
      button.disabled = true;
      try { await deviceRequest('DELETE', { id:button.dataset.deviceDelete }); await loadDevices(); }
      catch (error) { document.getElementById('devices-status').textContent = error.message; button.disabled = false; }
    }
  });
  for (const id of ['connect-tuya','settings-tuya']) document.getElementById(id).addEventListener('click', loadDevices);
}
/** Preenche o formulário; copiar mantém os valores mas exige uma nova vigência. */
function editTariff(id, copy = false) {
  const form = document.getElementById('tariff-form'), tariff = tariffs.find(t => t.id === id);
  form.reset(); form.dataset.id = copy || !tariff ? crypto.randomUUID() : id;
  form.dataset.edit = String(Boolean(tariff && !copy));
  document.getElementById('tariff-error').textContent = '';
  document.getElementById('tariff-title').textContent = copy ? 'Nova vigência / bandeira' : tariff ? 'Editar configuração' : 'Cadastrar tarifa';
  if (tariff) {
    for (const [key, value] of Object.entries(tariff.config)) if (form.elements.namedItem(key) && key !== 'others') form.elements.namedItem(key).value = value;
    form.elements.others.value = tariff.config.others.map(item => `${item.name};${item.value}`).join('\n');
    if (!copy) { form.elements.startDate.value = tariff.startDate; form.elements.endDate.value = tariff.endDate; }
    else {
      const next = new Date(tariff.endDate + 'T00:00:00Z'); next.setUTCDate(next.getUTCDate() + 1);
      form.elements.startDate.value = next.toISOString().slice(0, 10);
    }
  }
  document.getElementById('tariff-dialog').showModal();
}
/** Troca somente a área principal da rota, preservando menu, filtros e estado da aplicação. */
function showPage() {
  const route = location.pathname;
  const names = { '/':'Visão geral', '/medicoes':'Medições', '/historico':'Histórico', '/comparacao':'Comparação', '/tarifas':'Tarifas', '/configuracoes':'Configurações' };
  document.querySelector('h1').textContent = names[route] || 'Visão geral';
  document.title = `${names[route]} · Gestão Energética`;
  for (const item of document.querySelectorAll('[data-pages]')) item.hidden = !item.dataset.pages.split(',').includes(route);
  for (const link of document.querySelectorAll('.side nav a')) {
    const active = link.getAttribute('href') === route;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  }
  window.scrollTo(0, 0);
}
/** Monta as rotas, o CRUD de tarifas e os controles da conta local dentro do layout existente. */
export function mountPages(onChange) {
  refreshDashboard = onChange;
  const nav = document.querySelector('.side nav');
  nav.innerHTML = [['/','Visão geral','◫'],['/medicoes','Medições','＋'],['/historico','Histórico','↗'],['/comparacao','Comparação','▥'],['/tarifas','Tarifas','R$'],['/configuracoes','Configurações','⚙']].map(([url,label,icon]) => `<a href="${url}" title="${label}"><b aria-hidden="true">${icon}</b><span>${label}</span></a>`).join('');
  document.querySelector('.brand').setAttribute('href', '/');
  document.querySelector('.kpis').dataset.pages = '/';
  document.querySelector('.content-grid').dataset.pages = '/historico,/comparacao';
  document.getElementById('historico').dataset.pages = '/historico';
  document.getElementById('comparacao').dataset.pages = '/comparacao';
  document.querySelector('.lower-grid').dataset.pages = '/,/comparacao';
  document.querySelector('.lower-grid > section').dataset.pages = '/comparacao';
  document.querySelector('.note-panel').dataset.pages = '/';
  document.getElementById('medicoes').dataset.pages = '/medicoes';
  document.querySelector('.toolbar').dataset.pages = '/,/historico,/comparacao';
  document.querySelector('.source-line').dataset.pages = '/,/medicoes,/historico,/comparacao';
  document.getElementById('load-status').dataset.pages = '/,/medicoes,/historico,/comparacao';
  document.querySelector('.main').insertAdjacentHTML('beforeend', `
    <section class="card panel" id="cost-breakdown" data-pages="/"><h2>Composição do custo estimado</h2><p id="cost-warning" role="status"></p><div id="cost-parts"></div><p class="manual-help">Estimativa por data. Tributos por fora sobre TE + TUSD + bandeira + outros; não substitui a fatura da concessionária.</p></section>
    <section class="card panel" id="tariff-page" data-pages="/tarifas"><div class="panel-head"><h2>Configurações de tarifas</h2><button class="primary-btn" id="new-tariff">+ Cadastrar tarifa</button></div><p id="tariff-status" role="status"></p><p>Para trocar a bandeira, use <strong>Nova vigência / bandeira</strong>. A cópia não modifica o período anterior. Tarifa e bandeira compartilham as datas desta configuração.</p><div class="table-wrap"><table class="data-table"><thead><tr><th>Vigência</th><th>Bandeira</th><th>TE R$/kWh</th><th>TUSD R$/kWh</th><th>Adicional R$/kWh</th><th>Ações</th></tr></thead><tbody id="tariff-list"></tbody></table></div><p class="manual-help">Editar corrige a configuração selecionada e recalcula estimativas do período. Excluir deixa esse período sem tarifa. Cadastre uma nova vigência para reajustes. Datas não podem se sobrepor.</p></section>
    <section class="card panel" data-pages="/configuracoes"><h2>Ambiente local</h2><p id="account-name"></p><p>Conta e dados guardados neste computador. Não há sincronização com o site hospedado.</p><p>Em Tarifas, informe os valores da sua configuração. Não há tarifa padrão.</p><h3>Modelo da estimativa</h3><p>Base = kWh × (TE + TUSD + adicional da bandeira por kWh + outros por kWh).</p><p>PIS, COFINS e ICMS = base × percentual / 100, calculados separadamente, por fora. Total = base + os três tributos.</p><p>Esse modelo simplificado não reproduz incidência por dentro, isenções, custo de disponibilidade, iluminação pública ou todas as regras da concessionária.</p><button class="secondary-btn" id="settings-tuya">Dispositivos inteligentes</button> <button class="secondary-btn" id="logout">Sair da conta local</button></section>`);
  document.body.insertAdjacentHTML('beforeend', `<dialog class="dialog" id="tariff-dialog"><form id="tariff-form"><h2 id="tariff-title">Cadastrar tarifa</h2><div class="form-grid"><div class="field"><span><label for="tariff-start">Início da vigência</label> ${helpButton('validity')}</span><input id="tariff-start" name="startDate" type="date" min="2000-01-01" max="2099-12-31" required></div><div class="field"><span><label for="tariff-end">Fim da vigência (inclusive)</label> ${helpButton('validity')}</span><input id="tariff-end" name="endDate" type="date" min="2000-01-01" max="2099-12-31" required></div>${numericField('te','TE (R$/kWh)',1000)}${numericField('tusd','TUSD (R$/kWh)',1000)}${numericField('pis','PIS (%)',100)}${numericField('cofins','COFINS (%)',100)}${numericField('icms','ICMS (%)',100)}<div class="field"><span><label for="tariff-flag">Bandeira</label> ${helpButton('flag')}</span><select id="tariff-flag" name="flag"><option>Verde</option><option>Amarela</option><option>Vermelha Patamar 1</option><option>Vermelha Patamar 2</option></select></div>${numericField('flagValue','Valor adicional da bandeira',10000)}<label class="field">Unidade do adicional<select name="flagUnit"><option value="BRL_KWH">R$/kWh</option><option value="BRL_100_KWH">R$/100 kWh</option></select></label><label class="field wide">Outros componentes (opcional)<textarea name="others" rows="3" placeholder="Nome;valor em R$/kWh"></textarea><small>Uma linha por componente. Separe nome e valor por ponto e vírgula. Sem valores fixos mensais.</small></label><label class="field wide"><span><input type="checkbox" name="ack" required style="width:auto"> Entendo que os tributos são estimados por fora sobre todos os componentes e que isso não substitui a fatura.</span></label></div><p id="tariff-error" class="status error" role="alert"></p><div class="dialog-actions"><button type="button" class="secondary-btn" id="cancel-tariff">Cancelar</button><button class="primary-btn" id="save-tariff">Salvar configuração</button></div></form></dialog>`);
  setupHelp();
  mountDevices();
  // Links reais permitem abrir cada rota diretamente; History mantém o menu montado.
  document.querySelector('.side').addEventListener('click', event => {
    const link = event.target.closest('a');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault(); history.pushState({}, '', link.getAttribute('href')); showPage();
  });
  window.addEventListener('popstate', showPage);
  document.getElementById('new-tariff').addEventListener('click', () => editTariff());
  document.getElementById('cancel-tariff').addEventListener('click', () => document.getElementById('tariff-dialog').close());
  document.getElementById('tariff-list').addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.tariffEdit) editTariff(button.dataset.tariffEdit);
    if (button.dataset.tariffCopy) editTariff(button.dataset.tariffCopy, true);
    if (button.dataset.tariffDelete && confirm('Excluir esta configuração? As datas dessa vigência ficarão sem estimativa até cadastrar outra tarifa.')) {
      button.disabled = true;
      try { await request('DELETE', { id: button.dataset.tariffDelete }); await loadTariffs(); }
      catch (error) { document.getElementById('tariff-status').textContent = error.message; button.disabled = false; }
    }
  });
  document.getElementById('tariff-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget, fields = form.elements;
    const buttons = [document.getElementById('save-tariff'), document.getElementById('cancel-tariff')];
    buttons.forEach(button => button.disabled = true);
    try {
      const config = { taxModel:'outside-v1', flag:fields.flag.value, flagUnit:fields.flagUnit.value };
      for (const name of ['te','tusd','pis','cofins','icms','flagValue']) config[name] = Number(fields[name].value);
      config.others = fields.others.value.trim() ? fields.others.value.trim().split('\n').map(line => {
        const parts = line.split(';');
        if (parts.length !== 2 || !parts[1].trim()) throw new Error('Use Nome;valor para cada componente adicional.');
        return { name:parts[0].trim(), value:Number(parts[1].trim().replace(',', '.')) };
      }) : [];
      await request(form.dataset.edit === 'true' ? 'PUT' : 'POST', { id:form.dataset.id, startDate:fields.startDate.value, endDate:fields.endDate.value, config });
      document.getElementById('tariff-dialog').close(); await loadTariffs();
    } catch (error) { document.getElementById('tariff-error').textContent = error.message; }
    finally { buttons.forEach(button => button.disabled = false); }
  });
  document.getElementById('settings-tuya').addEventListener('click', () => document.getElementById('tuya-dialog').showModal());
  document.getElementById('logout').addEventListener('click', async () => {
    const response = await fetch('/api/auth/logout', { method:'POST' });
    if (response.ok) location.assign('/login');
  });
  // O usuário final vê sua conta; identificadores de configuração ficam no procedimento administrativo.
  fetch('/api/auth/me').then(response => response.json()).then(user => { document.getElementById('account-name').textContent = `Conta: ${user.email}`; }).catch(() => {});
  showPage();
}
