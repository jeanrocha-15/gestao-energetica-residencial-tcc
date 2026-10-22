// Totais transcritos da tabela do projeto; não representam necessariamente coleta simultânea.
export const collectedTotals = [
  ['Iluminação', 6.30], ['Tomadas da sala', 11.20], ['Tomadas da cozinha', 13.50],
  ['Chuveiro', 24.80], ['Geladeira', 9.10], ['Máquina de lavar', 7.40],
  ['Ar-condicionado', 18.60], ['Circuito adicional', 5.20],
];

/** Distribui cada total em sete parcelas desiguais, fechando exatamente os centésimos de kWh. */
export function createDefaultReadings() {
  const weights = [10, 12, 13, 14, 15, 17, 19];
  return collectedTotals.flatMap(([circuit, total], circuitIndex) => {
    const cents = Math.round(total * 100);
    // Cada circuito começa em uma posição diferente para variar seu perfil diário.
    const portions = weights.map((_, day) => Math.floor(cents * weights[(day + circuitIndex) % 7] / 100));
    // Distribui os centésimos que sobraram, sem alterar o total medido do circuito.
    for (let remaining = cents - portions.reduce((sum, value) => sum + value, 0), i = 0; remaining > 0; remaining--, i++) portions[i]++;
    return portions.map((value, day) => ({
      id: `20261022-0000-4000-8000-${String(circuitIndex * 7 + day + 1).padStart(12, '0')}`,
      // Datas de referência para exibição: a fonte não informa as datas reais de coleta.
      date: `2026-10-${16 + day}`, room: 'shared', circuit, kwh: value / 100,
      estimatedDaily: true,
    }));
  });
}
