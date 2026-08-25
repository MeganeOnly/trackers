# Architecture — Tauri 两层架构详解

> 本文档深入解释 book-tracker 的架构设计、数据流和关键决策。
> 给需要扩展功能 / 排错 / 重构时翻看用。
> 想要 onboarding 看 `AGENTS.md` 即可。

## 一、整体架构

Tauri 2 应用只有**两个进程层** + 一份**共享类型契约**：

```
┌─────────────────────────────────────────────────────────────┐
│  Renderer（WebView）                                          │
│  - React 18 + zustand 状态                                  │
│  - 通过 src/renderer/lib/api.ts 调 invoke() 走 IPC           │
│  - 不直接接触 fs / Tauri API                                 │
└─────────────────────────────────────────────────────────────┘
                            │ Tauri IPC（JSON-RPC over __TAURI_INTERNALS__）
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Rust backend（src-tauri/）                                   │
│  - commands.rs:#[tauri::command] 暴露 13 个入口              │
│  - service/:业务逻辑（包装 data/,加 cache / 双仓分离）        │
│  - data/:纯 fs I/O(atomic write / ensure_dir / JSON 读写)    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  User filesystem                                              │
│  - %APPDATA%/book-tracker/config.json(应用层,只存 data_dir) │
│  - <data_dir>/{books/*.md, relations.json, config.json}      │
└─────────────────────────────────────────────────────────────┘

        ┌───────────────────────────────────────────┐
        │ src/shared/types.ts(TS 类型契约)          │
        │ src/shared/api.ts(ElectronAPI 接口)       │
        │ src/shared/unlock.ts + progress.ts(纯函数)│
        │                                            │
        │ ↕ Rust 端手写镜像 src-tauri/src/types.rs   │
        └───────────────────────────────────────────┘
```

**与 Electron 三层架构的对比**：

| Electron 旧架构 | Tauri 新架构 |
|---|---|
| main process（Node.js）+ preload + renderer | Rust backend + renderer(WebView 系统原生) |
| contextBridge 暴露 `window.electron.*` | `invoke('command_name')` 直接 RPC |
| IPC channel 字符串（`books:list`）常量 | Tauri command 名（`books_list`）= Rust 函数名 |
| 三层需要 `tsconfig.node.json` 单独类型检查 | 只有 `vite.config.ts` 用 Node API,renderer 纯 web |
| electron-builder 打包(asar + NSIS) | `tauri build` → 单 exe + NSIS |

## 二、数据流：一次写操作的完整路径

以"加一本书"为例,跟踪调用链：

```
[1] User clicks "+ 加书" in UI
    ↓
[2] App.tsx → setForm({ mode: 'add' }) → BookForm modal renders
    ↓
[3] User fills form, clicks "保存"
    ↓
[4] BookForm.tsx calls useBooksStore.create(input)
    ↓ src/renderer/store/books.ts
    ↓
[5] store/books.ts: const book = await api.books.create(input)
    ↓ src/renderer/lib/api.ts
    ↓
[6] api.ts: invoke<Book>('books_create', { input })
    ↓ Tauri IPC bridge (window.__TAURI_INTERNALS__.invoke)
    ↓
[7] Rust commands::books_create(input: BookInput) → Result<Book, String>
    ↓ src-tauri/src/commands.rs
    ↓
[8] books::create_book(&books_dir, &input)
    ↓ src-tauri/src/service/books.rs
    ↓ 业务逻辑:调 data_dir::get_cached() 拿 books 目录、调 slug::make_base_id 生成新 ID
    ↓
[9] data::books::write_book(&path, &book_with_new_id)
    ↓ src-tauri/src/data/books.rs
    ↓ I/O:拼 frontmatter JSON + body,atomic_write_file 写盘
    ↓
[10] filesystem: <data_dir>/books/<id>.md created
    ↓
[11] Rust returns Book → JSON serialized → back through IPC
    ↓
[12] store/books.ts: set((s) => ({ books: [...s.books, book] }))
    ↓ zustand 状态更新 → React 重新渲染 → BookList 出现新书
```

**关键不变量**：

- 单向数据流:renderer → Tauri IPC → Rust → fs
- fs 是真相之源:renderer 状态只是 fs 的镜像,任何 reload 都会从 fs 重建
- Rust 是 fs 的唯一写者:renderer 永远不直接碰文件
- 错误从 Rust 向上传播:`Result<T, String>` → Tauri 序列化为 JS 异常 → renderer 用 try/catch 接

