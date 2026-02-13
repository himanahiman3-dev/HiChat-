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

// Инициализация БД
if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, JSON.stringify({ users: [], chats: [], messages: [] }, null, 2));
}
// Создаём дефолтную аватарку, если её нет
if (!fs.existsSync(DEFAULT_AVATAR_PATH)) {
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync(DEFAULT_AVATAR_PATH, pixel);
}
if (!fs.existsSync(UPLOAD_PATH)) fs.mkdirSync(UPLOAD_PATH, { recursive: true });

function readDB() {
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}
function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_PATH),
  filename: (req, file, cb) => cb(null, Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8) + path.extname(file.originalname))
});
const upload = multer({ storage });

// ---------------------------------
// ROUTE: Register
// ---------------------------------
app.post("/register", upload.single("avatar"), async (req, res) => {
  try {
    const { email, password, username } = req.body;
    if (!email || !password || !username) return res.status(400).json({ error: "Email, username and password are required" });
    const db = readDB();
    if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase())) return res.status(400).json({ error: "Email already used" });
    if (db.users.find(u => u.username.toLowerCase() === username.toLowerCase())) return res.status(400).json({ error: "Username already taken" });
    const hashed = await bcrypt.hash(password, 10);
    const newUser = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      email,
      username: username.trim(),
      password: hashed,
      avatar: req.file ? `/uploads/${req.file.filename}` : "/default-avatar.png",
      online: false,
      bio: "" // FIX: добавляем поле bio
    };
    db.users.push(newUser);
    writeDB(db);
    res.json({ success: true });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------
// ROUTE: Login
// ---------------------------------
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) return res.status(400).json({ error: "Invalid email or password" });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ error: "Invalid email or password" });
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: { id: user.id, username: user.username, avatar: user.avatar, email: user.email } });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------
// ROUTE: Get current user
// ---------------------------------
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
        // FIX: добавляем bio в ответ
        return res.json({
          id: user.id,
          username: user.username,
          email: user.email,
          avatar: user.avatar,
          online: user.online,
          bio: user.bio || ""
        });
      } catch { return res.status(401).json({ error: "Invalid token" }); }
    }
    res.status(401).json({ error: "Unauthorized" });
  } catch (err) {
    console.error("/me error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------
// ROUTE: Search users
// ---------------------------------
app.get("/users", (req, res) => {
  const { username } = req.query;
  const db = readDB();
  if (!username) return res.json([]);
  const q = username.trim().toLowerCase();
  const found = db.users.filter(u => u.username.toLowerCase().includes(q)).map(u => ({ id: u.id, username: u.username, avatar: u.avatar, online: u.online }));
  res.json(found);
});

// ---------------------------------
// ROUTE: Get user profile (public)
// ---------------------------------
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

// ---------------------------------
// ROUTE: Update current user profile
// ---------------------------------
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

    // Проверяем уникальность username, если он меняется
    if (username && username.trim() !== user.username) {
      const existing = db.users.find(u => u.username.toLowerCase() === username.trim().toLowerCase());
      if (existing) return res.status(400).json({ error: "Username already taken" });
      user.username = username.trim();
    }

    // Обновляем bio, если есть
    if (bio !== undefined) user.bio = bio.trim();

    // Обновляем аватар, если загружен новый
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

// ---------------------------------
// ROUTE: Chats & messages
// ---------------------------------
app.get("/chats", (req, res) => {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
  try {
    const token = auth.replace("Bearer ", "");
    const db = readDB();
    const payload = jwt.verify(token, JWT_SECRET);
    const userId = payload.userId;
    const chats = db.chats.filter(c => c.members.includes(userId)).map(c => {
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
    if (otherUserId) other = db.users.find(u => u.id === otherUserId);
    else if (username) other = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
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
        otherUser: { id: other.id, username: other.username, avatar: other.avatar, online: other.online }
      }));
    }
    res.json({ id: chat.id, otherUser: { id: other.id, username: other.username, avatar: other.avatar, online: other.online } });
  } catch (err) {
    console.error("Create chat error", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ---------------------------------
// SOCKET.IO — realtime
// ---------------------------------
const activeSockets = {};

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error("Unauthorized"));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.userId = payload.userId;
    next();
  } catch { next(new Error("Unauthorized")); }
});

io.on("connection", socket => {
  const userId = socket.userId;
  activeSockets[userId] = activeSockets[userId] || [];
  activeSockets[userId].push(socket.id);
  const db = readDB();
  const user = db.users.find(u => u.id === userId);
  if (user) {
    user.online = true;
    writeDB(db);
  }
  io.emit("presence", { userId, online: true });

  socket.on("join chat", chatId => socket.join(chatId));

  socket.on("chat message", data => {
  const { chatId, text, replyTo } = data; // 👈 добавили replyTo
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
  if (replyTo) {
    message.replyTo = replyTo; // 👈 сохраняем информацию об ответе
  }
  db2.messages.push(message);
  chat.members.forEach(mid => { if (mid !== userId) chat.unread[mid] = (chat.unread[mid] || 0) + 1; });
  writeDB(db2);
  io.to(chatId).emit("chat message", message);
  chat.members.forEach(mid => {
    if (mid !== userId) {
      const socketsFor = activeSockets[mid] || [];
      socketsFor.forEach(sid => io.to(sid).emit("unread update", { chatId, unread: chat.unread[mid] }));
    }
  });
});

  socket.on("disconnect", () => {
    if (activeSockets[userId]) {
      activeSockets[userId] = activeSockets[userId].filter(id => id !== socket.id);
      if (activeSockets[userId].length === 0) delete activeSockets[userId];
    }
    if (!activeSockets[userId]) {
      const db3 = readDB();
      const u3 = db3.users.find(u => u.id === userId);
      if (u3) { u3.online = false; writeDB(db3); }
      io.emit("presence", { userId, online: false });
    }
  });
});

// ---------------------------------
// START SERVER
// ---------------------------------
server.listen(PORT, () => console.log(`HiChat server running at http://localhost:${PORT}`));
