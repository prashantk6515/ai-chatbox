/**
 * Gemini AI Studio · 2026 Modern Client Logic
 */

// DOM Elements
const chatForm = document.querySelector("#chat-form");
const messageInput = document.querySelector("#message-input");
const messagesContainer = document.querySelector("#messages-container");
const welcomeScreen = document.querySelector("#welcome-screen");
const sendButton = document.querySelector("#send-button");
const newChatBtn = document.querySelector("#new-chat-btn");
const clearChatBtn = document.querySelector("#clear-chat-btn");
const toggleSidebarBtn = document.querySelector("#toggle-sidebar-btn");
const closeSidebarBtn = document.querySelector("#close-sidebar-btn");
const sidebar = document.querySelector("#sidebar");
const themeToggleBtn = document.querySelector("#theme-toggle-btn");
const themeIconDark = document.querySelector("#theme-icon-dark");
const themeIconLight = document.querySelector("#theme-icon-light");
const liveClockText = document.querySelector("#live-clock-text");
const charCounter = document.querySelector("#char-counter");
const micBtn = document.querySelector("#mic-btn");
const scrollBottomBtn = document.querySelector("#scroll-bottom-btn");
const chatHistoryList = document.querySelector("#chat-history-list");
const pinCurrentBtn = document.querySelector("#pin-current-btn");

// State Management
let currentChatId = Date.now().toString();
let conversation = [];
let chatSessions = JSON.parse(localStorage.getItem("gemini_chat_sessions") || "[]");
let isWaitingForReply = false;
let speechRecognizer = null;
let isRecording = false;

// Initialize Marked Options
if (window.marked) {
  marked.setOptions({
    breaks: true,
    gfm: true
  });
}

// ==========================================================================
// Theme Management
// ==========================================================================

function initTheme() {
  const savedTheme = localStorage.getItem("gemini_theme") || "dark";
  document.documentElement.setAttribute("data-theme", savedTheme);
  updateThemeIcon(savedTheme);
}

function updateThemeIcon(theme) {
  if (theme === "dark") {
    themeIconDark.style.display = "block";
    themeIconLight.style.display = "none";
  } else {
    themeIconDark.style.display = "none";
    themeIconLight.style.display = "block";
  }
}

themeToggleBtn.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const target = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", target);
  localStorage.setItem("gemini_theme", target);
  updateThemeIcon(target);
});

// ==========================================================================
// Live Clock
// ==========================================================================

