# 开发经验与注意点（Dev Notes）

> trackers monorepo 的**经验沉淀**文件。
> 约定：每次整改 / 增添功能后，如有值得留档的经验、注意点、踩坑，**追加**到本文件
> （新条目放在对应主题节的开头或按日期倒序排列）。

## 记录规范

- 只写**中性、可提交**的技术经验；不写本机路径、私人陈述、内部对话原话（与 AGENTS.md 同标准）
- 每个条目保持最小结构：**现象 → 根因 → 修复 / 规避 → 回归验证**
- 两个 app 共享的通用教训标注 `[共享]`；仅单 app 的标注对应 app 名
- 涉及共享内核（tracker-core）的改动，记录时同步考虑是否要补 core 测试

---

## 2026-08：LifeTracker 关系图节点挤成团（countable spec 多次添加产生平行边）

### 1. [life-tracker] 现象：关系图节点挤成一团、与 book-tracker 视觉差异明显

- **现象**：life-tracker 关系图打开后节点明显挤成团，难以阅读；同时 book-tracker
  的同一份力导向代码（orbit/jitter/charge=-80）下却正常发散 —— 排除力参数问题，
  必是数据 / 边推导有差。
- **根因**：life-tracker 引入了「计数式任务 (countable)」+ 「同一目标可多次添加为 simple
  spec（每次 count 不同）」的能力（见 §1 v3 系列 commit）。GraphView `deriveLinks` 按
  specs 1:1 画边，于是对 `specs=[{simple B count:1}, {simple B count:2}, ...]`
  画出 N 条同 source→target 平行边：
  1. **d3-force-link 把每条 link 当独立力**：N 条平行边让 source 与 target 之间
     被 N 倍向心力拉近，节点挤成团（即便 charge=-80 也压不过）。
  2. **渲染重叠**：react-force-graph 把多条同 source/target 的箭头叠在一起，
     既不美观也让 shadow canvas 命中位置错位。
  3. **refCount 膨胀**：`refCount` 在 `data` memo 里按 spec 命中累加，
     B 节点大小按 `1 + sqrt(refCount) * 2` 放大（inflated by spec count），
     与"被几个不同 target 引用"无关。
  4. book-tracker 直接读 `e.prerequisites`（persist 时已去重），自然没有平行边，
     所以同套力参数下 book 正常、life 异常。
- **修复**（`apps/life-tracker/src/renderer/components/GraphView.tsx` 的 `deriveLinks`）：
  在收集完所有候选边后做 `(source, target) → string` 去重 —— 视觉上只画一条，
  `refCount` 自增也随之收敛为「被几个不同 target 引用」。
  **解锁语义不受影响**：`computeUnlocked` 仍按 specs 列表全集逐条调 `isDone(id, count)`，
  「B 完成 1 次 AND B 完成 2 次」的多 spec 语义保留，画图却只画 1 条边。
  兜底覆盖：simple / group / count / 旧 AND-of-ORs 四个分支的输出都走同一道去重 filter，
  防异常 / 迁移期数据进同源多边的别处来源。
- **回归**：
  - `apps/life-tracker/src/shared/__tests__/graphview_links.test.ts`
    新增 8 个 case：多次 simple 同 id 不同 / 同 count、simple+group 同 source、
    group per-member count 重叠、count spec 重叠成员、旧 groups 多组重叠、
    worst-case 多 spec 组合、未受影响确认（specs 全集仍为 N 条）。
  - life-tracker 全套 101/101 + book-tracker 47/47 vitest 全过；
    `cargo test --workspace` 18/13/72 = 103 个 Rust 测试全过；
    两 app `npm run typecheck` 全绿。

### 2. [life-tracker] 教训：画图层去重与解锁语义解耦

- **教训**：d3-force 的 link 力不支持"同 pair 多 link 的语义增强"——多条平行边会被
  当作 N 倍向心力，必然让节点挤成团。任何"一个目标可被多次引用"的语义（同 id 不同 count、
  同 id 出现在多个 group 等），进入画布前**必须**做 `(source, target)` 去重，否则
  即便解锁层算对、视觉层也会崩。
- **教训**：画图层去重**不要**图省事做在 spec 收集循环内部（`if (seen.has) continue`），
  这会把"加 count 加了一次"和"加 count 又加了一次"两种写盘差异隐藏掉；放进统一 filter
  才便于"看哪些 pair 被引了多次"——加测试时一次到位。
- **教训**：画图层的去重只影响"`links` 数组有几条"与"`refCount` 累几次"，**不影响解锁**。
  解锁语义由 `computeUnlocked` 走 specs 全集判定。验证方式：写一条测试
  `edge.specs.length === N && deriveLinks(edge).length === 1` 同时存在，
  让回归测试明确这两层的解耦。

