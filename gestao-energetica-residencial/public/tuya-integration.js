/** Escapa metadados e mensagens antes de construir os cartões dos dispositivos reais. */
const escapeTuya = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

/** Monta o fluxo Tuya sem pedir senhas do aplicativo nem receber segredos do projeto no navegador. */
export function mountTuya({ rooms, circuits, onReadings }) {
  const section=document.getElementById('tuya-integration');
  section.hidden=false;
  section.open=true;
  section.innerHTML=`<summary>Tuya / Smart Life — conta e dispositivos reais</summary>
    <p>Conecte sua conta e confirme a autorização na página oficial Tuya/Smart Life. Depois, seus dispositivos e dados disponíveis aparecerão aqui.</p>
    <button type="button" class="primary-btn" id="tuya-connect">Conectar Tuya/Smart Life</button>
    <button type="button" class="secondary-btn" id="tuya-discover" disabled>Atualizar dispositivos</button>
    <button type="button" class="secondary-btn" id="sync-tuya" disabled>Sincronizar energia real</button>
    <p id="tuya-status" role="status" style="white-space:pre-line">Verificando conexão…</p>
    <p id="tuya-last-update" role="status">Última atualização: nenhuma coleta concluída.</p>
    <p>A coleta é feita pelo servidor a cada 12 horas, mesmo com esta página fechada.</p>
    <a id="tuya-admin" href="/admin/tuya" hidden>Área do administrador</a>
    <p>Energia ausente não significa zero. A coleta respeita o ambiente/circuito associado e não soma automaticamente a casa inteira com seus circuitos ou equipamentos. Confirme que os dispositivos selecionados não medem a mesma energia.</p>
    <div id="tuya-devices"></div>`;
  let devices=[],connected=false,busy=false,canConnect=false;
  document.getElementById('connect-tuya').insertAdjacentHTML('afterend','<span id="tuya-update-summary" class="status"></span>');
  /** Atualiza o estado dos comandos para impedir consultas simultâneas nesta aba. */
  function buttons() {
    document.getElementById('tuya-connect').disabled=busy||!canConnect;
    document.getElementById('tuya-discover').disabled=busy||!connected;
    document.getElementById('sync-tuya').disabled=busy||!connected;
  }
  /** Envia ações autenticadas somente ao servidor local; ele assina as consultas oficiais. */
  async function call(action, body={}) {
    const response=await fetch('/api/integrations/tuya',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',cache:'no-store',body:JSON.stringify({action,...body})});
    const data=await response.json();
    if (!response.ok) throw new Error(data.error || 'Falha na API Tuya.');
    return data;
  }
  /** Mostra o status de disponibilidade informado pela nuvem, sem presumir que o aparelho esteja online. */
  function onlineLabel(value) { return value===true?'Online':value===false?'Offline':'Status não fornecido'; }
  /** Formata apenas valores realmente recebidos e convertidos pela especificação oficial. */
  function metric(point) {
    return point.normalized===null ? (point.note || 'Valor indisponível') : `${new Intl.NumberFormat('pt-BR',{maximumFractionDigits:6}).format(point.normalized)} ${point.normalizedUnit}`;
  }
  /** Exibe datas reais persistidas, mantendo a última atualização em caso de falha posterior. */
  function renderCollection(collection) {
    if (!collection) return;
    const date=value=>value?new Date(value).toLocaleString('pt-BR'):'Nenhuma';
    const summary='Última atualização Tuya: '+date(collection.lastSuccessAt);
    document.getElementById('tuya-update-summary').textContent=summary;
    document.getElementById('tuya-last-update').textContent=summary+'. Última tentativa: '+date(collection.lastAttemptAt)+'. Próxima coleta: '+date(collection.nextRunAt)+'. '+collection.message;
  }
  /** Consulta apenas o estado local; esta atualização da tela não coleta dados na nuvem. */
  async function refreshState() {
    const response=await fetch('/api/integrations/tuya',{credentials:'same-origin',cache:'no-store'});
    const data=await response.json(); if (!response.ok) throw new Error(data.error);
    connected=data.connected===true; canConnect=data.canConnect===true;
    document.getElementById('tuya-admin').hidden=!data.admin;
    renderCollection(data.collection); buttons();
    return data;
  }
  /** Lista nome, modelo, tipo, ID e status; campos ausentes permanecem identificados como ausentes. */
  function renderDevices() {
    document.getElementById('tuya-devices').innerHTML=devices.length?devices.map(device=>`<article class="device-card" data-tuya-device="${escapeTuya(device.id)}"><h3>${escapeTuya(device.name || 'Nome não fornecido')}</h3><dl><div><dt>Modelo</dt><dd>${escapeTuya(device.model || 'Não fornecido pela API')}</dd></div><div><dt>Produto</dt><dd>${escapeTuya(device.product || 'Não fornecido')}</dd></div><div><dt>Tipo (categoria)</dt><dd>${escapeTuya(device.type || 'Não fornecido')}</dd></div><div><dt>ID</dt><dd>${escapeTuya(device.id)}</dd></div><div><dt>Status</dt><dd>${onlineLabel(device.online)}</dd></div><div><dt>Associação</dt><dd>${device.mapping?escapeTuya((rooms.find(room=>room.id===device.mapping.room)?.name||device.mapping.room)+' · '+device.mapping.circuit):'Ainda não associada'}</dd></div></dl><button type="button" class="secondary-btn" data-tuya-inspect="${escapeTuya(device.id)}">Consultar dados / associar ambiente</button><div class="tuya-device-details"></div></article>`).join(''):'<p>Nenhum dispositivo retornado pela API para esta conta.</p>';
  }
  /** Após consentimento, descobre aparelhos e consulta suas métricas reais sem exigir preenchimento técnico. */
  async function discoverAuthorizedDevices(withDetails=false) {
    const list=await call('discover'); devices=list.devices; renderDevices();
    document.getElementById('tuya-status').textContent=list.message;
    if (!withDetails) return;
    for (const device of devices) {
      try { const data=await call('inspect',{deviceId:device.id}); renderDetails(device,data.device); }
      catch {
        const card=[...document.querySelectorAll('[data-tuya-device]')].find(item=>item.dataset.tuyaDevice===device.id);
        card.querySelector('.tuya-device-details').textContent='Não foi possível consultar os dados deste aparelho agora. Use Consultar dados para tentar novamente.';
      }
    }
  }
  /** Monta a telemetria real e o formulário de associação; escolher uma unidade não inventa um valor. */
  function renderDetails(device, snapshot) {
    const card=[...document.querySelectorAll('[data-tuya-device]')].find(item=>item.dataset.tuyaDevice===device.id);
    const energy=snapshot.points.filter(point=>point.kind==='energy' && point.scale!==null);
    const option=(value,label,selected)=>`<option value="${escapeTuya(value)}"${selected?' selected':''}>${escapeTuya(label)}</option>`;
    card.querySelector('.tuya-device-details').innerHTML=`<p>${escapeTuya(snapshot.message)}</p><p>${onlineLabel(snapshot.online)} · consulta em ${escapeTuya(new Date(snapshot.checkedAt).toLocaleString('pt-BR'))}. ${snapshot.online!==true?'Valores abaixo são os últimos estados reportados; não são uma leitura online confirmada.':''}</p>
      <dl>${[['energy','Energia'],['power','Potência'],['voltage','Tensão'],['current','Corrente']].map(([kind,label])=>`<div><dt>${label}</dt><dd>${snapshot.points.filter(point=>point.kind===kind).map(point=>`${escapeTuya(point.code)}: ${escapeTuya(metric(point))}${point.code==='add_ele'?' (último incremento reportado, não total diário)':''}`).join('<br>')||'Não disponibilizada em formato reconhecido pela API'}</dd></div>`).join('')}</dl>
      <details><summary>Pontos de dados disponíveis</summary><div class="table-wrap"><table class="data-table"><thead><tr><th>Código</th><th>Valor reportado (escalado)</th><th>Unidade</th><th>Observação</th></tr></thead><tbody>${snapshot.points.map(point=>`<tr><td>${escapeTuya(point.code)}</td><td>${point.value===null?'Indisponível':escapeTuya(point.value)}</td><td>${escapeTuya(point.unit || 'Não fornecida')}</td><td>${escapeTuya(point.note || '')}</td></tr>`).join('')}</tbody></table></div></details>
      <form data-tuya-mapping="${escapeTuya(device.id)}"><div class="form-grid"><label class="field">Ambiente<select name="room" required><option value="">Selecione</option>${rooms.map(room=>option(room.id,room.name,device.mapping?.room===room.id)).join('')}</select></label><label class="field">Circuito<select name="circuit" required><option value="">Selecione</option>${circuits.map(circuit=>option(circuit.name,circuit.name,device.mapping?.circuit===circuit.name)).join('')}</select></label><label class="field">Ponto de energia<select name="energyCode"><option value="">Não coletar energia</option>${energy.map(point=>option(point.code,`${point.code} (${point.unit}, escala ${point.scale})`,device.mapping?.energyCode===point.code)).join('')}</select></label><label class="field">Como o ponto reporta energia<select name="energyMode">${[['none','Somente associar, sem coleta'],['cumulative','Contador acumulado'],['incremental','Eventos incrementais (logs oficiais)']].map(([value,label])=>option(value,label,(device.mapping?.energyMode||'none')===value)).join('')}</select></label></div><label><input type="checkbox" name="confirmed"> Confirmei no aparelho/fabricante a natureza do ponto selecionado e que não estou somando medições sobrepostas.</label><p>add_ele é incremental: o sistema importa eventos com data e remove duplicatas. Se a API negar logs, informa o erro sem somar o último status. Para contador acumulado, a primeira consulta apenas inicia a referência.</p><p class="status" data-tuya-feedback role="status"></p><button type="submit" class="primary-btn">Salvar associação</button></form>`;
  }
  /** Executa uma operação visível, preservando mensagens de falha sem cair em dados de demonstração. */
  async function run(operation) {
    if (busy) return; busy=true; buttons();
    try { await operation(); }
    catch (error) { document.getElementById('tuya-status').textContent=error.message; }
    finally { busy=false; buttons(); }
  }
  /** Atualiza o dashboard apenas após tentar coletar dados reais dos dispositivos associados. */
  async function sync() {
    await run(async () => {
      document.getElementById('tuya-status').textContent='Consultando energia real…';
      const data=await call('sync');
      renderCollection(data.collection);
      document.getElementById('tuya-status').textContent=data.message+'\n'+data.devices.map(device=>`${device.name}: ${device.message}`).join('\n');
      await onReadings();
    });
  }
  document.getElementById('tuya-connect').addEventListener('click',()=>run(async()=>{
    section.open=true; document.getElementById('tuya-status').textContent='Abrindo autorização oficial…';
    const data=await call('connect'); window.location.assign(data.authorizationUrl);
  }));
  document.getElementById('tuya-discover').addEventListener('click',()=>run(async()=>{
    await discoverAuthorizedDevices();
  }));
  document.getElementById('sync-tuya').addEventListener('click',sync);
  document.getElementById('tuya-devices').addEventListener('click',event=>{
    const button=event.target.closest('[data-tuya-inspect]'); if (!button) return;
    run(async()=>{
      const data=await call('inspect',{deviceId:button.dataset.tuyaInspect});
      renderDetails(devices.find(device=>device.id===data.device.id),data.device);
    });
  });
  document.getElementById('tuya-devices').addEventListener('change',event=>{
    if (event.target.name==='energyCode' && event.target.value==='add_ele') event.target.form.elements.energyMode.value='incremental';
  });
  document.getElementById('tuya-devices').addEventListener('submit',event=>{
    const form=event.target.closest('[data-tuya-mapping]'); if (!form) return;
    event.preventDefault();
    run(async()=>{
      const fields=form.elements;
      const data=await call('mapping',{deviceId:form.dataset.tuyaMapping,room:fields.room.value,circuit:fields.circuit.value,energyCode:fields.energyCode.value || null,energyMode:fields.energyMode.value,confirmed:fields.confirmed.checked});
      form.querySelector('[data-tuya-feedback]').textContent=data.message;
      const device=devices.find(item=>item.id===form.dataset.tuyaMapping);
      device.mapping={room:fields.room.value,circuit:fields.circuit.value,energyCode:fields.energyCode.value,energyMode:fields.energyMode.value};
      document.getElementById('tuya-status').textContent='Associação salva. Use Sincronizar energia real para consultar o aparelho.';
    });
  });
  // A interface não agenda sincronizações; apenas atualiza o estado ao voltar para a página.
  window.addEventListener('focus',()=>refreshState().catch(()=>{}));
  buttons();
  refreshState().then(async data=>{
    const result=new URL(window.location?.href || 'http://localhost/').searchParams.get('tuya');
    // O retorno abre os dispositivos automaticamente; o código OAuth já foi removido no callback.
    if (result==='success' || result==='error') {
      document.getElementById('tuya-dialog').showModal();
      const clean=new URL(window.location.href); clean.searchParams.delete('tuya');
      history.replaceState(null,'',clean.pathname+clean.search+clean.hash);
    }
    document.getElementById('tuya-status').textContent=result==='error'?'A autorização não foi concluída. Tente conectar novamente ou contate o administrador.':data.message;
    if (connected) await run(()=>discoverAuthorizedDevices(result==='success'));
  }).catch(error=>{document.getElementById('tuya-status').textContent=error.message;});
}
