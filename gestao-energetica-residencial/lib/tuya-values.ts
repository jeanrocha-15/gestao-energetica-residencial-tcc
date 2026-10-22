export type TuyaSpecification = { code: string; type?: string; values?: string; name?: string };
export type TuyaStatus = { code: string; value: unknown };
export type TuyaPoint = { code: string; type: string; raw: number | boolean | string | null; value: number | boolean | string | null; unit: string | null; scale: number | null; kind: string | null; normalized: number | null; normalizedUnit: string | null; note: string | null };

/** Lê somente metadados públicos do ponto; ausência de escala não vira escala zero. */
function metadata(spec: TuyaSpecification) {
  try { const value = JSON.parse(spec.values || '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; }
}
/** Converte a unidade declarada pela API para kWh, W, V ou A, sem fatores específicos de modelo. */
export function unitConversion(unit: string): { kind: string; unit: string; factor: number } | null {
  const symbol = unit.replace(/[\s·⋅*]/g, '');
  // Prefixos SI diferenciam maiúsculas: mW é miliwatt, MW é megawatt.
  const precise: Record<string, [string, string, number]> = { mWh:['energy','kWh',0.000001], MWh:['energy','kWh',1000], mW:['power','W',0.001], MW:['power','W',1000000], mV:['voltage','V',0.001], MV:['voltage','V',1000000], mA:['current','A',0.001], MA:['current','A',1000000] };
  const special=precise[symbol];
  if (special) return {kind:special[0],unit:special[1],factor:special[2]};
  const key = symbol.toLowerCase();
  const units: Record<string, [string, string, number]> = { wh:['energy','kWh',0.001], kwh:['energy','kWh',1], w:['power','W',1], kw:['power','W',1000], v:['voltage','V',1], a:['current','A',1] };
  const found = units[key]; return found ? { kind:found[0], unit:found[1], factor:found[2] } : null;
}
/** Aceita somente números ou textos numéricos finitos; null e texto vazio não significam zero. */
export function numericValue(raw: unknown): number | null {
  if (typeof raw !== 'number' && (typeof raw !== 'string' || !/^-?\d+(\.\d+)?$/.test(raw))) return null;
  const number = Number(raw); return Number.isFinite(number) ? number : null;
}
/** Aplica a escala oficial a um ponto e restringe a saída a telemetria, nunca a chaves locais ou credenciais. */
export function decodePoint(spec: TuyaSpecification, raw: unknown): TuyaPoint {
  const meta = metadata(spec), type = String(spec.type || '').toLowerCase();
  const scale = Number.isInteger(meta.scale) && meta.scale >= 0 && meta.scale <= 12 ? meta.scale as number : null;
  const unit = typeof meta.unit === 'string' ? meta.unit : null;
  const conversion = unit === null ? null : unitConversion(unit);
  const point: TuyaPoint = { code:spec.code, type, raw:null, value:null, unit, scale, kind:conversion?.kind ?? null, normalized:null, normalizedUnit:conversion?.unit ?? null, note:null };
  if (/password|passwd|secret|token|local_key|credential|wifi|ssid/i.test(spec.code)) return { ...point, note:'Conteúdo sensível não exposto.' };
  if (type === 'boolean' || type === 'bool') {
    if (typeof raw === 'boolean') point.value = point.raw = raw;
  } else if (type === 'enum' && typeof raw === 'string' && Array.isArray(meta.range) && meta.range.includes(raw)) {
    point.value = point.raw = raw;
  } else if (type === 'integer' || type === 'value') {
    point.raw = numericValue(raw);
    if (point.raw !== null && scale !== null) {
      // Um valor bruto 2300 com escala 1 equivale a 230 na unidade declarada.
      point.value = point.raw / 10 ** scale;
      if (conversion) point.normalized = point.value * conversion.factor;
    }
  }
  if (point.value === null) point.note = raw == null ? 'Sem valor reportado.' : scale === null && ['integer','value'].includes(type) ? 'Escala não fornecida pela API; conversão indisponível.' : 'Formato não numérico/estruturado não decodificado.';
  return point;
}
/** Une especificações e estados reais; não preenche métricas ausentes nem interpreta pacotes binários proprietários. */
export function decodePoints(specifications: TuyaSpecification[], status: TuyaStatus[]) {
  const result = specifications.map(spec => decodePoint(spec, status.find(item => item.code === spec.code)?.value));
  for (const item of status) if (!specifications.some(spec => spec.code === item.code)) result.push(decodePoint({ code:item.code }, item.value));
  return result;
}

/** Calcula somente diferenças de contadores contínuos no mesmo dia e na mesma associação. */
export function counterDelta(previous: { total: number; date: string; mapping: string } | null, total: number, date: string, mapping: string) {
  const continuous = Boolean(previous && previous.date === date && previous.mapping === mapping && total >= previous.total);
  return { continuous, delta:continuous ? total - previous!.total : 0 };
}
