import { useMemo, useState } from 'react';
import { FileSearch, FolderSearch, Link2, Search, Sparkles } from 'lucide-react';
import { SurfaceFrame } from './SurfaceFrame';
import {
  getMessages,
  listConversations,
  listMemoriesPanel,
  openBrowserWindow,
  queryAuditLog,
  searchRag,
  type AuditRow,
} from '../../engine/api';
import type { Conversation, MemoryRow, RagHit } from '../../engine/types';

type SourceKind = 'document' | 'memory' | 'conversation' | 'message' | 'audit';

type Source = {
  id: string;
  kind: SourceKind;
  title: string;
  excerpt: string;
  meta: string;
  citation?: string;
  at: number;
  score: number;
};

type Claim = {
  id: string;
  text: string;
  status: 'strong' | 'single' | 'unverified';
  sources: number;
};

type TimelineItem = { id: string; at: number; label: string; text: string };

const KIND_LABEL: Record<SourceKind, string> = {
  document: 'DOC',
  memory: 'MEM',
  conversation: 'CONV',
  message: 'MSG',
  audit: 'TOOL',
};

function clean(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function short(text: string, max = 180) {
  const value = clean(text);
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function toMs(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value > 1e12 ? value : value * 1000;
}

function dateLabel(at: number) {
  if (!at) return '';
  return new Date(at).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

const STOP_GRAMS = new Set(['什么', '怎么', '可以', '这个', '那个', '我们', '你们', '他们', '一个', '如何', '为什']);

function tokensOf(topic: string) {
  const raw = topic
    .toLowerCase()
    .split(/[\s,，。；;、/\\|()（）[\]【】]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  const cjk = topic.replace(/[^\u4e00-\u9fa5]/g, '');
  const grams: string[] = [];
  for (let i = 0; i < cjk.length - 1; i += 1) {
    const gram = cjk.slice(i, i + 2);
    if (!STOP_GRAMS.has(gram)) grams.push(gram);
  }
  return [...new Set([topic.toLowerCase().trim(), ...raw, ...grams])].filter(Boolean);
}

function matches(text: string, tokens: string[]) {
  const value = text.toLowerCase();
  return tokens.some((token) => value.includes(token));
}

const STOP_ENTITIES = new Set([
  '记忆', '项目', '工作', '用户', '回答', '问题', '这个', '那个', '可以', '我们', '你们',
  '他们', '一个', '如何', '为什么', '什么', '怎么', 'true', 'false', 'null', 'json', 'http', 'https',
]);

function extractEntities(sources: Source[], topic: string) {
  const map = new Map<string, number>();
  const fullTopic = topic.toLowerCase().trim();
  const bump = (value: string) => {
    const key = value.trim();
    if (key.length < 3 || key.length > 24) return;
    if (key.toLowerCase() === fullTopic) return;
    if (STOP_ENTITIES.has(key.toLowerCase())) return;
    map.set(key, (map.get(key) || 0) + 1);
  };
  tokensOf(topic).forEach((token) => {
    if (token.length >= 3 && token.length <= 8) bump(token);
  });
  sources.forEach((source) => {
    const text = `${source.title} ${source.excerpt}`;
    const quoted = text.matchAll(/[「“"]([^」”"]{2,18})[」”"]/g);
    for (const match of quoted) bump(match[1]);
    const latin = text.matchAll(/\b[A-Z][A-Za-z0-9_.-]{2,18}\b/g);
    for (const match of latin) bump(match[0]);
  });
  return [...map.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([label, count]) => ({ label, count }));
}

function extractTimeline(sources: Source[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  sources.forEach((source) => {
    const text = `${source.title} ${source.excerpt}`;
    const full = text.matchAll(/(20\d{2})[-/年.](\d{1,2})[-/月.](\d{1,2})/g);
    for (const match of full) {
      const at = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
      items.push({
        id: `${source.id}-${at}-${items.length}`,
        at,
        label: `${match[1]}/${String(match[2]).padStart(2, '0')}/${String(match[3]).padStart(2, '0')}`,
        text: short(source.excerpt, 80),
      });
    }
    if (source.at > 0 && source.kind !== 'memory') {
      items.push({
        id: `${source.id}-at`,
        at: source.at,
        label: dateLabel(source.at),
        text: source.title,
      });
    }
  });
  const seen = new Set<string>();
  return items
    .filter((item) => {
      const key = `${item.at}-${item.text.slice(0, 24)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.at - b.at)
    .slice(0, 8);
}

function buildClaims(
  sources: Source[],
  entities: Array<{ label: string; count: number }>,
): Claim[] {
  // 只把“不是到处都有”的实体当作交叉证据。像 FLUX 这种全篇都出现的词，
  // 如果也拿来算支撑，每条主张都会变成“8 条来源”，反而没有信息量。
  const maxSupport = Math.max(2, Math.min(4, Math.round(sources.length * 0.25)));
  // 只有已索引文档能进入“主张”层。记忆和会话是线索，不是结论。
  const evidence = sources.filter((source) => source.kind === 'document');
  const anchors = entities.filter(
    (entity) => entity.count >= 2 && entity.count <= maxSupport,
  );
  return evidence.slice(0, 5).map((source, index) => {
    const supporting = evidence.filter((other) => {
      if (other.id === source.id) return false;
      const text = `${other.title} ${other.excerpt}`.toLowerCase();
      return anchors.some((entity) => text.includes(entity.label.toLowerCase()));
    }).length;
    return {
      id: `claim-${index}`,
      text: short(source.excerpt, 150),
      status: supporting >= 2 ? 'strong' : supporting === 1 ? 'single' : 'unverified',
      sources: supporting + 1,
    };
  });
}

function sourceFromHit(hit: RagHit, index: number): Source {
  const name = hit.path.split(/[\\/]/).pop() || hit.path;
  return {
    id: `doc-${index}-${hit.chunk_id || hit.path}`,
    kind: 'document',
    title: name,
    excerpt: hit.content,
    meta: `${Math.round(hit.score || 0)}${hit.page != null ? ` · p${hit.page}` : ''}`,
    citation: hit.citation || hit.path,
    at: 0,
    score: 100 + (hit.score || 0),
  };
}

export function DossierPanel({ onClose }: { onClose: () => void }) {
  const [topic, setTopic] = useState('');
  const [caseTitle, setCaseTitle] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const [selected, setSelected] = useState('');
  const [building, setBuilding] = useState(false);
  const [searched, setSearched] = useState(false);

  const entities = useMemo(() => extractEntities(sources, caseTitle || topic), [sources, caseTitle, topic]);
  const claims = useMemo(() => buildClaims(sources, entities), [sources, entities]);
  const timeline = useMemo(() => extractTimeline(sources), [sources]);
  const selectedSource = sources.find((source) => source.id === selected) || sources[0] || null;

  const build = async (value?: string) => {
    const nextTopic = (value ?? topic).trim();
    if (!nextTopic || building) return;
    setBuilding(true);
    setSearched(true);
    setTopic(nextTopic);
    setCaseTitle(nextTopic);
    setSelected('');
    const tokens = tokensOf(nextTopic);
    const collected: Source[] = [];

    const settle = <T,>(result: PromiseSettledResult<T>, fallback: T): T =>
      result.status === 'fulfilled' ? result.value : fallback;

    const activeConv = (() => {
      try {
        return localStorage.getItem('flux.active_conversation') || '';
      } catch {
        return '';
      }
    })();

    const results = await Promise.allSettled([
      searchRag(nextTopic),
      listMemoriesPanel(undefined, 220),
      queryAuditLog(220),
      listConversations(),
      activeConv ? getMessages(activeConv) : Promise.resolve([]),
    ]);

    const rag = settle(results[0] as PromiseSettledResult<{ hits: RagHit[]; refused?: boolean }>, {
      hits: [],
    });
    rag.hits.forEach((hit, index) => {
      if (hit.content || hit.path) collected.push(sourceFromHit(hit, index));
    });

    const memories = settle(results[1] as PromiseSettledResult<MemoryRow[]>, []);
    memories
      .filter((memory) => matches(memory.content, tokens))
      .slice(0, 8)
      .forEach((memory, index) => {
        collected.push({
          id: `mem-${memory.mem_id}-${index}`,
          kind: 'memory',
          title: memory.kind || '记忆',
          excerpt: memory.content,
          meta: `salience ${memory.salience ?? 0}`,
          at: 0,
          score: 30 + (memory.salience || 0),
        });
      });

    const audit = settle(results[2] as PromiseSettledResult<AuditRow[]>, []);
    audit
      .filter((row) => matches(`${row.tool} ${row.args} ${row.result}`, tokens))
      .slice(0, 8)
      .forEach((row, index) => {
        collected.push({
          id: `audit-${row.ts}-${index}`,
          kind: 'audit',
          title: row.tool || '工具调用',
          excerpt: short(row.result || row.args || '已执行', 500),
          meta: row.decision || 'AUTO',
          at: toMs(row.ts),
          score: 20,
        });
      });

    const conversations = settle(results[3] as PromiseSettledResult<Conversation[]>, []);
    conversations
      .filter((conversation) => matches(conversation.title || '', tokens))
      .slice(0, 6)
      .forEach((conversation) => {
        collected.push({
          id: `conv-${conversation.id}`,
          kind: 'conversation',
          title: conversation.title || '未命名会话',
          excerpt: `创建于 ${dateLabel(toMs(conversation.created_at))}`,
          meta: 'session',
          at: toMs(conversation.created_at),
          score: 15,
        });
      });

    const messages = settle(results[4] as PromiseSettledResult<Array<{ role: string; content: string; created_at: number }>>, []);
    messages
      .filter((message) => matches(message.content, tokens))
      .slice(-8)
      .forEach((message, index) => {
        collected.push({
          id: `msg-${message.created_at}-${index}`,
          kind: 'message',
          title: message.role === 'user' ? '你的话' : 'FLUX 的回答',
          excerpt: short(message.content, 500),
          meta: 'active session',
          at: toMs(message.created_at),
          score: 60,
        });
      });

    const seen = new Set<string>();
    const unique = collected
      .filter((source) => {
        const key = source.excerpt.slice(0, 70) || source.title;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => b.score - a.score || b.at - a.at)
      .slice(0, 24);

    setSources(unique);
    setSelected(unique[0]?.id || '');
    setBuilding(false);
  };

  const localSummary = useMemo(() => {
    if (!searched) return '';
    if (sources.length === 0) {
      return `本机没有找到和「${caseTitle}」直接相关的证据。可以换一个关键词，或者打开 LENS 继续从网页里找。`;
    }
    const strongest = claims[0]?.text || sources[0].excerpt;
    const entityLine = entities.length ? `出现最多的是 ${entities.slice(0, 3).map((item) => item.label).join('、')}。` : '';
    if (claims.length === 0) {
      return `本机找到 ${sources.length} 条候选记录，但没有可交叉核对的已索引文档。以下先当作线索，不要当作结论。`;
    }
    return `本机找到 ${sources.length} 条证据，其中 ${claims.length} 条文档主张可核对。${entityLine}最完整的一条是：${short(strongest, 140)}`;
  }, [searched, sources, caseTitle, claims, entities]);

  return (
    <SurfaceFrame
      id="dossier"
      mark="DOS"
      title="FLUX / 调查板"
      sub="DOSSIER · LOCAL EVIDENCE BOARD"
      meta={
        <>
          <span>{building ? 'SEARCHING LOCAL' : `${sources.length} SOURCES`}</span>
          <i />
          <span>LOCAL · RAG · AUDIT</span>
        </>
      }
      onClose={onClose}
    >
      <div className="dossier">
        <header className="dossier-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <span className="lens-eyebrow">DOSSIER / NEW CASE</span>
            <h1 className="lens-title" style={{ marginBottom: 12 }}>
              {searched ? caseTitle : '把一个问题，摊开在桌面上。'}
            </h1>
            <form
              className="dossier-form"
              onSubmit={(event) => {
                event.preventDefault();
                void build();
              }}
            >
              <input
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                placeholder="输入一个题目，例如：FLUX 的记忆是怎么工作的"
                spellCheck={false}
              />
              <button type="submit" className="lens-btn is-primary" disabled={building || !topic.trim()}>
                {building ? '调查中…' : '开始调查'}
              </button>
            </form>
          </div>
        </header>

        <div className="dossier-suggestions">
          {['FLUX 的记忆是怎么工作的', '最近的项目里有什么风险', 'LoL 赛程与结果', '我这周在专注什么'].map((item) => (
            <button type="button" key={item} onClick={() => void build(item)}>
              {item}
            </button>
          ))}
        </div>

        {!searched ? (
          <div className="dossier-empty-board">
            <div className="lens-empty">
              <FolderSearch size={26} />
              <strong>还没有展开的案子</strong>
              <p>
                输入一个题目，DOSSIER 会在本机记忆、已索引文档、会话和工具审计里找相关证据，把它们摊成来源、主张和时间线。它不会编造网页结果。
              </p>
            </div>
          </div>
        ) : (
          <div className="dossier-board">
            <section className="dossier-col">
              <header className="dossier-col-head">
                <span>SOURCES / 证据</span>
                <em>{sources.length}</em>
              </header>
              {sources.length === 0 ? (
                <div className="lens-empty" style={{ minHeight: 150 }}>
                  <Search size={20} />
                  <strong>没有本地证据</strong>
                  <p>换一个关键词，或者去 LENS 里做一次网页检索。</p>
                </div>
              ) : (
                sources.map((source) => (
                  <button
                    type="button"
                    key={source.id}
                    className={`dossier-source ${selectedSource?.id === source.id ? 'is-active' : ''}`}
                    onClick={() => setSelected(source.id)}
                  >
                    <header>
                      <strong>{source.title}</strong>
                      <em>{KIND_LABEL[source.kind]}</em>
                    </header>
                    <p>{source.excerpt}</p>
                    <small>{source.citation || source.meta || dateLabel(source.at)}</small>
                  </button>
                ))
              )}
            </section>

            <main className="dossier-center">
              <section className="dossier-summary">
                <header>
                  <span>LOCAL SYNTHESIS</span>
                  <span>{claims.length} CLAIMS</span>
                </header>
                <h2>{caseTitle || '未命名调查'}</h2>
                <p>{building ? '正在把证据排到桌面上…' : localSummary}</p>
              </section>

              <section className="dossier-block">
                <header><span>CLAIMS / 待核实</span><em>多源优先</em></header>
                <div className="dossier-block-body">
                  {claims.length === 0 ? (
                    <p className="lens-muted">还没有足够的证据形成主张。</p>
                  ) : (
                    claims.map((claim) => (
                      <div className={`dossier-claim is-${claim.status}`} key={claim.id}>
                        <span />
                        <div>
                          <p>{claim.text}</p>
                          <em>
                            {claim.status === 'strong'
                              ? `${claim.sources} 条来源相互支撑`
                              : claim.status === 'single'
                                ? '只有 1 条来源'
                                : '还没有其他来源'}
                          </em>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section className="dossier-block">
                <header><span>TIMELINE / 时间线</span><em>{timeline.length} 个节点</em></header>
                <div className="dossier-block-body">
                  {timeline.length === 0 ? (
                    <p className="lens-muted">证据里没有可排序的日期。</p>
                  ) : (
                    <ol className="dossier-timeline">
                      {timeline.map((item) => (
                        <li key={item.id}>
                          <time>{item.label}</time>
                          <span>{item.text}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </section>

              <section className="dossier-block">
                <header><span>ENTITIES / 实体</span><em>{entities.length}</em></header>
                <div className="dossier-block-body">
                  {entities.length === 0 ? (
                    <p className="lens-muted">还没有抽取出稳定的实体。</p>
                  ) : (
                    <div className="dossier-entities">
                      {entities.map((entity) => (
                        <span className="dossier-entity" key={entity.label}>
                          {entity.label} <em>×{entity.count}</em>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </main>

            <aside className="dossier-col is-detail dossier-detail">
              <header className="dossier-col-head">
                <span>DETAIL / 原文</span>
                <em>{selectedSource ? KIND_LABEL[selectedSource.kind] : '—'}</em>
              </header>
              {selectedSource ? (
                <>
                  <h3>{selectedSource.title}</h3>
                  <p>{selectedSource.excerpt}</p>
                  <footer>
                    {selectedSource.citation && (
                      <span className="dossier-entity"><Link2 size={9} /> {selectedSource.citation}</span>
                    )}
                    {selectedSource.at > 0 && (
                      <span className="dossier-entity">{dateLabel(selectedSource.at)}</span>
                    )}
                    <button
                      type="button"
                      className="lens-btn"
                      onClick={() => void openBrowserWindow().catch(() => undefined)}
                    >
                      <FileSearch size={11} /> 在 LENS 中继续
                    </button>
                  </footer>
                </>
              ) : (
                <p className="lens-muted">点左边一条证据，这里会显示完整原文。</p>
              )}
              <p className="lens-muted" style={{ marginTop: 18, lineHeight: 1.7 }}>
                <Sparkles size={10} style={{ marginRight: 4 }} />
                这里的结论来自本机证据的本地拼装，不代表模型判断；点开原文核对引用。
              </p>
            </aside>
          </div>
        )}
      </div>
    </SurfaceFrame>
  );
}
