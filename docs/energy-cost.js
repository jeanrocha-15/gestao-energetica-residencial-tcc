/** Seleciona a configuração do usuário pela data civil; os dois limites são inclusivos. */
export function tariffForDate(tariffs, date) {
  return tariffs.find(t => t.startDate <= date && t.endDate >= date) ?? null;
}

/** Converte o adicional informado por 100 kWh para o valor correspondente a um kWh. */
export function flagPerKwh(config) {
  return config.flagUnit === 'BRL_100_KWH' ? config.flagValue / 100 : config.flagValue;
}

/** Calcula custos com preços finais ou adiciona tributos apenas no modelo por fora.
 * Não reproduz regras fiscais de uma distribuidora. Mantém precisão até a apresentação final.
 */
export function estimateCost(kwh, tariff) {
  if (!tariff) return null;
  const c = tariff.config;
  const te = kwh * c.te, tusd = kwh * c.tusd, flag = kwh * flagPerKwh(c);
  const others = kwh * c.others.reduce((sum, item) => sum + item.value, 0);
  const base = te + tusd + flag + others;
  // Preços finais já contêm impostos: zeros abaixo significam nenhum tributo ADICIONAL.
  if (c.taxModel === 'included-v1') return { te, tusd, flag, others, pis:0, cofins:0, icms:0, taxes:0, total:base };
  const pis = base * c.pis / 100, cofins = base * c.cofins / 100, icms = base * c.icms / 100;
  return { te, tusd, flag, others, pis, cofins, icms, taxes: pis + cofins + icms, total: base + pis + cofins + icms };
}
