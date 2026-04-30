import { useState, useRef, useEffect } from "react";
import { BotMessageSquare, X, Send, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { projectDocsApi, type AskResult } from "../api/projectDocs";
import { MarkdownBody } from "./MarkdownBody";
import { Button } from "@/components/ui/button";

interface ProjectAskAIProps {
  companyId: string;
  projectId: string;
}

type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; sources: AskResult["sources"]; isOllamaUnavailable: boolean };

function SourcesCollapsible({ sources }: { sources: AskResult["sources"] }) {
  const [open, setOpen] = useState(false);

  if (!sources || sources.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {sources.length} source{sources.length !== 1 ? "s" : ""}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {sources.map((src, i) => (
            <div key={i} className="rounded border border-border bg-accent/40 p-2 text-xs">
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-[10px] text-muted-foreground">{src.documentId}</span>
                <span className="text-muted-foreground">{Math.round(src.score * 100)}%</span>
              </div>
              <p className="text-foreground/80 leading-relaxed">{src.chunkText}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProjectAskAI({ companyId, projectId }: ProjectAskAIProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, open]);

  useEffect(() => {
    if (open) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [open]);

  const MAX_MESSAGES = 20;

  const handleSend = async () => {
    const question = input.trim();
    if (!question || loading) return;

    setInput("");
    setMessages((prev) => {
      const next = [...prev, { role: "user" as const, content: question }];
      return next.slice(-MAX_MESSAGES);
    });
    setLoading(true);

    try {
      const result = await projectDocsApi.ask(companyId, projectId, question);
      const isOllamaUnavailable = result.answer.includes("unavailable");
      setMessages((prev) => {
        const next = [
          ...prev,
          {
            role: "assistant" as const,
            content: result.answer,
            // Only keep top-3 sources, truncate chunkText to save memory
            sources: (result.sources ?? []).slice(0, 3).map((s) => ({
              ...s,
              chunkText: s.chunkText ? s.chunkText.slice(0, 300) : "",
            })),
            isOllamaUnavailable,
          },
        ];
        return next.slice(-MAX_MESSAGES);
      });
    } catch {
      setMessages((prev) => {
        const next = [
          ...prev,
          {
            role: "assistant" as const,
            content: "Sorry, something went wrong. Please try again.",
            sources: [],
            isOllamaUnavailable: false,
          },
        ];
        return next.slice(-MAX_MESSAGES);
      });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* Trigger button */}
      <div className="fixed bottom-6 right-6 z-50">
        <Button
          onClick={() => { setOpen(true); }}
          className="flex items-center gap-2 shadow-lg"
          size="sm"
        >
          <BotMessageSquare className="h-4 w-4" />
          Ask AI
        </Button>
      </div>

      {/* Slide-in panel */}
      {open && (
        <>
          {/* Backdrop (mobile) */}
          <div
            className="fixed inset-0 z-40 bg-black/20 sm:hidden"
            onClick={() => setOpen(false)}
          />

          {/* Panel */}
          <div className="fixed right-0 top-0 bottom-0 z-50 flex flex-col w-[420px] max-w-full bg-background border-l border-border shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <BotMessageSquare className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Ask AI about this project</span>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <button
                    onClick={() => setMessages([])}
                    className="rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    Clear
                  </button>
                )}
                <button
                  onClick={() => { setOpen(false); setMessages([]); }}
                  className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  aria-label="Close panel"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {messages.length === 0 && (
                <p className="text-sm text-muted-foreground text-center mt-8">
                  Ask anything about this project. Answers are grounded in project documents.
                </p>
              )}

              {messages.map((msg, i) => {
                if (msg.role === "user") {
                  return (
                    <div key={i} className="flex justify-end">
                      <div className="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
                        {msg.content}
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={i} className="flex justify-start">
                    <div className="max-w-[90%]">
                      <div
                        className={`rounded-lg border px-3 py-2 text-sm ${
                          msg.isOllamaUnavailable
                            ? "border-orange-500/40 bg-orange-500/10 text-orange-300"
                            : "border-border bg-accent/30 text-foreground"
                        }`}
                      >
                        <MarkdownBody className="text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                          {msg.content}
                        </MarkdownBody>
                      </div>
                      <SourcesCollapsible sources={msg.sources} />
                    </div>
                  </div>
                );
              })}

              {loading && (
                <div className="flex justify-start">
                  <div className="rounded-lg border border-border bg-accent/30 px-3 py-2">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="border-t border-border px-4 py-3">
              <div className="flex items-end gap-2">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask a question... (Enter to send)"
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <Button
                  size="sm"
                  onClick={handleSend}
                  disabled={loading || !input.trim()}
                  className="shrink-0 self-end"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
