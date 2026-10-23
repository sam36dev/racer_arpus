'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const game = require('./src/gameLogic');
const users = require('./src/users');
const achievementsMod = require('./src/achievements');
const luckCards = require('./src/luckCards');
const { signToken, optionalAuth, requireAuth, requireAdmin, isAdmin } = require('./src/auth');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function wrap(fn) {
  return async (req, res) => {
    try {
      const result = await fn(req, res);
      res.json(result);
    } catch (err) {
      const status = err.code === 'GAME_NOT_FOUND' || err.code === 'PLAYER_NOT_FOUND' ? 404
        : err.code === 'HOST_ONLY' || err.code === 'PLAYER_ONLY' ? 403 : 400;
      res.status(status).json({ error: err.message, code: err.code });
    }
  };
}

// Rotas de mestre: o piloto so rola o dado (pedido do usuario) - todo o resto exige a chave
// do mestre no header X-Host-Key (gerada no createGame, guardada no navegador de quem criou).
function requireHost(req, res, next) {
  game
    .checkHostKey(req.params.gameId, req.get('X-Host-Key'))
    .then(() => next())
    .catch((err) => res.status(err.code === 'HOST_ONLY' ? 403 : 400).json({ error: err.message, code: err.code }));
}

app.post(
  '/api/games',
  wrap(async (req) => game.createGame(req.body.name, req.body.totalLaps, req.body.raceType))
);

app.get(
  '/api/games/:gameId',
  wrap(async (req) => game.serializeGame(req.params.gameId))
);

app.post(
  '/api/games/:gameId/players',
  optionalAuth,
  wrap(async (req) => {
    const userId = req.user ? req.user.username : null;
    const name = req.body.name || (req.user ? req.user.username : 'Piloto');
    const p = await game.addPlayer(req.params.gameId, name, req.body.color, userId);
    // playerKey so volta aqui - quem entrou guarda no localStorage e manda nas acoes do proprio piloto
    return { ...game.serializePlayer(p), playerKey: p.playerKey };
  })
);

app.post(
  '/api/games/:gameId/players/:playerId/roll',
  wrap(async (req) => {
    const result = await game.rollDice(req.params.gameId, req.params.playerId);
    return { value: result.value, diceType: result.diceType };
  })
);

// Posto: o mestre libera/bloqueia; o piloto (ou o mestre por ele) rola o dado do posto.
app.post(
  '/api/games/:gameId/players/:playerId/fuel-station',
  requireHost,
  wrap(async (req) => {
    const p = await game.setFuelStation(req.params.gameId, req.params.playerId, !!req.body.open);
    return game.serializePlayer(p);
  })
);

app.post(
  '/api/games/:gameId/players/:playerId/roll-fuel',
  wrap(async (req) => {
    await game.checkPlayerOrHostKey(req.params.gameId, req.params.playerId, req.get('X-Player-Key'), req.get('X-Host-Key'));
    const { value } = await game.rollFuelStation(req.params.gameId, req.params.playerId);
    return { value };
  })
);

app.post(
  '/api/games/:gameId/players/:playerId/repair-tire',
  requireHost,
  wrap(async (req) => {
    const p = await game.repairTire(req.params.gameId, req.params.playerId);
    return game.serializePlayer(p);
  })
);

app.post(
  '/api/games/:gameId/players/:playerId/damage-tire',
  requireHost,
  wrap(async (req) => {
    const p = await game.damageTire(req.params.gameId, req.params.playerId);
    return game.serializePlayer(p);
  })
);

app.post(
  '/api/games/:gameId/players/:playerId/eliminate',
  requireHost,
  wrap(async (req) => {
    const p = await game.eliminatePlayer(req.params.gameId, req.params.playerId, req.body.pin);
    return game.serializePlayer(p);
  })
);

app.post(
  '/api/games/:gameId/players/:playerId/change-tire-brand',
  requireHost,
  wrap(async (req) => {
    const p = await game.changeTireBrand(req.params.gameId, req.params.playerId, req.body.brand);
    return game.serializePlayer(p);
  })
);

app.post(
  '/api/games/:gameId/players/:playerId/upgrade-turbo',
  requireHost,
  wrap(async (req) => {
    const delta = req.body.delta != null ? Number(req.body.delta) : 1;
    const p = await game.upgradeTurbo(req.params.gameId, req.params.playerId, delta);
    return game.serializePlayer(p);
  })
);

app.post(
  '/api/games/:gameId/players/:playerId/complete-lap',
  requireHost,
  wrap(async (req) => game.completeLap(req.params.gameId, req.params.playerId))
);

app.post(
  '/api/games/:gameId/players/:playerId/fine',
  requireHost,
  wrap(async (req) => {
    const fines = await game.applyFine(
      req.params.gameId,
      req.params.playerId,
      Number(req.body.amount),
      req.body.reason
    );
    return { fines };
  })
);

