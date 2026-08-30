# 开发经验与注意点（Dev Notes）

> trackers monorepo 的**经验沉淀**文件。
> 约定：每次整改 / 增添功能后，如有值得留档的经验、注意点、踩坑，**追加**到本文件
> （新条目放在对应主题节的开头或按日期倒序排列）。

---

## 2026-08：[共享] ForceParamsPanel 默认值偏小 → 用户以为"4 个滑条拖了没反应"

### 1. 现象

用户反馈「齿轮点开后的那个面板，四个条，滑动了，没反应」（首轮还报成「设置点入后的
四个力参数」）—— 力参数面板的 4 个滑条（轨道力 / 抖动 / 向心力 / 电荷斥力）拖动后
右边的数值文字跟着变（受控 input OK），面板顶部的心跳指示器**也在闪**（force 函数
被 d3 调用），但**关系图节点运动没变化**或变化微小到肉眼当作「没动」。同一份代码
book/life 两 app 都有。

### 2. 根因

心跳闪 → force 函数被注册且每 tick 调用（`tickLive.current++` 在闭包里跑）；数字变
→ `setMotionVals` + `motionRef.current[key] = value` 都成功；d3ReheatSimulation 也
被调。但用户感知不到运动，**根本原因是 `DEFAULT_MOTION` 默认值偏低**：

| 参数 | 旧默认值 | max 滑条 | velocityDecay=0.4 下切向速度（60fps） |
|---|---|---|---|
| orbit | 0.12 | 0.2 | 默认 4.8 px/s，max 8 px/s |
| jitter | 0.08 | 0.2 | 默认 3.2 px/s（带方向） |
| centripetal | 0.04 | 0.1 | 默认 1.6 px/s（径向） |

节点稳态切向速度 ≈ `strength * velocityDecay / (1 - velocityDecay)` ≈
`strength * 0.67`，再乘 60 fps 才是每秒像素。**4-8 px/s 在普通显示器上看几乎像
"静止"**，用户拖滑条看到 0.12 → 0.2 的差只有几像素 / 秒的变化，第一反应是「没反应」。
再加 heart-beat 闪和滑条 handle 跟手，更像是「force 在跑但滑条对图无效」——典型的
「**用户报告里掩盖了真实症状**」案例。

这与 commit `2f3bcbc`（「调大力参数默认值 + 加 force 心跳指示器」）的初衷一致——
当时从 0.05/0.04/0.02 调到 0.12/0.08/0.04 已经加了 ~2.5×，但**还是不够明显**；
心率指示器虽然暴露了「force 在跑」的事实，却不能告诉用户「**节点其实在动，只是太慢**」。
那次调参只跑了 typecheck + test 就 close，**没有跑实际 Tauri 应用做肉眼验证**
（test 不覆盖 canvas 渲染速度）。

### 3. 修复

`packages/tracker-ui/src/GraphView/useGraphPhysics.ts` 的 `DEFAULT_MOTION`：

```ts
orbit: 0.12 → 0.15           // 默认切向速度 4.8 → 6 px/s
jitter: 0.08 → 0.15          // 默认抖动 3.2 → 6 px/s（带方向）
centripetal: 0.04 → 0.075    // 默认向心 1.6 → 3 px/s
// 三个都设为 max 的 75%：
//   orbit  max 0.2 → 0.15
//   jitter max 0.2 → 0.15
//   centripetal max 0.1 → 0.075
// 用户拖到 max 时 orbit / jitter 切向速度 ≈ 12.8 px/s，肉眼可清晰看到旋转
```

orbitHover / jitterHover / charge / velocityDecay 不动（hover 暂停目的不变）。

### 4. 回归验证

- `npm run typecheck` 三端全绿；
- `npm test` 211/211（life-tracker，含共享 core 测试）；
- **必须手动跑 book/life Tauri 应用肉眼确认**：开图后不拖滑条就能看到节点缓慢旋转
  + 抖动 + 向心聚拢；点开力参数面板，把 4 个滑条从 0 拖到 max，应能看到运动
  强度显著变化（默认就明显 + 拖到 max 更明显 + 拖到 0 完全静止）。

### 5. 教训

1. **「force 跑但视觉无变化」≠「force 没跑」**。d3-force 的每 tick n.x 增量是
   `strength * velocityDecay / (1 - velocityDecay)`，**strength 在 0.05 量级时
   在 60 fps 下只产生 3-4 px/s**，比浏览器 scroll 自动滚动还慢，肉眼直接当成「静止」。
   任何「持续动画」的 force 默认值，先心算一下稳态速度是不是肉眼可感知；
   看不到 = 不动（用户视角），不是「动得太快看不出」（过度小心）。
2. **vitest 跑过的算法测不到「运动快慢」**。`computeUnlocked` / `applyPairwiseResult`
   这种纯算法测试 100% 通过，但 `DEFAULT_MOTION` 这种「**决定用户视觉体验**」的数字
   常量，没有任何 test 覆盖——它的正确性只能靠肉眼。**Tauri 应用必跑肉眼验证**这一
   步不能跳过：typecheck + vitest 是「代码不破」的下限，不是「用户能用」的上限。
3. **用户报告要往「症状层」深挖一层**。第一轮报告「四个力参数没生效」+ 第二轮
   「滑动了没反应」都是模糊描述，必须追问「是数字变但图不动 / 还是滑条也拖不动 /
   还是心跳不闪」三个分支，每个分支对应的真根因完全不同。本例追到「心跳闪 + 数字变
   但图不动」就锁定了 force 函数跑着 + strength 偏小 路径，排除了 handleMotionChange
   没生效 / input 拖不动 / force 未注册等三个独立假说——**没有这一轮追问，方向
   可能跑到 retry-force 注册之类的 no-op fix**。
4. **首次调参的 commit 应该有 commit message 标注「未做 Tauri 实测，下次手动验」**。
   `2f3bcbc` 的 commit message 只说「调大力参数默认值 + 加 force 心跳指示器」，没说
   「没跑肉眼验证」。dev-notes 后续读者看到 default 数字会以为是反复打磨过的最优值，
   实际上可能从一开始就是基于「**我猜这样够明显**」的拍脑袋数字。把「验证状态」
   写进 commit message / dev-notes，能阻止下次再有「再调一档」「应该够明显了」的
   反复盲调。

---

## 2026-08：[共享] 关系图图例 4 个图标按钮的「没起到 active 态」——纯 SVG 按钮的居中 + aria 缺失

### 1. 现象

用户反馈「book 的 关系图 的 设置 的 四个条（齿轮 / 漏斗 / 列表 / 路径）没起到应有的状态」。
图例区底部 4 个图标按钮（力参数 / 过滤 / 节点列表 / 路径）确实在状态切换时拿到了
`.lg-toggle.active` CSS 类（背景从白变绿、icon 从灰变白），但用户感知不到——可能是
「active 视觉不够聚焦 / 无障碍不可读 / 视觉副作用掩盖」。同一份代码在 book/life 两
app 都存在，life 也一并修了。

### 2. 根因

四个症状叠加，每个都不致命，合起来让用户觉得"按钮没起到应有的状态"：

1. **纯 SVG 按钮 padding 不对称** —— `.lg-toggle` 通用 padding 是 `2px 8px`，对
   "文字 + padding" 的按钮（力导向 / 层级）正好；但图标按钮里只有 `<svg width="12" height="12">`，
   没有文字基线，inline-block 布局下 SVG 的 baseline 落到按钮下沿附近，**视觉上图标偏下 ~1px**，
   边框不对称显得"按钮没对齐"。

2. **icon 12px 偏小** —— 在 880~1200px 宽的图例区里，12px 图标在 8px padding 包围中视觉权重很弱，
   active 后整块变绿但图标细节难辨认。

3. **列表图标的"点"是看不见的** —— 原 SVG 把三个点画成
   `<line x1="3" y1="6" x2="3.01" y2="6" />`（长度 0.01 单位、viewBox 24×24 → 渲染 0.005px），
   等于没画。图标看起来只有 3 条横线、没有 bullet marker，**功能语义"列表 = 圆点 + 横线"
   表达失败**。

4. **无 `aria-pressed`** —— toggle 按钮只有 `aria-label`，没有 `aria-pressed`。
   屏幕阅读器无法播报"按下后处于激活态"；键盘 / 自动化测试也无法断言状态。

### 3. 修复

**共享 CSS（`packages/tracker-ui/src/GraphView.css`）**：

- 新增 `.lg-toggle--icon` 变体：`display: inline-flex; align-items/justify-content: center;`，
  配合 `padding: 4px 7px; min-width/height: 24px;`，让 SVG 在按钮内严格居中；
- `svg { display: block; vertical-align: middle; }` 显式压 baseline 偏移（inline-flex 已经
  居中，但 `vertical-align: middle` 是双保险，对老渲染路径 + screenshot 渲染更稳）。

**两 app GraphView（`apps/book-tracker/src/renderer/components/GraphView.tsx` +
`apps/life-tracker/src/renderer/components/GraphView.tsx`）同步**：

- 4 个按钮 className 加 `lg-toggle--icon` 修饰；
- `aria-pressed={state}` 四个都补：力参数 / 过滤 / 节点列表 三按钮直接挂 state；
  **路径按钮**用 `aria-pressed={pathMode || !!pathEndpoints.a}`（与视觉 active 条件对齐——
  path 模式下选完两个端点后 pathMode 会被自动置 false，但 pathEndpoints.a 仍非空，
  此时按钮依然显示为 active，aria 也要跟着 true，否则 SR 用户按下后听到 "not pressed" 跟
  视觉对不上）；
- icon 从 `width="12" height="12"` → **`width="14" height="14"`**；
- 列表图标三个"点"从 0.01 不可见线段 → 实际可见的 `<circle cx="3.5" cy="6/12/18" r="0.6" />`，
  视觉上"3 横线 + 3 圆点"，与"列表"的语义终于对得上。

### 4. 回归验证

- `npm run typecheck` 三端全绿；
- `npm test` 211/211（life-tracker，含共享 core 测试）；
- **未做实际渲染验证** —— commit message 与初版 dev-notes 提到
  「用 Edge headless 渲染 `test-buttons.html`（同款 CSS + 按钮结构）截图比对」，
  但**该 HTML 文件从未创建过**（仓库全树 `glob "**/test-buttons*"` 零结果），
  截图比对步骤是虚假描述。修复代码本身的逻辑（aria-pressed / className 拼接 /
  icon 14px / circle 替代不可见 line）人工 review 过，但**视觉聚焦是否够强**没
  经过真浏览器实测。后接手者如果怀疑 active 视觉仍不够聚焦，应先手动开个
  Storybook 或临时 HTML 渲染同款按钮结构再判断，别只看 dev-notes 以为验证过。
  这条虚假描述在 2026-08 的 force motion 调参条目里被正式修订（见下文「DEFAULT_MOTION
  偏小导致用户以为滑条失效」）。

### 5. 教训

1. **`<button>` 里只放 SVG 时，padding 要从"按文字"改成"按图标"**。纯 SVG 按钮没有
   文字基线、不会自动按 `line-height` 居中；要么 `display: inline-flex + align-items: center`，
   要么 padding 改成视觉对称的 `4px 7px` 而不是 `2px 8px`。后者只解决内边距对称、
   不解决 SVG baseline 偏移——前者才是根治。

2. **SVG 画"几乎不可见"的元素（长度 < 1 单位）= 画了等于没画**。viewBox 是逻辑坐标，
   不等于像素；0.01 单位的线段在 24×24 viewBox 渲染到 12×12 像素时是 0.005px，sub-pixel
   浏览器会直接吞掉。要画"点 / 小圆 / 短线"就别用 `<line>`、改用 `<circle r="≥0.5">` 或
   粗 `<line>`，并且**在目标渲染尺寸下肉眼检查**——screenshot 工具不渲染时 review 不出
   这种 bug，只能跑一遍浏览器。

3. **toggle 按钮的 `aria-pressed` 不是可选项，是 ARIA 规范要求**。`.active` class 只是
   视觉，SR 用户和自动化测试只听 `aria-pressed`——没有它，按钮的"激活态"对辅助技术
   不可见。**路径按钮这种"三态合一"（pathMode + pathEndpoints.a 都要参与）的尤其要小心**：
   SR 听到的状态必须跟视觉 1:1，否则按 SR 提示操作会跟肉眼看到的对不上。

