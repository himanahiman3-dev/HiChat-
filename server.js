const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const JWT_SECRET = "replace_this_with_a_real_secret_in_prod";

const DB_PATH = path.join(__dirname, "db.json");
const UPLOAD_PATH = path.join(__dirname, "public", "uploads");
const DEFAULT_AVATAR_PATH = path.join(__dirname, "public", "default-avatar.png");

// ------------------------------ ИНИЦИАЛИЗАЦИЯ ------------------------------
if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, JSON.stringify({ users: [], chats: [], messages: [] }, null, 2));
}
if (!fs.existsSync(DEFAULT_AVATAR_PATH)) {
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync(DEFAULT_AVATAR_PATH, pixel);
}
if (!fs.existsSync(UPLOAD_PATH)) fs.mkdirSync(UPLOAD_PATH, { recursive: true });

// ------------------------------ БАЗА ДАННЫХ ------------------------------
function readDB() {
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}
function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ------------------------------ МИДЛВАРЫ ------------------------------
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

// ------------------------------ MULTER (ЗАГРУЗКА ФАЙЛОВ) ------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_PATH),
  filename: (req, file, cb) =>
    cb(null, Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8) + path.extname(file.originalname))
});
const upload = multer({ storage });

// ============================== МАРШРУТЫ ==============================

