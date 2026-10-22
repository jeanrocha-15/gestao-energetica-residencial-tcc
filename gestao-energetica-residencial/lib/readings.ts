export const roomIds = ['sala','cozinha','quarto1','quarto2','banheiros','servico','shared'];
export const circuitNames = ['Climatização','Chuveiros','Cozinha','Tomadas gerais','Iluminação',"Chuveiro","Ar-condicionado","Tomadas da cozinha","Tomadas da sala","Geladeira","Máquina de lavar","Circuito adicional"];
export type ReadingInput = { id: string; date: string; room: string; circuit: string; kwh: number; estimatedDaily?: boolean };
/** Confere data, cômodo, circuito e consumo antes de permitir que uma medição seja salva. */
export function validateReading(input: unknown): ReadingInput {
  if (!input || typeof input !== 'object') throw new Error('Preencha os dados da medição.');
  const v = input as Record<string, unknown>;
  if (typeof v.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(v.id)) throw new Error('Identificador inválido.');
  if (typeof v.date !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(v.date) || Number.isNaN(Date.parse(v.date + 'T12:00:00Z')) || new Date(v.date + 'T12:00:00Z').toISOString().slice(0,10) !== v.date) throw new Error('Informe uma data válida.');
  if (typeof v.room !== 'string' || !roomIds.includes(v.room)) throw new Error('Selecione um cômodo válido.');
  if (typeof v.circuit !== 'string' || !circuitNames.includes(v.circuit)) throw new Error('Selecione um circuito válido.');
  if (typeof v.kwh !== 'number' || !Number.isFinite(v.kwh) || v.kwh < 0 || v.kwh > 10000) throw new Error('Informe o consumo entre 0 e 10.000 kWh.');
  return {id:v.id,date:v.date,room:v.room,circuit:v.circuit,kwh:Math.round(v.kwh*1000)/1000,...(v.estimatedDaily === true ? {estimatedDaily:true} : {})};
}
