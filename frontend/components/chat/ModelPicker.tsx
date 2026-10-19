"use client";

// Model picker + BYOK key manager.
//
// "Noor Auto" is the default: routed + semantically cached, free for the user.
// Anything else needs the user's own provider key, which is sent once over
// HTTPS, verified against the provider, then stored encrypted — the UI only ever
// sees a masked hint afterwards.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, KeyRound, Loader2, ShieldCheck, Trash2, X } from "lucide-react";

import {
  ByokKey,
  ByokProviderInfo,
  ModelInfo,
  deleteByokKey,
  fetchByokKeys,
  fetchModels,
  saveByokKey,
  testByokKey,
} from "@/lib/api";

const DEFAULT_MODEL = "noor-auto";

export function ModelPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [keysOpen, setKeysOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const catalog = await fetchModels();
      setModels(catalog.models);
    } catch {
      // Offline or backend down: the picker still offers the default.
      setModels([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = useMemo(
    () => models.find((model) => model.id === value) ?? null,
    [models, value],
  );

  const label = active?.label ?? (value === DEFAULT_MODEL ? "Noor Auto" : value);
  const byok = value !== DEFAULT_MODEL;

  const grouped = useMemo(() => {
    const groups = new Map<string, ModelInfo[]>();
    for (const model of models) {
      const key = model.provider_label;
      groups.set(key, [...(groups.get(key) ?? []), model]);
    }
    return [...groups.entries()];
  }, [models]);

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((state) => !state)}
        className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/[0.08] disabled:opacity-40"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {byok ? <KeyRound size={13} className="text-cyan-200" /> : null}
        <span className="max-w-[11rem] truncate">{label}</span>
        <ChevronDown size={13} className="opacity-60" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-11 left-0 z-50 max-h-96 w-80 overflow-y-auto rounded-2xl border border-white/10 bg-[#121316] p-2 shadow-2xl">
            <div className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-white/35">
              Routed by Noor
            </div>
            {models
              .filter((model) => !model.requires_key)
              .map((model) => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => {
                    onChange(model.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-xl px-2 py-2 text-left text-sm hover:bg-white/[0.06]"
                >
                  <span>
                    <span className="block">{model.label}</span>
                    <span className="block text-[11px] text-white/40">
                      Free · semantic cache · best for most chats
                    </span>
                  </span>
                  {model.id === value && <Check size={14} className="text-cyan-200" />}
                </button>
              ))}

            {grouped
              .filter(([, items]) => items.some((item) => item.requires_key))
              .map(([providerLabel, items]) => (
                <div key={providerLabel}>
                  <div className="mt-2 px-2 py-1.5 text-[11px] uppercase tracking-wide text-white/35">
                    {providerLabel}
                  </div>
                  {items
                    .filter((item) => item.requires_key)
                    .map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          if (!item.available) {
                            setOpen(false);
                            setKeysOpen(true);
                            return;
                          }
                          onChange(item.id);
                          setOpen(false);
                        }}
                        className="flex w-full items-center justify-between gap-2 rounded-xl px-2 py-2 text-left text-sm hover:bg-white/[0.06]"
                      >
                        <span>
                          <span className="block">{item.label}</span>
                          <span className="block text-[11px] text-white/40">
                            {item.available ? "Your key · no Noor cost" : "Add your API key to use"}
                          </span>
                        </span>
                        {item.id === value ? (
                          <Check size={14} className="text-cyan-200" />
                        ) : !item.available ? (
                          <KeyRound size={14} className="text-amber-200/70" />
                        ) : null}
                      </button>
                    ))}
                </div>
              ))}

            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setKeysOpen(true);
              }}
              className="mt-2 flex w-full items-center gap-2 rounded-xl border border-white/10 px-2 py-2 text-xs text-white/70 hover:bg-white/[0.06]"
            >
              <KeyRound size={14} /> Manage API keys
            </button>
          </div>
        </>
      )}

      <ApiKeysDialog
        open={keysOpen}
        onClose={() => setKeysOpen(false)}
        onChanged={() => {
          void load();
        }}
      />
    </div>
  );
}

