// ─── ESTADO GLOBAL ────────────────────────────────────────────────────────────
let socket = null;
let currentUser = null;
let currentRoom = null;
let selectedRecipients = new Set();

// ─── UTILITÁRIOS ──────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function setStatus(el, msg, type) {
  el.textContent = msg;
  el.className = "status-msg " + (type || "");
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// ─── CONEXÃO COM O SERVIDOR ───────────────────────────────────────────────────
function connectSocket(serverUrl) {
  return new Promise((resolve, reject) => {
    // Carrega o script do socket.io dinamicamente a partir do servidor escolhido
    const oldScript = document.getElementById("socket-script");
    if (oldScript) oldScript.remove();

    const script = document.createElement("script");
    script.id = "socket-script";
    script.src = `${serverUrl}/socket.io/socket.io.js`;
    script.onload = () => {
      socket = io(serverUrl);
      socket.on("connect", () => resolve());
      socket.on("connect_error", (err) => reject(err));
      setupSocketEvents();
    };
    script.onerror = () => reject(new Error("Servidor não encontrado"));
    document.body.appendChild(script);
  });
}

// ─── EVENTOS RECEBIDOS DO SERVIDOR ───────────────────────────────────────────
function setupSocketEvents() {
  // ── Registro ──────────────────────────────────────────────────────────────
  socket.on("register_response", ({ success, message }) => {
    const el = document.getElementById("auth-status");
    setStatus(el, message, success ? "success" : "error");
    if (success) {
      setTimeout(() => {
        document.querySelector('[data-tab="login"]').click();
        setStatus(el, "", "");
      }, 1500);
    }
  });

  // ── Login ──────────────────────────────────────────────────────────────────
  socket.on("login_response", ({ success, message, username }) => {
    const el = document.getElementById("auth-status");
    if (success) {
      currentUser = username;
      document.getElementById("dash-username").textContent = "👤 " + username;
      showScreen("screen-dashboard");
    } else {
      setStatus(el, message, "error");
    }
  });

  // ── Lista de salas ─────────────────────────────────────────────────────────
  socket.on("room_list", ({ rooms }) => {
    renderRoomList(rooms);
  });

  // ── Entrou na sala ─────────────────────────────────────────────────────────
  socket.on("room_joined", ({ roomName, users }) => {
    currentRoom = roomName;
    document.getElementById("current-room-name").textContent = "# " + roomName;
    selectedRecipients.clear();
    showScreen("screen-chat");
    renderUserList(users);
    clearMessages();
    addSystemMessage(`Você entrou em #${roomName}`);
  });

  // ── Alguém entrou ──────────────────────────────────────────────────────────
  socket.on("user_joined", ({ username }) => {
    addSystemMessage(`${username} entrou na sala`);
  });

  // ── Alguém saiu ───────────────────────────────────────────────────────────
  socket.on("user_left", ({ username }) => {
    addSystemMessage(`${username} saiu da sala`);
  });

  // ── Lista de usuários atualizada ───────────────────────────────────────────
  socket.on("room_users_updated", ({ users }) => {
    renderUserList(users);
  });

  // ── Nova mensagem ──────────────────────────────────────────────────────────
  socket.on("new_message", ({ from, message, recipients, timestamp, isDirect }) => {
    addMessage({ from, message, recipients, timestamp, isDirect });
  });

  // ── Erro ───────────────────────────────────────────────────────────────────
  socket.on("error", ({ message }) => {
    addSystemMessage("⚠️ Erro: " + message);
  });

  // ── Desconexão ────────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    addSystemMessage("Conexão perdida com o servidor.");
  });
}

// ─── RENDERIZAÇÃO ─────────────────────────────────────────────────────────────

function renderRoomList(rooms) {
  const container = document.getElementById("rooms-list");
  if (!rooms || rooms.length === 0) {
    container.innerHTML = '<p class="empty-state">Nenhuma sala criada ainda.</p>';
    return;
  }
  container.innerHTML = rooms
    .map(
      ({ name, userCount }) => `
    <div class="room-card">
      <div>
        <div class="room-name"># ${name}</div>
        <div class="room-meta">${userCount} usuário(s)</div>
      </div>
      <button class="btn-primary" onclick="joinRoom('${name}')">Entrar</button>
    </div>`
    )
    .join("");
}

function renderUserList(users) {
  // Lista da sidebar
  const usersEl = document.getElementById("users-list");
  usersEl.innerHTML = users
    .map(
      (u) =>
        `<div class="user-item ${u === currentUser ? "me" : ""}">
          <span class="dot"></span>${u}${u === currentUser ? " (você)" : ""}
        </div>`
    )
    .join("");

  // Lista de seleção de destinatários (exclui o próprio usuário)
  const selEl = document.getElementById("selected-users-list");
  const others = users.filter((u) => u !== currentUser);

  if (others.length === 0) {
    selEl.innerHTML = '<span style="font-size:0.75rem;color:var(--text-muted)">Só você na sala</span>';
  } else {
    selEl.innerHTML = others
      .map(
        (u) => `
      <div class="selectable-user ${selectedRecipients.has(u) ? "selected" : ""}"
           onclick="toggleRecipient('${u}', this)">
        <span class="checkbox">${selectedRecipients.has(u) ? "☑" : "☐"}</span>
        ${u}
      </div>`
      )
      .join("");
  }
}

