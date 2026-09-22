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
const luckCards = require('./luckCards');

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

    // 'Kit Gas' (diceLock) e 'D12 Temporario' (d12TempActive) travam o dado igual ao pneu
    // gasto faria - se os dois estiverem ligados ao mesmo tempo, o diceLock manda.
    const forcedDice = player.diceLock != null ? player.diceLock : player.d12TempActive ? 12 : null;
    const rollDiceType = effectiveDice(player.diceType, player.tireLevel, forcedDice);
    const value = 1 + Math.floor(Math.random() * rollDiceType);

    // 'D12 Temporario' cobra 1 litro fixo por rolagem (em vez da formula normal).
    let consumption = player.d12TempActive ? 1 : fuelConsumptionPerRoll(rollDiceType);
    // 'Tanque Furado': tirou 6 (em qualquer dado), perde mais 1 litro.
    if (player.tanqueFuradoActive && value === 6) consumption += 1;
    const newFuel = Math.max(0, player.fuelCurrent - consumption);

    const rollsPerLevel = TIRE_BRANDS[player.tireBrand].rollsPerLevel;
    const tireWear = player.tireWearMultiplier || 1; // carta 'Pneu Remold' liga isso ate o mestre desligar
    let newTireRolls = player.tireRollsUsed + tireWear;
    let newTireLevel = player.tireLevel;
    let eliminated = player.eliminated;

    if (newTireRolls >= rollsPerLevel) {
      newTireRolls = 0;
      newTireLevel = Math.max(0, player.tireLevel - 1);
      if (newTireLevel <= 0) eliminated = true;
    }

    const updates = {
      fuelCurrent: newFuel,
      tireRollsUsed: newTireRolls,
      tireLevel: newTireLevel,
      eliminated,
      lastRoll: { value, diceType: rollDiceType, at: Date.now() },
    };

    // 'D12 Temporario': tirou 12 -> efeito acaba. So desliga a flag; o turbo do jogador
    // (turboPosition/diceType) nunca foi mexido, entao ele so volta a rolar com o dado
    // real dele (ex: d8), sem perder progresso nenhum.
    if (player.d12TempActive && value === 12) {
      updates.d12TempActive = false;
    }

    t.update(ref, updates);

    return { value, diceType: rollDiceType, userId: player.userId, justEliminated: eliminated && !player.eliminated };
  });

  if (result.justEliminated && result.userId) {
    await users.incrementStats(result.userId, { timesEliminated: 1 });
  }

  // 'Transmissao Sequencial': atualiza quem estiver observando este jogador (fora da
  // transacao acima de proposito - mexe em docs de OUTROS jogadores, nao so no de quem rolou).
  await updateWatchers(gameId, playerId, result.diceType, result.value);

  return { value: result.value, diceType: result.diceType, player: await getPlayer(gameId, playerId) };
}

// Atualiza todo jogador que tenha a carta 'Transmissao Sequencial' ativa observando
// `rolledPlayerId`. Se o dado observado mudou desde a ultima vez, reinicia a contagem.
// Quando todos os numeros do dado atual ja tiverem aparecido, liga o aviso "troque de lugar".
async function updateWatchers(gameId, rolledPlayerId, rollDiceType, value) {
  const snap = await gameRef(gameId)
    .collection('players')
    .where('watching.targetPlayerId', '==', rolledPlayerId)
    .get();
  if (snap.empty) return;

  await Promise.all(
    snap.docs.map(async (doc) => {
      const w = doc.data().watching;
      if (!w) return;
      const seenValues = w.targetDiceType === rollDiceType ? w.seenValues || [] : [];
      const newSeenValues = seenValues.includes(value) ? seenValues : [...seenValues, value];
      const triggered = newSeenValues.length >= rollDiceType;
      await doc.ref.update({
        watching: { ...w, targetDiceType: rollDiceType, seenValues: newSeenValues, triggered },
      });
    })
  );
}

// Abastecer enche aos poucos: +1 unidade de combustivel por vez (nao enche o tanque de uma vez).
// `amount` so e diferente de 1 quando chamado por uma carta da sorte (pode ser negativo).
async function refuel(gameId, playerId, amount = 1) {
  const ref = playerRef(gameId, playerId);
  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) throw new GameError('PLAYER_NOT_FOUND', 'Jogador nao encontrado');
    const newFuel = Math.min(FUEL_MAX, Math.max(0, snap.data().fuelCurrent + amount));
    t.update(ref, { fuelCurrent: newFuel });
  });
  return getPlayer(gameId, playerId);
}

// Reparo/manutencao: sobe o nivel do pneu (ate o maximo), sem mexer na marca
// nem na contagem de rolagens ate o proximo desgaste. `amount` > 1 so vem de carta da sorte.
async function repairTire(gameId, playerId, amount = 1) {
  const ref = playerRef(gameId, playerId);
  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) throw new GameError('PLAYER_NOT_FOUND', 'Jogador nao encontrado');
    const newLevel = Math.min(TIRE_LEVEL_MAX, snap.data().tireLevel + amount);
    t.update(ref, { tireLevel: newLevel });
  });
  return getPlayer(gameId, playerId);
}

