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
    renderMessageDOM(msg.role, msg.content, false, msg.media);
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

// ==========================================================================
// AI Kinetic Motion Video Generator Engine (Canvas + MediaRecorder Stream)
// ==========================================================================

function createAIVideoMotionStream(videoElement, imageUrl) {
  if (!videoElement || !imageUrl) return;

  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = imageUrl;

  let animFrameId = null;
  let startTime = performance.now();

  // Floating ambient kinetic particles (stardust / embers / sparkles)
  const particles = Array.from({ length: 48 }, () => ({
    x: Math.random() * 1280,
    y: Math.random() * 720,
    radius: Math.random() * 2.5 + 0.8,
    speedX: (Math.random() - 0.5) * 0.7,
    speedY: -Math.random() * 1.2 - 0.2,
    alpha: Math.random() * 0.7 + 0.3,
    pulse: Math.random() * Math.PI
  }));

  img.onload = () => {
    if (!canvas.captureStream) {
      videoElement.poster = imageUrl;
      return;
    }

    try {
      const stream = canvas.captureStream(30);
      videoElement.srcObject = stream;
      videoElement.muted = true;
      videoElement.play().catch(() => {});
    } catch (e) {
      console.warn("captureStream error:", e);
      videoElement.poster = imageUrl;
    }

    function animate(now) {
      const elapsed = (now - startTime) / 1000;
      const loopDuration = 8;
      const progress = (elapsed % loopDuration) / loopDuration;
      const pingPong = Math.sin(progress * Math.PI);

      // Smooth cinematic camera pan and zoom (Ken Burns)
      const scale = 1.0 + pingPong * 0.13;
      const offsetX = Math.sin(progress * Math.PI * 2) * 22;
      const offsetY = Math.cos(progress * Math.PI * 2) * 14;

      ctx.clearRect(0, 0, 1280, 720);

      ctx.save();
      ctx.translate(640 + offsetX, 360 + offsetY);
      ctx.scale(scale, scale);
      ctx.drawImage(img, -640, -360, 1280, 720);
      ctx.restore();

      // Atmospheric lighting sweep
      const sweepX = (progress * 2 - 0.5) * 1280;
      const flareGrad = ctx.createLinearGradient(sweepX - 280, 0, sweepX + 280, 720);
      flareGrad.addColorStop(0, "rgba(255, 255, 255, 0.0)");
      flareGrad.addColorStop(0.5, `rgba(255, 220, 140, ${0.08 + pingPong * 0.06})`);
      flareGrad.addColorStop(1, "rgba(99, 102, 241, 0.04)");
      ctx.fillStyle = flareGrad;
      ctx.fillRect(0, 0, 1280, 720);

      // Render floating divine stardust particles
      particles.forEach(p => {
        p.x += p.speedX;
        p.y += p.speedY;
        p.pulse += 0.04;
        if (p.y < 0) p.y = 720;
        if (p.x < 0) p.x = 1280;
        if (p.x > 1280) p.x = 0;

        const currentAlpha = p.alpha * (0.6 + Math.sin(p.pulse) * 0.4);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 245, 210, ${currentAlpha})`;
        ctx.shadowColor = "rgba(255, 215, 0, 0.9)";
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // Subtle vignette
      const vignette = ctx.createRadialGradient(640, 360, 300, 640, 360, 800);
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(0,0,0,0.4)");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, 1280, 720);

      animFrameId = requestAnimationFrame(animate);
    }

    animFrameId = requestAnimationFrame(animate);

    // Attach downloadable video recorder
    videoElement._getDownloadableBlob = function() {
      return new Promise((resolve) => {
        try {
          const recStream = canvas.captureStream(30);
          const mime = (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported("video/webm;codecs=vp9"))
            ? "video/webm;codecs=vp9"
            : ((typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported("video/webm")) ? "video/webm" : "video/mp4");
          const recorder = new MediaRecorder(recStream, { mimeType: mime });
          const chunks = [];
          recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
          recorder.onstop = () => {
            const blob = new Blob(chunks, { type: mime });
            resolve(blob);
          };
          recorder.start();
          setTimeout(() => recorder.stop(), 4000);
        } catch {
          resolve(null);
        }
      });
    };
  };

  img.onerror = () => {
    videoElement.poster = imageUrl;
  };
}

function renderMessageDOM(role, text, isTyping = false, media = null) {
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

    // If message contains media (image / video), render rich interactive card
    if (media && (media.url || media.posterUrl)) {
      const mediaCard = document.createElement("div");
      mediaCard.className = "chat-media-card";

      if (media.type === "image") {
        mediaCard.innerHTML = `
          <div class="chat-media-header">
            <span class="chat-media-badge" style="background: rgba(99, 102, 241, 0.15); color: var(--accent-indigo); border: 1px solid rgba(99, 102, 241, 0.25);">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>
              <span>DALL·E 3 Photorealism</span>
            </span>
            <span class="chat-media-prompt" title="${escapeHtml(media.prompt || '')}">${escapeHtml(media.prompt || '')}</span>
          </div>
          <div class="chat-media-preview-container">
            <div class="media-loading-placeholder">
              <div class="media-spinner"></div>
              <span>Synthesizing Ultra-Realistic AI Masterpiece...</span>
            </div>
            <img src="${media.url}" alt="${escapeHtml(media.prompt || 'Generated AI image')}" loading="eager" style="opacity: 0; transition: opacity 0.4s ease;" />
          </div>
          <div class="chat-media-actions">
            <button class="chat-media-btn open-lightbox-btn" type="button" title="View Fullscreen">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
              <span>Zoom</span>
            </button>
            <button class="chat-media-btn copy-image-prompt-btn" type="button" title="Copy Prompt">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              <span>Copy Prompt</span>
            </button>
            <button class="chat-media-btn primary download-media-btn" type="button" title="Download Image">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
              <span>Download</span>
            </button>
          </div>
        `;

        const imgEl = mediaCard.querySelector("img");
        const placeholder = mediaCard.querySelector(".media-loading-placeholder");
        const zoomBtn = mediaCard.querySelector(".open-lightbox-btn");
        const copyImgPromptBtn = mediaCard.querySelector(".copy-image-prompt-btn");
        const downloadBtn = mediaCard.querySelector(".download-media-btn");

        imgEl.onload = () => {
          imgEl.style.opacity = "1";
          if (placeholder) placeholder.style.display = "none";
        };

        imgEl.onerror = () => {
          if (placeholder) {
            placeholder.innerHTML = `
              <span style="color:var(--accent-rose);font-size:12px;">Generation taking longer than expected</span>
              <button class="chat-media-btn retry-btn" type="button" style="margin-top:6px;">Retry Loading</button>
            `;
            placeholder.querySelector(".retry-btn")?.addEventListener("click", () => {
              placeholder.innerHTML = `<div class="media-spinner"></div><span>Synthesizing Ultra-Realistic Artwork...</span>`;
              imgEl.src = media.url + "&retry=" + Date.now();
            });
          }
        };

        const openZoom = () => openLightbox(media.url, media.prompt || "Realistic AI Artwork");
        imgEl.addEventListener("click", openZoom);
        zoomBtn.addEventListener("click", openZoom);

        copyImgPromptBtn?.addEventListener("click", () => {
          navigator.clipboard.writeText(media.enhancedPrompt || media.prompt || "").then(() => {
            copyImgPromptBtn.querySelector("span").textContent = "Copied!";
            setTimeout(() => copyImgPromptBtn.querySelector("span").textContent = "Copy Prompt", 1800);
          });
        });

        downloadBtn.addEventListener("click", () => downloadMedia(media.url, `ai-image-${Date.now()}.jpg`));
      } else if (media.type === "video") {
        mediaCard.innerHTML = `
          <div class="chat-media-header">
            <span class="chat-media-badge" style="color:var(--accent-purple);">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
              <span>AI Video (Kinetic Motion)</span>
            </span>
            <span class="chat-media-prompt" title="${escapeHtml(media.prompt || '')}">${escapeHtml(media.prompt || '')}</span>
          </div>
          <div class="chat-media-preview-container">
            <video class="ai-generated-video" controls loop autoplay playsinline muted poster="${media.posterUrl || ''}"></video>
          </div>
          <div class="chat-media-actions">
            <button class="chat-media-btn copy-prompt-btn" type="button" title="Copy Prompt">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              <span>Copy Prompt</span>
            </button>
            <button class="chat-media-btn primary download-media-btn" type="button" title="Download Video">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
              <span>Download Video</span>
            </button>
          </div>
        `;

        const videoEl = mediaCard.querySelector(".ai-generated-video");
        const copyPromptBtn = mediaCard.querySelector(".copy-prompt-btn");
        const downloadBtn = mediaCard.querySelector(".download-media-btn");

        if (media.url && (media.url.endsWith(".mp4") || media.url.endsWith(".webm") || media.url.endsWith(".ogv"))) {
          videoEl.src = media.url;
          videoEl.play().catch(() => {});
        } else if (media.posterUrl) {
          createAIVideoMotionStream(videoEl, media.posterUrl);
        }

        copyPromptBtn.addEventListener("click", () => {
          navigator.clipboard.writeText(media.prompt || "").then(() => {
            copyPromptBtn.querySelector("span").textContent = "Copied!";
            setTimeout(() => copyPromptBtn.querySelector("span").textContent = "Copy Prompt", 1800);
          });
        });

        downloadBtn.addEventListener("click", async () => {
          const orig = downloadBtn.innerHTML;
          downloadBtn.innerHTML = `<span>Exporting video...</span>`;
          if (media.url && (media.url.endsWith(".mp4") || media.url.endsWith(".webm"))) {
            downloadMedia(media.url, `ai-video-${Date.now()}.mp4`);
          } else if (typeof videoEl._getDownloadableBlob === "function") {
            const blob = await videoEl._getDownloadableBlob();
            if (blob) {
              const bUrl = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = bUrl;
              a.download = `ai-video-${Date.now()}.webm`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              setTimeout(() => URL.revokeObjectURL(bUrl), 1000);
            } else {
              downloadMedia(media.posterUrl, `ai-video-frame-${Date.now()}.jpg`);
            }
          } else {
            downloadMedia(media.posterUrl, `ai-video-frame-${Date.now()}.jpg`);
          }
          downloadBtn.innerHTML = orig;
        });
      }

      content.appendChild(mediaCard);
    }
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
    conversation.push({ role: "assistant", content: data.reply, media: data.media });
    renderMessageDOM("assistant", data.reply, false, data.media);
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
        <button class="suggestion-card" data-prompt="/image Cyberpunk cat with neon sunglasses in rainy Tokyo, highly detailed, 8k">
          <div class="card-icon" style="background:rgba(99,102,241,0.15);color:var(--accent-indigo);">🎨</div>
          <div class="card-content">
            <div class="card-title">Generate AI Image</div>
            <div class="card-desc">Cyberpunk cat with neon sunglasses in Tokyo</div>
          </div>
          <span class="card-arrow">→</span>
        </button>
        <button class="suggestion-card" data-prompt="/video Deep space rotating cosmic galaxy with shimmering nebula clouds">
          <div class="card-icon" style="background:rgba(192,132,252,0.15);color:var(--accent-purple);">🎬</div>
          <div class="card-content">
            <div class="card-title">Generate AI Video</div>
            <div class="card-desc">Deep space rotating cosmic galaxy nebula</div>
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

// Download Media Helper
async function downloadMedia(url, defaultName = "gemini-ai-creation.png") {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = defaultName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch {
    window.open(url, "_blank");
  }
}

// Lightbox Modal Controls
const imageLightboxModal = document.querySelector("#image-lightbox-modal");
const lightboxImg = document.querySelector("#lightbox-img");
const lightboxCaption = document.querySelector("#lightbox-caption");
const lightboxDownloadBtn = document.querySelector("#lightbox-download-btn");
const closeLightboxBtn = document.querySelector("#close-lightbox-btn");

function openLightbox(imageUrl, caption) {
  if (!imageLightboxModal) return;
  lightboxImg.src = imageUrl;
  lightboxCaption.textContent = caption || "";
  imageLightboxModal.style.display = "flex";
  lightboxDownloadBtn.onclick = () => downloadMedia(imageUrl, `ai-artwork-${Date.now()}.jpg`);
}

function closeLightbox() {
  if (imageLightboxModal) imageLightboxModal.style.display = "none";
}

closeLightboxBtn?.addEventListener("click", closeLightbox);
imageLightboxModal?.addEventListener("click", (e) => {
  if (e.target === imageLightboxModal) closeLightbox();
});

// ==========================================================================
// AI Media Studio Modal Controls
// ==========================================================================

const mediaStudioModal = document.querySelector("#media-studio-modal");
const openStudioBtn = document.querySelector("#open-studio-btn");
const closeStudioBtn = document.querySelector("#close-studio-btn");
const quickImageBtn = document.querySelector("#quick-image-btn");
const quickVideoBtn = document.querySelector("#quick-video-btn");

function openStudio(tabName = "image-tab") {
  if (!mediaStudioModal) return;
  mediaStudioModal.style.display = "flex";
  switchStudioTab(tabName);
  if (window.innerWidth < 820) sidebar?.classList.add("collapsed");
}

function closeStudio() {
  if (mediaStudioModal) mediaStudioModal.style.display = "none";
}

openStudioBtn?.addEventListener("click", () => openStudio("image-tab"));
quickImageBtn?.addEventListener("click", () => openStudio("image-tab"));
quickVideoBtn?.addEventListener("click", () => openStudio("video-tab"));
closeStudioBtn?.addEventListener("click", closeStudio);
mediaStudioModal?.addEventListener("click", (e) => {
  if (e.target === mediaStudioModal) closeStudio();
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeStudio();
    closeLightbox();
  }
});

// Tab Switcher
function switchStudioTab(tabId) {
  document.querySelectorAll(".studio-tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });
  document.querySelectorAll(".studio-tab-panel").forEach(panel => {
    panel.classList.toggle("active", panel.id === tabId);
  });
}

document.querySelectorAll(".studio-tab-btn").forEach(btn => {
  btn.addEventListener("click", () => switchStudioTab(btn.dataset.tab));
});

// Option Pills Selection Helper
function setupOptionGroup(groupId) {
  const group = document.querySelector(`#${groupId}`);
  if (!group) return;
  group.addEventListener("click", (e) => {
    const pill = e.target.closest(".option-pill");
    if (!pill) return;
    group.querySelectorAll(".option-pill").forEach(p => p.classList.remove("active"));
    pill.classList.add("active");
  });
}

setupOptionGroup("image-style-group");
setupOptionGroup("image-aspect-group");
setupOptionGroup("video-motion-group");
setupOptionGroup("video-aspect-group");

// Inspiration Chips Fill
document.querySelectorAll(".chip-btn").forEach(chip => {
  chip.addEventListener("click", () => {
    const text = chip.dataset.fill;
    const parentPanel = chip.closest(".studio-tab-panel");
    const textarea = parentPanel?.querySelector(".studio-textarea");
    if (textarea) {
      textarea.value = text;
      textarea.focus();
    }
  });
});

// Generate Image Logic
const generateImageBtn = document.querySelector("#generate-image-btn");
const imagePromptInput = document.querySelector("#image-prompt-input");
const imageResultBox = document.querySelector("#image-result-box");
const imageResultPreview = document.querySelector("#image-result-preview");
const downloadImageBtn = document.querySelector("#download-image-btn");
const sendImageChatBtn = document.querySelector("#send-image-chat-btn");
let lastGeneratedImage = null;

generateImageBtn?.addEventListener("click", async () => {
  const prompt = imagePromptInput.value.trim();
  if (!prompt) {
    imagePromptInput.focus();
    return;
  }

  const selectedStyle = document.querySelector("#image-style-group .option-pill.active")?.dataset.val || "cinematic";
  const selectedAspect = document.querySelector("#image-aspect-group .option-pill.active")?.dataset.val || "1:1";

  generateImageBtn.disabled = true;
  generateImageBtn.innerHTML = `<span>✨ Synthesizing DALL·E 3 Vision...</span>`;

  try {
    const res = await fetch("/api/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, style: selectedStyle, aspectRatio: selectedAspect })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Image creation failed");

    lastGeneratedImage = data;
    imageResultPreview.src = data.imageUrl;
    imageResultBox.style.display = "block";
    imageResultPreview.onclick = () => openLightbox(data.imageUrl, prompt);

    const promptDetails = document.querySelector("#image-prompt-details");
    if (promptDetails && data.enhancedPrompt) {
      promptDetails.innerHTML = `<strong>✨ DALL·E 3 Enriched Vision:</strong> ${escapeHtml(data.enhancedPrompt)}`;
      promptDetails.style.display = "block";
    }
  } catch (err) {
    alert("Image generation error: " + err.message);
  } finally {
    generateImageBtn.disabled = false;
    generateImageBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>
      <span>Generate Image</span>`;
  }
});

downloadImageBtn?.addEventListener("click", () => {
  if (lastGeneratedImage?.imageUrl) {
    downloadMedia(lastGeneratedImage.imageUrl, `ai-art-${Date.now()}.jpg`);
  }
});

sendImageChatBtn?.addEventListener("click", () => {
  if (!lastGeneratedImage?.imageUrl) return;
  closeStudio();
  const replyText = `🎨 **AI Artwork created in Studio:** *"${lastGeneratedImage.prompt}"*`;
  const mediaObj = {
    type: "image",
    url: lastGeneratedImage.imageUrl,
    prompt: lastGeneratedImage.prompt,
    enhancedPrompt: lastGeneratedImage.enhancedPrompt
  };
  conversation.push({ role: "assistant", content: replyText, media: mediaObj });
  renderMessageDOM("assistant", replyText, false, mediaObj);
  saveCurrentSession();
});

// Generate Video Logic
const generateVideoBtn = document.querySelector("#generate-video-btn");
const videoPromptInput = document.querySelector("#video-prompt-input");
const videoResultBox = document.querySelector("#video-result-box");
const videoResultPlayer = document.querySelector("#video-result-player");
const downloadVideoBtn = document.querySelector("#download-video-btn");
const sendVideoChatBtn = document.querySelector("#send-video-chat-btn");
let lastGeneratedVideo = null;

generateVideoBtn?.addEventListener("click", async () => {
  const prompt = videoPromptInput.value.trim();
  if (!prompt) {
    videoPromptInput.focus();
    return;
  }

  const selectedMotion = document.querySelector("#video-motion-group .option-pill.active")?.dataset.val || "cinematic";
  const selectedAspect = document.querySelector("#video-aspect-group .option-pill.active")?.dataset.val || "16:9";

  generateVideoBtn.disabled = true;
  generateVideoBtn.innerHTML = `<span>Rendering AI Video Clip...</span>`;

  try {
    const res = await fetch("/api/generate-video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, motion: selectedMotion, aspectRatio: selectedAspect })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Video generation failed");

    lastGeneratedVideo = data;
    videoResultBox.style.display = "block";

    if (data.videoUrl && (data.videoUrl.endsWith(".mp4") || data.videoUrl.endsWith(".webm") || data.videoUrl.endsWith(".ogv"))) {
      videoResultPlayer.srcObject = null;
      videoResultPlayer.src = data.videoUrl;
      videoResultPlayer.play().catch(() => {});
    } else if (data.posterUrl) {
      createAIVideoMotionStream(videoResultPlayer, data.posterUrl);
    }
  } catch (err) {
    alert("Video generation error: " + err.message);
  } finally {
    generateVideoBtn.disabled = false;
    generateVideoBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
      <span>Generate Video</span>`;
  }
});

downloadVideoBtn?.addEventListener("click", async () => {
  if (!lastGeneratedVideo) return;
  const orig = downloadVideoBtn.innerHTML;
  downloadVideoBtn.innerHTML = `<span>Exporting video...</span>`;

  if (lastGeneratedVideo.videoUrl && (lastGeneratedVideo.videoUrl.endsWith(".mp4") || lastGeneratedVideo.videoUrl.endsWith(".webm"))) {
    downloadMedia(lastGeneratedVideo.videoUrl, `ai-video-${Date.now()}.mp4`);
  } else if (typeof videoResultPlayer._getDownloadableBlob === "function") {
    const blob = await videoResultPlayer._getDownloadableBlob();
    if (blob) {
      const bUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = bUrl;
      a.download = `ai-video-${Date.now()}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(bUrl), 1000);
    } else {
      downloadMedia(lastGeneratedVideo.posterUrl, `ai-video-frame-${Date.now()}.jpg`);
    }
  } else {
    downloadMedia(lastGeneratedVideo.posterUrl, `ai-video-frame-${Date.now()}.jpg`);
  }
  downloadVideoBtn.innerHTML = orig;
});

sendVideoChatBtn?.addEventListener("click", () => {
  if (!lastGeneratedVideo) return;
  closeStudio();
  const replyText = `🎬 **AI Video created in Studio:** *"${lastGeneratedVideo.prompt}"*`;
  const mediaObj = {
    type: "video",
    url: lastGeneratedVideo.videoUrl,
    posterUrl: lastGeneratedVideo.posterUrl,
    prompt: lastGeneratedVideo.prompt,
    enhancedPrompt: lastGeneratedVideo.enhancedPrompt
  };
  conversation.push({ role: "assistant", content: replyText, media: mediaObj });
  renderMessageDOM("assistant", replyText, false, mediaObj);
  saveCurrentSession();
});

// Initialize App
initTheme();
renderChatHistory();
messageInput.focus();