### 3. [life-tracker] 教训：跟 book-tracker 同源 layout 仍有差，必看数据层

- **教训**：当 book/life 两 app 共享 `orbit / jitter / charge / cooldownTicks` 等
  力参数但只有一边出问题，先怀疑**数据层差异**而不是力参数。两个 app 渲染代码几乎一模一样
  （GraphView.tsx 行数 374 vs 315），唯一的实际差异就在 `deriveLinks` 的边推导——而
  这个差异正是 countable 任务导致的。
- **教训**：countable / 多 instance 这类"同一目标多次出现"的数据模型，会让所有按"`id` 唯一"
  假设写的渲染代码（图、列表、统计）集体失效。引入时**必须**挨个审视渲染端是否假设了
  unique id，并在 `deriveLinks`/`refCount` 累加这类聚合点上加 dedup。

---

## 2026-08：GraphView "灵动"再修——jitter 被平衡力抵消，改用轨道力 + 强斥力 + 高亮钉中心

### 1. [共享] 现象：上一轮 jitter 方案修完后，图依然"完全静止"、不可读

- **现象**：life-tracker 关系图打开后节点完全静止（连初始"散开"过程都几乎不可见），
  整张图是一团挤在中心的节点，没有阅读性。上一轮已 `cooldownTicks=Infinity` 并加了
  `jitterForce`，但用户反馈"进去还是完全不动"。
- **根因**（两层）：
  1. **布局到达平衡**：charge/link/center 是保守力，节点到位后净力 ≈ 0；alpha 再高、
     simulation 一直在 tick，节点也停在原地（alphaTarget 只是让系统"热身"，
     不是持续运动的来源）。
  2. **jitter 强度与 velocityDecay 的关系**：`vx += (rand-0.5)*strength` 每 tick 注入
     ±s/2 的动量，而 position 更新后 `vx *= d3VelocityDecay`。s=0.06~0.08 + decay 0.6
     时平衡速度只有 ~0.1 px/tick（≈6px/s），视觉上就是"没动"；把 s 调大又变成抽搐。
     另外小图默认 charge(-30) 太弱，节点根本散不开、挤成一团。
- **修复**（`apps/life-tracker` 与 `apps/book-tracker` 两个 GraphView.tsx 同步）：
  - **轨道力 orbitForce**：每 tick 给每个节点绕中心(0,0)的**切向**速度
    （`vx += -dy/d*s`、`vy += dx/d*s`，s=0.25）。纯切向速度在连续时间下做匀速圆周运动、
    半径守恒，离散 tick 的径向漂移 ~v²/2r 可忽略 → 整张图成为一团缓慢旋转的云：
    持续运动、不抽搐、也不飞散。这是"持续能量输入"里不会抖动的一种。
  - **强斥力**：`fg.d3Force('charge').strength(-80)`（默认 -30 对小图太弱）→ 节点散开可读。
  - **velocityDecay 0.6 → 0.4**：让轨道动量更持久。
  - **高亮节点钉中心**：highlightId 变化时把该节点 `fx=fy=0` 钉在 forceCenter 质心
    （即画布中心），其余节点继续绕它转；highlight 清空时解除钉住。实现
    "选中节点作中心、其它还能动"。
- **回归**：
  - 用 Edge headless + CDP 驱动 vite dev 页，实时读 canvas 像素哈希：修复后每秒都在变
    （连续运动）；读节点坐标：无高亮时节点在 ±50 范围内缓慢旋转，有高亮时目标节点稳定
    (0,0)、其余节点在 ±60 内持续运动。
  - 两个 app `npm run typecheck` 全绿；life-tracker vitest 93/93 全过。

### 2. [共享] 教训

- **教训**：d3-force 的"平衡力"不会因为 alpha 高就持续运动——想让图"永远在动"，
  必须注入**不依赖 alpha、且自身不收敛**的力。jitter（随机）是其中一种，但要在"可见"
  与"不抽搐"之间取平衡，数值受 `strength` 与 `d3VelocityDecay` 共同决定；
  轨道力（恒定向切向速度）更稳：速度被 decay 收敛到小值、位置在圆周上，天然不抖动。
- **教训**：排查"图静止"时先分清「simulation 没跑」还是「跑了但到平衡」：
  前者看 cooldownTicks / engineRunning，后者看是否注入持续能量。这次 5s 内节点只动
  1~2px、tick 却一直在走，就是典型的"到平衡"而非"没跑"——只把 cooldown 改 Infinity、
  光加个弱 jitter 解决不了。