function updateLiveClock() {
  const now = new Date();
  liveClockText.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
setInterval(updateLiveClock, 1000);
updateLiveClock();

// ==========================================================================
// Sidebar & Mobile Navigation
// ==========================================================================

toggleSidebarBtn.addEventListener("click", () => {
  sidebar.classList.toggle("collapsed");
});

closeSidebarBtn?.addEventListener("click", () => {
  sidebar.classList.add("collapsed");
});

// Auto-collapse sidebar on small mobile screens
if (window.innerWidth < 820) {
  sidebar.classList.add("collapsed");
}

// ==========================================================================
// Chat Sessions & History (with Pinning Support)
// ==========================================================================

function sortAndSaveSessions() {
  chatSessions.sort((a, b) => {
    const aPin = !!a.isPinned;
    const bPin = !!b.isPinned;
    if (aPin !== bPin) {
      return aPin ? -1 : 1;
    }
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });

  // Preserve all pinned sessions, keep top 30 unpinned sessions
  const pinned = chatSessions.filter(s => s.isPinned);
  const unpinned = chatSessions.filter(s => !s.isPinned).slice(0, 30);
  chatSessions = [...pinned, ...unpinned];

  localStorage.setItem("gemini_chat_sessions", JSON.stringify(chatSessions));
}

function saveCurrentSession() {
  if (conversation.length === 0) return;
  const firstUserMsg = conversation.find(m => m.role === "user")?.content || "New Chat";
  const title = firstUserMsg.slice(0, 32);

  const existingIndex = chatSessions.findIndex(s => s.id === currentChatId);
  const existingSession = existingIndex >= 0 ? chatSessions[existingIndex] : null;

  const sessionData = {
    id: currentChatId,
    title,
    messages: conversation,
    updatedAt: Date.now(),
    isPinned: existingSession ? !!existingSession.isPinned : false
  };

  if (existingIndex >= 0) {
    chatSessions[existingIndex] = sessionData;
  } else {
    chatSessions.unshift(sessionData);
  }

  sortAndSaveSessions();
  renderChatHistory();
  updateTopBarPinState();
}

function togglePinSession(sessionId) {
  const session = chatSessions.find(s => s.id === sessionId);
  if (!session) return;
  session.isPinned = !session.isPinned;
  session.updatedAt = Date.now();
  sortAndSaveSessions();
  renderChatHistory();
  updateTopBarPinState();
}

function updateTopBarPinState() {
  if (!pinCurrentBtn) return;
  const currentSession = chatSessions.find(s => s.id === currentChatId);
  const isPinned = !!currentSession?.isPinned;
  if (isPinned) {
    pinCurrentBtn.classList.add("active");
    pinCurrentBtn.title = "Unpin Current Chat";
    pinCurrentBtn.setAttribute("aria-label", "Unpin Current Chat");
  } else {
    pinCurrentBtn.classList.remove("active");
    pinCurrentBtn.title = "Pin Current Chat";
    pinCurrentBtn.setAttribute("aria-label", "Pin Current Chat");
  }
}

function renderChatHistory() {
  if (!chatHistoryList) return;
  chatHistoryList.innerHTML = "";
  if (chatSessions.length === 0) {
    chatHistoryList.innerHTML = `<div style="font-size:12px;color:var(--text-muted);padding:10px 8px;">No previous chats</div>`;
    updateTopBarPinState();
    return;
  }

  const pinnedSessions = chatSessions.filter(s => s.isPinned);
  const regularSessions = chatSessions.filter(s => !s.isPinned);

  const createHistoryItem = (session) => {
    const item = document.createElement("div");
    item.className = `history-item ${session.id === currentChatId ? 'active' : ''} ${session.isPinned ? 'pinned' : ''}`;
    item.setAttribute("data-session-id", session.id);

    item.innerHTML = `
      <div class="history-item-left">
        ${session.isPinned ? `
          <span class="pinned-badge-icon" title="Pinned chat">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>
          </span>
        ` : ''}
        <span class="history-title" title="${escapeHtml(session.title)}">${escapeHtml(session.title)}</span>
      </div>
      <div class="history-actions">
        <button class="history-pin-btn ${session.isPinned ? 'is-pinned' : ''}" type="button" title="${session.isPinned ? 'Unpin chat' : 'Pin chat'}" aria-label="${session.isPinned ? 'Unpin chat' : 'Pin chat'}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>
        </button>
        <button class="history-delete-btn" type="button" title="Delete chat" aria-label="Delete chat">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
    `;

    item.addEventListener("click", (e) => {
      const pinBtn = e.target.closest(".history-pin-btn");
      if (pinBtn) {
        e.stopPropagation();
        togglePinSession(session.id);
        return;
      }
      const deleteBtn = e.target.closest(".history-delete-btn");
      if (deleteBtn) {
        e.stopPropagation();
        deleteSession(session.id);
        return;
      }
      loadSession(session.id);
    });

    return item;
  };

  if (pinnedSessions.length > 0) {
    const pinnedHeader = document.createElement("div");
    pinnedHeader.className = "history-subgroup-title";
    pinnedHeader.innerHTML = `<span>📌 Pinned</span><span class="history-count-badge">${pinnedSessions.length}</span>`;
    chatHistoryList.appendChild(pinnedHeader);

    pinnedSessions.forEach(session => {
      chatHistoryList.appendChild(createHistoryItem(session));
    });

    if (regularSessions.length > 0) {
      const recentHeader = document.createElement("div");
      recentHeader.className = "history-subgroup-title recent-title";
      recentHeader.innerHTML = `<span>Recent</span><span class="history-count-badge">${regularSessions.length}</span>`;
      chatHistoryList.appendChild(recentHeader);
    }
  }

  regularSessions.forEach(session => {
    chatHistoryList.appendChild(createHistoryItem(session));
  });

  updateTopBarPinState();
}

function loadSession(sessionId) {
  const session = chatSessions.find(s => s.id === sessionId);
  if (!session) return;
  currentChatId = session.id;
  conversation = session.messages || [];

  messagesContainer.innerHTML = "";
  if (welcomeScreen) welcomeScreen.style.display = "none";

  conversation.forEach(msg => {
    renderMessageDOM(msg.role, msg.content);
  });

  renderChatHistory();
  updateTopBarPinState();
  if (window.innerWidth < 820) sidebar.classList.add("collapsed");
}

function deleteSession(sessionId) {
  chatSessions = chatSessions.filter(s => s.id !== sessionId);
  localStorage.setItem("gemini_chat_sessions", JSON.stringify(chatSessions));
  if (currentChatId === sessionId) {
    resetChat();
  } else {
    renderChatHistory();
    updateTopBarPinState();
  }
}

// ==========================================================================
// Message Rendering (Markdown + Actions)
// ==========================================================================

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatContent(text) {
  if (window.marked) {
    try {
      const rawHtml = marked.parse(text);
      return enhanceCodeBlocks(rawHtml);
    } catch {
      return `<p>${escapeHtml(text)}</p>`;
    }
  }
  return `<p>${escapeHtml(text)}</p>`;
}

function enhanceCodeBlocks(html) {
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = html;

  tempDiv.querySelectorAll("pre code").forEach(codeEl => {
    const preEl = codeEl.parentElement;
    const langClass = Array.from(codeEl.classList).find(c => c.startsWith("language-"));
    const lang = langClass ? langClass.replace("language-", "") : "code";

    const wrapper = document.createElement("div");
    wrapper.className = "code-block-wrapper";
    wrapper.innerHTML = `
      <div class="code-block-header">
        <span>${lang}</span>
        <button class="copy-code-btn" type="button">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <span>Copy</span>
        </button>
      </div>
    `;

    preEl.parentNode.insertBefore(wrapper, preEl);
    wrapper.appendChild(preEl);

    const copyBtn = wrapper.querySelector(".copy-code-btn");
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(codeEl.textContent).then(() => {
        const textSpan = copyBtn.querySelector("span");
        textSpan.textContent = "Copied!";
        copyBtn.style.color = "var(--accent-emerald)";
        setTimeout(() => {
          textSpan.textContent = "Copy";
          copyBtn.style.color = "";
        }, 2000);
      });
    });
  });

  return tempDiv.innerHTML;
}

