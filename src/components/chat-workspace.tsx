"use client";

import {
  ArrowUp,
  BarChart3,
  Bot,
  ChevronRight,
  Database,
  PanelRightOpen,
  Square,
  X
} from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useRef,
  useState
} from "react";
import { CHAT_SUGGESTIONS, PIPELINE_STAGES } from "@/lib/constants";
import {
  buildChatHistory,
  chatErrorMessage,
  visibleNarrative
} from "@/lib/chat/ui";
import { streamSSE } from "@/lib/sse-client";
import type {
  ChatAnswer,
  ChatTurn,
  PipelineStage
} from "@/lib/types";
import { ChatMarkdown } from "./chat-markdown";
import { ChartRenderer } from "./chart-renderer";

function EvidencePanel({
  answer,
  width,
  isModal,
  onClose,
  onResizeStart,
  onResizeKeyboard
}: {
  answer: ChatTurn;
  width: number;
  isModal: boolean;
  onClose: () => void;
  onResizeStart: (event: ReactMouseEvent) => void;
  onResizeKeyboard: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}) {
  const evidence = answer.evidence;

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (!isModal || event.key !== "Tab") return;

    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <aside
      id="evidence-panel"
      className="evidence-panel"
      style={isModal ? undefined : { width }}
      role={isModal ? "dialog" : "complementary"}
      aria-modal={isModal || undefined}
      aria-label="Evidens og diagram"
      onKeyDown={handleKeyDown}
    >
      <div
        className="resize-handle"
        role="separator"
        aria-label="Endre bredden på evidenspanelet"
        aria-orientation="vertical"
        aria-valuemin={540}
        aria-valuemax={960}
        aria-valuenow={width}
        tabIndex={isModal ? -1 : 0}
        onKeyDown={onResizeKeyboard}
        onMouseDown={onResizeStart}
      />
      <div className="flex h-14 items-center justify-between border-b border-[var(--border)] px-4">
        <div>
          <p className="font-semibold">Evidens</p>
          <p className="text-xs text-[var(--muted)]">
            Tallgrunnlag og spørring
          </p>
        </div>
        <button
          className="secondary-button h-9 w-9 p-0"
          type="button"
          aria-label="Lukk evidenspanelet"
          autoFocus={isModal}
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      <div className="h-[calc(100%-56px)] space-y-4 overflow-y-auto p-4">
        {answer.chart && <ChartRenderer spec={answer.chart} />}
        {evidence && (
          <>
            <section className="card p-4">
              <div className="mb-3 flex items-center gap-2">
                <Database size={16} className="text-[var(--brand)]" />
                <h3 className="font-semibold">Datagrunnlag</h3>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="muted text-xs">Datasetversjon</dt>
                  <dd className="mt-1 font-medium">{evidence.datasetVersion}</dd>
                </div>
                <div>
                  <dt className="muted text-xs">Resultatrader</dt>
                  <dd className="mt-1 font-medium">{evidence.rowCount}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="muted text-xs">Generert</dt>
                  <dd className="mt-1 font-medium">
                    {new Date(evidence.generatedAt).toLocaleString("nb-NO")}
                  </dd>
                </div>
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                {evidence.tables.map((table) => (
                  <span className="pill" key={table}>
                    {table}
                  </span>
                ))}
              </div>
            </section>
            <section className="card p-4">
              <h3 className="mb-3 font-semibold">Sikker SQL</h3>
              <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl bg-[#f4f6f7] p-3 text-xs leading-5">
                {evidence.sql}
              </pre>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}

export function ChatWorkspace() {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<PipelineStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [panelWidth, setPanelWidth] = useState(680);
  const [compactEvidence, setCompactEvidence] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const conversationEnd = useRef<HTMLDivElement | null>(null);
  const conversationScroll = useRef<HTMLDivElement | null>(null);
  const autoScroll = useRef(true);
  const evidenceTrigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (autoScroll.current) {
      conversationEnd.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [turns, stage]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1100px)");
    const update = () => setCompactEvidence(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => () => controller.current?.abort(), []);

  const currentAnswer =
    selectedAnswer === null ? undefined : turns[selectedAnswer];
  const latestEvidenceIndex = turns.findLastIndex(
    (turn) => turn.role === "assistant" && Boolean(turn.evidence || turn.chart)
  );

  function openEvidence(index: number, trigger: HTMLButtonElement) {
    evidenceTrigger.current = trigger;
    setSelectedAnswer(index);
  }

  function closeEvidence() {
    setSelectedAnswer(null);
    window.requestAnimationFrame(() => evidenceTrigger.current?.focus());
  }

  useEffect(() => {
    if (selectedAnswer === null) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setSelectedAnswer(null);
      window.requestAnimationFrame(() => evidenceTrigger.current?.focus());
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [selectedAnswer]);

  function startResize(event: ReactMouseEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panelWidth;
    const move = (moveEvent: MouseEvent) => {
      setPanelWidth(
        Math.max(540, Math.min(960, startWidth + startX - moveEvent.clientX))
      );
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  function resizeWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? 24 : -24;
    setPanelWidth((current) => Math.max(540, Math.min(960, current + delta)));
  }

  async function submit(value = question) {
    const trimmed = value.trim();
    if (!trimmed || loading) return;
    setError(null);
    setQuestion("");
    setLoading(true);
    setStage("schema");
    autoScroll.current = true;
    const history = buildChatHistory(turns);
    const assistantIndex = turns.length + 1;
    setTurns((existing) => [
      ...existing,
      { role: "user", content: trimmed },
      { role: "assistant", content: "" }
    ]);
    const abortController = new AbortController();
    controller.current = abortController;

    await streamSSE<ChatAnswer>(
      "/api/chat",
      { question: trimmed, history },
      {
        signal: abortController.signal,
        onStage: setStage,
        onDelta: (_delta, accumulated) => {
          setTurns((existing) =>
            existing.map((turn, index) =>
              index === assistantIndex
                ? { ...turn, content: visibleNarrative(accumulated) }
                : turn
            )
          );
        },
        onDone: (event) => {
          if (event.ok) {
            setTurns((existing) =>
              existing.map((turn, index) =>
                index === assistantIndex
                  ? {
                      role: "assistant",
                      content: event.result.answer,
                      chart: event.result.chart,
                      evidence: event.result.evidence,
                      followUps: event.result.followUps
                    }
                  : turn
              )
            );
            if (
              !compactEvidence &&
              (event.result.chart || event.result.evidence)
            ) {
              setSelectedAnswer(assistantIndex);
            }
          } else {
            setError(chatErrorMessage(new Error(event.error)));
            setTurns((existing) =>
              existing.filter(
                (turn, index) => index !== assistantIndex || turn.content
              )
            );
          }
          controller.current = null;
          setLoading(false);
          setStage(null);
        },
        onError: (streamError) => {
          if (!abortController.signal.aborted) {
            setError(chatErrorMessage(streamError));
          }
          setTurns((existing) =>
            existing.filter(
              (turn, index) => index !== assistantIndex || turn.content
            )
          );
          controller.current = null;
          setLoading(false);
          setStage(null);
        }
      }
    );
  }

  function stop() {
    controller.current?.abort();
    controller.current = null;
    setTurns((existing) => {
      const last = existing.at(-1);
      return last?.role === "assistant" && !last.content
        ? existing.slice(0, -1)
        : existing;
    });
    setLoading(false);
    setStage(null);
  }

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      <section className="flex min-w-0 flex-1 flex-col">
        {turns.length === 0 ? (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-5 py-10">
            <div className="w-full max-w-[896px] text-center">
              <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]">
                <Bot size={25} />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Spør på tvers av Norautron-dataene
              </h1>
              <p className="mx-auto mt-2 max-w-xl text-[var(--muted)]">
                Analyser produksjon, ERP-salg, CRM-pipeline, kvalitet og
                forsyning med verifiserbare tall.
              </p>
              <div className="mx-auto mt-8 grid max-w-3xl gap-3 text-left sm:grid-cols-2">
                {CHAT_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="card flex items-start justify-between gap-4 p-4 text-left transition-colors hover:border-[#9ca3af]"
                    onClick={() => void submit(suggestion)}
                  >
                    <span>{suggestion}</span>
                    <ChevronRight
                      size={17}
                      className="mt-0.5 shrink-0 text-[var(--brand)]"
                    />
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div
            ref={conversationScroll}
            className="min-h-0 flex-1 overflow-y-auto px-4 py-8"
            onScroll={() => {
              const area = conversationScroll.current;
              if (!area) return;
              autoScroll.current =
                area.scrollHeight - area.scrollTop - area.clientHeight < 96;
            }}
          >
            <div className="mx-auto max-w-[768px] space-y-7">
              {turns.map((turn, index) => (
                <article
                  key={index}
                  className={
                    turn.role === "user"
                      ? "ml-auto max-w-[85%] rounded-2xl bg-[#edeeee] px-4 py-3"
                      : "group"
                  }
                >
                  {turn.role === "assistant" ? (
                    <>
                      <ChatMarkdown>{turn.content || " "}</ChatMarkdown>
                      {(turn.evidence || turn.chart) && (
                        <button
                          type="button"
                          className="secondary-button mt-3 px-3"
                          aria-controls="evidence-panel"
                          aria-expanded={selectedAnswer === index}
                          onClick={(event) => openEvidence(index, event.currentTarget)}
                        >
                          <BarChart3 size={15} />
                          Vis evidens
                        </button>
                      )}
                      {turn.followUps?.length ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {turn.followUps.map((followUp) => (
                            <button
                              type="button"
                              className="pill border border-transparent hover:border-[var(--brand)]"
                              key={followUp}
                              onClick={() => void submit(followUp)}
                            >
                              {followUp}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    turn.content
                  )}
                </article>
              ))}
              {loading && stage && (
                <div className="card p-4" role="status" aria-live="polite">
                  <p className="mb-3 text-sm font-semibold">Analyserer</p>
                  <div className="grid gap-2">
                    {PIPELINE_STAGES.map((item) => {
                      const currentIndex = PIPELINE_STAGES.findIndex(
                        (entry) => entry.id === stage
                      );
                      const itemIndex = PIPELINE_STAGES.findIndex(
                        (entry) => entry.id === item.id
                      );
                      return (
                        <div
                          className={`flex items-center gap-2 text-xs ${
                            itemIndex <= currentIndex
                              ? "text-[var(--charcoal)]"
                              : "text-[#9ca3af]"
                          }`}
                          key={item.id}
                        >
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${
                              itemIndex < currentIndex
                                ? "bg-[var(--brand)]"
                                : itemIndex === currentIndex
                                  ? "animate-pulse border-2 border-[var(--brand)]"
                                  : "bg-[#e5e7eb]"
                            }`}
                          />
                          {item.label}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <div ref={conversationEnd} />
            </div>
          </div>
        )}

        <div className="border-t border-[var(--border)] bg-white px-4 py-3">
          <div className="mx-auto max-w-[896px]">
            {error && (
              <div
                className="mb-3 flex items-center justify-between rounded-xl bg-[#fee2e2] px-3 py-2 text-sm text-[#991b1b]"
                role="alert"
              >
                <span>{error}</span>
                <button
                  type="button"
                  aria-label="Lukk feilmelding"
                  onClick={() => setError(null)}
                >
                  <X size={16} />
                </button>
              </div>
            )}
            <div className="chat-composer flex items-end gap-3 rounded-2xl border-2 border-[#394246] bg-white p-2 focus-within:border-[var(--brand)]">
              <textarea
                aria-label="Spør om dataene"
                className="max-h-36 min-h-10 flex-1 resize-none border-0 px-2 py-2 outline-none"
                placeholder="Spør om salg, produksjon, kvalitet eller forsyning ..."
                rows={1}
                maxLength={1200}
                value={question}
                disabled={loading}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submit();
                  }
                }}
              />
              {loading ? (
                <button
                  type="button"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-[#282d2f] text-white"
                  aria-label="Stopp generering"
                  onClick={stop}
                >
                  <Square size={15} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="button"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--brand)] text-white disabled:bg-[#d1d5db]"
                  aria-label="Send spørsmål"
                  disabled={!question.trim()}
                  title={
                    question.trim()
                      ? "Send spørsmål"
                      : "Skriv et spørsmål før du sender"
                  }
                  onClick={() => void submit()}
                >
                  <ArrowUp size={18} />
                </button>
              )}
            </div>
            <p className="mt-2 text-center text-[11px] text-[var(--muted)]">
              Modellen kan ta feil. Kontroller alltid evidens og datasetversjon.
            </p>
          </div>
        </div>
      </section>

      {currentAnswer ? (
        <EvidencePanel
          answer={currentAnswer}
          width={panelWidth}
          isModal={compactEvidence}
          onClose={closeEvidence}
          onResizeStart={startResize}
          onResizeKeyboard={resizeWithKeyboard}
        />
      ) : (
        turns.length > 0 && (
          <button
            type="button"
            className="absolute right-4 top-4 z-10 secondary-button px-3"
            aria-controls="evidence-panel"
            aria-expanded={false}
            disabled={latestEvidenceIndex < 0}
            title={
              latestEvidenceIndex < 0
                ? "Evidens blir tilgjengelig etter en fullført analyse"
                : "Åpne evidens"
            }
            onClick={(event) => {
              if (latestEvidenceIndex >= 0) {
                openEvidence(latestEvidenceIndex, event.currentTarget);
              }
            }}
          >
            <PanelRightOpen size={16} />
            Evidens
          </button>
        )
      )}
    </div>
  );
}