// Penalidade manual do mestre (evento do tabuleiro, batida, etc) ou carta da sorte:
// desce o nivel do pneu. Se chegar a 0, elimina o jogador da corrida igual ao desgaste normal.
async function damageTire(gameId, playerId, amount = 1) {
  const ref = playerRef(gameId, playerId);
  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) throw new GameError('PLAYER_NOT_FOUND', 'Jogador nao encontrado');
    const player = snap.data();
    const newLevel = Math.max(0, player.tireLevel - amount);
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

// `delta` so e diferente de 1 (e so pode ser negativo) quando chamado por uma carta da sorte.
async function upgradeTurbo(gameId, playerId, delta = 1) {
  const ref = playerRef(gameId, playerId);
  const { userId, newDice } = await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) throw new GameError('PLAYER_NOT_FOUND', 'Jogador nao encontrado');
    const player = snap.data();
    const newPosition = Math.max(0, player.turboPosition + delta);
    const dice = diceForTurboPosition(newPosition);
    t.update(ref, { turboPosition: newPosition, diceType: dice });
    return { userId: player.userId, newDice: dice };
  });

  if (newDice >= 12 && userId) {
    await achievements.checkAutoAchievements(userId, 'reached_d12');
  }

  return getPlayer(gameId, playerId);
}

