import { useCallback, useEffect, useRef, useState } from "react";
import {
  jobHuntConfigGet,
  jobHuntConfigSet,
  jobHuntResumePreview,
  jobHuntTaskPrompt,
  jobHuntWaitStart,
  jobHuntWaitStop,
  jobHuntWaitState,
  type JobWaitState,
} from "../../engine/api";

/**
 * 求职投递配置页。
 *
 * 用户在这里填：目标岗位 / 城市 / 薪资 / 学历经验 / 排除关键词 / 多份简历 /
 * 投递平台（复选）/ 单次上限 / 注意事项 / 回复口吻。
 *
 * 保存后配置落到 settings 表的 `job_hunt_config`，与后端的 job_hunt_* 工具
 * 共用同一份 JSON——面板改了，模型立刻能读到，不存在两套配置。
 */

type ResumeEntry = {
  label: string;
  path: string;
  note: string;
  primary: boolean;
};

type JobHuntConfig = {
  enabled: boolean;
  job_titles: string[];
  cities: string[];
  salary_range: string;
  education: string;
  experience: string;
  exclude_keywords: string[];
  resumes: ResumeEntry[];
  platforms: string[];
  daily_limit: number;
  notes: string;
  reply_style: string;
  auto_reply: boolean;
};

type PlatformOption = { id: string; label: string; hint: string };

const EMPTY: JobHuntConfig = {
  enabled: false,
  job_titles: [],
  cities: [],
  salary_range: "",
  education: "",
  experience: "",
  exclude_keywords: [],
  resumes: [],
  platforms: [],
  daily_limit: 20,
  notes: "",
  reply_style: "",
  auto_reply: false,
};

/** 逗号/顿号/换行分隔的文本 ↔ 字符串数组 */
const splitList = (s: string) =>
  s
    .split(/[,，、\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

const field: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: "var(--box-solid)",
  border: "1px solid var(--border-soft)",
  borderRadius: 8,
  color: "inherit",
  fontSize: 13,
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  opacity: 0.72,
  marginBottom: 4,
  marginTop: 12,
};

const rowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 12,
};

const btn: React.CSSProperties = {
  padding: "7px 14px",
  borderRadius: 8,
  border: "1px solid var(--border-soft)",
  background: "var(--box-solid)",
  color: "inherit",
  cursor: "pointer",
  fontSize: 13,
};

