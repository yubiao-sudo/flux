//! 英雄联盟赛事观察版数据源。
//!
//! 官方 `esports-api.lolesports.com` 现在需要 Riot API Key，未配置时一律 403。
//! 但 `lolesports.com/leagues` 的 Next.js SSR 页面里带着完整的 Apollo 缓存：
//! 联赛、赛季、赛程、队伍、比分、VOD、世界排名（GPR）都在
//! `window[Symbol.for("ApolloSSRDataTransport")].push(...)` 的那段 JS 对象里。
//! 这里直接抓页面、解析这段对象，既不需要 key，也不用浏览器 CORS。
//!
//! 数据窗口是官网当前赛季 + 最近一个窗口（含上一届 Worlds 决赛等），
//! 每次抓取 3 个入口：全部联赛、Worlds、MSI。

use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const LEAGUE_BASE: &str = "https://lolesports.com/en-US/leagues";
const PAGE_PATHS: &[&str] = &["", "/worlds", "/msi"];
const CACHE_TTL: Duration = Duration::from_secs(90);
const FETCH_TIMEOUT: Duration = Duration::from_secs(30);

static CACHE: Mutex<Option<(Instant, Value)>> = Mutex::new(None);

#[derive(Default)]
struct PageData {
    leagues: BTreeMap<String, Value>,
    seasons: BTreeMap<String, Value>,
    events: BTreeMap<String, Value>,
    gpr: BTreeMap<String, Value>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn https(url: &str) -> String {
    let s = url.trim();
    if let Some(rest) = s.strip_prefix("http://static.lolesports.com") {
        format!("https://static.lolesports.com{rest}")
    } else {
        s.to_string()
    }
}

fn text(v: &Value) -> String {
    v.as_str().unwrap_or("").to_string()
}

fn image(v: &Value) -> String {
    https(&text(v))
}

/// Apollo SSR 对象混在 `undefined` 和后续脚本之间；先把 `undefined` 换成 null，
/// 再用流式解析器只取第一个 JSON 对象（后面的 `T=performance.now()` 直接忽略）。
fn parse_apollo(html: &str) -> Result<Value, String> {
    let marker = "ApolloSSRDataTransport";
    let m = html.find(marker).ok_or("页面里没有 ApolloSSRDataTransport")?;
    let push = html[m..].find(".push(").map(|i| m + i + 6).ok_or("没有 .push(")?;
    let end = html[push..]
        .find(");</script>")
        .map(|i| push + i)
        .ok_or("没有 push 结束标记")?;
    let blob = &html[push..end];
    // 字符串里正常不会出现裸 undefined；这是最省事的 JS object -> JSON 转换。
    let cleaned = blob.replace("undefined", "null");
    let mut stream = serde_json::Deserializer::from_str(&cleaned).into_iter::<Value>();
    stream
        .next()
        .ok_or_else(|| "Apollo 数据为空".to_string())?
        .map_err(|e| format!("Apollo JSON 解析失败: {e}"))
}

fn normalize_league(v: &Value) -> Option<(String, Value)> {
    let id = v.get("id")?.as_str()?.to_string();
    let priority = v.get("displayPriority").cloned().unwrap_or(Value::Null);
    Some((
        id.clone(),
        json!({
            "id": id,
            "name": text(&v["name"]),
            "slug": text(&v["slug"]),
            "region": text(&v["region"]),
            "image": image(&v["image"]),
            "priority": priority.get("position").and_then(Value::as_u64).unwrap_or(99),
            "selected": priority.get("status").and_then(Value::as_str).unwrap_or(""),
        }),
    ))
}

fn normalize_season(v: &Value) -> Option<(String, Value)> {
    let id = v.get("id")?.as_str()?.to_string();
    let splits: Vec<Value> = v
        .get("splits")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .map(|s| {
                    json!({
                        "id": text(&s["id"]),
                        "name": text(&s["name"]),
                        "slug": text(&s["slug"]),
                        "startTime": text(&s["startTime"]),
                        "endTime": text(&s["endTime"]),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Some((
        id.clone(),
        json!({
            "id": id,
            "name": text(&v["name"]),
            "slug": text(&v["slug"]),
            "startTime": text(&v["startTime"]),
            "endTime": text(&v["endTime"]),
            "splits": splits,
        }),
    ))
}

fn normalize_games(match_obj: &Value) -> Vec<Value> {
    match_obj
        .get("games")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .map(|g| {
                    let trim = |key: &str| -> Vec<Value> {
                        g.get(key)
                            .and_then(Value::as_array)
                            .map(|vods| {
                                vods.iter()
                                    .map(|v| {
                                        json!({
                                            "id": text(&v["id"]),
                                            "parameter": text(&v["parameter"]),
                                            "startMillis": v.get("startMillis").and_then(Value::as_u64).unwrap_or(0),
                                            "endMillis": v.get("endMillis").and_then(Value::as_u64).unwrap_or(0),
                                        })
                                    })
                                    .collect()
                            })
                            .unwrap_or_default()
                    };
                    json!({
                        "number": g.get("number").and_then(Value::as_u64).unwrap_or(0),
                        "state": text(&g["state"]),
                        "vods": trim("vods"),
                        "recaps": trim("recaps"),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn normalize_event(v: &Value) -> Option<(String, Value)> {
    let id = v.get("id")?.as_str()?.to_string();
    let league = v.get("league").cloned().unwrap_or(Value::Null);
    let tournament = v.get("tournament").cloned().unwrap_or(Value::Null);
    let match_obj = v.get("match").cloned().unwrap_or(Value::Null);
    let teams: Vec<Value> = v
        .get("matchTeams")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .map(|t| {
                    let result = t.get("result").cloned().unwrap_or(Value::Null);
                    json!({
                        "id": text(&t["teamId"]),
                        "name": text(&t["name"]),
                        "code": text(&t["code"]),
                        "image": image(&t["image"]),
                        "lightImage": image(&t["lightImage"]),
                        "score": result.get("gameWins").and_then(Value::as_u64).unwrap_or(0),
                        "outcome": result.get("outcome").and_then(Value::as_str).unwrap_or(""),
                        "region": text(&t["homeLeague"]["regionSlug"]),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let streams: Vec<Value> = v
        .get("streams")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|s| {
                    let url = s.get("url").and_then(Value::as_str).unwrap_or("");
                    if url.is_empty() {
                        return None;
                    }
                    Some(json!({
                        "provider": text(&s["provider"]),
                        "url": url,
                        "language": text(&s["language"]),
                    }))
                })
                .collect()
        })
        .unwrap_or_default();
    let flags: Vec<String> = match_obj
        .get("flags")
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(|f| f.as_str().map(str::to_string)).collect())
        .unwrap_or_default();
    let best_of = match_obj
        .get("strategy")
        .and_then(|s| s.get("count"))
        .and_then(Value::as_u64)
        .unwrap_or(1);
    let start = text(&v["startTime"]);
    let year = start.get(0..4).unwrap_or("").to_string();
    Some((
        id.clone(),
        json!({
            "id": id,
            "startTime": start,
            "year": year,
            "state": text(&v["state"]),
            "blockName": text(&v["blockName"]),
            "bestOf": best_of,
            "hasVod": flags.iter().any(|f| f == "hasVod"),
            "league": {
                "id": text(&league["id"]),
                "name": text(&league["name"]),
                "slug": text(&league["slug"]),
                "region": text(&league["region"]),
                "image": image(&league["image"]),
            },
            "tournament": {
                "id": text(&tournament["id"]),
                "name": text(&tournament["name"]),
            },
            "teams": teams,
            "games": normalize_games(&match_obj),
            "streams": streams,
        }),
    ))
}

fn normalize_gpr(v: &Value) -> Option<(String, Value)> {
    let team = v.get("team")?;
    let team_id = team.get("id")?.as_str()?.to_string();
    let current = v.get("currentTeamGPR").cloned().unwrap_or(Value::Null);
    let record = v.get("teamMatchRecord").cloned().unwrap_or(Value::Null);
    let tournaments: Vec<Value> = v
        .get("tournaments")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .map(|t| {
                    let tournament = t.get("tournament").cloned().unwrap_or(Value::Null);
                    let standing: Vec<Value> = tournament
                        .get("standings")
                        .and_then(Value::as_array)
                        .map(|s| {
                            s.iter()
                                .map(|row| {
                                    json!({
                                        "teamId": text(&row["team"]["id"]),
                                        "placement": row.get("placement").and_then(Value::as_u64).unwrap_or(0),
                                    })
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    json!({
                        "tournament": {
                            "id": text(&tournament["id"]),
                            "name": text(&tournament["name"]),
                            "slug": text(&tournament["slug"]),
                            "startTime": text(&tournament["startTime"]),
                            "endTime": text(&tournament["endTime"]),
                            "state": text(&tournament["state"]),
                            "league": {
                                "id": text(&tournament["league"]["id"]),
                                "name": text(&tournament["league"]["name"]),
                            },
                        },
                        "record": {
                            "wins": t["tournamentRecord"]["wins"].as_u64().unwrap_or(0),
                            "losses": t["tournamentRecord"]["losses"].as_u64().unwrap_or(0),
                        },
                        "standings": standing,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Some((
        team_id.clone(),
        json!({
            "teamId": team_id,
            "team": {
                "id": team_id,
                "name": text(&team["name"]),
                "code": text(&team["code"]),
                "image": image(&team["image"]),
                "slug": text(&team["slug"]),
                "league": text(&team["homeLeague"]["name"]),
            },
            "rank": current.get("rank").and_then(Value::as_u64).unwrap_or(999),
            "gprScore": current.get("gprScore").and_then(Value::as_u64).unwrap_or(0),
            "elo": current.get("elo").and_then(Value::as_u64).unwrap_or(0),
            "wins": record.get("wins").and_then(Value::as_u64).unwrap_or(0),
            "losses": record.get("losses").and_then(Value::as_u64).unwrap_or(0),
            "tournaments": tournaments,
        }),
    ))
}

fn merge_page(html: &str, out: &mut PageData) -> Result<(), String> {
    let root = parse_apollo(html)?;
    let rehydrate = root
        .get("rehydrate")
        .and_then(Value::as_object)
        .ok_or("Apollo 数据缺少 rehydrate")?;
    for entry in rehydrate.values() {
        let Some(data) = entry.get("data") else { continue };
        if let Some(arr) = data.get("leagues").and_then(Value::as_array) {
            for v in arr {
                if let Some((id, n)) = normalize_league(v) {
                    out.leagues.insert(id, n);
                }
            }
        }
        if let Some(arr) = data.get("seasons").and_then(Value::as_array) {
            for v in arr {
                if let Some((id, n)) = normalize_season(v) {
                    out.seasons.insert(id, n);
                }
            }
        }
        if let Some(arr) = data.get("esports").and_then(|e| e.get("events")).and_then(Value::as_array) {
            for v in arr {
                if let Some((id, n)) = normalize_event(v) {
                    out.events.insert(id, n);
                }
            }
        }
        if let Some(arr) = data.get("teamGPR").and_then(Value::as_array) {
            for v in arr {
                if let Some((id, n)) = normalize_gpr(v) {
                    out.gpr.insert(id, n);
                }
            }
        }
    }
    Ok(())
}

fn fetch_page(client: &reqwest::blocking::Client, url: &str) -> Result<String, String> {
    let resp = client
        .get(url)
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .send()
        .map_err(|e| format!("请求 {url} 失败: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("请求 {url} 返回 HTTP {status}"));
    }
    resp.text().map_err(|e| format!("读取 {url} 失败: {e}"))
}

fn fetch_uncached() -> Result<Value, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 FLUX-Esports/1.0",
        )
        .timeout(FETCH_TIMEOUT)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let handles: Vec<_> = PAGE_PATHS
        .iter()
        .map(|path| {
            let client = client.clone();
            let url = format!("{LEAGUE_BASE}{path}");
            std::thread::spawn(move || fetch_page(&client, &url))
        })
        .collect();

    let mut merged = PageData::default();
    let mut errors: Vec<String> = Vec::new();
    for handle in handles {
        match handle.join() {
            Ok(Ok(html)) => {
                if let Err(e) = merge_page(&html, &mut merged) {
                    errors.push(e);
                }
            }
            Ok(Err(e)) => errors.push(e),
            Err(_) => errors.push("抓取线程异常退出".to_string()),
        }
    }
    if merged.events.is_empty() {
        let detail = if errors.is_empty() {
            "没有解析到任何赛程".to_string()
        } else {
            errors.join("；")
        };
        return Err(format!(
            "没有拿到 LoL 赛程数据（{detail}）。请检查网络/代理后重试。"
        ));
    }

    let mut events: Vec<Value> = merged.events.into_values().collect();
    events.sort_by(|a, b| text(&a["startTime"]).cmp(&text(&b["startTime"])));
    let mut leagues: Vec<Value> = merged.leagues.into_values().collect();
    leagues.sort_by_key(|l| l["priority"].as_u64().unwrap_or(99));
    let mut seasons: Vec<Value> = merged.seasons.into_values().collect();
    seasons.sort_by(|a, b| text(&a["name"]).cmp(&text(&b["name"])));
    let mut world_rank: Vec<Value> = merged.gpr.into_values().collect();
    world_rank.sort_by_key(|t| t["rank"].as_u64().unwrap_or(999));
    world_rank.truncate(30);

    Ok(json!({
        "leagues": leagues,
        "seasons": seasons,
        "events": events,
        "worldRank": world_rank,
        "fetchedAt": now_ms(),
        "source": "lolesports.com / Apollo SSR",
        "errors": errors,
    }))
}

pub fn fetch(force: bool) -> Result<Value, String> {
    if !force {
        if let Ok(guard) = CACHE.lock() {
            if let Some((at, value)) = guard.as_ref() {
                if at.elapsed() < CACHE_TTL {
                    return Ok(value.clone());
                }
            }
        }
    }
    let value = fetch_uncached()?;
    if let Ok(mut guard) = CACHE.lock() {
        *guard = Some((Instant::now(), value.clone()));
    }
    Ok(value)
}

/// 前端「英雄联盟赛事观察版」的数据入口：抓取/解析/缓存都在阻塞线程池里完成。
#[tauri::command]
pub async fn lol_esports_overview(force: Option<bool>) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || fetch(force.unwrap_or(false)))
        .await
        .map_err(|e| format!("赛事数据任务异常: {e}"))?
}