function ApiKeysDialog({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [providers, setProviders] = useState<ByokProviderInfo[]>([]);
  const [keys, setKeys] = useState<ByokKey[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchByokKeys();
      setProviders(data.providers);
      setKeys(data.keys);
    } catch {
      setNotice({ ok: false, text: "Could not load API keys. Is the backend running?" });
    }
  }, []);

  useEffect(() => {
    if (open) {
      setNotice(null);
      void load();
    }
  }, [open, load]);

  if (!open) return null;

  const keyFor = (provider: string) => keys.find((key) => key.provider === provider) ?? null;

  async function handleSave(provider: string) {
    const apiKey = (draft[provider] ?? "").trim();
    if (!apiKey) return;
    setBusy(provider);
    setNotice(null);
    try {
      const saved = await saveByokKey(provider, apiKey);
      setDraft((state) => ({ ...state, [provider]: "" }));
      setNotice({ ok: true, text: saved.message ?? "Key saved." });
      await load();
      onChanged();
    } catch (error) {
      setNotice({ ok: false, text: error instanceof Error ? error.message : "Could not save key." });
    } finally {
      setBusy(null);
    }
  }

  async function handleTest(provider: string) {
    setBusy(provider);
    try {
      const result = await testByokKey(provider);
      setNotice({ ok: result.ok, text: result.message });
    } catch (error) {
      setNotice({ ok: false, text: error instanceof Error ? error.message : "Test failed." });
    } finally {
      setBusy(null);
    }
  }

  async function handleRemove(provider: string) {
    setBusy(provider);
    try {
      await deleteByokKey(provider);
      setNotice({ ok: true, text: "Key removed." });
      await load();
      onChanged();
    } catch (error) {
      setNotice({ ok: false, text: error instanceof Error ? error.message : "Could not remove key." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="max-h-[86vh] w-full max-w-xl overflow-y-auto rounded-3xl border border-white/10 bg-[#111216] p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <KeyRound size={16} className="text-cyan-200" /> Your API keys
            </h2>
            <p className="mt-1 text-xs leading-5 text-white/45">
              Use Claude, GPT, Gemini and more on your own account. Keys are verified, encrypted
              with AES-256-GCM and never shown again. Noor only sends them to the provider you chose.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-white/50 hover:bg-white/10">
            <X size={16} />
          </button>
        </div>

        {notice && (
          <div
            className={`mb-3 rounded-xl border px-3 py-2 text-xs ${
              notice.ok
                ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-100"
                : "border-rose-400/25 bg-rose-400/10 text-rose-100"
            }`}
          >
            {notice.text}
          </div>
        )}

        <div className="space-y-3">
          {providers.map((provider) => {
            const stored = keyFor(provider.id);
            const isBusy = busy === provider.id;
            return (
              <div key={provider.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-medium">{provider.label}</span>
                    {stored ? (
                      <span className="ml-2 rounded-full border border-emerald-400/30 px-2 py-0.5 text-[10px] text-emerald-200">
                        {stored.hint}
                      </span>
                    ) : null}
                  </div>
                  <a
                    href={provider.docs_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-[11px] text-cyan-200/80 hover:underline"
                  >
                    Get a key
                  </a>
                </div>

                {stored ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="flex items-center gap-1 text-[11px] text-white/45">
                      <ShieldCheck size={13} className="text-emerald-300" /> stored encrypted
                      {stored.model ? ` · ${stored.model}` : ""}
                    </span>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleTest(provider.id)}
                      className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] hover:bg-white/10 disabled:opacity-40"
                    >
                      Test
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleRemove(provider.id)}
                      className="flex items-center gap-1 rounded-full border border-rose-400/25 px-2.5 py-1 text-[11px] text-rose-200 hover:bg-rose-400/10 disabled:opacity-40"
                    >
                      <Trash2 size={12} /> Remove
                    </button>
                    {isBusy && <Loader2 size={13} className="animate-spin text-white/40" />}
                  </div>
                ) : (
                  <div className="mt-2 flex gap-2">
                    <input
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={`${provider.label} API key`}
                      value={draft[provider.id] ?? ""}
                      onChange={(event) =>
                        setDraft((state) => ({ ...state, [provider.id]: event.target.value }))
                      }
                      className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none placeholder:text-white/30 focus:border-cyan-300/40"
                    />
                    <button
                      type="button"
                      disabled={isBusy || !(draft[provider.id] ?? "").trim()}
                      onClick={() => handleSave(provider.id)}
                      className="flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-medium text-black disabled:bg-white/20 disabled:text-white/50"
                    >
                      {isBusy && <Loader2 size={12} className="animate-spin" />} Save
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