function renderMessageDOM(role, text, isTyping = false) {
  if (welcomeScreen) welcomeScreen.style.display = "none";

  const row = document.createElement("div");
  row.className = `message-row ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.innerHTML = role === "user"
    ? `<span>You</span>`
    : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z" fill="currentColor"/></svg>`;

  const body = document.createElement("div");
  body.className = "message-body";

  const content = document.createElement("div");
  content.className = "message-content";

  if (isTyping) {
    content.innerHTML = `
      <div class="typing-indicator">
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
      </div>`;
  } else if (role === "user") {
    content.textContent = text;
  } else {
    content.innerHTML = formatContent(text);
  }

  body.appendChild(content);

  // Add Action buttons (Copy, Read Aloud) for assistant messages
  if (role === "assistant" && !isTyping) {
    const actions = document.createElement("div");
    actions.className = "message-actions";
    actions.innerHTML = `
      <button class="action-pill-btn copy-msg-btn" type="button" title="Copy reply">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        <span>Copy</span>
      </button>
      <button class="action-pill-btn speak-msg-btn" type="button" title="Read Aloud">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
        <span>Speak</span>
      </button>
    `;

    // Copy Message
    const copyBtn = actions.querySelector(".copy-msg-btn");
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.querySelector("span").textContent = "Copied!";
        setTimeout(() => copyBtn.querySelector("span").textContent = "Copy", 1800);
      });
    });

    // Speak Message (Text-to-Speech)
    const speakBtn = actions.querySelector(".speak-msg-btn");
    speakBtn.addEventListener("click", () => {
      if ('speechSynthesis' in window) {
        if (window.speechSynthesis.speaking) {
          window.speechSynthesis.cancel();
          speakBtn.querySelector("span").textContent = "Speak";
          return;
        }
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.onend = () => speakBtn.querySelector("span").textContent = "Speak";
        speakBtn.querySelector("span").textContent = "Stop";
        window.speechSynthesis.speak(utterance);
      }
    });

    body.appendChild(actions);
  }

  row.append(avatar, body);
  messagesContainer.appendChild(row);
  scrollToBottom();
  return row;
}

function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Scroll-to-bottom toggle
messagesContainer.addEventListener("scroll", () => {
  const isNearBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < 120;
  scrollBottomBtn.style.display = isNearBottom ? "none" : "grid";
});

scrollBottomBtn.addEventListener("click", scrollToBottom);

// ==========================================================================
// Send Message
// ==========================================================================

async function sendMessage(text) {
  const trimmedText = text.trim();
  if (!trimmedText || isWaitingForReply) return;

  isWaitingForReply = true;
  sendButton.disabled = true;
  messageInput.disabled = true;

  conversation.push({ role: "user", content: trimmedText });
  renderMessageDOM("user", trimmedText);

  messageInput.value = "";
  messageInput.style.height = "auto";
  updateCharCounter();

  const typingRow = renderMessageDOM("assistant", "", true);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: conversation,
        clientTime: new Date().toLocaleString(undefined, {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "numeric",
          minute: "numeric",
          second: "numeric",
          timeZoneName: "short"
        }),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "The model request failed.");

    typingRow.remove();
    conversation.push({ role: "assistant", content: data.reply });
    renderMessageDOM("assistant", data.reply);
    saveCurrentSession();
  } catch (error) {
    typingRow.remove();
    renderMessageDOM("assistant", `⚠️ **Error:** ${error.message}`);
    conversation.pop(); // remove unanswered message
  } finally {
    isWaitingForReply = false;
    sendButton.disabled = false;
    messageInput.disabled = false;
    messageInput.focus();
  }
}

