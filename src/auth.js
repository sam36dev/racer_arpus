'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-troque-em-producao';
const TOKEN_EXPIRES_IN = '90d'; // app entre amigos, sessao longa pra nao pedir login toda hora

function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function signToken(username) {
  return jwt.sign({ username }, JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET); // lanca erro se invalido/expirado
}

// Middleware: exige "Authorization: Bearer <token>", preenche req.user = { username }
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Nao autenticado' });

  try {
    const payload = verifyToken(token);
    req.user = { username: payload.username };
    next();
  } catch (err) {
    res.status(401).json({ error: 'Sessao invalida ou expirada, faca login de novo' });
  }
}

// Preenche req.user quando ha token valido, mas nao bloqueia se nao tiver
// (usado nas rotas antigas que ainda funcionam sem login, ex: entrar numa corrida anonimo).
function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      req.user = { username: verifyToken(token).username };
    } catch (err) {
      // token invalido/expirado: segue sem usuario logado
    }
  }
  next();
}

function isAdmin(username) {
  const admins = (process.env.ADMIN_USERNAMES || '')
    .split(',')
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(String(username).toLowerCase());
}

function requireAdmin(req, res, next) {
  if (!req.user || !isAdmin(req.user.username)) {
    return res.status(403).json({ error: 'Apenas o admin pode fazer isso' });
  }
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  requireAuth,
  optionalAuth,
  requireAdmin,
  isAdmin,
};
