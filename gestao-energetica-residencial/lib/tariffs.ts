export type TariffConfig = { te: number; tusd: number; pis: number; cofins: number; icms: number; flag: string; flagValue: number; flagUnit: string; others: { name: string; value: number }[]; taxModel: 'outside-v1' };
export type TariffInput = { id: string; startDate: string; endDate: string; config: TariffConfig };
/** Confere números sem aceitar valores ausentes, negativos ou não finitos. */
function number(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw new Error('Informe valores numéricos válidos e não negativos.');
  return value;
}
/** Valida a data real, inclusive anos bissextos, antes de comparar as vigências. */
function date(value: unknown): string {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('Informe uma data válida entre 2000 e 2099.');
  return value;
}
/** Valida todos os componentes editáveis e registra qual fórmula tributária foi escolhida. */
export function validateTariff(input: unknown): TariffInput {
  if (!input || typeof input !== 'object') throw new Error('Preencha a tarifa.');
  const v = input as Record<string, unknown>;
  if (typeof v.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(v.id)) throw new Error('Identificador inválido.');
  const startDate = date(v.startDate), endDate = date(v.endDate);
  if (endDate < startDate) throw new Error('O fim da vigência deve ser igual ou posterior ao início.');
  const c = v.config as Record<string, unknown>;
  if (!c || c.taxModel !== 'outside-v1') throw new Error('Confirme o modelo de estimativa de tributos por fora.');
  if (!['Verde', 'Amarela', 'Vermelha Patamar 1', 'Vermelha Patamar 2'].includes(String(c.flag))) throw new Error('Bandeira inválida.');
  if (!['BRL_KWH', 'BRL_100_KWH'].includes(String(c.flagUnit))) throw new Error('Unidade do adicional inválida.');
  if (!Array.isArray(c.others) || c.others.length > 20) throw new Error('Use até 20 componentes adicionais.');
  const others = c.others.map(item => {
    if (!item || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80) throw new Error('Nome do componente inválido.');
    return { name: item.name.trim(), value: number(item.value, 1000) };
  });
  return { id: v.id, startDate, endDate, config: { te: number(c.te, 1000), tusd: number(c.tusd, 1000), pis: number(c.pis, 100), cofins: number(c.cofins, 100), icms: number(c.icms, 100), flag: String(c.flag), flagUnit: String(c.flagUnit), flagValue: number(c.flagValue, 10000), others, taxModel: 'outside-v1' } };
}
