//! 子代理系统（SubAgent）
//!
//! 主 Agent 可以将复杂任务拆解为多个子代理并行执行，每个子代理拥有独立的上下文和工具集。
//! 子代理完成任务后返回结构化摘要，不污染主 Agent 的对话历史。
//!
//! 子代理类型：
//!   - search: 快速代码库搜索（Glob, Grep, LS, Read），只读无状态
//!   - code-explorer: 深度代码探索（多步搜索 + 文件读取），用于理解复杂模块
//!   - general-purpose: 通用编码任务（完整工具集），可读写文件

use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::model::{ChatMessage, ModelRouter};
use crate::security::{AuditEntry, PermissionDecision, SecurityManager};
use crate::tools::{global_cancelled, PermissionClass, Tool, ToolRegistry};

// ───────────────── 执行流透出 ─────────────────

/// 子代理内部步骤的执行流管道：既发实时「思考流」事件，也固化进 assistant 消息的
/// 执行流 trace（经 AppState 的思考日志），让「并行子代理」期间的过程在执行流中可见。
#[derive(Clone, Default)]
pub struct SubAgentTrace {
    app: Option<AppHandle>,
}

impl SubAgentTrace {
    pub fn enabled(app: AppHandle) -> Self {
        Self { app: Some(app) }
    }

    pub fn emit(&self, kind: &str, label: impl Into<String>, detail: impl Into<String>) {
        let Some(app) = &self.app else { return };
        let label = label.into();
        let detail = detail.into();
        let _ = app.emit("thought", json!({ "kind": kind, "label": label, "detail": detail }));
        // 固化到执行流 trace（回放执行流可回看）
        if let Some(state) = app.try_state::<crate::AppState>() {
            state.log_thought(kind, &label, &detail);
        }
    }

    /// 权限审批需要向主窗口发事件，复用 trace 持有的应用句柄
    fn app_handle(&self) -> Option<&AppHandle> {
        self.app.as_ref()
    }
}

/// 截断长文本（保持执行流条目轻量）
fn trunc(s: &str, n: usize) -> String {
    let mut out: String = s.chars().take(n).collect();
    if s.chars().count() > n {
        out.push('…');
    }
    out
}

// ───────────────── 子代理类型 ─────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SubAgentType {
    /// 快速代码库搜索：Glob, Grep, LS, Read
    #[serde(rename = "search")]
    Search,
    /// 深度代码探索：搜索 + 多步文件读取，可追踪引用关系
    #[serde(rename = "code-explorer")]
    CodeExplorer,
    /// 通用编码任务：完整工具集，可读写文件
    #[serde(rename = "general-purpose")]
    GeneralPurpose,
}

impl SubAgentType {
    pub fn label(&self) -> &str {
        match self {
            SubAgentType::Search => "搜索",
            SubAgentType::CodeExplorer => "代码探索",
            SubAgentType::GeneralPurpose => "通用任务",
        }
    }