4. **共享 CSS 的"对称镜像"也要 review**。本次 `.lg-toggle--icon` 加在共享
   `packages/tracker-ui/src/GraphView.css`，book/life 两个 GraphView 同步修——是因为
   两 app 用的是同一份共享 GraphView 的领域包装，**任何写在共享 CSS 的 toggle 样式
   改一处就两 app 同生效**。但 app 端 JSX 里的 `className` 拼接和 `aria-pressed`
   表达式是手写两份，本次同步对照改了 8 处（每 app 4 个按钮）——这种「共享层改 CSS +
   app 端改调用」的双层改动，**先改共享 CSS、再批量改 app 端**，顺序反了容易漏。

---

## 2026-08：[life-tracker] SettingsPanel 的 InfoTip tooltip 完全不显示——CSS 漏迁

### 1. 现象

`apps/life-tracker/src/renderer/components/SettingsPanel.tsx` 引入了新版 SettingsPanel：
- `Modal` 加 `className="settings-modal"`；
- 4 个字段 label 都套了 `<InfoLabel><InfoTip tip="..."/></InfoLabel>` 模式（? 提示图标 + 纯 CSS tooltip）；
- 第一行两列 grid 布局（默认类型 + 展示筛选）；
- 主题 / 格式卡片的 hint 文案从内嵌 `<span className="...-hint">` 换成 `data-tip` + `aria-label`。

视觉表现：life-tracker 打开设置面板，4 个字段的 `?` 图标没有、`settings-row` 的两列
grid 没生效、所有 hint 文字消失。**整个面板看着像"信息密度骤降"**。book-tracker 没
事（它原本就有这些 CSS）。

### 2. 根因

`SettingsPanel.tsx` 的重构是**从 book-tracker 同步过来的同款改造**（两 app 的 SettingsPanel
是字面意义上的同源代码）。但 book-tracker 的 `styles.css` 在 § Settings panel 块里**已有**
`.settings-modal .modal-body { overflow: visible }` / `.settings-panel` / `.settings-row`
（grid 1fr 1fr）/ `.field-label`（inline-flex 容纳 label + ?）/ `.field-info`（? 圆点 + hover
::after 黑底 tooltip + ::before 小三角）/ `.seg-chip`（展示筛选分段 chips）这一整套样式。

life-tracker 的 `styles.css` 在 § Settings panel 块里**只定义了 `.theme-picker` /
.theme-card / .format-picker / .format-card 四个类**（老的 theme / format 选择器）+ 卡片
tooltip 的 `::after` / `::before`，**所有 InfoTip 改造用到的 `.settings-modal` /
.settings-panel / .settings-row / .field-label / .field-info / .seg-chip` 全部缺失**。

简单说：book-tracker CSS 进化了、SettingsPanel.tsx 跟着改了；life-tracker SettingsPanel.tsx
跟着改了、CSS 漏迁。视觉上"看起来编译过、typecheck 过、但 UI 不对"——因为 pure CSS 缺类
不会触发任何 TS / Rust 错误。

### 3. 修复

`apps/life-tracker/src/renderer/styles.css` 在 § Settings panel 块最上方（紧邻 `.trash-list`
之后、`.theme-picker` 之前）补完整套类：

- `.modal-card.settings-modal .modal-body { overflow: visible; }`——关掉 modal-body 滚动，
  让 `.field-info::after` 的黑底 tooltip 能溢出 modal 上方显示（不然会被 modal-body 的
  overflow 裁掉）；
- `.settings-panel { display: flex; flex-direction: column; gap: 14px; }` +
  `.settings-panel .field small { display: block; margin-top: 4px; }`——容器；
- `.settings-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }` + `.settings-row .field { min-width: 0; }`——
  两列 grid，min-width: 0 避免 grid 子项被 input 内容撑爆（book 的同款 fix）；
- `.settings-panel .field > .field-label, .settings-panel .field-label { display: inline-flex; align-items: center; gap: 5px; }`——
  label 文本 + ? 图标的 inline-flex 容器；
- `.field-info`（13×13 圆点 ? 按钮）+ `:hover/:focus-visible`（背景变 accent）+ `::after`（data-tip
  黑底 tooltip + `max-width: 260px` + `width: max-content` 跟宽度自适应）+ `::before`（小三角）——完整镜像 book-tracker；
- `.seg-chips` / `.seg-chip` / `.seg-chip:hover` / `.seg-chip.active`——展示筛选 segmented chips。

### 4. 回归验证

- `npm run typecheck` 三端全绿；
- `npm test` 211/211（life-tracker 12 个测试文件全过）；
- 手测 life-tracker 设置面板：4 个 `?` 图标正常显示 + hover 弹黑底 tooltip + 第一行两列
  grid 排齐 + 主题 / 格式卡片 hint 改走 `data-tip` 正常显示。

### 5. 教训（共享）

1. **「同源代码跨 app」是真的同源代码，不是「长得像」就算**。本次 `SettingsPanel.tsx`
   book/life 共享 90%+ 结构，CSS 本应 100% 镜像——结果 life 的 styles.css 漏了 6 个
   类，纯 CSS 缺类不报错、typecheck / vitest / cargo test 全绿，只有人眼才看得出
   "life 设置面板长得跟 book 不一样"。**共享 JSX 改一处，CSS 必须 grep 两 app
   的 `styles.css` 同步看一遍**——尤其 InfoTip / tooltip / 新 className 这种纯 CSS
   增强。

2. **CSS 缺类不会触发任何编译错误**。grep 不到该类的样式定义 ≠ grep 不到该类的使用。
   预防方法：每次新增 className（包括 `data-tip` 这类新 attribute）先 grep 两 app
   的 `styles.css` 确认定义齐全，再提交 JSX。**反过来**：review 一个 app 的 CSS 改动
   时，另一 app 是否需要同步、是否已经在 commit 里同步了，必须手动 cross-check。

3. **`overflow: visible` 在 modal 内是关键**。`.field-info::after` 的 tooltip 想要
   溢出 modal 上方显示，必须关掉 `.modal-body` 的 `overflow-y: auto`——
   这条样式定义在 `.modal-card.settings-modal .modal-body`（双 class 选择器）而不是
   裸 `.modal-body`，正是为了**不污染其他 modal（详情 modal / 表单 modal）的滚动行为**。
   缺这一条，tooltip 会被裁掉、看起来"好像没生效"。

---

## 2026-08：[book-tracker] 排名对比卡片「点了没反应」——IPC 字段缺省没 `serde(default)`

### 1. 现象

打开「作品排名」Modal → 切到「开始对比」tab 后，左侧 / 右侧两张候选卡片视觉正常（标题、
评分、笔记都渲染对了），**点击任一张都没有任何反馈**：候选不切换、`本次已对比 +1` 不变、
`rankings.json` 不增长。Console 里有一条 `ranking apply failed: ...` 报错，但用户感知不到。

### 2. 根因

`PairwiseResult.ts: String` 是 Rust 端的**必填字段**（`crates/tracker-core/src/types.rs:238`
原本没有 `#[serde(default)]`），但前端 `store/ranking.ts::applyResult` 调
`api.ranking.apply({ a, b, winner })` 时**故意不发 `ts`**——设计就是「前端 ts 留空、后端
用 `frontmatter::now_iso()` 覆盖」（见 `service/ranking.rs:28-29` 的 `entry.ts = now_iso()`），
注释也写明 `// ts 由后端覆盖`。Rust 端类型定义没跟上设计意图，IPC 反序列化在「缺 ts」时
直接报错；catch 块只 `console.error`，不更新 store，currentPair 原地不动——用户看到的就是
「点了没反应」。

之所以这条 bug 一直没被 vitest 抓到：`packages/tracker-core/src/__tests__/ranking.test.ts`
测的是 TS 端的 `applyPairwiseResult` / `recomputeRatings` 纯函数（与 IPC 无关）；
`crates/tracker-core` 没有 IPC 反序列化测试；`apps/book-tracker/src-tauri/src/data/ranking.rs`
的 `read_ranking` 测的是「`rankings.json` → `RankingFile`」的方向（TS 已经填好 ts 再
写盘），不覆盖「JS 调 invoke 时入参缺 ts」这条路径。

### 3. 修复

- **Rust 端**（`crates/tracker-core/src/types.rs`）：`PairwiseResult.ts` 加
  `#[serde(default)]`，缺省反序列化为空串——与「后端覆盖」语义对齐，前端无需发 ts。
- **renderer 端**（`apps/book-tracker/src/renderer/store/ranking.ts`）：删掉死代码
  `entry: PairwiseResult = { a, b, winner, ts: '' }`（构造完从未发出去、底下 `void entry`
  单纯压 unused warning），以及同款死代码 `void file`；注释里把「ts 由后端覆盖」的来龙去
  脉和这次踩坑的根因写清楚，避免下次又有人「好心」传 ts。
- **回归测试**（`apps/book-tracker/src-tauri/src/data/ranking.rs::tests::pairwise_result_deserializes_without_ts`）：
  直接模拟 IPC 入参 JSON `{"a":"1","b":"2","winner":"a"}`（无 ts），
  `serde_json::from_str` 必须成功 + ts 兜底为 `""`。再补一个 `winner:"tie"` 的反序列化
  案例，覆盖三个 winner 分支。这是**唯一**能抓此类 bug 的测试位置——纯算法测试和读写
  往返测试都不够。

### 4. 回归验证

- `cargo test -p tracker-core` 95/95 全过（含既有 serde 命名兼容性测试）；
- `cargo test -p book-tracker` 32/32 全过（含新增 `pairwise_result_deserializes_without_ts`）；
- `npm run typecheck` 三 workspace 全绿；
- Tauri 应用需要重新 build 才能生效——`crates/tracker-core` 改了 Rust 源码，IPC 反序列化
  路径走的是新二进制；renderer 端 Vite HMR 自动接住。

### 5. 教训（共享内核相关）

1. **「后端覆盖」语义要在 Rust 端用 `#[serde(default)]` 显式声明**——不要假设前端会规规矩矩
   不发那个字段。`ts` 这种「后端永远会改」的字段，反序列化时缺省为 `""`（或任何合理占位）
   比「必填」更接近真实数据流；前端少传一个字段、少一处可能出错的边界。
2. **IPC 反序列化路径必须有专门的回归测试**——纯算法测试、读写往返测试都覆盖不到
   「JS 调用 invoke 时实际发什么 JSON」这条路径。新增任何 `#[tauri::command]` 处理的入参
   类型，至少加一条「构造一段真实 JS 侧会发的 JSON + 反序列化必须成功」的断言；这样未来
   一旦有人删 `#[serde(default)]` 或改字段命名，测试立刻响铃。
3. **前端 store 里的 dead code（构造了但没发出去的对象 + `void x` 压 warning）是 bug 信号**——
   这次 `entry` 变量就是证据：「`// ts 由后端覆盖`」的注释 + 一个永远不用的 `entry` =
   「设计意图是后端覆盖、但代码没真发 ts」。看见这种 dead code + 注释的组合，**先想清楚
   设计意图，再决定删 dead code 还是改实现**——别直接 `void entry` 就走。

---

## 2026-08：[共享] 新增 Unlock 图健康度分析（analyzeGraph + distanceTo）

### 1. 决策与算法

- **动机**：life-tracker 用户面对几十个目标的"前置依赖图"时，看不出图的健康状况——
  哪个是瓶颈、距离"国奖"还有多远、有没有孤立目标该清理。这是把"图记录工具"升级为
  "图决策工具"的关键一步，也是直接强化 monorepo 核心差异化（前置依赖 + 解锁）的扩展。
- **算法（analyzeGraph）**：拓扑角色（in/out degree）+ 节点分类（孤立 / 根 / 叶）+
  瓶颈 top 10（按出度排序）+ critical path（拓扑 + DP，已 done 折叠）+ 连通分量（DFS）+
  健康度（0..100，含完成率 / 孤立 / 瓶颈三段子项）+ `distanceTo(target)`（副产品）。
- **架构决策**：算法放 `packages/tracker-core/src/analyze.ts`，与 `computeUnlocked` /
  `computeBlockingRelations` 同款签名。book-tracker 也能 import，但 UI **仅 life-tracker**
  接入——保留 monorepo 的 core/app 分界（参考 docs/shared-boundary.md）。
- **谓词统一**：调用方传 `isDone`，由 life-tracker 的 `buildDonePredicate` 提供（含
  ExcludeSpec 改写 + countable 处理）。analyze 不重写谓词，避免与 unlock 路径不一致。

