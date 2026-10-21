(function () {
  const emptyMsg = document.getElementById('empty-msg');

  // Cada competicao tem sua tabela, ordenada pelas vitorias dela. Quem nunca correu
  // naquela competicao nao aparece na tabela dela.
  const COMPETITIONS = [
    { key: 'padrao', wins: 'wins', races: 'racesPlayed' },
    { key: 'porsche', wins: 'porscheWins', races: 'porscheRacesPlayed' },
  ];

  function renderCompetition(ranking, { key, wins, races }) {
    const body = document.getElementById(`ranking-${key}`);
    const champion = document.getElementById(`champion-${key}`);
    const rows = ranking
      .filter((r) => r[races] > 0 || r[wins] > 0)
      .sort((a, b) => b[wins] - a[wins] || a[races] - b[races]);

    if (!rows.length) {
      champion.innerHTML = '<span class="small">Nenhuma corrida ainda.</span>';
      return;
    }

    const top = rows[0];
    champion.innerHTML = top[wins] > 0
      ? `👑 Maior vencedor: <strong>${top.displayName}</strong> — ${top[wins]} vitoria${top[wins] === 1 ? '' : 's'}`
      : '<span class="small">Ninguem venceu ainda.</span>';

    body.innerHTML = rows
      .map((r, i) => {
        const pos = i + 1;
        const posClass = pos <= 3 ? `pos-${pos}` : '';
        return `<tr>
            <td class="pos ${posClass}">${pos}</td>
            <td>${r.displayName}</td>
            <td>${r[wins]}</td>
            <td>${r[races]}</td>
          </tr>`;
      })
      .join('');
  }

  fetch('/api/ranking')
    .then((res) => res.json())
    .then((ranking) => {
      if (!ranking.length) {
        emptyMsg.style.display = 'block';
        return;
      }
      COMPETITIONS.forEach((c) => renderCompetition(ranking, c));
    });
})();
