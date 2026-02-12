// ==================== HiChat — клиентская логика (финальная версия) ====================
let token = localStorage.getItem('hichat_token') || null;
let currentUser = null;
let socket = null;
let activeChatId = null;
let activeChatOther = null;
let chatsCache = {};

// ---------- DOM элементы ----------
const messagesEl = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const logoutBtn = document.getElementById('logoutBtn');
const currentUserInfo = document.getElementById('currentUserInfo');
const myAvatar = document.getElementById('myAvatar');
const myName = document.getElementById('myName');

const chatsContainer = document.getElementById('chatsContainer');
const newChatUsername = document.getElementById('newChatUsername');
const startChatBtn = document.getElementById('startChatBtn');
const chatHeader = document.getElementById('chatHeader');
const chatAvatar = document.getElementById('chatAvatar');
const chatName = document.getElementById('chatName');
const chatOnlineDot = document.getElementById('chatOnlineDot');
const logo = document.getElementById('logo');

// ---------- Модалка настроек ----------
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const settingsForm = document.getElementById('settingsForm');
const settingsUsername = document.getElementById('settingsUsername');
const settingsBio = document.getElementById('settingsBio');
const settingsAvatar = document.getElementById('settingsAvatar');
const settingsAvatarPreview = document.getElementById('settingsAvatarPreview');
const settingsPreviewImg = settingsAvatarPreview?.querySelector('img');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const settingsError = document.getElementById('settingsError');

// ---------- Модалка просмотра профиля ----------
const profileModal = document.getElementById('profileModal');
const profileAvatar = document.getElementById('profileAvatar');
const profileUsername = document.getElementById('profileUsername');
const profileBio = document.getElementById('profileBio');
const profileOnline = document.getElementById('profileOnline');
const closeProfileBtn = document.getElementById('closeProfileBtn');

// ==================== УТИЛИТЫ ====================
function escapeHtml(s) {
  return (s + '').replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]);
}

function avatarOrDefault(av) {
  return av && av.length ? av : '/default-avatar.png';
}

// ==================== ОТРИСОВКА ЧАТОВ ====================
function renderChatItem(chat) {
  const el = document.createElement('div');
  el.className = 'chat-item';
  el.dataset.chatId = chat.id;

  const avatarWrap = document.createElement('div');
  avatarWrap.style.position = 'relative';

  const img = document.createElement('img');
  img.className = 'avatar-small';
  img.src = avatarOrDefault(chat.otherUser.avatar);
  img.alt = chat.otherUser.username;

  const onlineDot = document.createElement('span');
  onlineDot.className = 'online-dot-small';
  if (chat.otherUser.online) onlineDot.classList.remove('hidden');
  else onlineDot.classList.add('hidden');

  avatarWrap.appendChild(img);
  avatarWrap.appendChild(onlineDot);

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.innerHTML = `<div class="name">${escapeHtml(chat.otherUser.username)}</div>
                    <div class="last">${chat.lastMessage ? escapeHtml(chat.lastMessage.text.slice(0, 80)) : ''}</div>`;

  const right = document.createElement('div');
  right.style.marginLeft = 'auto';
  right.style.display = 'flex';
  right.style.alignItems = 'center';
  right.style.gap = '8px';

  const unreadBadge = document.createElement('div');
  unreadBadge.className = 'unread-badge';
  unreadBadge.innerText = chat.unread || '';
  if (!chat.unread) unreadBadge.classList.add('hidden');

  right.appendChild(unreadBadge);

  el.appendChild(avatarWrap);
  el.appendChild(meta);
  el.appendChild(right);

  // 👇 УЛУЧШЕННЫЙ КЛИК: открываем профиль при клике на аватар или имя, иначе открываем чат
  el.addEventListener('click', (e) => {
    if (e.target.closest('.chat-item .meta') || e.target.closest('.avatar-small')) {
      openProfile(chat.otherUser.id);
    } else {
      openChat(chat.id, chat.otherUser);
    }
  });

  el._meta = { unreadBadge, onlineDot, img };
  return el;
}

function clearChatsUI() {
  chatsContainer.innerHTML = '';
  chatsCache = {};
}