### 2. 踩坑与教训

1. **`localeCompare` 在 zh-CN 系统下中英混排顺序不稳定**——Node.js 默认 locale 跟随系统，
   zh-CN Windows 上 `localeCompare('SCI1', '三好')` 按拼音排，与其他 locale 不一致，
   跨平台测试会"同代码不同结果"。**统一用 `<`/`>` + 纯 Unicode 码点比较**（提取
   `cmpId(a, b)` helper），可预测、跨平台一致。性能对 O(N log N) 排序无感知。

2. **(r, e.to) 维度去重必须在循环内**——`blocksById[r]` 用 Set 去重只能保证下游列表唯一，
   但 inDeg / outDeg 已在循环里 +1 多次（同一对节点被多条 edge 重复指向，会算 N 倍出度）。
   countable 任务被多次 spec 引用（每次 count 不同）是真实场景，不修就夸大瓶颈分。
   **修复**：在循环顶部加 `seenPairs: Set<string>` early-return。配套：`countable` 任务
   一节点多 spec 引用现在只算一次出度，但**仍出现在 critical path 上**（作为前置），
   符合 unlock 语义。

3. **环节点在分类 + DP 两处都要显式跳过**——`detectCycles` 拿到环集合后：
   - **分类循环**（孤立 / 根 / 叶）必须 `if (cycleNodes.has(id)) continue`；否则环节点
     inDeg=outDeg=0 被错分到孤立（用户看到"3 个孤立"但其实只有 1 个真孤立）；
   - **critical path DP** 同款：环节点 `dist.set(n, 0)` 后 continue，不参与 maxD 计算，
     避免环节点串接成"伪最长链"。
   漏一处就 bug，测试用例要分别覆盖"分类排除"和"DP 排除"两条路径。

4. **`distanceTo` 是 `criticalPath` DP 的副产品**——单独实现 distanceTo 要重跑拓扑 + DP，
   浪费算力。**修复**：抽 `computeCriticalPathWithDist`，返回 `{dist, parent}`，
   `computeCriticalPath` 只算 max + 反推 path；`distanceTo` 直接读 `dist.get(target)`。
   API 表面对调用方多传一次 ids 是小代价，换零重复计算。

5. **空图的 healthScore 是设计选择**——按公式"0% 完成 + 0 孤立 + 0 瓶颈 = 0 + 30 + 30 = 60"
   看起来像"中等"。但"无可衡量 = 无问题"更符合直觉（用户刚开始用就没数据，不该扣分）。
   **修复**：`total === 0 ? 100 : ...`，同时 healthBreakdown 子项独立赋值，前端做
   breakdown 展示时不依赖总分。配套 vitest 改 expect 100。

6. **综合场景测试容易把"孤立节点"误归类为 root**——人工写测试期望时凭直觉把"我应该有
   X 个 root"算成"所有 0 入度节点"。但孤立节点（0 入度 + 0 出度）也是 0 入度——
   **是 orphan 不是 root**。**修复**：写测试期望时去翻算法分类的 if-else 条件（先
   `inDeg === 0 && outDeg === 0` 才 orphan，再 `inDeg === 0 && outDegree > 0` 才 root），
   不要"凭直觉写数字"。这种 bug 跑测试能立刻发现（典型综合场景期望 5 个 root，
   实际 3 个 + 2 个 orphan）。

### 3. UI 集成的架构红线

- **GraphView 第三种 mode 不破坏现有 force / tree 逻辑**——所有新分支都包在
  `if (layoutMode === 'analyze')` 里；motion / fx/fy 处理走单独分支
  （`motion=0` 静止但不重排，保留 force 当前位置）；不动 d3-force 模拟参数。
- **复用 `buildDonePredicate`，不绕谓词改写**——`useGraphAnalysis()` 与 `useUnlocked()`
  同款谓词构造，避免 analyze 路径下 ExcludeSpec 不生效或 countable 任务永远算 done。
- **不引入新组件类型**——复用 `@ui/Modal`、GraphView `nodeCanvasObject` canvas 描边、
  TopBar 现有 `on*` prop 模式。AnalyzeModal 是个新文件但不引入新组件类型。
- **CleanMode summary banner 不破坏现有 UI**——加 `onOpenAnalyze?` 可选 prop，
  默认空函数，App.tsx 透传 setAnalyzeOpen。空 goals 时不显示 banner（避免"100/100"
  误导用户"图是健康的"）。

### 4. 回归验证

`npm run test:core` → 131/131 pass（含 analyze.test.ts 42 个新用例）。
`npm run typecheck` 三 workspace 全绿。life-tracker 接入后 `npm run test:life` →
211/211 pass。

---

## 2026-08：[共享/领域] 影视主创字段加新成员（`screenwriter`）的对称实现模式

- **现象**：用户提出"电影信息里要有编剧"——已有的影视专用字段只有 `starring`（主演），
  没有"编剧 / 制片人 / 剪辑"等同类主创信息。
- **决策**：完全复用 `starring` 的实现范式（仅 movie/tv 暴露 + 空串不写盘 + 老文件缺字段
  → ""），而不是新建一套"通用 crew 字段"。理由：`starring` 已经定下"影视专用空字符串字段"
  的事实标准（类型层 `#[serde(default)]` + 写盘层 `if !empty`），同款规则扩字段成本最低、
  心智一致。
- **改动触点**（按 monorepo 根 AGENTS.md §七 "加新功能的标准流程" 走）：

  1. **类型契约**：`src/shared/types.ts` 的 `Book` 接口加 `screenwriter: string`（**领域类型**，
     留 app 不进 core——core 不感知"电影 / 编剧"领域语义）。
  2. **API 层**：`src/shared/api.ts` 的 `BookAPI.update` patch 类型加 `screenwriter?: string`；
     同步 `src/renderer/store/books.ts` 的 zustand `update` 签名。
  3. **UI 表单**：每个组件一份 `screenwriterLabelFor(kind)` helper（BookForm / BookDetail /
     RankingCompare），与 `starringLabelFor` 同款对称结构——"独立 input 行，不与 starring 复用"
     的取舍是为了避免"主演 / 编剧"在同一个 input 出现标签二义。
  4. **Rust serde 镜像**：`src-tauri/src/types.rs` 三处同步——`Book` 加
     `#[serde(default)] pub screenwriter: String`、`BookInput` 加 `#[serde(default)]`、
     `BookPatch` 加 `Option<String>`（None=不改 / Some("")=清空 / Some(s)=设值）。
  5. **数据层**：`src-tauri/src/data/books.rs` 四处插桩——`normalize_book` 加
     `data.get("screenwriter")...unwrap_or("")`；`write_book` 透传 `input.screenwriter.clone()`；
     `update_book` 加 `if let Some(v) = &patch.screenwriter { merged.screenwriter = v.clone(); }`；
     `persist` 加 `if !book.screenwriter.is_empty() { fm.insert("screenwriter", ...) }`。
  6. **测试**：复用 `starring_round_trip_and_omit_when_empty` 的 4 步断言——
     写盘 + 读回 / 空串不写盘 / 老文件缺字段 → "" / patch 合并（None 不改 / Some("") 清空 / Some(s) 设值）。
     `sample_input()` helper 必须同步加 `screenwriter: String::new()`，否则 compile error。
  7. **文档**：`README.md` 的功能清单 + AGENTS.md 的"已实现功能"+ frontmatter 约束段，
     与 `starring` 完全对称。

- **回归验证**：`npm run typecheck`（双段 node + web） + `cargo test -p book-tracker` 31 个
  测试全过，含新增 `screenwriter_round_trip_and_omit_when_empty`。
- **教训（共享内核相关）**：
  1. **领域字符串字段的对称扩展成本接近 0**：本例只动了 8 个文件，全部走"对称模式"，
     没有改动任何共享内核（`tracker-core` 不感知）——印证 `docs/shared-boundary.md`
     "两 app 都需要且语义一致才进 core" 的判定规则，`screenwriter` 是 book-tracker 专属
     影视主创字段，不污染 core。
  2. **`sample_input()` helper 是单测编纂点**：Rust 端所有 `BookInput` 相关测试都过它
     初始化；加 `BookInput` 字段后若忘了同步 helper，会触发"测试编译失败 + 现有用例全部红"
     的级联效应。这是反向保险丝：宁可让它响铃也别让它默吞。
  3. **`Record<EnumType, T>` 字典要加字段同步 grep**（参考 AGENTS.md §十踩坑 #15）：
     本例 `screenwriter` 没有踩这个坑是因为没新增 `BookStatus`；但下次给 `WorkKind` 加
     enum 值时，所有 `Record<WorkKind, string>` 的字典（`WORK_KIND_LABELS` +
     `authorLabelFor` + `yearLabelFor` + `countryLabelFor` + `translatorLabelFor` +
     `starringLabelFor` + `screenwriterLabelFor`）都得补全。grep `WorkKind` 一遍保险。

---

## 2026-08：排名 Modal 一打开就白屏（IPC 字段命名不一致）

### 1. [共享] 现象：点「排名」按钮（或按 `r`）整个窗口纯白，什么都不显示

- **现象**：book-tracker 打开「作品排名」Modal 后整个应用变成空白页——不是 Modal
  内容为空，而是 React 根节点被卸载（无 ErrorBoundary 时未捕获异常的标准表现）。
  仅在**当前类型已有「已读」作品**时复现；池为空时走空状态分支，反而看不出问题。
- **根因**：`RankingFile` 的 IPC JSON 字段命名两端不一致。
  Rust 侧 `crates/tracker-core/src/types.rs::RankingFile` 没有 `#[serde(rename_all)]`，
  序列化出 `initial_rating` / `k_factor`；TS 侧 `packages/tracker-core/src/ranking.ts`
  声明的是 `initialRating` / `kFactor`。于是 `file.initialRating === undefined` →
  `recomputeRatings` 把池内每个 id 初始化成 `undefined` → `RankingList` 里
  `const score = ratings[id] ?? file.initialRating` 仍是 `undefined` →
  `score.toFixed(0)` 抛 `TypeError` → 整棵树卸载 → 白屏。
  **类型系统抓不到**：类型只描述编译期契约，跨进程 JSON 的实际键名由 serde 属性决定，
  `tsc` 与 `cargo build` 都认为自己是对的。
- **修复**：
  - Rust `RankingFile` 加 `#[serde(rename_all = "camelCase")]`，两个算法参数字段各加
    `alias = "initial_rating"` / `alias = "k_factor"`，兼容旧版本已写盘的 `rankings.json`；
  - 前端加两层兜底：store `load()` / `applyResult()` 统一过 `sanitizeFile()`
    （`Number.isFinite` 校验 + 默认值回填、`history` 非数组归一为 `[]`）；
    `RankingList` 用 `scoreOf(id)` 取代裸 `??`，保证渲染路径永远拿到有限数值。
- **回归验证**：`cargo test -p book-tracker` 新增两条断言——序列化产物含
  `"initialRating"` / `"kFactor"` 且不含 snake_case 键；旧 snake_case 文件仍能解析出
  1200 / 24。三端 typecheck + `npm run test`（core/book/life 全量）全绿。
- **教训（通用）**：
  1. **凡是跨 IPC 的 Rust struct，字段名只要不是单个单词，就必须显式写
     `#[serde(rename_all = "camelCase")]`**，并在新增该类型时补一条"序列化键名"单测；
     只测 round-trip（Rust 写 → Rust 读）永远发现不了这类 bug。
  2. 前端消费后端返回的数值字段，**不要只用 `??` 兜 `null` / `undefined`**——
     `??` 对"key 存在但值是 undefined"的链式传播无能为力，数值路径应统一 `Number.isFinite` 校验。
  3. 应用层没有 ErrorBoundary 时，任何渲染期异常都表现为"纯白窗口"；
     排查此类现象的第一步是开 devtools 看 console，而不是怀疑 CSS。

### 2. [book-tracker] 对比卡片改为正方形 + 信息密度提升

- **需求**：原对比视图两张候选卡片只有「标题 / 作者·年份·国家 / tags」三行，且底部有一条
  「选 ← / 选 →」提示；卡片高度靠 `min-height: 280px` 撑，视觉上空且信息不足。
