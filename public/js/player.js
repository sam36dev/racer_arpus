import { db } from './firebase-init.js';
import {
  doc,
  onSnapshot,
  collection,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

(function () {
  const params = new URLSearchParams(window.location.search);
  const gameId = params.get('game');
  const playerId = params.get('player');

  if (!gameId || !playerId) {
    document.body.innerHTML = '<div class="container"><p>Link invalido. Volte e entre novamente pela tela inicial.</p></div>';
    return;
  }

  const api = (action, body) =>
    fetch(`/api/games/${gameId}/players/${playerId}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro na acao');
      return data;
    });

  const el = {
    color: document.getElementById('p-color'),
    name: document.getElementById('p-name'),
    gameStatus: document.getElementById('p-game-status'),
    diceResult: document.getElementById('dice-result'),
    btnRoll: document.getElementById('btn-roll'),
    rollError: document.getElementById('roll-error'),

    fuelPercent: document.getElementById('fuel-percent'),
    fuelBar: document.getElementById('fuel-bar'),
    fuelWarning: document.getElementById('fuel-warning'),
    fuelEmpty: document.getElementById('fuel-empty'),
    btnRefuel: document.getElementById('btn-refuel'),

    tireLabel: document.getElementById('tire-label'),
    tireRolls: document.getElementById('tire-rolls'),
    tireBar: document.getElementById('tire-bar'),
    tirePenalty: document.getElementById('tire-penalty'),
    tireEliminated: document.getElementById('tire-eliminated'),
    tireSelect: document.getElementById('tire-select'),
    btnChangeTire: document.getElementById('btn-change-tire'),
    btnRepairTire: document.getElementById('btn-repair-tire'),

    finesTotal: document.getElementById('fines-total'),
    finesList: document.getElementById('fines-list'),

    turboPosition: document.getElementById('turbo-position'),
    turboDiceBadge: document.getElementById('turbo-dice-badge'),
    diceBadge: document.getElementById('dice-badge'),
    tireOverrideNote: document.getElementById('tire-override-note'),

    lapsCurrent: document.getElementById('laps-current'),
    lapsTotal: document.getElementById('laps-total'),
    btnLap: document.getElementById('btn-lap'),
  };

  function barColor(percent) {
    if (percent <= 30) return 'var(--red)';
    if (percent <= 60) return 'var(--orange)';
    return 'var(--green)';
  }

  let latestGame = null;
  let latestPlayerRaw = null;
  let latestFines = [];

  function render() {
    if (!latestGame || !latestPlayerRaw) return;
    const player = window.GameCalc.serializePlayer(latestPlayerRaw);

    el.color.style.background = player.color;
    el.name.textContent = player.name;
    el.gameStatus.textContent = `Corrida: ${latestGame.name} — status: ${latestGame.status}`;

    // Combustivel
    el.fuelPercent.textContent = `${player.fuel.percent}%`;
    el.fuelBar.style.width = `${player.fuel.percent}%`;
    el.fuelBar.style.background = barColor(player.fuel.percent);
    if (player.fuel.empty) {
      el.fuelEmpty.style.display = 'block';
      el.fuelWarning.style.display = 'none';
    } else if (player.fuel.warning) {
      el.fuelEmpty.style.display = 'none';
      el.fuelWarning.style.display = 'block';
      el.fuelWarning.textContent = `Voce tem mais ${player.fuel.rollsLeft} rodada(s) antes de ficar sem combustivel!`;
    } else {
      el.fuelEmpty.style.display = 'none';
      el.fuelWarning.style.display = 'none';
    }

    // Pneu
    const tirePercent = Math.round((player.tire.level / player.tire.levelMax) * 100);
    el.tireLabel.textContent = `${player.tire.label} — nivel ${player.tire.level}/${player.tire.levelMax}`;
    el.tireRolls.textContent = `${player.tire.rollsUntilNextLevel} rolagens ate o proximo nivel`;
    el.tireBar.style.width = `${tirePercent}%`;
    el.tireBar.style.background = barColor(tirePercent);
    el.tireSelect.value = player.tire.brand;

    if (player.eliminated) {
      el.tireEliminated.style.display = 'block';
      el.tirePenalty.style.display = 'none';
    } else {
      el.tireEliminated.style.display = 'none';
      if (player.tire.penaltyDice) {
        el.tirePenalty.style.display = 'block';
        el.tirePenalty.textContent = `Pneu gasto: dado limitado a d${player.tire.penaltyDice}!`;
      } else {
        el.tirePenalty.style.display = 'none';
      }
    }

    // Multas
    const playerFines = latestFines.filter((f) => f.playerId === playerId);
    const total = playerFines.reduce((sum, f) => sum + f.amount, 0);
    el.finesTotal.textContent = `R$ ${total.toLocaleString('pt-BR')}`;
    el.finesList.innerHTML = playerFines
      .map((f) => `<div>R$ ${f.amount.toLocaleString('pt-BR')} — ${f.reason || 'sem motivo'}</div>`)
      .join('') || '<div>Nenhuma multa aplicada.</div>';

    // Turbo / nivel
    el.turboPosition.textContent = player.turboPosition;
    el.turboDiceBadge.textContent = `d${player.turboDiceType}`;
    el.diceBadge.textContent = `d${player.diceType}`;
    el.tireOverrideNote.style.display = player.diceType < player.turboDiceType ? 'block' : 'none';

    // Voltas
    el.lapsCurrent.textContent = player.laps;
    el.lapsTotal.textContent = latestGame.totalLaps;

    // Bloqueios de rolagem
    const blocked = player.eliminated || player.fuel.empty;
    el.btnRoll.disabled = blocked || latestGame.status === 'finished';
  }

  onSnapshot(doc(db, 'games', gameId), (snap) => {
    if (!snap.exists()) return;
    latestGame = snap.data();
    render();
  });

  onSnapshot(doc(db, 'games', gameId, 'players', playerId), (snap) => {
    if (!snap.exists()) return;
    latestPlayerRaw = { id: snap.id, ...snap.data() };
    render();
  });

  onSnapshot(collection(db, 'games', gameId, 'fines'), (snap) => {
    latestFines = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  });

  el.btnRoll.addEventListener('click', async () => {
    el.rollError.style.display = 'none';
    try {
      const res = await api('roll');
      el.diceResult.style.display = 'block';
      el.diceResult.textContent = res.value;
    } catch (err) {
      el.rollError.style.display = 'block';
      el.rollError.textContent = err.message;
    }
  });

  el.btnRefuel.addEventListener('click', () => api('refuel').catch(() => {}));

  el.btnChangeTire.addEventListener('click', () => {
    const brand = el.tireSelect.value;
    api('change-tire-brand', { brand }).catch(() => {});
  });

  el.btnRepairTire.addEventListener('click', () => api('repair-tire').catch(() => {}));

  el.btnLap.addEventListener('click', () => api('complete-lap').catch(() => {}));
})();