    /// 审计与持久化用的稳定标识（与 serde rename 一致）
    fn slug(&self) -> &'static str {
        match self {
            SubAgentType::Search => "search",
            SubAgentType::CodeExplorer => "code-explorer",
            SubAgentType::GeneralPurpose => "general-purpose",
        }
    }

    /// 返回该类型允许的工具名列表
    fn allowed_tools(&self) -> Vec<&str> {
        match self {
            SubAgentType::Search => {
                vec!["list_files", "read_file", "search_files", "get_file_info", "list_allowed_directories", "list_directory", "list_directory_with_sizes", "directory_tree"]
            }
            SubAgentType::CodeExplorer => {
                vec!["list_files", "read_file", "search_files", "get_file_info", "list_allowed_directories", "list_directory", "list_directory_with_sizes", "directory_tree", "rag_search"]
            }
            SubAgentType::GeneralPurpose => {
                vec!["list_files", "read_file", "search_files", "get_file_info", "list_allowed_directories", "list_directory", "list_directory_with_sizes", "directory_tree", "write_file", "edit_file", "create_directory", "move_file", "run_command", "rag_search", "rag_index", "read_screen", "capture_screen"]
            }
        }
    }

    /// 系统提示词
    fn system_prompt(&self) -> &str {
        match self {
            SubAgentType::Search => {
                "你是一个专业的代码库搜索助手。你的任务是快速搜索代码库，找到相关文件、函数、类或模式。\n\
                 规则：\n\
                 1. 只使用搜索和读取工具，不要修改任何文件\n\
                 2. 用多轮搜索逐步缩小范围\n\
                 3. 发现关键信息后立即读取相关文件\n\
                 4. 最后返回一个简洁的摘要，列出找到的所有相关文件和关键代码位置\n\
                 5. 不要提问，直接完成任务并返回结果"
            }
            SubAgentType::CodeExplorer => {
                "你是一个代码库探索专家。你的任务是深入理解代码库的某个模块或功能。\n\
                 规则：\n\
                 1. 从搜索关键符号开始，逐步追踪引用和依赖关系\n\
                 2. 读取所有相关文件，理解完整的调用链\n\
                 3. 分析代码结构、设计模式和潜在问题\n\
                 4. 最后返回一个结构化的分析报告，包含：模块概览、关键文件、数据流、设计模式\n\
                 5. 不要修改任何文件，只做分析和报告"
            }
            SubAgentType::GeneralPurpose => {
                "你是一个全栈软件工程师。你的任务是完成用户分配的编程任务。\n\
                 规则：\n\
                 1. 先理解任务目标，再搜索相关代码\n\
                 2. 制定修改计划，然后执行\n\
                 3. 修改代码后验证正确性\n\
                 4. 最后返回一个总结，说明完成了什么、修改了哪些文件\n\
                 5. 保持修改最小化，不要过度工程化"
            }
        }
    }
}

// ───────────────── 子代理结果 ─────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubAgentResult {
    pub agent_type: String,
    pub task: String,
    pub summary: String,
    pub files_examined: Vec<String>,
    pub success: bool,
    pub duration_ms: u64,
}

// ───────────────── 并发治理 ─────────────────
//
// 子代理会**并行打模型接口**。没有上限的话，模型一句"帮我并行查 20 处"
// 就能同时发起 20 个请求，把配额、内存和本地 embedding 一起压垮。
// 这里给三道闸：全局并发、单批数量、单个超时。

/// 同时运行的上限。超出的排队，不一起冲。
///
/// 取 4 是因为：主 Agent 自己还在跑，再叠加 4 个子代理已经能明显缩短长任务，
/// 又不会让本地模型（单卡）排队到超时。想更激进可以调大，但要同步看显存。
const MAX_CONCURRENT_SUBAGENTS: usize = 4;

/// 一次派发最多接受多少个。多的截断并如实报告，不静默丢。
const MAX_SUBAGENT_BATCH: usize = 8;

/// 执行记录保留条数（超出按时间裁剪）
const SUBAGENT_RUN_KEEP: usize = 300;

/// 单个子代理的墙钟超时（秒）。
///
/// 按「每轮一次模型调用」估算：search 6 轮、code-explorer 10 轮、
/// general-purpose 12 轮。给每轮 45 秒的余量，冷启动的本地模型也够。
const fn subagent_timeout_secs(t: &SubAgentType) -> u64 {
    let rounds = match t {
        SubAgentType::Search => 6,
        SubAgentType::CodeExplorer => 10,
        SubAgentType::GeneralPurpose => 12,
    };
    rounds * 45
}

/// 全局并发闸门：所有子代理共用，跨批次也生效。
fn subagent_slots() -> &'static tokio::sync::Semaphore {
    static SLOTS: std::sync::OnceLock<tokio::sync::Semaphore> = std::sync::OnceLock::new();
    SLOTS.get_or_init(|| tokio::sync::Semaphore::new(MAX_CONCURRENT_SUBAGENTS))
}

// ───────────────── 权限：子代理与主 Agent 走同一套 SecurityManager ─────────────────
//
// 之前子代理直接调 tools.run，绕过了整个权限体系——general-purpose 白名单里有
// run_command / write_file，主 Agent 一次 spawn_subagent 就能无审批执行任意命令。
// 现在每次子代理工具调用都过 classify；需要人工审批时走与主循环相同的
// 前端审批卡 + IM 推送 + 升级通知链，等不到批准按拒绝处理，并全部落审计。