- **改动**（`RankingCompare.tsx` + `styles.css`）：
  - **删掉 `ranking-compare-card-pick`**：整张卡片本身就是 `<button>`，底部提示纯冗余；
  - **卡片正方形**：`aspect-ratio: 1 / 1` + `width: 100%` + `max-height: 100%`，高度由 grid
    轨道宽度推出；`.ranking-compare-stage` 改 `align-items / justify-items: center`
    （原 `stretch` 会与 `aspect-ratio` 打架，让高度重新由行高决定、宽高比失效），
    stage 自身 `flex: 1; min-height: 0` 吃满 `.ranking-body` 剩余高度；
  - **信息扩展**：类型徽标 + 池内排名（`当前第 N / M`）、标题、字段表（主创 / 年份 / 地区 /
    译者 / 主演 / 看过次数，label 走 `authorLabelFor` 等类型感知函数）、笔记 3 行 clamp
    （`-webkit-line-clamp`）、tags、底部评分脚注（评分 + 已对比次数，`margin-top: auto` 钉底）；
    卡片 `overflow-y: auto`，内容多时内部滚动而不撑破比例。
- **注意点**：`aspect-ratio` 与 flex/grid 的 `align-items: stretch` 互斥——被拉伸项的高度由
  容器决定，宽高比会被忽略。要保正方形，父容器必须让它 `center`（或显式不 stretch）。
- **回归验证**：`npm.cmd run typecheck` 全绿；`npm.cmd run test:book` 89/89 通过
  （exit 1 来自 vite configLoader 警告，§3 已记，非致命）。

### 3. [book-tracker] 对比卡片二次加密：字号上调 + 派生信息补位

- **现象**：卡片改正方形后，原有字段（标题 18px / 字段表 12px）在大方块里显得空。
- **改动**：
  - **字号整体上调**：标题 18 → 24px、字段表 12 → 15px（label 13px）、笔记 12 → 14px、
    tag 11 → 12px、评分由脚注小字改成 26px 主数字；Modal 宽度 780 → 920，
    卡片随 grid 轨道变宽、正方形边长同步变大；
  - **补"本来就有但没展示"的字段**：看过次数（恒显示，1 次也写）、最近更新、收录日期、编号；
  - **补派生信息**（无需改数据模型即可提升信息量的最划算来源）：
    - **Elo 预期胜率**（`expectedScore(scoreA, scoreB)`）——把分差翻译成"这一方赢的概率"；
    - **两者历史交手战绩**（`headToHead()` 扫 history，注意 `a`/`b` 位置可能互换，
      正反两向都要匹配再折算胜负），顶部 meta 与卡片脚注各展示一份；
  - 笔记摘要行数 3 → 4，并加左侧竖线区分引文。
- **经验**：卡片"显得空"优先从**已有数据的派生量**补（排名、胜率、交手战绩、时间戳），
  而不是急着加数据模型字段——零迁移成本、零写盘风险。


---

## 2026-08：EditMode 侧栏 status 分组可折叠同步到 book-tracker

### 1. [共享] 现象：life-tracker 已有 status 分组可折叠，book-tracker 没做

- **现象**：life-tracker 编辑模式侧栏（`GoalList`）早就有 `useCollapsibleSections` hook +
  status 分组 header 用 `<button>` 渲染（带 `▸/▾` caret + localStorage 持久化），用户可以
  点「已达成」/「进行中」等分组收起整片列表。但 book-tracker 的 `BookList` 还是普通 `<h3>`
  header，不可折叠——用户希望「想看」/「已读」等分组也能点 header 收起展开。
- **修复**（`apps/book-tracker/src/renderer/components/BookList.tsx` + `styles.css`）：
  - **hook 直接镜像 life**：复制 `useCollapsibleSections` 实现（localStorage key
    `'book-tracker:sidebar:collapsed-sections'` —— 注意**两个 app 各自的 key 不能混**，
    否则一边的折叠状态会污染另一边）+ `isCollapsed(key)` / `toggle(key)` 接口；
  - **header 由 `<h3>` 改成 `<button>`**：6 个 status 分组 + 底部「已收起」分组共 7 个 header
    全部改成 `<button className="group-header">`，点击触发 `toggle('status:<x>' 或
    'collapsed:bucket')`；折叠态加 `▸`、展开态加 `▾`；
  - **section 容器加 `is-collapsed` class**：折叠时 `<ul>` 整段不渲染（连同 `empty-hint`），
    跟 life 同款。匹配逻辑（`filtered(items)`）里已经有 `!b.collapsed` 过滤，不需要额外改；
  - **CSS 块从 `.book-list-group h3` 重写成 `.book-list-group .group-header`**：原 `<h3>`
    样式全部迁移到 `<button>`（color/uppercase/letter-spacing/flex/cursor）；新增 hover 背景
    （`rgba(0,0,0,0.03)`，与 life 同款）、`caret` 自动 `margin-left: auto` 推到右侧、
    `:focus-visible` 走全局 `var(--accent)` outline。
  - **「已收起」分组外层样式**：保留 `--collapsed-bucket` 修饰（dashed border-top + padding-top
    与 life 桶状一致），bucket 自身可折叠；bucket 内部按 status 拆 6 个**独立可折叠**子分组，
    与 life 5 status 同款结构（见 §1.5 子条目）。
- **回归验证**：
  - `npm.cmd run typecheck` 三端（node + web × book + life + core）全绿；
  - `npm.cmd run test:book` 89/89 vitest 全过（含 `ranking.test.ts` 等共享测试）；
  - `npm.cmd run test:life` 169/169 vitest 全过；exit 1 来自 vite configLoader 警告（dev-notes
    §3 已记，非致命）。
- **手动验证**：点「想看」header → 整片「想看」分组收起（header 变 `▸`、count 不变、列表消失）；
  刷新页面后状态保留；新开 tab 调 localStorage `book-tracker:sidebar:collapsed-sections`
  改值，原 tab 即时同步（storage 事件）。

### 1.5 [共享] 「已收起」bucket 内按 status 拆可折叠子分组（补 book-tracker）

- **现象**：上一轮把 `CollapsedSection` 平铺成扁平 `<ul>` 后，「已收起」内混杂全部 status 的
  作品（`reading/watching/want/finished/shelved/abandoned`），数量一多就难定位具体某本属于哪个
  status。life-tracker 的 `CollapsedBucket` 是按 status 拆 5 个**独立可折叠**子分组（每子分组
  自己有 caret 跟 sectionKey），book 这边结构不完整。
- **修复**（`apps/book-tracker/src/renderer/components/BookList.tsx` `CollapsedSection → CollapsedBucket`）：
  - **新组件 `CollapsedBucket`**：把扁平 list 拆成「外层 bucket」+「按 status 子分组」两层结构；
    外层 bucket 沿用 `book-list-group--collapsed-bucket` + `group-header--bucket`，子分组走
    `book-list-group--sub` + `group-header--sub`（缩进更深、字号 11px、取消 uppercase，与 life
    的 `--sub` 修饰同款）；
  - **三个独立折叠维度**：
    - bucket 自身（`sectionKey = 'collapsed:bucket'`）—— 收起 bucket 则整片 + 子分组一起隐藏；
    - 每个 status 子分组（`sectionKey = 'collapsed:<status>'`）—— 6 个独立 sectionKey；
    - 三层之间互不干扰：bucket 收起但内部子分组各 sectionKey 状态保留；bucket 展开后子分组
      仍按各自 sectionKey 折叠；
  - **空子分组不渲染**：用 `if (totalForStatus === 0) return null` 早退，避免无意义的 `<section>`
    跟空 `<ul>`；
  - **跨 status 聚合 memo**：`collapsedByStatus` 走 `useMemo` 一次性把 `collapsedItems` 按 status
    分桶；`filteredByStatus` 再在它基础上跑 `matchBook + worksFilter`，依赖数组里全列清避免
    stale closure（`collapsedByStatus` 是 memo 出来的稳定引用，依赖它就够了）；
  - **count 文案**：bucket header 显示 `(matchedCount/totalCount)`（搜索状态），子分组 header
    显示 `(items.length/totalForStatus)`，与 life 同款。
- **CSS 增量**（`apps/book-tracker/src/renderer/styles.css`）：
  - `.group-header--sub` 加入 `.group-header` / `--bucket` 的合并选择器（hover / caret / count
    / focus-visible 同款）；
  - 新增 `.book-list-group--collapsed-bucket { display: flex; flex-direction: column; gap: 10px; }`
    让 bucket 内子分组之间有 10px 间隔；
  - 新增 `.bucket-subs { ... padding-left: 8px; }` 让子分组视觉缩进；
  - 新增 `.book-list-group--sub .group-header--sub` 子样式（11px / 不 uppercase / weight 500）。
- **回归验证**：typecheck 三端全绿；`npm.cmd run test:book` 89/89 全过；手测 bucket / 子分组 / 三
  层折叠状态独立保留。

### 2. [共享] 教训：同源侧栏逻辑跨 app 镜像，localStorage key 必须独立

- **教训**：life 与 book 的 `useCollapsibleSections` 是字面意义上的同源代码——可以镜像、可以
  后续抽到 `packages/tracker-ui`，但**现在抽过早**：`BookList` / `GoalList` 本身还都是
  app 专属组件（详见 `docs/shared-boundary.md` C 类「领域专属」），hook 跟着 list 一起走
  等 list 一起共享，是最省心的迁移路径——不要为了"少 100 行重复代码"现在就抽到 `@ui/hooks`，
  导致 `BookList` 仍依赖 `@ui/hooks` 而 `GoalList` 不依赖的非对称依赖图。
- **教训**：localStorage key **必须带 app 前缀**（`book-tracker:sidebar:...` vs
  `life-tracker:sidebar:...`）——同机跑两个 app、共享同一个 origin（本地 `tauri://localhost`
  + 浏览器）的场景下，不带前缀会让一边的折叠状态污染另一边（收起「已达成」时把另一 app 的
  「已读」也一起收起）。
- **教训**：折叠态不写到 `<Book>` / `<Goal>` 上、只放 localStorage 的原因——同本书从「在读」
  收起、再切到「已读」时不应该自动展开（用户收起的是「在读 / 已读 视图下的位置」而非
  「这本书的状态」）；持久化在 localStorage 才能让用户关闭再打开 app 后保持折叠视图。
- **教训**：bucket 拆子分组时用 **三层独立 sectionKey**（bucket / 子分组 / status 分组）——
  局部折叠 UX 比"全部一起折叠"细腻得多。同 sectionKey 内只用一个 `collapsed` boolean 即可
  （book 只有一层扁平 list 时就是 boolean），多层折叠才升级到字符串集合 + key 前缀命名空间
  （`status:x` / `collapsed:bucket` / `collapsed:x`），前缀命名空间化是 localStorage 序列化
  与跨 tab 同步的唯一可靠做法。

## 记录规范

- 只写**中性、可提交**的技术经验；不写本机路径、私人陈述、内部对话原话（与 AGENTS.md 同标准）
- 每个条目保持最小结构：**现象 → 根因 → 修复 / 规避 → 回归验证**
- 两个 app 共享的通用教训标注 `[共享]`；仅单 app 的标注对应 app 名
- 涉及共享内核（tracker-core）的改动，记录时同步考虑是否要补 core 测试

---

## 2026-08：book-tracker 加「作品排名」（两两对比 Elo）

### 1. [book-tracker] 现象：用户希望给"看过的作品"做排名，二选一判断

- **现象**：用户提出新需求——给已读作品做排名。交互方式是"两两对比"（二选一判断哪个更喜欢），每次对比写入历史，由算法产出全序。"同类"指同一 WorkKind（书 vs 书、电影 vs 电影），不跨类。状态 = `finished` 才进入候选池。
- **设计要点**：
  - **算法选 Elo**：用户交给我选。Elo 收敛快、对随便点几下的容错性好、配对灵活；插入排序 O(n log n) 更直接但要求每次找到全序中正确插入位置（用户认知负担重）；tier list 太粗。
  - **pool 派生**：由前端持有 books 全量 + kind 过滤后**实时派生**当前池（不存盘）。理由：用户改 status / 删书会立即影响池子；存盘同步会引入额外失效路径。
  - **数据最小化**：rankings.json 只持久化 `history` + 算法参数（`initial_rating` / `k_factor`），**评分由前端从 history 重算**。删书后被删的条目自动从评分里消失（recomputeRatings 跳过 a/b 不全在 pool 内的条目），不需要专门清理。
  - **服务端覆盖 ts**：前端构造 PairwiseResult 时 `ts: ''`，后端 `service::ranking::append_result` 用 `now_iso()` 覆盖再写盘——避免前端时钟漂移污染历史时间戳。
  - **Elo 算法进 core**：虽然是 book-tracker 单 app 需求，但 Elo + pair 选择本身是纯算法（领域无关），按 `shared-boundary.md` 的"未来可能两边都用"标准进 `packages/tracker-core/src/ranking.ts`，TS + Rust 双端镜像。book-tracker 拥有领域侧（pool 从 books 派生、UI、store），共享内核拥有算法侧。