## 三、双向类型契约

renderer 用 TypeScript,Rust 用 serde。两者通过 `src/shared/types.ts` 和 `src-tauri/src/types.rs` 维护**字段名 / 值**完全一致的镜像。

**类型新增的标准流程**：

```
1. src/shared/types.ts          加类型定义(TS source of truth)
2. src/shared/api.ts            加 API 方法签名
3. src-tauri/src/types.rs       加 serde 镜像(手写,不是自动生成)
4. src-tauri/src/service/*.rs   加业务方法
5. src-tauri/src/commands.rs    加 #[tauri::command] + 在 lib.rs 注册
6. src/renderer/lib/api.ts      加 invoke 调用
7. src/renderer/store/*.ts      加 zustand action
8. src/renderer/components/*.tsx 接 UI
```

**关键约束**：

- 字段名必须完全一致:`read_count`(不是 `readCount`),`prerequisites`(不是 `prereqs`)
- 枚举值 snake_case:`'want'` / `'shelved'` / `'reading'` / `'any_of'` / `'clean'` / `'edit'`
- 可选字段用 `Option<T>`,前端对应 `T | null` / `T | undefined`
- 时间戳用 ISO 8601 字符串(避免 chrono 等外部依赖)
- `BookPatch.progress` 是**三态**:`None`(字段缺)= 不改 / `Some(None)`(null)= 清空 / `Some(Some(p))`= 设值。Rust 端用 `double_option` 自定义 deserializer 区分两种 `None`

**为什么不自动生成类型**？

理论上可以用 `ts-rs` 或 `specta` 让 Rust 自动生成 TS 类型。但本项目手写镜像：
- 编译速度:自动生成在 cargo build 后跑一遍,开发循环慢
- 可见性:TS 端能直接读,不用点进 Rust 文件
- 调试:差异一目了然,不需要 regenerate + restart

代价是手动维护,但类型字段很少(~15 个 struct 字段 + 4 个 enum),改动频率低。

## 四、状态边界

每个数据有自己的"权威来源",知道从哪读、谁更新：

| 数据 | 权威来源 | renderer 状态 | 何时同步 |
|---|---|---|---|
| 书的列表 | `<data_dir>/books/*.md` | `useBooksStore.books` | `api.books.list()` 调用时 |
| 单本书的详情 | `<data_dir>/books/<id>.md` | `useBooksStore.books[i]` | 任何 `create` / `update` / `bumpProgress` / `delete` 后 |
| 关系图 | `<data_dir>/relations.json` | `useRelationsStore.edges` | 任何 `relations.get` / `set` 后 |
| 应用配置 | `<data_dir>/config.json` | `useModeStore.mode` | `App.tsx` 启动时 `config.get` 一次 |
| 当前数据目录 | `%APPDATA%/book-tracker/config.json` | 无(仅 Rust 端 `Mutex<Option<String>>` cache) | `data_pick_dir` 时更新 |
| 选中 / 模式 / 搜索 query | 仅 UI 临时状态 | `useBooksStore.selectedId` / `useModeStore` / `useSearchStore` | 不持久化,关掉就没 |

**关键原则**：

- renderer 状态是 fs 的**快照**,不是真相
- 每次重要操作后(add/update/delete),store action 接收 Rust 返回的新 Book 直接替换,不重新 load
- 不在 renderer 做"乐观更新":等 Rust 确认后再改 store,避免失败状态难回滚

## 五、关键设计决策(坑与选择)

完整列表见 `AGENTS.md § 十`。这里只列**架构层面**的决策：

1. **`crate-type = ["rlib"]`**(不是 `cdylib`)
   - 原因:Windows GNU toolchain 下,cdylib 触发 export ordinal 限制
   - 影响:必须用 `#[cfg(not(test))]` 隔离 `tauri::Builder` / `commands` / `service`,否则 `cargo test` 拉 webview2 → 入口找不到 → 编译失败

2. **手写 frontmatter parser**(不引入 matter crate)
   - matter crate 处于 alpha,API 经常变
   - split_frontmatter ~30 行,够用:按 `---` 切,trim,尝试 `serde_json::from_str`,失败 fallback 空对象
   - 写时用 `serde_json::to_string` 序列化,确保结构化