// --------------------------------- РЕГИСТРАЦИЯ ---------------------------------
app.post("/register", upload.single("avatar"), async (req, res) => {
  try {
    const { email, password, username } = req.body;
    if (!email || !password || !username) {
      return res.status(400).json({ error: "Email, username and password are required" });
    }

    const db = readDB();

    if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
      return res.status(400).json({ error: "Email already used" });
    }
    if (db.users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
      return res.status(400).json({ error: "Username already taken" });
    }

    const hashed = await bcrypt.hash(password, 10);

    const newUser = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      email,
      username: username.trim(),
      password: hashed,
      avatar: req.file ? `/uploads/${req.file.filename}` : "/default-avatar.png",
      online: false,
      bio: "" // добавлено для профиля
    };

    db.users.push(newUser);
    writeDB(db);

    res.json({ success: true });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --------------------------------- ВХОД ---------------------------------
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) return res.status(400).json({ error: "Invalid email or password" });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ error: "Invalid email or password" });

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        email: user.email,
        bio: user.bio || ""
      }
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --------------------------------- ТЕКУЩИЙ ПОЛЬЗОВАТЕЛЬ ---------------------------------
app.get("/me", (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const db = readDB();

    if (auth.startsWith("Bearer ")) {
      const token = auth.replace("Bearer ", "");
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        const user = db.users.find(u => u.id === payload.userId);
        if (!user) return res.status(404).json({ error: "User not found" });

        return res.json({
          id: user.id,
          username: user.username,
          email: user.email,
          avatar: user.avatar,
          online: user.online,
          bio: user.bio || ""
        });
      } catch {
        return res.status(401).json({ error: "Invalid token" });
      }
    }

    res.status(401).json({ error: "Unauthorized" });
  } catch (err) {
    console.error("/me error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --------------------------------- ПОИСК ПОЛЬЗОВАТЕЛЕЙ ПО ИМЕНИ ---------------------------------
app.get("/users", (req, res) => {
  const { username } = req.query;
  const db = readDB();
  if (!username) return res.json([]);
  const q = username.trim().toLowerCase();
  const found = db.users
    .filter(u => u.username.toLowerCase().includes(q))
    .map(u => ({ id: u.id, username: u.username, avatar: u.avatar, online: u.online }));
  res.json(found);
});

// --------------------------------- ПУБЛИЧНЫЙ ПРОФИЛЬ ПО ID ---------------------------------
app.get("/users/:id", (req, res) => {
  try {
    const db = readDB();
    const user = db.users.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({
      id: user.id,
      username: user.username,
      avatar: user.avatar,
      bio: user.bio || "",
      online: user.online || false
    });
  } catch (err) {
    console.error("Get user profile error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// --------------------------------- ПУБЛИЧНЫЙ ПРОФИЛЬ ПО USERNAME (HTML) ---------------------------------
app.get("/u/:username", (req, res) => {
  try {
    const db = readDB();
    const user = db.users.find(u => u.username.toLowerCase() === req.params.username.toLowerCase());
    if (!user) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
          <head><title>Пользователь не найден</title><link rel="stylesheet" href="/style.css"></head>
          <body class="auth-page">
            <div class="auth-container">
              <div class="auth-card" style="text-align:center;">
                <h1>😕 Пользователь @${escapeHtml(req.params.username)} не найден</h1>
                <a href="/" class="btn-gradient" style="display:inline-block; margin-top:20px;">Вернуться в чат</a>
              </div>
            </div>
          </body>
        </html>
      `);
    }

    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>@${user.username} · HiChat</title>
          <meta property="og:title" content="@${user.username}">
          <meta property="og:description" content="${user.bio ? escapeHtml(user.bio.slice(0, 100)) : 'Пользователь HiChat'}">
          <meta property="og:image" content="http://localhost:3000${user.avatar}">
          <meta name="twitter:card" content="summary_large_image">
          <link rel="stylesheet" href="/style.css">
        </head>
        <body class="auth-page">
          <div class="auth-container">
            <div class="auth-card profile-view" style="max-width:500px;">
              <div style="display: flex; align-items: center; gap: 20px;">
                <img src="${user.avatar}" class="avatar-large" style="width:100px; height:100px;" onerror="this.src='/default-avatar.png'">
                <div>
                  <h1 style="margin-bottom:5px;">@${user.username}</h1>
                  <span class="online-status ${user.online ? 'online' : 'offline'}">
                    ${user.online ? '● В сети' : '○ Не в сети'}
                  </span>
                </div>
              </div>
              <div class="profile-bio" style="margin-top:20px;">
                ${user.bio ? escapeHtml(user.bio).replace(/\n/g, '<br>') : 'Пользователь пока ничего не написал о себе.'}
              </div>
              <div style="display: flex; gap: 12px; margin-top: 24px;">
                <a href="/auth.html" class="btn-gradient" style="flex:1; text-align:center;">Войти и написать</a>
                <a href="/" class="btn-ghost" style="flex:1; text-align:center;">На главную</a>
              </div>
            </div>
          </div>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("Public profile error:", err);
    res.status(500).send("Server error");
  }
});

// --------------------------------- ОБНОВЛЕНИЕ ПРОФИЛЯ ---------------------------------
app.put("/users/me", upload.single("avatar"), async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    if (!auth.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });

    const token = auth.replace("Bearer ", "");
    const payload = jwt.verify(token, JWT_SECRET);
    const userId = payload.userId;

    const db = readDB();
    const user = db.users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    const { username, bio } = req.body;

    if (username && username.trim() !== user.username) {
      const existing = db.users.find(u => u.username.toLowerCase() === username.trim().toLowerCase());
      if (existing) return res.status(400).json({ error: "Username already taken" });
      user.username = username.trim();
    }

    if (bio !== undefined) user.bio = bio.trim();

    if (req.file) {
      user.avatar = `/uploads/${req.file.filename}`;
    }

    writeDB(db);

    res.json({
      id: user.id,
      username: user.username,
      avatar: user.avatar,
      bio: user.bio || "",
      online: user.online
    });
  } catch (err) {
    console.error("Update profile error:", err);
    if (err.name === "JsonWebTokenError") return res.status(401).json({ error: "Invalid token" });
    res.status(500).json({ error: "Server error" });
  }
});

// --------------------------------- СПИСОК ЧАТОВ ---------------------------------
app.get("/chats", (req, res) => {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });

  try {
    const token = auth.replace("Bearer ", "");
    const db = readDB();
    const payload = jwt.verify(token, JWT_SECRET);
    const userId = payload.userId;

    const chats = db.chats
      .filter(c => c.members.includes(userId))
      .map(c => {
        const otherId = c.members.find(id => id !== userId);
        const other = db.users.find(u => u.id === otherId) || {};
        const lastMsg = db.messages.filter(m => m.chatId === c.id).slice(-1)[0] || null;
        const unread = c.unread ? (c.unread[userId] || 0) : 0;

        return {
          id: c.id,
          otherUser: {
            id: other.id,
            username: other.username,
            avatar: other.avatar,
            online: other.online
          },
          lastMessage: lastMsg ? { text: lastMsg.text, ts: lastMsg.ts } : null,
          unread
        };
      });

    res.json(chats);
  } catch (err) {
    console.error("/chats error", err);
    res.status(500).json({ error: "Server error" });
  }
});

// --------------------------------- СООБЩЕНИЯ ЧАТА ---------------------------------
app.get("/chats/:id/messages", (req, res) => {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });

  try {
    const token = auth.replace("Bearer ", "");
    const db = readDB();
    const payload = jwt.verify(token, JWT_SECRET);
    const userId = payload.userId;

    const chat = db.chats.find(c => c.id === req.params.id);
    if (!chat || !chat.members.includes(userId)) return res.status(403).json({ error: "Forbidden" });

    if (chat.unread) chat.unread[userId] = 0;
    writeDB(db);

    const msgs = db.messages.filter(m => m.chatId === chat.id);
    res.json(msgs);
  } catch (err) {
    console.error("Get messages error", err);
    res.status(500).json({ error: "Server error" });
  }
});

// --------------------------------- СОЗДАТЬ ИЛИ ПОЛУЧИТЬ ЧАТ ---------------------------------
app.post("/chats", (req, res) => {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });

  try {
    const token = auth.replace("Bearer ", "");
    const db = readDB();
    const payload = jwt.verify(token, JWT_SECRET);
    const userId = payload.userId;

    const { username, otherUserId } = req.body;
    let other = null;

    if (otherUserId) {
      other = db.users.find(u => u.id === otherUserId);
    } else if (username) {
      other = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
    }

    if (!other) return res.status(400).json({ error: "User not found" });
    if (other.id === userId) return res.status(400).json({ error: "Cannot chat with yourself" });

    let chat = db.chats.find(c => c.members.includes(userId) && c.members.includes(other.id));

    if (!chat) {
      chat = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        members: [userId, other.id],
        unread: {}
      };
      chat.unread[userId] = 0;
      chat.unread[other.id] = 0;
      db.chats.push(chat);
      writeDB(db);

      const recipientSockets = activeSockets[other.id] || [];
      recipientSockets.forEach(sid => io.to(sid).emit("chat created", {
        id: chat.id,
        otherUser: {
          id: other.id,
          username: other.username,
          avatar: other.avatar,
          online: other.online
        }
      }));
    }

    res.json({
      id: chat.id,
      otherUser: {
        id: other.id,
        username: other.username,
        avatar: other.avatar,
        online: other.online
      }
    });
  } catch (err) {
    console.error("Create chat error", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ============================== SOCKET.IO ==============================
const activeSockets = {}; // userId -> [socketId, ...]

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error("Unauthorized"));

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.userId = payload.userId;
    next();
  } catch {
    next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  const userId = socket.userId;
  activeSockets[userId] = activeSockets[userId] || [];
  activeSockets[userId].push(socket.id);

  // Установка онлайн-статуса
  const db = readDB();
  const user = db.users.find(u => u.id === userId);
  if (user) {
    user.online = true;
    writeDB(db);
  }
  io.emit("presence", { userId, online: true });

  // Присоединение к комнате чата
  socket.on("join chat", (chatId) => socket.join(chatId));

  // -------------------- СООБЩЕНИЯ --------------------
  socket.on("chat message", (data) => {
    const { chatId, text, replyTo } = data;
    const db2 = readDB();
    const chat = db2.chats.find(c => c.id === chatId);
    if (!chat) return;
    const user = db2.users.find(u => u.id === userId);
    if (!user) return;

    const message = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      chatId,
      userId,
      name: user.username,
      avatar: user.avatar,
      text: text.trim(),
      ts: Date.now()
    };

    if (replyTo) message.replyTo = replyTo;

    db2.messages.push(message);

    chat.members.forEach(mid => {
      if (mid !== userId) chat.unread[mid] = (chat.unread[mid] || 0) + 1;
    });

    writeDB(db2);

    io.to(chatId).emit("chat message", message);

    chat.members.forEach(mid => {
      if (mid !== userId) {
        const socketsFor = activeSockets[mid] || [];
        socketsFor.forEach(sid => io.to(sid).emit("unread update", { chatId, unread: chat.unread[mid] }));
      }
    });
  });

  // -------------------- WEBRTC СИГНАЛИЗАЦИЯ (ЗВОНКИ) --------------------
  socket.on("webrtc-offer", (data) => {
    const { targetUserId, sdp, callId } = data;
    const user = db.users.find(u => u.id === userId);
    const targetSockets = activeSockets[targetUserId] || [];
    targetSockets.forEach(sid => {
      io.to(sid).emit("webrtc-offer", {
        callerId: userId,
        callerUsername: user?.username || "Пользователь",
        callerAvatar: user?.avatar || "/default-avatar.png",
        sdp,
        callId
      });
    });
  });

  socket.on("webrtc-answer", (data) => {
    const { targetUserId, sdp, callId } = data;
    const targetSockets = activeSockets[targetUserId] || [];
    targetSockets.forEach(sid => {
      io.to(sid).emit("webrtc-answer", {
        callerId: userId,
        sdp,
        callId
      });
    });
  });

  socket.on("webrtc-ice-candidate", (data) => {
    const { targetUserId, candidate, callId } = data;
    const targetSockets = activeSockets[targetUserId] || [];
    targetSockets.forEach(sid => {
      io.to(sid).emit("webrtc-ice-candidate", {
        callerId: userId,
        candidate,
        callId
      });
    });
  });

  socket.on("webrtc-call-reject", (data) => {
    const { targetUserId, callId } = data;
    const targetSockets = activeSockets[targetUserId] || [];
    targetSockets.forEach(sid => {
      io.to(sid).emit("webrtc-call-reject", {
        callerId: userId,
        callId
      });
    });
  });

  socket.on("webrtc-call-end", (data) => {
    const { targetUserId, callId } = data;
    const targetSockets = activeSockets[targetUserId] || [];
    targetSockets.forEach(sid => {
      io.to(sid).emit("webrtc-call-end", {
        callerId: userId,
        callId
      });
    });
  });

  socket.on("webrtc-toggle-mute", (data) => {
    const { targetUserId, muted, callId } = data;
    const targetSockets = activeSockets[targetUserId] || [];
    targetSockets.forEach(sid => {
      io.to(sid).emit("webrtc-toggle-mute", {
        callerId: userId,
        muted,
        callId
      });
    });
  });

  // -------------------- ОТКЛЮЧЕНИЕ --------------------
  socket.on("disconnect", () => {
    if (activeSockets[userId]) {
      activeSockets[userId] = activeSockets[userId].filter(id => id !== socket.id);
      if (activeSockets[userId].length === 0) delete activeSockets[userId];
    }

    if (!activeSockets[userId]) {
      const db3 = readDB();
      const u3 = db3.users.find(u => u.id === userId);
      if (u3) {
        u3.online = false;
        writeDB(db3);
      }
      io.emit("presence", { userId, online: false });
    }
  });
});

// ------------------------------ ЗАПУСК СЕРВЕРА ------------------------------
server.listen(PORT, () => {
  console.log(`HiChat server running at http://localhost:${PORT}`);
});

// ------------------------------ ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ ЭКРАНИРОВАНИЯ ------------------------------
function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
