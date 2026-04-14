import { useState, useEffect, useRef } from "react";

const SEVERITIES = { CRITICAL: "#ff2d55", HIGH: "#ff6b00", MEDIUM: "#ffd60a", LOW: "#30d158", INFO: "#0a84ff" };
const CATEGORIES = { log: "📋", metric: "📊", trace: "🔗", signal: "⚡" };

const MOCK_RUNBOOKS = [
  { id: "rb-001", name: "High CPU Remediation", trigger_tags: ["cpu", "performance"], steps: ["1. Identify top processes via `top -bn1`", "2. Check for runaway threads in APM", "3. Trigger autoscale if CPU > 90% for > 5 min", "4. Notify SRE team via #incidents Slack channel"], confidence: "HIGH" },
  { id: "rb-002", name: "Database Connection Pool Exhaustion", trigger_tags: ["db", "connection", "timeout"], steps: ["1. Check current pool usage in Supabase dashboard", "2. Kill idle connections older than 30s", "3. Increase pool_size in connection string temporarily", "4. Root cause: look for missing `await using` in C# services"], confidence: "HIGH" },
  { id: "rb-003", name: "Service Unreachable — Upstream Failure", trigger_tags: ["unreachable", "upstream", "5xx"], steps: ["1. Check upstream service health endpoint /health", "2. Validate DNS resolution and certificate expiry", "3. Enable circuit breaker if failure rate > 50%", "4. Redirect traffic to fallback region"], confidence: "MEDIUM" },
];

const MOCK_CORRELATION_RULES = [
  { id: "cr-001", name: "CPU Spike → OOM Pattern", rule_type: "SEQUENCE", window_s: 60, status: "ACTIVE" },
  { id: "cr-002", name: "Error Rate Threshold", rule_type: "THRESHOLD", window_s: 30, status: "ACTIVE" },
  { id: "cr-003", name: "Cascade Failure Topology", rule_type: "TOPOLOGY", window_s: 120, status: "ACTIVE" },
];

function generateEvent(id) {
  const services = ["api-gateway", "auth-service", "db-proxy", "metrics-collector", "notification-svc"];
  const messages = [
    { msg: "CPU usage exceeded 85% threshold", tags: ["cpu", "performance"], sev: "HIGH", cat: "metric" },
    { msg: "Database connection timeout after 5000ms", tags: ["db", "connection", "timeout"], sev: "CRITICAL", cat: "log" },
    { msg: "HTTP 503 returned from upstream", tags: ["unreachable", "upstream", "5xx"], sev: "HIGH", cat: "signal" },
    { msg: "Memory allocation: 7.2GB / 8GB", tags: ["memory"], sev: "MEDIUM", cat: "metric" },
    { msg: "Trace span latency p99: 2400ms", tags: ["latency", "trace"], sev: "MEDIUM", cat: "trace" },
    { msg: "Health check passed — all systems nominal", tags: ["health"], sev: "INFO", cat: "log" },
    { msg: "Request rate: 12,400 rpm (normal range)", tags: ["throughput"], sev: "INFO", cat: "metric" },
  ];
  const m = messages[Math.floor(Math.random() * messages.length)];
  return {
    id: `evt-${id}-${Date.now()}`,
    timestamp: new Date(),
    service: services[Math.floor(Math.random() * services.length)],
    severity: m.sev,
    category: m.cat,
    message: m.msg,
    tags: m.tags,
    fingerprint: Math.random().toString(36).slice(2, 10),
    pipeline_ms: Math.round(Math.random() * 180 + 20),
  };
}

function generateIncident(event) {
  const runbook = MOCK_RUNBOOKS.find(rb => rb.trigger_tags.some(t => event.tags.includes(t)));
  return {
    id: `inc-${Date.now()}`,
    timestamp: new Date(),
    title: `Correlated: ${event.message}`,
    severity: event.severity,
    service: event.service,
    status: "OPEN",
    contributing_events: [event.id],
    rule: MOCK_CORRELATION_RULES[Math.floor(Math.random() * MOCK_CORRELATION_RULES.length)],
    runbook: runbook || null,
    confidence: runbook ? runbook.confidence : null,
    total_ms: Math.round(event.pipeline_ms + Math.random() * 800 + 400),
  };
}