async function loadChats() {
  const res = await fetch('/chats', { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) { console.error('cannot fetch chats'); return; }
  const data = await res.json();
  clearChatsUI();
  data.forEach(c => {
    chatsCache[c.id] = c;
    chatsContainer.appendChild(renderChatItem(c));
  });
}

function chatExistsInUI(chatId) {
  return !!chatsContainer.querySelector(`[data-chat-id="${chatId}"]`);
}

// ==================== ОТКРЫТИЕ ЧАТА ====================
async function openChat(chatId, otherUser) {
  activeChatId = chatId;
  activeChatOther = otherUser;
  chatHeader.classList.remove('hidden');
  chatAvatar.src = avatarOrDefault(otherUser.avatar);
  chatName.innerText = otherUser.username;
  if (otherUser.online) chatOnlineDot.classList.remove('hidden');
  else chatOnlineDot.classList.add('hidden');

  if (socket && socket.connected) socket.emit('join chat', chatId);

  const r = await fetch(`/chats/${chatId}/messages`, { headers: { Authorization: 'Bearer ' + token } });
  if (r.ok) {
    const msgs = await r.json();
    messagesEl.innerHTML = '';
    msgs.forEach(renderMessage);
    await loadChats(); // обновить непрочитанные
  } else {
    messagesEl.innerHTML = '';
  }
}

// ==================== ОТРИСОВКА СООБЩЕНИЯ ====================
function renderMessage(msg) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message';

  const avatar = document.createElement('img');
  avatar.className = 'avatar-small';
  avatar.src = avatarOrDefault(msg.avatar);
  avatar.alt = msg.name || 'User';

  const body = document.createElement('div');
  body.className = 'msg-body';

  const header = document.createElement('div');
  header.className = 'msg-header';
  header.innerHTML = `<span>${escapeHtml(msg.name || 'Unknown')}</span>
                      <small style="opacity:.6;margin-left:8px;font-size:12px">${new Date(msg.ts).toLocaleTimeString()}</small>`;

  const text = document.createElement('div');
  text.className = 'msg-text';
  text.innerText = msg.text;

  body.appendChild(header);
  body.appendChild(text);

  wrapper.appendChild(avatar);
  wrapper.appendChild(body);

  messagesEl.appendChild(wrapper);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function findChatElement(chatId) {
  return chatsContainer.querySelector(`[data-chat-id="${chatId}"]`);
}

// ==================== ПРОСМОТР ПРОФИЛЯ ====================
function openProfile(userId) {
  fetch(`/users/${userId}`, {
    headers: { Authorization: 'Bearer ' + token }
  })
    .then(res => res.json())
    .then(user => {
      profileAvatar.src = avatarOrDefault(user.avatar);
      profileUsername.innerText = user.username;
      profileBio.innerText = user.bio || 'Пользователь пока ничего не написал о себе.';
      profileOnline.innerText = user.online ? '● В сети' : '○ Не в сети';
      profileOnline.className = 'online-status ' + (user.online ? 'online' : 'offline');
      profileModal.classList.remove('hidden');
    })
    .catch(err => {
      console.error('Ошибка загрузки профиля:', err);
      alert('Не удалось загрузить профиль');
    });
}

// ==================== SOCKET.IO ====================
function connectSocket() {
  if (!token) return;
  socket = io({ auth: { token } });

  socket.on('connect_error', err => {
    console.error('socket err', err.message);
    if (err.message === 'Unauthorized') logout();
  });

  socket.on('chat created', chat => {
    if (!chatExistsInUI(chat.id)) {
      const uiChat = {
        id: chat.id,
        otherUser: chat.otherUser,
        lastMessage: null,
        unread: 0,
        online: chat.otherUser.online
      };
      chatsCache[chat.id] = uiChat;
      const node = renderChatItem(uiChat);
      chatsContainer.prepend(node);
    }
  });

  socket.on('chat message', msg => {
    if (msg.chatId === activeChatId) {
      renderMessage(msg);
      loadChats();
    } else {
      loadChats();
      chatsContainer.style.boxShadow = '0 0 18px rgba(0,224,255,0.06)';
      setTimeout(() => chatsContainer.style.boxShadow = '', 700);
    }
  });

  socket.on('unread update', u => {
    const el = findChatElement(u.chatId);
    if (el && el._meta) {
      const badge = el._meta.unreadBadge;
      badge.innerText = u.unread || '';
      if (!u.unread) badge.classList.add('hidden');
      else badge.classList.remove('hidden');
    } else {
      loadChats();
    }
  });

  socket.on('presence', p => {
    const items = chatsContainer.querySelectorAll('.chat-item');
    items.forEach(it => {
      const chatId = it.dataset.chatId;
      const chat = chatsCache[chatId];
      if (!chat) return;
      if (chat.otherUser.id === p.userId) {
        chat.otherUser.online = p.online;
        if (it._meta && it._meta.onlineDot) {
          if (p.online) it._meta.onlineDot.classList.remove('hidden');
          else it._meta.onlineDot.classList.add('hidden');
        } else {
          loadChats();
        }
      }
    });

    if (activeChatOther && activeChatOther.id === p.userId) {
      if (p.online) chatOnlineDot.classList.remove('hidden');
      else chatOnlineDot.classList.add('hidden');
    }
  });
}

// ==================== ОТПРАВКА СООБЩЕНИЯ ====================
sendBtn?.addEventListener('click', () => {
  const text = messageInput.value.trim();
  if (!text || !activeChatId) return;
  if (!socket || !socket.connected) { alert('Нет подключения. Обновите страницу.'); return; }
  socket.emit('chat message', { chatId: activeChatId, text });
  messageInput.value = '';
});

messageInput?.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); sendBtn.click(); }
});