// `delta` so e diferente de 1 quando chamado por uma carta da sorte que da (ou tira) voltas de graca.
async function completeLap(gameId, playerId, delta = 1) {
  const pRef = playerRef(gameId, playerId);
  const gRef = gameRef(gameId);

  const { userId, won, eliminated } = await db.runTransaction(async (t) => {
    const [playerSnap, gameSnap] = await Promise.all([t.get(pRef), t.get(gRef)]);
    if (!playerSnap.exists) throw new GameError('PLAYER_NOT_FOUND', 'Jogador nao encontrado');
    if (!gameSnap.exists) throw new GameError('GAME_NOT_FOUND', 'Jogo nao encontrado');

    const player = playerSnap.data();
    const newLaps = Math.max(0, player.laps + delta);
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
    await users.incrementStats(userId, { lapsCompleted: delta });
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

function luckCardsCol(gameId) {
  return gameRef(gameId).collection('luckCards');
}

// Grava a carta ativada no proprio jogador (lastCard, pra tela do piloto reagir em tempo
// real) e no historico da corrida. Reaproveitado por activateCard() e por transferEffect()
// (quando um efeito continuo passa de um jogador pro outro, o alvo tambem "recebe a carta").
async function recordCardActivation(gameId, playerId, card) {
  const revealedAt = Date.now();
  await playerRef(gameId, playerId).update({
    lastCard: { cardId: card.id, name: card.name, icon: card.icon, description: card.description, at: revealedAt },
  });

  await luckCardsCol(gameId).add({
    playerId,
    cardId: card.id,
    name: card.name,
    icon: card.icon,
    description: card.description,
    appliedAt: new Date().toISOString(),
  });
}

// Mestre ativa uma carta da sorte (tirada do baralho fisico) pra um jogador.
// Aplica o efeito automatico da carta (ver src/luckCards.js) e registra no
// historico + no proprio jogador (lastCard), pra tela do piloto reagir em tempo real.
// `targetPlayerId` so e usado por cartas do tipo 'watchOpponent' (ex: Transmissao Sequencial).
async function activateCard(gameId, playerId, cardId, targetPlayerId) {
  const card = luckCards.findById(cardId);
  if (!card) throw new GameError('INVALID_CARD', 'Carta da sorte invalida');
  await getPlayer(gameId, playerId); // valida que o jogador existe

  const effect = card.effect;
  switch (effect.type) {
    case 'fuel':
      await refuel(gameId, playerId, effect.value);
      break;
    case 'tire':
      if (effect.value >= 0) await repairTire(gameId, playerId, effect.value);
      else await damageTire(gameId, playerId, -effect.value);
      break;
    case 'tireBrand':
      await changeTireBrand(gameId, playerId, effect.value);
      break;
    case 'turbo':
      await upgradeTurbo(gameId, playerId, effect.value);
      break;
    case 'laps':
      await completeLap(gameId, playerId, effect.value);
      break;
    case 'fine':
      await applyFine(gameId, playerId, effect.value, card.name);
      break;
    case 'watchOpponent': {
      if (!targetPlayerId) throw new GameError('MISSING_TARGET', 'Escolha o oponente pra observar');
      if (targetPlayerId === playerId) {
        throw new GameError('INVALID_TARGET', 'Escolha outro jogador pra observar');
      }
      const targetPlayer = await getPlayer(gameId, targetPlayerId);
      const targetForced =
        targetPlayer.diceLock != null ? targetPlayer.diceLock : targetPlayer.d12TempActive ? 12 : null;
      const targetDiceType = effectiveDice(targetPlayer.diceType, targetPlayer.tireLevel, targetForced);
      await playerRef(gameId, playerId).update({
        watching: { targetPlayerId, targetName: targetPlayer.name, targetDiceType, seenValues: [], triggered: false },
      });
      break;
    }
    case 'statusOn':
      await playerRef(gameId, playerId).update({ [effect.field]: effect.value });
      break;
    case 'none':
    default:
      // carta so anuncia, sem efeito automatico nos stats (mestre resolve na mesa)
      break;
  }

  await recordCardActivation(gameId, playerId, card);

  return getPlayer(gameId, playerId);
}

async function listLuckCardLog(gameId) {
  const snap = await luckCardsCol(gameId).orderBy('appliedAt', 'desc').limit(30).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

// Mestre desliga manualmente um efeito continuo ligado por carta da sorte (ex: Pneu Remold),
// voltando o campo ao valor default. So aceita campos conhecidos (ver ACTIVE_EFFECTS em luckCards.js).
async function clearEffect(gameId, playerId, field) {
  const meta = luckCards.getActiveEffect(field);
  if (!meta) throw new GameError('INVALID_EFFECT', 'Efeito invalido');
  await getPlayer(gameId, playerId); // valida que o jogador existe
  await playerRef(gameId, playerId).update({ [field]: meta.default });
  return getPlayer(gameId, playerId);
}

// Mestre repassa um efeito continuo TRANSFERIVEL (ex: Kit Gas) de um jogador pro outro -
// caso do tabuleiro em que os dois caem na mesma casa e a "zica" passa adiante.
// Tira o efeito de quem tinha, liga no alvo com o mesmo valor, e anuncia a carta pro alvo.
async function transferEffect(gameId, fromPlayerId, toPlayerId, field) {
  const meta = luckCards.getActiveEffect(field);
  if (!meta) throw new GameError('INVALID_EFFECT', 'Efeito invalido');
  if (!meta.transferable) throw new GameError('EFFECT_NOT_TRANSFERABLE', 'Esse efeito nao pode ser transferido');
  if (fromPlayerId === toPlayerId) {
    throw new GameError('INVALID_TARGET', 'Escolha outro jogador pra transferir o efeito');
  }

  const fromPlayer = await getPlayer(gameId, fromPlayerId);
  const value = fromPlayer[field];
  if (value === undefined || value === meta.default) {
    throw new GameError('EFFECT_NOT_ACTIVE', 'Esse efeito nao esta ativo nesse jogador');
  }
  await getPlayer(gameId, toPlayerId); // valida que o alvo existe

  await playerRef(gameId, fromPlayerId).update({ [field]: meta.default });
  await playerRef(gameId, toPlayerId).update({ [field]: value });

  const card = luckCards.findByEffectField(field);
  if (card) await recordCardActivation(gameId, toPlayerId, card);

  return { from: await getPlayer(gameId, fromPlayerId), to: await getPlayer(gameId, toPlayerId) };
}

function randomColor() {
  const palette = ['#e63946', '#f4a261', '#2a9d8f', '#457b9d', '#8338ec', '#ffb703'];
  return palette[Math.floor(Math.random() * palette.length)];
}

function serializePlayer(player) {
  // Mesma regra de precedencia de rollDice(): diceLock (Kit Gas) e d12TempActive (D12
  // Temporario) travam o dado exibido igual travam o dado realmente rolado.
  const forcedDice = player.diceLock != null ? player.diceLock : player.d12TempActive ? 12 : null;
  const rollDiceType = effectiveDice(player.diceType, player.tireLevel, forcedDice);
  const consumption = fuelConsumptionPerRoll(rollDiceType);
  const fuelPercent = Math.round((player.fuelCurrent / FUEL_MAX) * 100);
  const fuelRollsLeft = Math.floor(player.fuelCurrent / consumption);

  const tireInfo = TIRE_BRANDS[player.tireBrand];
  const rollsUntilNextLevel = Math.max(0, tireInfo.rollsPerLevel - player.tireRollsUsed);
  const override = tireDiceOverride(player.tireLevel);

  const activeEffects = luckCards
    .activeEffectFields()
    .map((field) => ({ field, meta: luckCards.getActiveEffect(field), value: player[field] }))
    .filter(({ meta, value }) => value !== undefined && value !== meta.default)
    .map(({ field, meta, value }) => ({ field, label: meta.label(value), value, transferable: !!meta.transferable }));

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
    lastRoll: player.lastRoll || null,
    lastCard: player.lastCard || null,
    watching: player.watching || null,
    activeEffects,
    createdAt: player.createdAt,
  };
}

async function serializeGame(gameId) {
  const [game, players, fines, luckCardLog] = await Promise.all([
    getGame(gameId),
    listPlayers(gameId),
    listFines(gameId),
    listLuckCardLog(gameId),
  ]);

  return {
    id: game.id,
    name: game.name,
    status: game.status,
    totalLaps: game.totalLaps,
    winnerPlayerId: game.winnerPlayerId,
    players: players.map(serializePlayer),
    fines,
    luckCardLog,
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
  activateCard,
  clearEffect,
  transferEffect,
  listLuckCardLog,
  serializePlayer,
  serializeGame,
};
