// Espelho em browser das formulas de src/constants.js + serializePlayer de src/gameLogic.js.
// Precisa ficar em sincronia manual com o backend (sem bundler neste projeto).
window.GameCalc = (function () {
  const FUEL_MAX = 40;
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

  // Espelho de ACTIVE_EFFECTS em src/luckCards.js - so pra saber label/default/transferable
  // de cada efeito continuo e montar os badges. Mudou algo la? Muda aqui tambem.
  const ACTIVE_EFFECTS = {
    tireWearMultiplier: { label: () => 'Desgaste de pneu dobrado', default: 1, transferable: false },
    diceLock: { label: (value) => `Dado travado em D${value}`, default: null, transferable: true },
    tanqueFuradoActive: { label: () => 'Tanque furado: -1 litro extra ao tirar 6', default: false, transferable: false },
    d12TempActive: {
      label: () => 'D12 temporario (1 litro/rolagem, acaba ao tirar 12)',
      default: false,
      transferable: false,
    },
    watching: {
      label: (value) => `Observando ${value.targetName} (${(value.seenValues || []).length}/${value.targetDiceType})`,
      default: null,
      transferable: false,
    },
  };

  function fuelConsumptionPerRoll(diceType) {
    return diceType / 6;
  }

  function tireDiceOverride(tireLevel) {
    if (tireLevel <= 4) return 2;
    if (tireLevel <= 6) return 4;
    return null;
  }

  function effectiveDice(turboDice, tireLevel, diceLock) {
    if (diceLock != null) return diceLock;
    const override = tireDiceOverride(tireLevel);
    return override != null ? override : turboDice;
  }

  // Progresso do turbo ate o proximo salto de dado - espelho de turboProgress() em src/constants.js.
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
    if (!next) return { percent: 100, nextPosition: null, nextDice: null };
    const span = next.position - bandStart;
    const percent = span > 0 ? Math.round(((position - bandStart) / span) * 100) : 100;
    return { percent: Math.max(0, Math.min(100, percent)), nextPosition: next.position, nextDice: next.dice };
  }

  function serializePlayer(player) {
    // 'Kit Gas' (diceLock) e 'D12 Temporario' (d12TempActive) travam o dado igual ao pneu
    // gasto faria - se os dois estiverem ligados ao mesmo tempo, o diceLock manda.
    const forcedDice = player.diceLock != null ? player.diceLock : player.d12TempActive ? 12 : null;
    const rollDiceType = effectiveDice(player.diceType, player.tireLevel, forcedDice);
    const consumption = fuelConsumptionPerRoll(rollDiceType);
    const fuelPercent = Math.round((player.fuelCurrent / FUEL_MAX) * 100);
    const fuelRollsLeft = Math.floor(player.fuelCurrent / consumption);

    const tireInfo = TIRE_BRANDS[player.tireBrand];
    const rollsUntilNextLevel = Math.max(0, tireInfo.rollsPerLevel - player.tireRollsUsed);
    const override = tireDiceOverride(player.tireLevel);

    const turboProg = turboProgress(player.turboPosition);

    return {
      id: player.id,
      name: player.name,
      color: player.color,
      diceType: rollDiceType,
      turboDiceType: player.diceType,
      turboPosition: player.turboPosition,
      turbo: {
        position: player.turboPosition,
        diceType: player.diceType,
        percent: turboProg.percent,
        nextPosition: turboProg.nextPosition,
        nextDice: turboProg.nextDice,
      },
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
      lastRoll: player.lastRoll || null,
      lastCard: player.lastCard || null,
      watching: player.watching || null,
      activeEffects: Object.keys(ACTIVE_EFFECTS)
        .map((field) => ({ field, meta: ACTIVE_EFFECTS[field], value: player[field] }))
        .filter(({ meta, value }) => value !== undefined && value !== meta.default)
        .map(({ field, meta, value }) => ({ field, label: meta.label(value), value, transferable: !!meta.transferable })),
    };
  }

  return { TIRE_BRANDS, serializePlayer };
})();