- **架构落点**（沿用 book-tracker 既有模式）：
  - `packages/tracker-core/src/ranking.ts` —— `PairwiseResult` / `RankingFile` 类型 + `applyPairwiseResult` / `recomputeRatings` / `countComparisons` / `pickNextPair` 纯函数；
  - `crates/tracker-core/src/types.rs` —— 镜像 `PairwiseResult` / `PairwiseWinner` / `RankingFile`（含 `Default` + serde default for initial_rating / k_factor）；
  - `apps/book-tracker/src-tauri/src/data/ranking.rs` —— `read_ranking` / `write_ranking`，缺失文件 + 缺字段都 fallback；
  - `apps/book-tracker/src-tauri/src/service/ranking.rs` —— `get_ranking` / `append_result`（覆盖 ts）；
  - `apps/book-tracker/src-tauri/src/commands.rs` + `lib.rs` —— `ranking_get` / `ranking_apply` 命令注册；
  - `apps/book-tracker/src/shared/api.ts` + `renderer/lib/api.ts` —— `RankingAPI.get() / .apply(result)` 桥接；
  - `apps/book-tracker/src/renderer/store/ranking.ts` —— zustand store（file / kind / currentPair / sessionCount + `deriveRanking` 派生 helper）；
  - `apps/book-tracker/src/renderer/components/Ranking{Modal,List,Compare,KindSelect}.tsx` —— UI；
  - `TopBar.tsx` + `App.tsx` —— 「排」按钮 + 快捷键 `r`。

### 2. [book-tracker] pair 选择策略：A 最少对比 + B 评分最近

- **策略**（`packages/tracker-core/src/ranking.ts::pickNextPair`）：
  1. A = 对比次数最少的 pool 成员（同等次数随机打破平局）—— 保证每本都被充分比过；
  2. B = 评分最接近 A 的 pool 成员（排除 A）—— 边界精度优先，Elo 收益最大的"决胜局"；
  3. pool < 2 返回 null，UI 展示「至少需要 2 个已读作品」空状态。
- **为什么不选其他策略**：
  - 纯随机：长尾 user 已经比过 N 次，新进作品没人碰；
  - 总是从两端（最高 vs 最低）选：边界快速收敛但中部作品排序质量差；
  - 强制同 kind 不再比：Elo 没有"已稳定"的概念，过早停止反而降序质量。
- **池过滤语义一致性**：`recomputeRatings` / `countComparisons` 都按 `a/b 都在 pool 才算` 的语义过滤历史——被删的条目不该让剩下的 id 单独"赚"对比数。
  这条一致是必要的：之前第一版 `countComparisons` 是分别判断 `a` 和 `b` 各自是否在 pool，导致 `history = [{a:1, b:99}]` + `pool = ['1','2']` 时 counts['1'] = 1（实际期望 0），跟 recomputeRatings 行为脱节——会让 pair 选择偏向历史对手已删除的 id。

### 3. [共享] 教训：纯算法即便单 app 需求也优先进 core

- **教训**：「用户只让我做 book-tracker」不等于「代码应该只在 book-tracker」。Elo + pair 选择本身不依赖 Book / Goal 任何领域概念——纯纯的算法。这种"领域无关的纯函数"按 `docs/shared-boundary.md` 的判断规则（两 app 都可能用 / 语义两边完全一致 / 改了不需要两边同步——本次先只 book-tracker 用，但前两条满足）应该进 `packages/tracker-core`。
- **教训**：进 core 后测试也按既有规范走：`packages/tracker-core/src/__tests__/ranking.test.ts`，vitest 自动被两个 app 的 vitest.config include 拾取，无需额外配置。
- **教训**：Rust 端序列化器对齐 TS 端：`PairwiseWinner` 用 `#[serde(rename_all = "snake_case")]` 让 `a / b / tie` 与 TS 字符串完全一致；`initial_rating` / `k_factor` 用 `#[serde(default = "...")]` 让旧文件无字段时反序列化不失败（RatingFile::default 兜底）。

### 4. [book-tracker] 教训：服务端覆盖 `ts` 比让前端传更稳

- **教训**：第一直觉是让前端构造完整 `PairwiseResult { a, b, winner, ts: new Date().toISOString() }`，但前端时钟可能被用户改、跨时区差异也容易让历史时间戳出现奇怪偏移。改成「前端 ts 留空、服务端用 now_iso() 覆盖」——前端少传一个字段、少一个容易出错的边界，后端单一时间源。
- **教训**：前端 store 的 `PairwiseResult` 类型可以保留 `ts: ''` 占位（TS 端 PairwiseResult.ts 是 string），构造时直接 `ts: ''`、序列化由 Tauri 命令参数对象传过去即可。后端 service 层读 entry 后**第一件事**覆盖 ts，避免后续字段冲突。

---

---

## 2026-08：详情面板 checkbox 简洁标签 + 悬停 tooltip（GoalDetail / GoalForm / BookDetail / BookForm）

### 1. [共享] 现象：详情面板里 checkbox 标签长、间距大，hover 又看不到详细语义

- **现象**：编辑模式详情面板（GoalDetail / BookDetail）的 checkbox 区有 3~4 个（life-tracker: 置顶 / 隐藏 / 侧栏收起 / 可计数），每个标签都很长（"置顶到『进行中』栏（日常模式顶部展示）"），互相间距 12px，整块占满小半屏；点开看才知道语义，hover 又没有详细说明。
- **根因**：旧实现把"语义 + 适用条件"塞进 label 文本作为单行说明，没有走 tooltip；间距用 `margin-top: 12px` 也很宽松，挤占纵向空间。
- **修复**（两 app 同款）：
  - **简洁 label**：life-tracker 4 个改成 4 字短词——「置顶进行中 / 日常模式隐藏 / 侧栏收起 / 可计数」；book-tracker 1 个改成「侧栏收起」。
  - **悬停 tooltip**：每个 label `<span>` 加 `title=` 属性，写详细语义 + 适用条件（"日常模式顶部『进行中』栏置顶展示（仅 in_progress 生效）"等）。鼠标悬停即看，符合"标签简洁、说明悬停"的常见 UI 模式。
  - **间距收紧**：`.form-checkline { margin-top: 12px → 6px }` + 新增 `.form-checkline + .form-checkline { margin-top: 4px }`（连续 checkbox 之间更近）；book-tracker 之前完全没定义 `.form-checkline`（BookDetail/BookForm 用的是裸 class 走浏览器默认样式），这次顺手补齐同款定义。
- **回归**：两 app typecheck + vitest 全绿；cargo test 不变。

### 2. [共享] 教训：checkbox 详情走 tooltip 而非塞进 label

- **教训**：详情面板复选框的语义（"在哪生效 / 影响什么"）放在 label 文本里，会让 label 越长越无法一眼扫读。规范是：**label 只放关键词（4~6 字最佳），详细说明走 `title=` tooltip**。这样 hover 时看到完整说明、扫读时只看短词，密度与可达性兼顾。
- **教训**：间距用 `gap`（flex）+ 相邻兄弟选择器 `+ .form-checkline` 比无条件 `margin-top` 好——第一项与上方表单字段的间距可以保持大一些（呼吸感），连续 checkbox 之间紧凑（密度），不冲突。

---

## 2026-08：PrereqEditor countable 任务前置展示改 (current/N)

### 1. [life-tracker] 现象：countable 任务作为前置时 chip 上「完成 N 次」展示有歧义

- **现象**：PrereqEditor 把一个 countable 任务作为 simple spec 前置时，chip 上挂一个 count-tag 写「完成 N 次」——`完成 1 次` 容易读成"做一次"，但其本意是"该 countable 任务需累计完成 N 次才算满足该前置"，跟普通任务的「做一次就 done」语义不同。`完成 2 次` 也偏冗长，且不能体现"已做几次"。
- **根因**：旧实现把"要求次数"当静态信息写死成 `完成 N 次`，没暴露进度（已做 / 还差几次），countable 任务的语义核心就是「完成次数累加」却被丢掉了。
- **修复**（`apps/life-tracker/src/renderer/components/PrereqEditor.tsx` `PrereqChip`）：
  - `countTagText` 分支：`g?.countable` 时改为 `(${g.progress?.current ?? 0}/${spec.count ?? 1})`——ratio 形式，跟同文件 spec-count / spec-group 已有的 `done/total` 文案同款（视觉密度也一致）；
  - 非 countable 且 `spec.count >= 2` 仍保持 `×N`——非 countable 任务没有 progress.current 可引用，ratio 没意义；
  - spec-group member 列表（line 140）一并改：`isCountable && c >= 2` 时 `${nameOf(id)} (${cur}/${c})`，跟 simple chip 同款；spec-count member 列表（line 158）不动——该 spec 自身已经渲染了独立进度条，再叠加 member 级 ratio 反而冗余。
- **关联文案同步**：`GoalDetail.tsx` 可计数 hint「其他目标通过引用次数（如『完成 2 次』）控制解锁」改成「如『(0/2)』」，与新格式对齐。
- **回归**：life-tracker typecheck 双段全绿；vitest 134/134 全过（含 update Goal fixture 的 graphview_donemap / visibility 测试）；cargo test 不变（不动 Rust）。

---

## 2026-08：EditMode 侧栏加跨 status「已收起」分组（Goal.collapsed / Book.collapsed）

### 1. [共享] 现象：用户希望编辑模式侧栏也能"收起"任务，与 status 解耦

- **现象**：CleanMode（日常模式）的「现在能推进」列表早就有"收起"按钮，写盘到 `hidden: true`，从 CleanMode 列表隐藏；EditMode 侧栏（按 status 分组）却没有对应交互——用户希望侧栏里也能把任意 status 的任务"折叠到一边"，但不改变 status。
- **设计要点**：
  - **复用现有 `hidden` 字段 vs 新建 `collapsed` 字段**：本轮**新建独立 `collapsed`**。
    - 原因：`hidden` 在 CleanMode 里**只在 `not_started / in_progress` 时有展示意义**（其他 status 本来就从 CleanMode 列表自然消失），且 CleanMode 的语义是"现在不想推这个目标"。EditMode 的收起是**任意 status 都允许的纯展示行为**，与解锁、CleanMode 完全正交——一个语义对应一个字段比"语义冲突共用一个字段 + 各种守卫条件"更清晰。
  - **EditMode 侧栏行为**：在 `BookList` / `GoalList` 的状态分组渲染完成后，加一个底部"已收起"分组，跨 status 收集所有 `collapsed === true` 的条目；状态分组本身的渲染逻辑保持不动，只在 `filtered(items)` 里加 `!collapsed` 过滤。
  - **详情面板 / 表单行为**：在 `BookDetail` / `GoalDetail` / `BookForm` / `GoalForm` 都加一个"在编辑模式侧栏中收起"勾选框，**没有任何 status 守卫**（所有 status 都允许）——这是与 `hidden` 字段最显眼的区别。
  - **持久化**：与 `hidden` / `pinned` / `countable` 同款——TS `Goal` / `Book` 接口字段 + Rust `Goal` / `Book` + `GoalInput` / `BookInput` + `GoalPatch` / `BookPatch` + `normalize_*` / `write_*` / `update_*` + `persist`（仅 `true` 时写盘），五个点全部镜像，旧文件无字段读回默认 `false`。
  - **CleanMode 影响**：life-tracker CleanMode 完全不变，仍走 `hidden` 字段；book-tracker CleanMode 本就没有 `hidden`，影响更小。
- **修复**（两 app 同款）：
  - `apps/life-tracker/src/shared/types.ts` + `src-tauri/src/types.rs` + `src-tauri/src/data/goals.rs` + `components/GoalList.tsx` + `components/GoalDetail.tsx` + `components/GoalForm.tsx` + `shared/__tests__/{graphview_donemap,visibility}.test.ts`（更新 Goal 构造 fixture）；
  - `apps/book-tracker/src/shared/types.ts` + `src-tauri/src/types.rs` + `src-tauri/src/data/books.rs` + `components/BookList.tsx` + `components/BookDetail.tsx` + `components/BookForm.tsx`；
  - 两 app `styles.css` 各加 `.status-dot.status-collapsed { background: var(--muted); }` 让侧栏"已收起"分组的彩色小圆点可见。