/// 子代理内审批等待上限。
///
/// 故意比主循环的 15 分钟短：spawn_subagent 被派发层 600s 工具超时罩着，
/// 等太久整个子代理会先被外层超时丢弃，用户批准了也没有效果。
/// 用户就在发起任务的会话旁边（否则不会触发子代理），2 分钟足够响应。
const SUBAGENT_APPROVAL_TIMEOUT: Duration = Duration::from_secs(120);

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn audit_subagent_call(
    store: Option<&crate::memory::MemoryStore>,
    agent_type: SubAgentType,
    tool_name: &str,
    args: &Value,
    decision: &str,
    result: &Value,
) {
    let Some(store) = store else { return };
    let entry = AuditEntry {
        ts: now_ms(),
        subject: format!("subagent:{}", agent_type.slug()),
        tool: tool_name.to_string(),
        args: args.clone(),
        decision: decision.to_string(),
        result: result.to_string(),
    };
    if let Err(e) = store.add_audit(&entry) {
        eprintln!("[子代理] 写审计失败: {e}");
    }
}

/// 工具执行统一放 blocking 线程池：子代理跑在 async 上下文里，
/// 直接调 tools.run 会阻塞 tokio worker 线程（run_command 一次就是几秒）。
async fn run_tool_blocking(tools: &ToolRegistry, tool_name: &str, args: &Value) -> Value {
    let Some(tool) = tools.get(tool_name) else {
        return json!({ "error": format!("工具不存在: {tool_name}") });
    };
    let args = args.clone();
    match tokio::task::spawn_blocking(move || tool.run(args)).await {
        Ok(Ok(v)) => v,
        Ok(Err(e)) => json!({ "error": e }),
        Err(e) => json!({ "error": format!("工具执行失败: {e}") }),
    }
}

