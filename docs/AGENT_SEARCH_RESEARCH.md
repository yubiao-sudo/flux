# FLUX Agent Search：调研与第一阶段实现

> 目标不是再做一个「网页搜索框」，而是让 FLUX 在回答前能可靠地**找具体信息、判断来源是否相关、把过程展示出来**。这份文档先记录调研结论，再说明本次落地的第一阶段。

## 1. 为什么现在的内置浏览器会「搜不到具体信息」

现有 `browser_search` 的取数逻辑是 SERP（搜索引擎结果页）抓取 + HTML 解析：

1. 用 Bing / 百度 / DuckDuckGo 的结果页 HTML 做正则解析。
2. 第一个「非空」的引擎直接返回，后续引擎不再查询。
3. 结果按搜索页原始顺序展示，没有查询覆盖度打分、去重或相关性阈值。

这带来三个系统性问题：

- **单引擎窄召回**：一个引擎返回了泛化页就停止，其他引擎其实可能有更具体的页面。
- **无相关性判断**：标题/摘要里是否真的包含查询实体，没有计算；泛化页、导航页会混入。
- **反爬与布局漂移**：SERP 不是稳定 API，验证页、A/B 布局都会让解析结果变差。

所以关键不是「再换一个引擎」，而是把「检索」当成一个 agent 流程：**规划查询 → 多源取回 → 规范化 → 重排 → 引用**。

## 2. 行业调研（公开资料，按主题整理）

### 2.1 Agentic search 的常见分层