3. **frontmatter 写为 JSON**(不是 YAML)
   - JSON 单行写,解析稳定;YAML 嵌套对象会被格式化(缩进 / 引号),解析端要兼容各种格式
   - 用户手编辑仍可读:JSON 是合法 YAML 子集

4. **数据目录双仓分离**(应用层 / 数据层)
   - 应用层 `%APPDATA%/book-tracker/config.json`:只存 `data_dir`,应用启动入口
   - 数据层 `<data_dir>/config.json`:完整 `Config`,设置面板读写 + "切换数据目录"逻辑
   - 为什么双仓:data_dir 自己也是用户数据的一部分(要随数据迁移);应用层只关心"现在用哪个目录"

5. **`Mutex<Option<String>>` 做 data_dir 全局 cache**
   - Tauri commands 多线程,每个 command 都要拿 data_dir 路径
   - 每次读 fs 太慢;用全局 cache 一次性初始化,后续纯内存访问
   - `data_pick_dir` 切换时 `reset()` 重建

6. **`ConfigPatch` 不允许改 `data_dir`**
   - data_dir 切换是重量级操作(涉及 cache 重建、初始化新目录结构)
   - 走专门的 `data_pick_dir` 命令,带 picker 弹窗 + 确认流程
   - `config.set` 只允许改 `language` / `default_mode` 两个轻量字段

7. **首启 picker 在 renderer 端,不在 Rust 端**
   - 旧 Electron:`initDataDir` 在 main 进程启动时弹 picker,用户取消则 `app.quit()`
   - 新 Tauri:`app_ensure_data_dir` 返回 Err(不弹 picker,会让 dialog 初始化出问题)→ renderer catch → 调 `data_pick_dir`
   - 好处:用户取消不会强制退出应用,可以重试或显示 banner

8. **`BookPatch.progress` 三态 `Option<Option<T>>`**
   - serde 默认把 `null` 吞成 `None`,无法区分"字段缺"和"字段为 null"
   - 自定义 `double_option` deserializer 强制把 null 解析为 `Some(None)`
   - 结果:JS 端 `patch.progress = null` 显式清空,`patch: {}` 不改,`patch.progress = {...}` 设值

## 六、构建 / 测试 / 发布

### 本地开发

```bash
npm run dev              # tauri dev:Vite + Cargo + 打开原生窗口
npm run dev:vite         # 只跑 Vite(纯 renderer 调试,快)
```

Tauri `beforeDevCommand` 自动跑 `npm run dev:vite`,省去手动开两个进程。

### 本地构建(手动)

```bash
npm run build            # tauri build:产物在 src-tauri/target/release/bundle/nsis/
```

`beforeBuildCommand` 跑 `npm run build:vite`,生成 `dist/` 给 Tauri 消费。

### 测试

```bash
npm test                          # vitest:renderer/shared 纯函数(31/31)
cd src-tauri && cargo test        # Rust 单元测试(61/61)
npm run typecheck                 # tsc 双段(node: vite.config.ts;web: renderer + shared)
```

### CI 发布

`.github/workflows/release.yml`:

- 触发:push tag `v*`(如 `v0.1.0`)
- 平台:`windows-latest` 单矩阵
- 工具链:MSVC(Tauri 官方推荐用于 release;local dev 用 GNU 编译快)
- 流程:[`tauri-apps/tauri-action@v0`](https://github.com/tauri-apps/tauri-action) 一站式装 Rust / webview2 / build / 上传
- 产出:NSIS installer (`*.exe`) 上传到 GitHub Release,**默认 draft**,需要手动 review 后 publish

```bash
git tag v0.1.0
git push origin v0.1.0
# → Actions 跑完 → repo Releases 页 review draft → publish
```

### 调试技巧

- **Rust panic 在终端**:`tauri dev` 控制台会显示 `panicked at ...`,定位 `src-tauri/src/...` 行号
- **renderer console 在 DevTools**:右键 → Inspect Element(开发模式默认开启)
- **IPC 失败定位**:DevTools Console 会有 `Error invoking ...` 的 Tauri 内部错误,通常 Rust 端 panic 转字符串
- **cargo test 单独跑一个测试**:`cargo test <fn_name>` 或 `cargo test <module>::<test_name>`