/// 审批等待：与主循环 wait_for_decision_with_escalation 相同的
/// 「升级通知 + 轮询决策」结构，但上限取 SUBAGENT_APPROVAL_TIMEOUT。
async fn wait_subagent_decision(
    app: &AppHandle,
    security: &SecurityManager,
    escalation: &Arc<crate::notify::EscalationManager>,
    cancel: &std::sync::atomic::AtomicBool,
    id: &str,
    what: &str,
    detail: &str,
) -> bool {
    use std::sync::atomic::Ordering;
    let _ = escalation.start_escalation(app, id, what, detail);
    let deadline = tokio::time::Instant::now() + SUBAGENT_APPROVAL_TIMEOUT;
    loop {
        if let Some(d) = security.decision(id) {
            escalation.cancel_escalation(id);
            return d;
        }
        if cancel.load(Ordering::SeqCst) || global_cancelled() {
            escalation.cancel_escalation(id);
            return false;
        }
        if tokio::time::Instant::now() > deadline {
            escalation.cancel_escalation(id);
            return false; // 超时默认拒绝
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

/// 一次子代理工具调用的完整链路：classify → （审批）→ 执行 → 审计。
/// 返回值直接回填给子代理模型的 tool 消息。
async fn run_subagent_tool_checked(
    trace: &SubAgentTrace,
    agent_type: SubAgentType,
    tool_name: &str,
    args: &Value,
    tools: &ToolRegistry,
    store: Option<&crate::memory::MemoryStore>,
) -> Value {
    // 权限检查依赖 AppState（SecurityManager / IM 总线 / 升级通知）。
    // 拿不到时宁可拒绝：检查缺失不能静默放行。
    let unavailable = || {
        let out = json!({"error": "权限检查不可用（应用状态缺失），此调用已拒绝"});
        audit_subagent_call(store, agent_type, tool_name, args, "denied", &out);
        out
    };
    let Some(app) = trace.app_handle().cloned() else {
        return unavailable();
    };
    let Some(state) = app.try_state::<crate::AppState>() else {
        return unavailable();
    };

    // 白名单已由调用方过滤；这里取工具声明的权限级别，未知工具按高危处理
    let class = tools
        .get(tool_name)
        .map(|t| t.permission())
        .unwrap_or(PermissionClass::HighRisk);

    match state.security.classify(tool_name, args, class) {
        PermissionDecision::AutoAllow => {
            let out = run_tool_blocking(tools, tool_name, args).await;
            audit_subagent_call(store, agent_type, tool_name, args, "auto-allow", &out);
            out
        }
        PermissionDecision::AutoDeny => {
            let out = json!({"error": "用户此前已记住拒绝此类操作，本次自动拒绝"});
            audit_subagent_call(store, agent_type, tool_name, args, "denied", &out);
            out
        }
        PermissionDecision::Prompt(req) => {
            trace.emit(
                "subagent",
                format!("子代理[{}] 请求审批 · {}", agent_type.label(), tool_name),
                trunc(&args.to_string(), 240).to_string(),
            );
            let _ = app.emit("permission-request", &req);
            let what = format!("子代理[{}]请求使用工具 {}", agent_type.label(), tool_name);
            let detail = trunc(&args.to_string(), 400).to_string();
            let channels = state.im_bus.push_approval(&req.id, &what, &detail).await;
            let _ = app.emit(
                "permission-channel",
                json!({ "approval_id": req.id, "channels": channels }),
            );
            let approved = wait_subagent_decision(
                &app,
                &state.security,
                &state.escalation,
                state.cancel.as_ref(),
                &req.id,
                &what,
                &detail,
            )
            .await;
            if approved {
                let out = run_tool_blocking(tools, tool_name, args).await;
                audit_subagent_call(store, agent_type, tool_name, args, "approved", &out);
                out
            } else {
                let out = json!({"error": "用户未批准此操作（拒绝或超时）。请改用其他方式完成任务，或在摘要中说明该步骤未能执行"});
                audit_subagent_call(store, agent_type, tool_name, args, "denied", &out);
                out
            }
        }
    }
}

// ───────────────── 子代理执行器 ─────────────────

/// 启动一个子代理，执行任务并返回结果（内部步骤经 trace 透出到执行流）
pub async fn run_subagent(
    agent_type: SubAgentType,
    task: &str,
    model: &ModelRouter,
    tools: &ToolRegistry,
    trace: &SubAgentTrace,
    store: Option<Arc<crate::memory::MemoryStore>>,
) -> SubAgentResult {
    trace.emit(
        "subagent",
        format!("子代理[{}] 启动", agent_type.label()),
        trunc(task, 120).to_string(),
    );
    // 拿并发槽位：超出的在这里排队，而不是同时开新请求
    let permit = subagent_slots().acquire().await;
    if permit.is_err() {
        return SubAgentResult {
            agent_type: agent_type.label().to_string(),
            task: task.to_string(),
            summary: "子代理调度器已关闭".to_string(),
            files_examined: Vec::new(),
            success: false,
            duration_ms: 0,
        };
    }

    // 超时兜底：卡住的子代理不会把整轮对话无限拖死
    let limit = std::time::Duration::from_secs(subagent_timeout_secs(&agent_type));
    let result = match tokio::time::timeout(
        limit,
        run_subagent_inner(agent_type, task, model, tools, trace, store.as_deref()),
    )
    .await
    {
        Ok(r) => r,
        Err(_) => SubAgentResult {
            agent_type: agent_type.label().to_string(),
            task: task.to_string(),
            summary: format!("子代理超时（{}s），已中止。可以缩小任务范围后重试", limit.as_secs()),
            files_examined: Vec::new(),
            success: false,
            duration_ms: limit.as_millis() as u64,
        },
    };
    drop(permit);
    let status = if result.success { "完成" } else { "失败" };
    trace.emit(
        "subagent",
        format!("子代理[{}] {}", agent_type.label(), status),
        format!("{} · {:.1}s", trunc(&result.summary, 100), result.duration_ms as f64 / 1000.0),
    );
    persist_subagent_run(store.as_deref(), &result);
    result
}

/// 把一次子代理执行写进 `subagent_runs`。
///
/// 失败只打印不 panic：审计是附加价值，不能因为它让子代理本身失败。
/// 同时做一次裁剪，保留最近 [`SUBAGENT_RUN_KEEP`] 条，避免长期使用无限增长。
fn persist_subagent_run(
    store: Option<&crate::memory::MemoryStore>,
    result: &SubAgentResult,
) {
    let Some(store) = store else { return };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let id = format!("sa_{}_{}", now, &result.agent_type);
    let data = match serde_json::to_string(result) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[子代理] 序列化执行记录失败: {e}");
            return;
        }
    };
    if let Err(e) = store.upsert_subagent_run(&id, &result.agent_type, now, &data) {
        eprintln!("[子代理] 写执行记录失败: {e}");
        return;
    }
    if let Err(e) = store.trim_subagent_runs(SUBAGENT_RUN_KEEP) {
        eprintln!("[子代理] 裁剪执行记录失败: {e}");
    }
}

async fn run_subagent_inner(
    agent_type: SubAgentType,
    task: &str,
    model: &ModelRouter,
    tools: &ToolRegistry,
    trace: &SubAgentTrace,
    store: Option<&crate::memory::MemoryStore>,
) -> SubAgentResult {
    let start = std::time::Instant::now();
    let system_prompt = agent_type.system_prompt();
    let allowed = agent_type.allowed_tools();

    let mut messages: Vec<ChatMessage> = vec![
        ChatMessage {
            role: "system".into(),
            content: system_prompt.into(),
            tool_calls: None,
            tool_call_id: None,
        },
        ChatMessage {
            role: "user".into(),
            content: task.to_string(),
            tool_calls: None,
            tool_call_id: None,
        },
    ];

    let max_rounds = match agent_type {
        SubAgentType::Search => 6,
        SubAgentType::CodeExplorer => 10,
        SubAgentType::GeneralPurpose => 12,
    };

    let mut files_examined: Vec<String> = Vec::new();

    for round in 0..max_rounds {
        // 用户点击停止：立即终止子代理，不再发起下一轮模型请求
        if global_cancelled() {
            return SubAgentResult {
                agent_type: agent_type.label().to_string(),
                task: task.to_string(),
                summary: "已被用户停止".to_string(),
                files_examined,
                success: false,
                duration_ms: start.elapsed().as_millis() as u64,
            };
        }
        // 调用模型
        let schemas = tools.schemas_filtered(&allowed);
        let resp = match model.chat(&messages, &schemas).await {
            Ok(r) => r,
            Err(e) => {
                return SubAgentResult {
                    agent_type: agent_type.label().to_string(),
                    task: task.to_string(),
                    summary: format!("子代理出错: {e}"),
                    files_examined,
                    success: false,
                    duration_ms: start.elapsed().as_millis() as u64,
                };
            }
        };

        // 如果有 tool_calls，执行它们
        if let Some(ref tool_calls) = resp.tool_calls {
            let assistant_msg = ChatMessage {
                role: "assistant".into(),
                content: resp.content.unwrap_or_default(),
                tool_calls: Some(tool_calls.clone()),
                tool_call_id: None,
            };
            messages.push(assistant_msg);

            for tc in tool_calls {
                // 停止请求：跳过本子代理剩余工具调用
                if global_cancelled() {
                    break;
                }
                let tool_name = tc["function"]["name"].as_str().unwrap_or("unknown");
                let args_str = tc["function"]["arguments"].as_str().unwrap_or("{}");
                let args: Value = serde_json::from_str(args_str).unwrap_or(Value::Null);
                let tc_id = tc["id"].as_str().unwrap_or("").to_string();

                // 内部步骤透出到执行流：实时思考流 + trace 固化，让用户看见子代理在做什么
                trace.emit(
                    "tool_call",
                    format!("子代理[{}] · {}", agent_type.label(), tool_name),
                    trunc(args_str, 240),
                );

                let result = if allowed.contains(&tool_name) {
                    run_subagent_tool_checked(trace, agent_type, tool_name, &args, tools, store)
                        .await
                } else {
                    json!({"error": format!("子代理类型 {} 不允许使用工具 {}", agent_type.label(), tool_name)})
                };

                trace.emit(
                    "tool_result",
                    format!("工具完成 · 子代理[{}] · {}", agent_type.label(), tool_name),
                    trunc(&result.to_string(), 400),
                );

                // 记录被检查的文件
                if tool_name == "read_file" || tool_name == "search_files" || tool_name == "list_files" {
                    if let Some(path) = args.get("file_path").or_else(|| args.get("path")).and_then(|v| v.as_str()) {
                        if !files_examined.contains(&path.to_string()) {
                            files_examined.push(path.to_string());
                        }
                    }
                }

                messages.push(ChatMessage {
                    role: "tool".into(),
                    content: result.to_string(),
                    tool_calls: None,
                    tool_call_id: Some(tc_id),
                });
            }
        } else {
            // 没有 tool_calls，模型返回最终答案
            let summary = resp.content.unwrap_or_else(|| "子代理完成但未返回内容".to_string());
            return SubAgentResult {
                agent_type: agent_type.label().to_string(),
                task: task.to_string(),
                summary,
                files_examined,
                success: true,
                duration_ms: start.elapsed().as_millis() as u64,
            };
        }

        // 安全检查：如果连续多轮没有进展，尽早退出
        if round >= max_rounds - 1 {
            // 最后一轮：让模型总结
            messages.push(ChatMessage {
                role: "user".into(),
                content: "请总结你的发现，返回一个简洁的摘要。".to_string(),
                tool_calls: None,
                tool_call_id: None,
            });
            let final_resp = match model.chat(&messages, &[]).await {
                Ok(r) => r.content.unwrap_or_else(|| "子代理超时".to_string()),
                Err(e) => format!("子代理总结失败: {e}"),
            };
            return SubAgentResult {
                agent_type: agent_type.label().to_string(),
                task: task.to_string(),
                summary: final_resp,
                files_examined,
                success: true,
                duration_ms: start.elapsed().as_millis() as u64,
            };
        }
    }

    SubAgentResult {
        agent_type: agent_type.label().to_string(),
        task: task.to_string(),
        summary: "子代理达到最大轮数但未返回最终结果".to_string(),
        files_examined,
        success: false,
        duration_ms: start.elapsed().as_millis() as u64,
    }
}

// ───────────────── spawn_subagent 工具 ─────────────────

/// 解析子代理类型参数（供工具与运行期共用）
pub fn parse_agent_type(args: &Value) -> Result<SubAgentType, String> {
    match args["subagent_type"].as_str() {
        Some("search") => Ok(SubAgentType::Search),
        Some("code-explorer") => Ok(SubAgentType::CodeExplorer),
        Some("general-purpose") => Ok(SubAgentType::GeneralPurpose),
        other => Err(format!("未知的子代理类型: {other:?}")),
    }
}

/// spawn_subagent 工具：主 Agent 调用此工具启动子代理并同步等待其结果。
/// 单个子代理在此工具内联执行（block_on）；当一轮内派发多个子代理时，
/// 由 AgentLoop 运行期改走 execute_subagents_parallel 并发执行。
pub struct SpawnSubAgentTool {
    model: Arc<ModelRouter>,
    tools: Arc<ToolRegistry>,
    trace: SubAgentTrace,
    /// 落库用：单发路径同样要记执行记录（实测漏过一次——
    /// 只给并行批次传了 store，单发跑完 ok=true 但表里没有行）
    store: Option<Arc<crate::memory::MemoryStore>>,
}

impl SpawnSubAgentTool {
    pub fn new(
        model: Arc<ModelRouter>,
        tools: Arc<ToolRegistry>,
        trace: SubAgentTrace,
        store: Option<Arc<crate::memory::MemoryStore>>,
    ) -> Self {
        Self {
            model,
            tools,
            trace,
            store,
        }
    }
}

impl Tool for SpawnSubAgentTool {
    fn name(&self) -> &str {
        "spawn_subagent"
    }
    fn description(&self) -> &str {
        "启动一个子代理来执行独立的子任务。子代理拥有自己的上下文和工具集，\
         它跑几十轮搜索/读文件也不会污染主对话历史——这正是它存在的理由。\n\
         \n\
         【什么时候该用】满足任意一条就值得用：\n\
         1. 需要在大型代码库里做**发散搜索**（不确定在哪个文件），预计要读 5 个以上文件；\n\
         2. 有 **2 个以上互不依赖**的子问题，可以并行（例：同时查「鉴权在哪实现」和「日志怎么落盘」）；\n\
         3. 需要**深挖一个模块**的调用链，会反复搜索+读取，过程冗长但结论很短；\n\
         4. 主对话只想拿到**结论**，不需要中间那几十条搜索记录。\n\
         \n\
         【什么时候不该用】\n\
         - 你已经知道文件路径，直接 read_file 更快；\n\
         - 任务只有一步（改一行、看一眼），子代理的启动开销大于收益；\n\
         - 需要**中途向用户确认**的事——子代理不能提问，只能闷头做完；\n\
         - 有严格顺序依赖的步骤（B 必须等 A 的结果），拆开并行没有意义。\n\
         \n\
         【三种类型怎么选】\n\
         - search：只是「找到在哪」，返回文件与位置清单。最快，6 轮上限；\n\
         - code-explorer：要「讲清楚怎么运作」，会追引用链、给结构化分析。10 轮上限；\n\
         - general-purpose：要「动手改」，有完整读写工具。12 轮上限。\n\
         拿不准就先 search，不够再升级。\n\
         \n\
         【并行与限制】同一轮里派发多个即可并行，最多 8 个/批、同时最多 4 个在跑，\
         超出的排队。每个子代理有按类型计算的超时（search 约 4.5 分钟，general-purpose 约 9 分钟），\
         超时会被中止并标记失败。所以任务描述要**具体且可独立完成**，别写「帮我看看代码」这种。"
    }
    fn schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "subagent_type": {
                    "type": "string",
                    "enum": ["search", "code-explorer", "general-purpose"],
                    "description": "子代理类型"
                },
                "description": {
                    "type": "string",
                    "description": "简短描述（3-5个字），用于日志标识"
                },
                "task": {
                    "type": "string",
                    "description": "详细的任务说明，子代理将独立完成此任务"
                }
            },
            "required": ["subagent_type", "description", "task"]
        })
    }
    fn permission(&self) -> PermissionClass {
        // 基础级别：search / code-explorer 是纯只读，自动放行。
        // general-purpose 会被 runtime 侧的 spawn_permission_class 升级为 HighRisk，
        // 且子代理内部每次工具调用还会再过一遍 SecurityManager（双重闸门）。
        PermissionClass::ReadOnly
    }
    fn run(&self, args: Value) -> Result<Value, String> {
        let agent_type = parse_agent_type(&args)?;
        let task = args["task"]
            .as_str()
            .ok_or("缺少 task 参数")?
            .to_string();

        // run 是同步的（spawn_blocking 线程内执行），用 block_on 同步等待异步子代理跑完
        let model = self.model.clone();
        let tools = self.tools.clone();
        let trace = self.trace.clone();
        let store = self.store.clone();
        let result = tauri::async_runtime::block_on(async move {
            run_subagent(agent_type, &task, &model, &tools, &trace, store).await
        });

        Ok(json!({
            "ok": result.success,
            "agent_type": result.agent_type,
            "summary": result.summary,
            "files_examined": result.files_examined,
            "duration_ms": result.duration_ms,
        }))
    }
}

