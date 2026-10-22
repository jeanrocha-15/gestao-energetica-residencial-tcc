/** Seleciona a configuração do usuário pela data civil; os dois limites são inclusivos. */
export function tariffForDate(tariffs, date) {
  return tariffs.find(t => t.startDate <= date && t.endDate >= date) ?? null;
}

/** Converte o adicional informado por 100 kWh para o valor correspondente a um kWh. */
export function flagPerKwh(config) {
  return config.flagUnit === 'BRL_100_KWH' ? config.flagValue / 100 : config.flagValue;
}

/** Calcula uma estimativa explícita: tributos por fora sobre TE + TUSD + bandeira + outros.
 * Não reproduz regras fiscais de uma distribuidora. Mantém precisão até a apresentação final.
 */
export function estimateCost(kwh, tariff) {
  if (!tariff) return null;
  const c = tariff.config;
  const te = kwh * c.te, tusd = kwh * c.tusd, flag = kwh * flagPerKwh(c);
  const others = kwh * c.others.reduce((sum, item) => sum + item.value, 0);
  const base = te + tusd + flag + others;
  const pis = base * c.pis / 100, cofins = base * c.cofins / 100, icms = base * c.icms / 100;
  return { te, tusd, flag, others, pis, cofins, icms, taxes: pis + cofins + icms, total: base + pis + cofins + icms };
}
