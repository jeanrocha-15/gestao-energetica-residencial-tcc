import { validateReading } from './readings.js?v=cd6b0e211c3972aa';
import { validateTariff } from './tariffs.js?v=cd6b0e211c3972aa';
import { createDefaultReadings } from './default-readings.js?v=cd6b0e211c3972aa';

export const STORAGE_KEY = 'gestao-energetica-residencial-tcc:v1';

/** Valida o conjunto completo antes de gravar, inclusive arquivos de backup externos. */
export function validateData(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.readings) || !Array.isArray(value.tariffs)) throw new Error('Backup inválido ou versão não suportada.');
  if (value.readings.length > 20000 || value.tariffs.length > 1000) throw new Error('Arquivo excede o limite de registros.');
  const readings = value.readings.map(validateReading), tariffs = value.tariffs.map(validateTariff);
  for (const list of [readings, tariffs]) {
    if (new Set(list.map(item => item.id)).size !== list.length) throw new Error('Há identificadores repetidos.');
  }
  if (new Set(readings.map(item => [item.date,item.room,item.circuit].join('|'))).size !== readings.length) throw new Error('Já existe medição para essa data, cômodo e circuito. Edite o registro existente.');
  tariffs.sort((a,b) => a.startDate.localeCompare(b.startDate));
  for (let i = 1; i < tariffs.length; i++) {
    if (tariffs[i].startDate <= tariffs[i-1].endDate) throw new Error('As vigências das tarifas não podem se sobrepor.');
  }
  readings.sort((a,b) => b.date.localeCompare(a.date));
  return { version:1, readings, tariffs, defaultsApplied: value.defaultsApplied === true };
}

/** Lê uma única chave isolada do projeto; dados inválidos nunca são apagados silenciosamente. */
export function readData() {
  let raw;
  try { raw = localStorage.getItem(STORAGE_KEY); }
  catch { throw new Error('O navegador bloqueou o armazenamento. Permita dados locais para este site.'); }
  if (raw === null) return { version:1, readings:[], tariffs:[] };
  try { return validateData(JSON.parse(raw)); }
  catch { throw new Error('Os dados locais estão inválidos. Restaure um backup em Configurações.'); }
}

/** Grava tarifas e medições juntas: se faltar espaço, preserva a versão anterior. */
function writeData(value) {
  const data = validateData(value);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
  catch { throw new Error('Não foi possível salvar. O armazenamento está bloqueado ou cheio. Exporte um backup antes de liberar espaço.'); }
  return data;
}

/** Corrige as datas antigas da base padrão e inicializa navegadores vazios sem recriar exclusões. */
export async function initializeDefaultReadings() {
  return withLock(() => {
    const data = readData();
    const defaults = createDefaultReadings();
    let changed = false;
    for (let index = 0; index < defaults.length; index++) {
      const target = defaults[index], oldDate = `2026-10-${16 + index % 7}`;
      const existing = data.readings.find(item => item.id === target.id);
      // Só corrige a data originalmente gerada; preserva valores editados e datas escolhidas depois.
      if (!existing || !existing.estimatedDaily || existing.date !== oldDate) continue;
      const conflict = data.readings.some(item => item.id !== existing.id && item.date === target.date && item.room === existing.room && item.circuit === existing.circuit);
      if (conflict) throw new Error('Não foi possível corrigir as datas padrão: já existe um registro para o mesmo circuito em setembro. Edite o registro conflitante e recarregue. Nenhum dado foi substituído.');
      existing.date = target.date;
      changed = true;
    }
    if (changed) return writeData(data);
    if (data.defaultsApplied) return data;
    if (!data.readings.length) data.readings = createDefaultReadings();
    // Persiste a marca também após excluir os registros, para não recriá-los ao recarregar.
    data.defaultsApplied = true;
    return writeData(data);
  });
}

/** Serializa gravações entre abas quando o navegador oferece Web Locks. */
async function withLock(action) {
  return globalThis.navigator?.locks ? navigator.locks.request(STORAGE_KEY, action) : action();
}

/** Executa cadastro, edição, leitura e exclusão manual sem rede ou credenciais. */
export async function storageRequest(collection, method = 'GET', body) {
  if (!['readings','tariffs'].includes(collection)) throw new Error('Coleção inválida.');
  if (method === 'GET') return readData();
  return withLock(() => {
    const data = readData(), list = data[collection];
    const index = list.findIndex(item => item.id === body?.id);
    if (method === 'DELETE') {
      if (index < 0) throw new Error('Registro não encontrado. Atualize os dados.');
      list.splice(index,1);
    } else if (['POST','PUT'].includes(method)) {
      const value = collection === 'readings' ? validateReading(body) : validateTariff(body);
      if (method === 'PUT' && index < 0) throw new Error('Registro não encontrado. Atualize os dados.');
      if (method === 'POST' && index >= 0) throw new Error('Este registro já existe.');
      if (index < 0) list.push(value); else list[index] = value;
    } else throw new Error('Operação inválida.');
    const saved = writeData(data);
    return { ...saved, reading:saved.readings.find(item => item.id === body?.id), deleted:method === 'DELETE' };
  });
}

/** Restaura somente backups válidos, substituindo o conjunto em uma única gravação. */
export async function restoreBackup(text) {
  let data;
  try { data = validateData(JSON.parse(text)); }
  catch (error) { throw new Error('Backup não importado: ' + error.message); }
  return withLock(() => writeData(data));
}

/** Baixa uma cópia JSON das medições e tarifas sem transferi-las pela internet. */
export function exportBackup() {
  const status = document.getElementById('backup-status');
  try {
    const blob = new Blob([JSON.stringify(readData(),null,2)], {type:'application/json'});
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'backup-energia-' + new Date().toISOString().slice(0,10) + '.json';
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = 'Backup exportado. Guarde o arquivo em um local seguro.';
  } catch (error) { status.textContent = error.message; }
}

/** Confere o arquivo selecionado e pede confirmação antes de substituir os dados atuais. */
export async function importBackup(event) {
  const input = event.target, file = input.files?.[0], status = document.getElementById('backup-status');
  if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('Use um backup de até 5 MB.');
    const text = await file.text(), data = validateData(JSON.parse(text));
    if (!confirm(`Substituir os dados atuais por ${data.readings.length} medições e ${data.tariffs.length} tarifas? Exporte antes um backup se quiser preservar os dados atuais.`)) return;
    await restoreBackup(text);
    status.textContent = 'Backup restaurado com sucesso.';
    window.dispatchEvent(new Event('energy-data-changed'));
  } catch (error) { status.textContent = 'Não foi possível importar: ' + error.message; }
  finally { input.value = ''; }
}

// Uma alteração feita em outra aba é refletida aqui sem coletar nenhum dado externo.
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === STORAGE_KEY) window.dispatchEvent(new Event('energy-data-changed'));
});
