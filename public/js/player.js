import { db } from './firebase-init.js';
import {
  doc,
  onSnapshot,
  collection,
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';
import { esc, dashboardHTML, captureNeedles, animateNeedles, createPanelSlider } from './dashboard.js';

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

    watchingCard: document.getElementById('watching-card'),
    watchingStatus: document.getElementById('watching-status'),
    swapPopup: document.getElementById('swap-popup'),
    swapPopupText: document.getElementById('swap-popup-text'),
    btnCloseSwap: document.getElementById('btn-close-swap'),

    panelTabs: document.getElementById('panel-tabs'),
    slider: document.getElementById('panel-slider'),
    myDash: document.getElementById('my-dash'),

    btnRefuel: document.getElementById('btn-refuel'),
    tireSelect: document.getElementById('tire-select'),
    btnChangeTire: document.getElementById('btn-change-tire'),
    btnRepairTire: document.getElementById('btn-repair-tire'),
    finesList: document.getElementById('fines-list'),
    btnLap: document.getElementById('btn-lap'),
  };

  function popAnimate(el) {
    el.classList.remove('dice-pop');
    // eslint-disable-next-line no-unused-expressions
    void el.offsetWidth; // forca reflow pra poder re-rodar a animacao
    el.classList.add('dice-pop');
  }

  let latestGame = null;
  let latestPlayerRaw = null;
  let latestFines = [];
  let latestPlayersRaw = [];
  const seenRollAt = {}; // playerId -> timestamp da ultima rolagem ja animada
  const panels = createPanelSlider(el.slider, el.panelTabs);

  function finesTotalOf(id) {
    return latestFines.filter((f) => f.playerId === id).reduce((sum, f) => sum + f.amount, 0);
  }

  function render() {
    if (!latestGame || !latestPlayerRaw) return;
    const player = window.GameCalc.serializePlayer(latestPlayerRaw);

    el.color.style.background = player.color;
    el.name.textContent = player.name;
    el.gameStatus.textContent = `Corrida: ${latestGame.name} — status: ${latestGame.status}`;

    // Seu painel
    captureNeedles(el.myDash);
    el.myDash.innerHTML = dashboardHTML(player, { finesTotal: finesTotalOf(playerId), totalLaps: latestGame.totalLaps, isMe: true });
    animateNeedles(el.myDash);
    if (document.activeElement !== el.tireSelect) el.tireSelect.value = player.tire.brand;

    const playerFines = latestFines.filter((f) => f.playerId === playerId);
    el.finesList.innerHTML = playerFines
      .map((f) => `<div>R$ ${f.amount.toLocaleString('pt-BR')} — ${esc(f.reason || 'sem motivo')}</div>`)
      .join('') || '<div>Nenhuma multa aplicada.</div>';

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

    // Paineis dos adversarios: um slide por piloto, depois do seu (slide fixo no HTML)
    const opponents = latestPlayersRaw
      .filter((p) => p.id !== playerId)
      .map((p) => window.GameCalc.serializePlayer(p));

    const slides = panels.syncSlides(opponents.map((o) => o.id), 1);
    opponents.forEach((opp, i) => {
      const slide = slides[i];
      captureNeedles(slide);
      slide.innerHTML = `
        <div class="opp-header">
          <span class="color-dot" style="background:${esc(opp.color)}"></span>
          <h3>${esc(opp.name)}</h3>
          <span class="small">ultimo dado: <strong>${opp.lastRoll ? opp.lastRoll.value : '—'}</strong></span>
        </div>
        ${dashboardHTML(opp, { finesTotal: finesTotalOf(opp.id), totalLaps: latestGame.totalLaps })}
      `;
      animateNeedles(slide);
    });

    // Abas: voce + adversarios, com o ultimo numero que cada um tirou
    panels.renderTabs([
      { id: playerId, name: 'Voce', color: player.color, showRoll: false },
      ...opponents.map((o) => ({ id: o.id, name: o.name, color: o.color, lastRoll: o.lastRoll, showRoll: true })),
    ]);
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
