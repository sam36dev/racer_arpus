(function () {
  const tabLogin = document.getElementById('tab-login');
  const tabSignup = document.getElementById('tab-signup');
  const formLogin = document.getElementById('form-login');
  const formSignup = document.getElementById('form-signup');
  const errorEl = document.getElementById('auth-error');

  function showLogin() {
    formLogin.style.display = 'block';
    formSignup.style.display = 'none';
    tabLogin.className = 'full-width';
    tabSignup.className = 'secondary full-width';
    errorEl.style.display = 'none';
  }

  function showSignup() {
    formLogin.style.display = 'none';
    formSignup.style.display = 'block';
    tabLogin.className = 'secondary full-width';
    tabSignup.className = 'full-width';
    errorEl.style.display = 'none';
  }

  tabLogin.addEventListener('click', showLogin);
  tabSignup.addEventListener('click', showSignup);

  document.getElementById('show-passwords').addEventListener('change', (e) => {
    const type = e.target.checked ? 'text' : 'password';
    document.getElementById('signup-password').type = type;
    document.getElementById('signup-confirm').type = type;
  });

  function showError(message) {
    errorEl.textContent = message;
    errorEl.style.display = 'block';
  }

  function afterAuth(data) {
    localStorage.setItem('racer-token', data.token);
    localStorage.setItem('racer-username', data.username);
    const redirect = new URLSearchParams(window.location.search).get('redirect') || '/index.html';
    window.location.href = redirect;
  }

  document.getElementById('btn-login').addEventListener('click', async () => {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao entrar');
      afterAuth(data);
    } catch (err) {
      showError(err.message);
    }
  });

  document.getElementById('btn-signup').addEventListener('click', async () => {
    const username = document.getElementById('signup-username').value.trim();
    const password = document.getElementById('signup-password').value;
    const confirmPassword = document.getElementById('signup-confirm').value;
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, confirmPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao criar conta');
      afterAuth(data);
    } catch (err) {
      showError(err.message);
    }
  });
})();
