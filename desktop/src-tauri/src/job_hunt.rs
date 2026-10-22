//! 求职投递：配置存储 + 简历读取 + 投递任务下发。
//!
//! 用户先在这里配置求职要求（多份简历、投递平台、筛选条件、注意事项），
//! 之后用一条命令触发投递任务，FLUX 拿着这份配置去各平台投递并回复 HR。
//!
//! 设计取舍：
//! - 配置存 settings 表（key = `job_hunt_config`），单条 JSON，读写简单、迁移方便；
//! - 简历**不复制**进数据库，只存路径 + 解析出的摘要。简历是用户的敏感文件，
//!   原样留在用户自己的目录里，FLUX 需要时按路径读取；
//! - 配置读写走独立 Tauri 命令（前端面板用），投递任务走工具（Agent 用），
//!   两边共用同一个 [`JobHuntConfig`] 结构，不会出现「面板改了但工具读不到」。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::memory::MemoryStore;
use crate::tools::{PermissionClass, Tool};

/// settings 表里的键名
pub const CONFIG_KEY: &str = "job_hunt_config";

/// 一份简历：路径 + 用户写的补充说明（不复制文件内容进库）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ResumeEntry {
    /// 展示名（用户自己起，如「运维版」「通用版」）
    #[serde(default)]
    pub label: String,
    /// 简历文件的绝对路径（pdf / docx / md / txt）
    #[serde(default)]
    pub path: String,
    /// 这份简历的定位说明：投什么岗位、突出什么、别投什么
    #[serde(default)]
    pub note: String,
    /// 是否为默认投递简历
    #[serde(default)]
    pub primary: bool,
}

/// 投递平台（复选项）。id 用固定英文键，label 给用户看。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlatformOption {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub hint: String,
}

/// 内置支持的平台。新增平台时只在这里加一项，前端自动出现对应复选框。
pub fn platform_catalog() -> Vec<PlatformOption> {
    vec![
        PlatformOption {
            id: "boss".into(),
            label: "BOSS直聘".into(),
            hint: "zhipin.com".into(),
        },
        PlatformOption {
            id: "zhilian".into(),
            label: "智联招聘".into(),
            hint: "zhaopin.com".into(),
        },
        PlatformOption {
            id: "51job".into(),
            label: "前程无忧".into(),
            hint: "51job.com".into(),
        },
        PlatformOption {
            id: "lagou".into(),
            label: "拉勾".into(),
            hint: "lagou.com".into(),
        },
        PlatformOption {
            id: "liepin".into(),
            label: "猎聘".into(),
            hint: "liepin.com".into(),
        },
        PlatformOption {
            id: "yupao".into(),
            label: "鱼泡直聘".into(),
            hint: "yupao.com".into(),
        },
    ]
}

/// 求职配置（整体存为一条 JSON）
///
/// 注意：`Default` 必须手写，不能 derive。`#[serde(default = "...")]` 只在
/// **反序列化缺字段**时生效；derive 出来的 `Default` 会给 `daily_limit = 0`，
/// 于是「新建配置」直接变成「投 0 家」。两者必须对齐。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobHuntConfig {
    /// 是否启用（关闭时触发命令会直接拒绝）
    #[serde(default)]
    pub enabled: bool,
    /// 目标岗位关键词，如 ["运维工程师", "系统运维"]
    #[serde(default)]
    pub job_titles: Vec<String>,
    /// 目标城市
    #[serde(default)]
    pub cities: Vec<String>,
    /// 期望薪资区间（文本，避免各平台格式不一）
    #[serde(default)]
    pub salary_range: String,
    /// 学历 / 经验要求（如「本科」「3-5年」）
    #[serde(default)]
    pub education: String,
    #[serde(default)]
    pub experience: String,
    /// 排除关键词：公司名或岗位名里含这些就不投（如「外包」「培训」「驻场」）
    #[serde(default)]
    pub exclude_keywords: Vec<String>,
    /// 简历列表（可多份）
    #[serde(default)]
    pub resumes: Vec<ResumeEntry>,
    /// 选中的投递平台 id
    #[serde(default)]
    pub platforms: Vec<String>,
    /// 每次任务最多投递多少家（防止失控刷屏）
    #[serde(default = "default_daily_limit")]
    pub daily_limit: u32,
    /// 注意事项 / 用户红线（原样注入给模型）
    #[serde(default)]
    pub notes: String,
    /// 自动回复 HR 时的口吻与边界
    #[serde(default)]
    pub reply_style: String,
    /// 是否允许自动回复 HR 消息
    #[serde(default)]
    pub auto_reply: bool,
}

