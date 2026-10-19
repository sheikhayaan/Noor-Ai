const API_BASE_URL = "http://127.0.0.1:8000";
const BG_VIDEO =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260511_131941_d136af49-e243-493a-be14-6ff3f24e09e6.mp4";

const landingView = document.querySelector("#landingView");
const chatView = document.querySelector("#chatView");
const form = document.querySelector("#chatForm");
const input = document.querySelector("#messageInput");
const composerRevealButton = document.querySelector("#composerRevealButton");
const messages = document.querySelector("#messages");
const modelMenuButton = document.querySelector("#modelMenuButton");
const modelMenu = document.querySelector("#modelMenu");
const activeGemName = document.querySelector("#activeGemName");
const activeGemCategory = document.querySelector("#activeGemCategory");
const conversationList = document.querySelector("#conversationList");
const providerStatus = document.querySelector("#providerStatus");
const sendButton = document.querySelector("#sendButton");
const newChatButton = document.querySelector("#newChatButton");
const historyButton = document.querySelector("#historyButton");
const searchButton = document.querySelector("#searchButton");
const accountButton = document.querySelector("#accountButton");
const signupButton = document.querySelector("#signupButton");
const googleButton = document.querySelector("#googleButton");
const googleButtonDesktop = document.querySelector("#googleButtonDesktop");
const menuButton = document.querySelector("#menuButton");
const mobileOverlay = document.querySelector("#mobileOverlay");
const mobileDrawer = document.querySelector("#mobileDrawer");
const desktopTryButton = document.querySelector("#desktopTryButton");
const mobileTryButton = document.querySelector("#mobileTryButton");
const heroTryButton = document.querySelector("#heroTryButton");
const heroDemoButton = document.querySelector("#heroDemoButton");
const backHomeButton = document.querySelector("#backHomeButton");
const projectsButton = document.querySelector("#projectsButton");
const gemsButton = document.querySelector("#gemsButton");
const moreButton = document.querySelector("#moreButton");
const projectsPanel = document.querySelector("#projectsPanel");
const gemsPanel = document.querySelector("#gemsPanel");
const gemsExplorer = document.querySelector("#gemsExplorer");
const gemsExplorerList = document.querySelector("#gemsExplorerList");
const gemSearchInput = document.querySelector("#gemSearchInput");
const closeGemsButton = document.querySelector("#closeGemsButton");
const sidebarToggleButton = document.querySelector("#sidebarToggleButton");
const bgVideo = document.querySelector("#bgVideo");
const bgCanvas = document.querySelector("#bgCanvas");
const landingPhysics = document.querySelector("#landingPhysics");
const chatPhysics = document.querySelector("#chatPhysics");

let conversationId = null;
let activeGemId = "general";
let gems = {};
let isSignedIn = false;
let currentUser = null;
let googleInitialized = false;

function setLandingMenuOpen(isOpen) {
  menuButton.classList.toggle("open", isOpen);
  menuButton.setAttribute("aria-expanded", String(isOpen));
  menuButton.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
  mobileDrawer.classList.toggle("open", isOpen);
  mobileDrawer.setAttribute("aria-hidden", String(!isOpen));
  mobileOverlay.hidden = false;
  requestAnimationFrame(() => mobileOverlay.classList.toggle("open", isOpen));
  document.body.style.overflow = isOpen ? "hidden" : "";

  if (!isOpen) {
    window.setTimeout(() => {
      if (!mobileOverlay.classList.contains("open")) mobileOverlay.hidden = true;
    }, 280);
  }
}

function openChatWorkspace() {
  landingView.hidden = true;
  chatView.hidden = false;
  document.body.classList.add("chat-open");
  document.body.style.overflow = "";
  setLandingMenuOpen(false);
  window.dispatchEvent(new Event("resize"));
  window.setTimeout(() => input.focus(), 80);
}

function openLanding() {
  chatView.hidden = true;
  chatView.classList.remove("sidebar-open");
  sidebarToggleButton.classList.remove("open");
  landingView.hidden = false;
  document.body.classList.remove("chat-open");
}