- Perplexity 类架构通常拆成：query understanding → retrieval（多源）→ reranking → answer synthesis + citations。检索不是一次 HTTP，而是带查询改写和验证的循环。参考：[Perplexity AI Search 架构案例](https://github.com/handbook-academy/engineering-handbook/blob/main/content/hld/part-8-case-studies/33-perplexity-ai-search.md)。
- LangChain Deep Research 把流程显式拆成 planner、search、reader、writer，并强调「先规划子问题，再逐项取证」。参考：[Build a deep research agent](https://docs.langchain.com/oss/python/deepagents/deep-research)。
- Tavily 这类 agent-first search API 的接口设计不是只返回链接，而是返回可用的 `content`、`score`、来源，并支持 extract/crawl。参考：[Tavily Tools Reference](https://docs.tavily.com/examples/agent-toolkit/tools)。

### 2.2 自建聚合层的现实约束

- SearXNG 是优秀的自托管聚合器，但它的定位是「人类浏览的隐私元搜索」，不是为 agent 排序和稳定 JSON 设计的；上游引擎限流、结果质量漂移仍然存在。参考：[SearXNG 作为免费 SERP API 的实测](https://apiserpent.com/blog/searxng-self-hosted-serp-api-tested)、[SearXNG alternatives for AI](https://you.com/resources/searxng-alternatives)。
- 直接抓 SERP 的成本低，但需要持续维护解析器、反爬和代理；对 FLUX 这种本地优先的应用，最稳的是**多引擎 + 本地重排 + 可解释 trace**，而不是把命运绑在一个 HTML 布局上。

### 2.3 对我们最重要的三条结论

1. **先重排，再回答**：哪怕只做关键词覆盖度、域名可信度和摘要完整度的轻量打分，也能显著减少泛化页。
2. **过程要可解释**：agent 搜索的信任来自「查了哪些源、每个源返回多少、为什么保留这几条」。这正好适合做成 FLUX 的动态检索界面。
3. **分阶段自研**：第一阶段做 orchestration + rerank；第二阶段做本地 embedding/rerank 与页面正文抽取；第三阶段才考虑自己的索引/爬虫。直接自建全网索引的成本和合规风险不适合当前阶段。

## 3. FLUX 的目标架构

```text
用户问题
  → Query Planner（实体/时间/限定语；必要时生成 2–4 个查询变体）
  → Sources（Bing / 百度 / DuckDuckGo；后续可加搜狗、360、站点搜索）
  → Normalizer（标题、URL、摘要、时间、favicon）
  → Dedupe（canonical URL + 标题近似）
  → Reranker（关键词覆盖 + 域名先验 + 摘要质量；后续 BM25 + embedding + cross-encoder）
  → Evidence Extractor（打开 top 结果抽正文段落）
  → Answer + Citations（只引用真正支持结论的段落）
  → Trace UI（实时显示计划、来源、候选数、重排结果）
```

### 3.1 第一阶段（本次已落地）

- 多引擎合并，不再「第一个非空就返回」。
- 查询词/中文二字组覆盖度打分，过滤完全不相干的条目。
- 查询归一化：去掉「请帮我 / 查一下 / search for」外壳；天气类问题补全「天气预报」意图词。
- 域名先验：政府 / 教育 / 维基 / GitHub / MDN / 天气站等权威域获得小幅加权，不覆盖查询词分数。
- 本地结果缓存：`data/search-cache.json`，同 query 6 小时内直接命中，最多 80 条；命中会出现在 trace 的「本地索引」步骤。
- 统一本地索引：`unified_search` 的 `tools` 源已接入工具注册表，和既有 files / knowledge / messages / memories / events / semantic / im / mail 并列；这就是「FLUX 自己的文档、工具、记忆索引」的第一版。
- 原生检索页：实时 trace（规划 → 引擎 running/ok/fail → 重排 → 收敛）、候选卡片、无结果状态。
- 结果卡片使用 FLUX 的衬线标题、mono 域名、hairline 分隔，不再是一套蓝色仪表盘。
- 不引入新服务依赖，保持离线可用与本地优先。

### 3.2 主界面与 LENS 的边界（本次明确）

主界面右侧的 LENS 不再伪装成一个网页浏览器。它现在是**浏览器控制面**：显示真实 LENS WebView 的标签和当前页，并提供「打开 LENS」。所有真实页面、Cookie、登录态和工具打开的页面都在**同一个独立浏览器窗口**中；主界面不会另开一个只显示静态文章的假浏览器。

### 3.3 第二阶段（建议 / 下一步）

- 本地 embedding（bge-m3 / nomic-embed）做语义召回，和关键词分数融合。
- 对 top 5 结果做正文抽取，生成 2–3 句证据片段；回答只允许引用这些片段。
- 查询 planner：从问题中抽出实体/时间/比较对象，生成受控的查询变体；失败时回退到原查询。
- 缓存：query→results TTL、URL→正文哈希，减少重复抓取。

### 3.4 第三阶段（可选）

- 站点白名单可继续按垂直领域细分（政府、论文、GitHub、财报），并支持 `site:` 查询。
- 本地索引只覆盖高频/可信来源，不做全网爬虫。
- 引用验证器：检查引用段落与结论的蕴含关系，不通过则降级为「未找到」。
- 交叉编码器重排只在候选 12 条内运行，避免把延迟重新拉到不可接受的水平。

## 4. 本次实现位置

- 后端：`desktop/src-tauri/src/browser.rs`
  - `SearchTrace` / `SearchAttempt`：检索过程状态。
  - `rank_results()`：去重 + 查询覆盖度重排 + 权威域加权。
  - `refine_query()` / `search_cache_*()`：查询归一化与本地缓存。
  - `search_multi_traced()`：多引擎合并 + 进度回调。
  - `BrowserSearchTool`：先打开原生检索标签页，再逐引擎 emit `browser-update`。
- 本地索引：`desktop/src-tauri/src/unified_search.rs`
  - `tools` 源来自 `ToolRegistry::catalog()`；其余源保持原样。
- 主界面：`desktop/src/modules/Modules.tsx` / `desktop/src/styles.css`
  - `BrowserHub` 是 LENS 的控制面；真实网页仍由独立 WebView 承载。
- 前端浏览器窗口：`desktop/src/auxiliary/components/BrowserWindow.tsx`
  - `SearchLens`：实时过程与结果卡片。
- 样式：`desktop/src/auxiliary/flux-surface.css`
  - `.fx-search-*`、`.fx-attempt*`、`.fx-result*`。

## 5. 参考链接

- [Perplexity AI Search 架构案例](https://github.com/handbook-academy/engineering-handbook/blob/main/content/hld/part-8-case-studies/33-perplexity-ai-search.md)
- [LangChain Deep Research agent](https://docs.langchain.com/oss/python/deepagents/deep-research)
- [Tavily agent tools](https://docs.tavily.com/examples/agent-toolkit/tools)
- [SearXNG 自托管实测](https://apiserpent.com/blog/searxng-self-hosted-serp-api-tested)
- [SearXNG vs paid search API for agents](https://scavio.dev/blog/searxng-vs-paid-search-api-agents-2026)
- [You.com: SearXNG alternatives](https://you.com/resources/searxng-alternatives)

> 这些是外部公开资料，仅用于架构调研；具体实现仍以 FLUX 本地优先、可解释、可降级为原则。
