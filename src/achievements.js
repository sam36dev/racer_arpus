'use strict';

const db = require('./db');
const { incrementStats } = require('./users');

// PLACEHOLDER: catalogo de exemplo ate o usuario mandar a lista real dos 50 trofeus.
// type 'auto'  -> desbloqueia sozinho quando o `code` bate com um evento do jogo (ver checkAutoAchievements)
// type 'manual' -> so o admin consegue conceder (endpoint /api/admin/grant-achievement)
const CATALOG = [
  { id: 'primeira-vitoria', name: 'Primeira Vitoria', description: 'Vencer sua primeira corrida', icon: '🏆', type: 'auto', code: 'first_win' },
  { id: 'veterano', name: 'Veterano', description: 'Participar de 10 corridas', icon: '🎖️', type: 'auto', code: 'races_played_10' },
  { id: 'sobrevivente', name: 'Sobrevivente', description: 'Terminar uma corrida sem ser eliminado', icon: '🛡️', type: 'auto', code: 'finish_no_elimination' },
  { id: 'pe-de-chumbo', name: 'Pe de Chumbo', description: 'Levar 5 multas ao longo das corridas', icon: '🚔', type: 'auto', code: 'fines_received_5' },
  { id: 'turbo-maximo', name: 'Turbo Maximo', description: 'Chegar ao nivel maximo do turbo (d12) em uma corrida', icon: '🌀', type: 'auto', code: 'reached_d12' },
  { id: 'piloto-do-mes', name: 'Piloto do Mes', description: 'Reconhecimento especial concedido pelo admin', icon: '👑', type: 'manual' },
  { id: 'fair-play', name: 'Fair Play', description: 'Reconhecimento por espirito esportivo, concedido pelo admin', icon: '🤝', type: 'manual' },
  { id: 'lenda-da-mesa', name: 'Lenda da Mesa', description: 'Reconhecimento maximo concedido pelo admin', icon: '🐐', type: 'manual' },
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

module.exports = {
  catalog,
  findById,
  listUnlocked,
  grantManual,
  checkAutoAchievements,
};
