// Painel de mostradores do piloto (relogio de gasolina, pneu, turbo, voltas, multas) + carrossel
// lateral de paineis. Compartilhado entre player.js e master.js - mudou aqui, muda nas duas telas.

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(text) {
  return String(text == null ? '' : text).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
}

export function barColor(percent) {
  if (percent <= 30) return 'var(--red)';
  if (percent <= 60) return 'var(--orange)';
  return 'var(--green)';
}

// Relogio de combustivel estilo painel de carro: ponteiro vai de E (vazio) a F (cheio).
const DIAL_SWEEP = 70; // graus pra cada lado a partir do topo
function dialPoint(angleDeg, radius) {
  const rad = (angleDeg * Math.PI) / 180;
  return [50 + radius * Math.sin(rad), 56 - radius * Math.cos(rad)];
}

function fuelDialSVG(percent, key) {
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
  const [ex, ey] = dialPoint(-DIAL_SWEEP - 6, 21);
  const [fx, fy] = dialPoint(DIAL_SWEEP + 6, 21);
  return `
    <svg class="fuel-dial" viewBox="0 0 100 100" role="img" aria-label="Combustivel ${percent}%">
      <circle cx="50" cy="56" r="43" fill="#f4f4f4" stroke="#111" stroke-width="5"/>
      ${ticks.join('')}
      <text x="${ex}" y="${ey}" class="dial-letter" fill="#e63946">E</text>
      <text x="${fx}" y="${fy}" class="dial-letter" fill="#111">F</text>
      <text x="50" y="40" class="dial-icon">⛽</text>
      <line x1="50" y1="56" x2="50" y2="22" stroke="#e63946" stroke-width="3" stroke-linecap="round"
        class="dial-needle" data-key="${esc(key)}" data-angle="${needleAngle}"/>
      <circle cx="50" cy="56" r="5" fill="#111"/>
    </svg>
  `;
}

// Turbo = potencia: conta-giros com o mesmo formato do relogio de gasolina. Escala de posicao
// 0..TURBO_DIAL_MAX (o ponteiro trava no fim se passar), com as faixas de dado pintadas no arco:
// d8 a partir da posicao 5 (laranja) e d12 a partir da 8 (vermelho, a "redline").
// Faixas espelham TURBO_DICE_THRESHOLDS de src/constants.js.
const TURBO_DIAL_MAX = 12;
const TURBO_ZONES = [
  { from: 5, to: 8, color: '#f4a261' },
  { from: 8, to: TURBO_DIAL_MAX, color: '#e63946' },
];
const TURBO_LABELS = [0, 5, 8, TURBO_DIAL_MAX];

function turboAngle(position) {
  return -DIAL_SWEEP + (Math.max(0, Math.min(TURBO_DIAL_MAX, position)) / TURBO_DIAL_MAX) * DIAL_SWEEP * 2;
}

function turboDialSVG(position, diceType, key) {
  const zones = TURBO_ZONES.map((z) => {
    const [x1, y1] = dialPoint(turboAngle(z.from), 37);
    const [x2, y2] = dialPoint(turboAngle(z.to), 37);
    return `<path d="M ${x1} ${y1} A 37 37 0 0 1 ${x2} ${y2}" fill="none" stroke="${z.color}" stroke-width="6"/>`;
  });

  const ticks = [];
  for (let i = 0; i <= TURBO_DIAL_MAX; i += 1) {
    const major = TURBO_LABELS.includes(i);
    const [x1, y1] = dialPoint(turboAngle(i), 39);
    const [x2, y2] = dialPoint(turboAngle(i), major ? 29 : 33);
    ticks.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#111" stroke-width="${major ? 4 : 2}"/>`);
  }

  const labels = TURBO_LABELS.map((i) => {
    const [x, y] = dialPoint(turboAngle(i), 22);
    return `<text x="${x}" y="${y}" class="dial-number">${i}</text>`;
  });

  return `
    <svg class="fuel-dial" viewBox="0 0 100 100" role="img" aria-label="Potencia posicao ${position}">
      <circle cx="50" cy="56" r="43" fill="#f4f4f4" stroke="#111" stroke-width="5"/>
      ${zones.join('')}
      ${ticks.join('')}
      ${labels.join('')}
      <text x="50" y="82" class="dial-dice">d${diceType}</text>
      <line x1="50" y1="56" x2="50" y2="20" stroke="#e63946" stroke-width="3" stroke-linecap="round"
        class="dial-needle" data-key="${esc(key)}" data-angle="${turboAngle(position)}"/>
      <circle cx="50" cy="56" r="5" fill="#111"/>
    </svg>
  `;
}

// Desenho de pneu (borracha com sulcos, roda e raios) com as 10 bolinhas do cartao fisico
// virando um anel de barrinhas em volta: acesas a partir do topo, no sentido horario, ate o nivel atual.
function ringPoint(angleDeg, radius) {
  const rad = (angleDeg * Math.PI) / 180;
  return [(50 + radius * Math.sin(rad)).toFixed(2), (50 - radius * Math.cos(rad)).toFixed(2)];
}

