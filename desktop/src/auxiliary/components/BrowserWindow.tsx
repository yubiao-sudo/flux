import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  browserAct,
  browserCheckEmbed,
  closeBrowserTab,
  getBrowserState,
  onBrowserUpdate,
  openUrlTab,
  switchBrowserTab,
} from "../../engine/api";
import type { BrowserState, SearchResult, SearchTrace, Tab } from "../../engine/types";

/** 已自动转交受控浏览器的标签页（键：tabId|url）。 */
const handedOff = new Set<string>();

const KIND_LABEL: Record<string, string> = {
  url: "WEB",
  html: "CANVAS",
  markdown: "DOC",
  video: "MEDIA",
  text: "TEXT",
  search: "SEARCH",
};

const KIND_GLYPH: Record<string, string> = {
  url: "↗",
  html: "◇",
  markdown: "¶",
  video: "▷",
  text: "≡",
  search: "⌕",
};

function resolveTarget(raw: string) {
  const value = raw.trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (/^(localhost|127\.0\.0\.1|\[::1\])/i.test(value)) return `http://${value}`;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(value)) return `https://${value}`;
  return `https://www.bing.com/search?q=${encodeURIComponent(value)}`;
}

/**
 * FLUX / BROWSER — a quiet lens over the engine's content tabs.
 * The top chrome is the agent's surface, the second rail is the human's
 * browser controls, and the body is the artifact itself.
 */
