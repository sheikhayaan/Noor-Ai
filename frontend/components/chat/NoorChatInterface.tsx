"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, ReactNode, useEffect, useRef, useState } from "react";

import { ModelPicker } from "@/components/chat/ModelPicker";
import {
  Archive,
  Bot,
  BrainCircuit,
  BriefcaseBusiness,
  ChevronDown,
  Code2,
  Compass,
  FileText,
  GraduationCap,
  Image,
  LayoutGrid,
  LogIn,
  LogOut,
  Menu,
  Mic,
  PanelLeftClose,
  Paperclip,
  PenLine,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  User,
  X,
} from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  deleteConversationApi,
  ensureGuestSession,
  fetchGems,
  fetchMessages,
  listConversations,
  logout,
  rateMessage,
  renameConversation,
  sendIntelligentChat,
  type NoorUser,
} from "@/lib/api";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { SavingsPill, type ResponseSavings } from "@/components/intelligence/SavingsPill";

type MessageRole = "assistant" | "user";

type ChatMessage = {
  id: string;
  role: MessageRole;
  content: string;
  attachments?: UploadedFile[];
  savings?: ResponseSavings;
  rating?: 1 | -1;
};

type Conversation = {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
  gemId: string;
  isDraft: boolean;
  loaded: boolean;
};

type UploadedFile = {
  id: string;
  name: string;
  type: string;
  size: number;
  preview?: string;
};

type Gem = {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: ReactNode;
};

const USER_KEY = "noor.user.v2";
const GUEST_KEY = "noor.guest.v1";
const USAGE_KEY = "noor.usage.v1";
const MEMORY_KEY = "noor.memory.v1";
const DAILY_LIMIT = 30;
const DEFAULT_GEM = "general";

// Backend gems only carry {name, description, category}; the UI owns the icon.
const GEM_ICONS: Record<string, ReactNode> = {
  general: <Sparkles size={17} />,
  tutor: <GraduationCap size={17} />,
  coding: <Code2 size={17} />,
  content: <PenLine size={17} />,
  research: <BrainCircuit size={17} />,
  image: <Image size={17} />,
  business: <BriefcaseBusiness size={17} />,
};

function gemIcon(id: string): ReactNode {
  return GEM_ICONS[id] ?? <Sparkles size={17} />;
}

const FALLBACK_GEM: Gem = {
  id: DEFAULT_GEM,
  name: "Noor",
  description: "Balanced help for every task.",
  category: "assistant",
  icon: <Sparkles size={17} />,
};

const starters = [
  "Build a launch plan for Noor AI",
  "Review this code architecture",
  "Create premium image prompts",
  "Summarize a research topic",
];

const seedMessage: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Welcome to Noor. Choose a Gem, upload context, or ask anything. I can help with research, code, image prompts, study plans, and business strategy.",
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function localId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createDraftConversation(gemId: string = DEFAULT_GEM): Conversation {
  return {
    id: localId("draft"),
    title: "New chat",
    messages: [seedMessage],
    updatedAt: Date.now(),
    gemId,
    isDraft: true,
    loaded: true,
  };
}