- **回归验证**：
  - 两 app `npm run typecheck` 全绿（双段 `tsc --noEmit`）；
  - 两 app `npm test`：life-tracker 134/134、book-tracker 71/71 全过（含更新后的 Goal/Book fixture 测试）；
  - `cargo test -p life-tracker` 14/14（新增 `collapsed_round_trip_and_omit_when_false` 含 true→写盘 / false→不写盘 / 旧文件→默认 false / patch.collapsed true→false / 与 status/hidden 正交共 5 段断言）；
  - `cargo test -p book-tracker` 19/19（同款新测试）；
  - `cargo test` workspace 全量 95 passed；
  - 手测：UI 侧栏勾选某条「已放弃」status 的目标 → 该条目从「放弃」分组消失、出现在底部「已收起」分组（带灰色 dot 与 status 文字）→ 详情面板 status 仍为「放弃」、CleanMode 列表不变。

### 2. [共享] 教训：正交语义建新字段，不要试图让一个字段"兼任"两层语义

- **教训**：`hidden` 字段原本只用于 CleanMode "现在能推进"列表的隐藏，**带 `status` 守卫**（仅 `not_started / in_progress` 有效）。如果 EditMode 侧栏收起复用 `hidden`：
  - 要么放松守卫条件（让 `done/shelved/abandoned` 也能标 `hidden`），会扩大现有 CleanMode 行为语义；
  - 要么再加一个 UI-only 守卫（EditMode 跳过守卫，CleanMode 走守卫），会在同一字段上分裂出两条规则路径。
- **教训**：**两个语义、两个字段**。`hidden` = "我现在不想推它"（CleanMode 行为）；`collapsed` = "我只是想把它从侧栏折叠出去"（EditMode 行为）。字段之间**完全正交**，UI 上也都明示（两个独立 checkbox，提示文案区分「CleanMode 现在能推进」vs「EditMode 侧栏」）。
- **教训**：两 app 都加 `collapsed` 时，Rust 端的字段加法顺序、serde 属性、`persist` 的「仅 true 时写盘」判断都要镜像——单 app 加一个字段出错的成本只是「这一个 app 编译失败」，两 app 加一个字段出错的可能性反而更低（因镜像后立即被 cargo test + vitest 抓到）。

### 3. [共享] 教训：测试 fixture 里的对象字面量要随字段扩展同步更新

- **教训**：TS 端的 vitest 用 `goal({ id, status: 'in_progress', ... })` 这种"缺省填充"工厂构造 Goal 对象，新增 `collapsed` 字段时工厂函数返回的对象字面量必须同步加 `collapsed: false`，否则 `tsc --noEmit` 会因「Property 'collapsed' is missing in type」错。
- **教训**：Rust 端的 `#[derive(Default)]` 不能省——`GoalPatch::default()` 用 `..Default::default()` 语法补齐缺失字段，每加一个 `Option<bool>` patch 字段都要让其它测试用 `..Default::default()`，**不要**写 `GoalPatch { hidden: Some(true) }` 这种全字段列出的写法，否则下个 patch 字段进来时这些"看起来无关"的测试会一起编译失败。
- **教训**：两 app 的前端 fixture（`graphview_donemap.test.ts` 的 `goal()`、`visibility.test.ts` 的 `goal()`）都需要补 `collapsed: false`，**不能**只更新一处——之前 `hidden` 字段添加时漏改 `visibility.test.ts` 是已踩过的坑（这次两处一起改）。

---

## 2026-08：GraphView 加显式"向心力" + 新增"层级布局"模式

### 1. [共享] 现象：关系图节点分布外圈太空，体感像"摊大饼"；用户希望有更紧凑的向心感

- **现象**：life/book 两个 GraphView 都是 charge=-80 + orbit=0.05（切向）的组合，
  节点在 (0,0) 周围稳定绕转，但外圈节点普遍飞到 ±150 半径外，整张图视觉上
  "散得过大"，特别是节点少（5~10 个）时中心一片空白、外围松散；
  用户原话："向心力可以稍微大一点"。
- **根因**：切向 orbit 与 charge 斥力的平衡只决定**角速度**，与"稳态半径"无关。
  d3-force 的 `forceCenter` 在 strength=1 时实际行为是"向**初始化时刻的质心**收敛"
  （不是向 (0,0) 收敛），半径方向上没有持续向心项，节点最终停在 charge-link-orbit
  合力 ≈ 0 的位置——而这个位置往往比直觉"中心"远。
- **修复**（`apps/life-tracker` 与 `apps/book-tracker` 两个 GraphView.tsx 同步）：
  新增 **`centripetalForce`** 自定义 d3-force——每 tick 给每个节点一个指向 (0,0)
  的径向速度增量（`vx += -dx/d*s`，`vy += -dy/d*s`），与 `orbitForce` 方向互为
  正交（一个切向、一个径向）。两个力一起作用时，节点仍能保持绕转，
  但**轨道半径被向心力收小**，整张图视觉上明显更紧凑。
  - 强度 0.02（与 orbit 0.05 同数量级但更小，避免节点被拉成黑洞）；
  - 通过 `motionRef.centripetal` 闭包注入，模式切换时统一控制；
  - 与 orbit/jitter 共用同一套"鼠标悬停时降到 0.004"的交互感知策略。
- **回归**：
  - 两 app `npm run typecheck` 全绿；
  - life-tracker 134/134 + book-tracker 71/71 vitest 全过；
  - 边缘节点在 0.02 向心力下半径从 ~150 缩到 ~90（force 模式下数据少时），无
    "图缩成一点" 副作用；切到 tree 模式后轨道力全 0、不再有任何径向运动。

### 2. [共享] 现象：用户希望新增"固定"布局，"从下往上越后置"

- **现象**：用户要求关系图多一种"更加固定一点"的布局模式——"那种从下网上，
  是越来越被后置的任务"。语义对应：从下到上 = 叶子 → 根 = depth=0 → depth=max，
  即"无前置"在最底、"层层后置"的总目标在最顶；且节点位置要稳定、不像力导向
  那样持续运动（"固定"）。
- **修复**（同样两个 GraphView.tsx 同步）：
  - **`computeDepths(nodes, links)`**：DFS 沿 `dependsOn` 边走，
    `depth = max(prereq 深度) + 1`，叶 = 0。环检测用 `visiting` 集合——
    回边返回 0 切断递归，避免无限循环；环上节点因此会聚到同一层
    （视觉上"扎堆"，提示用户数据有环，不是 bug）。
  - **`applyTreeLayout(nodes, depths)`**：按 depth 分层，canvas 坐标系里
    `y = (maxDepth - depth) * layerHeight`——depth=0 在屏幕下方（y 最大），
    depth=max 在屏幕上方（y=0）；同层按 id 排序后水平均匀居中分布。
    **钉死 fx/fy**：让 d3-force 即便还在 tick 也无法移动节点，
    保证"位置固定"。
  - **布局模式 toggle**：`layoutMode: 'force' | 'tree'`，状态切换走
    `useEffect([layoutMode, data.nodes, data.links])`：
    - 切 tree：所有动效强度置 0（orbit/jitter/centripetal=0） + 钉位；
    - 切 force：清掉 fx/fy + 恢复默认力强度（按当前 pointerOver 状态）。
  - **数据变更时重排**：data 变化（增删 goal）也会在 tree 模式下重新计算 depth
    并钉位，独立 useEffect 保证 mode 不变也响应；
  - **高亮钉中心仅 force 模式生效**：tree 模式不再覆盖 applyTreeLayout 的 fx/fy，
    否则高亮节点会被拽回 (0,0) 破坏层级；
  - **拖完节点回层级位置**：tree 模式下 `onNodeDragEnd` 立刻重算 depth + 钉回，
    防止"拖完变自由节点"。
- **回归**：
  - 两 app `npm run typecheck` 全绿；
  - life-tracker 134/134 + book-tracker 71/71 vitest 全过；
  - 手动验证：leaf 节点（如「掌握基础数学」）恒在最底行，根节点（如「国奖」）
    恒在最顶行；中间层按深度递增；环上节点肉眼可看出扎堆位置。

### 3. [共享] 教训：d3-force 的 `fx/fy` 是"绝对钉住"，但 tree 模式还要管"拖完回钉"

- **教训**：d3-force 的 `fx/fy` 在赋值后会强制把节点位置锁定到该坐标。
  但用户拖动节点时 d3-drag 会临时清掉 fx/fy 让节点跟手，**松手时 fx/fy 不会被
  自动恢复**——这在 force 模式下是想要的（节点保持自由），但在 tree 模式下
  就成了 bug：用户拖完发现节点"漂走"了，破坏层级。
- **教训**：在 `onNodeDragEnd` 里手工重钉一遍 `fx/fy` 是最干净的解法；
  比"全部钉死、用户拖不动"好（允许微调手感），也比"允许自由但下次切模式再钉"
  好（即时反馈、所见即所得）。
- **教训**：layer 维度（layerHeight/layerWidth）目前是硬编码常量（130 / 170），
  没有适配画布尺寸自适应。如果将来要做"画布小图自动缩层间距"，要在
  `applyTreeLayout` 里把 dims 改成参数化（按 `dims.w` / `dims.h` 计算），
  不要现在硬塞——目前用户数据规模（<200 节点）下硬编码值视觉上够用。

### 4. [共享] 教训：模式切换 effect 必须解耦"挂载"和"模式变化"两条路径

- **教训**：第一版实现把 `mode + data 变更` 都塞进同一个 useEffect，导致：
  - data 没变、仅切模式 → effect 跑（正确）；
  - mode 没变、仅 data 变（增删 goal）→ effect 跑（但因为 mode 没变，分支里什么都不做，
    tree 模式下不重算 depth、节点扎堆位置不变——bug）。
- **修复**：拆成两个独立 useEffect：
  - 一个只在 `layoutMode` 实际变化时切力/钉位（deps: `[layoutMode, data.nodes, data.links]`）；
  - 一个只响应 `data.nodes/data.links` 变化、在 tree 模式下重算层级（deps 同上，
    内部 `if (layoutMode !== 'tree') return`）。
- **教训**：写 React effect 时要明确"这条 effect 的语义触发条件是什么"——
  是「mode 改变」还是「data 改变」还是「两者」？混在一起短期省事，长期难调。
  把每条 effect 的 deps 与内部 early-return 一起设计，比"deps 一锅炖"清晰得多。

### 5. [共享] 教训：自定义 d3-force 必须用闭包注入 nodes + 强度

- **教训**：d3-force 在严格模式下调用 force 函数时 `this` 是 undefined，
  不能写 `this.nodes()`——必须用闭包捕获 `getNodes: () => GraphNode[]` 与
  `getStrength: () => number`，让 strength 在外部 ref 里变、force 函数读最新值。
  这条模式之前已经在 orbitForce / jitterForce 上踩过（dev-notes 里有过记录），
  centripetalForce 是同一套 pattern 的第三次落地——值得作为一个可复用的范式记下：
  「d3 自定义 force = `(getNodes, getStrength) => (alpha) => void`」。

---

## 2026-08：relations 不变量校验（`to` 唯一性）

### 1. [共享] 隐患：`compute_unlocked` 的 `to → Edge` 索引会静默吞掉重复边的前置

- **现象**（潜在，非当前 bug）：若 `relations.json` 里同一个 `to` 出现两条边，解锁计算只采用
  **最后一条**，前面所有边的前置条件全部消失——不报错、不警告、不留痕。症状与历史上
  `normalize_edge` 误用 `..Default::default()` 清空 `specs` / `excludes` 那次事故完全一样
  （「加了前置或互斥规则但读不到，像被删除了一样」），属于同一类「静默丢前置」。
- **根因**：`compute_unlocked` 用 `edge_by_to.insert(e.to, ...)`（TS 端 `edgeByTo.set`）把边索引
  成 `to → Edge`，**隐式假设 `to` 唯一但从不校验**。该不变量此前只由 UI 一层保证——
  `PrereqEditor` 保存时 `edges.filter((e) => e.to !== <id>)` + push 是 upsert 语义。
  不受此保护的入口：用户手工编辑 `relations.json`（本地文件应用的常态）、未来的批量导入 /
  迁移脚本、任何新增写入路径。
