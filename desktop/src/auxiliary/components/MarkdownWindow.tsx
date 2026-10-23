import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import {
  closeMarkdownTab,
  getMarkdownState,
  onMarkdownUpdate,
  openWebviewWindow,
  saveMarkdown,
  switchMarkdownTab,
} from '../../engine/api';
import type { MarkdownDoc } from '../../engine/types';

const CHUNK = 3;
const INTERVAL = 20;
const PARSE_EVERY = 150;

type TocItem = { level: number; text: string; id: string };

/**
 * FLUX / DOCUMENT — the engine's writing desk.
 * Left rail: documents and outline. Main: an editorial reading column.
 * Keeps the streaming typewriter, smart follow-scroll and HTML sanitising.
 */
export default function MarkdownWindow() {
  const [docs, setDocs] = useState<MarkdownDoc[]>([]);
  const [activeId, setActiveId] = useState('');
  const [shown, setShown] = useState(0);
  const [renderedChars, setRenderedChars] = useState(0);
  const [savedMsg, setSavedMsg] = useState('');
  const [toc, setToc] = useState<TocItem[]>([]);
  const [showToc, setShowToc] = useState(false);
  const [sourceMode, setSourceMode] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const followRef = useRef(true);
  const wasStreamingRef = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const prevRef = useRef<Record<string, string>>({});

  const activeDoc = docs.find((d) => d.id === activeId) ?? null;
  const target = activeDoc?.content ?? '';
  const done = shown >= target.length;
  const charCount = target.replace(/\s/g, '').length;
  const readMinutes = Math.max(1, Math.ceil(charCount / 400));

  const resolveActiveId = (ds: MarkdownDoc[]) => {
    const active = ds.find((d) => d.active);
    return active ? active.id : ds.length ? ds[ds.length - 1].id : '';
  };

  useEffect(() => {
    getMarkdownState().then((s) => {
      const ds = s.docs ?? [];
      ds.forEach((d) => (prevRef.current[d.id] = d.content));
      setDocs(ds);
      setActiveId(resolveActiveId(ds));
      setShown(0);
      setRenderedChars(0);
    });
    const un = onMarkdownUpdate((s) => {
      const ds = s.docs ?? [];
      const id = resolveActiveId(ds);
      const content = ds.find((d) => d.id === id)?.content ?? '';
      const prev = prevRef.current[id];
      const isAppend = prev !== undefined && content.startsWith(prev);
      ds.forEach((d) => (prevRef.current[d.id] = d.content));
      setDocs(ds);
      setActiveId(id);
      if (!isAppend) {
        setShown(0);
        setRenderedChars(0);
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  const message = (text: string, ttl = 2800) => {
    setSavedMsg(text);
    window.setTimeout(() => setSavedMsg(''), ttl);
  };

  const handleSave = async () => {
    if (!activeDoc) return;
    try {
      const path = await saveMarkdown(activeDoc.title || 'FLUX 文档', activeDoc.content);
      if (path) message(`已保存：${path}`, 4200);
    } catch (e) {
      message(`保存失败：${String(e)}`, 4200);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeDoc?.content ?? '');
      message('已复制 Markdown 全文');
    } catch {
      message('复制失败');
    }
  };

  const handlePrint = () => window.print();

  const onSwitch = (id: string) => {
    if (id === activeId) return;
    setActiveId(id);
    const len = docs.find((d) => d.id === id)?.content.length ?? 0;
    setShown(len);
    setRenderedChars(len);
    void switchMarkdownTab(id);
  };

  const onClose = (id: string) => {
    const next = docs.filter((d) => d.id !== id);
    if (activeId === id) {
      const last = next[next.length - 1];
      setActiveId(last ? last.id : '');
      setShown(last ? last.content.length : 0);
      setRenderedChars(last ? last.content.length : 0);
    }
    setDocs(next);
    void closeMarkdownTab(id);
  };

  useEffect(() => {
    if (shown >= target.length && renderedChars >= target.length) return;
    let raf = 0;
    let n = shown;
    let lastAdv = performance.now();
    let lastRender = 0;
    const step = (now: number) => {
      if (now - lastAdv >= INTERVAL) {
        lastAdv = now;
        n = Math.min(target.length, n + CHUNK);
      }
      const allRevealed = n >= target.length;
      const shouldRender = (now - lastRender >= PARSE_EVERY && n > renderedChars) || allRevealed;
      if (shouldRender) {
        lastRender = now;
        setShown(n);
        setRenderedChars(n);
      }
      if (!allRevealed || renderedChars < n) {
        raf = requestAnimationFrame(step);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  };
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    // 「流式」由本组件的打字机渐显定义（shown < 全文），后端 MarkdownDoc 没有该字段
    if (!done) {
      wasStreamingRef.current = true;
      if (followRef.current) el.scrollTop = el.scrollHeight;
      return;
    }
    if (wasStreamingRef.current) {
      wasStreamingRef.current = false;
      el.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [renderedChars, done]);

  const html = useMemo(() => {
    const md = target.slice(0, renderedChars);
    if (!md) return '';
    try {
      return DOMPurify.sanitize(marked.parse(md) as string);
    } catch {
      return md;
    }
  }, [target, renderedChars]);

  useEffect(() => {
    if (!done || !bodyRef.current || !target.trim()) {
      setToc([]);
      return;
    }
    const hs = Array.from(bodyRef.current.querySelectorAll('h1,h2,h3'));
    const items: TocItem[] = hs.map((h, i) => {
      h.id = `doc-h-${i}`;
      return { level: Number(h.tagName[1]), text: (h.textContent || '').slice(0, 34), id: h.id };
    });
    setToc(items);
  }, [done, html]);

  const jumpTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setShowToc(false);
  };

  const onBodyClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest?.('a');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (/^https?:\/\//i.test(href)) {
      e.preventDefault();
      void openWebviewWindow(href).catch(() => {});
    }
  };

  return (
    <div className="fx-window fx-doc-window">
      <header className="fx-chrome">
        <div className="fx-brand">
          FLUX <span>/</span> DOCUMENT
        </div>
        <div className="fx-crumb">
          CORE / WRITING DESK — {docs.length} DOCS
        </div>
        <div className="fx-status">
          <i className={done ? 'is-live' : 'is-writing'} />
          {done ? (sourceMode ? 'SOURCE' : 'READY') : 'STREAMING'}
        </div>
      </header>

      <div className="fx-doc-layout">
        <aside className={`fx-doc-rail ${outlineOpen ? '' : 'is-collapsed'}`}>
          <div className="fx-rail-head">
            <span>DOCUMENTS</span>
            <em>{String(docs.length).padStart(2, '0')}</em>
          </div>
          <div className="fx-doc-tabs">
            {docs.map((d) => (
              <button
                key={d.id}
                className={`fx-doc-tab ${d.id === activeId ? 'is-active' : ''}`}
                onClick={() => onSwitch(d.id)}
              >
                <span className="fx-doc-tab-glyph">¶</span>
                <span className="fx-doc-tab-title">{d.title || 'FLUX 文档'}</span>
                <span
                  className="fx-doc-tab-close"
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(d.id);
                  }}
                >
                  ×
                </span>
              </button>
            ))}
            {docs.length === 0 && <p className="fx-rail-empty">No documents yet.</p>}
          </div>

          <div className="fx-rail-head fx-rail-head--toc">
            <span>CONTENTS</span>
            <button
              className="fx-rail-toggle"
              onClick={() => setOutlineOpen((v) => !v)}
              title="收起目录"
            >
              {outlineOpen ? '−' : '+'}
            </button>
          </div>
          {outlineOpen && (
            <nav className="fx-outline">
              {toc.length === 0 ? (
                <p className="fx-rail-empty">Headings will appear here.</p>
              ) : (
                toc.map((t) => (
                  <button
                    key={t.id}
                    className={`fx-outline-item level-${t.level}`}
                    onClick={() => jumpTo(t.id)}
                  >
                    {t.text}
                  </button>
                ))
              )}
            </nav>
          )}

          <div className="fx-rail-meta">
            <span>{charCount.toLocaleString()} CHARS</span>
            <span>{readMinutes} MIN READ</span>
          </div>
        </aside>

        <section className="fx-doc-main">
          <div className="fx-doc-toolbar">
            <div className="fx-doc-heading">
              <span className="fx-doc-eyebrow">ACTIVE DOCUMENT</span>
              <h1>{activeDoc?.title || 'FLUX 文档'}</h1>
            </div>
            <div className="fx-doc-actions">
              {savedMsg && <span className="fx-doc-saved">{savedMsg}</span>}
              <button
                className={`fx-textbtn ${sourceMode ? 'is-active' : ''}`}
                onClick={() => setSourceMode((v) => !v)}
                title="切换原文 / 阅读视图"
              >
                {sourceMode ? '阅读' : '原文'}
              </button>
              {toc.length >= 2 && (
                <button
                  className="fx-textbtn fx-toc-mobile"
                  onClick={() => setShowToc((v) => !v)}
                  title="目录导航"
                >
                  目录
                </button>
              )}
              <button className="fx-textbtn" onClick={() => void handleCopy()} title="复制 Markdown 全文">
                复制
              </button>
              <button className="fx-textbtn" onClick={() => void handleSave()} title="另存为文件">
                保存
              </button>
              <button className="fx-textbtn" onClick={handlePrint} title="打印 / 导出 PDF">
                打印
              </button>
            </div>
          </div>

          {showToc && toc.length >= 2 && (
            <div className="fx-toc-pop">
              {toc.map((t) => (
                <button key={t.id} className={`fx-outline-item level-${t.level}`} onClick={() => jumpTo(t.id)}>
                  {t.text}
                </button>
              ))}
            </div>
          )}

          <div
            className={`fx-doc-scroll markdown-body ${sourceMode ? 'is-source' : ''}`}
            ref={bodyRef}
            onScroll={onScroll}
            onClick={onBodyClick}
          >
            {docs.length === 0 ? (
              <div className="fx-empty fx-empty--doc">
                <div className="fx-empty-eyebrow">WRITING DESK</div>
                <h1>Nothing written yet.</h1>
                <p>让 FLUX 写一份报告、总结或设计文档。它会流式写在这里。</p>
              </div>
            ) : sourceMode ? (
              <pre className="fx-doc-source">{target.slice(0, renderedChars)}</pre>
            ) : (
              <>
                <div dangerouslySetInnerHTML={{ __html: html }} />
                {!done && <span className="fx-caret">▍</span>}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
