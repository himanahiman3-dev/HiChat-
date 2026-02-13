// ==================== HiChat — ФИНАЛ: ЧАТЫ + ЗВОНКИ ====================
let token = localStorage.getItem('hichat_token') || null;
let currentUser = null;
let socket = null;
let activeChatId = null;
let activeChatOther = null;
let chatsCache = {};

// ---------- WebRTC звонки ----------
let peerConnection = null;
let localStream = null;
let remoteStream = null;
let currentCallId = null;
let currentCallPeerId = null;
let currentCallPeerName = "";
let currentCallPeerAvatar = "";
let callTimer = null;
let callSeconds = 0;
let isMuted = false;

// DOM элементы (сохраняем все твои старые + добавляем новые для звонков)
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

// Модалка настроек
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

// Модалка профиля
const profileModal = document.getElementById('profileModal');
const profileAvatar = document.getElementById('profileAvatar');
const profileUsername = document.getElementById('profileUsername');
const profileBio = document.getElementById('profileBio');
const profileOnline = document.getElementById('profileOnline');
const closeProfileBtn = document.getElementById('closeProfileBtn');

// ---------- НОВЫЕ ЭЛЕМЕНТЫ ДЛЯ ЗВОНКОВ ----------
const incomingCallModal = document.getElementById('incomingCallModal');
const incomingCallerAvatar = document.getElementById('incomingCallerAvatar');
const incomingCallerName = document.getElementById('incomingCallerName');
const acceptCallBtn = document.getElementById('acceptCallBtn');
const rejectCallBtn = document.getElementById('rejectCallBtn');

const activeCallModal = document.getElementById('activeCallModal');
const activeCallAvatar = document.getElementById('activeCallAvatar');
const activeCallName = document.getElementById('activeCallName');
const callTimerEl = document.getElementById('callTimer');
const muteMicBtn = document.getElementById('muteMicBtn');
const endCallBtn = document.getElementById('endCallBtn');
const muteStatus = document.getElementById('muteStatus');

// Поиск
const searchToggleBtn = document.getElementById('searchToggleBtn');
const searchInput = document.getElementById('searchInput');

// Ответы
let replyingTo = null;

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

// ==================== ЧАТ ====================
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
    renderMessagesWithDividers(msgs);
    await loadChats();
  } else {
    messagesEl.innerHTML = '';
  }
  
  cancelReply();
  if (searchInput) {
    searchInput.value = '';
    searchInput.classList.add('hidden');
    clearSearchHighlight();
  }
}

function renderMessagesWithDividers(msgs) {
  messagesEl.innerHTML = '';
  if (!msgs.length) return;

  let lastDate = null;
  msgs.sort((a, b) => a.ts - b.ts).forEach(msg => {
    const msgDate = new Date(msg.ts).toDateString();
    if (msgDate !== lastDate) {
      lastDate = msgDate;
      const divider = document.createElement('div');
      divider.className = 'date-divider';
      let dateText = new Date(msg.ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
      dateText = dateText.replace(' г.', '');
      const span = document.createElement('span');
      span.innerText = dateText;
      divider.appendChild(span);
      messagesEl.appendChild(divider);
    }
    renderMessage(msg);
  });
}

function renderMessage(msg) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message';
  wrapper.dataset.messageId = msg.id;

  const avatar = document.createElement('img');
  avatar.className = 'avatar-small';
  avatar.src = avatarOrDefault(msg.avatar);
  avatar.alt = msg.name || 'User';

  const body = document.createElement('div');
  body.className = 'msg-body';

  if (msg.replyTo) {
    const replyBlock = document.createElement('div');
    replyBlock.className = 'message-reply';
    replyBlock.innerHTML = `
      <span class="reply-author">@${escapeHtml(msg.replyTo.username || 'пользователь')}</span>
      <span class="reply-text">${escapeHtml(msg.replyTo.text.slice(0, 50))}${msg.replyTo.text.length > 50 ? '…' : ''}</span>
    `;
    body.appendChild(replyBlock);
  }

  const header = document.createElement('div');
  header.className = 'msg-header';
  header.innerHTML = `<span>${escapeHtml(msg.name || 'Unknown')}</span>
                      <small style="opacity:.6;margin-left:8px;font-size:12px">${new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>`;

  const text = document.createElement('div');
  text.className = 'msg-text';
  text.innerText = msg.text;

  body.appendChild(header);
  body.appendChild(text);

  const replyBtn = document.createElement('button');
  replyBtn.className = 'reply-btn';
  replyBtn.innerHTML = '↩️';
  replyBtn.title = 'Ответить';
  replyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    replyingTo = {
      id: msg.id,
      text: msg.text,
      username: msg.name,
      userId: msg.userId
    };
    showReplyPreview(replyingTo);
  });
  header.appendChild(replyBtn);

  wrapper.appendChild(avatar);
  wrapper.appendChild(body);

  messagesEl.appendChild(wrapper);
}