export default function BrowserWindow() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState("");
  const [search, setSearch] = useState<SearchTrace | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [address, setAddress] = useState("");
  const [handoffStatus, setHandoffStatus] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [copied, setCopied] = useState("");
  const addressRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getBrowserState().then(applyState);
    const un = onBrowserUpdate(applyState);
    return () => {
      un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; url?: string } | null;
      if (!d || d.type !== "baize-open-url" || typeof d.url !== "string") return;
      if (!/^https?:\/\//i.test(d.url)) return;
      void openUrlTab(d.url).catch(() => {});
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const applyTabs = (ts: Tab[]) => {
    setTabs(ts);
    const active = ts.find((t) => t.active);
    setActiveId(active ? active.id : ts.length > 0 ? ts[ts.length - 1].id : "");
  };

  const applyState = (s: BrowserState) => {
    setSearch(s.search ?? null);
    setResults(s.results ?? []);
    applyTabs(s.tabs ?? []);
  };

  const activeTab = tabs.find((t) => t.id === activeId) ?? null;

  useEffect(() => {
    if (activeTab?.kind === "url" || activeTab?.kind === "video") {
      setAddress(activeTab.content);
    } else {
      setAddress("");
    }
  }, [activeTab?.id, activeTab?.content, activeTab?.kind]);

  const onSwitch = (id: string) => {
    setActiveId(id);
    void switchBrowserTab(id);
  };

  const onClose = (id: string) => {
    setTabs((ts) => {
      const next = ts.filter((t) => t.id !== id);
      if (activeId === id && next.length > 0) {
        setActiveId(next[next.length - 1].id);
      }
      return next;
    });
    void closeBrowserTab(id);
  };

  const handoffToDesktop = async () => {
    if (!activeTab || activeTab.kind !== "url" || !activeTab.content.trim()) return;
    setHandoffStatus("正在转交桌面浏览器…");
    try {
      await browserAct({ action: "new_tab", url: activeTab.content.trim() });
      setHandoffStatus("已在桌面浏览器打开，FLUX 可继续操控该页面");
    } catch (e) {
      setHandoffStatus("转交失败：" + e + "（需已安装 Chrome/Edge）");
    }
    window.setTimeout(() => setHandoffStatus(""), 5000);
  };

  const openAddress = async () => {
    const target = resolveTarget(address);
    if (!target) return;
    setAddress(target);
    try {
      await openUrlTab(target);
    } catch (e) {
      setHandoffStatus(`无法打开：${e}`);
      window.setTimeout(() => setHandoffStatus(""), 5000);
    }
  };

  const copyValue = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1600);
    } catch {
      setCopied("复制失败");
    }
  };

  const reload = () => {
    if (activeTab?.kind === "url") {
      setReloadToken((v) => v + 1);
    } else {
      getBrowserState().then(applyState);
    }
  };

  const status = useMemo(() => {
    if (!activeTab) return "STANDBY";
    if (activeTab.embed?.status === "blocked") return "EXTERNAL";
    return activeTab.kind === "url" ? "LIVE" : KIND_LABEL[activeTab.kind] || "READY";
  }, [activeTab]);

  return (
    <div className="fx-window fx-browser">
      <header className="fx-chrome">
        <div className="fx-brand">
          FLUX <span>/</span> LENS
        </div>
        <div className="fx-crumb">CORE / BROWSER — {tabs.length} TABS</div>
        <div className="fx-status">
          <i className={activeTab ? "is-live" : ""} />
          {status}
        </div>
      </header>

      <div className="fx-toolbar">
        <button
          className="fx-iconbtn"
          title="定位地址栏"
          onClick={() => addressRef.current?.focus()}
        >
          ⌖
        </button>
        <div className="fx-address">
          <span className="fx-address-kind">{activeTab ? KIND_LABEL[activeTab.kind] : "NEW"}</span>
          <input
            ref={addressRef}
            value={address}
            spellCheck={false}
            placeholder="输入网址或搜索…"
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void openAddress();
            }}
          />
          <button className="fx-address-go" onClick={() => void openAddress()} disabled={!address.trim()}>
            打开
          </button>
        </div>
        <button className="fx-iconbtn" title="重新加载" onClick={reload}>
          ↻
        </button>
        <button
          className="fx-iconbtn"
          title="复制当前地址 / 内容"
          onClick={() =>
            void copyValue(
              activeTab?.kind === "url" ? activeTab.content : activeTab?.content ?? "",
              "已复制",
            )
          }
          disabled={!activeTab}
        >
          {copied || "⧉"}
        </button>
        {activeTab?.kind === "url" && (
          <button className="fx-textbtn" title="交给受控桌面浏览器" onClick={() => void handoffToDesktop()}>
            桌面打开
          </button>
        )}
      </div>

      <div className="fx-tabstrip">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`fx-tab ${t.id === activeId ? "is-active" : ""}`}
            onClick={() => onSwitch(t.id)}
          >
            <span className="fx-tab-kind">{KIND_GLYPH[t.kind] || "◇"}</span>
            <span className="fx-tab-title">{t.title || t.kind}</span>
            {t.embed?.status === "blocked" && (
              <span className="fx-tab-warn" title={t.embed.reason ?? "该网站拒绝被内嵌"}>
                !
              </span>
            )}
            <span
              className="fx-tab-close"
              role="button"
              tabIndex={0}
              title="关闭标签页"
              onClick={(e) => {
                e.stopPropagation();
                onClose(t.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") onClose(t.id);
              }}
            >
              ×
            </span>
          </button>
        ))}
        {tabs.length === 0 && <span className="fx-tab-empty">NO TABS YET</span>}
      </div>

      {handoffStatus && <div className="fx-notice">{handoffStatus}</div>}

      <div className="fx-content">
        {activeTab ? (
          activeTab.kind === "search" ? (
            <SearchLens
              trace={search}
              results={results}
              onOpen={(url) => {
                void openUrlTab(url).catch(() => {});
              }}
            />
          ) : (
            <TabView
              tab={activeTab}
              reloadToken={reloadToken}
              onHandoff={() => void handoffToDesktop()}
            />
          )
        ) : (
          <div className="fx-empty">
            <div className="fx-empty-eyebrow">BROWSER LENS</div>
            <h1>Let FLUX bring something here.</h1>
            <p>
              页面、Canvas 演示、Markdown、视频都会落在各自的标签页里。
              也可以在上面的地址栏直接打开网址或搜索。
            </p>
            <div className="fx-empty-actions">
              <button onClick={() => void openUrlTab("https://www.bing.com")}>打开 Bing</button>
              <button onClick={() => addressRef.current?.focus()}>输入网址</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const STAGE_COPY: Record<string, { label: string; note: string }> = {
  planning: { label: "理解意图", note: "拆出实体、时间与要验证的说法" },
  querying: { label: "并行检索", note: "多个来源同时查，避免单一引擎的窄召回" },
  ranking: { label: "去重与重排", note: "按标题、摘要和域名覆盖度收敛" },
  done: { label: "已收敛", note: "只保留与问题相关的具体页面" },
  failed: { label: "未命中", note: "换更具体的实体、时间或站点再试" },
};

function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0];
  }
}

/** Old SERP snapshots may still carry HTML entities; the native backend
 *  cleans new results, this keeps existing tabs readable too. */