### 3. [共享] 连续运动 vs 可交互的平衡：轨道力调太强会"抓不到节点"

- **现象**：把轨道力强度设到 0.25（≈25px/s 的持续旋转）后，节点确实一直在动，但用户反馈
  "不能拖动了"。拖一个节点要么抓不住、要么拖完就粘在原地。
- **根因**（两个）：
  1. **命中测试用的是节流的 shadow canvas**：force-graph 的 hover/点击/拖动命中靠一张
     shadow canvas，它每 800ms（HOVER_CANVAS_THROTTLE_DELAY）才刷新一次。节点以 25px/s
     运动时，点击的"可见位置"和命中用的"shadow 位置"最多差 20px——点中画出来的节点、
     命中却落在别处，拖动自然失效。
  2. **fx/fy 钉中心与拖动的冲突**：把高亮节点 `fx=fy=0` 钉在中心后，d3-drag 结束时的
     清理逻辑是 `initPos.fx === undefined 才清 fx`；钉住的节点 `initPos.fx=0`，于是拖完
     fx 留在落点，节点粘死回不到中心。
- **修复**：
  1. **轨道力降到 0.12（≈4~5px/s）**：800ms shadow 延迟内的漂移 <4px，落在节点命中半径
     （4~8px）内，抓取可靠；同时速度仍可见（节点一直在缓缓流动），不是静止。
  2. **高亮节点拖动后回到中心**：保留 fx/fy 钉中心，但新增 `onNodeDragEnd`——若拖的是
     高亮节点，松手后重新 `fx=fy=0`（拖的过程中 d3 临时置 fx 正常跟手，松手回中心）。
     普通节点不受影响，d3 正常清 fx/fy。
- **回归**：
  - Edge headless + CDP 合成鼠标事件实测：普通节点可拖、松手自由；高亮节点拖动中跟手
    （坐标随指针变化）、松手后回到 (0,0) 且 fx 不再残留；
  - 两 app `npm run typecheck` 全绿。
- **教训**：力导向图要"持续运动又要可交互"，运动速度必须受 shadow canvas 刷新节流约束
  （≤ 命中半径 / 刷新间隔 ≈ 4px / 0.8s ≈ 5px/s）；自己用 fx/fy 钉节点时要意识到 d3-drag
  的 fx 清理规则，别让"钉住"变成"拖完粘死"。

### 4. [共享] 最终方案：交互感知的"呼吸"——鼠标悬停时图停住，离开后继续流动

- **现象**：把轨道力降到 0.12（≈5px/s）后小图能点能拖，但**节点一多漂移就变快**
  （25 个节点实测外围节点 ~10px/s），800ms 才刷新一次的命中 shadow canvas 又跟不上：
  点击落空、被误判成拖拽、整张图被拖出视野——用户反馈"点了节点之后整个图式部分就消失"。
- **根因**：命中测试的 shadow canvas 按 `HOVER_CANVAS_THROTTLE_DELAY=800ms` 节流刷新，
  这是库级固定行为。只要节点运动在 800ms 内超过命中半径（4~8px），点击/拖动就不可靠。
  无论把漂移调多慢，大图都会踩线；"持续运动"和"稳定交互"在库层面是对立的。
- **修复**：改成**交互感知**——不做"永远匀速转"，而是：
  - 轨道 / jitter 强度放进 `motionRef`，force 每 tick 从 ref 读当前强度；
  - `.graph-view` 容器 `onMouseEnter` → 轨道 0.004、jitter 0.004（图基本停住）；
    `onMouseLeave` → 恢复轨道 0.05、jitter 0.04（图重新缓慢流动）；
  - 于是鼠标不在图上时图是"活"的（缓慢流动），鼠标一进来图就停住——此时 shadow
    canvas 在 800ms 内追上位置，点击 / 拖动 100% 命中，再也不会把图拖出视野。
  - 保留高亮节点钉中心 + `onNodeDragEnd` 回中心（见上一条）。
- **回归**（25 个节点实测）：
  - 鼠标移入后点击节点：第 1 次即命中，分栏正常打开，左侧图保持可见（不再消失）；
  - 悬停状态下拖动节点：跟手、松手自由（fx 不残留）；
  - 鼠标移出后图恢复流动（2s 内节点位置明显变化）；
  - 两 app `npm run typecheck` 全绿；life-tracker vitest 93/93 全过。