/// spawn_subagent 的权限级别（主循环派发时用）：
/// general-purpose 子代理可执行命令 / 写文件，派发本身必须经用户审批（HighRisk）；
/// search / code-explorer 只读，保持自动放行。
///
/// 这不是可有可无的形式主义：子代理内部的白名单对 general-purpose 包含
/// run_command / write_file / edit_file / move_file，如果不审批派发动作，
/// 用户甚至不知道一个有写能力的子代理已经启动了。
pub fn spawn_permission_class(args: &Value) -> PermissionClass {
    match parse_agent_type(args) {
        Ok(SubAgentType::GeneralPurpose) => PermissionClass::HighRisk,
        _ => PermissionClass::ReadOnly,
    }
}

/// 批量并行执行多个子代理
pub async fn execute_subagents_parallel(
    specs: Vec<(SubAgentType, String)>,
    model: Arc<ModelRouter>,
    tools: Arc<ToolRegistry>,
    trace: SubAgentTrace,
    store: Option<Arc<crate::memory::MemoryStore>>,
) -> Vec<SubAgentResult> {
    if specs.len() > MAX_SUBAGENT_BATCH {
        let dropped = specs.len() - MAX_SUBAGENT_BATCH;
        trace.emit(
            "subagent",
            "派发数量超限",
            format!(
                "一次最多 {} 个子代理，已截断 {} 个；请分批派发",
                MAX_SUBAGENT_BATCH, dropped
            ),
        );
    }
    let specs: Vec<_> = specs.into_iter().take(MAX_SUBAGENT_BATCH).collect();
    let futures: Vec<_> = specs
        .into_iter()
        .map(|(agent_type, task)| {
            let model = model.clone();
            let tools = tools.clone();
            let trace = trace.clone();
            let store = store.clone();
            tokio::spawn(async move {
                run_subagent(agent_type, &task, &model, &tools, &trace, store).await
            })
        })
        .collect();

    let mut results = Vec::new();
    for f in futures {
        match f.await {
            Ok(r) => results.push(r),
            Err(e) => results.push(SubAgentResult {
                agent_type: "unknown".to_string(),
                task: "".to_string(),
                summary: format!("子代理 panic: {e}"),
                files_examined: vec![],
                success: false,
                duration_ms: 0,
            }),
        }
    }
    results
}