function cleanSerpText(input: string) {
  return input
    .replace(/&ensp;|&emsp;|&nbsp;/g, " ")
    .replace(/&#0183;|&#183;|&middot;/g, "·")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function SearchLens({
  trace,
  results,
  onOpen,
}: {
  trace: SearchTrace | null;
  results: SearchResult[];
  onOpen: (url: string) => void;
}) {
  const stage = trace?.stage ?? "planning";
  const copy = STAGE_COPY[stage] ?? STAGE_COPY.planning;
  const attempts = trace?.attempts ?? [];
  const settled = attempts.filter((a) => a.status !== "running").length;
  const progress =
    stage === "done" || stage === "failed"
      ? 100
      : Math.min(92, 16 + settled * 24 + (stage === "querying" ? 8 : 0));
  const seconds = trace?.elapsed_ms ? (trace.elapsed_ms / 1000).toFixed(1) : "";

  return (
    <div className="fx-search" aria-live="polite">
      <section className="fx-search-hero">
        <div className={`fx-search-orbit ${stage !== "done" && stage !== "failed" ? "is-scanning" : ""}`}>
          <i />
          <i />
          <i />
          <span />
        </div>
        <div className="fx-search-hero-copy">
          <div className="fx-search-eyebrow">AGENT RETRIEVAL / LIVE TRACE</div>
          <h1>{trace?.query || "正在理解…"}</h1>
          <p>{copy.note}</p>
        </div>
        <div className="fx-search-state">
          <span className={`fx-search-state-dot is-${stage}`} />
          <span>{copy.label}</span>
          {seconds && <small>{seconds}s</small>}
        </div>
      </section>

      <div className="fx-search-progress" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>

      <div className="fx-search-layout">
        <aside className="fx-search-trace">
          <div className="fx-search-section-head">
            <span>TRACE / 检索过程</span>
            <span>{attempts.length} 个来源</span>
          </div>
          <ol className="fx-attempts">
            {attempts.length === 0 && (
              <li className="fx-attempt is-running">
                <span className="fx-attempt-marker">◌</span>
                <div>
                  <strong>展开查询</strong>
                  <small>正在把问题拆成可检索的实体与说法</small>
                </div>
              </li>
            )}
            {attempts.map((a, i) => (
              <li className={`fx-attempt is-${a.status}`} key={`${a.engine}-${i}`}>
                <span className="fx-attempt-marker">
                  {a.status === "running" ? "◌" : a.status === "ok" ? "✓" : "×"}
                </span>
                <div>
                  <strong>{a.engine}</strong>
                  <small>
                    {a.status === "running"
                      ? "正在抓取结果页…"
                      : a.status === "ok"
                        ? `${a.count} 条候选，进入重排`
                        : a.detail || "无可用结果"}
                  </small>
                </div>
              </li>
            ))}
            {(stage === "done" || stage === "failed") && (
              <li className={`fx-attempt is-${stage === "done" ? "ok" : "failed"}`}>
                <span className="fx-attempt-marker">{stage === "done" ? "◆" : "!"}</span>
                <div>
                  <strong>相关性重排</strong>
                  <small>
                    {stage === "done"
                      ? `保留 ${results.length} 条与查询直接相关的页面`
                      : "没有页面通过相关性阈值"}
                  </small>
                </div>
              </li>
            )}
          </ol>
          <div className="fx-search-trace-foot">
            <span>QUERY</span>
            <p>{trace?.query || "—"}</p>
          </div>
        </aside>

        <section className="fx-search-results">
          <div className="fx-search-section-head">
            <span>RESULTS / 具体信息</span>
            <span>{stage === "done" ? `${results.length} 条` : "收敛中"}</span>
          </div>

          {results.length > 0 ? (
            <div className="fx-result-list">
              {results.map((r, i) => (
                <button className="fx-result" key={`${r.url}-${i}`} onClick={() => onOpen(r.url)}>
                  <span className="fx-result-index">{String(i + 1).padStart(2, "0")}</span>
                  <span className="fx-result-main">
                    <span className="fx-result-domain">
                      {domainOf(r.url)}
                      <i>↗</i>
                    </span>
                    <span className="fx-result-title">{cleanSerpText(r.title) || "未命名页面"}</span>
                    <span className="fx-result-summary">
                      {cleanSerpText(r.summary) || "打开来源查看完整内容。"}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : stage === "failed" ? (
            <div className="fx-search-empty">
              <div className="fx-search-empty-glyph">∅</div>
              <h2>这次没有命中具体页面。</h2>
              <p>把问题缩到一个实体、一个时间点或一个站点，FLUX 会再查一轮。</p>
            </div>
          ) : (
            <div className="fx-result-list is-loading">
              {[0, 1, 2, 3].map((i) => (
                <div className="fx-result fx-result--skeleton" key={i}>
                  <span className="fx-result-index">{String(i + 1).padStart(2, "0")}</span>
                  <span className="fx-result-main">
                    <span className="fx-skel fx-skel--domain" />
                    <span className="fx-skel fx-skel--title" />
                    <span className="fx-skel fx-skel--line" />
                    <span className="fx-skel fx-skel--line is-short" />
                  </span>
                </div>
              ))}
            </div>
          )}

          {results.length > 0 && (
            <footer className="fx-search-results-foot">
              <span>{copy.label}</span>
              <span>按查询覆盖度重排 · 排除泛化页</span>
            </footer>
          )}
        </section>
      </div>
    </div>
  );
}

function TabView({
  tab,
  reloadToken,
  onHandoff,
}: {
  tab: Tab;
  reloadToken: number;
  onHandoff: () => void;
}) {
  if (tab.kind === "html") {
    return (
      <iframe
        className="fx-frame"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={tab.content}
        title={tab.title}
      />
    );
  }
  if (tab.kind === "url") {
    return <UrlTab tab={tab} reloadToken={reloadToken} onHandoff={onHandoff} />;
  }
  if (tab.kind === "video") {
    const src = /^https?:\/\//i.test(tab.content) ? tab.content : convertFileSrc(tab.content);
    return (
      <div className="fx-media">
        <video src={src} controls autoPlay />
      </div>
    );
  }
  if (tab.kind === "markdown") {
    return (
      <div
        className="fx-doc fx-doc--embedded"
        dangerouslySetInnerHTML={{
          __html: DOMPurify.sanitize(marked.parse(tab.content) as string),
        }}
      />
    );
  }
  return <div className="fx-text">{tab.content}</div>;
}

function UrlTab({
  tab,
  reloadToken,
  onHandoff,
}: {
  tab: Tab;
  reloadToken: number;
  onHandoff: () => void;
}) {
  const blocked = tab.embed?.status === "blocked";
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [autoStatus, setAutoStatus] = useState("");
  const autoDone = useRef(false);

  useEffect(() => {
    setLoaded(false);
    setSlow(false);
    const t = window.setTimeout(() => setSlow(true), 3500);
    return () => window.clearTimeout(t);
  }, [tab.id, tab.content, reloadKey, reloadToken]);

  useEffect(() => {
    setReloadKey((k) => k + 1);
  }, [reloadToken]);

  useEffect(() => {
    if (!blocked) return;
    const url = tab.content.trim();
    const key = `${tab.id}|${url}`;
    if (handedOff.has(key)) {
      setAutoStatus("已在受控桌面浏览器中打开，可继续让 FLUX 操控该页面");
      return;
    }
    if (autoDone.current) return;
    autoDone.current = true;
    handedOff.add(key);
    setAutoStatus("正在自动改用受控桌面浏览器打开…");
    (async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await browserAct({ action: "new_tab", url });
          setAutoStatus("已在受控桌面浏览器中打开，可继续让 FLUX 操控该页面");
          return;
        } catch (e) {
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          handedOff.delete(key);
          setAutoStatus(`自动改用受控浏览器失败：${e}（需本机已安装 Chrome/Edge）`);
        }
      }
    })();
  }, [blocked, tab.id, tab.content]);

  const recheck = async () => {
    setAutoStatus("正在重新检测…");
    try {
      const r = await browserCheckEmbed(tab.content, tab.id);
      setAutoStatus(
        r.embed?.status === "blocked"
          ? "重新检测：站点仍拒绝内嵌"
          : "重新检测：当前未发现拒绝内嵌的响应头，已按可内嵌处理",
      );
    } catch (e) {
      setAutoStatus(`重新检测失败：${e}`);
    }
    window.setTimeout(() => setAutoStatus(""), 6000);
  };

  if (blocked) {
    return (
      <div className="fx-blocked">
        <div className="fx-blocked-eyebrow">EXTERNAL SURFACE</div>
        <h2>这个站点不允许被内嵌</h2>
        <p>{tab.embed?.reason ?? "站点安全策略不允许被 iframe 嵌入"}</p>
        {tab.embed?.signal && <code>{tab.embed.signal}</code>}
        <div className="fx-blocked-hint">{autoStatus || "已自动改用受控桌面浏览器打开。"}</div>
        <div className="fx-blocked-actions">
          <button onClick={onHandoff}>在桌面浏览器打开</button>
          <button className="is-ghost" onClick={() => void recheck()}>
            重新检测
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fx-urlwrap">
      <div className="fx-urlframe">
        <iframe
          key={`${tab.id}-${tab.content}-${reloadKey}`}
          className="fx-frame"
          src={tab.content}
          title={tab.title}
          onLoad={() => setLoaded(true)}
        />
        {!loaded && (
          <div className="fx-loading">
            <span className="fx-spinner" />
            <p>
              {slow ? "加载较慢，或站点拒绝了 iframe 内嵌。" : "正在加载页面…"}
            </p>
            {slow && (
              <button className="is-ghost" onClick={onHandoff}>
                在桌面浏览器打开
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