fn default_daily_limit() -> u32 {
    20
}

impl Default for JobHuntConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            job_titles: Vec::new(),
            cities: Vec::new(),
            salary_range: String::new(),
            education: String::new(),
            experience: String::new(),
            exclude_keywords: Vec::new(),
            resumes: Vec::new(),
            platforms: Vec::new(),
            // 与 #[serde(default = "default_daily_limit")] 保持一致
            daily_limit: default_daily_limit(),
            notes: String::new(),
            reply_style: String::new(),
            auto_reply: false,
        }
    }
}

impl JobHuntConfig {
    /// 从 settings 读取；不存在或解析失败返回默认（未启用）
    pub fn load(store: &MemoryStore) -> Self {
        store
            .get_setting(CONFIG_KEY)
            .ok()
            .flatten()
            .and_then(|raw| serde_json::from_str::<JobHuntConfig>(&raw).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, store: &MemoryStore) -> Result<(), String> {
        let raw = serde_json::to_string(self).map_err(|e| format!("序列化失败: {e}"))?;
        store.set_setting(CONFIG_KEY, &raw)
    }

    /// 配置是否足够发起一次投递任务；返回缺失项说明
    pub fn validate(&self) -> Result<(), String> {
        if !self.enabled {
            return Err("求职投递未启用：请先在设置里打开「求职投递」并保存配置。".into());
        }
        if self.job_titles.is_empty() {
            return Err("还没有填写目标岗位：请至少填一个岗位关键词（如「运维工程师」）。".into());
        }
        if self.platforms.is_empty() {
            return Err("还没有选择投递平台：请至少勾选一个平台。".into());
        }
        if self.resumes.is_empty() {
            return Err("还没有添加简历：请至少添加一份简历并填写文件路径。".into());
        }
        let has_existing = self
            .resumes
            .iter()
            .any(|r| !r.path.trim().is_empty() && Path::new(r.path.trim()).is_file());
        if !has_existing {
            return Err(
                "简历文件都不存在：请检查配置里的简历路径是否正确（需要 .pdf / .docx / .md / .txt 文件）。"
                    .into(),
            );
        }
        Ok(())
    }

    /// 默认简历：优先 primary，其次第一份路径存在的
    pub fn primary_resume(&self) -> Option<&ResumeEntry> {
        self.resumes
            .iter()
            .find(|r| r.primary && Path::new(r.path.trim()).is_file())
            .or_else(|| self.resumes.iter().find(|r| Path::new(r.path.trim()).is_file()))
    }

    /// 生成给模型看的配置摘要（投递任务开始时注入）
    pub fn brief(&self) -> String {
        let platforms = self
            .platforms
            .iter()
            .map(|id| {
                // 必须带上域名：模型只认得主流平台的网址，冷门平台（如鱼泡）只给中文名
                // 它不知道去哪打开，就会静默跳过——这正是「勾了两个平台只投了一个」的原因。
                platform_catalog()
                    .into_iter()
                    .find(|p| &p.id == id)
                    .map(|p| format!("{}（{}）", p.label, p.hint))
                    .unwrap_or_else(|| id.clone())
            })
            .collect::<Vec<_>>()
            .join("、");
        let resumes = self
            .resumes
            .iter()
            .map(|r| {
                let mark = if r.primary { "（默认）" } else { "" };
                format!(
                    "- {}{}：{}{}",
                    if r.label.is_empty() { "未命名简历" } else { &r.label },
                    mark,
                    r.path,
                    if r.note.is_empty() {
                        String::new()
                    } else {
                        format!("\n  定位：{}", r.note)
                    }
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        // 逐个平台列出「名称 + 网址 + 该平台要不要处理」，用编号形式逼模型逐条过，
        // 避免它只挑自己熟悉的平台、把其余静默跳过。
        let platform_plan = if self.platforms.is_empty() {
            "（未选）".to_string()
        } else {
            self.platforms
                .iter()
                .enumerate()
                .map(|(i, id)| {
                    match platform_catalog().into_iter().find(|p| &p.id == id) {
                        Some(p) => format!(
                            "  {}. {} —— https://www.{}  （必须打开并投递）",
                            i + 1,
                            p.label,
                            p.hint
                        ),
                        None => format!("  {}. {} （未知平台，按 id 自行搜索）", i + 1, id),
                    }
                })
                .collect::<Vec<_>>()
                .join("\n")
        };
        format!(
            "【求职配置】\n\
             目标岗位：{}\n\
             城市：{}\n\
             薪资：{}\n\
             学历/经验：{} {}\n\
             排除关键词：{}\n\
             投递平台：{}\n\
             【平台清单（共 {} 个，每个都必须处理，一个都不能跳过）】\n{}\n\
             单次上限：{} 家\n\
             自动回复 HR：{}\n\
             简历：\n{}\n\
             注意事项：{}\n\
             回复口吻：{}",
            if self.job_titles.is_empty() {
                "（未填）".to_string()
            } else {
                self.job_titles.join("、")
            },
            if self.cities.is_empty() {
                "（不限）".to_string()
            } else {
                self.cities.join("、")
            },
            if self.salary_range.is_empty() { "（不限）" } else { &self.salary_range },
            if self.education.is_empty() { "（不限）" } else { &self.education },
            if self.experience.is_empty() { "（不限）" } else { &self.experience },
            if self.exclude_keywords.is_empty() {
                "（无）".to_string()
            } else {
                self.exclude_keywords.join("、")
            },
            if platforms.is_empty() { "（未选）".to_string() } else { platforms },
            self.platforms.len(),
            platform_plan,
            self.daily_limit,
            if self.auto_reply { "允许" } else { "不允许（只投递，不代回）" },
            if resumes.is_empty() { "（未添加）".to_string() } else { resumes },
            if self.notes.trim().is_empty() { "（无）" } else { self.notes.trim() },
            if self.reply_style.trim().is_empty() {
                "自然、简洁、礼貌"
            } else {
                self.reply_style.trim()
            },
        )
    }
}

// ───────────────────── 简历读取 ─────────────────────

/// 支持的简历扩展名
fn resume_ext_ok(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .as_deref(),
        Some("pdf" | "docx" | "md" | "txt" | "markdown")
    )
}

/// 读取简历纯文本，供模型「查看简历补充信息」。
///
/// 复用现有的文档解析链（`read_document` 覆盖 pdf/docx，纯文本直接读），
/// 不在本模块重复实现一套解析。返回 (文本, 截断标记)。
pub fn read_resume_text(path: &str, max_chars: usize) -> Result<(String, bool), String> {
    let p = PathBuf::from(path.trim());
    if !p.is_file() {
        return Err(format!("简历文件不存在：{}", p.display()));
    }
    if !resume_ext_ok(&p) {
        return Err(format!(
            "不支持的简历格式：{}（支持 pdf / docx / md / txt）",
            p.display()
        ));
    }
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let text = match ext.as_str() {
        "md" | "markdown" | "txt" => {
            std::fs::read_to_string(&p).map_err(|e| format!("读取简历失败：{e}"))?
        }
        _ => {
            // 复用现有文档解析链（read_document 覆盖 pdf/docx），不在本模块重复造解析器
            let resp = crate::read_document::run(json!({
                "path": p.to_string_lossy(),
                "extract_text": true,
                "extract_tables": false,
                "extract_images": false,
                "recursive": false,
                "max_chars": max_chars.max(4000),
            }))
            .map_err(|e| format!("解析简历失败（{ext}）：{e}"))?;
            collect_document_text(&resp)
        }
    };
    let count = text.chars().count();
    if count > max_chars {
        Ok((text.chars().take(max_chars).collect(), true))
    } else {
        Ok((text, false))
    }
}

/// 从 read_document 的返回里拼出纯文本。
/// 它的返回结构是 `{files:[{path, text, ...}], ...}`，不同解析器字段略有差异，
/// 这里按「有 text 用 text，否则拼 tables」兜底，取不到就返回空串。
fn collect_document_text(resp: &Value) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(files) = resp.get("files").and_then(|v| v.as_array()) {
        for f in files {
            if let Some(t) = f.get("text").and_then(|v| v.as_str()) {
                if !t.trim().is_empty() {
                    parts.push(t.to_string());
                    continue;
                }
            }
            if let Some(tables) = f.get("tables").and_then(|v| v.as_array()) {
                for t in tables {
                    parts.push(t.to_string());
                }
            }
        }
    }
    if parts.is_empty() {
        if let Some(t) = resp.get("text").and_then(|v| v.as_str()) {
            parts.push(t.to_string());
        }
    }
    parts.join("\n")
}

// ───────────────────── 工具 ─────────────────────

/// 工具：读取求职配置与简历内容（只读）。
/// 投递任务开始时模型先调它，拿到「投什么、投哪、用什么简历、有什么红线」。
pub struct JobHuntBriefTool {
    store: std::sync::Arc<MemoryStore>,
}

impl JobHuntBriefTool {
    pub fn new(store: std::sync::Arc<MemoryStore>) -> Self {
        Self { store }
    }
}

impl Tool for JobHuntBriefTool {
    fn name(&self) -> &str {
        "job_hunt_brief"
    }

    fn description(&self) -> &str {
        "读取用户配置的求职要求（目标岗位、城市、薪资、排除关键词、投递平台、注意事项）\
         以及每份简历的定位说明；可选读取某份简历的正文内容用于补充信息。\
         用户下发「投递简历」类任务时，先调用本工具拿全配置，再开始操作浏览器。只读，无需授权。"
    }

    fn schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "include_resume_text": {
                    "type": "boolean",
                    "description": "是否同时返回简历正文（默认 false，只看配置与路径；需要核对简历里写了什么时再开）"
                },
                "resume_index": {
                    "type": "number",
                    "description": "要读取正文的简历序号（从 1 开始，对应返回里的 resumes[i].index）。省略则读默认简历"
                },
                "max_chars": {
                    "type": "number",
                    "description": "简历正文最多返回多少字（默认 4000，上限 12000）"
                }
            }
        })
    }

    fn permission(&self) -> PermissionClass {
        PermissionClass::ReadOnly
    }

    fn run(&self, args: Value) -> Result<Value, String> {
        let cfg = JobHuntConfig::load(&self.store);
        let include_text = args["include_resume_text"].as_bool().unwrap_or(false);
        let max_chars = args["max_chars"]
            .as_u64()
            .unwrap_or(4000)
            .clamp(500, 12_000) as usize;

        let resumes: Vec<Value> = cfg
            .resumes
            .iter()
            .enumerate()
            .map(|(i, r)| {
                let exists = !r.path.trim().is_empty() && Path::new(r.path.trim()).is_file();
                json!({
                    "index": i + 1,
                    "label": r.label,
                    "path": r.path,
                    "note": r.note,
                    "primary": r.primary,
                    "exists": exists,
                })
            })
            .collect();

        let mut out = json!({
            "ok": true,
            "enabled": cfg.enabled,
            "job_titles": cfg.job_titles,
            "cities": cfg.cities,
            "salary_range": cfg.salary_range,
            "education": cfg.education,
            "experience": cfg.experience,
            "exclude_keywords": cfg.exclude_keywords,
            "platforms": cfg.platforms,
            "daily_limit": cfg.daily_limit,
            "notes": cfg.notes,
            "reply_style": cfg.reply_style,
            "auto_reply": cfg.auto_reply,
            "resumes": resumes,
        });

        if let Err(e) = cfg.validate() {
            out["warning"] = json!(e);
        }

        if include_text {
            let picked = match args["resume_index"].as_u64() {
                Some(n) if n >= 1 => cfg.resumes.get(n as usize - 1),
                _ => cfg.primary_resume(),
            };
            match picked {
                Some(r) => match read_resume_text(&r.path, max_chars) {
                    Ok((text, truncated)) => {
                        out["resume_text"] = json!({
                            "label": r.label,
                            "path": r.path,
                            "truncated": truncated,
                            "text": text,
                        });
                    }
                    Err(e) => out["resume_text_error"] = json!(e),
                },
                None => out["resume_text_error"] = json!("没有可读取的简历（未配置或文件不存在）"),
            }
        }

        Ok(out)
    }
}