- **教训**：react-force-graph 这类"节流命中测试 + 持续动画"的组合，想让图"又活又能点"，
  常规做法是**交互时停、离开时动**（hover-aware freeze），而不是靠把速度调慢到恰好不踩线
  ——后者在数据规模变化时必然翻车。另外排查"点了没反应 / 图消失"时要先怀疑命中层
  （shadow canvas），而不是渲染层。

---

## 2026-08：GraphView 关系图打开后完全静止（cooldownTicks=120 hardcode）

### 1. [共享] 现象：打开关系图，节点 ~2s 后完全静止不动

- **现象**：life-tracker / book-tracker 关系图打开后，节点运动 1–2 秒就完全静止，
  哪怕数据有几百个节点也看不出力导向布局的"鲜活感"。用户期望"打开就能灵活动起来"，
  实际却是布局完就锁死，hover / 点击 / 拖动前整张图一动不动。
- **根因**：两个 app 的 `GraphView.tsx` 都 hardcode 了
  `cooldownTicks={120}`（来自 initial commit 的「120 ≈ 2s」注释，是事后反推而非
  设计选择）。force-graph 内部停止条件是
  `cntTicks > cooldownTicks || elapsed > cooldownTime || alpha < d3AlphaMin`——
  120 tick 后无论 alpha 多高，simulation 立即 `engineRunning = false`，后续 rAF
  即使在跑也只是空 paint，节点一动不动。
- **修复**（`apps/life-tracker/src/renderer/components/GraphView.tsx` + book-tracker 同款）：
  - `cooldownTicks={Infinity}` + `cooldownTime={Infinity}`：让 force-graph 自己**永不停止**；
  - 去掉 `d3AlphaTarget` 改动（保留默认 0，让 alpha 自然衰减）；
  - `d3VelocityDecay={0.6}`：让动能衰减慢一点，节点在 charge+link 力暂时失衡时
    有"摆动余韵"，不至于立刻锁死；
  - 新增 **`jitterForce` 自定义 d3-force**：每 tick 给每个节点一个恒定幅度
    随机动量（不依赖 alpha）。d3-force 默认的 charge / link / center 三种力在
    节点数较少且拓扑简单时会很快达到平衡——平衡态下即使 alpha>0 也没净力，
    节点不会动。jitter force 持续注入小扰动来"打破平衡"，让节点永远在微微抖动。
  - 通过 `fg.d3Force('jitter', jitterForce(() => data.nodes, 0.08))` 注册；
    `useEffect([data.nodes])` 触发：data 重建（goals/edges 引用变）时重注册 + reheat。
- **回归**：
  - 用 puppeteer + Edge headless 跑 vite dev，按 g 打开图后每 1.5s 对中心区域
    canvas 做像素哈希：旧版本 7.5s 后 hash 完全相同（图锁死），新版本 8/8 distinct
    （12 秒内持续变化）；
  - 点击节点切到分栏布局仍正常，关闭右侧栏后图仍持续动；
  - book-tracker / life-tracker `npm run typecheck` 全绿，93/93 + 47/47 vitest
    全过，`cargo test --workspace` 85 个测试全过。

### 2. [共享] 教训：d3-force "节点不动" 跟 "simulation 没跑" 是两件事

- **教训**：直觉上「节点不动 = simulation 停了」。其实在 react-force-graph 中，
  rAF loop 可以持续跑，但只要 `engineRunning=false`（force-graph 内部的 flag，由
  cooldownTicks/cooldownTime/d3AlphaMin 三者之一触发）就**只重画、不 tick 物理**。
  排查「图静止」时除了检查 pauseAnimation / ref 生命周期，还要查 cooldownTicks——
  这个 prop 默认 Infinity（永不停止），一旦写死一个具体值就等于"开图即锁"。
- **教训**：d3-force 的 charge+link+center 三种力平衡时净力为零，alpha 再高也
  不会让节点持续运动——"图持续动"必须靠 `d3AlphaTarget>0` 或自定义 jitter
  force 这类**持续能量输入**。如果设计目标是「打开图就有动感」，光改
  cooldownTicks 不够，必须加 jitter。
- **教训**：d3-force 调用 force 函数时 `this` 不可靠（strict mode 下 undefined），
  自定义 force 必须用闭包注入 nodes：`jitterForce(() => data.nodes, ...)`，
  直接 `(this as any).nodes()` 会抛 `Cannot read properties of undefined`。
  这条是调试时跳的坑，记录下来。

---



## 2026-08：dev.bat 启动报 "Port 1421 already in use"（残留 vite 进程占端口）

- **现象**：运行 `apps/life-tracker/dev.bat` 立即报
  `error when starting dev server: Error: Port 1421 is already in use`，
  `tauri dev` 的 BeforeDevCommand（`npm run dev:vite`）以非零退出码终止；
  book-tracker 同理（端口 1420）。