function tireSVG(level, levelMax, color) {
  const step = 360 / levelMax;
  const bars = [];
  for (let i = 0; i < levelMax; i += 1) {
    const [x1, y1] = ringPoint(i * step + 4, 45);
    const [x2, y2] = ringPoint((i + 1) * step - 4, 45);
    const lit = i < level;
    bars.push(`<path d="M ${x1} ${y1} A 45 45 0 0 1 ${x2} ${y2}" fill="none" stroke-width="6" stroke-linecap="round"
      stroke="${lit ? color : '#3a3f4b'}"/>`);
  }

  const treads = [];
  for (let i = 0; i < 24; i += 1) {
    const [x1, y1] = ringPoint(i * 15, 31);
    const [x2, y2] = ringPoint(i * 15 + 6, 37);
    treads.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#3a3a3a" stroke-width="2.5"/>`);
  }

  const spokes = [];
  for (let i = 0; i < 5; i += 1) {
    const [x1, y1] = ringPoint(i * 72, 5);
    const [x2, y2] = ringPoint(i * 72, 17);
    spokes.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#8a8f98" stroke-width="3.5" stroke-linecap="round"/>`);
  }

  return `
    <svg class="tire-svg" viewBox="0 0 100 100" role="img" aria-label="Pneu nivel ${level} de ${levelMax}">
      ${bars.join('')}
      <circle cx="50" cy="50" r="38" fill="#151515" stroke="#000" stroke-width="1"/>
      ${treads.join('')}
      <circle cx="50" cy="50" r="27" fill="#222" stroke="#2e2e2e" stroke-width="2"/>
      <circle cx="50" cy="50" r="20" fill="#c9ccd1" stroke="#8a8f98" stroke-width="2"/>
      ${spokes.join('')}
      <circle cx="50" cy="50" r="5" fill="#555a63"/>
    </svg>
  `;
}

// Ponteiro gira de verdade: o HTML e recriado a cada render, entao o novo ponteiro nasce
// no angulo anterior (ou no E, na primeira vez - igual carro ligando) e transiciona ate o atual.
const needleAngles = {}; // playerId -> ultimo angulo mostrado

