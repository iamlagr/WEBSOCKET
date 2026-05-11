const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// ─── ARMAZENAMENTO EM MEMÓRIA ─────────────────────────────────────────────────
// { username: { password, socketId } }
const users = {};

// { roomName: Set<username> }
const rooms = {};

// { socketId: username }
const socketToUser = {};

// ─── ROTAS HTTP (health check) ────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "Chat server online", port: PORT });
});

// ─── HELPER: lista de usuários de uma sala ────────────────────────────────────
function getRoomUsers(roomName) {
  if (!rooms[roomName]) return [];
  return Array.from(rooms[roomName]);
}

// ─── HELPER: lista de salas com contagem ──────────────────────────────────────
function getRoomList() {
  return Object.keys(rooms).map((name) => ({
    name,
    userCount: rooms[name].size,
  }));
}

// ─── EVENTOS WEBSOCKET ────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`[+] Nova conexão: ${socket.id}`);

  // ── REGISTRO ──────────────────────────────────────────────────────────────
  // Evento:  register
  // Payload: { username: string, password: string }
  socket.on("register", ({ username, password }) => {
    if (!username || !password) {
      return socket.emit("register_response", {
        success: false,
        message: "Usuário e senha são obrigatórios.",
      });
    }
    if (users[username]) {
      return socket.emit("register_response", {
        success: false,
        message: "Usuário já existe.",
      });
    }
    users[username] = { password, socketId: null };
    console.log(`[REGISTER] ${username}`);
    socket.emit("register_response", {
      success: true,
      message: "Cadastro realizado com sucesso!",
    });
  });

  // ── LOGIN ─────────────────────────────────────────────────────────────────
  // Evento:  login
  // Payload: { username: string, password: string }
  socket.on("login", ({ username, password }) => {
    if (!users[username]) {
      return socket.emit("login_response", {
        success: false,
        message: "Usuário não encontrado.",
      });
    }
    if (users[username].password !== password) {
      return socket.emit("login_response", {
        success: false,
        message: "Senha incorreta.",
      });
    }
    // Atualiza socketId do usuário
    users[username].socketId = socket.id;
    socketToUser[socket.id] = username;
    console.log(`[LOGIN] ${username} → socket ${socket.id}`);
    socket.emit("login_response", {
      success: true,
      message: "Login realizado!",
      username,
    });
    // Envia lista de salas logo após o login
    socket.emit("room_list", { rooms: getRoomList() });
  });

  // ── CRIAR SALA ────────────────────────────────────────────────────────────
  // Evento:  create_room
  // Payload: { roomName: string }
  socket.on("create_room", ({ roomName }) => {
    const username = socketToUser[socket.id];
    if (!username) {
      return socket.emit("error", { message: "Não autenticado." });
    }
    if (!roomName || roomName.trim() === "") {
      return socket.emit("error", { message: "Nome de sala inválido." });
    }
    const name = roomName.trim();
    if (!rooms[name]) {
      rooms[name] = new Set();
      console.log(`[ROOM CREATED] "${name}" por ${username}`);
    }
    // Notifica todos os clientes conectados sobre a nova lista de salas
    io.emit("room_list", { rooms: getRoomList() });
  });

  // ── LISTAR SALAS ──────────────────────────────────────────────────────────
  // Evento:  get_rooms
  // Payload: (nenhum)
  socket.on("get_rooms", () => {
    socket.emit("room_list", { rooms: getRoomList() });
  });

  // ── ENTRAR EM SALA ────────────────────────────────────────────────────────
  // Evento:  join_room
  // Payload: { roomName: string }
  socket.on("join_room", ({ roomName }) => {
    const username = socketToUser[socket.id];
    if (!username) {
      return socket.emit("error", { message: "Não autenticado." });
    }
    if (!rooms[roomName]) {
      return socket.emit("error", { message: "Sala não existe." });
    }
    socket.join(roomName);
    rooms[roomName].add(username);
    console.log(`[JOIN] ${username} → sala "${roomName}"`);

    // Confirma entrada para o próprio usuário
    socket.emit("room_joined", {
      roomName,
      users: getRoomUsers(roomName),
    });

    // Avisa os outros que alguém entrou
    socket.to(roomName).emit("user_joined", { username, roomName });

    // Atualiza lista de usuários para todos na sala
    io.to(roomName).emit("room_users_updated", {
      roomName,
      users: getRoomUsers(roomName),
    });

    // Atualiza contagem de salas globalmente
    io.emit("room_list", { rooms: getRoomList() });
  });

  // ── SAIR DE SALA ──────────────────────────────────────────────────────────
  // Evento:  leave_room
  // Payload: { roomName: string }
  socket.on("leave_room", ({ roomName }) => {
    const username = socketToUser[socket.id];
    if (!username || !rooms[roomName]) return;
    socket.leave(roomName);
    rooms[roomName].delete(username);
    console.log(`[LEAVE] ${username} saiu de "${roomName}"`);

    socket.to(roomName).emit("user_left", { username, roomName });
    io.to(roomName).emit("room_users_updated", {
      roomName,
      users: getRoomUsers(roomName),
    });
    io.emit("room_list", { rooms: getRoomList() });
  });

  // ── ENVIAR MENSAGEM ───────────────────────────────────────────────────────
  // Evento:  send_message
  // Payload: { roomName: string, message: string, recipients: string[] }
  //   recipients = [] significa broadcast para todos na sala
  //   recipients = ["alice", "bob"] envia apenas para esses + remetente
  socket.on("send_message", ({ roomName, message, recipients }) => {
    const username = socketToUser[socket.id];
    if (!username) {
      return socket.emit("error", { message: "Não autenticado." });
    }
    if (!rooms[roomName]) {
      return socket.emit("error", { message: "Sala não existe." });
    }

    const timestamp = new Date().toISOString();
    const isDirect = Array.isArray(recipients) && recipients.length > 0;

    const payload = {
      from: username,
      message,
      recipients: isDirect ? recipients : [],
      timestamp,
      isDirect,
    };

    if (!isDirect) {
      // Broadcast para toda a sala
      io.to(roomName).emit("new_message", payload);
      console.log(`[MSG BROADCAST] ${username} → sala "${roomName}": ${message}`);
    } else {
      // Mensagem direta: envia para remetente + destinatários selecionados
      const targetUsernames = [username, ...recipients];
      const uniqueTargets = [...new Set(targetUsernames)];

      uniqueTargets.forEach((targetUsername) => {
        const targetUser = users[targetUsername];
        if (targetUser && targetUser.socketId) {
          const targetSocket = io.sockets.sockets.get(targetUser.socketId);
          if (targetSocket) {
            targetSocket.emit("new_message", payload);
          }
        }
      });
      console.log(
        `[MSG DIRETO] ${username} → [${recipients.join(", ")}] na sala "${roomName}": ${message}`
      );
    }
  });

  // ── DESCONEXÃO ────────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    const username = socketToUser[socket.id];
    if (username) {
      // Remove de todas as salas
      Object.keys(rooms).forEach((roomName) => {
        if (rooms[roomName].has(username)) {
          rooms[roomName].delete(username);
          io.to(roomName).emit("user_left", { username, roomName });
          io.to(roomName).emit("room_users_updated", {
            roomName,
            users: getRoomUsers(roomName),
          });
        }
      });
      if (users[username]) users[username].socketId = null;
      delete socketToUser[socket.id];
      console.log(`[-] ${username} desconectado`);
      io.emit("room_list", { rooms: getRoomList() });
    } else {
      console.log(`[-] Socket desconectado: ${socket.id}`);
    }
  });
});

// ─── INICIAR SERVIDOR ─────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Servidor de chat rodando em http://localhost:${PORT}\n`);
  console.log("Protocolo de eventos padronizados:");
  console.log("  Cliente → Servidor: register, login, get_rooms, create_room, join_room, leave_room, send_message");
  console.log("  Servidor → Cliente: register_response, login_response, room_list, room_joined,");
  console.log("                      room_users_updated, user_joined, user_left, new_message, error\n");
});