- **根因**：上次 `tauri dev` 退出时 vite 子进程没有跟随父进程一起退出，
  残留一个监听 dev 端口的 vite 进程。`tauri dev` 不保证清理 BeforeDevCommand
  起的子进程；Windows 上 cmd → npm → node 的派生链孤儿化较常见。
- **修复**：定位并**精准**杀掉残留进程。**绝不能用 `Stop-Process -Name node` /
  `taskkill /IM node.exe`** 这类按 node 名批量杀 —— 会顺带误杀本机其它 node
  进程（IDE 插件宿主、调试工具等），影响远超 dev.bat 本身。正确流程：
  1. `Get-NetTCPConnection -LocalPort <port> -State Listen` 拿到 OwningProcess
  2. `Get-CimInstance Win32_Process -Filter "ProcessId=<pid>"` 读 CommandLine，
     确认是本项目 node_modules 下的 vite
  3. `Stop-Process -Id <pid> -Force` 精准结束
- **回归**：端口释放后 `dev.bat` 正常起（Vite ready + Cargo Finished +
  弹出 Tauri 窗口，三段串联能确认链路成功）。

### 教训

`tauri dev` 的 BeforeDevCommand 失败不会自动清理 dev 端口；多次启动 dev.bat 前
如果上一次的 Tauri 窗口没干净关闭，先按端口做占用检查比盲目重启更稳。
若要自动化，可写一个 `clean-dev-port.ps1` 之类的小脚本封装上述三步。

---

## 2026-08：GraphView 漏用 done 谓词改写层（v2 互斥 / v3 countable 联动 bug）

`life-tracker` 图模式的解锁计算原本直接调用 `isGoalDone(g)`（1-arg）做谓词，
没有走 `buildDonePredicate(goals, edges)`，导致两类新功能在图里完全失效：

### 1. [共享] 互斥规则（ExcludeSpec）在图里不生效

- **现象**：加了 `⊘ 加互斥规则`（disqualifies / satisfies）后，
  PrereqEditor / CleanMode 列表按规则改写 done 谓词，但关系图里 target 节点
  仍按自身状态上色——视觉上互斥规则"在图里看不见"。
- **根因**：GraphView 的 `data` useMemo 直接传 `(id) => isGoalDone(goals.find(x=>x.id===id))`
  给 `computeUnlocked`，绕过了 `buildDonePredicate` 的 excludes 改写层。
- **修复**：`apps/life-tracker/src/renderer/components/GraphView.tsx` 改用
  `const { isDone } = buildDonePredicate(goals, edges)`，与 PrereqEditor / CleanMode
  走同一份谓词改写。
- **回归**：`apps/life-tracker/src/shared/__tests__/graphview_donemap.test.ts`
  跑 `disqualifies` / `satisfies` 两种 effect 的解锁断言。

### 2. [life-tracker] countable 任务在图里永远灰

- **现象**：可计数任务（如「发论文」）的 progress.current=5、status≠done 时，
  图里该节点显示未解锁；其下游目标即便已经满足 simple/group spec 的引用次数
  也都呈灰色——整张图看上去"根本没动"。
- **根因**：旧谓词只调 `isGoalDone(g)`：
  `status==='done' || (progress.total !== null && current >= total)`。
  countable 任务设计上 progress.total 通常为 null，永远进不去 `current >= total` 分支；
  又不在 `done` 状态，所以图里全是未解锁色。`computeUnlocked` 的 2-arg
  `isDone(id, requiredCount)` 把 requiredCount 直接丢了。
- **修复**：同 §1，统一走 `buildDonePredicate(goals, edges).isDone`，
  countable 分支由 `progress.current >= requiredCount` 判定。
- **回归**：graphview_donemap.test.ts 跑 5 / 1 / 0 不同次数下的解锁、
  group per-member count 形态下的解锁。

### 3. [共享] 教训：渲染层解锁可视化必须复用应用层 done 谓词

- **教训**：`computeUnlocked` 自 v2 起 `isDone` 形参就是 `(id, count) => boolean`，
  但旧代码层（book-tracker GraphView 也是）只传 1-arg。JS 不强制 arity，
  `requiredCount` 静默丢失；TS 也允许少参数——`tsc` 也不会报警。
  这条「谓词改写层」是渲染层和应用层共享语义的核心，
  任何新增的"解锁可视化"组件（GraphView / CleanMode / 详情页卡片等）
  **必须从 `@shared/done` 拿 `buildDonePredicate`，不能自己拼 `isGoalDone` 谓词**。
