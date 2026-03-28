"use client";

import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import ReactMarkdown from "react-markdown";

const SUGGESTIONS = [
  // Needs browsing
  "What's the latest on Iran oil sanctions?",
  "Find flights from Dubai to London tomorrow",
  "What happened in Ukraine today?",
  "Find the cheapest iPhone 16 Pro right now",
  "Book me a hotel in Zurich under $200 tonight",
  // Can answer from MERIDIAN
  "What's the current MERIDIAN threat level?",
  "Which stocks are predicted to move today?",
  "Are there any flights over Iran right now?",
  "What's the oil disruption risk today?",
  "Which countries have the highest regime instability?",
];

const MONO = "var(--font-geist-mono), 'JetBrains Mono', monospace";
const SANS = "var(--font-geist-sans), 'Inter', sans-serif";

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function fetchMeridianContext(): Promise<string> {
  try {
    const res = await fetch("http://localhost:3117/api/data", {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return "";
    const data = await res.json();

    const lines: string[] = [];
    if (data.meridian?.meridianScore != null)
      lines.push(`MERIDIAN Score: ${data.meridian.meridianScore}/100`);
    if (data.meridian?.oilScore != null)
      lines.push(`Oil Disruption: ${data.meridian.oilScore}/100`);
    if (data.meridian?.defenseScore != null)
      lines.push(`Defense Escalation: ${data.meridian.defenseScore}/100`);
    if (data.opensky?.states?.length)
      lines.push(`Aircraft tracked: ${data.opensky.states.length}`);
    if (data.acled?.totalEvents)
      lines.push(`Conflict events: ${data.acled.totalEvents}`);
    if (data.energy?.wti)
      lines.push(`WTI Oil: $${data.energy.wti}`);
    if (data.energy?.brent)
      lines.push(`Brent Oil: $${data.energy.brent}`);
    if (data.browseruse?.findings?.length)
      lines.push(`HUMINT signals: ${data.browseruse.findings.length}`);

    const chain = data.meridian?.causalChain ?? [];
    if (chain.length > 0) {
      lines.push(
        "\nTop signals:",
        ...chain
          .slice(0, 5)
          .map(
            (s: { source: string; text: string }) =>
              `- ${s.source}: ${s.text}`
          )
      );
    }

    const preds = data.meridian?.predictions ?? [];
    if (preds.length > 0) {
      lines.push(
        "\nTop predictions:",
        ...preds
          .slice(0, 5)
          .map(
            (p: {
              ticker: string;
              direction: string;
              magnitude: number;
              confidence: number;
            }) =>
              `- ${p.ticker}: ${p.direction} ${p.magnitude}% (${p.confidence}% conf)`
          )
      );
    }

    const findings = data.browseruse?.findings ?? [];
    if (findings.length > 0) {
      lines.push(
        "\nRecent HUMINT:",
        ...findings
          .slice(0, 3)
          .map(
            (f: { source: string; headline: string }) =>
              `- ${f.source}: ${f.headline}`
          )
      );
    }

    const articles = data.gdelt?.articles ?? [];
    if (articles.length > 0) {
      lines.push(
        "\nBreaking news:",
        ...articles
          .slice(0, 3)
          .map((a: { title: string }) => `- ${a.title}`)
      );
    }

    return lines.join("\n");
  } catch {
    return "";
  }
}

// Markdown component renderers for dark theme
const mdComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1
      style={{
        fontSize: 18,
        fontWeight: 700,
        color: "white",
        margin: "0 0 12px",
      }}
    >
      {children}
    </h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2
      style={{
        fontSize: 16,
        fontWeight: 600,
        color: "white",
        margin: "12px 0 8px",
      }}
    >
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3
      style={{
        fontSize: 14,
        fontWeight: 600,
        color: "#ccc",
        margin: "10px 0 6px",
      }}
    >
      {children}
    </h3>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p style={{ margin: "0 0 10px", lineHeight: 1.7 }}>{children}</p>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong style={{ color: "white", fontWeight: 600 }}>{children}</strong>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul style={{ paddingLeft: 20, margin: "0 0 10px" }}>{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol style={{ paddingLeft: 20, margin: "0 0 10px" }}>{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li style={{ marginBottom: 4 }}>{children}</li>
  ),
  code: ({ children }: { children?: React.ReactNode }) => (
    <code
      style={{
        background: "#1a1a1a",
        padding: "2px 6px",
        borderRadius: 4,
        fontSize: 12,
        fontFamily: MONO,
      }}
    >
      {children}
    </code>
  ),
  a: ({
    href,
    children,
  }: {
    href?: string;
    children?: React.ReactNode;
  }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: "#60a5fa", textDecoration: "none" }}
    >
      {children}
    </a>
  ),
};