// ───────────────── 只读查询命令 ─────────────────

/// 子代理执行记录（只读）。
///
/// 为什么要这个：`files_examined` 这类字段以前任务结束就没了，
/// 事后查不到"它当时到底搜了什么、读了哪些文件"。落库 + 这个命令之后，
/// 子代理这条链路才真正可审计。
///
/// `agent_type` 传空表示不过滤；结果按时间倒序。
#[tauri::command]
pub fn subagent_runs(
    state: tauri::State<'_, crate::AppState>,
    agent_type: Option<String>,
    limit: Option<usize>,
) -> serde_json::Value {
    let filter = agent_type.unwrap_or_default();
    let limit = limit.unwrap_or(100).clamp(1, 500);
    let rows = match state
        .store
        .list_subagent_runs(filter.trim(), limit)
    {
        Ok(r) => r,
        Err(e) => {
            return serde_json::json!({ "count": 0, "items": [], "error": e });
        }
    };
    let items: Vec<serde_json::Value> = rows
        .into_iter()
        .filter_map(|(id, kind, started_at, data)| {
            let parsed: serde_json::Value = serde_json::from_str(&data).ok()?;
            Some(serde_json::json!({
                "id": id,
                "agent_type": kind,
                "started_at": started_at,
                "task": parsed.get("task").cloned().unwrap_or_default(),
                "summary": parsed.get("summary").cloned().unwrap_or_default(),
                "files_examined": parsed.get("files_examined").cloned().unwrap_or_default(),
                "success": parsed.get("success").cloned().unwrap_or_default(),
                "duration_ms": parsed.get("duration_ms").cloned().unwrap_or_default(),
            }))
        })
        .collect();
    serde_json::json!({ "count": items.len(), "items": items })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 超时必须随类型递增：general-purpose 跑得最久，给它最短的超时会误杀。
    #[test]
    fn timeout_grows_with_agent_type() {
        let search = subagent_timeout_secs(&SubAgentType::Search);
        let explorer = subagent_timeout_secs(&SubAgentType::CodeExplorer);
        let general = subagent_timeout_secs(&SubAgentType::GeneralPurpose);
        assert!(search < explorer, "code-explorer 的轮次比 search 多");
        assert!(explorer < general, "general-purpose 的轮次最多");
        // 至少给到每轮 30 秒，否则本地模型冷启动就会被超时打断
        assert!(search >= 6 * 30);
    }

    /// 并发上限必须 > 1（否则"并行"没有意义），但也必须有限（否则打爆配额）。
    #[test]
    fn concurrency_is_bounded_but_useful() {
        assert!(MAX_CONCURRENT_SUBAGENTS > 1);
        assert!(MAX_CONCURRENT_SUBAGENTS <= 8);
        assert!(MAX_SUBAGENT_BATCH >= MAX_CONCURRENT_SUBAGENTS);
    }

    /// 信号量是全局单例：两次取到的必须是同一个（否则上限形同虚设）。
    #[test]
    fn slots_are_global() {
        let a = subagent_slots() as *const _;
        let b = subagent_slots() as *const _;
        assert_eq!(a, b);
        assert_eq!(subagent_slots().available_permits(), MAX_CONCURRENT_SUBAGENTS);
    }

    /// general-purpose 子代理可执行命令/写文件，派发必须走审批；
    /// 只读类型保持自动放行，否则「并行搜个代码」也要用户点确认。
    #[test]
    fn spawn_permission_escalates_only_general_purpose() {
        let general = json!({ "subagent_type": "general-purpose", "task": "x" });
        let search = json!({ "subagent_type": "search", "task": "x" });
        let explorer = json!({ "subagent_type": "code-explorer", "task": "x" });
        let broken = json!({});
        assert_eq!(spawn_permission_class(&general), PermissionClass::HighRisk);
        assert_eq!(spawn_permission_class(&search), PermissionClass::ReadOnly);
        assert_eq!(spawn_permission_class(&explorer), PermissionClass::ReadOnly);
        // 解析失败的参数按只读处理（后续 parse 时会报错），不因权限逻辑崩溃
        assert_eq!(spawn_permission_class(&broken), PermissionClass::ReadOnly);
    }
}