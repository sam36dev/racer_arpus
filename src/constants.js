'use strict';

// Valores de balanceamento do jogo. Ajustar aqui conforme o cartao fisico mudar.

const FUEL_MAX = 40; // unidades abstratas de combustivel por tanque cheio

const FUEL_WARNING_ROLLS = 10; // a partir de quantas rolagens restantes mostrar aviso

// CONFIRMADO pelo usuario: d4 gasta 0.5 de combustivel por rolagem (1 unidade a
// cada 2 rolagens) e d2 gasta metade disso, 0.25 (1 unidade a cada 4 rolagens) -
// nenhum dos dois segue a formula proporcional abaixo.
// ASSUNCAO pros demais dados: consumo escala proporcionalmente ao dado (dado/6).
// Com FUEL_MAX=40 isso da 40 rolagens por tanque no d6, 30 no d8 e 20 no d12;
// ajustar (ou adicionar em FUEL_CONSUMPTION_OVERRIDES) se vier numero oficial
// diferente pro d8 ou d12.
const FUEL_CONSUMPTION_OVERRIDES = {
  2: 0.25,
  4: 0.5,
};

function fuelConsumptionPerRoll(diceType) {
  if (FUEL_CONSUMPTION_OVERRIDES[diceType] != null) return FUEL_CONSUMPTION_OVERRIDES[diceType];
  return diceType / 6;
}

// Pneu: trilha de desgaste de 0 a 10 (bate com as 10 bolinhas do cartao fisico).
// A cada `rollsPerLevel` rolagens (depende da marca), o nivel cai 1.
const TIRE_LEVEL_MAX = 10;

const TIRE_BRANDS = {
  pirelli: { label: 'Pirelli', rollsPerLevel: 20 },
  continental: { label: 'Continental', rollsPerLevel: 25 },
  michelin: { label: 'Michelin', rollsPerLevel: 30 },
};

const TIRE_UPGRADE_ORDER = ['pirelli', 'continental', 'michelin'];

// Pneu desgastado sobrepoe (sempre vence) o dado do turbo.
// Nivel 7-10: sem penalidade. Nivel 5-6: d4. Nivel 1-4: d2. Nivel 0: eliminado.
function tireDiceOverride(tireLevel) {
  if (tireLevel <= 4) return 2;
  if (tireLevel <= 6) return 4;
  return null;
}

// Marcas na trilha de turbo que aumentam o dado do carro.
const TURBO_DICE_THRESHOLDS = [
  { position: 0, dice: 6 },
  { position: 8, dice: 8 },
  { position: 12, dice: 12 },
];

function diceForTurboPosition(position) {
  let dice = 6;
  for (const step of TURBO_DICE_THRESHOLDS) {
    if (position >= step.position) dice = step.dice;
  }
  return dice;
}

// Progresso do turbo ate o proximo salto de dado (pra desenhar uma barra tipo
// combustivel/pneu na tela do jogador). Se ja estiver no ultimo degrau (d12), retorna
// a barra cheia e sem proximo degrau.
function turboProgress(position) {
  let bandStart = TURBO_DICE_THRESHOLDS[0].position;
  let next = null;
  for (const step of TURBO_DICE_THRESHOLDS) {
    if (position >= step.position) {
      bandStart = step.position;
    } else {
      next = step;
      break;
    }
  }
  if (!next) {
    return { percent: 100, nextPosition: null, nextDice: null };
  }
  const span = next.position - bandStart;
  const percent = span > 0 ? Math.round(((position - bandStart) / span) * 100) : 100;
  return { percent: Math.max(0, Math.min(100, percent)), nextPosition: next.position, nextDice: next.dice };
}

// Dado efetivo pra rolar: pneu desgastado sempre manda sobre o turbo.
// `diceLock` (carta da sorte tipo Kit Gas, ver src/luckCards.js) trava o dado
// nesse valor e sobrepoe tudo, ate o mestre remover ou transferir o efeito.
function effectiveDice(turboDice, tireLevel, diceLock) {
  if (diceLock != null) return diceLock;
  const override = tireDiceOverride(tireLevel);
  return override != null ? override : turboDice;
}

const TOTAL_LAPS = 10;

module.exports = {
  FUEL_MAX,
  FUEL_WARNING_ROLLS,
  TIRE_LEVEL_MAX,
  TIRE_BRANDS,
  TIRE_UPGRADE_ORDER,
  TURBO_DICE_THRESHOLDS,
  TOTAL_LAPS,
  fuelConsumptionPerRoll,
  diceForTurboPosition,
  turboProgress,
  tireDiceOverride,
  effectiveDice,
};
