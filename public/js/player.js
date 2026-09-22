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

  // Desabilita o botao e mostra "..." enquanto a requisicao esta em voo, pra
  // dar feedback imediato mesmo quando o servidor demora (cold start na Vercel).
  function busyClick(button, fn) {
    button.addEventListener('click', async () => {
      const original = button.textContent;
      button.disabled = true;
      button.textContent = '...';
      try {
        await fn();
      } finally {
        button.disabled = false;
        button.textContent = original;
      }
    });
  }

  const el = {
    color: document.getElementById('p-color'),
    name: document.getElementById('p-name'),
    gameStatus: document.getElementById('p-game-status'),
    diceResult: document.getElementById('dice-result'),
    btnRoll: document.getElementById('btn-roll'),
    rollError: document.getElementById('roll-error'),

    cardReveal: document.getElementById('card-reveal'),
    cardIcon: document.getElementById('card-icon'),
    cardName: document.getElementById('card-name'),
    cardDescription: document.getElementById('card-description'),

    watchingCard: document.getElementById('watching-card'),
    watchingStatus: document.getElementById('watching-status'),
    swapPopup: document.getElementById('swap-popup'),
    swapPopupText: document.getElementById('swap-popup-text'),
    btnCloseSwap: document.getElementById('btn-close-swap'),

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
    activeEffectsList: document.getElementById('active-effects-list'),

    lapsCurrent: document.getElementById('laps-current'),
    lapsTotal: document.getElementById('laps-total'),
    btnLap: document.getElementById('btn-lap'),

    opponentsList: document.getElementById('opponents-list'),
  };

  function popAnimate(el) {
    el.classList.remove('dice-pop');
    // eslint-disable-next-line no-unused-expressions
    void el.offsetWidth; // forca reflow pra poder re-rodar a animacao
    el.classList.add('dice-pop');
  }

  function barColor(percent) {
    if (percent <= 30) return 'var(--red)';
    if (percent <= 60) return 'var(--orange)';
    return 'var(--green)';
  }

  let latestGame = null;
  let latestPlayerRaw = null;
  let latestFines = [];
  let latestPlayersRaw = [];
  const seenRollAt = {}; // playerId -> timestamp da ultima rolagem ja animada
  let seenCardAt = null; // timestamp da ultima carta da sorte ja animada neste jogador

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

    el.activeEffectsList.innerHTML = player.activeEffects
      .map((eff) => `<span class="badge tag-effect">${eff.label}</span>`)
      .join('');

    // Transmissao Sequencial: acompanhamento do oponente observado + aviso "troque de lugar"
    if (player.watching) {
      const seen = player.watching.seenValues || [];
      const seenSorted = seen.slice().sort((a, b) => a - b).join(', ') || 'nenhum ainda';
      el.watchingCard.style.display = 'block';
      el.watchingStatus.textContent =
        `Observando ${player.watching.targetName}: ja saiu ${seen.length}/${player.watching.targetDiceType} ` +
        `numero(s) do dado dele (${seenSorted}).`;

      if (player.watching.triggered) {
        el.swapPopup.style.display = 'block';
        el.swapPopupText.textContent = `${player.watching.targetName} tirou todos os numeros do dado! Troquem de lugar no tabuleiro.`;
      } else {
        el.swapPopup.style.display = 'none';
      }
    } else {
      el.watchingCard.style.display = 'none';
      el.swapPopup.style.display = 'none';
    }

    // Voltas
    el.lapsCurrent.textContent = player.laps;
    el.lapsTotal.textContent = latestGame.totalLaps;

    // Bloqueios de rolagem
    const blocked = player.eliminated || player.fuel.empty;
    el.btnRoll.disabled = blocked || latestGame.status === 'finished';

    // Rolagem persistida do proprio jogador (sincroniza entre abas/recarregamentos)
    if (player.lastRoll && seenRollAt[playerId] !== player.lastRoll.at) {
      seenRollAt[playerId] = player.lastRoll.at;
      el.diceResult.style.display = 'block';
      el.diceResult.textContent = player.lastRoll.value;
      popAnimate(el.diceResult);
    }

    // Carta da sorte ativada pelo mestre pra este jogador
    if (player.lastCard) {
      el.cardReveal.style.display = 'block';
      el.cardIcon.textContent = player.lastCard.icon;
      el.cardName.textContent = player.lastCard.name;
      el.cardDescription.textContent = player.lastCard.description;
      if (seenCardAt !== player.lastCard.at) {
        seenCardAt = player.lastCard.at;
        popAnimate(el.cardReveal);
      }
    }

    // Outros pilotos: mostra o ultimo numero que cada um tirou
    const opponents = latestPlayersRaw
      .filter((p) => p.id !== playerId)
      .map((p) => window.GameCalc.serializePlayer(p));

    el.opponentsList.innerHTML = opponents.length
      ? ''
      : '<p class="small">Ninguem alem de voce entrou ainda.</p>';

    opponents.forEach((opp) => {
      const row = document.createElement('div');
      row.className = 'opponent-row';
      const hasRoll = !!opp.lastRoll;
      row.innerHTML = `
        <span class="color-dot" style="background:${opp.color}"></span>
        <span class="name">${opp.name}</span>
        <span class="roll-value ${hasRoll ? '' : 'empty'}">${hasRoll ? opp.lastRoll.value : '—'}</span>
      `;
      el.opponentsList.appendChild(row);

      if (hasRoll && seenRollAt[opp.id] !== opp.lastRoll.at) {
        seenRollAt[opp.id] = opp.lastRoll.at;
        if (seenRollAt[opp.id + ':init'] !== undefined) {
          popAnimate(row.querySelector('.roll-value'));
        }
        seenRollAt[opp.id + ':init'] = true;
      }
    });
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

  onSnapshot(collection(db, 'games', gameId, 'players'), (snap) => {
    latestPlayersRaw = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  });

  busyClick(el.btnRoll, async () => {
    el.rollError.style.display = 'none';
    try {
      await api('roll');
    } catch (err) {
      el.rollError.style.display = 'block';
      el.rollError.textContent = err.message;
    }
  });

  busyClick(el.btnRefuel, () => api('refuel').catch(() => {}));

  busyClick(el.btnChangeTire, () => {
    const brand = el.tireSelect.value;
    return api('change-tire-brand', { brand }).catch(() => {});
  });

  busyClick(el.btnRepairTire, () => api('repair-tire').catch(() => {}));

  busyClick(el.btnLap, () => api('complete-lap').catch(() => {}));

  // Fecha o aviso "troque de lugar" - e a propria Transmissao Sequencial se desativa
  // (mesmo endpoint que o mestre usa pra desligar efeitos continuos manualmente).
  busyClick(el.btnCloseSwap, () => api('clear-effect', { field: 'watching' }).catch(() => {}));
})();