// ==================== НАЧАТЬ НОВЫЙ ЧАТ ====================
startChatBtn?.addEventListener('click', async () => {
  const uname = newChatUsername.value.trim();
  if (!uname) return alert('Введите username');
  try {
    const r = await fetch('/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ username: uname })
    });
    const j = await r.json();
    if (!r.ok) return alert(j.error || 'Пользователь не найден');
    await loadChats();
    openChat(j.id, j.otherUser);
    newChatUsername.value = '';
  } catch (err) {
    alert('Ошибка сети');
    console.error(err);
  }
});

// ==================== НАСТРОЙКИ ПРОФИЛЯ ====================
settingsBtn?.addEventListener('click', () => {
  if (!currentUser) return;
  settingsUsername.value = currentUser.username || '';
  settingsBio.value = currentUser.bio || '';
  settingsAvatarPreview.classList.add('hidden');
  settingsError.innerText = '';
  settingsModal.classList.remove('hidden');
});

// Предпросмотр аватара в настройках
settingsAvatar?.addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = ev => {
      if (settingsPreviewImg) {
        settingsPreviewImg.src = ev.target.result;
        settingsAvatarPreview.classList.remove('hidden');
      }
    };
    reader.readAsDataURL(file);
  } else {
    settingsAvatarPreview.classList.add('hidden');
  }
});

// Закрыть настройки
closeSettingsBtn?.addEventListener('click', () => {
  settingsModal.classList.add('hidden');
});

// Сохранить настройки
settingsForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  settingsError.innerText = '';

  const username = settingsUsername.value.trim();
  const bio = settingsBio.value.trim();
  const avatarFile = settingsAvatar.files[0];

  const formData = new FormData();
  if (username) formData.append('username', username);
  if (bio !== undefined) formData.append('bio', bio);
  if (avatarFile) formData.append('avatar', avatarFile);

  try {
    const res = await fetch('/users/me', {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + token },
      body: formData
    });
    const data = await res.json();
    if (!res.ok) {
      settingsError.innerText = data.error || 'Ошибка сохранения';
      return;
    }
    // Обновляем локальные данные
    currentUser = { ...currentUser, ...data };
    myName.innerText = currentUser.username;
    myAvatar.src = avatarOrDefault(currentUser.avatar);
    // Закрываем модалку
    settingsModal.classList.add('hidden');
    // Обновляем список чатов (новое имя и аватар)
    loadChats();
  } catch (err) {
    settingsError.innerText = 'Ошибка сети';
    console.error(err);
  }
});

// ==================== ПРОСМОТР ПРОФИЛЯ (закрытие) ====================
closeProfileBtn?.addEventListener('click', () => {
  profileModal.classList.add('hidden');
});

// Клик по имени в шапке чата — открыть профиль собеседника
chatName?.addEventListener('click', () => {
  if (activeChatOther) {
    openProfile(activeChatOther.id);
  }
});

// ==================== ВЫХОД ====================
logoutBtn?.addEventListener('click', () => {
  if (confirm('Подтвердите выход из аккаунта')) logout();
});

logo?.addEventListener('click', () => {
  logoutBtn?.classList.toggle('hidden');
  logoutBtn?.classList.toggle('visible');
});

// ==================== ПОСЛЕ АВТОРИЗАЦИИ ====================
async function afterAuth() {
  const r = await fetch('/me', { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) { logout(); return; }
  currentUser = await r.json();
  currentUserInfo?.classList.remove('hidden');
  myAvatar.src = avatarOrDefault(currentUser.avatar);
  myName.innerText = currentUser.username;
  logoutBtn?.classList.remove('hidden');

  connectSocket();
  await loadChats();
}

function logout() {
  token = null;
  currentUser = null;
  activeChatId = null;
  localStorage.removeItem('hichat_token');
  if (socket) socket.disconnect();
  window.location.href = '/auth.html';
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
(async function init() {
  if (!token) {
    window.location.href = '/auth.html';
    return;
  }
  const r = await fetch('/me', { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) {
    logout(); // редирект на auth.html
    return;
  }
  currentUser = await r.json();
  afterAuth();
})();