function showReplyPreview(reply) {
  const oldPreview = document.querySelector('.reply-preview');
  if (oldPreview) oldPreview.remove();

  const preview = document.createElement('div');
  preview.className = 'reply-preview';
  preview.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <span style="font-size: 16px;">↩️</span>
      <div>
        <span>@${escapeHtml(reply.username)}</span>
        <span style="opacity:0.7; margin-left: 6px;">${escapeHtml(reply.text.slice(0, 40))}${reply.text.length > 40 ? '…' : ''}</span>
      </div>
    </div>
    <button id="cancelReplyBtn" title="Отмена">✕</button>
  `;
  
  const inputArea = document.querySelector('.input-area');
  inputArea.parentNode.insertBefore(preview, inputArea);
  
  document.getElementById('cancelReplyBtn').addEventListener('click', cancelReply);
}

function cancelReply() {
  replyingTo = null;
  const preview = document.querySelector('.reply-preview');
  if (preview) preview.remove();
}

// ==================== ПОИСК ====================
searchToggleBtn?.addEventListener('click', () => {
  searchInput.classList.toggle('hidden');
  if (!searchInput.classList.contains('hidden')) {
    searchInput.focus();
  } else {
    clearSearchHighlight();
  }
});

searchInput?.addEventListener('input', function(e) {
  const query = e.target.value.trim().toLowerCase();
  if (!query) {
    clearSearchHighlight();
    return;
  }

  const messages = document.querySelectorAll('.message');
  let firstMatch = null;
  
  messages.forEach(msg => {
    const textEl = msg.querySelector('.msg-text');
    if (!textEl) return;
    const text = textEl.innerText.toLowerCase();
    if (text.includes(query)) {
      msg.classList.add('highlight');
      if (!firstMatch) firstMatch = msg;
    } else {
      msg.classList.remove('highlight');
    }
  });

  if (firstMatch) {
    firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});

function clearSearchHighlight() {
  document.querySelectorAll('.message.highlight').forEach(el => el.classList.remove('highlight'));
}

// ==================== ОТПРАВКА СООБЩЕНИЙ ====================
sendBtn?.addEventListener('click', () => {
  const text = messageInput.value.trim();
  if (!text || !activeChatId) return;
  if (!socket || !socket.connected) { alert('Нет подключения. Обновите страницу.'); return; }
  
  const messageData = { chatId: activeChatId, text };
  if (replyingTo) {
    messageData.replyTo = {
      id: replyingTo.id,
      text: replyingTo.text,
      username: replyingTo.username,
      userId: replyingTo.userId
    };
  }
  
  socket.emit('chat message', messageData);
  messageInput.value = '';
  cancelReply();
});

messageInput?.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendBtn.click();
  }
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

closeSettingsBtn?.addEventListener('click', () => {
  settingsModal.classList.add('hidden');
});

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
    currentUser = { ...currentUser, ...data };
    myName.innerText = currentUser.username;
    myAvatar.src = avatarOrDefault(currentUser.avatar);
    settingsModal.classList.add('hidden');
    loadChats();
  } catch (err) {
    settingsError.innerText = 'Ошибка сети';
    console.error(err);
  }
});

// ==================== ПРОСМОТР ПРОФИЛЯ (с кнопкой звонка) ====================
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
      
      // Удаляем старую кнопку звонка, если есть
      const oldBtn = document.getElementById('callUserBtn');
      if (oldBtn) oldBtn.remove();
      
      // Добавляем кнопку звонка
      const callBtn = document.createElement('button');
      callBtn.id = 'callUserBtn';
      callBtn.className = 'btn-gradient';
      callBtn.style.marginTop = '16px';
      callBtn.style.width = '100%';
      callBtn.innerHTML = '📞 Позвонить';
      
      if (!user.online) {
        callBtn.disabled = true;
        callBtn.style.opacity = '0.5';
        callBtn.style.cursor = 'not-allowed';
        callBtn.title = 'Пользователь не в сети';
      } else {
        callBtn.addEventListener('click', () => {
          profileModal.classList.add('hidden');
          startCall(user.id, user.username, user.avatar);
        });
      }
      
      document.querySelector('.profile-view').appendChild(callBtn);
      
      profileModal.classList.remove('hidden');
    })
    .catch(err => {
      console.error('Ошибка загрузки профиля:', err);
      alert('Не удалось загрузить профиль');
    });
}

closeProfileBtn?.addEventListener('click', () => {
  profileModal.classList.add('hidden');
});

chatName?.addEventListener('click', () => {
  if (activeChatOther) {
    openProfile(activeChatOther.id);
  }
});

// ==================== WEBRTC ЗВОНКИ ====================
const STUN_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Запрос доступа к микрофону
async function getLocalStream() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    return true;
  } catch (err) {
    console.error('Ошибка доступа к микрофону:', err);
    alert('Не удалось получить доступ к микрофону. Проверьте разрешения.');
    return false;
  }
}

// Исходящий звонок
async function startCall(targetUserId, targetUsername, targetAvatar) {
  if (!socket || !socket.connected) {
    alert('Нет подключения к серверу');
    return;
  }
  
  // Запрашиваем микрофон
  const hasMic = await getLocalStream();
  if (!hasMic) return;
  
  // Создаём новый Call ID
  currentCallId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  currentCallPeerId = targetUserId;
  currentCallPeerName = targetUsername;
  currentCallPeerAvatar = targetAvatar;
  
  // Создаём PeerConnection
  peerConnection = new RTCPeerConnection(STUN_SERVERS);
  
  // Добавляем аудиотреки в соединение
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });
  
  // Получаем удалённый поток
  remoteStream = new MediaStream();
  peerConnection.ontrack = (event) => {
    event.streams[0].getTracks().forEach(track => {
      remoteStream.addTrack(track);
    });
  };
  
  // ICE кандидаты
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('webrtc-ice-candidate', {
        targetUserId,
        candidate: event.candidate,
        callId: currentCallId
      });
    }
  };
  
  // Создаём предложение
  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    socket.emit('webrtc-offer', {
      targetUserId,
      sdp: peerConnection.localDescription,
      callId: currentCallId
    });
    
    // Показываем окно активного звонка
    showActiveCallModal(targetUsername, targetAvatar);
    
  } catch (err) {
    console.error('Ошибка создания звонка:', err);
    alert('Не удалось создать звонок');
    endCall();
  }
}

// Принять входящий звонок
async function acceptCall() {
  if (!peerConnection) return;
  
  try {
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    
    socket.emit('webrtc-answer', {
      targetUserId: currentCallPeerId,
      sdp: peerConnection.localDescription,
      callId: currentCallId
    });
    
    // Скрываем модалку входящего звонка
    incomingCallModal.classList.add('hidden');
    
    // Показываем активный звонок
    showActiveCallModal(currentCallPeerName, currentCallPeerAvatar);
    
  } catch (err) {
    console.error('Ошибка при ответе на звонок:', err);
  }
}

// Отклонить входящий звонок
function rejectCall() {
  socket.emit('webrtc-call-reject', {
    targetUserId: currentCallPeerId,
    callId: currentCallId
  });
  
  incomingCallModal.classList.add('hidden');
  cleanupCall();
}

// Завершить звонок
function endCall() {
  socket.emit('webrtc-call-end', {
    targetUserId: currentCallPeerId,
    callId: currentCallId
  });
  
  activeCallModal.classList.add('hidden');
  cleanupCall();
}

// Очистка WebRTC
function cleanupCall() {
  if (callTimer) clearInterval(callTimer);
  callTimer = null;
  callSeconds = 0;
  isMuted = false;
  
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  
  remoteStream = null;
  currentCallId = null;
  currentCallPeerId = null;
}

// Показать окно активного звонка
function showActiveCallModal(username, avatar) {
  activeCallAvatar.src = avatarOrDefault(avatar);
  activeCallName.innerText = username;
  callSeconds = 0;
  callTimerEl.innerText = '00:00';
  
  if (callTimer) clearInterval(callTimer);
  callTimer = setInterval(() => {
    callSeconds++;
    const mins = Math.floor(callSeconds / 60);
    const secs = callSeconds % 60;
    callTimerEl.innerText = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, 1000);
  
  activeCallModal.classList.remove('hidden');
}

// Переключение микрофона
function toggleMute() {
  if (!localStream) return;
  
  const audioTracks = localStream.getAudioTracks();
  audioTracks.forEach(track => {
    track.enabled = !track.enabled;
  });
  
  isMuted = !isMuted;
  
  if (muteMicBtn) {
    muteMicBtn.style.background = isMuted ? 'rgba(255,80,80,0.3)' : 'rgba(255,255,255,0.05)';
    muteMicBtn.style.color = isMuted ? '#ff6b6b' : 'white';
  }
  
  if (muteStatus) {
    muteStatus.innerText = isMuted ? '🔇 Микрофон выключен' : '🎤 Микрофон включён';
  }
  
  // Уведомляем собеседника о статусе микрофона
  if (currentCallPeerId) {
    socket.emit('webrtc-toggle-mute', {
      targetUserId: currentCallPeerId,
      muted: isMuted,
      callId: currentCallId
    });
  }
}

// ==================== ОБРАБОТЧИКИ СОКЕТА ====================
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
      fetch(`/chats/${activeChatId}/messages`, { headers: { Authorization: 'Bearer ' + token } })
        .then(res => res.json())
        .then(msgs => renderMessagesWithDividers(msgs));
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

  // ==================== WEBRTC SIGNALING ====================
  socket.on('webrtc-offer', async (data) => {
    const { callerId, callerUsername, callerAvatar, sdp, callId } = data;
    
    // Сохраняем информацию о звонке
    currentCallId = callId;
    currentCallPeerId = callerId;
    currentCallPeerName = callerUsername;
    currentCallPeerAvatar = callerAvatar;
    
    // Запрашиваем микрофон
    const hasMic = await getLocalStream();
    if (!hasMic) {
      // Отклоняем, если нет микрофона
      socket.emit('webrtc-call-reject', {
        targetUserId: callerId,
        callId
      });
      return;
    }
    
    // Создаём PeerConnection
    peerConnection = new RTCPeerConnection(STUN_SERVERS);
    
    // Добавляем аудиотреки
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });
    
    // Получаем удалённый поток
    remoteStream = new MediaStream();
    peerConnection.ontrack = (event) => {
      event.streams[0].getTracks().forEach(track => {
        remoteStream.addTrack(track);
      });
    };
    
    // ICE кандидаты
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc-ice-candidate', {
          targetUserId: callerId,
          candidate: event.candidate,
          callId
        });
      }
    };
    
    // Устанавливаем удалённое описание
    await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    
    // Показываем модалку входящего звонка
    incomingCallerAvatar.src = avatarOrDefault(callerAvatar);
    incomingCallerName.innerText = callerUsername;
    incomingCallModal.classList.remove('hidden');
  });

  socket.on('webrtc-answer', async (data) => {
    const { callerId, sdp } = data;
    
    if (peerConnection && currentCallPeerId === callerId) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    }
  });

  socket.on('webrtc-ice-candidate', async (data) => {
    const { callerId, candidate } = data;
    
    if (peerConnection && currentCallPeerId === callerId) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('Ошибка добавления ICE candidate:', err);
      }
    }
  });

  socket.on('webrtc-call-reject', (data) => {
    if (data.callId === currentCallId) {
      alert('❌ Пользователь отклонил звонок');
      activeCallModal.classList.add('hidden');
      incomingCallModal.classList.add('hidden');
      cleanupCall();
    }
  });

  socket.on('webrtc-call-end', (data) => {
    if (data.callId === currentCallId) {
      alert('🔴 Звонок завершён');
      activeCallModal.classList.add('hidden');
      incomingCallModal.classList.add('hidden');
      cleanupCall();
    }
  });

  socket.on('webrtc-toggle-mute', (data) => {
    if (data.callId === currentCallId) {
      // Показываем уведомление о статусе микрофона собеседника
      const status = data.muted ? '🔇 выключил(а) микрофон' : '🎤 включил(а) микрофон';
      // Можно показать небольшой уведомитель
    }
  });
}

function findChatElement(chatId) {
  return chatsContainer.querySelector(`[data-chat-id="${chatId}"]`);
}

// ==================== ИНИЦИАЛИЗАЦИЯ ЗВОНКОВ ====================
acceptCallBtn?.addEventListener('click', acceptCall);
rejectCallBtn?.addEventListener('click', rejectCall);
endCallBtn?.addEventListener('click', endCall);
muteMicBtn?.addEventListener('click', toggleMute);

// ==================== КОПИРОВАТЬ ССЫЛКУ ====================
const copyProfileLinkBtn = document.getElementById('copyProfileLinkBtn');
const copyLinkMessage = document.getElementById('copyLinkMessage');

copyProfileLinkBtn?.addEventListener('click', () => {
  if (!currentUser) return;
  const link = `${window.location.origin}/u/${currentUser.username}`;
  navigator.clipboard.writeText(link).then(() => {
    copyLinkMessage.innerText = '✅ Ссылка скопирована!';
    setTimeout(() => { copyLinkMessage.innerText = ''; }, 2000);
  }).catch(() => {
    copyLinkMessage.innerText = '❌ Ошибка копирования';
  });
});

// ==================== ВЫХОД ====================
logoutBtn?.addEventListener('click', () => {
  if (confirm('Подтвердите выход из аккаунта')) logout();
});

logo?.addEventListener('click', () => {
  logoutBtn?.classList.toggle('hidden');
  logoutBtn?.classList.toggle('visible');
});

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
  // Завершаем активный звонок, если есть
  if (currentCallId) {
    endCall();
  }
  
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
    logout();
    return;
  }
  currentUser = await r.json();
  afterAuth();
})();