export default function AriaChat() {
  const [conversationId, setConversationId] =
    useState<Id<"ariaConversations"> | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const createConversation = useMutation(api.aria.createConversation);
  const sendMessage = useMutation(api.aria.sendMessage);
  const messages = useQuery(
    api.aria.getMessages,
    conversationId ? { conversationId } : "skip"
  );

  const isAgentRunning = messages?.some(
    (m) =>
      m.role === "assistant" &&
      (m.status === "thinking" || m.status === "browsing")
  );

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, [conversationId]);

  const handleSend = async (text?: string) => {
    const content = (text || input).trim();
    if (!content || sending || isAgentRunning) return;
    setSending(true);

    try {
      let convId = conversationId;
      if (!convId) {
        convId = await createConversation();
        setConversationId(convId);
      }
      // Fetch MERIDIAN context for Claude's decision
      const meridianContext = await fetchMeridianContext();
      await sendMessage({
        conversationId: convId,
        content,
        meridianContext: meridianContext || undefined,
      });
      setInput("");
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      style={{
        height: "100vh",
        background: "#0a0a0a",
        color: "white",
        display: "flex",
        flexDirection: "column",
        fontFamily: SANS,
      }}
    >
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes globe-pulse { 0%,100%{transform:scale(1);opacity:0.6} 50%{transform:scale(1.1);opacity:1} }
        @keyframes fade-in { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
        @keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-6px)} }
        .msg-enter { animation: fade-in 0.3s ease; }
        .suggestion:hover { background: #1a1a1a !important; border-color: #333 !important; }
        .send-btn:hover:not(:disabled) { background: #3b82f6 !important; }
        textarea::placeholder { color: #555; }
        textarea:focus { outline: none; }
        .screenshot-badge {
          position:absolute;top:8px;left:8px;background:rgba(37,99,235,0.9);
          color:white;font-size:9px;font-weight:700;padding:2px 8px;
          border-radius:4px;font-family:${MONO};letter-spacing:0.5px;
        }
      `}</style>

      {/* HEADER */}
      <header
        style={{
          padding: "0 24px",
          height: 52,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid #1a1a1a",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 18 }}>🌐</span>
          <span
            style={{ fontSize: 16, fontWeight: 700, letterSpacing: -0.3 }}
          >
            ARIA
          </span>
          <span
            style={{
              fontSize: 9,
              color: "#555",
              fontFamily: MONO,
              letterSpacing: 1.5,
              textTransform: "uppercase",
            }}
          >
            Autonomous Intelligence Agent
          </span>
        </div>
        <a
          href="http://localhost:3117"
          style={{
            fontSize: 11,
            color: "#555",
            textDecoration: "none",
            fontFamily: MONO,
            transition: "color 0.15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#888")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#555")}
        >
          ← MERIDIAN
        </a>
      </header>

      {/* MESSAGES AREA */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "24px 0",
          position: "relative",
        }}
      >
        {/* EMPTY STATE */}
        {!messages || messages.length === 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              padding: "0 32px",
            }}
          >
            <div
              style={{
                fontSize: 48,
                marginBottom: 24,
                animation: "globe-pulse 3s ease-in-out infinite",
              }}
            >
              🌐
            </div>
            <h1
              style={{
                fontSize: 32,
                fontWeight: 700,
                letterSpacing: -0.5,
                marginBottom: 8,
              }}
            >
              Ask me anything.
            </h1>
            <p
              style={{
                fontSize: 15,
                color: "#555",
                marginBottom: 40,
                textAlign: "center",
                maxWidth: 480,
              }}
            >
              I can answer from live MERIDIAN intelligence data or browse the
              web in real time to find what you need.
            </p>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                justifyContent: "center",
                maxWidth: 640,
              }}
            >
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  className="suggestion"
                  onClick={() => handleSend(s)}
                  style={{
                    background: "#111",
                    border: "1px solid #1a1a1a",
                    borderRadius: 8,
                    padding: "8px 14px",
                    fontSize: 13,
                    color: "#888",
                    cursor: "pointer",
                    fontFamily: SANS,
                    transition: "all 0.15s",
                    textAlign: "left",
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div
            style={{ maxWidth: 720, margin: "0 auto", padding: "0 24px" }}
          >
            {messages.map((msg) => (
              <div
                key={msg._id}
                className="msg-enter"
                style={{
                  marginBottom: 20,
                  display: "flex",
                  flexDirection: "column",
                  alignItems:
                    msg.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                {/* USER MESSAGE */}
                {msg.role === "user" && (
                  <div
                    style={{
                      background: "#1a1a1a",
                      borderRadius: "16px 16px 4px 16px",
                      padding: "12px 16px",
                      maxWidth: "80%",
                      fontSize: 14,
                      lineHeight: 1.6,
                    }}
                  >
                    {msg.content}
                    <div
                      style={{
                        fontSize: 10,
                        color: "#444",
                        marginTop: 4,
                        fontFamily: MONO,
                      }}
                    >
                      {formatTime(msg.createdAt)}
                    </div>
                  </div>
                )}

                {/* ASSISTANT MESSAGE */}
                {msg.role === "assistant" && (
                  <div style={{ width: "100%", maxWidth: 700 }}>
                    {/* Thinking indicator */}
                    {msg.status === "thinking" && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "12px 16px",
                          background: "#0d0d0d",
                          borderRadius: 8,
                          border: "1px solid #1a1a1a",
                          marginBottom: 12,
                        }}
                      >
                        <div style={{ display: "flex", gap: 4 }}>
                          {[0, 1, 2].map((i) => (
                            <div
                              key={i}
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                background: "#7c3aed",
                                animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                              }}
                            />
                          ))}
                        </div>
                        <span
                          style={{
                            fontSize: 12,
                            color: "#555",
                            fontFamily: MONO,
                          }}
                        >
                          ARIA is thinking...
                        </span>
                      </div>
                    )}

                    {/* Browsing indicator */}
                    {msg.status === "browsing" && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          marginBottom: 12,
                          fontSize: 13,
                          color: "#3b82f6",
                        }}
                      >
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: "#3b82f6",
                            animation: "pulse 1.5s infinite",
                            display: "inline-block",
                          }}
                        />
                        Browsing the web...
                      </div>
                    )}

                    {/* Progress log */}
                    {msg.progressEvents &&
                      msg.progressEvents.length > 0 && (
                        <div
                          style={{
                            background: "#0f0f0f",
                            border: "1px solid #1a1a1a",
                            borderRadius: 8,
                            padding: "10px 14px",
                            marginBottom: 12,
                            fontFamily: MONO,
                            fontSize: 11,
                          }}
                        >
                          {msg.progressEvents
                            .slice(-5)
                            .map((event: string, i: number) => {
                              const isLast =
                                i ===
                                Math.min(msg.progressEvents.length, 5) - 1;
                              const isActive =
                                isLast &&
                                (msg.status === "thinking" ||
                                  msg.status === "browsing");
                              return (
                                <div
                                  key={i}
                                  style={{
                                    display: "flex",
                                    gap: 8,
                                    padding: "2px 0",
                                    color: isActive ? "#3b82f6" : "#555",
                                  }}
                                >
                                  <span style={{ flexShrink: 0 }}>
                                    {isActive ? "●" : "✓"}
                                  </span>
                                  <span>{event}</span>
                                </div>
                              );
                            })}
                        </div>
                      )}

                    {/* Screenshots */}
                    {msg.screenshots && msg.screenshots.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        {msg.screenshots
                          .slice(-2)
                          .map((url: string, i: number) => (
                            <div
                              key={i}
                              style={{
                                position: "relative",
                                marginBottom: 8,
                              }}
                            >
                              <div className="screenshot-badge">
                                LIVE SCREENSHOT
                              </div>
                              <img
                                src={url}
                                alt="Agent screenshot"
                                style={{
                                  width: "100%",
                                  borderRadius: 8,
                                  border: "1px solid #1a1a1a",
                                  cursor: "pointer",
                                }}
                                onClick={() => window.open(url, "_blank")}
                              />
                            </div>
                          ))}
                      </div>
                    )}

                    {/* Result content — rendered as markdown */}
                    {msg.content && msg.status === "complete" && (
                      <div
                        style={{
                          background: "#0d0d0d",
                          border: "1px solid #1a1a1a",
                          borderRadius: 12,
                          padding: "16px 20px",
                          fontSize: 14,
                          color: "#ccc",
                          lineHeight: 1.7,
                        }}
                      >
                        <ReactMarkdown components={mdComponents}>
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    )}

                    {/* Non-complete content (fallback plain text) */}
                    {msg.content &&
                      msg.status !== "complete" &&
                      msg.status !== "thinking" && (
                        <div
                          style={{
                            background: "#111",
                            border: "1px solid #1a1a1a",
                            borderRadius: 12,
                            padding: "16px 20px",
                            fontSize: 14,
                            lineHeight: 1.7,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                          }}
                        >
                          {msg.content}
                        </div>
                      )}

                    {/* Sources */}
                    {msg.sources && msg.sources.length > 0 && (
                      <div
                        style={{
                          display: "flex",
                          gap: 6,
                          flexWrap: "wrap",
                          marginTop: 8,
                        }}
                      >
                        {msg.sources.map((src: string, i: number) => (
                          <span
                            key={i}
                            style={{
                              fontSize: 10,
                              fontFamily: MONO,
                              background: "#0f0f0f",
                              border: "1px solid #1a1a1a",
                              borderRadius: 4,
                              padding: "2px 8px",
                              color: "#555",
                            }}
                          >
                            {src}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Failed state */}
                    {msg.status === "failed" && (
                      <div
                        style={{
                          fontSize: 12,
                          color: "#ef4444",
                          fontFamily: MONO,
                          marginTop: 8,
                        }}
                      >
                        Agent failed. Try again or rephrase your request.
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* INPUT AREA */}
      <div
        style={{
          borderTop: "1px solid #1a1a1a",
          padding: "16px 24px 12px",
          flexShrink: 0,
        }}
      >
        {/* Quick suggestions when in conversation */}
        {messages && messages.length > 0 && !isAgentRunning && (
          <div
            style={{
              display: "flex",
              gap: 6,
              marginBottom: 10,
              overflowX: "auto",
              paddingBottom: 4,
            }}
          >
            {["Follow up on that", "Tell me more", "What else?"].map(
              (s) => (
                <button
                  key={s}
                  className="suggestion"
                  onClick={() => setInput(s)}
                  style={{
                    background: "#111",
                    border: "1px solid #1a1a1a",
                    borderRadius: 6,
                    padding: "4px 10px",
                    fontSize: 11,
                    color: "#555",
                    cursor: "pointer",
                    fontFamily: SANS,
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                    transition: "all 0.15s",
                  }}
                >
                  {s}
                </button>
              )
            )}
          </div>
        )}

        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-end",
            maxWidth: 720,
            margin: "0 auto",
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isAgentRunning
                ? "ARIA is working..."
                : "Ask anything — I'll use MERIDIAN data or browse the web..."
            }
            disabled={isAgentRunning}
            rows={1}
            style={{
              flex: 1,
              background: "#111",
              border: "1px solid #1a1a1a",
              borderRadius: 10,
              padding: "12px 16px",
              color: "white",
              fontFamily: SANS,
              fontSize: 14,
              resize: "none",
              minHeight: 44,
              maxHeight: 120,
              opacity: isAgentRunning ? 0.5 : 1,
            }}
          />
          <button
            className="send-btn"
            onClick={() => handleSend()}
            disabled={!input.trim() || sending || isAgentRunning}
            style={{
              background: input.trim() ? "#2563eb" : "#1a1a1a",
              border: "none",
              borderRadius: 10,
              width: 44,
              height: 44,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background 0.15s",
              opacity:
                !input.trim() || sending || isAgentRunning ? 0.4 : 1,
              flexShrink: 0,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        <div
          style={{
            textAlign: "center",
            marginTop: 8,
            fontSize: 10,
            color: "#333",
            fontFamily: MONO,
          }}
        >
          Powered by Claude · Browser Use · Convex Component
        </div>
      </div>
    </div>
  );
}