/// 工具：校验配置是否足以开始投递（只读，轻量）。
/// 模型在真正开浏览器前调一次，避免配置不全时白跑一轮。
pub struct JobHuntReadyTool {
    store: std::sync::Arc<MemoryStore>,
}

impl JobHuntReadyTool {
    pub fn new(store: std::sync::Arc<MemoryStore>) -> Self {
        Self { store }
    }
}

impl Tool for JobHuntReadyTool {
    fn name(&self) -> &str {
        "job_hunt_ready"
    }

    fn description(&self) -> &str {
        "检查求职投递配置是否完整（是否启用、岗位/平台/简历是否齐备、简历文件是否真实存在），\
         返回 ready 与缺失项。投递任务开始前调用一次；ready=false 时不要开浏览器，直接告诉用户缺什么。"
    }

    fn schema(&self) -> Value {
        json!({ "type": "object", "properties": {} })
    }

    fn permission(&self) -> PermissionClass {
        PermissionClass::ReadOnly
    }

    fn run(&self, _args: Value) -> Result<Value, String> {
        let cfg = JobHuntConfig::load(&self.store);
        match cfg.validate() {
            Ok(()) => Ok(json!({
                "ok": true,
                "ready": true,
                "platforms": cfg.platforms,
                "job_titles": cfg.job_titles,
                "daily_limit": cfg.daily_limit,
                "brief": cfg.brief(),
            })),
            Err(e) => Ok(json!({
                "ok": true,
                "ready": false,
                "missing": e,
                "hint": "请让用户在「设置 → 求职投递」里补齐配置后再试。",
            })),
        }
    }
}

