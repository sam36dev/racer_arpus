'use strict';

const { nanoid } = require('nanoid');
const db = require('./db');
const {
  FUEL_MAX,
  FUEL_WARNING_ROLLS,
  TIRE_LEVEL_MAX,
  TIRE_BRANDS,
  TOTAL_LAPS,
  fuelConsumptionPerRoll,
  diceForTurboPosition,
  tireDiceOverride,
  effectiveDice,
} = require('./constants');
const users = require('./users');
const achievements = require('./achievements');

// --- Regras assumidas ate confirmacao do usuario ---
// - Tanque vazio: BLOQUEIA a rolagem de dado ate abastecer.
// - Jogador eliminado (pneu chegou ao nivel 0): BLOQUEIA a rolagem de dado permanentemente.
// - Reparar pneu (+1 nivel) e trocar de marca (reseta nivel/contagem): livres, sem custo
//   controlado pelo app (fichas/dinheiro sao fisicos, fora do sistema).
// ------------------------------------------------------------------

class GameError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function gameRef(gameId) {
  return db.collection('games').doc(gameId);
}

function playerRef(gameId, playerId) {
  return gameRef(gameId).collection('players').doc(playerId);
}

function finesCol(gameId) {
  return gameRef(gameId).collection('fines');
}

async function createGame(name) {
  const id = nanoid(8);
  await gameRef(id).set({
    name: name || 'Corrida',
    status: 'lobby',
    totalLaps: TOTAL_LAPS,
    winnerPlayerId: null,
    createdAt: new Date().toISOString(),
  });
  return getGame(id);
}

async function getGame(gameId) {
  const snap = await gameRef(gameId).get();
  if (!snap.exists) throw new GameError('GAME_NOT_FOUND', 'Jogo nao encontrado');
  return { id: snap.id, ...snap.data() };
}

async function addPlayer(gameId, name, color, userId) {
  await getGame(gameId);
  const id = nanoid(8);
  await playerRef(gameId, id).set({
    name,
    color: color || randomColor(),
    userId: userId || null,
    diceType: 6,
    turboPosition: 0,
    fuelCurrent: FUEL_MAX,
    tireBrand: 'pirelli',
    tireLevel: TIRE_LEVEL_MAX,
    tireRollsUsed: 0,
    eliminated: false,
    laps: 0,
    createdAt: new Date().toISOString(),
  });

  if (userId) {
    await users.incrementStats(userId, { racesPlayed: 1 });
    const user = await users.getUser(userId);
    if (user.racesPlayed >= 10) {
      await achievements.checkAutoAchievements(userId, 'races_played_10');
    }
  }

  return getPlayer(gameId, id);
}

async function getPlayer(gameId, playerId) {
  const snap = await playerRef(gameId, playerId).get();
  if (!snap.exists) throw new GameError('PLAYER_NOT_FOUND', 'Jogador nao encontrado');
  return { id: snap.id, gameId, ...snap.data() };
}

async function listPlayers(gameId) {
  const snap = await gameRef(gameId).collection('players').orderBy('createdAt').get();
  return snap.docs.map((doc) => ({ id: doc.id, gameId, ...doc.data() }));
}

async function rollDice(gameId, playerId) {
  const ref = playerRef(gameId, playerId);

  const result = await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) throw new GameError('PLAYER_NOT_FOUND', 'Jogador nao encontrado');
    const player = snap.data();

    if (player.eliminated) {
      throw new GameError('ELIMINATED', 'Pneu chegou ao nivel 0 - jogador eliminado da corrida');
    }
    if (player.fuelCurrent <= 0) {
      throw new GameError('OUT_OF_FUEL', 'Sem combustivel - abasteca antes de rolar o dado');
    }

    const rollDiceType = effectiveDice(player.diceType, player.tireLevel);
    const value = 1 + Math.floor(Math.random() * rollDiceType);

    const consumption = fuelConsumptionPerRoll(rollDiceType);
    const newFuel = Math.max(0, player.fuelCurrent - consumption);

    const rollsPerLevel = TIRE_BRANDS[player.tireBrand].rollsPerLevel;
    let newTireRolls = player.tireRollsUsed + 1;
    let newTireLevel = player.tireLevel;
    let eliminated = player.eliminated;

    if (newTireRolls >= rollsPerLevel) {
      newTireRolls = 0;
      newTireLevel = Math.max(0, player.tireLevel - 1);
      if (newTireLevel <= 0) eliminated = true;
    }

    t.update(ref, {
      fuelCurrent: newFuel,
      tireRollsUsed: newTireRolls,
      tireLevel: newTireLevel,
      eliminated,
    });

    return { value, diceType: rollDiceType, userId: player.userId, justEliminated: eliminated && !player.eliminated };
  });

  if (result.justEliminated && result.userId) {
    await users.incrementStats(result.userId, { timesEliminated: 1 });
  }

  return { value: result.value, diceType: result.diceType, player: await getPlayer(gameId, playerId) };
}

// Abastecer enche aos poucos: +1 unidade de combustivel por vez (nao enche o tanque de uma vez).
async function refuel(gameId, playerId) {
  const ref = playerRef(gameId, playerId);
  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) throw new GameError('PLAYER_NOT_FOUND', 'Jogador nao encontrado');
    const newFuel = Math.min(FUEL_MAX, snap.data().fuelCurrent + 1);
    t.update(ref, { fuelCurrent: newFuel });
  });
  return getPlayer(gameId, playerId);
}