- **book-tracker 备注**：当前 book-tracker 没有 exclude / countable 概念，
  GraphView 的 1-arg `isGoalDone` 等价行为，目前无须改；将来若加互斥规则
  或可计数字段，需镜像同一份修复（前提是先有 `apps/book-tracker/src/shared/done.ts`）。

### 4. [life-tracker] GraphView link / refCount 直读 `prerequisites` 画出废边

- **现象**：用户在 specs 路径下配前置时，关系图里偶尔出现「多余边」或「少了边」——
  例如 simple A 加 group(B,C) 后，理论上画 3 条边（A→T、B→T、C→T），
  但若 PrereqEditor.persist §5 兜底后 `prerequisites=[A,B,C,D]`（D 是兜底遗留），
  旧 GraphView 把 D 也画一条 D→T 出来；或 specs=[group(B,C)] 兜底后
  `prerequisites=[B,C,D]`，旧实现把 D 也画出来（D 是废）。
- **根因**：GraphView 旧实现 `edges.flatMap(e => e.prerequisites.map(...))`
  完全没看 specs/groups/excludes，把 `prerequisites` 当成"全部前置"画图。
  specs 路径下 `prerequisites` 含「旧裸 id 兜底」（本文件 PrereqEditor §5），
  旧 AND-of-ORs 路径下 mandatory 与 group member 也无视觉区分。
- **修复**：新增 `deriveLinks(edge)` 纯函数
  （`apps/life-tracker/src/renderer/components/GraphView.tsx`），
  按 `computeUnlocked` 的优先级拆边：
   1. `edge.specs` 含正向 spec（exclude 跳过）→ 按 simple / group / count 拆；
   2. 否则 `edge.groups` 非空 → mandatory prereqs（不在任何 group 里）+ 各 group members；
   3. 否则纯旧数据 → 直读 `edge.prerequisites`（向后兼容）。
  `refCount` 也走同一份推导（节点大小反映「被几条 spec 引用」，不再被兜底遗留带偏）。
- **回归**：`apps/life-tracker/src/shared/__tests__/graphview_links.test.ts`（15 条）覆盖
  simple / group（含 per-member count）/ count / exclude / 混合 spec /
  旧 groups（mandatory + members）/ 纯旧数据 / 兜底遗留不画边。

### 5. [共享] 教训：图模式 link / refCount 必须与 unlock 算法同源

- **教训**：GraphView 与 `computeUnlocked` 共用同一份「实际前置集合」语义——
  图上画哪条边、节点按几次引用放大，都必须与 `computeUnlocked` 真正检查的前置一致。
  **不要直读 `edge.prerequisites`**，它在不同 schema 路径下含义不同：
   - specs 路径：含「旧裸 id 兜底」遗留（不是真前置）
   - groups 路径：含 mandatory + group members（视觉无差）
   - exclude：只改写谓词，不形成边
  渲染层应通过 `deriveLinks(edge)` 这类纯函数拿到与 unlock 算法同源的边集合；
  refCount 也用同一份推导，才能让节点大小反映「被几条 spec 引用」。

---

## 2026-08：前置依赖编辑器（PrereqEditor）删除与写盘正确性

本轮修复了 life-tracker / book-tracker 前置依赖编辑器的几类写盘 bug，
根因都表现为**「点了没反应」或「误删 / 数据丢失」**。留档防回归。

### 1. [共享] 删除类操作必须显式给出最终写入列表

- **现象**：点 × 删除前置，chip 不消失。
- **根因**：life-tracker `persist` 有一段「旧裸 id 兜底」——当 specs 为空时把
  `baseEdge.prerequisites` 原样写回。`removeRow` 只过滤了 specs，于是对无 specs 的
  旧数据，删掉的 id 又被兜底逻辑写回。
- **修复**：`persist` 支持显式 `prerequisites` / `groups` 参数；`removeRow` 传过滤后的
  列表直接覆盖推导，跳过兜底。
- **教训**：凡「删除 / 清空」类操作，最终落盘的列表必须由删除逻辑**显式给出**，
  不能依赖聚合 / 兜底推导——兜底的存在是为了兼容旧数据，不是用来撤销删除的。

### 2. [共享] renderer 与 Rust 后端的校验必须完全对齐

- **现象**：所有前置操作（含删除）都「没反应」，且无任何报错提示。
- **根因**：Rust 端 `relations_set` 对**任何**环都拒绝写入；renderer 原来只拦
  「当前条目在环上」。一旦数据里存在不涉及当前条目的环（旧数据 / 手工编辑），
  每次写盘 invoke 抛错、store 不更新 → 静默失败。
