# 主线程卡顿：排查结论与加固

> 对应 P0-1。数据来源：`%LOCALAPPDATA%\FLUX\baize-overlay.log`（hangwatch 写入）
> 与 Windows 事件日志。

## 一、现象

监控日志把「主线程 ≥1200ms 不响应」记为一次卡顿。10-18 那一天共 263 条相关记录，
其中 13 次单次阻塞 **≥10 秒**，最长 **88 秒**。Windows 也留下两条 Application Hang
（17:24:08、18:14:35，事件 1002）——也就是说系统层面确实判定过「无响应」。

## 二、排查过程与结论

### 1. 不是"工具把主线程占住了"

按 hangwatch 记录的"当时在做什么"归类：

| 活动 | 次数 |
| --- | --- |
| **空闲** | **173** |
| 对话 · 等待模型响应 | 41 |
| 工具 · ps_exec | 27 |
| 其他工具（click_at / browser_act / terminal_send …） | 22 |

最长三次（88049ms / 67215ms / 61073ms）**全部发生在"空闲"**，且活动标记是几百秒前
设的。工具执行期间只有 300–1200ms 的轻微抖动。所以"ps_exec 阻塞主线程"这个最初
怀疑不成立。

### 2. 不是系统睡眠

睡眠会让 `Instant` 跨越整段挂起时间，表现和这次很像。但事件日志里 10-18/10-19
**没有任何 Kernel-Power 42/107**（最近一次睡眠是 09-06）。排除。

### 3. 不是同步命令阻塞

Tauri v2 里 `#[tauri::command]` 的**同步**函数直接跑在主线程。全量扫描 192 个命令：

- 同步命令中体内含阻塞调用的：**6 个**
- 逐个核对后**全部不成立**：
  - `open_path` / `data_open_folder` 用的是 `Command::spawn()`（只创建进程，不等待）
  - `gateway_get_status` / `gateway_start` / `gateway_stop` / `gateway_set_config`
    只做 `TcpListener::bind` + 起后台线程 + 写一条设置，均为微秒级

（扫描器把 `.status()` 误判成"等待进程退出"，属于关键词误报。）

### 4. 原生模态对话框也不是

`rfd::FileDialog`（阻塞式文件对话框）共 5 处，全部位于 **async 命令**，跑在 tokio
线程而不是主线程，不会卡住消息泵。

### 5. 真正的时间相关性：机器整体在抖

88 秒那次的前后 10 分钟，系统日志里密集出现：

```
22:26:21  DistributedCOM 10010  服务器未在要求的超时时间内通过 DCOM 注册
22:27:53  DistributedCOM 10010
22:29:20  Service Control Manager 7009  等待 Software Protection 服务的连接超时(30000 毫秒)
22:29:20  Service Control Manager 7000  Software Protection 服务启动失败
22:29:26  DistributedCOM 10010
22:30:11  DNS-Client 1014  api.ipify.org 名称解析超时
22:34:35  Schannel 36871 创建 TLS 客户端凭据时发生严重错误（10013）
```

这些是**系统级**故障（DCOM 注册超时、服务 30 秒连不上、DNS 超时、TLS 凭据失败），
不是应用自己产生的。主线程的任何一次同步系统调用（COM、DNS、文件、证书）落在
这种窗口里都会被放大成几十秒。

**结论**：这批卡顿的主要成因是运行环境（DCOM/服务/DNS/TLS 层面）而不是应用逻辑；
应用侧同步命令是干净的。但当时的日志无法进一步归因——只能看到"主线程无响应"，
看不出卡在哪个闭包。这本身就是必须补的短板。

## 三、这次做的加固

### 1. 主线程闭包耗时护栏

`hangwatch::watch(label)` 是 RAII 计时器：进入 `run_on_main_thread` 的闭包时声明，
离开时若超过 **80ms** 就记一条

```
[卡顿] 主线程[windows.rs.ensure_halo_window] 耗时 2130ms
```

已经插到 **14 处**主线程闭包（窗口创建、光圈创建与迁移、弹幕、接管/解除接管等）。
下次再卡，日志会直接指出是哪个闭包，而不是只有一句"无响应"。

选 80ms 是因为主线程正常闭包都是亚毫秒级，超过 80ms 就已经开始影响 60fps 合成。

### 2. 清屏移出主线程

`takeover::minimize_irrelevant_windows`（EnumWindows + 逐个 `ShowWindow`）原来跑在
主线程。它只用 Win32、不碰 Tauri 事件循环，没有理由占着消息泵——窗口多时会连续
调用几十次 `ShowWindow`。已改为工作线程执行。

### 3. 剩余动作

如果加固后的日志仍然显示「主线程[xxx] 耗时 Nms」，那就是具体到函数的证据，
可以直接改那一个闭包（通常是窗口创建/COM 调用），不需要再猜。