- **修复**：新增 `crates/tracker-core/src/validate.rs` + `packages/tracker-core/src/validate.ts`
  （1:1 镜像），提供 `validate_edges()` / `format_issues()` 纯函数。挂载点：
  - Rust：两个 app 的 `service/relations.rs` 在 `get_relations`（读）与 `set_relations`（写）
    各跑一次，`eprintln!` 告警；
  - TS：两个 app 的 `PrereqEditor` 在 `setAll` 前跑一次，`console.warn` 告警。
- **刻意保留的宽松语义**：**只告警，不拒绝**。cycle 仍然硬拒绝（环会让目标永久锁死），
  但不变量问题不阻断写入——避免历史数据一旦不合规就完全写不进去。要收紧：把 app 层
  `set_relations` 里那行告警改成 `write_relations` 的 validate 闭包返回 `Some(msg)`。
- **回归验证**：`npm run test:core`（vitest 55 passed，含 validate 8 条）+ `cargo test`
  （tracker-core 80 / book-tracker 18 / life-tracker 13，全 0 failed）+ `npm run typecheck` 三端全过。
  两个 app 的现有 `relations.json` 体检结果为「`to` 全部唯一」，启用告警不误伤存量数据。

### 2. [共享] 校验函数要和它防的行为绑在同一个测试里

- **注意点**：`validate_edges` 单独测「能报出重复」意义有限——真正要钉住的是
  「重复确实会导致前置丢失」这个行为。两端都加了同名回归锚点
  （Rust `duplicate_to_really_drops_prerequisites_in_compute_unlocked`、
  TS `重复 to 确实会让前置条件被静默丢弃`）：构造两条同 `to` 的边（一条要 x、一条要 y），
  只让 x 完成，断言目标**锁住**。
- **作用**：若将来把 `compute_unlocked` 改成合并同 `to` 的多条边，这两个测试会失败，
  直接提示同步放宽或删除 `duplicate_to` 检查，避免校验规则与实际行为悄悄脱节。

### 3. [共享] 输出顺序要显式稳定，不能靠 HashMap / 对象迭代顺序

- **注意点**：`validate_edges` 的返回顺序按各 `to` 在 `edges` 中**首次出现的顺序**。
  Rust 端 `HashMap` 迭代顺序不确定，因此单独用 `Vec<&str> order` 记首次出现；
  TS 端靠 `Map` 天然保序。两端都有「多处重复按首次出现顺序输出」的测试断言。
- **原因**：输出不稳定会让测试间歇性失败，也让两端日志无法直接比对——双语言镜像实现
  尤其需要可比对的确定性输出。

### 4. [环境] PowerShell 下 `npm` / `cargo` 的两个假失败信号

- **现象 A**：`npm run <script>` 报 `npm.ps1 cannot be loaded because running scripts is
  disabled on this system`（PSSecurityException）。
  **规避**：调 `npm.cmd run <script>`，不改机器的 ExecutionPolicy。
- **现象 B**：`cargo test 2>&1 | ...` 全部测试 `test result: ok, 0 failed` 但退出码是 1。
  **根因**：cargo 把编译进度写 stderr，`2>&1` 合并后 PowerShell 将其包成
  `NativeCommandError` 对象，污染退出码。**判据**：以 `test result:` 行的 `failed` 计数为准，
  不要仅看退出码就断定测试失败。

---


### 1. [共享] 现象：本地工作目录四个 node_modules 加起来 410 MB，"占空间大"

- **现象**：`<repo-root>` 仓库本地，`apps/book-tracker` 147 MB / `apps/life-tracker` 180 MB /
  `packages/tracker-core` 60 MB / 根 `node_modules` 23 MB——**四个 node_modules 410 MB，
  4900+ 个 packages 几乎全重复**（`typescript` / `vite` / `vitest` / `@tauri-apps/cli` /
  `@vitejs/plugin-react` / `@types/*` / `gray-matter` / `esbuild` / `rollup` / `rolldown` /
  `babel` / `lightningcss` 都装了 2~3 份）。`npm install` 一次要 60 秒。
- **根因**：仓库根 `package.json` 用 `npm --prefix apps/...` 串起来两 app——**这是"假 workspace"**，
  根 package.json 没有 `"workspaces"` 字段，npm 不知道这是 monorepo。结果 `apps/<name>/package.json`
  自己声明完整 `devDependencies`，每个 app 各自 `npm install` 一遍完整工具链。
- **修复**（一次性迁移）：
  1. 根 `package.json` 加 `"workspaces": ["apps/*", "packages/*"]` + 把 9 个共享 devDeps
     （`typescript` / `vite` / `vitest` / `@tauri-apps/cli` / `@vitejs/plugin-react` / `@types/node`
     / `@types/react` / `@types/react-dom` / `gray-matter`）上提到根 `devDependencies`；
  2. `apps/book-tracker/package.json` / `apps/life-tracker/package.json` 把 `devDependencies`
     块整段删掉，只留 `dependencies`（运行时）；
  3. `packages/tracker-core/package.json` 同上（只留 `dependencies: { }` 与 scripts）；
  4. 删 4 个 `node_modules/` + 3 个旧 `package-lock.json`（单 app 的 lockfile 删掉，根
     `package-lock.json` 是唯一 source of truth，npm workspaces 模式锁文件只能有一个）；
  5. 仓库根跑 `npm install` 一次，npm 自动把所有 devDep hoisted 到根 `node_modules/`；
  6. 把 `start.bat` 改 workspace-aware（菜单 6 = root install；测试菜单改成
     `npm run test:core` / `test:book` / `test:life` / `cargo test` 串联）。
- **效果（实测）**：
  - 4 个 node_modules 总和 **410 MB → 140 MB（-66%，省 270 MB）**；
  - `npm install` 60s → 1m（首次）；后续增量 < 5s；
  - book/life 各 app 目录不再有自己的 `node_modules/`（只有 root 处的 hoisted tree）；
  - `npm run dev` / `npm test` / `npm run typecheck` 从 app 目录跑也能找到 vite/tsc/vitest/tauri
    ——npm 自动把根 `node_modules/.bin/` 加到 PATH，不需要改任何脚本或环境变量。

### 2. [共享] 教训：npm workspaces 必须配 workspaces 字段，纯串 prefix 不会生效

- **教训**：把 `npm --prefix apps/foo run dev` 写在根 scripts 里，**不是 workspaces**——这只是
  "用 npm CLI 串起来多个独立 npm 项目"。hoist 只在 root `package.json` 声明了
  `"workspaces": [...]` 时才会发生；没声明的话，每个 prefix 子目录都按独立 package 处理、
  各自装自己的 `node_modules/`。
- **教训**：workspaces 模式下 **从 app 目录跑 `npm install` 是 anti-pattern**：会写到
  `apps/<name>/node_modules/`、绕过 hoist、跟根 lockfile 不一致。要么从根跑
  `npm install`（会同时处理所有 workspaces），要么用 `npm install -w <name>`。
- **教训**：workspaces 模式下 **单 app 的 `package-lock.json` 不能有**：npm workspaces 锁文件
  只能有一个（在根）；子目录如果有自己的 lockfile，会让 `npm install` 行为不一致（不同步
  hoist 决策）。迁移时三个 app/package-lock.json 全删。
- **教训**：不要给 `tracker-core` 加 `private: false` 或 `publish`——workspaces 共享靠
  `file:` 路径 / hoisted bin，不需要发布；`name: "tracker-core"` 已经够 alias 用了。
  不要为"看起来更规范"改成 `@trackers/core`——会破坏 `tsconfig.web.json` 里的 `@core/*` alias。

### 3. [共享] 经验：hoist 后 vitest/vite 的 ESM warning 是已知非致命问题

- **现象**：hoist 之后跑 `npm run test:life`（life-tracker vitest），stderr 出现：
  `(!) Your Vite config uses features that are unsupported by configLoader: 'native' ... 
   ESM syntax in a file loaded as CommonJS (vitest.config.ts:1:1)`
- **根因**：workspaces 下 vitest 把 `vitest.config.ts` 加载为 CJS，而里面写的是 `import`（ESM）。
  book-tracker 没这警告，life-tracker 有——区别仅是 life 的 vitest.config 里 `include` 是数组、
  触发了 Vite 6 的 native configLoader 探测（Vite 6 默认 loader 跟 TS 不兼容，会回退并报警告）。
- **现状**：**测试 101/101 全部通过**，警告是 Vite 6 future-deprecation，非 fatal。PowerShell
  把 stderr 转成 RemoteException，exit code 1 但测试结果是对的（看 stderr 与 test 输出分离）。
- **修复**（后续）：把 `vitest.config.ts` 重命名为 `vitest.config.mts`（强制 ESM），或者
  `apps/life-tracker/package.json` 加 `"type": "module"`（跟 tsconfig.web.json 不冲突，
  只影响该目录的 .js/.mjs 默认解析，.ts 不受影响）。记录在此，不在本次 workspaces 迁移里改。

### 4. [共享] 回归

- 全 `npm run test` 全绿：tracker-core 47/47 + book-tracker 47/47 + life-tracker 101/101 = **195 vitest**；
- 三端 `npm run typecheck` 全绿；
- `npm run dev:book` / `npm run dev:life` 启动验证 vite 二进制可达（dev 不在本轮跑完——不破坏
  scripts 即可，不需为增量改 60s 重启 tauri window 跑 cargo 编译）。
- workspace `npm ls --workspace <name> --depth=0`：三个 workspace 的依赖都正确解析，
  公共 devDep（typescript / vite / vitest / @tauri-apps/cli 等）只装一份。

---

## 2026-08：GraphView 悬空引用导致右键控制台一堆"node not found"异常

### 1. [共享] 现象：关系图右键后控制台出现多个红色 `node not found` 异常

- **现象**：life-tracker 关系图右键后（实际触发点在 mount / data reload，right-click
  只是其中一次会复跑 forceLink.initialize() 的入口），控制台连续抛出
  `Error: node not found: <id>` —— 每条悬空 link 一次。book-tracker 同套库、
  同套 link 生成路径，但用户数据悬空少，只看到 1 条异常；life-tracker 数据
  迁移 / 手工编辑 history 较乱，悬空多 → 一堆红字。
- **根因**：react-force-graph-2d 内部用 d3-force-3d 的 `forceLink`。`initialize()`
  会把 `link.source` / `link.target`（字符串）替换成 node 对象，找不到就抛
  `new Error("node not found: " + nodeId)`。两 app GraphView 旧实现都把
  `edge.prerequisites`（含「旧裸 id 兜底」或已删除 goal）原样塞进 `links`，
  没跟 `computeUnlocked` 那样 `prerequisites.filter((p) => idSet.has(p))` 过滤。
  reheat / 重新挂载 / 右键 hoverObj 重算等都会触发 `initialize()` 复抛 → 控制台一片红。
- **修复**（`apps/life-tracker/src/renderer/components/GraphView.tsx` 的
  `deriveLinks` + `book-tracker` 同款 data memo 改造）：
  - LIFE：`deriveLinks(edge, validIds)` 接收 goal id 集合；mkLink 检测 source/target
    任一不在集合里就返回 null，specs / 旧 groups / 纯 legacy 三个分支都走同套
    悬空过滤；refCount 累加前同步过滤 → 节点大小不会被悬空 link 撑大。
  - BOOK：`data` memo 里建 `bookIds = new Set(...)`，对 `e.prerequisites` 在
    `refCount` 自增前与 `links` 生成前都做 `bookIds.has(...)` 双端校验。
  - 语义对齐：`computeUnlocked` 早就 `idSet.has(p)` 忽略悬空 prereq，画图层
    按同一份"已存在 goal id 集合"过滤；unlock 计算不变（之前就不算悬空 prereq），
    只少画 / 少累 refCount 几条幽灵边。
- **回归**：
  - `apps/life-tracker/src/shared/__tests__/graphview_links.test.ts`
    加 8 个 case：legacy / specs simple / specs group / specs count / 旧 AND-of-ORs
    / 全空 / 半空 / 默认路径回归。
  - life-tracker 110/110 + book-tracker 47/47 + tracker-core 47/47 = 204 vitest 全过；
    `cargo test --workspace` 全过；两 app typecheck + `vite build` 全绿。
