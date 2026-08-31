(function () {
  const body = document.getElementById('ranking-body');
  const emptyMsg = document.getElementById('empty-msg');

  fetch('/api/ranking')
    .then((res) => res.json())
    .then((ranking) => {
      if (!ranking.length) {
        emptyMsg.style.display = 'block';
        return;
      }
      body.innerHTML = ranking
        .map((r, i) => {
          const pos = i + 1;
          const posClass = pos <= 3 ? `pos-${pos}` : '';
          return `<tr>
            <td class="pos ${posClass}">${pos}</td>
            <td>${r.displayName}</td>
            <td>${r.wins}</td>
            <td>${r.racesPlayed}</td>
            <td>${r.lapsCompleted}</td>
          </tr>`;
        })
        .join('');
    });
})();
