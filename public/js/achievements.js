(function () {
  const token = localStorage.getItem('racer-token');
  const username = localStorage.getItem('racer-username');

  if (!token || !username) {
    window.location.href = '/login.html?redirect=/achievements.html';
    return;
  }

  const subtitle = document.getElementById('subtitle');
  const grid = document.getElementById('trophy-grid');

  fetch(`/api/users/${username}/achievements`)
    .then((res) => res.json())
    .then((list) => {
      const unlockedCount = list.filter((a) => a.unlocked).length;
      subtitle.textContent = `${username}: ${unlockedCount} de ${list.length} trofeus desbloqueados`;

      grid.innerHTML = list
        .map(
          (a) => `
        <div class="trophy ${a.unlocked ? '' : 'locked'}">
          <span class="icon">${a.icon}</span>
          <div class="name">${a.name}</div>
          <div class="desc">${a.description}</div>
        </div>
      `
        )
        .join('');
    });

  // Painel do admin, se este usuario logado for admin
  fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
    .then((res) => res.json())
    .then((me) => {
      if (!me.isAdmin) return;

      document.getElementById('admin-panel').style.display = 'block';

      fetch('/api/achievements/catalog')
        .then((res) => res.json())
        .then((catalog) => {
          const select = document.getElementById('admin-achievement');
          select.innerHTML = catalog
            .filter((a) => a.type === 'manual')
            .map((a) => `<option value="${a.id}">${a.icon} ${a.name}</option>`)
            .join('');
        });

      document.getElementById('btn-grant').addEventListener('click', async () => {
        const targetUsername = document.getElementById('admin-username').value.trim();
        const achievementId = document.getElementById('admin-achievement').value;
        const resultEl = document.getElementById('grant-result');
        resultEl.textContent = '';

        const res = await fetch('/api/admin/grant-achievement', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ username: targetUsername, achievementId }),
        });
        const data = await res.json();
        resultEl.textContent = res.ok
          ? (data.granted ? 'Conquista concedida!' : 'Esse usuario ja tinha essa conquista.')
          : data.error;
      });
    });
})();
