import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import * as THREE from "three";
import { Canvas, extend, useFrame, useThree } from "@react-three/fiber";
import type { ThreeElement } from "@react-three/fiber";
import { Environment, Effects, Float } from "@react-three/drei";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { AnimatePresence, motion } from "framer-motion";
import {
  Aperture,
  Box,
  CloudLightning,
  Compass,
  FolderKanban,
  History,
  Home,
  LoaderCircle,
  Menu,
  Mic,
  Paperclip,
  Plus,
  Search,
  Send,
  Settings,
  Sparkles,
  User,
  X,
} from "lucide-react";

extend({ UnrealBloomPass });

declare module "@react-three/fiber" {
  interface ThreeElements {
    unrealBloomPass: ThreeElement<typeof UnrealBloomPass>;
  }
}

const API_BASE_URL = "http://127.0.0.1:8000";

type Gem = {
  name: string;
  category: string;
  description: string;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type Conversation = {
  conversation_id: string;
  title: string;
};

type UserAccount = {
  user_id: string;
  name?: string;
  email?: string;
};

type NoorMotionRef = React.MutableRefObject<{
  x: number;
  y: number;
  scroll: number;
  charged: boolean;
  transition: boolean;
}>;

declare global {
  interface Window {
    NOOR_CONFIG?: { GOOGLE_CLIENT_ID?: string };
    google?: {
      accounts?: {
        id?: {
          initialize: (options: { client_id: string; callback: (response: { credential: string }) => void }) => void;
          prompt: () => void;
        };
      };
    };
  }
}

const fallbackGems: Record<string, Gem> = {
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

const paths = ["Architectural Design", "Quantum Analytics", "Creative Synthesis"];
const projects = ["Learning plan", "Build sprint"];

export default function App() {
  const [view, setView] = useState<"landing" | "chat">("landing");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [loadingPromptPreview, setLoadingPromptPreview] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [gems, setGems] = useState<Record<string, Gem>>(fallbackGems);
  const [activeGemId, setActiveGemId] = useState("general");
  const [panel, setPanel] = useState<"chat" | "gems" | "projects">("chat");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [provider, setProvider] = useState("fake");
  const [gemSearch, setGemSearch] = useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const activeGem = gems[activeGemId] || fallbackGems.general;
  const signedIn = Boolean(currentUser);

  const filteredGems = useMemo(() => {
    const q = gemSearch.trim().toLowerCase();
    return Object.entries(gems).filter(([, gem]) => {
      const body = `${gem.name} ${gem.category} ${gem.description}`.toLowerCase();
      return !q || body.includes(q);
    });
  }, [gemSearch, gems]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping, panel]);

  useEffect(() => {
    async function loadGems() {
      try {
        const response = await fetch(`${API_BASE_URL}/gems`);
        const data = await response.json();
        setGems(data.gems || fallbackGems);
      } catch {
        setGems(fallbackGems);
      }
    }
    loadGems();
  }, []);

  useEffect(() => {
    loadConversations();
  }, [currentUser]);

  async function loadConversations() {
    if (!currentUser) {
      setConversations([]);
      return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/conversations?user_id=${currentUser.user_id}`);
      const data = await response.json();
      setConversations(data.conversations || []);
    } catch {
      setConversations([]);
    }
  }

  async function loadConversation(nextConversationId: string) {
    if (!currentUser) return;
    const response = await fetch(
      `${API_BASE_URL}/conversations/${nextConversationId}/messages?user_id=${currentUser.user_id}`,
    );
    const data = await response.json();
    setConversationId(nextConversationId);
    setMessages(
      (data.messages || []).map((msg: { role: string; content: string }, index: number) => ({
        id: `${nextConversationId}-${index}`,
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.content,
      })),
    );
    setPanel("chat");
    setView("chat");
  }

  function startChat(nextPanel: "chat" | "gems" | "projects" = "chat") {
    setView("chat");
    setPanel(nextPanel);
  }

  function selectGem(gemId: string) {
    setActiveGemId(gemId);
    setPanel("chat");
    setView("chat");
  }

  function newChat() {
    setConversationId(null);
    setMessages([]);
    setPanel("chat");
    setView("chat");
  }

  async function loginWithGoogleCredential(credential: string) {
    const response = await fetch(`${API_BASE_URL}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail?.error || "Google login failed");
    setCurrentUser(data);
  }

  function startGoogleLogin() {
    const clientId = window.NOOR_CONFIG?.GOOGLE_CLIENT_ID;
    if (!clientId || clientId === "your_google_web_client_id_here") {
      setView("chat");
      setMessages((items) => [
        ...items,
        {
          id: `google-${Date.now()}`,
          role: "assistant",
          content: "Add your Google Web Client ID in frontend/config.js first.",
        },
      ]);
      return;
    }

    if (!window.google?.accounts?.id) {
      setView("chat");
      setMessages((items) => [
        ...items,
        {
          id: `google-load-${Date.now()}`,
          role: "assistant",
          content: "Google Identity Services did not load. Check your internet connection.",
        },
      ]);
      return;
    }

    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: (response) => loginWithGoogleCredential(response.credential),
    });
    window.google.accounts.id.prompt();
  }

  async function handleSend(event?: FormEvent) {
    event?.preventDefault();
    const message = inputText.trim();
    if (!message || isTyping) return;

    setInputText("");
    setLoadingPromptPreview(message);
    setPanel("chat");
    setView("chat");
    setMessages((items) => [...items, { id: `user-${Date.now()}`, role: "user", content: message }]);
    setIsTyping(true);

    try {
      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          gem_id: activeGemId,
          conversation_id: conversationId,
          user_id: currentUser ? currentUser.user_id : "local_user",
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        setMessages((items) => [
          ...items,
          { id: `error-${Date.now()}`, role: "assistant", content: data.detail?.message || "Something went wrong." },
        ]);
        return;
      }

      setConversationId(data.conversation_id);
      setProvider(data.provider || "fake");
      setMessages((items) => [
        ...items,
        { id: `assistant-${Date.now()}`, role: "assistant", content: data.response || "" },
      ]);
      loadConversations();
    } catch {
      setMessages((items) => [
        ...items,
        {
          id: `backend-${Date.now()}`,
          role: "assistant",
          content: "Backend connection failed. Start the FastAPI server and try again.",
        },
      ]);
    } finally {
      setIsTyping(false);
      setLoadingPromptPreview("");
    }
  }

  return (
    <div className="app-shell">
      <AnimatePresence mode="wait">
        {view === "landing" ? (
          <Landing
            key="landing"
            startChat={startChat}
            selectGem={selectGem}
            startGoogleLogin={startGoogleLogin}
          />
        ) : (
          <NoorImmersiveChat
            key="chat"
            activeGem={activeGem}
            activeGemId={activeGemId}
            conversations={conversations}
            currentUser={currentUser}
            filteredGems={filteredGems}
            gemSearch={gemSearch}
            inputText={inputText}
            isTyping={isTyping}
            loadingPromptPreview={loadingPromptPreview}
            messages={messages}
            panel={panel}
            projects={projects}
            provider={provider}
            setGemSearch={setGemSearch}
            setInputText={setInputText}
            setPanel={setPanel}
            setSidebarOpen={setSidebarOpen}
            sidebarOpen={sidebarOpen}
            startGoogleLogin={startGoogleLogin}
            newChat={newChat}
            selectGem={selectGem}
            loadConversation={loadConversation}
            handleSend={handleSend}
            messagesEndRef={messagesEndRef}
            goHome={() => setView("landing")}
            signedIn={signedIn}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function Landing({
  startChat,
  selectGem: _selectGem,
  startGoogleLogin: _startGoogleLogin,
}: {
  startChat: (panel?: "chat" | "gems" | "projects") => void;
  selectGem: (gemId: string) => void;
  startGoogleLogin: () => void;
}) {
  const [coreCharged, setCoreCharged] = useState(false);
  const [transitionActive, setTransitionActive] = useState(false);
  const landingRef = useRef<HTMLElement | null>(null);
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const motionRef = useRef({
    x: 0,
    y: 0,
    scroll: 0,
    charged: false,
    transition: false,
  });
  const pointerStyle = {
    "--mx": "0px",
    "--my": "0px",
    "--rx": "0deg",
    "--ry": "0deg",
    "--tx": "0px",
    "--ty": "0px",
    "--journey": 0,
  } as CSSProperties;

  useEffect(() => {
    motionRef.current.charged = coreCharged || transitionActive;
    motionRef.current.transition = transitionActive;
  }, [coreCharged, transitionActive]);

  useEffect(() => {
    const root = landingRef.current;
    if (!root) return;

    let raf = 0;
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    let scrollTarget = 0;
    let scrollCurrent = 0;

    function applyMotion() {
      currentX += (targetX - currentX) * 0.16;
      currentY += (targetY - currentY) * 0.16;
      scrollCurrent += (scrollTarget - scrollCurrent) * 0.1;
      motionRef.current.x = currentX;
      motionRef.current.y = currentY;
      motionRef.current.scroll = scrollCurrent;

      root.style.setProperty("--mx", `${currentX}px`);
      root.style.setProperty("--my", `${currentY}px`);
      root.style.setProperty("--rx", `${currentY * -7}deg`);
      root.style.setProperty("--ry", `${currentX * 9}deg`);
      root.style.setProperty("--tx", `${currentX * 26}px`);
      root.style.setProperty("--ty", `${currentY * 18}px`);
      root.style.setProperty("--journey", `${scrollCurrent}`);

      if (cursorRef.current) {
        const x = (currentX + 0.5) * window.innerWidth;
        const y = (currentY + 0.5) * window.innerHeight;
        cursorRef.current.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      }

      raf = requestAnimationFrame(applyMotion);
    }

    function onPointerMove(event: PointerEvent) {
      const rect = root.getBoundingClientRect();
      targetX = (event.clientX - rect.left) / rect.width - 0.5;
      targetY = (event.clientY - rect.top) / rect.height - 0.5;
      root.classList.add("has-pointer");
    }

    function syncScroll() {
      const maxScroll = Math.max(root.scrollHeight - root.clientHeight, 1);
      scrollTarget = Math.min(1, Math.max(0, root.scrollTop / maxScroll));
    }

    function onPointerLeave() {
      root.classList.remove("has-pointer");
    }

    root.addEventListener("pointermove", onPointerMove, { passive: true });
    root.addEventListener("pointerleave", onPointerLeave, { passive: true });
    root.addEventListener("scroll", syncScroll, { passive: true });
    raf = requestAnimationFrame(applyMotion);

    return () => {
      cancelAnimationFrame(raf);
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerleave", onPointerLeave);
      root.removeEventListener("scroll", syncScroll);
    };
  }, []);

  useEffect(() => {
    const root = landingRef.current;
    if (!root) return;

    let scrollTrigger: { kill: () => void } | null = null;
    let mounted = true;

    Promise.all([import("gsap"), import("gsap/ScrollTrigger")]).then(([{ gsap }, { ScrollTrigger }]) => {
      if (!mounted) return;
      gsap.registerPlugin(ScrollTrigger);
      scrollTrigger = ScrollTrigger.create({
        trigger: root,
        scroller: root,
        start: "top top",
        end: "bottom bottom",
        scrub: 0.9,
        onUpdate: (self) => {
          root.style.setProperty("--gsap-journey", String(self.progress));
        },
      });
      ScrollTrigger.refresh();
    }).catch(() => undefined);

    return () => {
      mounted = false;
      scrollTrigger?.kill();
    };
  }, []);

  return (
    <motion.main
      ref={landingRef}
      className="premium-landing noor-video-landing noor-story-landing noor-2030"
      style={pointerStyle}
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.01 }}
      transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
    >
      <NoorUniverseCanvas motionRef={motionRef} charged={coreCharged} transitionActive={transitionActive} />
      <Noor2030World
        charged={coreCharged}
        setCharged={setCoreCharged}
        setTransitionActive={setTransitionActive}
        startChat={startChat}
      />
      <div className="noor-cursor" ref={cursorRef} aria-hidden="true" />
    </motion.main>
  );
}

function NoorUniverseCanvas({
  motionRef,
  charged,
  transitionActive,
}: {
  motionRef: NoorMotionRef;
  charged: boolean;
  transitionActive: boolean;
}) {
  const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;

  return (
    <div className="noor-r3f-universe" aria-hidden="true">
      <Canvas
        dpr={isMobile ? [1, 1.25] : [1, 1.6]}
        frameloop="always"
        camera={{ position: [0, 0.2, 10.5], fov: 50, near: 0.1, far: 90 }}
        gl={{ antialias: false, alpha: true, powerPreference: "high-performance", stencil: false, depth: true }}
        onCreated={({ gl }) => {
          gl.setClearColor("#020308", 0);
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
      >
        <color attach="background" args={["#020308"]} />
        <fog attach="fog" args={["#020308", 10, 46]} />
        <Environment preset="night" resolution={128} />
        <NoorCameraRig motionRef={motionRef} />
        <ambientLight intensity={0.18} />
        <pointLight position={[0, 1.6, 4]} intensity={charged ? 11 : 6.5} color="#55ffe6" distance={18} decay={2} />
        <pointLight position={[-6, -2, -5]} intensity={2.2} color="#fff1b8" distance={24} decay={2} />
        <NoorQuantumParticles motionRef={motionRef} count={isMobile ? 5600 : 11000} />
        <NoorNeuralLattice motionRef={motionRef} />
        <NoorCore3D charged={charged} transitionActive={transitionActive} motionRef={motionRef} />
        <NoorDepthCivilization motionRef={motionRef} />
        {!isMobile && (
          <Effects multisamping={0} disableGamma>
            <unrealBloomPass args={[new THREE.Vector2(1024, 1024), 0.62, 0.42, 0.22]} />
          </Effects>
        )}
      </Canvas>
    </div>
  );
}

function NoorCameraRig({ motionRef }: { motionRef: NoorMotionRef }) {
  const { camera } = useThree();

  useFrame((_, delta) => {
    const motion = motionRef.current;
    const targetX = motion.x * 2.4;
    const targetY = 0.24 + motion.y * -1.45 + motion.scroll * -2.2;
    const targetZ = 10.5 - motion.scroll * 4.8 - (motion.transition ? 4.4 : 0);
    camera.position.x = THREE.MathUtils.damp(camera.position.x, targetX, 3.2, delta);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, targetY, 3.2, delta);
    camera.position.z = THREE.MathUtils.damp(camera.position.z, targetZ, 2.4, delta);
    camera.lookAt(motion.x * 1.2, motion.y * -0.65, -2.4 - motion.scroll * 4.5);
  });

  return null;
}

function NoorQuantumParticles({ motionRef, count }: { motionRef: NoorMotionRef; count: number }) {
  const pointsRef = useRef<THREE.Points | null>(null);

  const geometry = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const layers = new Float32Array(count);

    for (let index = 0; index < count; index += 1) {
      const radius = 4 + Math.random() * 26;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(THREE.MathUtils.randFloatSpread(2));
      const layer = Math.random();
      positions[index * 3] = Math.sin(phi) * Math.cos(theta) * radius;
      positions[index * 3 + 1] = Math.sin(phi) * Math.sin(theta) * radius * 0.62 + THREE.MathUtils.randFloatSpread(8);
      positions[index * 3 + 2] = Math.cos(phi) * radius - 18 * layer;
      seeds[index] = Math.random();
      layers[index] = layer;
    }

    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    buffer.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    buffer.setAttribute("aLayer", new THREE.BufferAttribute(layers, 1));
    buffer.computeBoundingSphere();
    return buffer;
  }, [count]);

  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2() },
      uScroll: { value: 0 },
      uCharged: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.6) },
    },
    vertexShader: `
      attribute float aSeed;
      attribute float aLayer;
      uniform float uTime;
      uniform float uScroll;
      uniform float uCharged;
      uniform float uPixelRatio;
      uniform vec2 uMouse;
      varying float vSeed;
      varying float vLayer;

      void main() {
        vSeed = aSeed;
        vLayer = aLayer;
        vec3 p = position;
        float t = uTime * (0.16 + aSeed * 0.42);
        float orbit = t + aSeed * 6.2831 + uScroll * 4.2;
        float magnetic = 1.0 + uCharged * 0.36;
        p.x += sin(orbit + p.z * 0.035) * (0.75 + aLayer * 2.2) * magnetic + uMouse.x * (0.6 + aLayer);
        p.y += cos(orbit * 1.2 + p.x * 0.03) * (0.45 + aSeed) + uMouse.y * (0.35 + aLayer * 0.8);
        p.z += mod(uTime * (1.2 + aLayer * 5.0) + aSeed * 42.0, 46.0) - 23.0;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = uPixelRatio * (2.0 + aSeed * 3.8 + uCharged * 1.6) * (7.0 / -mvPosition.z);
      }
    `,
    fragmentShader: `
      varying float vSeed;
      varying float vLayer;
      void main() {
        vec2 uv = gl_PointCoord - vec2(0.5);
        float d = length(uv);
        float glow = smoothstep(0.5, 0.0, d);
        float core = smoothstep(0.18, 0.0, d);
        vec3 cyan = vec3(0.24, 1.0, 0.88);
        vec3 gold = vec3(1.0, 0.86, 0.46);
        vec3 color = mix(cyan, gold, smoothstep(0.72, 1.0, vSeed));
        float alpha = (glow * 0.52 + core * 0.56) * (0.35 + vLayer * 0.65);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }), []);

  useFrame((_, delta) => {
    const motion = motionRef.current;
    material.uniforms.uTime.value += delta;
    material.uniforms.uMouse.value.set(motion.x, -motion.y);
    material.uniforms.uScroll.value = motion.scroll;
    material.uniforms.uCharged.value = THREE.MathUtils.damp(material.uniforms.uCharged.value, motion.charged ? 1 : 0, 4, delta);
    if (pointsRef.current) {
      pointsRef.current.rotation.y += delta * 0.018;
      pointsRef.current.rotation.x = THREE.MathUtils.damp(pointsRef.current.rotation.x, motion.y * 0.18, 3, delta);
    }
  });

  return <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />;
}

function NoorCore3D({
  charged,
  transitionActive,
  motionRef,
}: {
  charged: boolean;
  transitionActive: boolean;
  motionRef: NoorMotionRef;
}) {
  const groupRef = useRef<THREE.Group | null>(null);
  const coreMaterial = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCharged: { value: 0 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vPosition;
      uniform float uTime;
      uniform float uCharged;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vPosition = position;
        vec3 p = position + normal * (sin(position.y * 9.0 + uTime * 1.7) * 0.045 + uCharged * 0.035);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      varying vec3 vPosition;
      uniform float uTime;
      uniform float uCharged;
      float noise(vec3 p) {
        return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453);
      }
      void main() {
        float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.4);
        float bands = sin((vPosition.y + vPosition.x * 0.35) * 10.0 + uTime * 2.6) * 0.5 + 0.5;
        float n = noise(vPosition * 2.0 + uTime * 0.15);
        vec3 color = mix(vec3(0.04, 0.42, 0.5), vec3(0.85, 1.0, 0.86), fresnel + bands * 0.25);
        float alpha = 0.34 + fresnel * 0.48 + n * 0.08 + uCharged * 0.14;
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }), []);

  const ringMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: "#54ffe8",
    transparent: true,
    opacity: 0.32,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }), []);

  useFrame((_, delta) => {
    const motion = motionRef.current;
    coreMaterial.uniforms.uTime.value += delta;
    coreMaterial.uniforms.uCharged.value = THREE.MathUtils.damp(coreMaterial.uniforms.uCharged.value, charged ? 1 : 0, 4, delta);
    if (!groupRef.current) return;
    groupRef.current.rotation.y += delta * (0.12 + (charged ? 0.08 : 0));
    groupRef.current.rotation.x = THREE.MathUtils.damp(groupRef.current.rotation.x, motion.y * 0.36, 3, delta);
    groupRef.current.rotation.z = THREE.MathUtils.damp(groupRef.current.rotation.z, motion.x * -0.28, 3, delta);
    groupRef.current.scale.setScalar(THREE.MathUtils.damp(groupRef.current.scale.x, transitionActive ? 1.85 : charged ? 1.08 : 1, 2.6, delta));
  });

  return (
    <Float speed={1.1} floatIntensity={0.35} rotationIntensity={0.22}>
      <group ref={groupRef} position={[1.85, 0.1, -3.2]}>
        <mesh material={coreMaterial}>
          <icosahedronGeometry args={[2.35, 7]} />
        </mesh>
        <mesh scale={1.3}>
          <sphereGeometry args={[2.35, 48, 48]} />
          <meshBasicMaterial color="#33fff0" transparent opacity={0.055} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
        {[0, 1, 2, 3].map((ring) => (
          <mesh key={ring} rotation={[ring * 0.72, ring * 0.44, ring * 0.28]} material={ringMaterial}>
            <torusGeometry args={[3.0 + ring * 0.38, 0.012 + ring * 0.003, 8, 180]} />
          </mesh>
        ))}
      </group>
    </Float>
  );
}

function NoorNeuralLattice({ motionRef }: { motionRef: NoorMotionRef }) {
  const groupRef = useRef<THREE.Group | null>(null);
  const materialRef = useRef<THREE.LineBasicMaterial | null>(null);

  const { lineGeometry, nodeGeometry } = useMemo(() => {
    const nodeCount = 78;
    const nodes: THREE.Vector3[] = [];
    for (let index = 0; index < nodeCount; index += 1) {
      const angle = index * 2.399963;
      const radius = 5.6 + Math.sin(index * 1.7) * 1.2 + Math.random() * 1.8;
      nodes.push(new THREE.Vector3(
        Math.cos(angle) * radius,
        THREE.MathUtils.randFloatSpread(7.4),
        Math.sin(angle) * radius - 7.5,
      ));
    }

    const linePositions: number[] = [];
    nodes.forEach((node, index) => {
      const next = nodes[(index + 5) % nodes.length];
      const alternate = nodes[(index + 13) % nodes.length];
      linePositions.push(node.x, node.y, node.z, next.x, next.y, next.z);
      if (index % 3 === 0) linePositions.push(node.x, node.y, node.z, alternate.x, alternate.y, alternate.z);
    });

    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));

    const nodePositions = new Float32Array(nodes.length * 3);
    nodes.forEach((node, index) => {
      nodePositions[index * 3] = node.x;
      nodePositions[index * 3 + 1] = node.y;
      nodePositions[index * 3 + 2] = node.z;
    });
    const nodeGeometry = new THREE.BufferGeometry();
    nodeGeometry.setAttribute("position", new THREE.BufferAttribute(nodePositions, 3));
    return { lineGeometry, nodeGeometry };
  }, []);

  useFrame(({ clock }, delta) => {
    const motion = motionRef.current;
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.025;
      groupRef.current.position.x = THREE.MathUtils.damp(groupRef.current.position.x, motion.x * -0.75, 3, delta);
      groupRef.current.position.y = THREE.MathUtils.damp(groupRef.current.position.y, motion.scroll * -1.8, 3, delta);
    }
    if (materialRef.current) {
      materialRef.current.opacity = 0.16 + Math.sin(clock.elapsedTime * 1.7) * 0.035 + (motion.charged ? 0.11 : 0);
    }
  });

  return (
    <group ref={groupRef}>
      <lineSegments geometry={lineGeometry}>
        <lineBasicMaterial ref={materialRef} color="#65ffee" transparent opacity={0.18} blending={THREE.AdditiveBlending} depthWrite={false} />
      </lineSegments>
      <points geometry={nodeGeometry}>
        <pointsMaterial color="#fff5c4" size={0.08} sizeAttenuation transparent opacity={0.72} blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>
    </group>
  );
}

function NoorDepthCivilization({ motionRef }: { motionRef: NoorMotionRef }) {
  const groupRef = useRef<THREE.Group | null>(null);

  useFrame((_, delta) => {
    const motion = motionRef.current;
    if (!groupRef.current) return;
    groupRef.current.rotation.z += delta * 0.012;
    groupRef.current.position.z = THREE.MathUtils.damp(groupRef.current.position.z, motion.scroll * -8, 2.4, delta);
    groupRef.current.position.x = THREE.MathUtils.damp(groupRef.current.position.x, motion.x * -1.6, 2.4, delta);
  });

  return (
    <group ref={groupRef} position={[0, 0, -18]}>
      {[0, 1, 2, 3, 4].map((index) => (
        <mesh key={index} position={[Math.cos(index * 1.6) * 9, Math.sin(index * 0.9) * 4, -index * 4]} rotation={[1.2, 0.2, index * 0.8]}>
          <torusGeometry args={[4.2 + index * 1.2, 0.01, 6, 160]} />
          <meshBasicMaterial color={index % 2 ? "#fff1a8" : "#52ffe5"} transparent opacity={0.06} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
      <mesh position={[0, -5.5, -4]} rotation={[-1.35, 0, 0]}>
        <planeGeometry args={[34, 22, 1, 1]} />
        <meshBasicMaterial color="#42ffe0" transparent opacity={0.035} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}

function Noor2030World({
  charged,
  setCharged,
  setTransitionActive,
  startChat,
}: {
  charged: boolean;
  setCharged: (charged: boolean) => void;
  setTransitionActive: (active: boolean) => void;
  startChat: (panel?: "chat" | "gems" | "projects") => void;
}) {
  const [portalOpen, setPortalOpen] = useState(false);
  const [osEmerging, setOsEmerging] = useState(false);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const coreRef = useRef<HTMLDivElement | null>(null);
  const ctaRef = useRef<HTMLButtonElement | null>(null);
  const osRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<{ kill: () => void } | null>(null);

  useEffect(() => {
    return () => {
      timelineRef.current?.kill();
      timelineRef.current = null;
    };
  }, []);

  function playTransitionAudioCue() {
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const audio = new AudioContextClass();
      const gain = audio.createGain();
      const low = audio.createOscillator();
      const high = audio.createOscillator();

      low.type = "sine";
      high.type = "triangle";
      low.frequency.setValueAtTime(42, audio.currentTime);
      low.frequency.exponentialRampToValueAtTime(118, audio.currentTime + 6.2);
      high.frequency.setValueAtTime(420, audio.currentTime);
      high.frequency.exponentialRampToValueAtTime(980, audio.currentTime + 5.4);
      gain.gain.setValueAtTime(0.0001, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, audio.currentTime + 0.7);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 7.4);

      low.connect(gain);
      high.connect(gain);
      gain.connect(audio.destination);
      low.start();
      high.start();
      low.stop(audio.currentTime + 7.6);
      high.stop(audio.currentTime + 7.6);
      window.setTimeout(() => {
        audio.close().catch(() => undefined);
      }, 7800);
    } catch {
      // Audio is an enhancement; browsers can block it without hurting the transition.
    }
  }

  async function startPortalTransition() {
    if (portalOpen || !worldRef.current || !coreRef.current || !ctaRef.current) return;

    const { gsap } = await import("gsap");
    setPortalOpen(true);
    setTransitionActive(true);
    setCharged(true);
    playTransitionAudioCue();

    const world = worldRef.current;
    const core = coreRef.current;
    const cta = ctaRef.current;
    const os = osRef.current;

    gsap.set(world, {
      "--warp": 0,
      "--camera-z": 0,
      "--blur": 0,
      "--light": 1,
      "--core-scale": 1,
    });
    if (os) gsap.set(os, { autoAlpha: 0, scale: 0.86, z: -240 });

    const timeline = gsap.timeline({
      defaults: { ease: "power3.inOut" },
      onComplete: () => {
        setOsEmerging(true);
        setTransitionActive(false);
      },
    });
    timelineRef.current = timeline;

    timeline
      .to(cta, { scale: 0.82, autoAlpha: 0, y: 34, duration: 0.75, ease: "power2.in" }, 0)
      .to(world, { "--light": 1.6, "--blur": 8, "--warp": 0.18, duration: 1.1 }, 0)
      .to(core, { scale: 1.18, rotateZ: 18, duration: 1.15 }, 0)
      .to(world, { "--camera-z": 0.24, "--warp": 0.38, "--light": 2.15, duration: 1.6 }, 1.0)
      .to(core, { scale: 1.7, rotateZ: 84, duration: 1.8, ease: "power4.inOut" }, 1.1)
      .to(world, { "--camera-z": 0.62, "--blur": 18, "--warp": 0.74, duration: 2.2 }, 2.3)
      .to(core, { scale: 4.4, rotateZ: 210, duration: 2.2, ease: "expo.in" }, 2.35)
      .to(world, { "--camera-z": 1, "--blur": 4, "--warp": 1, "--light": 2.8, duration: 1.7, ease: "expo.out" }, 4.7)
      .to(core, { scale: 12, autoAlpha: 0.32, duration: 1.35, ease: "expo.out" }, 4.9);

    if (os) {
      timeline
        .to(os, { autoAlpha: 1, scale: 1, z: 0, duration: 1.7, ease: "expo.out" }, 5.6)
        .to(os.querySelectorAll(".os-emergence-node"), { autoAlpha: 1, y: 0, stagger: 0.16, duration: 0.7 }, 6.1);
    }
  }

  return (
    <div
      ref={worldRef}
      className={`noor2030-world phase-one ${charged ? "core-charged" : ""} ${portalOpen ? "phase-two-active" : ""} ${osEmerging ? "os-is-emerging" : ""}`}
      aria-label="Noor AI living intelligence landing experience"
    >
      <nav className="noor2030-nav">
        <button className="noor2030-mark">NOOR AI</button>
        <div><span>PHASE 1 / LIVING CORE</span></div>
      </nav>

      <div className="noor2030-depth-rails" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <section className="noor2030-scene noor2030-arrival">
        <div className="phase-one-fog" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="phase-one-streams" aria-hidden="true">
          {Array.from({ length: 14 }).map((_, index) => <i key={index} />)}
        </div>
        <div className="phase-one-fragments" aria-hidden="true">
          {["REASONING", "MEMORY", "VISION", "VOICE", "CODE", "RESEARCH", "IMAGINATION"].map((item, index) => (
            <span key={item} className={`fragment-${index + 1}`}>{item}</span>
          ))}
        </div>
        <div className="noor2030-copy">
          <small>NOOR AI / LIVING SUPERINTELLIGENCE</small>
          <h1>Enter the intelligence core.</h1>
          <p>
            A dark infinite universe of neural pathways, procedural light,
            data streams, particles, fog, and living energy responding to your presence.
          </p>
          <button
            ref={ctaRef}
            className="phase-one-cta"
            onMouseEnter={() => setCharged(true)}
            onMouseLeave={() => setCharged(false)}
            onFocus={() => setCharged(true)}
            onBlur={() => setCharged(false)}
            onClick={startPortalTransition}
          >
            <small>ACTIVATE CORE</small>
            TRY NOOR
          </button>
        </div>

        <div className="noor-core" aria-hidden="true" ref={coreRef}>
          <div className="core-aura" />
          <div className="core-sphere">
            {Array.from({ length: 48 }).map((_, index) => (
              <i key={index} style={{ "--i": index + 1, "--depth": (index % 12) + 1 } as CSSProperties} />
            ))}
          </div>
          <div className="core-ring ring-x" />
          <div className="core-ring ring-y" />
          <div className="core-ring ring-z" />
          <div className="core-label">
            <span>NOOR CORE</span>
            <b>{charged ? "neural surge" : "awakening"}</b>
          </div>
        </div>

        <div className="phase-two-motion-blur" aria-hidden="true" />
        <div className="phase-two-portal" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="os-emergence" ref={osRef} aria-hidden={!osEmerging}>
          <small>NOOR OS / SPATIAL KERNEL</small>
          <strong>Operating field emerging</strong>
          <div>
            {["MEMORY", "REASONING", "VISION", "CREATION"].map((node) => (
              <span className="os-emergence-node" key={node}>{node}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="phase-three-entry">
        <div>
          <small>NOOR OS READY</small>
          <strong>The workspace has emerged.</strong>
          <p>Memory, conversation, active tools, research pathways, and task context are arranged as one calm intelligence field.</p>
        </div>
        <button onClick={() => startChat("chat")}>Enter Noor OS</button>
      </section>
    </div>
  );
}

function NoorLifeCanvas({
  motionRef,
}: {
  motionRef: React.MutableRefObject<{ x: number; y: number; scroll: number; charged: boolean; transition: boolean }>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    let frame = 0;
    let raf = 0;
    let width = 0;
    let height = 0;
    const isMobile = window.matchMedia("(max-width: 760px)").matches;
    const particleCount = isMobile ? 90 : 150;
    const particles = Array.from({ length: particleCount }, (_, index) => ({
      angle: index * 2.399,
      radius: 40 + Math.random() * 360,
      speed: 0.0015 + Math.random() * 0.004,
      size: 0.7 + Math.random() * 2.4,
      phase: Math.random() * Math.PI * 2,
    }));

    function resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, isMobile ? 1.35 : 1.75);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function draw() {
      frame += 1;
      context.fillStyle = "rgba(0, 0, 0, 0.22)";
      context.fillRect(0, 0, width, height);

      const motion = motionRef.current;
      const intensity = motion.charged ? 1.8 : 1;
      const cx = width * (0.52 + motion.x * 0.1);
      const cy = height * (0.5 + motion.y * 0.1 - motion.scroll * 0.06);
      const time = frame * 0.016;
      context.lineWidth = 1;

      for (const particle of particles) {
        const magnetic = intensity + Math.sin(time + particle.phase) * 0.08 - motion.scroll * 0.08;
        const orbit = particle.angle + time * particle.speed * 90 * intensity;
        const cursorPull = motion.charged ? 210 : 120;
        const x = cx + Math.cos(orbit) * particle.radius * magnetic + motion.x * cursorPull;
        const y = cy + Math.sin(orbit * 1.22) * particle.radius * 0.58 * magnetic + motion.y * cursorPull * 0.75;
        const opacity = 0.18 + Math.sin(time * 2 + particle.phase) * 0.16 + motion.scroll * 0.1 + (motion.charged ? 0.22 : 0);

        context.beginPath();
        context.fillStyle = `rgba(83, 255, 231, ${Math.max(0.08, opacity)})`;
        context.arc(x, y, particle.size, 0, Math.PI * 2);
        context.fill();

        if (!isMobile && particle.radius < 150) {
          context.beginPath();
          context.strokeStyle = `rgba(83, 255, 231, ${opacity * 0.18})`;
          context.moveTo(cx, cy);
          context.lineTo(x, y);
          context.stroke();
        }
      }

      raf = requestAnimationFrame(draw);
    }

    resize();
    draw();
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas className="noor-life-canvas" ref={canvasRef} />;
}

function StudentAIScene() {
  return (
    <div className="student-stage" aria-hidden="true">
      <div className="camera-rig">
        <div className="desk-grid" />
        <div className="holo-arc arc-a" />
        <div className="holo-arc arc-b" />
        <div className="holo-arc arc-c" />
        <div className="student-rig">
          <div className="student-shadow" />
          <div className="student-body">
            <div className="torso" />
            <div className="neck" />
            <div className="head">
              <span className="face-glow" />
              <span className="hair" />
              <span className="eye eye-left" />
              <span className="eye eye-right" />
              <span className="mouth" />
            </div>
            <div className="arm arm-left"><span /></div>
            <div className="arm arm-right"><span /></div>
            <div className="celebrate-arm celebrate-left" />
            <div className="celebrate-arm celebrate-right" />
          </div>
          <div className="laptop">
            <div className="screen">
              <em>NOOR AI</em>
              <strong>work mode</strong>
              <i />
              <b />
              <span />
              <small />
            </div>
            <div className="keyboard">
              {Array.from({ length: 18 }).map((_, index) => <i key={index} />)}
            </div>
            <div className="base" />
            <div className="screen-light" />
          </div>
          <div className="success-burst">
            {Array.from({ length: 10 }).map((_, index) => <i key={index} />)}
          </div>
          <div className="holo-card holo-card-left">
            <span />
            <strong>NOOR</strong>
            <small>analysis complete</small>
          </div>
          <div className="holo-card holo-card-right">
            <span />
            <strong>98%</strong>
            <small>clarity score</small>
          </div>
          <div className="ai-particles">
            {Array.from({ length: 18 }).map((_, index) => <i key={index} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

function NoorImmersiveChat(props: {
  activeGem: Gem;
  activeGemId: string;
  conversations: Conversation[];
  currentUser: UserAccount | null;
  filteredGems: [string, Gem][];
  gemSearch: string;
  inputText: string;
  isTyping: boolean;
  loadingPromptPreview: string;
  messages: Message[];
  panel: "chat" | "gems" | "projects";
  projects: string[];
  provider: string;
  setGemSearch: (value: string) => void;
  setInputText: (value: string) => void;
  setPanel: (panel: "chat" | "gems" | "projects") => void;
  setSidebarOpen: (open: boolean) => void;
  sidebarOpen: boolean;
  startGoogleLogin: () => void;
  newChat: () => void;
  selectGem: (gemId: string) => void;
  loadConversation: (id: string) => void;
  handleSend: (event?: FormEvent) => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  goHome: () => void;
  signedIn: boolean;
}) {
  const {
    activeGem,
    activeGemId,
    conversations,
    currentUser,
    filteredGems,
    gemSearch,
    handleSend,
    inputText,
    isTyping,
    loadConversation,
    messages,
    messagesEndRef,
    newChat,
    provider,
    selectGem,
    setGemSearch,
    setInputText,
    setPanel,
    startGoogleLogin,
    goHome,
  } = props;

  const commandChips = [
    { label: "Deep Research", icon: <Search size={16} />, value: "/research " },
    { label: "Create Image", icon: <Aperture size={16} />, value: "/image " },
    { label: "Write Code", icon: <Box size={16} />, value: "/code " },
    { label: "Improve", icon: <Sparkles size={16} />, value: "/improve " },
  ];

  return (
    <motion.main className="noor-immersive-chat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="immersive-chat-bg" aria-hidden="true" />

      <aside className="immersive-sidebar">
        <div className="sidebar-command-zone">
          <button className="side-logo" onClick={goHome}>NOOR AI</button>
          <button className="side-new-chat" onClick={newChat}><Plus size={18} />New chat</button>
          <button onClick={() => setPanel("projects")}><FolderKanban size={18} />Projects</button>
          <button><Search size={18} />Search</button>
          <button onClick={() => setPanel("gems")}><Box size={18} />Gems</button>
        </div>

        <div className="sidebar-history-zone">
          <div className="side-section-title">Chat history</div>
          {conversations.length ? conversations.map((item) => (
            <button key={item.conversation_id} onClick={() => loadConversation(item.conversation_id)}>
              <History size={15} />
              <span>{item.title}</span>
            </button>
          )) : (
            <p>{currentUser ? "Your Noor sessions will appear here." : "Sign in to sync Noor memory."}</p>
          )}
        </div>
      </aside>

      <section className="immersive-main">
        <header className="immersive-topbar">
          <div><Sparkles size={15} />{provider} / {activeGem.name}</div>
          <button onClick={startGoogleLogin}><User size={16} />{currentUser?.name || "Profile"}</button>
          <button><Settings size={16} /></button>
        </header>

        <main className="immersive-chat-stage">
          {!messages.length && !isTyping && (
            <motion.div className="immersive-hero-copy" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}>
              <small>{activeGem.category} / Dedicated Noor Gem</small>
              <h1>How can Noor help today?</h1>
              <p>Type a command, ask a question, attach context, or choose a dedicated model for a focused task.</p>
            </motion.div>
          )}

          {props.panel === "gems" && (
            <motion.div className="immersive-gems" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <input value={gemSearch} onChange={(event) => setGemSearch(event.target.value)} placeholder="Search Noor Gems..." />
              <div>
                {filteredGems.map(([gemId, gem]) => (
                  <button key={gemId} className={gemId === activeGemId ? "active" : ""} onClick={() => selectGem(gemId)}>
                    <strong>{gem.name}</strong>
                    <span>{gem.category}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          <div className="immersive-messages">
            {messages.map((message) => <MessageBubble key={message.id} message={message} />)}
            {isTyping && (
              <motion.div className="immersive-thinking" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                <span />
                <strong>Noor is forming the answer</strong>
                <small>memory, context, and reasoning pathways are active</small>
              </motion.div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="immersive-command-chips">
            {commandChips.map((chip, index) => (
              <motion.button
                key={chip.label}
                onClick={() => setInputText(chip.value)}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.08 }}
              >
                {chip.icon}
                {chip.label}
              </motion.button>
            ))}
          </div>

          <form className="immersive-composer" onSubmit={handleSend}>
            <textarea
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask Noor anything..."
              rows={1}
            />
            <div className="composer-tools">
              <button type="button"><Paperclip size={18} /></button>
              <button type="button"><Aperture size={18} /></button>
              <button type="button"><Mic size={18} /></button>
              <button type="button" onClick={() => setInputText("/research ")}><Search size={17} />Research</button>
            </div>
            <button className="composer-send" disabled={!inputText.trim() || isTyping} type="submit">
              {isTyping ? <LoaderCircle className="send-spinner" size={20} /> : <Send size={20} />}
            </button>
          </form>
        </main>
      </section>
    </motion.main>
  );
}

function NoorOSWorkspace(props: {
  activeGem: Gem;
  activeGemId: string;
  conversations: Conversation[];
  currentUser: UserAccount | null;
  filteredGems: [string, Gem][];
  gemSearch: string;
  inputText: string;
  isTyping: boolean;
  loadingPromptPreview: string;
  messages: Message[];
  panel: "chat" | "gems" | "projects";
  projects: string[];
  provider: string;
  setGemSearch: (value: string) => void;
  setInputText: (value: string) => void;
  setPanel: (panel: "chat" | "gems" | "projects") => void;
  setSidebarOpen: (open: boolean) => void;
  sidebarOpen: boolean;
  startGoogleLogin: () => void;
  newChat: () => void;
  selectGem: (gemId: string) => void;
  loadConversation: (id: string) => void;
  handleSend: (event?: FormEvent) => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  goHome: () => void;
  signedIn: boolean;
}) {
  const {
    activeGem,
    conversations,
    currentUser,
    handleSend,
    inputText,
    isTyping,
    loadConversation,
    messages,
    messagesEndRef,
    newChat,
    projects,
    provider,
    setInputText,
    setPanel,
    startGoogleLogin,
    goHome,
  } = props;
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const modes = ["Fast", "Smart", "Deep Think", "Research", "Scholar"];
  const memoryNodes = [
    ...conversations.slice(0, 4).map((item) => item.title),
    ...projects,
    activeGem.name,
    "Saved memory",
    "Research history",
  ].slice(0, 8);
  const category = activeGem.category.toLowerCase();
  const workspaceMode = category.includes("engineering")
    ? "Coding"
    : category.includes("analysis")
      ? "Research"
      : category.includes("learning")
        ? "Scholar"
        : "Creation";
  const workspaceRows = workspaceMode === "Coding"
    ? ["File explorer online", "Live preview prepared", "Terminal waiting"]
    : workspaceMode === "Research"
      ? ["Source graph forming", "Citations indexed", "Research timeline ready"]
      : workspaceMode === "Scholar"
        ? ["Concept map active", "Practice queue ready", "References linked"]
        : ["Draft space ready", "Variation memory open", "Asset context synced"];

  return (
    <motion.main
      className="noor-os-shell"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.42 }}
    >
      <div className="os-neural-bg" aria-hidden="true"><span /><span /><span /></div>

      <header className="os-topbar">
        <button className="os-logo" onClick={goHome}>NOOR</button>
        <div className="os-model"><Sparkles size={15} />{provider} / {activeGem.name}</div>
        <div className="os-modes">
          {modes.map((mode) => <button className={mode === "Smart" ? "active" : ""} key={mode}>{mode}</button>)}
        </div>
        <button className={memoryOpen ? "os-toggle active" : "os-toggle"} onClick={() => setMemoryOpen((open) => !open)}>
          Memory
        </button>
        <button className={workspaceOpen ? "os-toggle active" : "os-toggle"} onClick={() => setWorkspaceOpen((open) => !open)}>
          Workspace
        </button>
        <button className="os-icon"><Mic size={17} /></button>
        <button className="os-icon"><Settings size={17} /></button>
        <button className="os-profile" onClick={startGoogleLogin}><User size={16} />{currentUser?.name || "Profile"}</button>
      </header>

      <section className={`os-grid ${memoryOpen ? "memory-open" : ""} ${workspaceOpen ? "workspace-open" : ""}`}>
        <aside className={memoryOpen ? "os-memory open" : "os-memory collapsed"}>
          <div className="os-panel-head">
            <small>NOOR MEMORY</small>
            <button onClick={newChat}><Plus size={15} />New</button>
          </div>
          <div className={`memory-graph ${isTyping ? "active" : ""}`}>
            {memoryNodes.map((node, index) => (
              <button
                key={`${node}-${index}`}
                className={`memory-node node-${index + 1}`}
                onClick={() => conversations[index] ? loadConversation(conversations[index].conversation_id) : setPanel("projects")}
              >
                <span />
                <b>{node}</b>
              </button>
            ))}
            <svg viewBox="0 0 320 360" aria-hidden="true">
              <path d="M76 64 C132 106 190 84 250 118" />
              <path d="M88 176 C128 132 188 148 244 214" />
              <path d="M72 284 C124 232 196 258 256 302" />
              <path d="M154 74 C150 146 158 214 164 318" />
            </svg>
          </div>
          <div className="memory-clusters">
            {["Conversations", "Saved memories", "Projects", "Research"].map((item) => <button key={item}>{item}</button>)}
          </div>
        </aside>

        <main className="os-intelligence">
          <div className={`thinking-field ${isTyping ? "active" : ""}`} aria-hidden="true"><i /><i /><i /><i /></div>
          <div className="conversation-plane">
            {!messages.length && !isTyping ? (
              <motion.div className="os-welcome" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
                <Aperture size={30} />
                <strong>Welcome inside Noor.</strong>
                <span>Speak naturally. Noor organizes memory, tools, sources, and workspace context around your intent.</span>
              </motion.div>
            ) : (
              messages.map((message) => <MessageBubble key={message.id} message={message} />)
            )}
            {isTyping && (
              <motion.div className="os-reasoning" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
                <small>INTELLIGENCE IN MOTION</small>
                <strong>Reasoning pathways are activating</strong>
                <div><span /><span /><span /></div>
              </motion.div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form className="os-prompt" onSubmit={handleSend}>
            <textarea
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask Noor to think, create, research, code, or plan..."
              rows={1}
            />
            <div className="os-prompt-actions">
              <button type="button"><Paperclip size={18} /></button>
              <button type="button"><Aperture size={18} /></button>
              <button type="button"><Mic size={18} /></button>
              <button type="button" className="research-trigger"><Search size={17} />Deep Research</button>
            </div>
            <button className="os-send" disabled={!inputText.trim() || isTyping} type="submit">
              {isTyping ? <LoaderCircle className="send-spinner" size={20} /> : <Send size={20} />}
            </button>
          </form>
        </main>

        <aside className={workspaceOpen ? "os-active-workspace open" : "os-active-workspace collapsed"}>
          <div className="os-panel-head">
            <small>ACTIVE WORKSPACE</small>
            <strong>{workspaceMode}</strong>
          </div>
          <div className={`workspace-lattice ${isTyping ? "active" : ""}`}>
            {workspaceRows.map((row, index) => (
              <div key={row}>
                <span style={{ animationDelay: `${index * -0.18}s` }} />
                <b>{row}</b>
                <small>{index === 0 ? "live" : index === 1 ? "ready" : "idle"}</small>
              </div>
            ))}
          </div>
          <div className="source-graph">
            <small>{workspaceMode === "Research" ? "SOURCE GRAPH" : "CONTEXT GRAPH"}</small>
            <div><i /><i /><i /><i /><i /></div>
          </div>
          <div className="agent-strip">
            {["Research", "Writing", "Coding", "Image", "Video"].map((agent) => (
              <span key={agent}>{agent}<b>{isTyping ? "active" : "ready"}</b></span>
            ))}
          </div>
        </aside>
      </section>
    </motion.main>
  );
}

function ChatWorkspace(props: {
  activeGem: Gem;
  activeGemId: string;
  conversations: Conversation[];
  currentUser: UserAccount | null;
  filteredGems: [string, Gem][];
  gemSearch: string;
  inputText: string;
  isTyping: boolean;
  loadingPromptPreview: string;
  messages: Message[];
  panel: "chat" | "gems" | "projects";
  projects: string[];
  provider: string;
  setGemSearch: (value: string) => void;
  setInputText: (value: string) => void;
  setPanel: (panel: "chat" | "gems" | "projects") => void;
  setSidebarOpen: (open: boolean) => void;
  sidebarOpen: boolean;
  startGoogleLogin: () => void;
  newChat: () => void;
  selectGem: (gemId: string) => void;
  loadConversation: (id: string) => void;
  handleSend: (event?: FormEvent) => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  goHome: () => void;
  signedIn: boolean;
}) {
  const {
    activeGem,
    activeGemId,
    conversations,
    currentUser,
    filteredGems,
    gemSearch,
    goHome,
    handleSend,
    inputText,
    isTyping,
    loadingPromptPreview,
    loadConversation,
    messages,
    messagesEndRef,
    newChat,
    panel,
    projects,
    provider,
    selectGem,
    setGemSearch,
    setInputText,
    setPanel,
    setSidebarOpen,
    sidebarOpen,
    signedIn,
    startGoogleLogin,
  } = props;

  return (
    <motion.main
      className={`premium-chat ${sidebarOpen ? "sidebar-open" : ""}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
    >
      <LuxuryBackground active={isTyping} />
      <aside className="chat-sidebar">
        <div className="sidebar-brand">
          <span className="brand-orbit small">N</span>
          <div>
            <strong>NOOR</strong>
            <small>INTELLIGENCE OS</small>
          </div>
          <button className="mobile-close" onClick={() => setSidebarOpen(false)}><X size={18} /></button>
        </div>

        <div className="sidebar-section-label">Illuminated Paths</div>
        <div className="sidebar-buttons">
          <button className={panel === "chat" ? "active" : ""} onClick={newChat}><Plus size={18} />New chat</button>
          <button onClick={() => setPanel("gems")}><Search size={18} />Search</button>
          <button className={panel === "projects" ? "active" : ""} onClick={() => setPanel("projects")}><FolderKanban size={18} />Projects</button>
          <button className={panel === "gems" ? "active" : ""} onClick={() => setPanel("gems")}><Box size={18} />Gems</button>
        </div>

        <div className="resonance-panel">
          <div className="sidebar-section-label">Core Resonance</div>
          <div className="resonance-box">
            <Metric icon={<CloudLightning size={14} />} label="Energy" value="Optimal" width="85%" />
            <Metric icon={<Compass size={14} />} label="Clarity" value="99.8%" width="99%" blue />
          </div>
        </div>

        <div className="history-panel">
          <div className="sidebar-section-label">Previous chats</div>
          {signedIn && conversations.length ? (
            conversations.map((item) => (
              <button key={item.conversation_id} onClick={() => loadConversation(item.conversation_id)}>
                <History size={15} />
                <span>{item.title}</span>
              </button>
            ))
          ) : (
            <p>{signedIn ? "No chats in this Google account yet." : "Sign in to sync previous chats."}</p>
          )}
        </div>

        <div className="sidebar-footer">
          <button onClick={startGoogleLogin}>
            <User size={18} />
            <span>{currentUser?.name || "Visionary"}</span>
            <Settings size={16} />
          </button>
          <button onClick={goHome}><Home size={18} />Home</button>
        </div>
      </aside>

      <section className="chat-main">
        <header className="chat-header">
          <button className="icon-button" onClick={() => setSidebarOpen(!sidebarOpen)}><Menu size={20} /></button>
          <div className="chat-title">
            <strong>Noor OS</strong>
            <small>Spatial intelligence command layer</small>
          </div>
          <div className="engine-label"><Sparkles size={16} />NOOR INTELLIGENCE V.7</div>
          <div className="provider-pill"><span>Provider</span><strong>{provider}</strong></div>
        </header>

        <div className="chat-content">
          <AnimatePresence mode="wait">
            {panel === "gems" ? (
              <motion.div className="panel-view" key="gems" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -18 }}>
                <div className="panel-head">
                  <div><small>NOOR GEM LIBRARY</small><strong>Choose a Gem</strong></div>
                  <button onClick={() => setPanel("chat")}>Close</button>
                </div>
                <input className="panel-search" value={gemSearch} onChange={(event) => setGemSearch(event.target.value)} placeholder="Search Gems..." />
                <div className="gem-grid">
                  {filteredGems.map(([gemId, gem]) => (
                    <button className={gemId === activeGemId ? "active" : ""} key={gemId} onClick={() => selectGem(gemId)}>
                      <small>{gem.category}</small>
                      <strong>{gem.name}</strong>
                      <span>{gem.description}</span>
                    </button>
                  ))}
                </div>
              </motion.div>
            ) : panel === "projects" ? (
              <motion.div className="panel-view" key="projects" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -18 }}>
                <div className="panel-head">
                  <div><small>PROJECT SPACE</small><strong>Choose a Project</strong></div>
                  <button onClick={() => setPanel("chat")}>Close</button>
                </div>
                <div className="project-grid">
                  {projects.map((project) => (
                    <button key={project} onClick={() => setPanel("chat")}>
                      <FolderKanban size={24} />
                      <strong>{project}</strong>
                      <span>Study, revise, practice, code, debug, and ship with Noor.</span>
                    </button>
                  ))}
                </div>
              </motion.div>
            ) : (
              <motion.div className="messages-wrap" key="messages" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {!messages.length && !isTyping ? (
                  <motion.div className="welcome-card" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}>
                    <Aperture className="welcome-icon" size={34} />
                    <strong>Welcome. I am Noor.</strong>
                    <span>I am here to illuminate your path, simplify complexity, and bring clarity to your ideas. How may I assist you?</span>
                    <em>{activeGem.name} / {activeGem.category}</em>
                  </motion.div>
                ) : (
                  messages.map((message) => <MessageBubble key={message.id} message={message} />)
                )}
                {isTyping && <TypingBubble />}
                <div ref={messagesEndRef} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="composer-stack">
          <AnimatePresence>
            {isTyping && loadingPromptPreview && (
              <motion.div
                className="loading-prompt-preview"
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="preview-status">
                  <span><i />Noor is composing</span>
                  <b>{activeGem.name}</b>
                </div>
                <p>{loadingPromptPreview}</p>
                <div className="preview-progress"><span /></div>
              </motion.div>
            )}
          </AnimatePresence>
          <form className="composer-pro" onSubmit={handleSend}>
            <textarea
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask Noor to illuminate your ideas..."
              rows={1}
            />
            <button type="button"><Paperclip size={20} /></button>
            <button type="button"><Mic size={20} /></button>
            <button className="send-button" disabled={!inputText.trim() || isTyping} type="submit">
              {isTyping ? <LoaderCircle className="send-spinner" size={20} /> : <Send size={20} />}
            </button>
          </form>
        </div>
      </section>
    </motion.main>
  );
}

