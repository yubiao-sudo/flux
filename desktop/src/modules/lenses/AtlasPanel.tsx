import { useEffect, useMemo, useState } from 'react';
import { Brain, Search, Sparkles } from 'lucide-react';
import { SurfaceFrame } from './SurfaceFrame';
import { getMemoryGraph, getRagState, listConversations, searchRag } from '../../engine/api';
import type { RagAnswer, RagDoc, MemoryGraph, Conversation } from '../../engine/types';

type Tab = 'all' | 'memory' | 'conversation' | 'document';

type AtlasNode = {
  id: string;
  kind: 'memory' | 'conversation' | 'document';
  label: string;
  title: string;
  detail: string;
  meta: string;
  group: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  showLabel: boolean;
};

const MEMORY_COLORS: Record<string, string> = {
  偏好: '#c7b29c',
  事实: '#8fb9c4',
  项目: '#9dbfae',
  习惯: '#b6a3c9',
  关系: '#d49a8e',
};

const COLORS = {
  memory: '#8fb9c4',
  conversation: '#c7b29c',
  document: '#9dbfae',
};

function truncate(text: string, max: number) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function dateOf(seconds: number) {
  const at = seconds > 1e12 ? seconds : seconds * 1000;
  return new Date(at).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

export function AtlasPanel({ onClose }: { onClose: () => void }) {
  const [graph, setGraph] = useState<MemoryGraph>({ nodes: [], edges: [] });
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [docs, setDocs] = useState<RagDoc[]>([]);
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string>('');
  const [ask, setAsk] = useState('');
  const [answer, setAnswer] = useState<RagAnswer | null>(null);
  const [asking, setAsking] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const settle = <T,>(result: PromiseSettledResult<T>, fallback: T): T =>
      result.status === 'fulfilled' ? result.value : fallback;
    void Promise.allSettled([getMemoryGraph(), listConversations(), getRagState()]).then((results) => {
      if (!alive) return;
      setGraph(settle(results[0] as PromiseSettledResult<MemoryGraph>, { nodes: [], edges: [] }));
      setConversations(settle(results[1] as PromiseSettledResult<Conversation[]>, []));
      setDocs(settle(results[2] as PromiseSettledResult<RagDoc[]>, []));
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const nodes = useMemo<AtlasNode[]>(() => {
    const center = { x: 450, y: 310 };
    const list: AtlasNode[] = [];
    const memories = [...graph.nodes].sort((a, b) => b.salience - a.salience).slice(0, 34);
    const recentConversations = [...conversations]
      .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
      .slice(0, 18);
    const recentDocs = [...docs].slice(0, 14);

    memories.forEach((memory, index) => {
      const angle = (index / Math.max(1, memories.length)) * Math.PI * 2 - Math.PI / 2;
      const ring = 132 + (index % 3) * 30;
      list.push({
        id: `mem-${memory.mem_id}`,
        kind: 'memory',
        label: truncate(memory.content, 12),
        title: truncate(memory.content, 38),
        detail: memory.content,
        meta: `${memory.kind || '记忆'} · 权重 ${memory.salience ?? 0}`,
        group: memory.kind || '记忆',
        x: center.x + Math.cos(angle) * ring,
        y: center.y + Math.sin(angle) * ring,
        radius: 5 + Math.min(7, (memory.salience || 1) / 3),
        color: MEMORY_COLORS[memory.kind] || COLORS.memory,
        showLabel: index < 7,
      });
    });

    recentConversations.forEach((conversation, index) => {
      const angle = (index / Math.max(1, recentConversations.length)) * Math.PI * 2 + 0.18;
      const ring = 252 + (index % 2) * 22;
      list.push({
        id: `conv-${conversation.id}`,
        kind: 'conversation',
        label: truncate(conversation.title || '未命名会话', 10),
        title: conversation.title || '未命名会话',
        detail: `${conversation.title || '未命名会话'}\n创建于 ${dateOf(conversation.created_at)}`,
        meta: `会话 · ${dateOf(conversation.created_at)}`,
        group: '会话',
        x: center.x + Math.cos(angle) * ring,
        y: center.y + Math.sin(angle) * ring,
        radius: 7,
        color: COLORS.conversation,
        showLabel: true,
      });
    });

    recentDocs.forEach((doc, index) => {
      const angle = (index / Math.max(1, recentDocs.length)) * Math.PI * 2 + 0.42;
      const ring = 312;
      list.push({
        id: `doc-${doc.path}`,
        kind: 'document',
        label: truncate(doc.path.split(/[\\/]/).pop() || doc.path, 12),
        title: doc.path.split(/[\\/]/).pop() || doc.path,
        detail: doc.path,
        meta: `文档 · ${doc.chunks} 个切片`,
        group: '文档',
        x: center.x + Math.cos(angle) * ring,
        y: center.y + Math.sin(angle) * ring,
        radius: 6,
        color: COLORS.document,
        showLabel: true,
      });
    });

    return list;
  }, [graph.nodes, conversations, docs]);

  useEffect(() => {
    if (!selected && nodes.length > 0) setSelected(nodes[0].id);
  }, [nodes, selected]);

  const needle = query.trim().toLowerCase();
  const visible = (node: AtlasNode) => {
    if (tab !== 'all' && node.kind !== tab) return false;
    if (!needle) return true;
    return `${node.label} ${node.detail}`.toLowerCase().includes(needle);
  };

  const selectedNode = nodes.find((node) => node.id === selected) || null;
  const shown = nodes.filter(visible);
  const edges = useMemo(() => {
    const visibleIds = new Set(nodes.map((node) => node.id));
    return graph.edges
      .map((edge) => {
        const from = nodes.find((node) => node.id === `mem-${edge.from}`);
        const to = nodes.find((node) => node.id === `mem-${edge.to}`);
        if (!from || !to || !visibleIds.has(from.id) || !visibleIds.has(to.id)) return null;
        return { from, to };
      })
      .filter((edge): edge is { from: AtlasNode; to: AtlasNode } => Boolean(edge));
  }, [graph.edges, nodes]);

  const counts = useMemo(
    () => ({
      memory: nodes.filter((node) => node.kind === 'memory').length,
      conversation: nodes.filter((node) => node.kind === 'conversation').length,
      document: nodes.filter((node) => node.kind === 'document').length,
    }),
    [nodes],
  );

  const runAsk = async () => {
    const text = ask.trim();
    if (!text || asking) return;
    setAsking(true);
    setAnswer(null);
    try {
      setAnswer(await searchRag(text));
    } catch {
      setAnswer({
        count: 0,
        hits: [],
        source: 'unavailable',
        refused: true,
        reason: '知识库还没有连接，或检索暂时不可用。',
      });
    } finally {
      setAsking(false);
    }
  };

  return (
    <SurfaceFrame
      id="atlas"
      mark="ATL"
      title="FLUX / 知识地图"
      sub="ATLAS · MEMORY / CONVERSATION / DOCUMENT"
      meta={
        <>
          <span>{loading ? 'BUILDING GRAPH' : `${shown.length} NODES`}</span>
          <i />
          <span>LOCAL · RAG</span>
        </>
      }
      onClose={onClose}
    >
      <div className="atlas">
        <aside className="atlas-side">
          <span className="lens-eyebrow">ATLAS / INDEX</span>
          <h2>你知道什么？</h2>
          <div className="atlas-search">
            <Search size={12} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索记忆、会话、文档…"
              spellCheck={false}
            />
          </div>
          <div className="atlas-tabs">
            {([
              ['all', '全部'],
              ['memory', '记忆'],
              ['conversation', '会话'],
              ['document', '文档'],
            ] as Array<[Tab, string]>).map(([id, label]) => (
              <button
                type="button"
                key={id}
                className={tab === id ? 'is-active' : ''}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="atlas-legend">
            <span><i style={{ background: COLORS.memory }} /> 记忆 <em>{counts.memory}</em></span>
            <span><i style={{ background: COLORS.conversation }} /> 会话 <em>{counts.conversation}</em></span>
            <span><i style={{ background: COLORS.document }} /> 文档 <em>{counts.document}</em></span>
          </div>

          <div className="atlas-stat-row"><span>GRAPH EDGES</span><strong>{graph.edges.length}</strong></div>
          <div className="atlas-stat-row"><span>TOTAL MEMORIES</span><strong>{graph.nodes.length}</strong></div>
          <div className="atlas-stat-row"><span>CONVERSATIONS</span><strong>{conversations.length}</strong></div>
          <div className="atlas-stat-row"><span>INDEXED DOCS</span><strong>{docs.length}</strong></div>

          <p className="lens-muted" style={{ marginTop: 18, lineHeight: 1.7 }}>
            这张图只画最近、权重最高的节点。搜索会保留布局，只把不匹配的节点调暗。
          </p>
        </aside>

        <div className="atlas-stage">
          <span className="atlas-stage-label">ATLAS / RELATION FIELD</span>
          <svg viewBox="0 0 900 620" role="img" aria-label="FLUX 知识地图">
            <circle cx="450" cy="310" r="330" fill="none" stroke="rgba(143,185,196,0.06)" />
            <circle cx="450" cy="310" r="252" fill="none" stroke="rgba(143,185,196,0.05)" strokeDasharray="2 8" />
            <circle cx="450" cy="310" r="132" fill="none" stroke="rgba(143,185,196,0.05)" strokeDasharray="2 8" />
            {edges.map((edge, index) => (
              <line
                className="atlas-edge"
                key={`${edge.from.id}-${edge.to.id}-${index}`}
                x1={edge.from.x}
                y1={edge.from.y}
                x2={edge.to.x}
                y2={edge.to.y}
              />
            ))}
            {nodes.map((node) => (
              <line
                className="atlas-edge"
                key={`spoke-${node.id}`}
                x1="450"
                y1="310"
                x2={node.x}
                y2={node.y}
                opacity={visible(node) ? 0.5 : 0.08}
              />
            ))}
            <circle className="atlas-hub" cx="450" cy="310" r="34" />
            <text x="450" y="314" textAnchor="middle" fill="#b8d5d0" fontFamily="var(--mono)" fontSize="9" letterSpacing="2">
              ATLAS
            </text>
            {nodes.map((node) => (
              <g
                key={node.id}
                className={`atlas-node ${visible(node) ? '' : 'is-dim'} ${
                  selected === node.id ? 'is-selected' : ''
                }`}
                onClick={() => setSelected(node.id)}
              >
                <title>{node.title}</title>
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.radius}
                  fill={`${node.color}22`}
                  stroke={node.color}
                  strokeWidth="1.1"
                />
                {(node.showLabel || selected === node.id) && (
                  <text x={node.x + node.radius + 4} y={node.y + 2.5}>
                    {node.label}
                  </text>
                )}
              </g>
            ))}
          </svg>
          {nodes.length === 0 && !loading && (
            <div className="lens-empty" style={{ position: 'absolute', inset: '12% 14%', background: 'rgba(4,7,8,.6)' }}>
              <Brain size={24} />
              <strong>还没有可绘制的知识</strong>
              <p>在 M 记忆场里留下一条记忆，或在 S 里索引一个文档目录，ATLAS 就会开始生长。</p>
            </div>
          )}
          <span className="atlas-stage-count">
            {shown.length} / {nodes.length} NODES · 点击节点查看
          </span>
        </div>

        <aside className="atlas-rail">
          <span className="atlas-rail-kicker">SELECTED NODE</span>
          {selectedNode ? (
            <div className="atlas-detail">
              <h3>{selectedNode.title}</h3>
              <div className="atlas-detail-meta">
                <span>{selectedNode.kind.toUpperCase()}</span>
                <span>{selectedNode.meta}</span>
              </div>
              <p>{selectedNode.detail}</p>
              {selectedNode.kind === 'document' && (
                <p className="lens-muted" style={{ marginTop: 10 }}>
                  路径已经索引；完整内容由文档/RAG 工具读取。
                </p>
              )}
            </div>
          ) : (
            <div className="atlas-detail">
              <h3>选择一个节点</h3>
              <p>左侧点一个发光点，这里会显示它的内容、类型和来源。</p>
            </div>
          )}

          <div className="atlas-ask">
            <span className="atlas-rail-kicker">ASK ATLAS</span>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void runAsk();
              }}
            >
              <input
                value={ask}
                onChange={(event) => setAsk(event.target.value)}
                placeholder="问知识库一个问题…"
                spellCheck={false}
              />
              <button type="submit" className="lens-btn" disabled={asking || !ask.trim()}>
                {asking ? '…' : '问'}
              </button>
            </form>
            {answer && (
              <div className="atlas-answer">
                <strong>
                  {answer.refused ? '没有足够依据' : `${answer.count ?? answer.hits.length} 条依据`}
                  {answer.source ? ` · ${answer.source}` : ''}
                </strong>
                {answer.refused ? (
                  <p>{answer.reason || '知识库里没有能支撑回答的内容。'}</p>
                ) : answer.hits.length === 0 ? (
                  <p>没有命中。换一个更具体的说法，或先索引文档。</p>
                ) : (
                  answer.hits.slice(0, 4).map((hit, index) => (
                    <div key={`${hit.path}-${index}`} style={{ marginBottom: 8 }}>
                      <p>{truncate(hit.content, 140)}</p>
                      <em>{hit.citation || hit.path}</em>
                    </div>
                  ))
                )}
              </div>
            )}
            <p className="lens-muted" style={{ marginTop: 10, lineHeight: 1.65 }}>
              <Sparkles size={10} style={{ marginRight: 4 }} />
              检索只读取本机已索引的知识；没有依据时会明确说没有。
            </p>
          </div>
        </aside>
      </div>
    </SurfaceFrame>
  );
}
