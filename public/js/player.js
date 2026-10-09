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

  function barColor(percent) {
    if (percent <= 30) return 'var(--red)';
    if (percent <= 60) return 'var(--orange)';
    return 'var(--green)';
  }

  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
  }

  // Relogio de combustivel estilo painel de carro: ponteiro vai de E (vazio) a F (cheio).
  const DIAL_SWEEP = 70; // graus pra cada lado a partir do topo
  function dialPoint(angleDeg, radius) {
    const rad = (angleDeg * Math.PI) / 180;
    return [50 + radius * Math.sin(rad), 56 - radius * Math.cos(rad)];
  }

  function fuelDialSVG(percent) {
    const ticks = [];
    for (let i = 0; i <= 8; i += 1) {
      const angle = -DIAL_SWEEP + (i * DIAL_SWEEP * 2) / 8;
      const major = i === 0 || i === 4 || i === 8;
      const [x1, y1] = dialPoint(angle, 38);
      const [x2, y2] = dialPoint(angle, major ? 28 : 32);
      const color = i === 0 ? '#e63946' : '#111';
      ticks.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${major ? 5 : 3}"/>`);
    }
    const needleAngle = -DIAL_SWEEP + (Math.max(0, Math.min(100, percent)) / 100) * DIAL_SWEEP * 2;
    const [nx, ny] = dialPoint(needleAngle, 34);
    const [ex, ey] = dialPoint(-DIAL_SWEEP - 6, 21);
    const [fx, fy] = dialPoint(DIAL_SWEEP + 6, 21);
    return `
      <svg class="fuel-dial" viewBox="0 0 100 100" role="img" aria-label="Combustivel ${percent}%">
        <circle cx="50" cy="56" r="43" fill="#f4f4f4" stroke="#111" stroke-width="5"/>
        ${ticks.join('')}
        <text x="${ex}" y="${ey}" class="dial-letter" fill="#e63946">E</text>
        <text x="${fx}" y="${fy}" class="dial-letter" fill="#111">F</text>
        <text x="50" y="40" class="dial-icon">⛽</text>
        <line x1="50" y1="56" x2="${nx}" y2="${ny}" stroke="#e63946" stroke-width="3" stroke-linecap="round" class="dial-needle"/>
        <circle cx="50" cy="56" r="5" fill="#111"/>
      </svg>
    `;
  }

  // Painel de mostradores lado a lado (tanque, pneu, turbo) + voltas e multas.
  // Mesmo HTML pro seu slide e pros dos adversarios - so o texto dos avisos muda (isMe).
  function dashboardHTML(player, finesTotal, totalLaps, isMe) {
    const fuelColor = barColor(player.fuel.percent);
    const tireColor = player.tire.level >= 7 ? 'var(--green)' : player.tire.level >= 5 ? 'var(--orange)' : 'var(--red)';

    // As 10 bolinhas do cartao fisico, empilhadas: acesas ate o nivel atual
    let tireSegments = '';
    for (let i = player.tire.levelMax; i >= 1; i -= 1) {
      tireSegments += `<div class="tire-seg" style="${i <= player.tire.level ? `background:${tireColor}` : ''}"></div>`;
    }

    const turboCaption = player.turbo.nextPosition != null
      ? `faltam ${player.turbo.nextPosition - player.turbo.position} p/ d${player.turbo.nextDice}`
      : 'turbo maximo';

    const banners = [];
    if (player.eliminated) {
      banners.push(`<div class="danger-banner">ELIMINADO${isMe ? ' - voce nao pode mais rolar nesta corrida' : ''}</div>`);
    } else {
      if (player.fuel.empty) {
        banners.push(`<div class="danger-banner">SEM COMBUSTIVEL${isMe ? ' - va ao posto ou peca reabastecimento ao mestre!' : ''}</div>`);
      } else if (player.fuel.warning) {
        banners.push(`<div class="warning-banner">${isMe ? 'Voce tem' : 'Tem'} mais ${player.fuel.rollsLeft} rodada(s) de combustivel</div>`);
      }
      if (player.tire.penaltyDice) {
        banners.push(`<div class="warning-banner">Pneu gasto: dado limitado a d${player.tire.penaltyDice}</div>`);
      }
    }

    const effects = player.activeEffects
      .map((eff) => `<span class="badge tag-effect">${esc(eff.label)}</span>`)
      .join('');

    return `
      <div class="card dash-card">
        <div class="gauges">
          <div class="gauge">
            <div class="gauge-title">⛽ Gasolina</div>
            ${fuelDialSVG(player.fuel.percent)}
            <div class="fuel-percent" style="color:${fuelColor}">${player.fuel.percent}%</div>
            <div class="gauge-caption">${player.fuel.rollsLeft} dado(s) restantes</div>
          </div>

          <div class="gauge">
            <div class="gauge-title">🛞 Pneu</div>
            <div class="tire-track">${tireSegments}</div>
            <div class="gauge-caption">${esc(player.tire.label)} ${player.tire.level}/${player.tire.levelMax}<br>cai em ${player.tire.rollsUntilNextLevel}</div>
          </div>

          <div class="gauge">
            <div class="gauge-title">🌀 Turbo</div>
            <div class="turbo-track">
              <div class="turbo-fill" style="height:${player.turbo.percent}%"></div>
              <div class="turbo-dice">d${player.diceType}</div>
            </div>
            <div class="gauge-caption">pos ${player.turboPosition}<br>${turboCaption}</div>
          </div>
        </div>

        <div class="dash-stats">
          <div class="dash-stat"><span>🏁 Voltas</span><strong>${player.laps} / ${totalLaps}</strong></div>
          <div class="dash-stat"><span>📋 Multas</span><strong>R$ ${finesTotal.toLocaleString('pt-BR')}</strong></div>
        </div>
        ${player.diceType < player.turboDiceType ? `<p class="small">Turbo daria d${player.turboDiceType}, mas o pneu gasto limita o dado.</p>` : ''}
        ${banners.join('')}
        ${effects ? `<div class="active-effects-list">${effects}</div>` : ''}
      </div>
    `;
  }

  let latestGame = null;
  let latestPlayerRaw = null;
  let latestFines = [];
  let latestPlayersRaw = [];
  const seenRollAt = {}; // playerId -> timestamp da ultima rolagem ja animada
  const opponentSlides = {}; // playerId -> elemento .panel-slide do adversario
  let activeSlide = 0;

  function finesTotalOf(id) {
    return latestFines.filter((f) => f.playerId === id).reduce((sum, f) => sum + f.amount, 0);
  }

  function slideLeft(slide) {
    return slide.offsetLeft - el.slider.offsetLeft;
  }

  function goToSlide(index) {
    const target = el.slider.children[index];
    if (target) el.slider.scrollTo({ left: slideLeft(target), behavior: 'smooth' });
  }

  function updateActiveTab() {
    Array.from(el.panelTabs.children).forEach((tab, i) => tab.classList.toggle('active', i === activeSlide));
  }

  // Descobre qual slide esta na tela pelo scroll (swipe do dedo ou toque na aba)
  el.slider.addEventListener('scroll', () => {
    const left = el.slider.scrollLeft;
    const slides = Array.from(el.slider.children);
    let best = 0;
    slides.forEach((slide, i) => {
      if (Math.abs(slideLeft(slide) - left) < Math.abs(slideLeft(slides[best]) - left)) best = i;
    });
    if (best !== activeSlide) {
      activeSlide = best;
      updateActiveTab();
    }
  }, { passive: true });

  el.panelTabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.panel-tab');
    if (tab) goToSlide(Number(tab.dataset.index));
  });

  function render() {
    if (!latestGame || !latestPlayerRaw) return;
    const player = window.GameCalc.serializePlayer(latestPlayerRaw);

    el.color.style.background = player.color;
    el.name.textContent = player.name;
    el.gameStatus.textContent = `Corrida: ${latestGame.name} — status: ${latestGame.status}`;

    // Seu painel
    el.myDash.innerHTML = dashboardHTML(player, finesTotalOf(playerId), latestGame.totalLaps, true);
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

    // Paineis dos adversarios: um slide por piloto, reaproveitado entre renders
    // (recriar o elemento faria o carrossel pular de posicao)
    const opponents = latestPlayersRaw
      .filter((p) => p.id !== playerId)
      .map((p) => window.GameCalc.serializePlayer(p));

    Object.keys(opponentSlides).forEach((id) => {
      if (!opponents.some((o) => o.id === id)) {
        opponentSlides[id].remove();
        delete opponentSlides[id];
      }
    });

    opponents.forEach((opp) => {
      let slide = opponentSlides[opp.id];
      if (!slide) {
        slide = document.createElement('div');
        slide.className = 'panel-slide';
        el.slider.appendChild(slide);
        opponentSlides[opp.id] = slide;
      }
      slide.innerHTML = `
        <div class="opp-header">
          <span class="color-dot" style="background:${esc(opp.color)}"></span>
          <h3>${esc(opp.name)}</h3>
          <span class="small">ultimo dado: <strong>${opp.lastRoll ? opp.lastRoll.value : '—'}</strong></span>
        </div>
        ${dashboardHTML(opp, finesTotalOf(opp.id), latestGame.totalLaps, false)}
      `;
    });

    // Abas: voce + adversarios, com o ultimo numero que cada um tirou
    const tabs = [{ name: 'Voce', color: player.color }, ...opponents];
    el.panelTabs.innerHTML = tabs
      .map((p, i) => `
        <button type="button" class="panel-tab ${i === activeSlide ? 'active' : ''}" data-index="${i}">
          <span class="color-dot" style="background:${esc(p.color)}"></span>
          <span>${esc(p.name)}</span>
          ${i > 0 ? `<span class="roll-value ${p.lastRoll ? '' : 'empty'}">${p.lastRoll ? p.lastRoll.value : '—'}</span>` : ''}
        </button>
      `)
      .join('');

    opponents.forEach((opp, i) => {
      if (!opp.lastRoll || seenRollAt[opp.id] === opp.lastRoll.at) return;
      seenRollAt[opp.id] = opp.lastRoll.at;
      if (seenRollAt[opp.id + ':init'] !== undefined) {
        popAnimate(el.panelTabs.children[i + 1].querySelector('.roll-value'));
      }
      seenRollAt[opp.id + ':init'] = true;
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