function PipelineMeter({ ms, label, max, color }) {
  const pct = Math.min((ms / max) * 100, 100);
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#8a8a9a", marginBottom: 3 }}>
        <span>{label}</span><span style={{ color: ms > max * 0.8 ? "#ff2d55" : "#30d158", fontWeight: 700 }}>{ms}ms</span>
      </div>
      <div style={{ height: 4, background: "#1a1a2e", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 2, transition: "width 0.4s ease" }} />
      </div>
    </div>
  );
}

function SeverityBadge({ sev }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 800, letterSpacing: 1, padding: "2px 7px",
      borderRadius: 3, background: SEVERITIES[sev] + "22", color: SEVERITIES[sev],
      border: `1px solid ${SEVERITIES[sev]}44`, fontFamily: "monospace"
    }}>{sev}</span>
  );
}

function ConfidenceBadge({ c }) {
  const colors = { HIGH: "#30d158", MEDIUM: "#ffd60a", LOW: "#ff6b00" };
  if (!c) return <span style={{ fontSize: 10, color: "#ff2d55", fontFamily: "monospace", padding: "2px 7px", border: "1px solid #ff2d5544", borderRadius: 3, background: "#ff2d5511" }}>NO RUNBOOK</span>;
  return <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, padding: "2px 7px", borderRadius: 3, background: colors[c] + "22", color: colors[c], border: `1px solid ${colors[c]}44`, fontFamily: "monospace" }}>✓ {c} CONFIDENCE</span>;
}

