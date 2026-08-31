'use strict';

const db = require('./db');
const { hashPassword, verifyPassword } = require('./auth');

class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function usersCol() {
  return db.collection('users');
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

async function signup(rawUsername, password, confirmPassword) {
  const username = normalizeUsername(rawUsername);

  if (!username || username.length < 3) {
    throw new AuthError('INVALID_USERNAME', 'Usuario precisa ter pelo menos 3 caracteres');
  }
  if (!/^[a-z0-9_]+$/.test(username)) {
    throw new AuthError('INVALID_USERNAME', 'Usuario so pode ter letras, numeros e _');
  }
  if (!password || password.length < 4) {
    throw new AuthError('WEAK_PASSWORD', 'Senha precisa ter pelo menos 4 caracteres');
  }
  if (password !== confirmPassword) {
    throw new AuthError('PASSWORD_MISMATCH', 'As senhas nao coincidem');
  }

  const ref = usersCol().doc(username);
  const existing = await ref.get();
  if (existing.exists) {
    throw new AuthError('USERNAME_TAKEN', 'Esse usuario ja existe');
  }

  const passwordHash = await hashPassword(password);
  await ref.set({
    displayName: rawUsername.trim(),
    passwordHash,
    wins: 0,
    racesPlayed: 0,
    lapsCompleted: 0,
    timesEliminated: 0,
    finesReceived: 0,
    createdAt: new Date().toISOString(),
  });

  return { username };
}

async function login(rawUsername, password) {
  const username = normalizeUsername(rawUsername);
  const snap = await usersCol().doc(username).get();
  if (!snap.exists) {
    throw new AuthError('INVALID_CREDENTIALS', 'Usuario ou senha invalidos');
  }
  const user = snap.data();
  const ok = await verifyPassword(password || '', user.passwordHash);
  if (!ok) {
    throw new AuthError('INVALID_CREDENTIALS', 'Usuario ou senha invalidos');
  }
  return { username, displayName: user.displayName };
}

async function getUser(username) {
  const snap = await usersCol().doc(normalizeUsername(username)).get();
  if (!snap.exists) throw new AuthError('USER_NOT_FOUND', 'Usuario nao encontrado');
  return { username: snap.id, ...snap.data() };
}

async function incrementStats(username, deltas) {
  const ref = usersCol().doc(normalizeUsername(username));
  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) return;
    const data = snap.data();
    const updates = {};
    for (const [key, delta] of Object.entries(deltas)) {
      updates[key] = (data[key] || 0) + delta;
    }
    t.update(ref, updates);
  });
}

async function listRanking() {
  const snap = await usersCol().orderBy('wins', 'desc').get();
  return snap.docs.map((doc) => {
    const data = doc.data();
    return {
      username: doc.id,
      displayName: data.displayName,
      wins: data.wins || 0,
      racesPlayed: data.racesPlayed || 0,
      lapsCompleted: data.lapsCompleted || 0,
    };
  });
}

module.exports = {
  AuthError,
  signup,
  login,
  getUser,
  incrementStats,
  listRanking,
  normalizeUsername,
};