function Metric({ icon, label, value, width, blue = false }: { icon: React.ReactNode; label: string; value: string; width: string; blue?: boolean }) {
  return (
    <div className="metric">
      <div><span>{icon}{label}</span><strong>{value}</strong></div>
      <i className={blue ? "blue" : ""}><b style={{ width }} /></i>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  return (
    <motion.div
      className={`message-row ${message.role}`}
      initial={{ opacity: 0, y: 18, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="avatar">{message.role === "assistant" ? <Aperture size={20} /> : <User size={20} />}</div>
      <div className="bubble">{message.content}</div>
    </motion.div>
  );
}

function TypingBubble() {
  return (
    <motion.div className="message-row assistant" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}>
      <div className="avatar"><Aperture size={20} /></div>
      <div className="bubble typing-dots"><span /><span /><span /></div>
    </motion.div>
  );
}

function LuxuryBackground({ active = false }: { active?: boolean }) {
  return (
    <div className={`lux-bg ${active ? "active" : ""}`} aria-hidden="true">
      <video className="tech-video-bg" autoPlay loop muted playsInline preload="metadata">
        <source src="/noor-tech-background.mp4" type="video/mp4" />
      </video>
      <NoorSignalCanvas active={active} />
      <div className="noor-brand-field">
        <span>NOOR AI</span>
        <small>PERSONAL INTELLIGENCE MODEL</small>
      </div>
      <div className="motion-field">
        <span />
        <span />
        <span />
        <span />
        <i />
        <i />
        <i />
      </div>
      <motion.div className="orb-core" animate={{ scale: active ? 1.14 : 1, rotate: 360 }} transition={{ rotate: { duration: 28, repeat: Infinity, ease: "linear" }, scale: { duration: 0.5 } }} />
      <motion.div className="ring ring-one" animate={{ rotate: 360 }} transition={{ duration: 34, repeat: Infinity, ease: "linear" }} />
      <motion.div className="ring ring-two" animate={{ rotate: -360 }} transition={{ duration: 42, repeat: Infinity, ease: "linear" }} />
      <motion.div className="ring ring-three" animate={{ rotate: 360 }} transition={{ duration: 55, repeat: Infinity, ease: "linear" }} />
      <div className="grid-plane" />
      <div className="noise-layer" />
    </div>
  );
}

function NoorSignalCanvas({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let frame = 0;
    let raf = 0;
    const pointer = { x: 0.62, y: 0.46, tx: 0.62, ty: 0.46 };
    const strands = Array.from({ length: 34 }, (_, index) => ({
      phase: Math.random() * Math.PI * 2,
      speed: 0.0016 + Math.random() * 0.002,
      lane: index / 33,
      depth: 0.25 + Math.random() * 0.75,
    }));

    function resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function onPointerMove(event: PointerEvent) {
      pointer.tx = event.clientX / Math.max(1, width);
      pointer.ty = event.clientY / Math.max(1, height);
    }

    function draw(now: number) {
      pointer.x += (pointer.tx - pointer.x) * 0.035;
      pointer.y += (pointer.ty - pointer.y) * 0.035;
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";

      const pulse = active ? 1.35 : 1;
      const centerX = width * (0.5 + (pointer.x - 0.5) * 0.16);
      const centerY = height * (0.48 + (pointer.y - 0.5) * 0.12);

      for (const strand of strands) {
        const yBase = height * (0.16 + strand.lane * 0.72);
        const amp = (34 + strand.depth * 72) * pulse;
        const alpha = 0.035 + strand.depth * 0.085;
        const grad = ctx.createLinearGradient(0, yBase, width, yBase);
        grad.addColorStop(0, "rgba(255,255,255,0)");
        grad.addColorStop(0.32, `rgba(255,255,255,${alpha})`);
        grad.addColorStop(0.58, `rgba(255,236,185,${alpha * 1.6})`);
        grad.addColorStop(1, "rgba(255,255,255,0)");

        ctx.strokeStyle = grad;
        ctx.lineWidth = 0.7 + strand.depth * 1.2;
        ctx.beginPath();
        for (let step = 0; step <= 90; step += 1) {
          const t = step / 90;
          const x = width * t;
          const pull = Math.exp(-Math.pow((x - centerX) / (width * 0.28), 2));
          const wave =
            Math.sin(t * Math.PI * 3.2 + strand.phase + now * strand.speed) * amp +
            Math.sin(t * Math.PI * 8 + strand.phase * 0.7 + now * strand.speed * 1.8) * amp * 0.18;
          const y = yBase + wave + (centerY - yBase) * pull * 0.18 * strand.depth;
          if (step === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      for (let index = 0; index < 42; index += 1) {
        const angle = index * 0.75 + now * 0.00022;
        const radius = 80 + (index % 9) * 34 + Math.sin(now * 0.001 + index) * 20;
        const x = centerX + Math.cos(angle) * radius * (1.1 + pointer.x * 0.18);
        const y = centerY + Math.sin(angle * 1.18) * radius * 0.48;
        const size = 1.2 + ((index % 5) / 5) * 2.2;
        ctx.fillStyle = `rgba(255,244,214,${0.12 + (index % 4) * 0.035})`;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalCompositeOperation = "source-over";
      frame += 1;
      raf = requestAnimationFrame(draw);
    }

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove);
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      frame = 0;
    };
  }, [active]);

  return <canvas className="noor-signal-canvas" ref={canvasRef} />;
}