export default function App() {
  const [events, setEvents] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState("live");
  const [pipelineStats, setPipelineStats] = useState({ ingest: 0, correlate: 0, dispatch: 0, total: 0 });
  const [running, setRunning] = useState(true);
  const counterRef = useRef(0);
  const evtListRef = useRef(null);

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      counterRef.current += 1;
      const evt = generateEvent(counterRef.current);
      setEvents(prev => [evt, ...prev].slice(0, 80));

      const shouldCorrelate = ["CRITICAL", "HIGH"].includes(evt.severity);
      if (shouldCorrelate) {
        setTimeout(() => {
          const inc = generateIncident(evt);
          setIncidents(prev => [inc, ...prev].slice(0, 30));
        }, Math.round(evt.pipeline_ms + 200));
      }

      setPipelineStats({
        ingest: Math.round(Math.random() * 180 + 40),
        correlate: Math.round(Math.random() * 280 + 120),
        dispatch: Math.round(Math.random() * 120 + 60),
        total: Math.round(Math.random() * 600 + 700),
      });
    }, 1200);
    return () => clearInterval(interval);
  }, [running]);

  const openIncidents = incidents.filter(i => i.status === "OPEN").length;
  const criticalCount = incidents.filter(i => i.severity === "CRITICAL").length;

  return (
    <div style={{
      fontFamily: "'DM Mono', 'Fira Code', 'Courier New', monospace",
      background: "#090912", color: "#c8c8e0", minHeight: "100vh",
      display: "flex", flexDirection: "column"
    }}>
      {/* Scanline effect */}
      <div style={{ position: "fixed", inset: 0, backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.07) 2px, rgba(0,0,0,0.07) 4px)", pointerEvents: "none", zIndex: 9999 }} />

      {/* Header */}
      <div style={{ borderBottom: "1px solid #1e1e3a", padding: "14px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#0a0a16" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 32, height: 32, background: "linear-gradient(135deg, #0a84ff, #5e5ce6)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>⬡</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 2, color: "#e0e0f8" }}>OBSERVACORE</div>
            <div style={{ fontSize: 10, color: "#5a5a7a", letterSpacing: 1 }}>FULL STACK OBSERVABILITY // C# + SUPABASE</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: criticalCount > 0 ? "#ff2d55" : "#30d158" }}>{criticalCount}</div>
            <div style={{ fontSize: 9, color: "#5a5a7a", letterSpacing: 1 }}>CRITICAL</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: openIncidents > 3 ? "#ff6b00" : "#ffd60a" }}>{openIncidents}</div>
            <div style={{ fontSize: 9, color: "#5a5a7a", letterSpacing: 1 }}>OPEN INC.</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#0a84ff" }}>{events.length}</div>
            <div style={{ fontSize: 9, color: "#5a5a7a", letterSpacing: 1 }}>EVENTS</div>
          </div>
          <button
            onClick={() => setRunning(r => !r)}
            style={{ padding: "6px 16px", borderRadius: 4, border: `1px solid ${running ? "#30d15844" : "#ff2d5544"}`, background: running ? "#30d15811" : "#ff2d5511", color: running ? "#30d158" : "#ff2d55", cursor: "pointer", fontSize: 11, fontFamily: "inherit", letterSpacing: 1 }}
          >{running ? "⏸ PAUSE" : "▶ RESUME"}</button>
        </div>
      </div>

      {/* Pipeline SLA bar */}
      <div style={{ background: "#0c0c1a", borderBottom: "1px solid #1e1e3a", padding: "10px 28px", display: "flex", gap: 32 }}>
        <div style={{ fontSize: 10, color: "#5a5a7a", letterSpacing: 1, marginRight: 8, paddingTop: 2 }}>SLA BUDGET</div>
        {[
          { label: "INGEST", ms: pipelineStats.ingest, max: 200, color: "#0a84ff" },
          { label: "CORRELATE", ms: pipelineStats.correlate, max: 600, color: "#5e5ce6" },
          { label: "DISPATCH", ms: pipelineStats.dispatch, max: 300, color: "#30d158" },
          { label: "TOTAL", ms: pipelineStats.total, max: 3000, color: pipelineStats.total > 2500 ? "#ff2d55" : "#ffd60a" },
        ].map(s => (
          <div key={s.label} style={{ flex: 1 }}>
            <PipelineMeter {...s} />
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: "1px solid #1e1e3a", padding: "0 28px", display: "flex", gap: 0, background: "#0a0a16" }}>
        {[["live", "⚡ LIVE FEED"], ["incidents", "🔴 INCIDENTS"], ["rules", "⚙ CORRELATION RULES"], ["runbooks", "📖 RUNBOOKS"]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            padding: "10px 18px", background: "none", border: "none", borderBottom: tab === key ? "2px solid #0a84ff" : "2px solid transparent",
            color: tab === key ? "#0a84ff" : "#5a5a7a", cursor: "pointer", fontSize: 11, fontFamily: "inherit", letterSpacing: 1, transition: "all 0.2s"
          }}>{label}</button>
        ))}
      </div>

      {/* Main content */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div style={{ flex: 1, overflow: "auto", padding: 20 }} ref={evtListRef}>

          {/* LIVE FEED */}
          {tab === "live" && (
            <div>
              <div style={{ fontSize: 10, color: "#3a3a5a", marginBottom: 12, letterSpacing: 1 }}>
                REAL-TIME EVENT STREAM — SUPABASE REALTIME CHANNEL: events
              </div>
              {events.length === 0 && <div style={{ color: "#3a3a5a", textAlign: "center", padding: 40 }}>Waiting for events...</div>}
              {events.map(evt => (
                <div key={evt.id} onClick={() => setSelected(evt)} style={{
                  display: "flex", alignItems: "flex-start", gap: 12, padding: "9px 12px",
                  borderRadius: 5, marginBottom: 3, background: selected?.id === evt.id ? "#1a1a30" : "transparent",
                  border: "1px solid", borderColor: selected?.id === evt.id ? "#2a2a4a" : "transparent",
                  cursor: "pointer", transition: "all 0.15s"
                }}>
                  <span style={{ fontSize: 13, opacity: 0.8 }}>{CATEGORIES[evt.category]}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                      <SeverityBadge sev={evt.severity} />
                      <span style={{ fontSize: 11, color: "#5a5a7a" }}>{evt.service}</span>
                      <span style={{ fontSize: 10, color: "#3a3a5a", marginLeft: "auto" }}>{evt.pipeline_ms}ms</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#a0a0c0" }}>{evt.message}</div>
                  </div>
                  <div style={{ fontSize: 10, color: "#3a3a5a", whiteSpace: "nowrap", paddingTop: 2 }}>
                    {evt.timestamp.toLocaleTimeString()}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* INCIDENTS */}
          {tab === "incidents" && (
            <div>
              <div style={{ fontSize: 10, color: "#3a3a5a", marginBottom: 12, letterSpacing: 1 }}>
                CORRELATED INCIDENTS — RUNBOOK-GROUNDED RESOLUTIONS ONLY
              </div>
              {incidents.length === 0 && <div style={{ color: "#3a3a5a", textAlign: "center", padding: 40 }}>No incidents yet...</div>}
              {incidents.map(inc => (
                <div key={inc.id} onClick={() => setSelected(inc)} style={{
                  padding: 14, borderRadius: 6, marginBottom: 8,
                  background: selected?.id === inc.id ? "#14142a" : "#0e0e20",
                  border: `1px solid ${selected?.id === inc.id ? "#2a2a4a" : "#1a1a2e"}`,
                  cursor: "pointer", transition: "all 0.15s"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <SeverityBadge sev={inc.severity} />
                    <ConfidenceBadge c={inc.confidence} />
                    <span style={{ fontSize: 10, color: "#3a3a5a", marginLeft: "auto" }}>{inc.total_ms}ms total</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#c0c0e0", marginBottom: 4 }}>{inc.title}</div>
                  <div style={{ display: "flex", gap: 12, fontSize: 10, color: "#5a5a7a" }}>
                    <span>📍 {inc.service}</span>
                    <span>⚙ {inc.rule?.name}</span>
                    <span>🕒 {inc.timestamp.toLocaleTimeString()}</span>
                  </div>
                  {inc.runbook && (
                    <div style={{ marginTop: 10, padding: "8px 12px", background: "#0a1a0a", borderRadius: 4, borderLeft: "2px solid #30d158" }}>
                      <div style={{ fontSize: 10, color: "#30d158", marginBottom: 6, letterSpacing: 1 }}>RUNBOOK: {inc.runbook.name}</div>
                      {inc.runbook.steps.map((step, i) => (
                        <div key={i} style={{ fontSize: 11, color: "#80d080", marginBottom: 3, fontFamily: "monospace" }}>{step}</div>
                      ))}
                    </div>
                  )}
                  {!inc.runbook && (
                    <div style={{ marginTop: 10, padding: "8px 12px", background: "#1a0a0a", borderRadius: 4, borderLeft: "2px solid #ff2d55" }}>
                      <div style={{ fontSize: 10, color: "#ff2d55", letterSpacing: 1 }}>⚠ NO MATCHING RUNBOOK — No steps will be suggested to prevent hallucination</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* CORRELATION RULES */}
          {tab === "rules" && (
            <div>
              <div style={{ fontSize: 10, color: "#3a3a5a", marginBottom: 12, letterSpacing: 1 }}>ACTIVE CORRELATION RULES — HOT-RELOADED FROM SUPABASE</div>
              {MOCK_CORRELATION_RULES.map(rule => (
                <div key={rule.id} style={{ padding: 14, borderRadius: 6, marginBottom: 8, background: "#0e0e20", border: "1px solid #1a1a2e" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 3, background: "#5e5ce622", color: "#5e5ce6", border: "1px solid #5e5ce644", letterSpacing: 1 }}>{rule.rule_type}</span>
                    <span style={{ fontSize: 12, color: "#c0c0e0" }}>{rule.name}</span>
                    <span style={{ marginLeft: "auto", fontSize: 10, color: "#30d158" }}>● {rule.status}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "#5a5a7a" }}>Time window: {rule.window_s}s | ID: {rule.id}</div>
                </div>
              ))}
              <div style={{ marginTop: 16, padding: 14, borderRadius: 6, background: "#0c0c1a", border: "1px dashed #1e1e3a" }}>
                <div style={{ fontSize: 10, color: "#3a3a5a", letterSpacing: 1 }}>RULE TYPES SUPPORTED IN FULL SYSTEM</div>
                <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {["THRESHOLD", "SEQUENCE", "TOPOLOGY", "ANOMALY"].map(t => (
                    <span key={t} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 3, background: "#1a1a2e", color: "#5a5a7a", border: "1px solid #2a2a4a" }}>{t}</span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* RUNBOOKS */}
          {tab === "runbooks" && (
            <div>
              <div style={{ fontSize: 10, color: "#3a3a5a", marginBottom: 12, letterSpacing: 1 }}>RUNBOOKS & SOPs — VERBATIM STEPS ONLY — NO AI PARAPHRASING</div>
              {MOCK_RUNBOOKS.map(rb => (
                <div key={rb.id} style={{ padding: 14, borderRadius: 6, marginBottom: 12, background: "#0e0e20", border: "1px solid #1a1a2e" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <ConfidenceBadge c={rb.confidence} />
                    <span style={{ fontSize: 12, color: "#e0e0f8", fontWeight: 700 }}>{rb.name}</span>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                    {rb.trigger_tags.map(t => (
                      <span key={t} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 3, background: "#0a1428", color: "#0a84ff", border: "1px solid #0a84ff33" }}>#{t}</span>
                    ))}
                  </div>
                  <div style={{ padding: "8px 12px", background: "#080814", borderRadius: 4, borderLeft: "2px solid #5e5ce6" }}>
                    {rb.steps.map((step, i) => (
                      <div key={i} style={{ fontSize: 11, color: "#9090c0", marginBottom: 4, fontFamily: "monospace" }}>{step}</div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right panel */}
        <div style={{ width: 280, borderLeft: "1px solid #1e1e3a", padding: 16, overflow: "auto", background: "#0a0a14" }}>
          <div style={{ fontSize: 10, color: "#3a3a5a", letterSpacing: 1, marginBottom: 12 }}>PIPELINE HEALTH</div>
          <PipelineMeter label="Ingest (target < 200ms)" ms={pipelineStats.ingest} max={1000} color="#0a84ff" />
          <PipelineMeter label="Correlate (target < 600ms)" ms={pipelineStats.correlate} max={1000} color="#5e5ce6" />
          <PipelineMeter label="Dispatch (target < 300ms)" ms={pipelineStats.dispatch} max={1000} color="#30d158" />
          <PipelineMeter label="Total SLA (target < 3000ms)" ms={pipelineStats.total} max={3000} color={pipelineStats.total > 2500 ? "#ff2d55" : "#ffd60a"} />

          <div style={{ marginTop: 20, fontSize: 10, color: "#3a3a5a", letterSpacing: 1, marginBottom: 12 }}>SUPABASE TABLES</div>
          {[
            { name: "events", count: events.length, color: "#0a84ff" },
            { name: "incidents", count: incidents.length, color: "#ff6b00" },
            { name: "runbooks", count: MOCK_RUNBOOKS.length, color: "#30d158" },
            { name: "corr_rules", count: MOCK_CORRELATION_RULES.length, color: "#5e5ce6" },
          ].map(t => (
            <div key={t.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, padding: "5px 8px", background: "#0e0e1e", borderRadius: 4 }}>
              <span style={{ fontSize: 11, color: "#6060808" }}>{t.name}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: t.color }}>{t.count}</span>
            </div>
          ))}

          <div style={{ marginTop: 20, fontSize: 10, color: "#3a3a5a", letterSpacing: 1, marginBottom: 12 }}>ZERO-HALLUCINATION STATUS</div>
          <div style={{ padding: "8px 10px", background: "#0a1a0a", borderRadius: 4, border: "1px solid #30d15822" }}>
            <div style={{ fontSize: 10, color: "#30d158", marginBottom: 4 }}>✓ Runbook match: EXACT first</div>
            <div style={{ fontSize: 10, color: "#30d158", marginBottom: 4 }}>✓ No-match → empty response</div>
            <div style={{ fontSize: 10, color: "#30d158", marginBottom: 4 }}>✓ Steps verbatim only</div>
            <div style={{ fontSize: 10, color: "#ffd60a" }}>⚠ AI-assist: DISABLED</div>
          </div>

          <div style={{ marginTop: 20, fontSize: 10, color: "#3a3a5a", letterSpacing: 1, marginBottom: 8 }}>TECH STACK</div>
          {["ASP.NET Core 8", "Sys.Threading.Channels", "Supabase Realtime", "OpenTelemetry", "React + Vite"].map(s => (
            <div key={s} style={{ fontSize: 10, color: "#5a5a7a", marginBottom: 3, padding: "3px 6px", background: "#0e0e1e", borderRadius: 3 }}>▸ {s}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