// Antes de recriar o HTML: guarda onde o ponteiro esta AGORA (pode estar no meio da animacao),
// pra continuar o giro dali em vez de pular - chegam varios snapshots seguidos ao abrir a tela.
export function captureNeedles(container) {
  container.querySelectorAll('.dial-needle').forEach((needle) => {
    const m = getComputedStyle(needle).transform.match(/matrix\(([^,]+),\s*([^,]+)/);
    if (m) needleAngles[needle.dataset.key] = (Math.atan2(Number(m[2]), Number(m[1])) * 180) / Math.PI;
  });
}

export function animateNeedles(container) {
  container.querySelectorAll('.dial-needle').forEach((needle) => {
    const key = needle.dataset.key;
    const target = Number(needle.dataset.angle);
    const from = needleAngles[key] != null ? needleAngles[key] : -DIAL_SWEEP;
    needle.style.transition = 'none';
    needle.style.transform = `rotate(${from}deg)`;
    // eslint-disable-next-line no-unused-expressions
    void needle.getBoundingClientRect(); // forca o navegador a aplicar o angulo inicial
    needle.style.transition = '';
    needle.style.transform = `rotate(${target}deg)`;
    needleAngles[key] = target;
  });
}

// Mostradores lado a lado (gasolina, pneu, turbo) + voltas e multas.
// isMe so muda o texto dos avisos; showEffects=false quando a tela ja lista os efeitos com botoes (mestre).
export function dashboardHTML(player, { finesTotal, totalLaps, isMe = false, showEffects = true }) {
  const fuelColor = barColor(player.fuel.percent);
  const tireColor = player.tire.level >= 7 ? 'var(--green)' : player.tire.level >= 5 ? 'var(--orange)' : 'var(--red)';

  const turboCaption = player.turbo.nextPosition != null
    ? `faltam ${player.turbo.nextPosition - player.turbo.position} p/ d${player.turbo.nextDice}`
    : 'potencia maxima';

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

  const effects = showEffects
    ? player.activeEffects.map((eff) => `<span class="badge tag-effect">${esc(eff.label)}</span>`).join('')
    : '';

  return `
    <div class="card dash-card">
      <div class="gauges">
        <div class="gauge">
          <div class="gauge-title">⛽ Gasolina</div>
          ${fuelDialSVG(player.fuel.percent, player.id)}
          <div class="fuel-percent" style="color:${fuelColor}">${player.fuel.percent}%</div>
          <div class="gauge-caption">${player.fuel.rollsLeft} dado(s) restantes</div>
        </div>

        <div class="gauge">
          <div class="gauge-title">🛞 Pneu</div>
          ${tireSVG(player.tire.level, player.tire.levelMax, tireColor)}
          <div class="fuel-percent" style="color:${tireColor}">${player.tire.level}/${player.tire.levelMax}</div>
          <div class="gauge-caption">${esc(player.tire.label)} · cai em ${player.tire.rollsUntilNextLevel}</div>
        </div>

        <div class="gauge">
          <div class="gauge-title">🌀 Potencia</div>
          ${turboDialSVG(player.turboPosition, player.diceType, `${player.id}:turbo`)}
          <div class="fuel-percent" style="color:var(--purple)">pos ${player.turboPosition}</div>
          <div class="gauge-caption">${turboCaption}</div>
        </div>
      </div>

      <div class="dash-stats">
        <div class="dash-stat"><span>🏁 Voltas</span><strong>${player.laps} / ${totalLaps}</strong></div>
        <div class="dash-stat"><span>📋 Multas</span><strong>R$ ${finesTotal.toLocaleString('pt-BR')}</strong></div>
      </div>
      ${player.diceType < player.turboDiceType ? `<p class="small">A potencia daria d${player.turboDiceType}, mas o pneu gasto limita o dado.</p>` : ''}
      ${banners.join('')}
      ${effects ? `<div class="active-effects-list">${effects}</div>` : ''}
    </div>
  `;
}

// Carrossel lateral: abas em cima (nome + ultimo dado) e slides com swipe embaixo.
// Os slides de cada piloto sao reaproveitados entre renders - recriar o elemento faria o
// carrossel pular de posicao e cortaria a animacao do ponteiro.
export function createPanelSlider(slider, tabsEl) {
  let activeSlide = 0;
  const slides = {}; // id -> elemento .panel-slide criado aqui
  const seenRollAt = {}; // id -> timestamp da ultima rolagem ja animada na aba

  function slideLeft(slide) {
    return slide.offsetLeft - slider.offsetLeft;
  }

  function updateActiveTab() {
    Array.from(tabsEl.children).forEach((tab, i) => tab.classList.toggle('active', i === activeSlide));
  }

  // Descobre qual slide esta na tela pelo scroll (swipe do dedo ou toque na aba)
  slider.addEventListener('scroll', () => {
    const left = slider.scrollLeft;
    const all = Array.from(slider.children);
    let best = 0;
    all.forEach((slide, i) => {
      if (Math.abs(slideLeft(slide) - left) < Math.abs(slideLeft(all[best]) - left)) best = i;
    });
    if (best !== activeSlide) {
      activeSlide = best;
      updateActiveTab();
    }
  }, { passive: true });

  tabsEl.addEventListener('click', (e) => {
    const tab = e.target.closest('.panel-tab');
    if (!tab) return;
    const target = slider.children[Number(tab.dataset.index)];
    if (target) slider.scrollTo({ left: slideLeft(target), behavior: 'smooth' });
  });

  // Garante um slide por id, na ordem dada, depois de qualquer slide fixo do HTML
  // (startIndex = quantos slides fixos vem antes). Devolve os elementos na mesma ordem.
  function syncSlides(ids, startIndex = 0) {
    Object.keys(slides).forEach((id) => {
      if (!ids.includes(id)) {
        slides[id].remove();
        delete slides[id];
      }
    });
    const wanted = ids.map((id) => {
      if (!slides[id]) {
        slides[id] = document.createElement('div');
        slides[id].className = 'panel-slide';
        slider.appendChild(slides[id]);
      }
      return slides[id];
    });
    // So reordena se mudou - mover o elemento cancelaria a animacao do ponteiro
    const current = Array.from(slider.children).slice(startIndex);
    if (current.some((slide, i) => slide !== wanted[i])) wanted.forEach((slide) => slider.appendChild(slide));
    return wanted;
  }

  // items: [{ id, name, color, lastRoll, showRoll }] na mesma ordem dos slides
  function renderTabs(items) {
    tabsEl.innerHTML = items
      .map((p, i) => `
        <button type="button" class="panel-tab ${i === activeSlide ? 'active' : ''}" data-index="${i}">
          <span class="color-dot" style="background:${esc(p.color)}"></span>
          <span>${esc(p.name)}</span>
          ${p.showRoll ? `<span class="roll-value ${p.lastRoll ? '' : 'empty'}">${p.lastRoll ? p.lastRoll.value : '—'}</span>` : ''}
        </button>
      `)
      .join('');

    items.forEach((p, i) => {
      if (!p.showRoll || !p.lastRoll || seenRollAt[p.id] === p.lastRoll.at) return;
      const wasSeenBefore = seenRollAt[p.id] !== undefined;
      seenRollAt[p.id] = p.lastRoll.at;
      const value = tabsEl.children[i].querySelector('.roll-value');
      if (wasSeenBefore && value) {
        value.classList.remove('dice-pop');
        // eslint-disable-next-line no-unused-expressions
        void value.offsetWidth;
        value.classList.add('dice-pop');
      }
    });
  }

  return { syncSlides, renderTabs };
}