- **修复**：renderer 检测到任意环即阻止写盘，并按环是否涉及当前条目给出不同提示
  （涉及 →「此修改会造成循环依赖」；不涉及 →「数据中已存在循环依赖」）。
- **教训**：renderer 的前置校验必须与后端**逐条一致**。「后端拒绝」是静默失败的高发区：
  前端要么同样拦截并提示，要么 catch 后明确报错，绝不能裸奔到 store。

### 3. [life-tracker] 按「合并渲染列表的索引」删除是脆弱的

- **现象**：部分互斥规则（specs 来源）的 × 删不掉。
- **根因**：渲染把 `excludes` + `specs` 里的 exclude **合并成一张列表**，但
  `removeExclude` 只按索引从 `excludes` 源过滤；索引落在 specs 源上时越界静默 no-op。
- **修复**：按合并列表取目标对象引用，从 `excludes` 与 `specs` 两个来源一起过滤。
- **教训**：多个数据源合并渲染时，删除必须按**渲染项**定位，不能按单一源的索引。

### 4. [life-tracker] 清理性操作不能误伤无关数据

- **现象**：删一个前置，整张旧「二选一组合」图被抹掉（成员退回「全部必须完成」语义）。
- **根因**：`removeRow` 之前传 `clearGroups: true`——全量清理标志被删除操作误用。
- **修复**：`removeRow` 只剔除本次移除涉及的组合；`clearGroups` 只由「清除组合 / 规则」
  这类明确表达清理意图的入口触发。
- **教训**：`clearXxx` / `reset` 这类全量清理标志，只能由明确表达清理意图的入口触发；
  局部操作必须传「局部结果」，不能顺带全量重置。

### 5. [life-tracker] 数据模型迁移期，写操作要做「并集保留」

- **现象**：specs 与旧裸 id 混存的数据，加 spec / 加互斥规则 / 切规则会把裸 id 静默丢掉。
- **根因**：兜底只在 specs 为空时生效；specs 存在时新 prerequisites 完全由 specs 推导，
  旧裸 id 被当作一次性迁移对象丢弃。
- **修复**：兜底改为「凡不被新 specs / 生效后 groups 覆盖的裸 id 一律保留」（并集语义）。
- **教训**：旧字段 → 新结构的迁移期，任何写操作都要做并集保留；把旧字段当作
  「一次性迁移对象」直接丢弃，会造成无提示数据丢失。

### 6. [共享] 回归测试必须忠实还原真实代码路径

- **现象**：prereq_simulation 测试全绿，但真实 UI 里删除仍无效。
- **根因**：仿真测试简化了 `persist`（漏掉了兜底分支），测试对象 ≠ 真实代码。
- **修复**：测试里同步还原真实 `persist` 的完整分支（显式 prerequisites/groups、
  兜底、effectiveGroups），并补旧数据删除、legacy groups 保留、混存数据、clearGroups
  保留等用例。
- **教训**：仿真测试要随实现同步演进，否则「测试绿 ≠ 逻辑对」；尤其要覆盖
  **旧数据兼容**路径——那是最容易被「重构后新路径」掩盖的地方。

---

## 2026-08：可计数（countable）任务编辑与前置引用的双向完善

本轮把 countable 任务的两块不完善一次性补齐：本体编辑入口缺失 + 同一任务的不同完成次数无法各自成为独立 prereq。

### 1. [共享] `GroupSpec.members` 从 `string[]` 升级为 `(string | {id,count})[]`

- **现象**：用户想把 `(B 完成第 1 次) AND ((B 完成第 2 次) OR C 完成)` 表达成单条 Edge 的前置 —— 需要 group 的不同 member 带不同引用次数。
- **根因**：旧 `GroupSpec.members: string[]` 不支持 per-member count，group 内所有 member 一律按 requiredCount=1；与 `SimpleSpec` 的 `count` 字段不对齐。
- **修复**：
  - TS 端：`packages/tracker-core/src/types.ts` 新增 `GroupMember = string | {id, count?}` 与辅助函数 `groupMemberId / groupMemberCount`；`GroupSpec.members` 改用 `GroupMember[]`。
  - Rust 端：`crates/tracker-core/src/types.rs` 新增 `GroupMember` 枚举，自定义 `Serialize / Deserialize`：`count==1` 输出字符串、`count>1` 输出 `{id,count}` 对象；反序列化兼容两种形态（旧 `["a","b"]` 与新 `[{"id":"a","count":2}]`）。
  - `compute_unlocked` / `computeUnlocked` 同步改：`group` 内部每个 member 按 `m.count()`（默认 1）调 `is_done(id, count)`。