// Reparo/manutencao: sobe o nivel do pneu em +1 (ate o maximo), sem mexer na marca
// nem na contagem de rolagens ate o proximo desgaste.
async function repairTire(gameId, playerId) {
  const ref = playerRef(gameId, playerId);
  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) throw new GameError('PLAYER_NOT_FOUND', 'Jogador nao encontrado');
    const newLevel = Math.min(TIRE_LEVEL_MAX, snap.data().tireLevel + 1);
    t.update(ref, { tireLevel: newLevel });
  });
  return getPlayer(gameId, playerId);
}

// Penalidade manual do mestre (evento do tabuleiro, batida, etc): desce o nivel
// do pneu em -1. Se chegar a 0, elimina o jogador da corrida igual ao desgaste normal.
async function damageTire(gameId, playerId) {
  const ref = playerRef(gameId, playerId);
  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) throw new GameError('PLAYER_NOT_FOUND', 'Jogador nao encontrado');
    const player = snap.data();
    const newLevel = Math.max(0, player.tireLevel - 1);
    const updates = { tireLevel: newLevel };
    if (newLevel <= 0) updates.eliminated = true;
    t.update(ref, updates);
  });
  return getPlayer(gameId, playerId);
}

// Troca de marca: pneu novo de fabrica - reseta nivel ao maximo e zera a contagem de rolagens.
async function changeTireBrand(gameId, playerId, brand) {
  if (!TIRE_BRANDS[brand]) throw new GameError('INVALID_TIRE', 'Marca de pneu invalida');
  await getPlayer(gameId, playerId);
  await playerRef(gameId, playerId).update({
    tireBrand: brand,
    tireLevel: TIRE_LEVEL_MAX,
    tireRollsUsed: 0,
  });
  return getPlayer(gameId, playerId);
}

async function upgradeTurbo(gameId, playerId) {
  const ref = playerRef(gameId, playerId);
  const { userId, newDice } = await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) throw new GameError('PLAYER_NOT_FOUND', 'Jogador nao encontrado');
    const player = snap.data();
    const newPosition = player.turboPosition + 1;
    const dice = diceForTurboPosition(newPosition);
    t.update(ref, { turboPosition: newPosition, diceType: dice });
    return { userId: player.userId, newDice: dice };
  });

  if (newDice >= 12 && userId) {
    await achievements.checkAutoAchievements(userId, 'reached_d12');
  }

  return getPlayer(gameId, playerId);
}

async function completeLap(gameId, playerId) {
  const pRef = playerRef(gameId, playerId);
  const gRef = gameRef(gameId);

  const { userId, won, eliminated } = await db.runTransaction(async (t) => {
    const [playerSnap, gameSnap] = await Promise.all([t.get(pRef), t.get(gRef)]);
    if (!playerSnap.exists) throw new GameError('PLAYER_NOT_FOUND', 'Jogador nao encontrado');
    if (!gameSnap.exists) throw new GameError('GAME_NOT_FOUND', 'Jogo nao encontrado');

    const player = playerSnap.data();
    const newLaps = player.laps + 1;
    t.update(pRef, { laps: newLaps });

    const game = gameSnap.data();
    let won = false;
    if (newLaps >= game.totalLaps && game.status !== 'finished') {
      t.update(gRef, { status: 'finished', winnerPlayerId: playerId });
      won = true;
    }

    return { userId: player.userId, won, eliminated: !!player.eliminated };
  });

  if (userId) {
    await users.incrementStats(userId, { lapsCompleted: 1 });
    if (won) {
      await users.incrementStats(userId, { wins: 1 });
      const user = await users.getUser(userId);
      if (user.wins === 1) await achievements.checkAutoAchievements(userId, 'first_win');
      if (!eliminated) await achievements.checkAutoAchievements(userId, 'finish_no_elimination');
    }
  }

  return { player: await getPlayer(gameId, playerId), game: await getGame(gameId) };
}

async function applyFine(gameId, playerId, amount, reason) {
  const player = await getPlayer(gameId, playerId);
  const id = nanoid(8);
  await finesCol(gameId).doc(id).set({
    playerId,
    amount,
    reason: reason || '',
    createdAt: new Date().toISOString(),
  });

  if (player.userId) {
    await users.incrementStats(player.userId, { finesReceived: 1 });
    const user = await users.getUser(player.userId);
    if (user.finesReceived >= 5) {
      await achievements.checkAutoAchievements(player.userId, 'fines_received_5');
    }
  }

  return listFines(gameId);
}

async function listFines(gameId) {
  const snap = await finesCol(gameId).orderBy('createdAt', 'desc').get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

function randomColor() {
  const palette = ['#e63946', '#f4a261', '#2a9d8f', '#457b9d', '#8338ec', '#ffb703'];
  return palette[Math.floor(Math.random() * palette.length)];
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
    gameId: player.gameId,
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
    createdAt: player.createdAt,
  };
}

async function serializeGame(gameId) {
  const [game, players, fines] = await Promise.all([
    getGame(gameId),
    listPlayers(gameId),
    listFines(gameId),
  ]);

  return {
    id: game.id,
    name: game.name,
    status: game.status,
    totalLaps: game.totalLaps,
    winnerPlayerId: game.winnerPlayerId,
    players: players.map(serializePlayer),
    fines,
  };
}

module.exports = {
  GameError,
  createGame,
  getGame,
  addPlayer,
  getPlayer,
  listPlayers,
  rollDice,
  refuel,
  repairTire,
  damageTire,
  changeTireBrand,
  upgradeTurbo,
  completeLap,
  applyFine,
  listFines,
  serializePlayer,
  serializeGame,
};
