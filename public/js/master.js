import { db } from './firebase-init.js';
import {
  doc,
  onSnapshot,
  collection,
  query,
  orderBy,
  limit,
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

  const grid = document.getElementById('player-grid');
  const gameNameEl = document.getElementById('game-name');
  const gameCodeEl = document.getElementById('game-code');
  const gameStatusEl = document.getElementById('game-status');
  const winnerBanner = document.getElementById('winner-banner');
  const winnerText = document.getElementById('winner-text');

  gameCodeEl.textContent = gameId;

  let latestGame = null;
  let latestPlayersRaw = [];
  let latestFines = [];
  let latestLuckLog = [];
  let luckCatalog = []; // catalogo de cartas da sorte, carregado uma vez da API
  const seenRollAt = {}; // playerId -> timestamp da ultima rolagem ja renderizada

  fetch('/api/luck-cards/catalog')
    .then((res) => res.json())
    .then((catalog) => {
      luckCatalog = catalog;
      render();
    });

  // --- Painel unico de ativar carta da sorte (fica no topo, escolhe carta + jogador). Os
  // elementos sao fixos no HTML (nao recriados a cada render), entao os listeners abaixo
  // sao ligados uma unica vez aqui fora - so as OPCOES dos selects sao atualizadas a cada
  // render, preservando a selecao atual do mestre quando o valor escolhido ainda existir.
  const luckCardSelect = document.getElementById('luck-activate-card');
  const luckPlayerSelect = document.getElementById('luck-activate-player');
  const luckPlayerLabel = document.getElementById('luck-activate-player-label');
  const luckTargetWrap = document.getElementById('luck-activate-target-wrap');
  const luckTargetSelect = document.getElementById('luck-activate-target');
  const luckTargetLabel = document.getElementById('luck-activate-target-label');
  const luckActivateError = document.getElementById('luck-activate-error');
  const btnActivateLuckCard = document.getElementById('btn-activate-luck-card');

  // Sempre com um placeholder vazio - nunca deixa um jogador "pre-selecionado" sem o mestre
  // escolher de proposito (evita aplicar em alguem por engano so porque sobrou de uma acao anterior).
  function setSelectOptions(select, optionsHtml, placeholder) {
    const previousValue = select.value;
    select.innerHTML = `<option value="">${placeholder}</option>${optionsHtml}`;
    if (previousValue && [...select.options].some((o) => o.value === previousValue)) {
      select.value = previousValue;
    }
  }

  function syncLuckTargetOptions() {
    const chosenPlayerId = luckPlayerSelect.value;
    setSelectOptions(
      luckTargetSelect,
      latestPlayersRaw
        .filter((p) => p.id !== chosenPlayerId)
        .map((p) => `<option value="${p.id}">${p.name}</option>`)
        .join(''),
      '-- escolha o oponente --'
    );
  }

  // Transmissao Sequencial inverte o papel de "Jogador": nao e quem sofre o efeito, e quem
  // RECEBE a carta e passa a observar o oponente escolhido. Rotulo muda pra deixar isso obvio.
  function syncLuckLabels() {
    const needsTarget = luckCardSelect.selectedOptions[0]?.dataset.needsTarget;
    luckPlayerLabel.textContent = needsTarget ? 'Quem recebe a carta (vai observar)' : 'Jogador';
    if (luckTargetLabel) luckTargetLabel.textContent = 'Quem vai ser observado (oponente)';
  }

  function syncLuckTargetVisibility() {
    const needsTarget = luckCardSelect.selectedOptions[0]?.dataset.needsTarget;
    luckTargetWrap.style.display = needsTarget ? 'block' : 'none';
    syncLuckLabels();
    if (needsTarget) syncLuckTargetOptions();
  }

  function refreshLuckActivatePanelOptions() {
    setSelectOptions(
      luckCardSelect,
      luckCatalog
        .map(
          (c) =>
            `<option value="${c.id}" data-needs-target="${c.effect.type === 'watchOpponent' ? '1' : ''}">${c.icon} ${c.name}</option>`
        )
        .join(''),
      '-- escolha a carta --'
    );
    setSelectOptions(
      luckPlayerSelect,
      latestPlayersRaw.map((p) => `<option value="${p.id}">${p.name}</option>`).join(''),
      '-- escolha o jogador --'
    );
    syncLuckTargetVisibility();
    btnActivateLuckCard.disabled = !luckCatalog.length || !latestPlayersRaw.length;
  }

  luckCardSelect.addEventListener('change', syncLuckTargetVisibility);
  luckPlayerSelect.addEventListener('change', syncLuckTargetOptions);

  busyClick(btnActivateLuckCard, async () => {
    luckActivateError.style.display = 'none';
    const cardId = luckCardSelect.value;
    const playerId = luckPlayerSelect.value;
    if (!cardId || !playerId) {
      luckActivateError.style.display = 'block';
      luckActivateError.textContent = 'Escolha a carta e o jogador.';
      return;
    }

    const needsTarget = luckCardSelect.selectedOptions[0]?.dataset.needsTarget;
    const targetPlayerId = luckTargetSelect.value;
    if (needsTarget && !targetPlayerId) {
      luckActivateError.style.display = 'block';
      luckActivateError.textContent = 'Escolha o oponente pra essa carta.';
      return;
    }

    try {
      await api(playerId, 'activate-card', { cardId, targetPlayerId: needsTarget ? targetPlayerId : undefined });
      // Reseta tudo depois de ativar com sucesso - proxima ativacao exige escolha explicita
      // de novo, pra nao aplicar em alguem por engano com selecao "grudada" da vez anterior.
      luckCardSelect.value = '';
      luckPlayerSelect.value = '';
      luckTargetSelect.value = '';
      syncLuckTargetVisibility();
    } catch (err) {
      luckActivateError.style.display = 'block';
      luckActivateError.textContent = err.message;
    }
  });

  function barColor(percent) {
    if (percent <= 30) return 'var(--red)';
    if (percent <= 60) return 'var(--orange)';
    return 'var(--green)';
  }

  function popAnimate(el) {
    el.classList.remove('dice-pop');
    void el.offsetWidth;
    el.classList.add('dice-pop');
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

      <div class="bar-label mt-24"><span>🌀 Turbo — posicao ${player.turboPosition} (d${player.turboDiceType})</span><span class="bar-value">${player.turbo.nextPosition != null ? `faltam ${player.turbo.nextPosition - player.turbo.position} p/ d${player.turbo.nextDice}` : 'maximo'}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${player.turbo.percent}%; background:var(--purple);"></div></div>
      <div class="btn-row">
        <button class="secondary btn-upgrade-turbo">Subir turbo (+1)</button>
        <button class="danger btn-downgrade-turbo">Diminuir turbo (-1)</button>
      </div>

      <div class="bar-label mt-24"><span>🏁 Voltas</span><span class="bar-value">${player.laps}/${latestGame.totalLaps}</span></div>
      <button class="secondary full-width btn-lap">+1 volta (gasta 1 nivel de pneu)</button>

      ${player.lastCard ? `
        <div class="bar-label mt-24"><span>🎴 Ultima carta</span></div>
        <div class="card-mini-reveal">${player.lastCard.icon} <strong>${player.lastCard.name}</strong> — ${player.lastCard.description}</div>
      ` : ''}

      ${player.activeEffects.length ? `
        <div class="bar-label mt-24"><span>⚡ Efeitos ativos</span></div>
        ${player.activeEffects.map((eff) => `
          <div class="effect-row" data-field="${eff.field}">
            <span class="badge tag-effect">${eff.label}</span>
            <button class="secondary btn-clear-effect" data-field="${eff.field}">✕ Remover</button>
            ${eff.transferable ? `<button class="secondary btn-transfer-effect" data-field="${eff.field}">➜ Transferir</button>` : ''}
            ${eff.transferable ? `
              <select class="transfer-target-select" data-field="${eff.field}" style="display:none;">
                <option value="">Enviar pra quem?</option>
                ${latestPlayersRaw.filter((p) => p.id !== player.id).map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}
              </select>
            ` : ''}
          </div>
        `).join('')}
        <div class="effect-error-mini danger-banner" style="display:none;"></div>
      ` : ''}
    `;

    if (player.lastRoll) {
      const resultEl = div.querySelector('.dice-result-mini');
      resultEl.style.display = 'block';
      resultEl.textContent = player.lastRoll.value;
      if (seenRollAt[player.id] !== player.lastRoll.at) {
        const wasSeenBefore = seenRollAt[player.id] !== undefined;
        seenRollAt[player.id] = player.lastRoll.at;
        if (wasSeenBefore) popAnimate(resultEl);
      }
    }

    busyClick(div.querySelector('.btn-roll'), async () => {
      const errorEl = div.querySelector('.roll-error-mini');
      errorEl.style.display = 'none';
      try {
        await api(player.id, 'roll');
      } catch (err) {
        errorEl.style.display = 'block';
        errorEl.textContent = err.message;
      }
    });

    busyClick(div.querySelector('.btn-refuel'), () => api(player.id, 'refuel').catch(() => {}));
    busyClick(div.querySelector('.btn-change-tire'), () => {
      const brand = div.querySelector('.tire-select').value;
      return api(player.id, 'change-tire-brand', { brand }).catch(() => {});
    });
    busyClick(div.querySelector('.btn-repair-tire'), () => api(player.id, 'repair-tire').catch(() => {}));
    busyClick(div.querySelector('.btn-damage-tire'), () => api(player.id, 'damage-tire').catch(() => {}));
    busyClick(div.querySelector('.btn-apply-fine'), () => {
      const amount = div.querySelector('.fine-amount').value;
      const reason = div.querySelector('.fine-reason').value;
      if (!amount || Number(amount) <= 0) return Promise.resolve();
      const p = api(player.id, 'fine', { amount, reason }).catch(() => {});
      div.querySelector('.fine-reason').value = '';
      return p;
    });
    busyClick(div.querySelector('.btn-upgrade-turbo'), () => api(player.id, 'upgrade-turbo', { delta: 1 }).catch(() => {}));
    busyClick(div.querySelector('.btn-downgrade-turbo'), () => api(player.id, 'upgrade-turbo', { delta: -1 }).catch(() => {}));
    busyClick(div.querySelector('.btn-lap'), () => api(player.id, 'complete-lap').catch(() => {}));

    const effectErrorEl = div.querySelector('.effect-error-mini');

    div.querySelectorAll('.btn-clear-effect').forEach((btn) => {
      busyClick(btn, async () => {
        if (effectErrorEl) effectErrorEl.style.display = 'none';
        try {
          await api(player.id, 'clear-effect', { field: btn.dataset.field });
        } catch (err) {
          if (effectErrorEl) {
            effectErrorEl.style.display = 'block';
            effectErrorEl.textContent = err.message;
          }
        }
      });
    });

    // A seta so revela o seletor de destino (clicar de novo esconde); a transferencia
    // de fato acontece quando um nome e escolhido no select, ali embaixo.
    div.querySelectorAll('.btn-transfer-effect').forEach((btn) => {
      btn.addEventListener('click', () => {
        const select = div.querySelector(`.transfer-target-select[data-field="${btn.dataset.field}"]`);
        if (!select) return;
        select.style.display = select.style.display === 'none' ? 'inline-block' : 'none';
      });
    });

    div.querySelectorAll('.transfer-target-select').forEach((select) => {
      select.addEventListener('change', async () => {
        const toPlayerId = select.value;
        if (!toPlayerId) return;
        if (effectErrorEl) effectErrorEl.style.display = 'none';
        select.disabled = true;
        try {
          await api(player.id, 'transfer-effect', { toPlayerId, field: select.dataset.field });
        } catch (err) {
          if (effectErrorEl) {
            effectErrorEl.style.display = 'block';
            effectErrorEl.textContent = err.message;
          }
        } finally {
          select.disabled = false;
          select.value = '';
        }
      });
    });

    return div;
  }

  function renderLuckLog() {
    const list = document.getElementById('luck-log-list');
    if (!list) return;
    if (!latestLuckLog.length) {
      list.innerHTML = '<p class="small">Nenhuma carta ativada ainda.</p>';
      return;
    }
    list.innerHTML = latestLuckLog
      .map((entry) => {
        const player = latestPlayersRaw.find((p) => p.id === entry.playerId);
        const playerName = player ? player.name : 'Piloto removido';
        return `<div>${entry.icon} <strong>${playerName}</strong> — ${entry.name}</div>`;
      })
      .join('');
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

    renderLuckLog();
    refreshLuckActivatePanelOptions();
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

  onSnapshot(query(collection(db, 'games', gameId, 'luckCards'), orderBy('appliedAt', 'desc'), limit(20)), (snap) => {
    latestLuckLog = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderLuckLog();
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