function setSidebarOpen(isOpen) {
  chatView.classList.toggle("sidebar-open", isOpen);
  sidebarToggleButton.classList.toggle("open", isOpen);
}

function clearMessages() {
  closeGemsExplorer();
  messages.innerHTML = `
    <div class="empty-state">
      <strong>Start a Noor conversation.</strong>
      <span>Select a Gem from the left, then ask Noor anything.</span>
    </div>
  `;
}

function addMessage(role, content, extraClass = "") {
  messages.querySelector(".empty-state")?.remove();

  const item = document.createElement("div");
  item.className = `message ${role} ${extraClass}`.trim();
  item.textContent = content;
  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
  return item;
}

function setActiveGem(gemId) {
  activeGemId = gemId;
  const gem = gems[gemId];

  if (!gem) return;

  activeGemName.textContent = gem.name;
  activeGemCategory.textContent = gem.category;
  renderModelMenu();
  renderGemsExplorer();
}

function renderModelMenu() {
  modelMenu.innerHTML = "";

  Object.entries(gems).forEach(([gemId, gem]) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = `model-option ${gemId === activeGemId ? "active" : ""}`;
    option.innerHTML = `<strong>${gem.name}</strong><small>${gem.category} - ${gem.description}</small>`;
    option.addEventListener("click", () => {
      setActiveGem(gemId);
      modelMenu.hidden = false;
      modelMenuButton.setAttribute("aria-expanded", "true");
      openChatWorkspace();
    });
    modelMenu.appendChild(option);
  });
}

function renderGemsExplorer(filterText = "") {
  if (!gemsExplorerList) return;
  const query = filterText.trim().toLowerCase();
  gemsExplorerList.innerHTML = "";

  Object.entries(gems)
    .filter(([, gem]) => {
      const haystack = `${gem.name} ${gem.category} ${gem.description}`.toLowerCase();
      return !query || haystack.includes(query);
    })
    .forEach(([gemId, gem]) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = `gem-explorer-card ${gemId === activeGemId ? "active" : ""}`;
      option.innerHTML = `<small>${gem.category}</small><strong>${gem.name}</strong><span>${gem.description}</span>`;
      option.addEventListener("click", () => {
        setActiveGem(gemId);
        closeGemsExplorer();
        openChatWorkspace();
        input.focus();
      });
      gemsExplorerList.appendChild(option);
    });
}

function renderFallbackGems() {
  gems = {
    general: {
      name: "General Noor",
      category: "assistant",
      description: "Balanced help for thinking, writing, and planning.",
    },
    tutor: {
      name: "Tutor Gem",
      category: "learning",
      description: "Explains concepts with examples and practice.",
    },
    coder: {
      name: "Code Gem",
      category: "engineering",
      description: "Helps debug, build, and reason through code.",
    },
    research: {
      name: "Research Gem",
      category: "analysis",
      description: "Structures questions, sources, and summaries.",
    },
  };
  setActiveGem("general");
}

function renderSignedOutHistory() {
  conversationList.innerHTML = `<div class="empty-history">Sign in to sync previous chats.</div>`;
}

async function loadGems() {
  try {
    const response = await fetch(`${API_BASE_URL}/gems`);
    const data = await response.json();
    gems = data.gems;
    setActiveGem("general");
    renderGemsExplorer();
  } catch (error) {
    renderFallbackGems();
  }
}