function getOrCreateGuestId(): string {
  try {
    const existing = localStorage.getItem(GUEST_KEY);
    if (existing) return existing;
    const id = localId("guest");
    localStorage.setItem(GUEST_KEY, id);
    return id;
  } catch {
    return "guest-anon";
  }
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function titleFromPrompt(prompt: string) {
  const words = prompt.trim().split(/\s+/).slice(0, 7).join(" ");
  return words || "New chat";
}

// SQLite timestamps look like "2026-08-16 12:34:56" (space, no zone). Normalize for Date.parse.
function parseTimestamp(value: string): number {
  const parsed = Date.parse(value.replace(" ", "T"));
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

export function NoorChatInterface() {
  const [gems, setGems] = useState<Gem[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState("");
  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [activeGemId, setActiveGemId] = useState<string>(DEFAULT_GEM);
  const [isStreaming, setIsStreaming] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [user, setUser] = useState<NoorUser | null>(null);
  const [guestId, setGuestId] = useState("");
  const [signInOpen, setSignInOpen] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [usage, setUsage] = useState({ date: todayKey(), count: 0 });
  const [memory, setMemory] = useState<string[]>([]);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [offline, setOffline] = useState(false);
  // "" / "noor-auto" = Noor's routed+cached default; anything else needs a BYOK key.
  const [modelId, setModelId] = useState("noor-auto");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const currentUserId = user?.user_id ?? guestId;
  const activeConversation =
    conversations.find((conversation) => conversation.id === activeId) ?? conversations[0];
  const activeGem = gems.find((gem) => gem.id === activeGemId) ?? gems[0] ?? FALLBACK_GEM;
  const emptyChat = !activeConversation || activeConversation.messages.length <= 1;
  const limitReached = usage.count >= DAILY_LIMIT;

  // Load conversations for a user (or guest) from the backend, always fronted by a fresh draft.
  async function loadConversations(userId: string) {
    let serverConversations: Conversation[] = [];
    try {
      const list = await listConversations(userId);
      serverConversations = list.map((conversation) => ({
        id: conversation.conversation_id,
        title: conversation.title,
        messages: [],
        updatedAt: parseTimestamp(conversation.last_message_at),
        gemId: conversation.gem_id,
        isDraft: false,
        loaded: false,
      }));
    } catch {
      // Backend unreachable — a local draft still lets the user work.
    }
    serverConversations.sort((a, b) => b.updatedAt - a.updatedAt);
    const draft = createDraftConversation(DEFAULT_GEM);
    setConversations([draft, ...serverConversations]);
    setActiveId(draft.id);
  }

  // Establish (or reuse) a server-signed guest session so anonymous identity is
  // unforgeable and the app is ready for NOOR_AUTH_ENFORCE. The server call is
  // idempotent (a live cookie is returned as-is); if the backend is unreachable
  // we keep the local guest id so the app still works offline and in observe
  // mode, where the client-supplied user_id is still accepted.
  async function bootstrapGuestSession(fallbackId: string) {
    try {
      const guest = await ensureGuestSession();
      setGuestId(guest.user_id);
      try {
        localStorage.setItem(GUEST_KEY, guest.user_id);
      } catch {
        // localStorage blocked (private mode) — the HttpOnly cookie still carries identity.
      }
      return guest.user_id;
    } catch {
      return fallbackId;
    }
  }

  useEffect(() => {
    const gid = getOrCreateGuestId();
    setGuestId(gid);

    const storedUser = localStorage.getItem(USER_KEY);
    const initialUser = storedUser ? (JSON.parse(storedUser) as NoorUser) : null;
    if (initialUser) setUser(initialUser);

    const storedUsage = localStorage.getItem(USAGE_KEY);
    if (storedUsage) {
      const parsedUsage = JSON.parse(storedUsage) as { date: string; count: number };
      setUsage(parsedUsage.date === todayKey() ? parsedUsage : { date: todayKey(), count: 0 });
    }

    const storedMemory = localStorage.getItem(MEMORY_KEY);
    if (storedMemory) setMemory(JSON.parse(storedMemory) as string[]);

    fetchGems()
      .then((response) => {
        const list = Object.entries(response.gems).map(([id, gem]) => ({
          id,
          name: gem.name,
          description: gem.description,
          category: gem.category,
          icon: gemIcon(id),
        }));
        setGems(list);
        setActiveGemId((prev) =>
          list.some((gem) => gem.id === prev)
            ? prev
            : list.find((gem) => gem.id === DEFAULT_GEM)?.id ?? list[0]?.id ?? DEFAULT_GEM,
        );
      })
      .catch(() => {
        // Gems endpoint down — the composer still works with the default gem.
      });

    loadConversations(initialUser?.user_id ?? gid);

    if (!initialUser) {
      // No logged-in user: bind to a server-signed guest session, then reload
      // under the server identity so the app is enforce-ready and non-breaking.
      bootstrapGuestSession(gid).then((id) => {
        if (id !== gid) loadConversations(id);
      });
    }

    function syncOnline() {
      setOffline(!navigator.onLine);
    }

    syncOnline();
    window.addEventListener("online", syncOnline);
    window.addEventListener("offline", syncOnline);
    return () => {
      window.removeEventListener("online", syncOnline);
      window.removeEventListener("offline", syncOnline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
  }, [usage]);

  useEffect(() => {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  }, [memory]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConversation?.messages, isStreaming]);

  function updateConversation(id: string, updater: (conversation: Conversation) => Conversation) {
    setConversations((items) =>
      items
        .map((conversation) => (conversation.id === id ? updater(conversation) : conversation))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    );
  }

  function newChat(gemId = activeGemId) {
    const draft = createDraftConversation(gemId || DEFAULT_GEM);
    setConversations((items) => [
      draft,
      // Drop any previous untouched draft so empty "New chat" entries don't pile up.
      ...items.filter((conversation) => !(conversation.isDraft && conversation.messages.length <= 1)),
    ]);
    setActiveId(draft.id);
    setActiveGemId(gemId || DEFAULT_GEM);
    setInput("");
    setFiles([]);
  }

  async function deleteChat(id: string) {
    const target = conversations.find((conversation) => conversation.id === id);
    setConversations((items) => {
      const next = items.filter((conversation) => conversation.id !== id);
      if (!next.length) {
        const replacement = createDraftConversation();
        setActiveId(replacement.id);
        return [replacement];
      }
      if (activeId === id) setActiveId(next[0].id);
      return next;
    });
    if (target && !target.isDraft) {
      try {
        await deleteConversationApi(id, currentUserId);
      } catch {
        // Already removed locally; ignore transient backend errors.
      }
    }
  }

  async function renameChat(id: string) {
    const current = conversations.find((conversation) => conversation.id === id);
    const title = window.prompt("Rename chat", current?.title ?? "New chat")?.trim();
    if (!title) return;
    updateConversation(id, (conversation) => ({ ...conversation, title, updatedAt: Date.now() }));
    if (current && !current.isDraft) {
      try {
        await renameConversation(id, title, currentUserId);
      } catch {
        // Local rename stands even if the backend call fails.
      }
    }
  }

  async function selectConversation(conversation: Conversation) {
    setActiveId(conversation.id);
    setActiveGemId(conversation.gemId || DEFAULT_GEM);
    setMobileSidebarOpen(false);
    if (conversation.loaded || conversation.isDraft) return;
    try {
      const messages = await fetchMessages(conversation.id, currentUserId);
      setConversations((items) =>
        items.map((item) =>
          item.id === conversation.id
            ? {
                ...item,
                loaded: true,
                messages: messages.map((message) => ({
                  id: `srv-${message.id}`,
                  role: message.role,
                  content: message.content,
                })),
              }
            : item,
        ),
      );
    } catch {
      setConversations((items) =>
        items.map((item) =>
          item.id === conversation.id
            ? {
                ...item,
                loaded: true,
                messages: [
                  {
                    id: localId("err"),
                    role: "assistant",
                    content: "Could not load this conversation from the server.",
                  },
                ],
              }
            : item,
        ),
      );
    }
  }

  function selectGem(gemId: string) {
    setActiveGemId(gemId);
    if (activeConversation) {
      updateConversation(activeConversation.id, (conversation) => ({
        ...conversation,
        gemId,
        updatedAt: Date.now(),
      }));
    }
  }

  function openSignIn() {
    setSignInError(null);
    setSignInOpen(true);
  }

  function handleSignedIn(nextUser: NoorUser) {
    setUser(nextUser);
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    setSignInOpen(false);
    setSignInError(null);
    loadConversations(nextUser.user_id);
  }

  function signOut() {
    setUser(null);
    localStorage.removeItem(USER_KEY);
    // Clear the server session cookie, then re-establish an anonymous guest
    // session so chatting still works. Both calls are best-effort: if the
    // backend is unreachable we still drop the local user and reuse guestId.
    logout()
      .catch(() => {})
      .finally(() => {
        bootstrapGuestSession(guestId).then((id) => loadConversations(id));
      });
  }

  async function onFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    const mapped = await Promise.all(
      selected.slice(0, 6).map(async (file) => {
        const upload: UploadedFile = {
          id: `file-${file.name}-${Date.now()}`,
          name: file.name,
          type: file.type || "unknown",
          size: file.size,
        };
        if (file.type.startsWith("image/")) upload.preview = URL.createObjectURL(file);
        return upload;
      }),
    );
    setFiles((items) => [...items, ...mapped]);
    event.target.value = "";
  }

  // Progressively reveal the real backend response for a natural typing feel.
  function streamAssistantResponse(conversationId: string, fullText: string, savings?: ResponseSavings) {
    const assistantId = localId("assistant");
    let index = 0;
    setIsStreaming(true);
    updateConversation(conversationId, (conversation) => ({
      ...conversation,
      messages: [...conversation.messages, { id: assistantId, role: "assistant", content: "", savings }],
      updatedAt: Date.now(),
    }));

    const timer = window.setInterval(() => {
      index += Math.max(2, Math.floor(fullText.length / 90));
      const partial = fullText.slice(0, index);
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) =>
          message.id === assistantId ? { ...message, content: partial } : message,
        ),
        updatedAt: Date.now(),
      }));
      if (index >= fullText.length) {
        window.clearInterval(timer);
        setIsStreaming(false);
      }
    }, 28);
  }

  async function sendMessage(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const prompt = input.trim();
    if (!prompt || isStreaming || limitReached || !activeConversation) return;

    const conversation = activeConversation;
    const attachments = files;
    const userMessage: ChatMessage = {
      id: localId("user"),
      role: "user",
      content: prompt,
      attachments,
    };
    const nextTitle =
      conversation.title === "New chat" ? titleFromPrompt(prompt) : conversation.title;

    // Optimistically show the user's message immediately.
    updateConversation(conversation.id, (item) => ({
      ...item,
      title: nextTitle,
      messages: [...item.messages, userMessage],
      gemId: activeGemId,
      updatedAt: Date.now(),
    }));
    setUsage((value) => ({
      date: todayKey(),
      count: value.date === todayKey() ? value.count + 1 : 1,
    }));
    setMemory((items) => [...items.slice(-7), `${activeGem.name}: ${prompt.slice(0, 90)}`]);
    setInput("");
    setFiles([]);
    setIsStreaming(true);

    try {
      const response = await sendIntelligentChat({
        message: prompt,
        gemId: activeGemId,
        userId: currentUserId,
        conversationId: conversation.isDraft ? undefined : conversation.id,
        model: modelId === "noor-auto" ? undefined : modelId,
      });

      // A draft becomes a real, server-backed conversation once the backend assigns its id.
      const realId = response.conversation_id;
      if (conversation.isDraft && realId !== conversation.id) {
        setConversations((items) =>
          items
            .map((item) =>
              item.id === conversation.id
                ? { ...item, id: realId, isDraft: false, loaded: true, updatedAt: Date.now() }
                : item,
            )
            .sort((a, b) => b.updatedAt - a.updatedAt),
        );
        setActiveId(realId);
      }

      // Honest per-response savings, straight from the backend measurement.
      const savings: ResponseSavings = {
        tokensSaved: response.tokens_saved,
        costSaved: response.cost_saved_usd,
        memoriesUsed: response.memories_used,
        cacheResult: response.cache_result,
        model: response.model,
        levelsApplied: response.levels_applied,
      };
      streamAssistantResponse(realId, response.response, savings);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong. Please try again.";
      updateConversation(conversation.id, (item) => ({
        ...item,
        messages: [...item.messages, { id: localId("err"), role: "assistant", content: message }],
        updatedAt: Date.now(),
      }));
      setIsStreaming(false);
    }
  }

  // Thumbs feedback on an assistant reply. Optimistic and best-effort: drafts
  // have no server-side conversation yet, so they're skipped; clicking the
  // active thumb again clears it. Server messages ("srv-42") rate that specific
  // turn, live-streamed ones rate at the conversation level (message_id null).
  async function rateActiveMessage(messageId: string, rating: 1 | -1) {
    const conversation = activeConversation;
    if (!conversation || conversation.isDraft) return;

    const target = conversation.messages.find((message) => message.id === messageId);
    const previous = target?.rating;
    const nextRating = previous === rating ? undefined : rating;

    updateConversation(conversation.id, (item) => ({
      ...item,
      messages: item.messages.map((message) =>
        message.id === messageId ? { ...message, rating: nextRating } : message,
      ),
    }));

    if (nextRating === undefined) return; // cleared locally — nothing to persist

    const match = /^srv-(\d+)$/.exec(messageId);
    const serverMessageId = match ? Number(match[1]) : null;

    try {
      await rateMessage({
        conversationId: conversation.id,
        rating: nextRating,
        userId: currentUserId,
        messageId: serverMessageId,
      });
    } catch {
      // Server rejected it (e.g. ownership) — revert the optimistic change.
      updateConversation(conversation.id, (item) => ({
        ...item,
        messages: item.messages.map((message) =>
          message.id === messageId ? { ...message, rating: previous } : message,
        ),
      }));
    }
  }

  return (
    <main className="fixed inset-0 grid h-dvh w-screen overflow-hidden bg-[#08090b] text-white md:grid-cols-[auto_minmax(0,1fr)]">
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button aria-label="Close sidebar" className="absolute inset-0 bg-black/62" onClick={() => setMobileSidebarOpen(false)} />
          <motion.aside
            className="absolute bottom-0 left-0 top-0 w-[84vw] max-w-[340px] border-r border-white/10 bg-[#0d0e11] p-3 shadow-2xl"
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          >
            <SidebarContent
              conversations={conversations}
              activeId={activeId}
              collapsed={false}
              onNewChat={() => newChat()}
              onSelect={selectConversation}
              onRename={renameChat}
              onDelete={deleteChat}
            />
          </motion.aside>
        </div>
      )}

      <aside className={cn("relative z-20 hidden h-full border-r border-white/10 bg-[#0d0e11] transition-[width] duration-300 md:block", sidebarOpen ? "w-[304px]" : "w-[76px]")}>
        <SidebarContent
          conversations={conversations}
          activeId={activeId}
          collapsed={!sidebarOpen}
          onNewChat={() => newChat()}
          onSelect={selectConversation}
          onRename={renameChat}
          onDelete={deleteChat}
          toggleCollapsed={() => setSidebarOpen((value) => !value)}
        />
      </aside>

      <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
        <header className="flex h-16 items-center justify-between border-b border-white/8 px-3 md:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <button className="flex h-10 w-10 items-center justify-center rounded-xl text-white/70 hover:bg-white/[0.06] md:hidden" onClick={() => setMobileSidebarOpen(true)} aria-label="Open sidebar">
              <Menu size={20} />
            </button>
            <div className="flex min-w-0 items-center gap-2">
              <select
                aria-label="Noor Gem"
                className="max-w-[160px] rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-white/86 outline-none md:max-w-none"
                value={activeGemId}
                onChange={(event) => selectGem(event.target.value)}
              >
                {gems.map((gem) => <option key={gem.id} value={gem.id}>{gem.name}</option>)}
              </select>
              <ChevronDown className="hidden text-white/36 md:block" size={16} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/52 md:block">
              {usage.count}/{DAILY_LIMIT} today
            </div>
            {user ? (
              <button className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-white/72 hover:bg-white/[0.06]" onClick={signOut}>
                <User size={16} /> <span className="hidden sm:inline">{user.name}</span> <LogOut size={15} />
              </button>
            ) : (
              <button className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-white/72 hover:bg-white/[0.06]" onClick={openSignIn}>
                <LogIn size={16} /> Sign in
              </button>
            )}
            <Button asChild size="md" variant="glass"><Link href="/">Home</Link></Button>
          </div>
        </header>

        {offline && <div className="border-b border-yellow-200/20 bg-yellow-200/8 px-4 py-2 text-center text-sm text-yellow-100">You are offline. Noor will keep local chats available.</div>}
        {limitReached && <div className="border-b border-red-300/20 bg-red-400/8 px-4 py-2 text-center text-sm text-red-100">Daily early-access message limit reached. Sign in to unlock higher limits soon.</div>}

        <div className="min-h-0 overflow-y-auto">
          <div className={cn("mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-8 md:px-6", emptyChat && "justify-center")}>
            {emptyChat && (
              <motion.div className="mb-10 text-center" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55 }}>
                <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-200 text-slate-950 shadow-[0_0_45px_rgba(103,255,235,0.34)]">
                  <Bot size={26} />
                </div>
                <h1 className="text-balance text-3xl font-semibold tracking-[-0.03em] md:text-4xl">What can I help with?</h1>
                <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-white/48">One AI workspace for research, creation, code, and agents.</p>
                <div className="mx-auto mt-6 grid max-w-2xl gap-2 sm:grid-cols-2">
                  {starters.map((starter) => (
                    <button className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-left text-sm text-white/72 transition hover:border-cyan-200/30 hover:bg-cyan-200/[0.06] hover:text-white" key={starter} onClick={() => setInput(starter)}>
                      {starter}
                    </button>
                  ))}
                </div>
                <div className="mx-auto mt-6 grid max-w-2xl gap-2 md:grid-cols-3">
                  {gems.filter((gem) => gem.id !== DEFAULT_GEM).map((gem) => (
                    <button key={gem.id} className={cn("rounded-2xl border p-3 text-left text-sm transition", activeGemId === gem.id ? "border-cyan-200/40 bg-cyan-200/[0.08]" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]")} onClick={() => selectGem(gem.id)}>
                      <span className="mb-2 flex items-center gap-2 text-cyan-100">{gem.icon}{gem.name}</span>
                      <span className="text-xs leading-5 text-white/45">{gem.description}</span>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            <div className="space-y-7">
              {activeConversation?.messages.map((message) => (
                <MessageRow
                  key={message.id}
                  message={message}
                  onRate={activeConversation && !activeConversation.isDraft ? rateActiveMessage : undefined}
                />
              ))}
              {isStreaming && (
                <div className="flex gap-4 text-sm text-white/50">
                  <Avatar role="assistant" />
                  <span>Noor is streaming...</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>
        </div>

        <div className="border-t border-white/8 bg-[#08090b]/92 px-3 py-3 backdrop-blur md:px-5 md:py-4">
          <form className="mx-auto max-w-3xl" onSubmit={sendMessage}>
            {files.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {files.map((file) => (
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs text-white/64" key={file.id}>
                    <FileText size={14} /> {file.name} <em className="not-italic text-white/36">{formatBytes(file.size)}</em>
                    <button type="button" onClick={() => setFiles((items) => items.filter((item) => item.id !== file.id))}><X size={13} /></button>
                  </span>
                ))}
              </div>
            )}
            <div className="rounded-[1.7rem] border border-white/12 bg-[#121316] p-2 shadow-[0_18px_70px_rgba(0,0,0,0.34)]">
              <textarea
                className="max-h-48 min-h-14 w-full resize-none bg-transparent px-4 py-3 text-[16px] leading-7 text-white outline-none placeholder:text-white/36"
                placeholder={`Message ${activeGem.name}`}
                rows={1}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendMessage();
                  }
                }}
              />
              <div className="flex items-center justify-between gap-2 px-2 pb-1">
                <input ref={fileInputRef} className="hidden" type="file" multiple accept=".pdf,.txt,.md,.js,.ts,.tsx,.jsx,.py,.json,.csv,image/*" onChange={onFilesSelected} />
                <div className="flex items-center gap-1">
                  <ModelPicker value={modelId} onChange={setModelId} disabled={isStreaming} />
                  <ComposerIcon icon={<Paperclip size={18} />} label="Attach" onClick={() => fileInputRef.current?.click()} />
                  <ComposerIcon icon={<Image size={18} />} label="Image" onClick={() => fileInputRef.current?.click()} />
                  <ComposerIcon icon={<Mic size={18} />} label="Voice" />
                  <ComposerIcon icon={<Archive size={18} />} label="Memory" onClick={() => setMemory((items) => [...items, `Saved note ${items.length + 1}`])} />
                </div>
                <button className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black transition hover:scale-105 disabled:bg-white/18 disabled:text-white/40" disabled={!input.trim() || isStreaming || limitReached} type="submit" aria-label="Send message">
                  <Send size={17} />
                </button>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-center gap-3 text-xs text-white/34">
              <span>Noor can make mistakes. Verify important information.</span>
              <button className="text-cyan-100 hover:underline" type="button" onClick={() => setFeedbackOpen(true)}>Feedback</button>
            </div>
          </form>
        </div>
      </section>

      {signInOpen && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4" onClick={() => setSignInOpen(false)}>
          <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#111216] p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <strong className="text-base">Sign in to Noor</strong>
              <button onClick={() => setSignInOpen(false)} aria-label="Close"><X size={18} /></button>
            </div>
            <p className="mb-5 text-sm leading-6 text-white/54">
              Sign in with Google to sync your chats across devices. You can keep using Noor as a guest without signing in.
            </p>
            <div className="flex justify-center">
              <GoogleSignInButton onSignedIn={handleSignedIn} onError={setSignInError} />
            </div>
            {signInError && <p className="mt-4 text-center text-xs leading-5 text-red-200">{signInError}</p>}
          </div>
        </div>
      )}

      {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
    </main>
  );
}