- **回归**：
  - 旧 relations.json（`members: ['a','b']`）加载不报错，等价于 `count=1`。
  - 新形态写盘 → 重启读回一致。
  - book-tracker / life-tracker 全套 `cargo test` 与 `vitest` 全绿。

### 2. [life-tracker] countable 任务的 progress 与 status 解耦

- **现象**：countable 任务的「完成次数」是核心字段，但 `GoalDetail` 只在 `status === 'in_progress'` 时显示「量化进度」卡片，且只有 `-1/+1/+5/达成` 按钮，没有直接键入当前次数的位置。`handleSave` 在 `status !== 'in_progress'` 时还会主动清空 progress —— 与 countable 设计冲突。
- **根因**：countable 任务在设计上**不存在「全达成」语义**（总是能再做一篇），但旧 UI 与 save 逻辑按普通任务的「progress → 满即 done」处理。
- **修复**：
  - `GoalDetail`：新增独立「完成次数」section，含 number input（失焦保存）+ `-1/+1/+5` 按钮；条件改为 `goal.countable === true`，**不受 status 限制**。原有「量化进度」卡片对 countable 任务隐藏（避免重复 UI）。
  - `GoalForm`：镜像 —— `countable` 时显示「当前完成次数」输入，不依赖 `in_progress`。
  - `handleSave`：countable 任务的 progress.current 始终写盘（与 status 解耦）；非 countable 保留原行为。
- **回归**：
  - countable 目标详情页键入 5 → 保存 → 重启应用 → 仍为 5。
  - 切 status 到 done/shelved 不再误清 progress.current。

### 3. [life-tracker] 同一 countable 任务可被多次添加为 prereq（不同 count）

- **现象**：用户想让 `(B 完成 1 次) AND ((B 完成 2 次) OR C 完成)` —— 同一任务的不同完成次数是**独立的 prereq 条件**。旧 `PrereqEditor` 的 picker 候选 `!allPrereqIds.includes(b.id)` 禁止重复添加；旧 `removeRow` 按 `s.id` 去重删除，会误伤同 id 的其他 count 实例。
- **根因**：picker 筛选不区分 countable；`removeRow` 没有 (id, count) 精确匹配。
- **修复**：
  - picker 候选：countable 任务 `!allPrereqIds.includes(b.id) || b.countable` —— 已添加的 countable 继续可被再次选择；UI 上加「已添加 ×N」虚线徽标提示。
  - 多次添加：每次生成独立的 `simple` spec（count 字段可不同）；specs 数组里两条独立 spec，`prerequisites` 数组里 id 去重一次。
  - `removeRow`：按 `(id, count)` 精确匹配 simple spec —— 移除 count=1 的实例不会误删 count=2 的实例。
  - chip 渲染：countable 任务的 simple spec 始终显示 count 标签（`完成 N 次`，count=1 也显示，与 ×N 区分）。
  - group 创建 UI：新增「各成员引用次数」折叠区，对每个 member 单独设 count（仅 countable 任务生效）。
- **回归**：
  - `prereq_simulation.test.ts` 新增 5 条 fixture：多次 simple 共存、删除一个不影响另一个、group per-member count 增删、向后兼容旧 `string[]` 形态。
  - typecheck / 71 条 life-tracker 测试全绿。

### 4. [life-tracker] 同一目标多次添加时 chip key 必须含 count

- **现象**：添加 `simple B count=1` + `simple B count=2` 两条 spec，渲染的 chip React key 都是 `spec-simple-${i}-${s.id}` —— 同一 id 两条 spec 在不同位置 i 上 key 不会冲突，但视觉上无法区分「B 完成 1 次」与「B 完成 2 次」。
- **根因**：旧 key 公式不含 count；count 标签规则也只对 `count >= 2` 显示。
- **修复**：key 改为 `spec-simple-${i}-${s.id}-${s.count ?? 1}`；countable 任务始终显示 count 标签（count=1 也不省略）。
- **教训**：当数据模型允许「同 id 多实例」（如本轮的 simple per-count），UI 渲染必须能从 key 区分实例，否则 React 调和会误判、视觉上无法辨识不同实例。

---

## Windows 开发环境注意

- npm：PowerShell 执行策略可能拦截 `npm.ps1`，改走 `npm.cmd`
  （如 `npm.cmd --prefix apps/life-tracker test`）。
- 改动后验证：`npm.cmd --prefix apps/<app> run typecheck` + `npm.cmd --prefix apps/<app> test`；
  涉及 Rust 共享内核再加 `cargo test`（repo 根跑，注意 msys2 `ucrt64/bin` 在 PATH）。