// ==========================================================================
// Input Handlers & Voice Input
// ==========================================================================

function updateCharCounter() {
  const len = messageInput.value.length;
  charCounter.textContent = `${len} chars`;
}

messageInput.addEventListener("input", () => {
  messageInput.style.height = "auto";
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 200)}px`;
  updateCharCounter();
});

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(messageInput.value);
});

// Suggestions click handler
document.querySelectorAll(".suggestion-card").forEach(button => {
  button.addEventListener("click", () => {
    const prompt = button.dataset.prompt || button.textContent;
    sendMessage(prompt);
  });
});

// Voice Input (Web Speech API)
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  speechRecognizer = new SpeechRec();
  speechRecognizer.continuous = false;
  speechRecognizer.interimResults = false;

  speechRecognizer.onstart = () => {
    isRecording = true;
    micBtn.classList.add("recording");
  };

  speechRecognizer.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    messageInput.value = (messageInput.value ? messageInput.value + " " : "") + transcript;
    messageInput.focus();
    updateCharCounter();
  };

  speechRecognizer.onend = () => {
    isRecording = false;
    micBtn.classList.remove("recording");
  };

  micBtn.addEventListener("click", () => {
    if (isRecording) {
      speechRecognizer.stop();
    } else {
      speechRecognizer.start();
    }
  });
} else {
  micBtn.style.display = "none";
}

// ==========================================================================
// Reset / New Chat
// ==========================================================================

function resetChat() {
  if (isWaitingForReply) return;
  currentChatId = Date.now().toString();
  conversation = [];

  messagesContainer.innerHTML = `
    <div id="welcome-screen" class="welcome-screen">
      <div class="welcome-hero-sparkle">
        <div class="sparkle-glow"></div>
        <div class="sparkle-avatar">
          <svg width="38" height="38" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z" fill="url(#hero-sparkle)" />
            <defs>
              <linearGradient id="hero-sparkle" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                <stop stop-color="#38bdf8"/>
                <stop offset="0.5" stop-color="#818cf8"/>
                <stop offset="1" stop-color="#c084fc"/>
              </linearGradient>
            </defs>
          </svg>
        </div>
      </div>
      <h1 class="welcome-title">Where knowledge meets intelligence.</h1>
      <p class="welcome-subtitle">Ask anything, analyze code, or query live weather &amp; real-time information with automated high-demand fallback.</p>
      <div class="suggestion-grid">
        <button class="suggestion-card" data-prompt="What is the weather in Bihar right now?">
          <div class="card-icon weather">🌦️</div>
          <div class="card-content">
            <div class="card-title">Live Weather</div>
            <div class="card-desc">What is the weather in Bihar right now?</div>
          </div>
          <span class="card-arrow">→</span>
        </button>
        <button class="suggestion-card" data-prompt="What is today's exact date and day of the week?">
          <div class="card-icon clock">🕒</div>
          <div class="card-content">
            <div class="card-title">Real-Time Clock</div>
            <div class="card-desc">What is today's exact date and day?</div>
          </div>
          <span class="card-arrow">→</span>
        </button>
        <button class="suggestion-card" data-prompt="Write a modern JavaScript debounce and throttle implementation with TypeScript types.">
          <div class="card-icon code">💻</div>
          <div class="card-content">
            <div class="card-title">Clean Code</div>
            <div class="card-desc">Write a JS debounce &amp; throttle utility</div>
          </div>
          <span class="card-arrow">→</span>
        </button>
        <button class="suggestion-card" data-prompt="Explain quantum computing principles simply with a real-world analogy.">
          <div class="card-icon idea">💡</div>
          <div class="card-content">
            <div class="card-title">Concept Deep-Dive</div>
            <div class="card-desc">Explain quantum computing simply</div>
          </div>
          <span class="card-arrow">→</span>
        </button>
      </div>
    </div>`;

  document.querySelectorAll(".suggestion-card").forEach(button => {
    button.addEventListener("click", () => {
      const prompt = button.dataset.prompt || button.textContent;
      sendMessage(prompt);
    });
  });

  messageInput.value = "";
  messageInput.style.height = "auto";
  updateCharCounter();
  renderChatHistory();
  updateTopBarPinState();
  messageInput.focus();
}

newChatBtn.addEventListener("click", resetChat);
clearChatBtn.addEventListener("click", resetChat);

if (pinCurrentBtn) {
  pinCurrentBtn.addEventListener("click", () => {
    let session = chatSessions.find(s => s.id === currentChatId);
    if (!session) {
      if (conversation.length === 0) return;
      saveCurrentSession();
      session = chatSessions.find(s => s.id === currentChatId);
    }
    if (session) {
      togglePinSession(session.id);
    }
  });
}

// Initialize App
initTheme();
renderChatHistory();
messageInput.focus();