function SidebarContent({
  conversations,
  activeId,
  collapsed,
  onNewChat,
  onSelect,
  onRename,
  onDelete,
  toggleCollapsed,
}: {
  conversations: Conversation[];
  activeId: string;
  collapsed: boolean;
  onNewChat: () => void;
  onSelect: (conversation: Conversation) => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  toggleCollapsed?: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col p-3">
      <div className="flex items-center gap-2">
        {toggleCollapsed && (
          <button className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/76 transition hover:bg-white/[0.08]" onClick={toggleCollapsed} aria-label="Toggle sidebar">
            {collapsed ? <Menu size={18} /> : <PanelLeftClose size={18} />}
          </button>
        )}
        {!collapsed && (
          <button className="flex h-11 flex-1 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm font-semibold text-white/84 transition hover:bg-white/[0.08]" onClick={onNewChat}>
            <Plus size={17} /> New chat
          </button>
        )}
      </div>

      <div className="mt-3 grid gap-1">
        <SidebarAction icon={<Search size={17} />} label="Search chats" open={!collapsed} />
        <SidebarAction icon={<LayoutGrid size={17} />} label="Projects" open={!collapsed} />
        <SidebarAction icon={<Sparkles size={17} />} label="Gems" open={!collapsed} />
        <Link
          href="/memory"
          className={cn(
            "flex h-10 items-center gap-3 rounded-xl px-3 text-sm text-white/70 transition hover:bg-white/[0.06] hover:text-white",
            collapsed && "justify-center px-0",
          )}
        >
          <BrainCircuit size={17} />
          {!collapsed && <span>Memory</span>}
        </Link>
        <Link
          href="/admin"
          className={cn(
            "flex h-10 items-center gap-3 rounded-xl px-3 text-sm text-white/70 transition hover:bg-white/[0.06] hover:text-white",
            collapsed && "justify-center px-0",
          )}
        >
          <ShieldCheck size={17} />
          {!collapsed && <span>Admin</span>}
        </Link>
      </div>

      <div className="mt-5 min-h-0 flex-1 overflow-hidden">
        {!collapsed && <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/36">Recent</p>}
        <div className="h-full space-y-1 overflow-y-auto pr-1">
          {conversations.map((conversation) => (
            <div className={cn("group flex items-center rounded-xl hover:bg-white/[0.06]", conversation.id === activeId && "bg-white/[0.07]")} key={conversation.id}>
              <button className={cn("flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left text-sm text-white/68 hover:text-white", collapsed && "justify-center px-0")} onClick={() => onSelect(conversation)}>
                <PenLine size={collapsed ? 17 : 15} />
                {!collapsed && <span className="truncate">{conversation.title}</span>}
              </button>
              {!collapsed && (
                <span className="hidden items-center gap-1 pr-2 group-hover:flex">
                  <button className="text-white/38 hover:text-white" onClick={() => onRename(conversation.id)}><PenLine size={13} /></button>
                  <button className="text-white/38 hover:text-red-200" onClick={() => onDelete(conversation.id)}><Trash2 size={13} /></button>
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      <Link className={cn("mt-3 flex items-center gap-3 border-t border-white/10 px-3 py-3 text-sm text-white/72 transition hover:text-white", collapsed && "justify-center px-0")} href="/">
        <Compass size={18} />
        {!collapsed && <span>Back to landing</span>}
      </Link>
    </div>
  );
}

function SidebarAction({ icon, label, open }: { icon: ReactNode; label: string; open: boolean }) {
  return (
    <button className={cn("flex h-10 items-center gap-3 rounded-xl px-3 text-sm text-white/70 transition hover:bg-white/[0.06] hover:text-white", !open && "justify-center px-0")}>
      {icon}
      {open && <span>{label}</span>}
    </button>
  );
}

function MessageRow({
  message,
  onRate,
}: {
  message: ChatMessage;
  onRate?: (messageId: string, rating: 1 | -1) => void;
}) {
  const user = message.role === "user";
  const canRate =
    !user &&
    !!onRate &&
    message.id !== "welcome" &&
    !message.id.startsWith("err") &&
    message.content.trim().length > 0;
  return (
    <motion.article className={cn("flex gap-4", user && "justify-end")} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28 }}>
      {!user && <Avatar role="assistant" />}
      <div className={cn("max-w-[min(100%,680px)] whitespace-pre-wrap rounded-3xl px-5 py-4 text-[15.5px] leading-7", user ? "bg-[#2f3033] text-white" : "bg-transparent px-0 text-white/86")}>
        {message.attachments?.length ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {message.attachments.map((file) => <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/56" key={file.id}>{file.name}</span>)}
          </div>
        ) : null}
        {message.content}
        {!user && (message.savings || canRate) && (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {message.savings && <SavingsPill savings={message.savings} />}
            {canRate && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Good response"
                  onClick={() => onRate?.(message.id, 1)}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full transition",
                    message.rating === 1
                      ? "bg-emerald-300/15 text-emerald-200"
                      : "text-white/35 hover:bg-white/[0.06] hover:text-white/70",
                  )}
                >
                  <ThumbsUp size={14} />
                </button>
                <button
                  type="button"
                  aria-label="Bad response"
                  onClick={() => onRate?.(message.id, -1)}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full transition",
                    message.rating === -1
                      ? "bg-red-500/15 text-red-300"
                      : "text-white/35 hover:bg-white/[0.06] hover:text-white/70",
                  )}
                >
                  <ThumbsDown size={14} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {user && <Avatar role="user" />}
    </motion.article>
  );
}

function Avatar({ role }: { role: MessageRole }) {
  return (
    <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", role === "assistant" ? "bg-cyan-200 text-slate-950" : "bg-white/12 text-white")}>
      {role === "assistant" ? <Bot size={17} /> : <User size={17} />}
    </div>
  );
}

function ComposerIcon({ icon, label, onClick }: { icon: ReactNode; label: string; onClick?: () => void }) {
  return (
    <button className="flex h-9 items-center gap-1 rounded-full px-3 text-sm text-white/58 transition hover:bg-white/[0.06] hover:text-white" type="button" onClick={onClick}>
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function FeedbackModal({ onClose }: { onClose: () => void }) {
  const [sent, setSent] = useState(false);
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#111216] p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <strong>Send feedback</strong>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        {sent ? (
          <p className="text-sm text-cyan-100">Thanks. Your feedback was saved locally for this prototype.</p>
        ) : (
          <>
            <textarea className="min-h-32 w-full rounded-2xl border border-white/10 bg-black/30 p-4 text-sm outline-none" placeholder="What should Noor improve before launch?" />
            <Button className="mt-3 w-full" onClick={() => setSent(true)}>Submit feedback</Button>
          </>
        )}
      </div>
    </div>
  );
}