/// 工具：记录一条投递结果（写操作，落库便于复盘与去重）。
pub struct JobHuntRecordTool {
    store: std::sync::Arc<MemoryStore>,
}

impl JobHuntRecordTool {
    pub fn new(store: std::sync::Arc<MemoryStore>) -> Self {
        Self { store }
    }
}

impl Tool for JobHuntRecordTool {
    fn name(&self) -> &str {
        "job_hunt_record"
    }

    fn description(&self) -> &str {
        "记录一条简历投递结果（公司、岗位、平台、状态、链接、备注），落库供复盘和避免重复投递。\
         每投完一家就记一条；状态用 applied / skipped / failed / replied。"
    }

    fn schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "company": { "type": "string", "description": "公司名" },
                "title": { "type": "string", "description": "岗位名" },
                "platform": { "type": "string", "description": "平台 id（boss / zhilian / 51job / lagou / liepin / yupao）" },
                "status": { "type": "string", "enum": ["applied", "skipped", "failed", "replied"], "description": "投递状态" },
                "url": { "type": "string", "description": "岗位或会话链接（可选）" },
                "note": { "type": "string", "description": "备注：为什么跳过/失败原因/HR 回复要点" }
            },
            "required": ["company", "status"]
        })
    }

    fn permission(&self) -> PermissionClass {
        PermissionClass::Write
    }

    fn run(&self, args: Value) -> Result<Value, String> {
        let company = args["company"].as_str().unwrap_or("").trim();
        if company.is_empty() {
            return Err("缺少参数 company（公司名）".into());
        }
        let status = args["status"].as_str().unwrap_or("applied");
        let title = args["title"].as_str().unwrap_or("");
        let platform = args["platform"].as_str().unwrap_or("");
        let url = args["url"].as_str().unwrap_or("");
        let note = args["note"].as_str().unwrap_or("");

        let content = format!(
            "投递记录：{company} · {title} · 平台 {platform} · 状态 {status}\n链接：{url}\n备注：{note}"
        );
        self.store
            .smart_remember(&content, "job_apply")
            .map_err(|e| format!("写入投递记录失败: {e}"))?;
        Ok(json!({ "ok": true, "recorded": true }))
    }
}

