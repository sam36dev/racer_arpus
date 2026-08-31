// Espelho em browser das formulas de src/constants.js + serializePlayer de src/gameLogic.js.
// Precisa ficar em sincronia manual com o backend (sem bundler neste projeto).
window.GameCalc = (function () {
  const FUEL_MAX = 30;
  const FUEL_WARNING_ROLLS = 10;
  const TIRE_LEVEL_MAX = 10;

  const TIRE_BRANDS = {
    pirelli: { label: 'Pirelli', rollsPerLevel: 20 },
    continental: { label: 'Continental', rollsPerLevel: 25 },
    michelin: { label: 'Michelin', rollsPerLevel: 30 },
  };

  const TURBO_DICE_THRESHOLDS = [
    { position: 0, dice: 6 },
    { position: 8, dice: 8 },
    { position: 12, dice: 12 },
  ];

  function fuelConsumptionPerRoll(diceType) {
    return diceType / 6;
  }

  function tireDiceOverride(tireLevel) {
    if (tireLevel <= 4) return 2;
    if (tireLevel <= 6) return 4;
    return null;
  }

  function effectiveDice(turboDice, tireLevel) {
    const override = tireDiceOverride(tireLevel);
    return override != null ? override : turboDice;
  }

  function serializePlayer(player) {
    const rollDiceType = effectiveDice(player.diceType, player.tireLevel);
    const consumption = fuelConsumptionPerRoll(rollDiceType);
    const fuelPercent = Math.round((player.fuelCurrent / FUEL_MAX) * 100);
    const fuelRollsLeft = Math.floor(player.fuelCurrent / consumption);

    const tireInfo = TIRE_BRANDS[player.tireBrand];
    const rollsUntilNextLevel = Math.max(0, tireInfo.rollsPerLevel - player.tireRollsUsed);
    const override = tireDiceOverride(player.tireLevel);

    return {
      id: player.id,
      name: player.name,
      color: player.color,
      diceType: rollDiceType,
      turboDiceType: player.diceType,
      turboPosition: player.turboPosition,
      eliminated: !!player.eliminated,
      fuel: {
        current: player.fuelCurrent,
        max: FUEL_MAX,
        percent: fuelPercent,
        rollsLeft: fuelRollsLeft,
        warning: fuelRollsLeft <= FUEL_WARNING_ROLLS,
        empty: player.fuelCurrent <= 0,
      },
      tire: {
        brand: player.tireBrand,
        label: tireInfo.label,
        level: player.tireLevel,
        levelMax: TIRE_LEVEL_MAX,
        rollsPerLevel: tireInfo.rollsPerLevel,
        rollsUsed: player.tireRollsUsed,
        rollsUntilNextLevel,
        penaltyDice: override,
      },
      laps: player.laps,
    };
  }

  return { TIRE_BRANDS, serializePlayer };
})();
