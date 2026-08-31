'use strict';

// Valores de balanceamento do jogo. Ajustar aqui conforme o cartao fisico mudar.

const FUEL_MAX = 30; // unidades abstratas de combustivel por tanque cheio

const FUEL_WARNING_ROLLS = 10; // a partir de quantas rolagens restantes mostrar aviso

// ASSUNCAO: consumo de combustivel por rolagem escala proporcionalmente ao dado
// (dado/6), o que reproduz exatamente os valores informados para d6/d8/d12
// (30, ~22 e 15 rolagens por tanque) e extrapola para d4/d2, que o usuario
// ainda nao balanceou. Ajustar se vier um numero oficial.
function fuelConsumptionPerRoll(diceType) {
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

// Dado efetivo pra rolar: pneu desgastado sempre manda sobre o turbo.
function effectiveDice(turboDice, tireLevel) {
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
  tireDiceOverride,
  effectiveDice,
};