function clearMessages() {
  document.getElementById("messages").innerHTML = "";
}

function addSystemMessage(text) {
  const el = document.createElement("div");
  el.className = "msg system";
  el.textContent = text;
  const container = document.getElementById("messages");
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

function addMessage({ from, message, recipients, timestamp, isDirect }) {
  const isMe = from === currentUser;
  const container = document.getElementById("messages");

  let badgeText = "";
  if (isDirect) {
    badgeText = isMe
      ? `🔒 privado → ${recipients.join(", ")}`
      : `🔒 mensagem privada`;
  }

  const el = document.createElement("div");
  el.className = [
    "msg",
    isMe ? "outgoing" : "incoming",
    isDirect ? (isMe ? "direct-out" : "direct-in") : "",
  ]
    .filter(Boolean)
    .join(" ");

  el.innerHTML = `
    <div class="msg-header">
      <span class="msg-sender">${isMe ? "Você" : from}</span>
      <span class="msg-time">${formatTime(timestamp)}</span>
      ${badgeText ? `<span class="msg-badge">${badgeText}</span>` : ""}
    </div>
    <div class="msg-body">${escapeHtml(message)}</div>`;

  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── AÇÕES ────────────────────────────────────────────────────────────────────

function joinRoom(roomName) {
  if (!socket) return;
  socket.emit("join_room", { roomName });
}

function toggleRecipient(username, el) {
  if (selectedRecipients.has(username)) {
    selectedRecipients.delete(username);
    el.classList.remove("selected");
    el.querySelector(".checkbox").textContent = "☐";
  } else {
    selectedRecipients.add(username);
    el.classList.add("selected");
    el.querySelector(".checkbox").textContent = "☑";
  }
}

// ─── LISTENERS DE UI ──────────────────────────────────────────────────────────

// Tabs de auth
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((tc) => tc.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
    document.getElementById("auth-status").className = "status-msg";
    document.getElementById("auth-status").textContent = "";
  });
});

// Botão registrar
document.getElementById("btn-register").addEventListener("click", async () => {
  const username = document.getElementById("reg-username").value.trim();
  const password = document.getElementById("reg-password").value.trim();
  const statusEl = document.getElementById("auth-status");

  if (!username || !password) {
    return setStatus(statusEl, "Preencha todos os campos.", "error");
  }

  const serverUrl = document.getElementById("server-url").value.trim();
  if (!socket) {
    try {
      setStatus(statusEl, "Conectando ao servidor...", "");
      await connectSocket(serverUrl);
    } catch (e) {
      return setStatus(statusEl, "Não foi possível conectar: " + e.message, "error");
    }
  }
  socket.emit("register", { username, password });
});

// Botão login
document.getElementById("btn-login").addEventListener("click", async () => {
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value.trim();
  const statusEl = document.getElementById("auth-status");

  if (!username || !password) {
    return setStatus(statusEl, "Preencha todos os campos.", "error");
  }

  const serverUrl = document.getElementById("server-url").value.trim();
  if (!socket) {
    try {
      setStatus(statusEl, "Conectando ao servidor...", "");
      await connectSocket(serverUrl);
    } catch (e) {
      return setStatus(statusEl, "Não foi possível conectar: " + e.message, "error");
    }
  }
  socket.emit("login", { username, password });
});

// Criar sala
document.getElementById("btn-create-room").addEventListener("click", () => {
  const name = document.getElementById("new-room-name").value.trim();
  if (!name || !socket) return;
  socket.emit("create_room", { roomName: name });
  document.getElementById("new-room-name").value = "";
});
document.getElementById("new-room-name").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("btn-create-room").click();
});

// Logout
document.getElementById("btn-logout").addEventListener("click", () => {
  if (socket) { socket.disconnect(); socket = null; }
  currentUser = null;
  currentRoom = null;
  selectedRecipients.clear();
  showScreen("screen-auth");
});

// Modo de envio (todos / selecionados)
document.querySelectorAll('input[name="send-mode"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    const sel = document.getElementById("selected-users-list");
    if (radio.value === "selected") {
      sel.classList.remove("hidden");
      selectedRecipients.clear();
    } else {
      sel.classList.add("hidden");
      selectedRecipients.clear();
    }
  });
});

// Enviar mensagem
function sendMessage() {
  const input = document.getElementById("msg-input");
  const message = input.value.trim();
  if (!message || !socket || !currentRoom) return;

  const mode = document.querySelector('input[name="send-mode"]:checked').value;
  const recipients = mode === "selected" ? Array.from(selectedRecipients) : [];

  if (mode === "selected" && recipients.length === 0) {
    addSystemMessage("⚠️ Selecione ao menos um destinatário.");
    return;
  }

  socket.emit("send_message", { roomName: currentRoom, message, recipients });
  input.value = "";
}

document.getElementById("btn-send").addEventListener("click", sendMessage);
document.getElementById("msg-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});

// Sair da sala
document.getElementById("btn-leave-room").addEventListener("click", () => {
  if (socket && currentRoom) {
    socket.emit("leave_room", { roomName: currentRoom });
  }
  currentRoom = null;
  selectedRecipients.clear();
  showScreen("screen-dashboard");
  socket.emit("get_rooms");
});