async function loadConversations() {
  if (!isSignedIn) {
    renderSignedOutHistory();
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/conversations?user_id=${currentUser.user_id}`);
    const data = await response.json();
    conversationList.innerHTML = "";

    data.conversations.forEach((conversation) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `conversation-item ${conversation.conversation_id === conversationId ? "active" : ""}`;
      item.textContent = conversation.title;
      item.title = conversation.title;
      item.addEventListener("click", () => loadConversation(conversation.conversation_id));
      conversationList.appendChild(item);
    });

    if (!data.conversations.length) {
      conversationList.innerHTML = `<div class="empty-history">No chats in this Google account yet.</div>`;
    }
  } catch (error) {
    conversationList.innerHTML = `<div class="empty-history">Start backend to sync chats.</div>`;
  }
}

async function loadConversation(nextConversationId) {
  if (!currentUser) return;

  const response = await fetch(
    `${API_BASE_URL}/conversations/${nextConversationId}/messages?user_id=${currentUser.user_id}`,
  );
  const data = await response.json();

  conversationId = nextConversationId;
  messages.innerHTML = "";
  data.messages.forEach((message) => {
    addMessage(message.role === "user" ? "user" : "assistant", message.content);
  });
  openChatWorkspace();
  loadConversations();
}

function renderAccount() {
  if (!currentUser) {
    document.body.classList.add("signed-out");
    document.body.classList.remove("signed-in");
    accountButton.innerHTML = `<span class="icon-text">G</span><span>Sign in</span>`;
    return;
  }

  document.body.classList.add("signed-in");
  document.body.classList.remove("signed-out");
  accountButton.innerHTML = `<span class="icon-text">G</span><span>Noor Account</span>`;
}

async function loginWithGoogleCredential(credential) {
  const response = await fetch(`${API_BASE_URL}/auth/google`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ credential }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.detail?.error || "Google login failed");
  }

  currentUser = data;
  isSignedIn = true;
  renderAccount();
  loadConversations();
}

function getGoogleClientId(showErrors = true) {
  const clientId = window.NOOR_CONFIG?.GOOGLE_CLIENT_ID;

  if (!clientId || clientId === "your_google_web_client_id_here") {
    if (showErrors) {
      openChatWorkspace();
      addMessage("assistant", "Add your Google Web Client ID in frontend/config.js first.", "error");
    }
    return null;
  }

  if (!window.google?.accounts?.id) {
    if (showErrors) {
      openChatWorkspace();
      addMessage("assistant", "Google Identity Services did not load. Check your internet connection.", "error");
    }
    return null;
  }

  return clientId;
}

function initializeGoogleLogin() {
  const clientId = getGoogleClientId(false);
  if (!clientId || googleInitialized) return Boolean(clientId);

  window.google.accounts.id.initialize({
    client_id: clientId,
    callback: (response) => loginWithGoogleCredential(response.credential),
  });

  const buttonOptions = {
    theme: "filled_black",
    size: "large",
    type: "standard",
    shape: "pill",
    text: "signin_with",
    width: 260,
  };

  if (googleButton) window.google.accounts.id.renderButton(googleButton, buttonOptions);
  if (googleButtonDesktop) window.google.accounts.id.renderButton(googleButtonDesktop, { ...buttonOptions, width: 190 });
  googleInitialized = true;
  return true;
}

function startGoogleLogin() {
  initializeGoogleLogin();
  const clientId = getGoogleClientId();
  if (!clientId) return;

  window.google.accounts.id.initialize({
    client_id: clientId,
    callback: (response) => loginWithGoogleCredential(response.credential),
  });
  window.google.accounts.id.prompt();
}

function waitForGoogleLogin(attempt = 0) {
  if (initializeGoogleLogin()) return;
  if (attempt >= 40) return;
  window.setTimeout(() => waitForGoogleLogin(attempt + 1), 250);
}

function bootBoomerangVideo() {
  return;
  if (!bgVideo || !bgCanvas) return;

  bgVideo.src = BG_VIDEO;
  bgVideo.loop = false;

  const frames = [];
  let capturing = true;
  let lastTime = -1;
  let captureRaf = 0;
  const maxWidth = 960;

  function captureFrame() {
    if (!capturing || bgVideo.readyState < 2 || bgVideo.currentTime === lastTime) return;
    lastTime = bgVideo.currentTime;

    const vw = bgVideo.videoWidth;
    const vh = bgVideo.videoHeight;
    if (!vw || !vh) return;

    const scale = Math.min(1, maxWidth / vw);
    const width = Math.round(vw * scale);
    const height = Math.round(vh * scale);
    const frame = document.createElement("canvas");
    frame.width = width;
    frame.height = height;

    const context = frame.getContext("2d");
    if (!context) return;
    context.drawImage(bgVideo, 0, 0, width, height);
    frames.push(frame);
  }

  function captureLoop() {
    captureFrame();
    if (capturing) captureRaf = requestAnimationFrame(captureLoop);
  }

  function playFrames() {
    if (!frames.length) {
      bgVideo.loop = true;
      bgVideo.play().catch(() => {});
      return;
    }

    const context = bgCanvas.getContext("2d");
    if (!context) return;

    bgCanvas.width = frames[0].width;
    bgCanvas.height = frames[0].height;
    bgVideo.style.display = "none";
    bgCanvas.style.display = "block";

    let index = 0;
    let direction = 1;
    let last = performance.now();
    const interval = 1000 / 30;

    function render(now) {
      if (now - last >= interval) {
        last = now;
        context.drawImage(frames[index], 0, 0);
        index += direction;
        if (index >= frames.length - 1) {
          index = frames.length - 1;
          direction = -1;
        } else if (index <= 0) {
          index = 0;
          direction = 1;
        }
      }
      requestAnimationFrame(render);
    }

    requestAnimationFrame(render);
  }

  bgVideo.addEventListener("loadedmetadata", () => {
    bgVideo.play().catch(() => {});
    captureRaf = requestAnimationFrame(captureLoop);
  });

  bgVideo.addEventListener("ended", () => {
    capturing = false;
    cancelAnimationFrame(captureRaf);
    playFrames();
  });
}

function bootPhysicsCanvas(canvas, variant) {
  if (!canvas) return;

  const context = canvas.getContext("2d");
  if (!context) return;

  const points = [];
  const pointer = { x: 0, y: 0, active: false };
  const isChat = variant === "chat";
  const palette = isChat
    ? ["rgba(20,70,52,0.72)", "rgba(28,86,130,0.62)", "rgba(88,145,105,0.66)"]
    : ["rgba(18,34,22,0.66)", "rgba(32,86,52,0.6)", "rgba(79,132,86,0.68)"];

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width || window.innerWidth);
    const height = Math.max(1, rect.height || window.innerHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const count = Math.floor(Math.min(130, Math.max(58, (width * height) / (isChat ? 11500 : 9500))));
    points.length = 0;
    for (let index = 0; index < count; index += 1) {
      points.push({
        x: Math.random() * width,
        y: Math.random() * height,
        z: Math.random() * 1 + 0.25,
        vx: (Math.random() - 0.5) * (isChat ? 0.18 : 0.28),
        vy: (Math.random() - 0.5) * (isChat ? 0.18 : 0.28),
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  function draw(now) {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    context.clearRect(0, 0, width, height);

    const gradient = context.createRadialGradient(width * 0.55, height * 0.45, 20, width * 0.55, height * 0.45, width * 0.62);
    gradient.addColorStop(0, isChat ? "rgba(28,86,130,0.2)" : "rgba(31,42,29,0.12)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    for (const point of points) {
      const pulse = Math.sin(now * 0.0012 + point.phase) * 0.45 + 0.55;
      point.x += point.vx * point.z + Math.cos(now * 0.00025 + point.phase) * 0.08;
      point.y += point.vy * point.z + Math.sin(now * 0.00028 + point.phase) * 0.08;

      if (pointer.active) {
        const dx = point.x - pointer.x;
        const dy = point.y - pointer.y;
        const distance = Math.hypot(dx, dy) || 1;
        if (distance < 170) {
          const push = (170 - distance) / 170;
          point.x += (dx / distance) * push * 0.7;
          point.y += (dy / distance) * push * 0.7;
        }
      }

      if (point.x < -20) point.x = width + 20;
      if (point.x > width + 20) point.x = -20;
      if (point.y < -20) point.y = height + 20;
      if (point.y > height + 20) point.y = -20;

      context.beginPath();
      context.fillStyle = palette[Math.floor(point.phase * 10) % palette.length];
      context.arc(point.x, point.y, (isChat ? 2.7 : 2.1) + pulse * point.z * 2.9, 0, Math.PI * 2);
      context.fill();
    }

    const maxDistance = isChat ? 172 : 154;
    for (let a = 0; a < points.length; a += 1) {
      for (let b = a + 1; b < points.length; b += 1) {
        const first = points[a];
        const second = points[b];
        const distance = Math.hypot(first.x - second.x, first.y - second.y);
        if (distance > maxDistance) continue;

        const alpha = (1 - distance / maxDistance) * (isChat ? 0.34 : 0.3);
        context.strokeStyle = isChat ? `rgba(28,86,130,${alpha})` : `rgba(18,34,22,${alpha})`;
        context.lineWidth = isChat ? 1.4 : 1;
        context.beginPath();
        context.moveTo(first.x, first.y);
        context.lineTo(second.x, second.y);
        context.stroke();
      }
    }

    if (isChat) {
      context.save();
      context.translate(width * 0.5, height * 0.52);
      context.rotate(now * 0.00008);
      for (let ring = 0; ring < 6; ring += 1) {
        context.strokeStyle = `rgba(28,86,130,${0.14 - ring * 0.012})`;
        context.lineWidth = 1.25;
        context.beginPath();
        context.ellipse(0, 0, width * (0.18 + ring * 0.045), height * (0.07 + ring * 0.018), ring * 0.28, 0, Math.PI * 2);
        context.stroke();
      }
      context.restore();
    }

    requestAnimationFrame(draw);
  }

  canvas.addEventListener("pointermove", (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = event.clientX - rect.left;
    pointer.y = event.clientY - rect.top;
    pointer.active = true;
  });
  canvas.addEventListener("pointerleave", () => {
    pointer.active = false;
  });

  window.addEventListener("resize", resize);
  resize();
  requestAnimationFrame(draw);
}

function bootThreeCanvas(canvas, variant) {
  if (!canvas || !window.THREE) return false;

  const isChat = variant === "chat";
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  const rig = new THREE.Group();
  const particleRig = new THREE.Group();
  const ringRig = new THREE.Group();
  const pointer = new THREE.Vector2(0, 0);
  let pointerActive = false;

  scene.add(rig);
  rig.add(particleRig);
  rig.add(ringRig);
  camera.position.set(0, 0.7, isChat ? 14 : 12);

  const particleCount = isChat ? 420 : 520;
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  const seeds = new Float32Array(particleCount);
  const palette = isChat
    ? [new THREE.Color(0x56d3ff), new THREE.Color(0x7cffb2), new THREE.Color(0x8b7dff)]
    : [new THREE.Color(0x7cffb2), new THREE.Color(0x56d3ff), new THREE.Color(0xffffff)];

  for (let index = 0; index < particleCount; index += 1) {
    const shell = index % 7;
    const radius = (isChat ? 3.8 : 4.7) + shell * 0.42 + Math.random() * 4.8;
    const angle = Math.random() * Math.PI * 2;
    const height = (Math.random() - 0.5) * (isChat ? 6.5 : 7.8);
    const twist = Math.sin(angle * 3 + shell) * 0.9;
    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = height + twist;
    positions[index * 3 + 2] = Math.sin(angle) * radius;
    seeds[index] = Math.random() * Math.PI * 2;

    const color = palette[index % palette.length];
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }

  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  particleGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const particles = new THREE.Points(
    particleGeometry,
    new THREE.PointsMaterial({
      size: isChat ? 0.055 : 0.045,
      vertexColors: true,
      transparent: true,
      opacity: isChat ? 0.78 : 0.68,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  particleRig.add(particles);

  const lineMaterial = new THREE.LineBasicMaterial({
    color: isChat ? 0x56d3ff : 0x7cffb2,
    transparent: true,
    opacity: isChat ? 0.12 : 0.1,
    blending: THREE.AdditiveBlending,
  });

  for (let index = 0; index < (isChat ? 16 : 20); index += 1) {
    const curve = new THREE.EllipseCurve(
      0,
      0,
      2.7 + index * 0.16,
      5.4 + index * 0.1,
      0,
      Math.PI * 2,
    );
    const points = curve.getPoints(160).map((point) => new THREE.Vector3(point.x, (index - 18) * 0.024, point.y));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMaterial);
    line.rotation.x = Math.PI / 2 + index * 0.012;
    line.rotation.z = index * 0.11;
    ringRig.add(line);
  }

  const torusMaterials = [
    new THREE.MeshBasicMaterial({ color: 0x56d3ff, transparent: true, opacity: isChat ? 0.11 : 0.08 }),
    new THREE.MeshBasicMaterial({ color: 0x7cffb2, transparent: true, opacity: isChat ? 0.09 : 0.07 }),
  ];

  for (let index = 0; index < 4; index += 1) {
    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(3.2 + index * 0.58, 0.01, 8, 96),
      torusMaterials[index % torusMaterials.length],
    );
    torus.rotation.x = Math.PI / 2 + index * 0.08;
    torus.rotation.y = index * 0.12;
    torus.rotation.z = index * 0.34;
    ringRig.add(torus);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width || window.innerWidth);
    const height = Math.max(1, rect.height || window.innerHeight);
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function animate(time) {
    const now = time * 0.001;
    const position = particleGeometry.attributes.position;
    for (let index = 0; index < particleCount; index += 1) {
      const offset = index * 3;
      const seed = seeds[index];
      position.array[offset + 1] += Math.sin(now * 0.8 + seed) * 0.0009;
    }
    position.needsUpdate = true;

    rig.rotation.y = now * (isChat ? 0.055 : 0.075) + pointer.x * 0.12;
    rig.rotation.x = Math.sin(now * 0.28) * 0.09 - pointer.y * 0.08;
    ringRig.rotation.z = now * (isChat ? 0.065 : 0.085);
    particleRig.rotation.y = -now * (isChat ? 0.035 : 0.052);
    rig.position.y = Math.sin(now * 0.6) * 0.18;

    if (!pointerActive) {
      pointer.x *= 0.95;
      pointer.y *= 0.95;
    }

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  canvas.addEventListener("pointermove", (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    pointer.y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    pointerActive = true;
  });

  canvas.addEventListener("pointerleave", () => {
    pointerActive = false;
  });

  window.addEventListener("resize", resize);
  resize();
  requestAnimationFrame(animate);
  return true;
}

function showSidebarPanel(panelName) {
  const showingGems = panelName === "gems";
  gemsPanel.hidden = !showingGems;
  projectsPanel.hidden = showingGems;
  modelMenu.hidden = false;
  modelMenuButton.setAttribute("aria-expanded", "true");
  gemsButton.classList.toggle("active", showingGems);
  projectsButton.classList.toggle("active", !showingGems);
  newChatButton.classList.remove("active");
}

function openGemsExplorer() {
  openChatWorkspace();
  gemsExplorer.hidden = false;
  messages.hidden = true;
  form.hidden = true;
  renderGemsExplorer(gemSearchInput.value || "");
  window.setTimeout(() => gemSearchInput.focus(), 80);
}

function closeGemsExplorer() {
  if (!gemsExplorer) return;
  gemsExplorer.hidden = true;
  messages.hidden = false;
  form.hidden = false;
}

modelMenuButton.addEventListener("click", () => {
  const isHidden = modelMenu.hidden;
  modelMenu.hidden = !isHidden;
  modelMenuButton.setAttribute("aria-expanded", String(isHidden));
});

menuButton.addEventListener("click", () => setLandingMenuOpen(!mobileDrawer.classList.contains("open")));
mobileOverlay.addEventListener("click", () => {
  setLandingMenuOpen(false);
  setSidebarOpen(false);
});
mobileDrawer.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => setLandingMenuOpen(false));
});

[desktopTryButton, mobileTryButton, heroTryButton, heroDemoButton].forEach((button) => {
  button?.addEventListener("click", openChatWorkspace);
});

document.querySelectorAll("[data-landing-gem]").forEach((button) => {
  button.addEventListener("click", () => {
    const gemId = button.dataset.landingGem;
    if (gemId && gems[gemId]) setActiveGem(gemId);
    openChatWorkspace();
    input.focus();
  });
});

document.querySelectorAll("[data-landing-action]").forEach((button) => {
  button.addEventListener("click", () => {
    const action = button.dataset.landingAction;
    if (action === "gems") {
      openGemsExplorer();
      return;
    }

    openChatWorkspace();

    if (action === "projects") {
      showSidebarPanel("projects");
      return;
    }

    if (action === "history") {
      conversationList.classList.remove("collapsed");
      historyButton.classList.add("active");
    }
  });
});

backHomeButton.addEventListener("click", openLanding);
sidebarToggleButton.addEventListener("click", () => setSidebarOpen(!chatView.classList.contains("sidebar-open")));

newChatButton.addEventListener("click", () => {
  conversationId = null;
  closeGemsExplorer();
  clearMessages();
  loadConversations();
  gemsPanel.hidden = true;
  projectsPanel.hidden = true;
  newChatButton.classList.add("active");
  openChatWorkspace();
  input.focus();
});

historyButton.addEventListener("click", () => {
  conversationList.classList.toggle("collapsed");
});

searchButton.addEventListener("click", openGemsExplorer);
projectsButton.addEventListener("click", () => {
  closeGemsExplorer();
  showSidebarPanel("projects");
});
gemsButton.addEventListener("click", openGemsExplorer);
closeGemsButton.addEventListener("click", () => {
  closeGemsExplorer();
  input.focus();
});
gemSearchInput.addEventListener("input", () => renderGemsExplorer(gemSearchInput.value));
document.querySelectorAll(".project-card").forEach((button) => {
  button.addEventListener("click", () => {
    openChatWorkspace();
    showSidebarPanel("projects");
    addMessage("assistant", `Project selected: ${button.querySelector("strong").textContent}. Ask Noor to continue from here.`);
  });
});

moreButton.addEventListener("click", () => {
  openChatWorkspace();
  addMessage("assistant", "More tools are ready for settings, files, and account controls when you want to extend Noor.", "");
});

accountButton.addEventListener("click", startGoogleLogin);
signupButton.addEventListener("click", startGoogleLogin);
composerRevealButton.addEventListener("click", () => {
  form.classList.add("expanded");
  input.focus();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = input.value.trim();
  if (!message) return;

  openChatWorkspace();
  input.value = "";
  sendButton.disabled = true;
  addMessage("user", message);
  const loadingMessage = addMessage("assistant", "Thinking...", "typing");

  try {
    const response = await fetch(`${API_BASE_URL}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        gem_id: activeGemId,
        conversation_id: conversationId,
        user_id: isSignedIn ? currentUser.user_id : "local_user",
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      loadingMessage.classList.remove("typing");
      loadingMessage.classList.add("error");
      loadingMessage.textContent = data.detail?.message || "Something went wrong.";
      return;
    }

    conversationId = data.conversation_id;
    providerStatus.textContent = data.provider || "fake";
    loadingMessage.classList.remove("typing");
    loadingMessage.textContent = data.response;
    loadConversations();
  } catch (error) {
    loadingMessage.classList.remove("typing");
    loadingMessage.classList.add("error");
    loadingMessage.textContent = "Backend connection failed. Start the FastAPI server and try again.";
  } finally {
    sendButton.disabled = false;
    input.focus();
  }
});

Promise.all([loadGems(), loadConversations()]);
bootBoomerangVideo();
if (!bootThreeCanvas(landingPhysics, "landing")) bootPhysicsCanvas(landingPhysics, "landing");
if (!bootThreeCanvas(chatPhysics, "chat")) bootPhysicsCanvas(chatPhysics, "chat");
renderAccount();

window.addEventListener("load", waitForGoogleLogin);