/// 工具：查看最近投递记录（只读），用于避免重复投递同一家。
pub struct JobHuntHistoryTool {
    store: std::sync::Arc<MemoryStore>,
}

impl JobHuntHistoryTool {
    pub fn new(store: std::sync::Arc<MemoryStore>) -> Self {
        Self { store }
    }
}

impl Tool for JobHuntHistoryTool {
    fn name(&self) -> &str {
        "job_hunt_history"
    }

    fn description(&self) -> &str {
        "查看最近的简历投递记录（公司/岗位/状态），用于避免重复投递同一家公司。只读。"
    }

    fn schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "limit": { "type": "number", "description": "返回多少条（默认 30，上限 100）" }
            }
        })
    }

    fn permission(&self) -> PermissionClass {
        PermissionClass::ReadOnly
    }

    fn run(&self, args: Value) -> Result<Value, String> {
        let limit = args["limit"].as_u64().unwrap_or(30).clamp(1, 100) as usize;
        // recall_by_kind 需要一段查询文本用于语义排序；这里只要「最近/最相关」，
        // 用一个覆盖岗位语境的短句即可，不追求精确匹配。
        let rows = self
            .store
            .recall_by_kind("简历投递 公司 岗位 状态", "job_apply", limit)
            .unwrap_or_default();
        let items: Vec<Value> = rows
            .into_iter()
            .take(limit)
            .map(|r| {
                json!({
                    "content": r.content,
                    "salience": r.salience,
                    "last_access": r.last_access,
                })
            })
            .collect();
        Ok(json!({ "ok": true, "count": items.len(), "items": items }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store(tag: &str) -> MemoryStore {
        let dir = std::env::temp_dir().join(format!(
            "flux-jobhunt-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("t.db");
        let _ = std::fs::remove_file(&path);
        MemoryStore::open(path.to_string_lossy().as_ref()).expect("打开临时库失败")
    }

    #[test]
    fn config_roundtrip_and_defaults() {
        let store = temp_store("roundtrip");
        let cfg = JobHuntConfig::load(&store);
        assert!(!cfg.enabled, "默认未启用");
        assert_eq!(cfg.daily_limit, 20, "默认单次上限 20");

        let mut cfg = cfg;
        cfg.enabled = true;
        cfg.job_titles = vec!["运维工程师".into()];
        cfg.platforms = vec!["boss".into()];
        cfg.save(&store).unwrap();

        let back = JobHuntConfig::load(&store);
        assert!(back.enabled);
        assert_eq!(back.job_titles, vec!["运维工程师".to_string()]);
        assert_eq!(back.platforms, vec!["boss".to_string()]);
    }

    #[test]
    fn validate_rejects_incomplete_config() {
        let mut cfg = JobHuntConfig::default();
        assert!(cfg.validate().is_err(), "未启用应被拒绝");

        cfg.enabled = true;
        assert!(cfg.validate().is_err(), "缺岗位应被拒绝");

        cfg.job_titles = vec!["运维".into()];
        assert!(cfg.validate().is_err(), "缺平台应被拒绝");

        cfg.platforms = vec!["boss".into()];
        assert!(cfg.validate().is_err(), "缺简历应被拒绝");

        cfg.resumes = vec![ResumeEntry {
            label: "通用".into(),
            path: "C:/definitely/not/here.pdf".into(),
            ..Default::default()
        }];
        let err = cfg.validate().unwrap_err();
        assert!(err.contains("简历文件都不存在"), "路径不存在应被拒绝: {err}");
    }

    #[test]
    fn primary_resume_prefers_flagged_then_existing() {
        let dir = std::env::temp_dir().join(format!("flux-resume-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let a = dir.join("a.txt");
        let b = dir.join("b.txt");
        std::fs::write(&a, "A").unwrap();
        std::fs::write(&b, "B").unwrap();

        let cfg = JobHuntConfig {
            resumes: vec![
                ResumeEntry { path: a.to_string_lossy().into(), ..Default::default() },
                ResumeEntry {
                    path: b.to_string_lossy().into(),
                    primary: true,
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        assert_eq!(
            cfg.primary_resume().map(|r| r.path.clone()),
            Some(b.to_string_lossy().to_string()),
            "应优先选 primary"
        );
    }

    #[test]
    fn read_resume_text_reads_plain_text() {
        let dir = std::env::temp_dir().join(format!("flux-resume-read-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let p = dir.join("cv.md");
        std::fs::write(&p, "# 张三\n\n运维工程师，3 年经验").unwrap();

        let (text, truncated) = read_resume_text(&p.to_string_lossy(), 4000).unwrap();
        assert!(text.contains("运维工程师"));
        assert!(!truncated);

        let (short, cut) = read_resume_text(&p.to_string_lossy(), 5).unwrap();
        assert_eq!(short.chars().count(), 5);
        assert!(cut, "超出上限应标记截断");
    }

    #[test]
    fn brief_contains_key_fields() {
        let cfg = JobHuntConfig {
            enabled: true,
            job_titles: vec!["运维工程师".into()],
            cities: vec!["成都".into()],
            platforms: vec!["boss".into()],
            exclude_keywords: vec!["外包".into()],
            notes: "只投正式岗".into(),
            ..Default::default()
        };
        let b = cfg.brief();
        assert!(b.contains("运维工程师"));
        assert!(b.contains("成都"));
        assert!(b.contains("BOSS直聘"), "平台 id 应翻译成中文名");
        assert!(b.contains("外包"));
        assert!(b.contains("只投正式岗"));
    }

    /// 平台目录必须覆盖所有「可勾选」的平台 id，且每个 id 都能翻译成中文名。
    /// 新增平台时若只改了一处（如漏了 brief 的映射），这里会直接失败。
    #[test]
    fn platform_catalog_covers_all_ids() {
        let catalog = platform_catalog();
        let ids: Vec<String> = catalog.iter().map(|p| p.id.clone()).collect();
        for expected in ["boss", "zhilian", "51job", "lagou", "liepin", "yupao"] {
            assert!(ids.iter().any(|i| i == expected), "平台目录缺少 {expected}");
        }
        // 无重复 id
        let mut sorted = ids.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), ids.len(), "平台 id 不应重复");

        // 每个 id 都能在 brief 里翻译成 label（而不是原样输出 id）
        for item in &catalog {
            let cfg = JobHuntConfig {
                enabled: true,
                platforms: vec![item.id.clone()],
                ..Default::default()
            };
            let b = cfg.brief();
            assert!(
                b.contains(&item.label),
                "brief 应把平台 {} 翻译成「{}」",
                item.id,
                item.label
            );
        }
    }

    /// 鱼泡直聘必须在目录里，且 label 正确（本次新增的平台）
    #[test]
    fn yupao_platform_present() {
        let p = platform_catalog()
            .into_iter()
            .find(|p| p.id == "yupao")
            .expect("鱼泡直聘应已注册");
        assert_eq!(p.label, "鱼泡直聘");
        assert_eq!(p.hint, "yupao.com");
    }

    /// 回归测试：brief 必须同时给出平台中文名**和域名**，并逐个编号列出。
    ///
    /// 起因（2026-10-19）：用户勾选了 boss + yupao 两个平台，实际只投了 boss。
    /// 根因是 brief 里只写了「鱼泡直聘」没写域名，模型不知道去哪打开这个冷门平台，
    /// 就静默跳过了。这里锁死「每个平台都带 hint 域名 + 出现在平台清单里」。
    #[test]
    fn brief_lists_every_platform_with_domain() {
        let cfg = JobHuntConfig {
            enabled: true,
            job_titles: vec!["测试工程师".into()],
            platforms: vec!["boss".into(), "yupao".into()],
            ..Default::default()
        };
        let b = cfg.brief();

        // 两个平台的中文名都要出现
        assert!(b.contains("BOSS直聘"), "缺少 BOSS直聘");
        assert!(b.contains("鱼泡直聘"), "缺少 鱼泡直聘");

        // 两个平台的域名都要出现（这是模型能真正打开它们的关键）
        assert!(b.contains("zhipin.com"), "缺少 BOSS 域名");
        assert!(b.contains("yupao.com"), "缺少鱼泡域名");

        // 平台清单必须逐个编号，且明确「每个都必须处理」
        assert!(b.contains("平台清单"), "缺少平台清单段落");
        assert!(b.contains("必须打开并投递"), "缺少强制处理标记");
        assert!(b.contains("1. "), "平台清单应编号");
        assert!(b.contains("2. "), "两个平台应各自编号");
        assert!(b.contains("共 2 个"), "应标明平台总数");
    }

    /// 单个平台时也要带域名与清单，不能只在多平台时才生效
    #[test]
    fn brief_single_platform_still_has_domain() {
        let cfg = JobHuntConfig {
            enabled: true,
            platforms: vec!["yupao".into()],
            ..Default::default()
        };
        let b = cfg.brief();
        assert!(b.contains("yupao.com"), "单平台也必须带域名");
        assert!(b.contains("共 1 个"), "应标明平台总数");
    }
}
