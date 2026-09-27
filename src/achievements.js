'use strict';

const db = require('./db');
const { incrementStats, getUser } = require('./users');

// PLACEHOLDER: catalogo de exemplo ate o usuario mandar a lista real dos 50 trofeus.
// type 'auto'  -> desbloqueia sozinho quando o `code` bate com um evento do jogo (ver checkAutoAchievements)
// type 'manual' -> so o admin consegue conceder (endpoint /api/admin/grant-achievement)
// type 'transferable' -> so um dono por vez, passa de mao em mao (ver updateLendaDaMesa)
const CATALOG = [
  { id: 'primeira-vitoria', name: 'Primeira Vitoria', description: 'Vencer sua primeira corrida', icon: '🏆', type: 'auto', code: 'first_win' },
  { id: 'veterano', name: 'Veterano', description: 'Participar de 10 corridas', icon: '🎖️', type: 'auto', code: 'races_played_10' },
  { id: 'sobrevivente', name: 'Sobrevivente', description: 'Terminar uma corrida sem ser eliminado', icon: '🛡️', type: 'auto', code: 'finish_no_elimination' },
  { id: 'pe-de-chumbo-10', name: 'Pe de Chumbo', description: 'Levar 10 multas numa mesma corrida e chegar ao fim sem ser eliminado', icon: '🚔', type: 'auto', code: 'fines_10_no_elimination' },
  { id: 'vitoria-por-voltas', name: 'Bandeirada', description: 'Vencer uma corrida completando todas as voltas', icon: '🏁', type: 'auto', code: 'win_by_laps' },
  { id: 'vitoria-no-d2', name: 'Na Raca', description: 'Chegar ao d2 (pneu gasto) na corrida e mesmo assim vencer por voltas', icon: '🛞', type: 'auto', code: 'win_by_laps_after_d2' },
  { id: 'ultimo-sobrevivente', name: 'Ultimo de Pe', description: 'Vencer uma corrida com todos os oponentes eliminados', icon: '💀', type: 'auto', code: 'win_last_standing' },
  { id: 'frentista', name: 'Frentista', description: 'Abastecer 60 vezes na mesma corrida', icon: '⛽', type: 'auto', code: 'refuels_60_in_race' },
  { id: 'turbo-maximo', name: 'Turbo Maximo', description: 'Chegar ao nivel maximo do turbo (d12) em uma corrida', icon: '🌀', type: 'auto', code: 'reached_d12' },
  { id: 'dono-de-interlagos', name: 'Dono de Interlagos', description: 'Comprou o Autodromo de Interlagos (concedido pelo admin)', icon: '🏟️', type: 'manual' },
  { id: 'magnata-4-propriedades', name: 'Magnata', description: 'Comprou 4 propriedades na mesma partida (concedido pelo admin)', icon: '🏘️', type: 'manual' },
  { id: 'lenda-da-mesa', name: 'Lenda da Mesa', description: 'Ter mais vitorias que todo mundo (minimo 3). Passa de mao em mao: quem ultrapassar o dono atual leva', icon: '🐐', type: 'transferable' },
];

function catalog() {
  return CATALOG;
}

function findByCode(code) {
  return CATALOG.filter((a) => a.type === 'auto' && a.code === code);
}

function findById(id) {
  return CATALOG.find((a) => a.id === id);
}

function userAchievementsCol(username) {
  return db.collection('users').doc(username).collection('achievements');
}

async function listUnlocked(username) {
  const snap = await userAchievementsCol(username).get();
  return snap.docs.map((doc) => ({ achievementId: doc.id, ...doc.data() }));
}

async function unlock(username, achievementId, grantedBy) {
  const ref = userAchievementsCol(username).doc(achievementId);
  const existing = await ref.get();
  if (existing.exists) return false; // ja tinha, nao duplica

  await ref.set({
    unlockedAt: new Date().toISOString(),
    grantedBy, // 'auto' ou username do admin
  });
  return true;
}

async function grantManual(username, achievementId, adminUsername) {
  const achievement = findById(achievementId);
  if (!achievement) {
    const err = new Error('Conquista nao encontrada');
    err.code = 'ACHIEVEMENT_NOT_FOUND';
    throw err;
  }
  if (achievement.type !== 'manual') {
    const err = new Error('Essa conquista e automatica, o admin nao concede');
    err.code = 'ACHIEVEMENT_NOT_MANUAL';
    throw err;
  }
  return unlock(username, achievementId, adminUsername);
}

// Chamado apos eventos do jogo pra checar conquistas automaticas.
// context: dados relevantes do evento (ex: user atualizado apos incrementStats)
async function checkAutoAchievements(username, eventCode, context = {}) {
  const candidates = findByCode(eventCode);
  const unlockedNow = [];
  for (const achievement of candidates) {
    const wasUnlocked = await unlock(username, achievement.id, 'auto');
    if (wasUnlocked) unlockedNow.push(achievement);
  }
  return unlockedNow;
}

// 'Lenda da Mesa': fica com quem tem mais vitorias (minimo 3). Empate nao tira do dono atual -
// tem que ULTRAPASSAR. Chamado depois de cada vitoria creditada; como so o vencedor ganhou
// vitoria nova, so ele pode ter passado o dono atual.
const LENDA_ID = 'lenda-da-mesa';
const LENDA_MIN_WINS = 3;
const lendaHolderRef = () => db.collection('trophyHolders').doc(LENDA_ID);

async function updateLendaDaMesa(winnerUsername) {
  const winner = await getUser(winnerUsername);
  if ((winner.wins || 0) < LENDA_MIN_WINS) return;

  const holderSnap = await lendaHolderRef().get();
  const holderUsername = holderSnap.exists ? holderSnap.data().username : null;
  if (holderUsername === winner.username) return;

  if (holderUsername) {
    const holder = await getUser(holderUsername).catch(() => null);
    if (holder && (holder.wins || 0) >= winner.wins) return;
    await userAchievementsCol(holderUsername).doc(LENDA_ID).delete();
  }

  await userAchievementsCol(winner.username).doc(LENDA_ID).set({
    unlockedAt: new Date().toISOString(),
    grantedBy: 'auto',
  });
  await lendaHolderRef().set({ username: winner.username, since: new Date().toISOString() });
}

module.exports = {
  catalog,
  findById,
  listUnlocked,
  grantManual,
  checkAutoAchievements,
  updateLendaDaMesa,
};