- **教训**：d3-force-link 的初始化失败是"无声但不静默"的——错误抛出来但 React 不
  会捕获，结果用户只看到控制台红字，UI 还可能继续渲染（节点出现但 link 缺失）。
  凡"传给 react-force-graph-2d 的 link"都要走 `validIds` 过滤一遍，
  与 `computeUnlocked` 的 `idSet.has(p)` 同步；这条不该只放在 unlock 层、画图层
  也必须独立一遍（force-link 的 `find()` 不会复用 unlock 的预过滤结果）。

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

---

## 2026-08：book-tracker「在看」状态 / 笔记 / tag UI / 类型感知标签

### 1. [book-tracker] 新增 `BookStatus` 枚举变体时的全仓库字典同步

- **现象**：`types.ts` 的 `BookStatus` 加 `watching` 后,renderer 各组件的 `Record<BookStatus, string>` 字典必须加对应 entry —— `BookList.STATUS_LABELS` / `GraphView.STATUS_LABEL` / `BookDetail.STATUS_LABELS` / `BookForm.STATUS_BASE_OPTIONS` / `PrereqEditor.STATUS_LABELS` 全部要补;`useGroupedByStatus` 的 `Record<Book['status'], Book[]>` 同样。
- **根因**：`Record<K, V>` 在 TS 里是 `{ [P in K]: V }` —— K 加新变体时所有 K-indexed dict 都会编译报错（`Property 'watching' is missing`），漏一处就 typecheck 红。
- **修复 / 规避**：加枚举变体后**立刻全仓库 grep** `BookStatus` / `Book['status']` 找所有 `Record<...>` 字典与 union 字面量,逐一补 entry。`STATUS_ORDER` / `RESTORE_TO` 这类数组型映射同样要补。
- **回归验证**：`npm.cmd run typecheck:book` —— 漏一处立刻红,等于自动体检。

### 2. [book-tracker] 可选字符串字段的"空串不写盘"语义

- **现象**：`notes: string` 这种用户可选字段,如果不区分"无笔记"与"空字符串",空串会写进 frontmatter,污染数据。
- **根因**：`serde_json` 默认会把空串序列化为 `"notes": ""`,占位且无信息。`progress: Option<Progress>` 已用 `None` 区分"未设置",但 String 字段没有天然的"可选"概念。
- **修复 / 规避**：Rust 端 `if !book.notes.is_empty() { fm.insert("notes", ...) }`,前端对应 `tags: []` 这种数组相反 —— 空数组 `[]` **要写盘**,因为"用户清空了所有 tag"是有意义的语义（区别于"从未设置"）。两种语义**不能混**,新加可选字段前先想清楚。
- **回归验证**：cargo test `notes_round_trip_and_omit_when_empty` 覆盖四个不变量:非空写盘 / 空串不写盘 / 老文件缺字段 → "" / patch.notes 三态合并。

### 3. [book-tracker] react-force-graph `nodeCanvasObject` 的 canvas 状态污染

- **现象**：在 `nodeCanvasObject` 里画 tag chip 时,如果直接覆盖 `ctx.fillStyle` 给文字着色,下一轮画下一个节点时背景色仍是文字色,导致 chip 串色。
- **根因**：Canvas 2D context 的 `fillStyle` / `strokeStyle` 是全局状态,d3-force tick 里 `nodeCanvasObject` 被频繁回调,改完不还原就一直影响后续。
- **修复 / 规避**：`drawTagChips` 在循环里**画完文字后立即重置 fillStyle 到背景色**(`ctx.fillStyle = '#eaf1ec'`),且每轮 chip 独立 setStyle 不依赖外层残留。或更稳妥:函数开头显式 setStyle,函数体内只读不写全局。
- **教训**:任何 react-force-graph 的 `nodeCanvasObject` 函数都要当作「无状态、可重入」对待 —— 不要假设 `fillStyle` / `font` / `lineWidth` 在入口是默认值。

### 4. [book-tracker] 类型感知的表单字段标签

- **现象**：同一份表单套 5 种作品类型(书 / 动画 / 电视剧 / 电影 / 其他),"作者"对书合适但对电影应是"导演";"年份"对书是"出版"对影视是"首播 / 上映"。
- **根因**：早期 form 硬编码字段名,语义跟 type 脱节。
- **修复**：纯函数 `authorLabelFor(kind)` / `translatorLabelFor(kind)` / `yearLabelFor(kind)` / `countryLabelFor(kind)` 集中维护 label 文案。`translatorLabelFor` 对 `kind === 'book'` 返字段名、其他返 `null` —— UI 用 `&&` 渲染,数据模型不变(非书类型的 `translator` 仍写空串)。
- **教训**：type-aware UI 文案**不要**散在 inline `三元 / switch`,集中成纯函数后两处表单(BookForm 加作品 / BookDetail 编辑)共享 + 加新类型时只改一处。

### 5. [book-tracker] PrereqEditor 「完成后将解锁」措辞误导

- **现象**：原措辞"完成后将解锁 N 部"被误读成"本节点完成 → 下游立刻解锁",但本节点通常只是下游的多个前置之一。
- **根因**：「将」字在中文里偏将来时,语义接近"必然"。
- **修复**：改为「完成后推动解锁 N 部」—— 「推动」明确传递"这是必要条件之一,通常还要等其它前置也达成"的语义。
- **教训**：解锁图相关 UI 文案要明确"本节点是多个前置条件之一"而非"本节点完成后必然解锁",避免用户对解锁图产生过度简化的心智模型。
- **共享范围**：两 app 的 PrereqEditor（book + life）+ 对应 styles.css 注释同步更新。

---

## 2026-08：Theme system（packages/tracker-ui + 三套 preset + 运行时切换）

### 1. [共享] 现象：两 app styles.css 几乎完全相同却各自一份；用户希望在设置里切风格且保留现状

- **现象**：book-tracker 与 life-tracker 的 styles.css 各自一份（1163 vs 1185 行，token + 组件样式几乎完全相同），仅 status 命名不同。同时用户提出"为了方便切美术风格，至少保留现在的样子作为基础预设"。
- **根因**：AGENTS.md §四 描述的 `packages/tracker-ui` 共享 UI 基座从未真正落地——只在文档里约定，没有从两 app 抽出。本次借主题系统机会一并落地。
- **设计要点**：
  - **三套 preset**：`classic` 保留当前样式（sage green + 系统字体 + 圆角）作为 fallback；`library` 是 book-tracker 特色（深森林绿 + Fraunces + 印章 mechanic）；`codex` 是 life-tracker 特色（朱砂红 + Fraunces + 印章 mechanic + deadline 提醒色）。三个 preset 都用同一套 base token，仅 override surface / accent / stamp / font-display / radius / shadow。
  - **运行时切换用 CSS 变量 + `data-theme` 属性**：`:root[data-theme="classic"]` 选择器覆盖 `:root` 提供的默认值；Vite 把三个 theme CSS 全部静态 import，切换零延迟（不重新加载 CSS）。Preset 间互不影响。
  - **共享 UI 基座顺手落地**：`Modal.tsx` 抽到 `packages/tracker-ui`（两 app 字节级相同的 53 行 → 共享），其它共享组件（TopBar / GraphView / PrereqEditor）差异较大，本轮先不抽，留 `docs/shared-boundary.md` 跟进。
  - **持久化**：theme 字段加到 `Config`（TS + Rust），Rust 端 `normalize` 与 `set_config` 都按"只接受已知 preset / 其它值 fallback classic"过滤，读写对称。
  - **防 FOUC**：`index.html` 内联 inline script 在 React 渲染前从 `localStorage` 抢先设 `data-theme`，让浏览器渲染 body 时背景/字体已匹配当前主题；settings store hydrate 后用 `Config.theme`（权威）覆盖一次。localStorage 是性能优化、不是 source of truth，避免 React 渲染前闪一帧。
  - **签名元素 № NNN + StampChip**：跨 preset 通用（`base.css` 提供 `.tracker-id` / `.tracker-stamp`），样式随 preset 变——classic 圆角无旋转，library/codex 方角 -2° 旋转。组件代码可在后续按需使用。
- **修复**（35 个文件改动）：
  - **新 `packages/tracker-ui`**：`package.json` / `tsconfig.json` / `src/base.css`（共享 token + reset + 通用排版 + 签名元素）/ `src/themes/{classic,library,codex}.css` / `src/useTheme.ts`（`applyTheme` / `normalizeTheme` / `THEME_META`）/ `src/Modal.tsx`（从两 app 抽取）/ `src/StampChip.tsx`（跨 preset 印章组件）/ `src/index.ts`。
  - **book-tracker + life-trenderer**：`vite.config.ts` + `tsconfig.web.json` 加 `@ui` alias + include；`index.html` 加 Google Fonts + 防 FOUC inline script；`main.tsx` 加四个 CSS import（base + 三个 theme + 自己的 styles.css）；`styles.css` 删 `:root` 块（token 已在 base + themes 里），保留旧名 `--shadow` 别名让组件代码不动；`components/Modal.tsx` 改 re-export from `@ui`；`store/settings.ts` 加 theme + hydrate 应用 theme + setTheme 同步 localStorage；`components/SettingsPanel.tsx` 加 theme picker（life 新建整个 SettingsPanel + TopBar 加 `onSettings` 按钮）；`shared/types.ts` 加 `ThemeName` + `Config.theme`；`src-tauri/src/{types,data/config,service/config}.rs` 镜像 theme 字段 + 加 `invalid_theme_falls_back_to_classic` 单测。
- **回归验证**：
  - `tsc --build apps/book-tracker apps/life-tracker packages/tracker-ui` 三端全绿；
  - `cargo test -p book-tracker -p life-tracker`：book 27/27 + life 23/23 全过（各 +1 新测试 `invalid_theme_falls_back_to_classic`）；
  - `vitest run`：book 89/89 + life 169/169 全过；
  - vitest alias 用数组形式 `{ find, replacement }`（Vite 5 推荐）替代对象形式，否则对 `@` 开头的 find 在 vitest 4 下报 `Cannot find package '@core'`——这是已知问题，对象形式偶尔被识别成 npm scope 名绕过 alias 解析。

### 2. [共享] 教训：CSS preset 切换用 `data-theme` 属性比 dynamic import 简单十倍

- **教训**：第一直觉是"用户切主题时 dynamic import 不同的 CSS"，但 Vite 的 dynamic import 不直接支持 css（只能 js 里 import css 再插入 style 标签），需要写个 hook 管理 `<link>` 注入/移除，复杂度高。**用 `:root[data-theme]` + 三个 theme CSS 全部静态 import** 简单太多：
  - 切换性能：纯 DOM 属性改写（< 1ms），无网络、无解析；
  - 切换抖动：CSS 选择器 `:root[data-theme="x"]` 的 specificity `(0,1,1)` 高于 `:root`，preset 内的变量自动覆盖基础值；
  - bundle 体积：三个 theme CSS 都很小（每个 ~30 行），多加载 ~2KB 一次性成本，换永久零延迟切换 + 水合安全。
- **教训**：跨 preset 的"通用识别元素"（№ NNN 编号 + StampChip）放 `base.css` 而不是三个 theme 各写一遍——基础组件跨 preset 一致性比差异化更重要，差异化留给 token。
- **教训**：防 FOUC 的 localStorage 不是 source of truth——只是性能优化。真正的 source of truth 是 `Config.theme`（持久化在 Rust 后端）。settings store hydrate 时同步 localStorage + Config，避免两套值偏离导致"切了一次不持久化"。

### 3. [共享] 教训：vite/vitest alias 对 `@` 开头的 find 用数组形式

- **教训**：Vite 5 的 `resolve.alias` 接受对象 `{ '@': ... }` 和数组 `[{ find: '@', replacement: ... }]` 两种形式。**对象形式偶发触发 `Cannot find package '@core'`**——Vite 把 `@core` 当 npm scope 名处理（npm 私有 scope 命名约定），绕过了 alias 解析。**数组形式绕开这个判定**，所有 find 都按字面量匹配 replacement。统一两 app 的 `vite.config.ts` + `vitest.config.ts` 都用数组形式，避免一处对象一处数组导致调试方向走偏。
- **教训**：vitest 用 vite.config 的 alias，但**从 monorepo root 跑 vitest 找不到各 app 的 `vitest.config.ts`**——vitest 默认 cwd 是当前目录，不会自动找子目录的 config。正确做法：从各 app 目录 `cd apps/<name> && npx vitest run`，或者在根 `package.json` 的 scripts 里显式 `npm --workspace <name> run test`。本轮 4 个 shared 测试失败就是这个原因，alias 改数组形式之后从 app 目录跑全部通过。