export default function JobHuntPanel({ onSend }: { onSend?: (text: string) => void }) {
  const [cfg, setCfg] = useState<JobHuntConfig>(EMPTY);
  const [platforms, setPlatforms] = useState<PlatformOption[]>([]);
  const [ready, setReady] = useState(false);
  const [missing, setMissing] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ label: string; text: string } | null>(null);

  // 等待回复：后台监控状态 + 本地倒计时
  const [wait, setWait] = useState<JobWaitState | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const waitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 文本框用本地字符串暂存，失焦/保存时再切成数组，避免每敲一个字符就重建数组
  const [titlesText, setTitlesText] = useState("");
  const [citiesText, setCitiesText] = useState("");
  const [excludeText, setExcludeText] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await jobHuntConfigGet();
      const c = { ...EMPTY, ...(r.config as JobHuntConfig) };
      setCfg(c);
      setPlatforms((r.platforms as PlatformOption[]) ?? []);
      setReady(Boolean(r.ready));
      setMissing(String(r.missing ?? ""));
      setTitlesText((c.job_titles ?? []).join("、"));
      setCitiesText((c.cities ?? []).join("、"));
      setExcludeText((c.exclude_keywords ?? []).join("、"));
    } catch (e) {
      setNote(`读取配置失败：${String(e)}`);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 等待回复：进入面板时同步一次后台状态；运行中每 5 秒刷新，顺便驱动倒计时
  useEffect(() => {
    let cancelled = false;
    void jobHuntWaitState()
      .then((s) => {
        if (!cancelled) setWait(s);
      })
      .catch(() => {});

    waitTimerRef.current = setInterval(() => {
      setNowTick(Date.now());
      void jobHuntWaitState()
        .then((s) => {
          if (!cancelled) setWait(s);
        })
        .catch(() => {});
    }, 5000);

    return () => {
      cancelled = true;
      if (waitTimerRef.current) clearInterval(waitTimerRef.current);
    };
  }, []);

  const startWait = async () => {
    setBusy(true);
    setNote("");
    try {
      const s = await jobHuntWaitStart(30);
      setWait(s);
      setNote("已开始等待回复，最多 30 分钟。期间可以正常做别的事。");
    } catch (e) {
      setNote(`无法开始等待：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const stopWait = async () => {
    setBusy(true);
    try {
      const s = await jobHuntWaitStop();
      setWait(s);
      setNote("已停止等待回复。");
    } catch (e) {
      setNote(`停止失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const patch = (p: Partial<JobHuntConfig>) => setCfg((c) => ({ ...c, ...p }));

  const togglePlatform = (id: string) => {
    setCfg((c) => ({
      ...c,
      platforms: c.platforms.includes(id)
        ? c.platforms.filter((x) => x !== id)
        : [...c.platforms, id],
    }));
  };

  const updateResume = (i: number, p: Partial<ResumeEntry>) => {
    setCfg((c) => ({
      ...c,
      resumes: c.resumes.map((r, idx) => (idx === i ? { ...r, ...p } : r)),
    }));
  };

  const setPrimary = (i: number) => {
    setCfg((c) => ({
      ...c,
      resumes: c.resumes.map((r, idx) => ({ ...r, primary: idx === i })),
    }));
  };

  const save = async () => {
    setBusy(true);
    setNote("");
    try {
      const payload: JobHuntConfig = {
        ...cfg,
        job_titles: splitList(titlesText),
        cities: splitList(citiesText),
        exclude_keywords: splitList(excludeText),
      };
      const r = await jobHuntConfigSet(payload);
      setCfg(payload);
      setReady(Boolean(r.ready));
      setMissing(String(r.missing ?? ""));
      setNote(r.ready ? "已保存，配置就绪，可以下发投递任务了。" : `已保存，但还差：${r.missing}`);
    } catch (e) {
      setNote(`保存失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const doPreview = async (i: number) => {
    setBusy(true);
    try {
      const r = await jobHuntResumePreview(i + 1);
      setPreview({ label: String(r.label || `简历 ${i + 1}`), text: String(r.text || "") });
    } catch (e) {
      setPreview({ label: "读取失败", text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const startTask = async () => {
    setBusy(true);
    try {
      const prompt = await jobHuntTaskPrompt();
      if (onSend) {
        onSend(prompt);
        setNote("已把投递任务下发到对话。");
      } else {
        setNote(prompt);
      }
    } catch (e) {
      setNote(`无法开始：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-page" style={{ display: "block" }}>
      <section style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 12, marginTop: 8 }}>
        <h4 style={{ margin: "4px 0 8px", color: "#f97316" }}>求职投递</h4>
        <p style={{ fontSize: 12, opacity: 0.7, margin: "0 0 12px", lineHeight: 1.7 }}>
          填好下面的要求后，在对话里说「<b>投递简历</b>」或点下方「开始投递」，FLUX 会带着这份配置
          去各平台搜索、筛选、投递，并按你设定的口吻回复 HR。简历文件不会被复制进数据库，只记录路径。
        </p>

        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
          启用求职投递
        </label>

        {cfg.enabled && (
          <>
            <label style={labelStyle}>目标岗位（多个用顿号/逗号分隔）</label>
            <input
              style={field}
              value={titlesText}
              onChange={(e) => setTitlesText(e.target.value)}
              placeholder="运维工程师、系统运维、IT 支持"
            />

            <div style={rowStyle}>
              <div>
                <label style={labelStyle}>目标城市</label>
                <input
                  style={field}
                  value={citiesText}
                  onChange={(e) => setCitiesText(e.target.value)}
                  placeholder="成都、重庆"
                />
              </div>
              <div>
                <label style={labelStyle}>期望薪资</label>
                <input
                  style={field}
                  value={cfg.salary_range}
                  onChange={(e) => patch({ salary_range: e.target.value })}
                  placeholder="6-9K"
                />
              </div>
            </div>

            <div style={rowStyle}>
              <div>
                <label style={labelStyle}>学历要求</label>
                <input
                  style={field}
                  value={cfg.education}
                  onChange={(e) => patch({ education: e.target.value })}
                  placeholder="本科"
                />
              </div>
              <div>
                <label style={labelStyle}>经验要求</label>
                <input
                  style={field}
                  value={cfg.experience}
                  onChange={(e) => patch({ experience: e.target.value })}
                  placeholder="3-5 年"
                />
              </div>
            </div>

            <label style={labelStyle}>排除关键词（命中就跳过，如外包、培训、驻场）</label>
            <input
              style={field}
              value={excludeText}
              onChange={(e) => setExcludeText(e.target.value)}
              placeholder="外包、培训、驻场、派遣"
            />

            <label style={labelStyle}>投递平台（可多选）</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 2 }}>
              {platforms.map((p) => (
                <label
                  key={p.id}
                  title={p.hint}
                  style={{
                    display: "flex",
                    gap: 6,
                    alignItems: "center",
                    padding: "6px 10px",
                    background: "var(--box-solid)",
                    borderRadius: 8,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={cfg.platforms.includes(p.id)}
                    onChange={() => togglePlatform(p.id)}
                  />
                  {p.label}
                </label>
              ))}
            </div>

            <label style={labelStyle}>简历（可多份，填本机文件绝对路径：pdf / docx / md / txt）</label>
            {cfg.resumes.map((r, i) => (
              <div
                key={i}
                style={{
                  border: "1px solid var(--border-soft)",
                  borderRadius: 8,
                  padding: 10,
                  marginBottom: 10,
                  background: "var(--box-solid)",
                }}
              >
                <div style={rowStyle}>
                  <input
                    style={field}
                    value={r.label}
                    onChange={(e) => updateResume(i, { label: e.target.value })}
                    placeholder="名称，如「运维版」"
                  />
                  <input
                    style={field}
                    value={r.path}
                    onChange={(e) => updateResume(i, { path: e.target.value })}
                    placeholder="C:\\Users\\你\\简历\\运维版.pdf"
                  />
                </div>
                <textarea
                  style={{ ...field, marginTop: 8, minHeight: 54, resize: "vertical" }}
                  value={r.note}
                  onChange={(e) => updateResume(i, { note: e.target.value })}
                  placeholder="这份简历的定位：投什么岗位、突出什么、别投什么"
                />
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                  <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                    <input
                      type="radio"
                      name="primary-resume"
                      checked={r.primary}
                      onChange={() => setPrimary(i)}
                    />
                    默认简历
                  </label>
                  <button type="button" style={btn} onClick={() => void doPreview(i)} disabled={busy}>
                    预览正文
                  </button>
                  <button
                    type="button"
                    style={{ ...btn, marginLeft: "auto", color: "#f87171" }}
                    onClick={() =>
                      setCfg((c) => ({ ...c, resumes: c.resumes.filter((_, idx) => idx !== i) }))
                    }
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              style={btn}
              onClick={() =>
                setCfg((c) => ({
                  ...c,
                  resumes: [
                    ...c.resumes,
                    { label: "", path: "", note: "", primary: c.resumes.length === 0 },
                  ],
                }))
              }
            >
              + 添加简历
            </button>

            <div style={rowStyle}>
              <div>
                <label style={labelStyle}>单次最多投递（家）</label>
                <input
                  style={field}
                  type="number"
                  min={1}
                  max={200}
                  value={cfg.daily_limit}
                  onChange={(e) => patch({ daily_limit: Number(e.target.value) || 1 })}
                />
              </div>
              <div>
                <label style={labelStyle}>回复口吻</label>
                <input
                  style={field}
                  value={cfg.reply_style}
                  onChange={(e) => patch({ reply_style: e.target.value })}
                  placeholder="自然、简洁、礼貌"
                />
              </div>
            </div>

            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginTop: 12 }}>
              <input
                type="checkbox"
                checked={cfg.auto_reply}
                onChange={(e) => patch({ auto_reply: e.target.checked })}
              />
              允许自动回复 HR 消息（关闭则只汇总、不代回）
            </label>

            <label style={labelStyle}>注意事项 / 红线（原样交给模型）</label>
            <textarea
              style={{ ...field, minHeight: 72, resize: "vertical" }}
              value={cfg.notes}
              onChange={(e) => patch({ notes: e.target.value })}
              placeholder="例如：只投正式编制，不投外包；不要承诺到岗时间；薪资低于 6K 直接跳过"
            />
          </>
        )}

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 16 }}>
          <button type="button" style={{ ...btn, fontWeight: 600 }} onClick={() => void save()} disabled={busy}>
            保存配置
          </button>
          <button
            type="button"
            style={btn}
            onClick={() => void startTask()}
            disabled={busy || !cfg.enabled}
          >
            开始投递
          </button>
          {wait?.running ? (
            <button type="button" style={{ ...btn, color: "#f87171" }} onClick={() => void stopWait()} disabled={busy}>
              停止等待
            </button>
          ) : (
            <button
              type="button"
              style={btn}
              onClick={() => void startWait()}
              disabled={busy || !cfg.enabled}
            >
              等待回复（30 分钟）
            </button>
          )}
          <span
            style={{
              fontSize: 12,
              color: ready ? "#4ade80" : "#fbbf24",
              marginLeft: "auto",
            }}
          >
            {ready ? "配置就绪" : missing ? `还差：${missing}` : ""}
          </span>
        </div>

        {wait?.running && (
          <div
            style={{
              marginTop: 12,
              padding: "10px 12px",
              borderRadius: 8,
              background: "rgba(74,222,128,0.08)",
              border: "1px solid rgba(74,222,128,0.25)",
              fontSize: 12,
              lineHeight: 1.8,
            }}
          >
            <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ color: "#4ade80", fontWeight: 600 }}>● 正在等待 HR 回复</span>
              <span>剩余 {Math.max(0, Math.ceil((wait.deadline_ms - nowTick) / 60000))} 分钟</span>
              <span>已检查 {wait.rounds} 轮</span>
              <span>收到 {wait.replies} 条回复</span>
            </div>
            {wait.last_note && <div style={{ opacity: 0.75, marginTop: 4 }}>{wait.last_note}</div>}
          </div>
        )}

        {note && (
          <pre
            style={{
              marginTop: 12,
              padding: 10,
              background: "var(--box-solid)",
              borderRadius: 8,
              fontSize: 12,
              whiteSpace: "pre-wrap",
              maxHeight: 220,
              overflow: "auto",
            }}
          >
            {note}
          </pre>
        )}

        {preview && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
              简历预览 · {preview.label}
            </div>
            <pre
              style={{
                padding: 10,
                background: "var(--box-solid)",
                borderRadius: 8,
                fontSize: 12,
                whiteSpace: "pre-wrap",
                maxHeight: 260,
                overflow: "auto",
              }}
            >
              {preview.text}
            </pre>
            <button type="button" style={btn} onClick={() => setPreview(null)}>
              关闭预览
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
