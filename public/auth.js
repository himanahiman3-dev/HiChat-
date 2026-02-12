// auth.js — чистая страница авторизации, без модалок

// Предпросмотр аватарки
const regAvatar = document.getElementById('regAvatar');
const avatarPreview = document.getElementById('avatarPreview');
const previewImg = avatarPreview?.querySelector('img');

if (regAvatar) {
  regAvatar.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = function(ev) {
        previewImg.src = ev.target.result;
        avatarPreview.classList.remove('hidden');
      };
      reader.readAsDataURL(file);
    } else {
      avatarPreview.classList.add('hidden');
    }
  });
}

// ЛОГИН
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  const errorEl = document.getElementById('loginError');
  errorEl.innerText = '';

  try {
    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.innerText = data.error || 'Ошибка входа';
      return;
    }
    // Сохраняем токен и переходим в чат
    localStorage.setItem('hichat_token', data.token);
    window.location.href = '/';
  } catch (err) {
    errorEl.innerText = 'Ошибка сети';
    console.error(err);
  }
});

// РЕГИСТРАЦИЯ
document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('regName').value;
  const email = document.getElementById('regEmail').value;
  const password = document.getElementById('regPassword').value;
  const avatarFile = document.getElementById('regAvatar').files[0];
  const errorEl = document.getElementById('registerError');
  errorEl.innerText = '';

  const formData = new FormData();
  formData.append('username', username);
  formData.append('email', email);
  formData.append('password', password);
  if (avatarFile) formData.append('avatar', avatarFile);

  try {
    const res = await fetch('/register', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) {
      errorEl.innerText = data.error || 'Ошибка регистрации';
      return;
    }
    // Регистрация успешна — автоматически логинимся
    const loginRes = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const loginData = await loginRes.json();
    if (!loginRes.ok) {
      errorEl.innerText = 'Регистрация прошла, но не удалось войти. Попробуйте войти вручную.';
      return;
    }
    localStorage.setItem('hichat_token', loginData.token);
    window.location.href = '/';
  } catch (err) {
    errorEl.innerText = 'Ошибка сети';
    console.error(err);
  }
});