app.post(
  '/api/games/:gameId/players/:playerId/clear-fines',
  requireHost,
  wrap(async (req) => {
    const fines = await game.clearFines(req.params.gameId, req.params.playerId);
    return { fines };
  })
);

app.post(
  '/api/games/:gameId/fines/:fineId/remove',
  requireHost,
  wrap(async (req) => {
    const fines = await game.removeFine(req.params.gameId, req.params.fineId);
    return { fines };
  })
);

// --- Dinheiro: piloto transfere (pra outro piloto ou pro banco); so o mestre faz o banco pagar ---

app.post(
  '/api/games/:gameId/players/:playerId/transfer-money',
  wrap(async (req) => {
    await game.checkPlayerOrHostKey(req.params.gameId, req.params.playerId, req.get('X-Player-Key'), req.get('X-Host-Key'));
    const p = await game.transferMoney(req.params.gameId, req.params.playerId, req.body.to, req.body.amount, req.body.reason);
    return game.serializePlayer(p);
  })
);

app.post(
  '/api/games/:gameId/players/:playerId/bank-pay',
  requireHost,
  wrap(async (req) => {
    const p = await game.bankPay(req.params.gameId, req.params.playerId, req.body.amount, req.body.reason);
    return game.serializePlayer(p);
  })
);

// --- Cartas da sorte (baralho fisico - o mestre le a carta e ativa pro jogador certo) ---

app.get(
  '/api/luck-cards/catalog',
  wrap(async () => luckCards.catalog())
);

app.post(
  '/api/games/:gameId/players/:playerId/activate-card',
  requireHost,
  wrap(async (req) => {
    const p = await game.activateCard(
      req.params.gameId,
      req.params.playerId,
      req.body.cardId,
      req.body.targetPlayerId
    );
    return game.serializePlayer(p);
  })
);

app.post(
  '/api/games/:gameId/players/:playerId/clear-effect',
  wrap(async (req) => {
    // Unica excecao: o proprio piloto fecha o aviso "troque de lugar" (desliga o 'watching').
    if (req.body.field !== 'watching') await game.checkHostKey(req.params.gameId, req.get('X-Host-Key'));
    const p = await game.clearEffect(req.params.gameId, req.params.playerId, req.body.field);
    return game.serializePlayer(p);
  })
);

app.post(
  '/api/games/:gameId/reset-luck-cards',
  requireHost,
  wrap(async (req) => game.resetLuckCards(req.params.gameId))
);

app.post(
  '/api/games/:gameId/players/:playerId/transfer-effect',
  requireHost,
  wrap(async (req) => {
    const { to } = await game.transferEffect(
      req.params.gameId,
      req.params.playerId,
      req.body.toPlayerId,
      req.body.field
    );
    return game.serializePlayer(to);
  })
);

// --- Autenticacao (usuario/senha, sem email - app entre amigos) ---

app.post(
  '/api/auth/signup',
  wrap(async (req) => {
    const { username } = await users.signup(req.body.username, req.body.password, req.body.confirmPassword);
    const token = signToken(username);
    return { token, username };
  })
);

app.post(
  '/api/auth/login',
  wrap(async (req) => {
    const { username, displayName } = await users.login(req.body.username, req.body.password);
    const token = signToken(username);
    return { token, username, displayName };
  })
);

app.get(
  '/api/auth/me',
  requireAuth,
  wrap(async (req) => {
    const user = await users.getUser(req.user.username);
    return { username: user.username, displayName: user.displayName, isAdmin: isAdmin(user.username) };
  })
);

// --- Ranking ---

app.get(
  '/api/ranking',
  wrap(async () => users.listRanking())
);

// --- Conquistas ---

app.get(
  '/api/achievements/catalog',
  wrap(async () => achievementsMod.catalog())
);

app.get(
  '/api/users/:username/achievements',
  wrap(async (req) => {
    const unlocked = await achievementsMod.listUnlocked(req.params.username);
    const unlockedIds = new Set(unlocked.map((a) => a.achievementId));
    return achievementsMod.catalog().map((a) => ({
      ...a,
      unlocked: unlockedIds.has(a.id),
      unlockedAt: unlocked.find((u) => u.achievementId === a.id)?.unlockedAt || null,
    }));
  })
);

app.post(
  '/api/admin/grant-achievement',
  requireAuth,
  requireAdmin,
  wrap(async (req) => {
    const granted = await achievementsMod.grantManual(req.body.username, req.body.achievementId, req.user.username);
    return { granted };
  })
);

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Racer Arpus rodando em http://localhost:${PORT}`);
  });
}

module.exports = app;
