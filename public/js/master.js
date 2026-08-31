import { db } from './firebase-init.js';
import {
  doc,
  onSnapshot,
  collection,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

(function () {
  const params = new URLSearchParams(window.location.search);
  const gameId = params.get('game');

  if (!gameId) {
    document.body.innerHTML = '<div class="container"><p>Nenhum jogo especificado.</p></div>';
    return;
  }

  const myPlayerId = localStorage.getItem(`racer-my-player-${gameId}`);

  const api = (playerId, action, body) =>
    fetch(`/api/games/${gameId}/players/${playerId}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro na acao');
      return data;
    });

  const grid = document.getElementById('player-grid');
  const gameNameEl = document.getElementById('game-name');
  const gameCodeEl = document.getElementById('game-code');
  const gameStatusEl = document.getElementById('game-status');
  const winnerBanner = document.getElementById('winner-banner');
  const winnerText = document.getElementById('winner-text');

  gameCodeEl.textContent = gameId;

  const lastRolls = {}; // playerId -> ultimo valor rolado (sobrevive ao re-render)
  let latestGame = null;
  let latestPlayersRaw = [];
  let latestFines = [];

  function barColor(percent) {
    if (percent <= 30) return 'var(--red)';
    if (percent <= 60) return 'var(--orange)';
    return 'var(--green)';
  }

  function playerCard(player) {
    const fines = latestFines.filter((f) => f.playerId === player.id);
    const finesTotal = fines.reduce((sum, f) => sum + f.amount, 0);
    const tirePercent = Math.round((player.tire.level / player.tire.levelMax) * 100);

    const isMine = player.id === myPlayerId;
    const rollBlocked = player.eliminated || player.fuel.empty || latestGame.status === 'finished';

    const div = document.createElement('div');
    div.className = isMine ? 'card card-mine' : 'card';
    div.innerHTML = `
      <div class="player-header">
        <div class="color-dot" style="background:${player.color}"></div>
        <h3>${player.name}</h3>
        <span class="badge tag-dice">d${player.diceType}</span>
        ${isMine ? '<span class="badge" style="background:var(--green);color:#04241f;">SEU CARRO</span>' : ''}
      </div>

      <div class="dice-result-mini" style="display:none;"></div>
      <button class="btn-roll ${isMine ? 'dice-btn' : 'secondary full-width'}" ${rollBlocked ? 'disabled' : ''}>Rolar dado${isMine ? '' : ' (por este piloto)'}</button>
      <div class="roll-error-mini danger-banner" style="display:none;"></div>

      <div class="bar-label"><span>⛽ Combustivel</span><span class="bar-value">${player.fuel.percent}% (${player.fuel.rollsLeft} rolagens)</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${player.fuel.percent}%; background:${barColor(player.fuel.percent)};"></div></div>
      ${player.fuel.empty ? '<div class="danger-banner">SEM COMBUSTIVEL</div>' : player.fuel.warning ? '<div class="warning-banner">Combustivel acabando</div>' : ''}
      <button class="secondary full-width btn-refuel">Abastecer +1</button>

      <div class="bar-label mt-24"><span>🛞 ${player.tire.label} — nivel ${player.tire.level}/${player.tire.levelMax}</span><span class="bar-value">${player.tire.rollsUntilNextLevel} p/ proximo</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${tirePercent}%; background:${barColor(tirePercent)};"></div></div>
      ${player.eliminated ? '<div class="danger-banner">ELIMINADO</div>' : player.tire.penaltyDice ? `<div class="warning-banner">Dado limitado a d${player.tire.penaltyDice} pelo pneu</div>` : ''}
      <div class="btn-row">
        <button class="secondary btn-repair-tire">Reparar (+1 nivel)</button>
        <button class="danger btn-damage-tire">Penalizar (-1 nivel)</button>
      </div>
      <div class="btn-row">
        <select class="tire-select">
          <option value="pirelli" ${player.tire.brand === 'pirelli' ? 'selected' : ''}>Pirelli (20)</option>
          <option value="continental" ${player.tire.brand === 'continental' ? 'selected' : ''}>Continental (25)</option>
          <option value="michelin" ${player.tire.brand === 'michelin' ? 'selected' : ''}>Michelin (30)</option>
        </select>
        <button class="secondary btn-change-tire">Trocar marca</button>
      </div>

      <div class="bar-label mt-24"><span>📋 Multas</span><span class="bar-value">R$ ${finesTotal.toLocaleString('pt-BR')}</span></div>
      <div class="btn-row">
        <input type="number" class="fine-amount" placeholder="Valor (R$)" value="1000" style="flex:1" />
        <input type="text" class="fine-reason" placeholder="Motivo" style="flex:2" />
      </div>
      <button class="danger full-width btn-apply-fine">Aplicar multa</button>

      <div class="bar-label mt-24"><span>🌀 Turbo (posicao ${player.turboPosition})</span></div>
      <button class="secondary full-width btn-upgrade-turbo">Subir nivel de turbo</button>

      <div class="bar-label mt-24"><span>🏁 Voltas</span><span class="bar-value">${player.laps}/${latestGame.totalLaps}</span></div>
      <button class="secondary full-width btn-lap">+1 volta</button>
    `;

    if (lastRolls[player.id] != null) {
      const resultEl = div.querySelector('.dice-result-mini');
      resultEl.style.display = 'block';
      resultEl.textContent = lastRolls[player.id];
    }

    div.querySelector('.btn-roll').addEventListener('click', async () => {
      const errorEl = div.querySelector('.roll-error-mini');
      errorEl.style.display = 'none';
      try {
        const res = await api(player.id, 'roll');
        lastRolls[player.id] = res.value;
        const resultEl = div.querySelector('.dice-result-mini');
        resultEl.style.display = 'block';
        resultEl.textContent = res.value;
      } catch (err) {
        errorEl.style.display = 'block';
        errorEl.textContent = err.message;
      }
    });

    div.querySelector('.btn-refuel').addEventListener('click', () => {
      api(player.id, 'refuel').catch(() => {});
    });
    div.querySelector('.btn-change-tire').addEventListener('click', () => {
      const brand = div.querySelector('.tire-select').value;
      api(player.id, 'change-tire-brand', { brand }).catch(() => {});
    });
    div.querySelector('.btn-repair-tire').addEventListener('click', () => {
      api(player.id, 'repair-tire').catch(() => {});
    });
    div.querySelector('.btn-damage-tire').addEventListener('click', () => {
      api(player.id, 'damage-tire').catch(() => {});
    });
    div.querySelector('.btn-apply-fine').addEventListener('click', () => {
      const amount = div.querySelector('.fine-amount').value;
      const reason = div.querySelector('.fine-reason').value;
      if (!amount || Number(amount) <= 0) return;
      api(player.id, 'fine', { amount, reason }).catch(() => {});
      div.querySelector('.fine-reason').value = '';
    });
    div.querySelector('.btn-upgrade-turbo').addEventListener('click', () => {
      api(player.id, 'upgrade-turbo').catch(() => {});
    });
    div.querySelector('.btn-lap').addEventListener('click', () => {
      api(player.id, 'complete-lap').catch(() => {});
    });

    return div;
  }

  function render() {
    if (!latestGame) return;

    gameNameEl.textContent = latestGame.name;
    gameStatusEl.textContent = latestGame.status;
    gameStatusEl.className = `status-pill status-${latestGame.status}`;

    const players = latestPlayersRaw.map((p) => window.GameCalc.serializePlayer(p));

    if (latestGame.status === 'finished' && latestGame.winnerPlayerId) {
      const winner = players.find((p) => p.id === latestGame.winnerPlayerId);
      winnerBanner.style.display = 'block';
      winnerText.textContent = winner ? `🏆 ${winner.name} venceu a corrida!` : 'Corrida finalizada';
    } else {
      winnerBanner.style.display = 'none';
    }

    grid.innerHTML = '';
    const ordered = [...players].sort((a, b) => (a.id === myPlayerId ? -1 : b.id === myPlayerId ? 1 : 0));
    ordered.forEach((player) => grid.appendChild(playerCard(player)));
  }

  onSnapshot(doc(db, 'games', gameId), (snap) => {
    if (!snap.exists()) return;
    latestGame = snap.data();
    render();
  });

  onSnapshot(collection(db, 'games', gameId, 'players'), (snap) => {
    latestPlayersRaw = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  });

  onSnapshot(collection(db, 'games', gameId, 'fines'), (snap) => {
    latestFines = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  });

  document.getElementById('btn-add-player').addEventListener('click', async () => {
    const nameInput = document.getElementById('new-player-name');
    const name = nameInput.value.trim();
    if (!name) return;
    await fetch(`/api/games/${gameId}/players`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    nameInput.value = '';
  });
})();
