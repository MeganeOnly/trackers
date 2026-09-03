# 开发经验与注意点（Dev Notes）

> trackers monorepo 的**经验沉淀**文件。
> 约定：每次整改 / 增添功能后，如有值得留档的经验、注意点、踩坑，**追加**到本文件
> （新条目放在对应主题节的开头或按日期倒序排列）。

---

## 2026-09：[共享] React Hooks 调用顺序违规——`useMemo` 放在 early return 之后，切换「未选条目 → 选了条目」直接崩

### 1. 现象

启动 `book-tracker`，打开任意一个 `BookDetail` 详情面板，控制台立刻抛：

```
Warning: React has detected a change in the order of Hooks called by BookDetail.
   Previous render            Next render
   ------------------------------------------------------
1. useCallback                useCallback
2. useCallback                useCallback
...
57. useEffect                 useEffect
58. undefined                 useMemo
   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

Uncaught Error: Rendered more hooks than during the previous render.
    at useMemo (BookDetail.tsx:160:26)
```

整个 `<BookDetail>` 节点直接报红，UI 进入 error boundary fallback。

### 2. 根因

`BookDetail` 的结构（修复前）：

```tsx
export function BookDetail({ bookId }: BookDetailProps) {
  // ...useBooksStore / useUnlocked / ~18 个 useState / 一个 useEffect（无条件调用）

  if (!book) {                              // ← early return
    return <div className="detail-empty">...</div>
  }
  const cur = book

  // ...几个 const 派生值...

  // v1.6 「下一季」—— 当前 book.nextSeasonId 引用的目标 book
  const nextSeasonBook = useMemo(           // ← ★ hook 放在 early return 之后
    () => (cur.nextSeasonId ? books.find((b) => b.id === cur.nextSeasonId) : undefined),
    [books, cur.nextSeasonId]
  )
  // picker 候选:排除自己;tv/anime 优先;按 title 升序;最多 12 个
  const nextSeasonCandidates = useMemo(() => {   // ← ★ 同上
    return books.filter((b) => b.id !== cur.id).sort(...).slice(0, 12)
  }, [books, cur.id])
```

`book` 在 store 里没匹配到时（典型场景：刚加载 books 数组但 `selectedId` 还指向一个被删的 id）是 `undefined`，**前一次渲染**走 early return → hook 计数停在 57。**下一次渲染** book 找到 → 走到 useMemo → hook 计数变成 58 + 59。React 内部用 hook index 维护状态数组，前后两次计数对不上 → 抛 "Rendered more hooks than during the previous render"。

这是 **Rules of Hooks** 的标准违规：**hooks 必须无条件、相同顺序、在组件顶层调用**。

### 3. 修复

**所有 hook 上移到 early return 之前**，内部用 optional chaining 兜底 `book === undefined` 的分支：

```tsx
  // ...前面所有 hook 不变

  // ★ hooks 必须无条件调用 —— useMemo 必须在 early return 之前。
  // 否则切换「未选条目 → 选了条目」时 React 看到 hook 数量变化,直接抛
  // "Rendered more hooks than during the previous render"。
  // book 可能 undefined(从集合里找不到),内部用 optional chaining 兜底。
  const nextSeasonBook = useMemo(
    () => (book?.nextSeasonId ? books.find((b) => b.id === book.nextSeasonId) : undefined),
    [books, book?.nextSeasonId]
  )
  const nextSeasonCandidates = useMemo(() => {
    if (!book) return []
    return books
      .filter((b) => b.id !== book.id)
      .sort((a, b) => {
        const aTv = a.kind === 'tv' || a.kind === 'anime' ? 0 : 1
        const bTv = b.kind === 'tv' || b.kind === 'anime' ? 0 : 1
        if (aTv !== bTv) return aTv - bTv
        return a.title.localeCompare(b.title, 'zh')
      })
      .slice(0, 12)
  }, [books, book?.id])

  if (!book) {
    return <div className="detail-empty">...</div>
  }
  const cur = book                          // cur 在 narrowing 之后才有意义,放这里
  // ...cur.id / cur.progress 等后续使用
```

`useMemo` 依赖数组里的 `cur.id` / `cur.nextSeasonId` 改成 `book?.id` / `book?.nextSeasonId`（optional chaining 在 deps 里也是合法的，且 `undefined → string` 的切换会触发正常重算）。`cur` 本身留在 early return **之后**，因为它只在 narrowing 后才有意义。

### 4. 回归验证

- `npm run typecheck` 三端（book + life + tracker-core）全过；optional chaining + 类型 narrowing 无 TS 报错
- `npm test` 12 文件 / 223 个 vitest 全绿（BookDetail 是 renderer 组件，没有专门测试，但相关 store / 共享 pure 函数全套都跑过）
- 控制台不再出现 Hooks order warning，error boundary 不再被触发

### 5. 教训（共享）

**a) Rules of Hooks 是硬规则，不是优化建议**。React 用 hook index 对应 fiber.memoizedState 数组，前两次渲染 hook 数量 / 顺序不一致 → 后续 hook 拿到的 state 全错位。本质上跟数组越界一样，差异只在 React 用 try-catch 把它兜成了"组件级红屏"而不是程序崩溃。

**b) 代码审查快速判定法**：在每个 React 函数组件里扫一遍 hook 调用（`useState` / `useEffect` / `useMemo` / `useCallback` / `useRef` / `useContext` / `useSyncExternalStore` / 自定义 hook），确认**所有 hook 都在所有 early return 之前**。一行命令：

```bash
grep -nE 'use(State|Effect|Memo|Callback|Ref|Context|SyncExternalStore)' \
  apps/book-tracker/src/renderer/components/*.tsx \
  apps/life-tracker/src/renderer/components/*.tsx
```

**然后人工检查每个 early return 之后有没有 hook**。本次就是漏了这一步 —— 加 v1.6「下一季」字段时新加了两个 `useMemo`，直接放到了「if (!book) return」下面，没注意。

**c) 「if (!something) return 之后再用 hook」是常见诱因**：常常出现于"先判空再算 derived"的模式。正确写法是**先做所有 derived（含 hook），再 early return**，derived 里用 optional chaining 处理 undefined。TS 的 `if (!x) return` narrowing 在 closure 里也是传播的，所以 early return **之后**使用 `x` 仍然是 narrowing 后的类型，不用 `cur` 这种 alias 也行（这次为了最小改动保留了 `cur`，但本质上是冗余）。

**d) ESLint 规则 `react-hooks/rules-of-hooks`** 是兜底，**`react-hooks/exhaustive-deps`** 不管顺序。如果项目里装的是 `eslint-plugin-react-hooks`，这次错误应该是能在 lint 阶段抓到的。但 monorepo 目前没开 ESLint（看 `package.json`），所以只能靠人工审查 + typecheck + 运行时控制台。

**e) 这条 bug 是 v1.6 加 NextSeasonPicker 时引入的**（commit `apps/book-tracker` v1.6）。教训：加 v1.6.2 类似"新功能 + 派生值"时，**lint diff 里 `useMemo` 出现的位置**就是审查重点 —— 任何「先 early return 再 useMemo」都是反模式。

---

## 2026-08：[共享] 关系图默认初始 zoom 太小——新加 `useInitialZoom`，v11→v12 拉到 ~2.5

### 1. 现象（v11）

经过 v7→v10 一路把 charge / centripetal / linkDistance 调到力导向集群风格后，用户继续反馈"节点还是看着挤"。检查后发现**问题不只是物理**——`react-force-graph-2d` 内部用 `ZOOM2NODES_FACTOR(4) / cbrt(N)` 算初始 zoom，N=27 时 ≈ 1.33。节点在画布上只占视觉区域的一小块，**即便物理布局已经拉开，人眼看仍觉得"挤"**。

这跟 v7→v10 调的物理参数没关系——纯粹是"画布渲染比例"的问题。

### 2. 修复（v11）

新加 `packages/tracker-ui/src/GraphView/useInitialZoom.ts`：

- 公式 `initialZoom = clamp(6 / cbrt(N), 1.0, 2.0)` —— 比库默认 1.5× 大
  - N=8   → cap 在 2.0（6/2=3.0 → clamp）
  - N=27  → 2.0（6/3 = 2.0，无需 clamp）
  - N=64  → 1.5（6/4）
  - N=216 → 1.0（6/6，到下限不再放大）

### 3. 继续反馈"默认再大一点"（v12）

v11 推上去后用户继续反馈"再大一点"。v12 直接把系数往激进推：

- `INITIAL_ZOOM_FACTOR: 6 → 8`（整体公式变陡，2× 库默认而非 1.5×）
- `INITIAL_ZOOM_CAP: 2.0 → 2.5`（上限抬高，典型节点数 N=27 从 2.0 → 2.5）
- 新对照表：
  - N=8   → 2.5（8/2=4.0 → cap）
  - N=27  → 2.5（8/3≈2.67 → cap）
  - N=64  → 2.0（8/4）
  - N=216 → 1.33（8/6）
  - N=512 → 1.0（8/8，到 floor 不再放大）

### 4. 关键：不会被库的 onFinishUpdate 覆盖回去

react-force-graph-2d 内部 `onFinishUpdate` 有这条逻辑：

```js
if (transform(state.canvas).k === state.lastSetZoom && graphData.nodes.length) {
    state.zoom.scaleTo(elem, state.lastSetZoom = ZOOM2NODES_FACTOR / cbrt(N));
}
```

即"当前 zoom == 上次设置的 zoom"才覆盖。我调 `fg.zoom(myK)` → 内部 `state.zoom.scaleTo(elem, myK)` —— **这条路径不更新 `state.lastSetZoom`**。下次 `onFinishUpdate` 看到 `transform.k (myK) !== lastSetZoom (库默认)` → 跳过覆盖。我的 zoom 持久。

### 5. 取舍

- **不重设**：filter 切换 / 加书后不重置 zoom；用户加一本书时图不该自己缩放。
- **一次性**：用户手动 zoom 后也不会被悄悄覆盖（`zoomAppliedRef` 哨兵只跑一次）。
- **不暴露 panel**：v11/v12 不加 zoom 滑条——zoom 是浏览行为不是物理参数；用户用鼠标滚轮 / ctrl+wheel 即可，需要精细控制时再加。

### 6. 回归

- `useInitialZoom.test.ts`（9 个）—— 锁死 N=8/27/64/216/512/0/10000 七个取值，硬挂 `INITIAL_ZOOM_FACTOR=8`、`INITIAL_ZOOM_CAP=2.5`、`INITIAL_ZOOM_FLOOR=1.0` 三个常量（v11 是 8 个，v12 增到 9 个因为典型节点数从 64 改为 512）。
- tracker-ui 全套 41 个 vitest 全过（v10 是 32，v11 是 40，+1）。
- `npm run typecheck` 三端 + core 全过。

### 7. 教训

**「节点挤在一起」要分清三层：**

1. 物理层（v7→v10）：charge / centripetal / linkDistance —— 节点在"模拟空间"里的位置
2. 渲染层（v11→v12）：zoom —— 画布"相机"看多近
3. 视觉层：节点大小（`nodeRelSize` / `NODE_SIZE_FN`）—— 节点圆多大

用户连续 4 轮反馈"挤"时，第 1 层我已经调到 panel 上限，但**第 2 层没动过**。物理层调到极限 ≠ 视觉上不挤 —— 因为相机离得太远，节点物理拉开了但视觉上还是小。**规律**：调物理参数没解决视觉问题 → 检查渲染层（zoom / canvas size）有没有同时被卡住。

更一般：**不要把"用户看着挤"全部归因到物理力**，要看 canvas 实际占用的像素面积。如果节点在画布上只占 20% 的可见区域，再大的斥力也只是把节点推到画布外而已 —— 物理拉得开但视觉上"挤在一角"。

**另外（v12 新增）**：用户连续反馈"再大点"时不要只调系数、还要同步抬 cap。v11 的 `INITIAL_ZOOM_FACTOR=6` 单调拉到 8 也能让典型 N=27 节点的 zoom 从 2.0 → 2.67（自然超过 cap）；但因为 cap 还是 2.0，最后还是被截到 2.0 —— **调系数和调 cap 必须同步**，否则公式斜率变了但上限没动，实际效果不变。

---

## 2026-08：[共享] 关系图力导向从"半径圆"切换到"拓扑集群"——`centripetal` 降 + `linkDistance` 显式配置

### 1. 现象（v7→v8→v9→v10 的连续迭代）

经过 v7（charge -120→-200）、v8（再加 centripetal 0.08→0.04 + charge -200→-260）、v9（charge -260→-300）三轮把"散开"推到 panel 上限后，用户继续要求"减小默认向心力、增大相联系节点引力" —— 整张图的诉求从「节点能看清」转向「按主题分群」的力导向图谱风格。

### 2. 修复（v10）

- `DEFAULT_MOTION.centripetal: 0.04 → 0.01`（稳态向心 5.6→1.4 px/s，几乎取消径向收口 —— 不再"绕中心转"的圆盘结构，转为 link 拓扑决定的集群形状）
- 新增 `DEFAULT_MOTION.linkDistance: 20`，覆盖 d3 默认 `forceLink.distance=30` —— 让相连节点明显拉成视觉集群

`useGraphPhysics` 增加 `linkInitializedRef` 哨兵 + `setLinkDistance` setter，**首次就绪时**调 `fg.d3Force('link').distance(20)` 一次性写默认（react-force-graph 在 mount 时注册 link force，后续 graphData 变化只调 `.links()` 不重创建 —— 所以 `.distance()` 只设一次就持久）。

d3 默认的 link **strength 不动**（`1/min(count[src], count[tgt])`，按度数自适应 —— hub 节点自然变弱，避免被多边拉得太紧）。如果用户想要"全连接等强度"再考虑暴露。

### 3. 配套：把 `linkDistance` 加进 panel 滑条

`ForceParamsPanel.RANGES.linkDistance: [5, 80]` step 5，新增"连接距离"滑条（默认 20）。理由：用户已经在 4 轮迭代里反复调"节点分散 / 集群"相关参数，加 slider 比"再改一次 DEFAULT_MOTION"迭代更快 —— 用户能直接看效果。

滑条走 `setLinkDistance` 链式 setter（同 `setCollideRadius` 模式），`.distance(value)` + `d3ReheatSimulation()` 即时生效。

### 4. 视觉预期（用户视角）

- 不相关节点被强斥力 (`charge=-300`) 推到画面边缘
- 相关节点被 link (`distance=20`) 拉成紧密集群
- 整张图视觉上自然分群（按主题 / 知识域 / 目标族）—— 经典 force-directed graph 风格

### 5. 回归

- `tracker-ui` 32 个 vitest 全过；`motionInit.test.ts` 同步 hardcoded `centripetal: 0.04 → 0.01`。
- `book-tracker` 131 个 + `life-tracker` 211 个测试全过。
- `npm run typecheck` 三端 + core 全过。

### 6. 教训

**1. 「让相连节点抱团」在 d3 里就是 `linkDistance` 调小**，不是调 `charge` 或 `collideRadius` —— 后两者是"全节点间"作用力。混淆表现：「拖 collisionRadius 到 2.5 节点还是散开的」—— collsion 是全局最小间距，不会让相连节点"抱团"。

**2. d3 默认的 `forceLink.strength` 是度数自适应的 `1/min(count)`**，调它会让 hub 节点的连接等强度变弱 —— 多数场景不用动。如果用户反馈"hub 节点被多边拉得不稳"，**优先调 `collideIterations` 或 `linkDistance`**，不要动 strength。

**3. `d3Force('xxx', newFn)` 会让 simulation 重新跑初始化 nodes 路径**，所以"设一次"模式需要哨兵 ref。但 `linkForce.distance(value)` 这种链式 setter **不会**触发重初始化（distance 内部只换 `distance` accessor + 调 `initializeDistance()`），可以直接调。判断口诀：

- `forceLinks(links)`、`forceManyBody(strength)` → 设后想"立即生效"必须 reheat 但不需要哨兵
- `forceCollide.radius(fn)`、`forceLink.distance(num)` → 设后 reheat 即生效，**哨兵只是防"用户调过的值被 effect 重跑冲掉"**
- `fg.d3Force('xxx', newForce)` → 会让 simulation 重新初始化，必须用哨兵（见 `linkInitializedRef` / `chargeInitializedRef` / `collideInitializedRef`）

---

## 2026-08：[共享] 关系图默认节点挤在一起看不清——`DEFAULT_MOTION.charge` 一路从 -120 提到 -300

### 1. 现象

用户报「关系图打开看的时候，节点都挤在一块看不清楚」。

### 2. 修复（v7）

`DEFAULT_MOTION.charge: -120 → -200`（1.67× 散开）。仍低于 `ForceParamsPanel.RANGES.charge.min = -300`，留余量给用户在面板继续拉。

### 3. 根因续（v8）—— 「光拉 charge 拉不动」

用户报"还是太小"。检查后才发现问题：charge 是 d3 的 1/r² Barnes-Hut，**近距时推力会塌缩到 ~0**；而 centripetal 是每 tick 恒定向心（v_ss ≈ 11 px/s）。**两者不同量纲**：

- 想把"近距"节点推开 → 要靠 centripetal 让出来 —— 但 centripetal 是径向向心、专管收半径
- 想把"远距"节点推开 → charge 越强越散

只在 charge 单边加力，只能让"远端更散、近端照样塌"。需要**两边一起调**才能在"平衡半径"处让 charge 胜出。

### 4. 修复（v8）

- `DEFAULT_MOTION.centripetal: 0.08 → 0.04`（稳态向心 11→5.6 px/s，半径更大一档）
- `DEFAULT_MOTION.charge: -200 → -260`（同倍 1.3× 散开）

### 5. 修复（v9）—— 直接顶到 panel max

用户继续报"默认排斥力再大一点"。这轮不再纠结 centripetal，单边把 charge 推到 panel 下限：

- `DEFAULT_MOTION.charge: -260 → -300`（顶到 `RANGES.charge.min`）

**取舍**：默认 = panel 最强档后，用户不能再靠面板往上推，只能调弱（往 0 方向）。这是有意识的 trade-off —— 用户已经明确"想更散"的诉求，迭代三轮都没找到平衡点，说明默认值应该偏激进；想再散下一步是同步拉高 panel max（`-300 → -400`）或继续降 centripetal。

### 6. 回归

- `motionInit.test.ts`（12 个）全过 —— charge 不在 MotionDecision.values 里，v9 只改 charge 字段。
- tracker-ui 全套 32 个 vitest 全过；core / book / life 全跑 211 个全过。
- `npm run typecheck` 三端 + core 全过。

### 7. 教训

**「节点挨在一起」要分清是 charge 还是 collide**：

- 节点互相覆盖、看着是叠在同一个圆里 → collide 力不够 → 调 `DEFAULT_MOTION.collideRadius` 或 collide iterations。
- 节点都活着、彼此清晰、但整体靠中心、间距偏小 → charge vs centripetal 平衡问题 → 调两边。

混淆的常见症状：「调了 collideRadius 到 2.5 节点还是挤成一坨」——其实撞不动的是 charge vs centripetal 的平衡，collideRadius 拉到天上去也没用。

**另外（v8 新增）**：「调散 charge 没用」通常是 **charge 和 centripetal 不同量纲导致的近端盲区** —— 光拉 charge 拉不动，centripetal 必须同步降。这条规律适用于任何「恒定径向力 vs 1/r² 斥力」组合（不限于 d3-force，也适用于自实现物理模拟）。

**再另外（v9 新增）**：用户连续三轮反馈"默认想更散"时，**默认值应该偏激进** —— 反复迭代没找到平衡点说明"中等值"不是用户的目标；激进默认值让想"调紧"的用户也能调（panel 还有空间往 0 方向调），只有想"调散"的用户才被卡住 —— 而被卡住的少数用户才会继续反馈，多数被满足的用户沉默。这是一个用户反馈的"沉默多数"陷阱。

---

### 2. 根因

`useGraphPhysics.ts` 里 `DEFAULT_MOTION.charge = -120` 是「v4 灵动」那次定的——当时配合 `collide`（2026-08 加）才让节点不重叠、但**轨道半径偏紧**。collide 解决的是"两个节点不能完全画到一起"，charge 解决的是"节点之间保持多远"。两者正交：用户看到的「挤成一团」是 charge 决定的稳态半径太小、不是 collide 失效。

### 3. 修复（v7）

`DEFAULT_MOTION.charge: -120 → -200`（1.67× 散开）。仍低于 `ForceParamsPanel.RANGES.charge.min = -300`，留余量给用户在面板继续拉。

### 4. 根因续（v8）—— 「光拉 charge 拉不动」

用户报"还是太小"。检查后才发现问题：charge 是 d3 的 1/r² Barnes-Hut，**近距时推力会塌缩到 ~0**；而 centripetal 是每 tick 恒定向心（v_ss ≈ 11 px/s）。**两者不同量纲**：

- 想把"近距"节点推开 → 要靠 centripetal 让出来 —— 但 centripetal 是径向向心、专管收半径
- 想把"远距"节点推开 → charge 越强越散

只在 charge 单边加力，只能让"远端更散、近端照样塌"。需要**两边一起调**才能在"平衡半径"处让 charge 胜出。

### 5. 修复（v8）

- `DEFAULT_MOTION.centripetal: 0.08 → 0.04`（稳态向心 11→5.6 px/s，半径更大一档）
- `DEFAULT_MOTION.charge: -200 → -260`（同倍 1.3× 散开）

`RANGES.centripetal max=0.25`、`RANGES.charge min=-300` 不动 —— 用户仍可在面板继续调。hover 三个常量不动。

### 6. 回归

- `motionInit.test.ts`（12 个）全过 —— 同步把 hardcoded `centripetal: 0.08` 改成 `0.04`（防 "DEFAULT_MOTION 改值忘同步"）。
- tracker-ui 全套 32 个 vitest 全过；core / book / life 全跑 211 个全过。
- `npm run typecheck` 三端 + core 全过。

### 7. 教训

**「节点挨在一起」要分清是 charge 还是 collide**：

- 节点互相覆盖、看着是叠在同一个圆里 → collide 力不够 → 调 `DEFAULT_MOTION.collideRadius` 或 collide iterations。
- 节点都活着、彼此清晰、但整体靠中心、间距偏小 → charge vs centripetal 平衡问题 → 调两边。

混淆的常见症状：「调了 collideRadius 到 2.5 节点还是挤成一坨」——其实撞不动的是 charge vs centripetal 的平衡，collideRadius 拉到天上去也没用。

**另外（v8 新增）**：「调散 charge 没用」通常是 **charge 和 centripetal 不同量纲导致的近端盲区** —— 光拉 charge 拉不动，centripetal 必须同步降。这条规律适用于任何「恒定径向力 vs 1/r² 斥力」组合（不限于 d3-force，也适用于自实现物理模拟）。

---

## 2026-08：[共享] 关系图 hover 时节点被向心力拽到中心互相覆盖——centripetal 漏了 hover 自适应

### 1. 现象

用户报「关系图上鼠标悬停时，**节点之间距离很近的时候会全部聚集在一起**」。具体场景：

- 关系图打开后节点正常旋转（orbit + jitter + centripetal 三力平衡）；
- 鼠标移入画布，**节点明显塌缩到画布中心，互相重叠成一大坨**，点不到单个节点；
- 鼠标移出后离心 + 切向的轨道力恢复，节点重新散开。

复现规律：**节点距离越近塌缩越明显**（charge 是 1/r² 衰减，密了之后压不住 centripetal 的恒定向心）。

### 2. 根因

`useGraphPhysics.ts` 里三个自定义 d3-force 的 hover 自适应**只对 orbit / jitter 实现了**：

```ts
// orbit / jitter：hover 时 min(base, hover 值)
fg.d3Force('orbit', orbitForce(() => nodes, () => {
  const over = pointerOverLive.current
  const base = motionLive.current.orbit
  return over ? Math.min(base, DEFAULT_MOTION.orbitHover) : base   // ✓
}))
fg.d3Force('jitter', jitterForce(...))                              // ✓
// centripetal：完全不读 pointerOverRef！
fg.d3Force('centripetal', centripetalForce(() => nodes, () => {
  return motionLive.current.centripetal    // ❌ hover 时仍以 0.15 全速向心
}))
```

`DEFAULT_MOTION` 注释（v4 那行）原本写的是「hover 时 strength 降到 0.004」——**意图是三股力都降**，但代码只对 orbit/jitter 落地。`motionInit.ts` 的 init 路径也漏了 centripetal（测试当时还明文写「centripetal 不参与 hover 自适应」）。

物理后果：
- 鼠标进图 → orbit ≈ 0、jitter ≈ 0（切向 + 噪声消失）；
- centripetal 仍以 `0.15 / tick` 恒定向心，d=0.3 下稳态速度约 21 px/s 向心；
- charge (-120) 在节点相互远离时是主导、节点靠近时是 1/r²，密了以后根本压不住 0.15 的恒定向心；
- 结果：所有节点被持续拽向 (0,0) 中心，互相覆盖。

### 3. 修复

让 centripetal 也走 hover 自适应，与 orbit/jitter 对齐。

**1) `DEFAULT_MOTION` 新增 `centripetalHover: 0.004`**（与 orbitHover/jitterHover 同值，与 v4 注释意图对齐）：

```ts
export const DEFAULT_MOTION = {
  orbit: 0.35,
  jitter: 0.25,
  centripetal: 0.15,
  orbitHover: 0.004,
  jitterHover: 0.004,
  centripetalHover: 0.004,   // ← 新增；hover 时也降到 ~0，图完全冻结
  charge: -120,
  velocityDecay: 0.3
} as const
```

**2) `useGraphPhysics.ts` 的 centripetal force 注册读 `pointerOverRef`**：

```ts
fg.d3Force('centripetal', centripetalForce(() => nodes, () => {
  tickLive.current++
  const over = pointerOverLive.current
  const base = motionLive.current.centripetal
  return over ? Math.min(base, DEFAULT_MOTION.centripetalHover) : base
}))
```

`Math.min(用户值, hover 默认值)` 与 orbit/jitter 同模式 —— 用户在 panel 拖到 0 不会被 hover 反向"拉"到 0.004。

**3) `motionInit.ts` 的 init 路径也带上 centripetalHover**：

```ts
return {
  kind: 'init',
  values: {
    orbit:     hover ? DEFAULT_MOTION.orbitHover     : DEFAULT_MOTION.orbit,
    jitter:    hover ? DEFAULT_MOTION.jitterHover    : DEFAULT_MOTION.jitter,
    centripetal: hover ? DEFAULT_MOTION.centripetalHover : DEFAULT_MOTION.centripetal
  }
}
```

**4) 测试更新**（`motionInit.test.ts`）：把"centripetal 不变"的断言改成"三股力都用 hover 阈值"，硬编码值从 `0.15` 改为 `0.004`。

### 4. 回归验证

- `npm run typecheck` 三端 + core + ui 全绿；
- `npm test`：
  - tracker-ui **10/10**（含 2 个 hover 阈值断言更新）
  - tracker-core 131/131
  - book-tracker 131/131
  - life-tracker 211/211
- **必须 Tauri 实跑肉眼验**（vitest 测不到 d3-force tick 在 canvas 上的实际行为）：
  1. 开图 → 节点稳定绕转 → 鼠标进图 → **节点立即冻结，原位置保持不变**（修复前会塌缩）
  2. 鼠标进图停留 5-10 秒 → 节点仍冻结在原位置，没有逐渐向中心漂
  3. 鼠标移出 → 节点恢复旋转
  4. panel 把 centripetal 拖到 0 → 鼠标进图 → 仍冻结（`Math.min` 模式保护用户的 0）
  5. panel 把 centripetal 拖到 0.25（max）→ 鼠标进图 → 也冻结（hover 阈值是 ceiling）

### 5. 教训

1. **「注释里的设计意图」必须和「代码里的实际行为」对齐，并写测试硬挂**。
   `DEFAULT_MOTION` 注释里 "hover 时 strength 降到 0.004" 这句的语义是三股力都降，但代码只对两股力落地、测试还把"centripetal 不参与 hover 自适应"当成 feature 写死 —— 三处意见一致地把 bug 固化了。**规律**：注释 / 代码 / 测试三者只要有两处说法一致、第三处偏离就一定要警觉。

2. **d3-force 自定义力的"hover 降速"必须三股力一起做**。orbit + centripetal 是一对力平衡（切向 vs 径向），单独降一边会让另一边变成"无对冲的主导力"。**规律**：自定义力组里只要有"切向 vs 径向"、"斥力 vs 向心"这种对子，hover 自适应必须整组同步，不能只降一边。

3. **`Math.min(base, hover_value)` 是处理"用户自定义值 vs hover 默认值"冲突的安全模式**。直接 `hover ? hover_value : base` 会把用户在 panel 拖到 0 的值反向"拉"到 hover 阈值（违反用户意图）。`Math.min` 让 hover 值变成 ceiling —— 用户拖到 0 时彻底静止，拖到很大时仍尊重用户值。

4. **测试断言不要写「故意漏掉某条」的描述**。原测试里 "centripetal 不变" 是把 bug 当 feature 写死 —— 后来这个描述需要改成 feature 反转（"三股力都用 hover 阈值"），相当于把"原本的修 bug 测试" 翻译一遍。**规律**：测试描述里出现「不参与 / 不变 / 不响应」这种否定断言时，要先怀疑是不是把 bug 固化下来了。

---

## 2026-08：[共享] 关系图力参数滑条"调了又被冲掉"——layoutMode effect 缺 noop 分支，数据变化静默覆盖用户值

> ⚠️ **本条目修正前一条 `[共享] 关系图力参数调节实际失效的两类 bug` 的不完整结论。**
> 那条记录的 Bug A（charge 被 effect 重置）和 Bug C（panel 滑杆脱节）确实修了；
> 但 Bug B（"切回 force 硬编码 force 值"）的修复**只处理了"用户切到 tree/analyze 再切回"**
> 这条路径（用 `savedMotionRef` 备份/恢复），**漏了"用户在 force 模式里调了值、
> 然后 visibleData 变化触发 effect 重跑"这条更常见的路径**。结果用户报"滑条没生效"反复
> 复现，commit `2f3bcbc` / `9c999f5` / `6482121` 三轮修复都没解决。

### 1. 现象

用户报「book 的关系图齿轮面板里的 orbit / jitter / centripetal 三个滑条**调了好像没生效**」。
具体场景：

- 打开力参数面板，把 orbit 拖到 0.20（默认值 0.15）；
- **关掉面板，加一本书** → 节点运动强度悄悄回到 0.15；
- 同理切 filter 也会触发；
- 调 charge 滑条不受影响（那个 bug 之前单独修了）。

但**只在可见数据变化时才丢**；纯面板拖动是 OK 的（force 函数闭包读 motionRef，
面板写入 + reheat 即时生效）。

### 2. 根因

`packages/tracker-ui/src/GraphView/index.tsx` 的 layoutMode effect 依赖：
```ts
}, [layoutModeProp, visibleData.nodes, visibleData.links])
```

而 else 分支（force 模式）的逻辑：
```ts
} else {
  const restore = savedMotionRef.current
  if (restore) {
    /* 恢复备份 */
  } else {
    /* ←—— 漏洞：用户没切走过布局、已初始化过、visibleData 又变了
     *     还是会走到这条 else 的内层 else，把 motionRef 覆盖回 DEFAULT_MOTION */
    const over = pointerOverRef.current
    motionRef.current.orbit = over ? DEFAULT_MOTION.orbitHover : DEFAULT_MOTION.orbit
    motionRef.current.jitter = over ? DEFAULT_MOTION.jitterHover : DEFAULT_MOTION.jitter
    motionRef.current.centripetal = DEFAULT_MOTION.centripetal
  }
  for (const n of visibleData.nodes) { n.fx = undefined; n.fy = undefined }
  fg.d3ReheatSimulation()
}
```

漏了**第三种情况**：「`savedMotionRef === null` 但 motion 已经不是默认（用户调过）」
—— 原版代码无法区分"首次进入"和"用户调过值但数据又变了"，一刀切都覆盖回默认。

**前置 commit 留下的修复（`9c999f5`）** 加了 `savedMotionRef` 来处理
「切到 tree/analyze 再切回」场景，但**没考虑到"用户一直在 force 模式里、只动了数据"**
这条高频路径。effect 依赖里包含 `visibleData.nodes/links` 意味着**任何**数据变化
（加书、删书、切 filter）都会让 effect 重跑，然后跑到 else 的"无备份就用默认"
分支冲掉用户值。

### 3. 修复

加 `motionInitializedRef` 哨兵 + 把 force 分支的决策抽成纯函数：

**1) `index.tsx` 加哨兵 ref**：
```ts
const motionInitializedRef = useRef(false)
```

**2) `motionInit.ts`（新文件）** 抽 decision 逻辑：
```ts
export type MotionDecision =
  | { kind: 'noop' }
  | { kind: 'restore'; values: MotionRef }
  | { kind: 'init'; values: MotionRef }

export function decideForceBranchMotion(
  savedMotion: MotionRef | null,
  isInitialized: boolean,
  hover: boolean
): MotionDecision {
  if (savedMotion) return { kind: 'restore', values: savedMotion }
  if (!isInitialized) {
    return {
      kind: 'init',
      values: {
        orbit: hover ? DEFAULT_MOTION.orbitHover : DEFAULT_MOTION.orbit,
        jitter: hover ? DEFAULT_MOTION.jitterHover : DEFAULT_MOTION.jitter,
        centripetal: DEFAULT_MOTION.centripetal
      }
    }
  }
  return { kind: 'noop' }   // ← 关键：已初始化过 + 无备份 → 不动 motionRef
}
```

**3) `index.tsx` 的 effect 改成 dispatch decision**：
```ts
} else {
  const decision = decideForceBranchMotion(
    savedMotionRef.current,
    motionInitializedRef.current,
    pointerOverRef.current
  )
  if (decision.kind === 'restore') {
    motionRef.current.orbit = decision.values.orbit
    motionRef.current.jitter = decision.values.jitter
    motionRef.current.centripetal = decision.values.centripetal
    savedMotionRef.current = null
    motionInitializedRef.current = true
  } else if (decision.kind === 'init') {
    motionRef.current.orbit = decision.values.orbit
    motionRef.current.jitter = decision.values.jitter
    motionRef.current.centripetal = decision.values.centripetal
    motionInitializedRef.current = true
  }
  // noop：保持 motionRef 不动，绝不悄悄覆盖
  for (const n of visibleData.nodes) { n.fx = undefined; n.fy = undefined }
}
```

`restore` 分支也设 `motionInitializedRef = true`，确保从 tree 切回 force 后
如果再数据变化也不会再被 init 路径冲掉。

### 4. 回归验证

- `npm run typecheck` 三端 + core + ui 全绿；
- `npm test`：
  - tracker-ui **10/10**（新增 `motionInit.test.ts`，覆盖三个决策分支 + 边界）
  - tracker-core 131/131
  - book-tracker 131/131
  - life-tracker 211/211
- **必须 Tauri 实跑肉眼验**（vitest 测不到 React effect 在浏览器里的实际行为）：
  1. 开图 → 打开 panel → 拖 orbit 到 0.20 → 关掉 panel → 加一本书 →
     再开 panel 滑杆应仍是 0.20，节点运动明显比默认快（修复前会回到 0.15）
  2. 开图 → 拖 orbit 到 0.20 → 切到层级布局 → 切回力导向 → 滑杆恢复 0.20
  3. 切 filter（按 tag 选一个）→ orbit 仍是 0.20
  4. panel "重置默认" 按钮 → 滑杆回到 0.15 → 加书 → 仍是 0.15

### 5. 教训

1. **「一次性副作用」和「依赖性副作用」必须在 effect 体内显式区分**。
   本例 effect 依赖里有 `visibleData.nodes/links`（数据依赖），
   但里面想做的是「首次进入 force 时初始化 motion」（一次性）。两者耦合在同一 effect
   体内就是「数据变 → effect 重跑 → 把用户值冲掉」。**修正套路**：哨兵 ref
   (`xxxInitializedRef`) 把"一次性"和"依赖性"显式拆开。

2. **「if restore else init」二分支决策漏了"用户已经改过"这条第三路径**。
   `savedMotionRef === null` 不能唯一区分"首次进入"和"用户调过值"——
   两个场景下 savedMotionRef 都是 null。原版用「无 savedMotion 就 init」的一刀切，
   在数据高频变化的实际场景里直接表现为"调了又丢"。这种**布尔状态机缺分支**的 bug
   在 React effect 里特别隐蔽：影响函数返回值是 ref，dev tools 看不到，UI 也不报错。

3. **抽纯函数是降低这类 bug 修复成本的关键**。把 decision 抽到
   `decideForceBranchMotion` 后能直接写 vitest 覆盖三个分支（10 个 test cases），
   比挂 React Testing Library 测 effect 重跑便宜得多，且不用操心 StrictMode / 异步 /
   重渲染时序。**规律**：业务 effect 里的条件决策优先抽成纯函数，留 effect 主体只做
   「读 ref → 调决策函数 → 写 ref / 调 d3 API」。

4. **之前 dev-notes 条目里写的"修复"其实是过度乐观**。本条目开头的修正声明就是
   留给后续 agent 的反例：**"测试 + typecheck 通过" ≠ "bug 真修好了"**。
   React effect 重跑场景下，typecheck 跟业务正确性几乎无关（types 都对），
   unit test 也只能覆盖纯逻辑，**必须 Tauri 实跑肉眼验证**。之前几条 commit
   没做这一步，"修好了"是被反复签字放行的，但实际上 force 函数读的还是 DEFAULT 值，
   跟初始状态无差别 —— 用户根本区分不出来"我刚才调了值"和"我没调值"。

5. **`savedMotionRef` 的设计假设需要重新审视**。它假设 savedMotionRef === null
   = "当前没备份过"，但**没备份**这个状态本身是"用户没切走过布局"和"切回 force 已
   恢复"的并集 —— 二者意图完全不同（前者保持用户值、后者是过渡态）。修法是用
   `motionInitializedRef` 把"已初始化过"这个事实单独追踪，与 savedMotionRef 解耦。

---

## 2026-08：[共享] react-force-graph-2d 的 simulation.nodes 在 prop 变化后**不会更新** —— 库限制，目前无法在共享层修复

### 1. 现象

在排查 "orbit/jitter/centripetal 调了又被冲掉" 时，做了一个隔离测试（`scripts/test-rfg.mjs`，
已删，思路保留）模拟 react-force-graph-2d 的核心流程，发现：

- 初始 mount 时，canvas-force-graph 的 `update()` 会调
  `simulation.nodes(state.graphData.nodes)`，把初始节点数组传给 simulation。
- 之后用户**修改 visibleData**（加书 / 切 filter / 删书），`comp.graphData(newData)`
  会把 `state.graphData` 改成 newData，但 **kapsule 不会触发 digest**（所有 props 的
  `triggerUpdate` 都是 `false`），所以 `update()` 永远不再跑。
- 结果：`state.graphData.nodes` 是最新的，但 `simulation.nodes` 永远是初始 mount
  时的那一批。
- 我们的自定义 force 用 `() => visibleData.nodes`（闭包），迭代新数组并修改
  `n.vx / n.vy`，但 d3-force 的 `simulation.tick()` 在 integration 阶段
  遍历的是**旧的 simulation.nodes**，新节点（不在旧数组里的）vx/vy 改了但
  position 永远不更新 —— 表现为"新加的书不动 / 没有位置"。

测试里加一个 D 节点后跑了 60 帧，D 的位置一直是 `(0, -50)`（d3 默认初始化值），
A/B/C 仍在按 panel 值运动。

### 2. 为什么这个之前没暴露

- 之前用户大多是在**已有数据上**调 panel，D 是"第一次"加新节点的场景
  才容易触发，所以一直归到"motion 值被冲"这一类，没深挖到库层面。
- react-force-graph README 里的 [dynamic example](https://vasturiano.github.io/force-graph/example/dynamic/)
  本质上也是这个限制 —— 看上去能加节点是因为节点**出现在画布上**（paintNodes
  读 `state.graphData.nodes`），但新节点在 simulation 里没有位置/速度，
  视觉上很容易被忽略。

### 3. 尝试过的 workaround（均失败）

`react-force-graph-2d` 通过 `useImperativeHandle` 暴露给父组件的方法只有
`d3Force / d3ReheatSimulation / emitParticle / stopAnimation / pauseAnimation /
resumeAnimation / centerAt / zoom / zoomToFit / getGraphBbox /
screen2GraphCoords / graph2ScreenCoords`。canvas-force-graph 的 kapsule state
（含 `forceLayout = simulation`）完全封装在闭包里，外部无法访问。

试过但都没法直接写：
- 替换 `fg.d3Force` 拦截返回值（d3-force-3d 的 `simulation.force(name, fn)` 是返回
  simulation 的，但 canvas-force-graph 的 `d3Force` 把它丢了）。
- 用自定义 force 的 `initialize(nodes, random, nDim)` 回调捕获 simulation 的
  当前 nodes 数组（拿到的就是旧数组，问题没解决）。
- 用 `state._rerender = digest` 手动触发 digest（state 不可访问）。

### 4. 当前状态

- **本条不修**。这是 react-force-graph-2d 库的限制，本仓的两 app 都共用它，
  共享层要修就要 monkey-patch 库内部，性价比太低。
- 文档化到这里，让后续 agent 不要再花时间在"用户报 panel 没生效"这条路上
  反复怀疑是 motionInit / charge 重置 / pointerOver 等已修过的问题。
- 如果未来一定要修，路线是 **fork react-force-graph-2d**（或换 d3-force-direct
  自渲染），不要再绕这个 kapsule。

### 5. 教训

1. **库限制要在调研阶段就排查清楚**。本仓之前 commit 集中在 "panel 写值 → motionRef"
   这条链上反复修，本质上是同一个 kapsule 内部 bug 的不同切面；如果一开始就把
   `state.forceLayout` 在 prop 变化后是否同步这条单独验证一次，能更早定位到库本身。
2. **验证数据变化后行为时必须"重新看一次 simulation 内部状态"**。
   dev tool 看节点位置 ≠ simulation.nodes 长度 —— 节点能渲染（paintNodes
   读 state.graphData）但 simulation.tick() 不整合（读 simulation.nodes），
   两个数据源在 prop 变化后会分叉。

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

---

## 2026-08：[共享] 关系图节点间互相覆盖 —— 缺 collision force + 树形层宽固定

### 1. 现象

用户报"book 关系图节点互相覆盖"：

- **力导向模式**：节点之间距离近时（如前置链上层与下层直接相邻、同一前置有多个后置被引力聚拢），节点圆绘完在视觉上完全叠在一起，看不出谁是谁；点单个节点时 hit-area 也互相侵占。
- **树形模式（"层级布局"）**：同一层两个节点 title 都长（中文 10+ 字符、英文 20+ 字符）时，两个 title 文本横向覆盖，节点圆挨着挤；拖窗口到很窄 viewport 时尤其明显。
- **搜索命中后**：搜索放大的节点（视觉半径 ×1.6）与旁边的未放大节点之间也没有推开。

### 2. 根因

两个独立 bug，恰好都叫"重叠"：

**A. 力导向模式缺 collision force**
`useGraphPhysics.ts` 注册了 `orbit / jitter / centripetal / charge` 四个力，**没有 `collide` 力**。
`d3-force-charge` 是 `1/r²` 衰减的斥力，**两个节点足够近时 charge 推力会塌缩到 ~0**；外加 `centripetal` 持续向心，节点没法靠电荷力"互相挤开"：

```
refCount=10 节点半径 ≈ 12.5px → 圆之间至少需要 25px 间距
charge 公式: -120 * (1 - d/2/r)^2 ... d=15px 时推力 ≈ 5px/tick
但 centripetal 单方面向心 21 px/tick (d=0.3 下稳态)
```

物理后果：节点被持续往中心拽 + 没足够斥力推开 → 中心一坨，**画出来肉眼可见互相覆盖**。
d3-force-3d 的 `forceCollide` 是基于 quadtree 的固定半径"实体不可重叠"约束，**不依赖距离衰减**，半径=节点绘制半径时正好是"贴边但不重叠"。

之前 commit `9c999f5` 等修过的是 `panel 调值被冲`、`hover 塌缩`、`charge 反复重置` —— 都集中在"运动 / 数值注入"，**没人动过"节点之间会重叠"这条单独的物理维度**。patch 列表也只关系到 motion / charge / pointerOver，没分析过"是否需要 collide"。

**B. 树形模式 layerWidth 固定 170**
`applyTreeLayout` 用 `DEFAULT_TREE_DIMS.layerWidth = 170` 等距铺同层节点。170 对短 title（< 8 字符）是宽松的，但：

- title 长度 + 节点半径 < 实际"标题视觉半宽" —— 中文 20 字符的标题横向 ≈ 200px；
- 同层两个长 title 节点相距 170px 时，**两边的 title 互相覆盖**；
- `layerHeight = 130`，layer 间距正好贴近节点 title 文字底部，**跨层的 title 与下层节点圆也易撞**。

**C. 反应半径没与绘制半径对齐**
即便加了 collide force，**碰撞半径必须等于"画到 canvas 上的半径"**，否则"绘制时看上去挨着"的两个节点在碰撞 force 看时已经叠在一起。这要求两份公式保持一致：react-force-graph 的 `r = sqrt(val) * nodeRelSize`，val = `1 + sqrt(refCount) * 2`，nodeRelSize = 4。共享层把这部分公式抽到 `nodeRadius.ts`，新加 `computeNodeRenderRadius(n)`。

### 3. 修复

三块改动 + 一处连带：

**1) `useGraphPhysics.ts` —— 注册 d3-force-3d 的 forceCollide（v6）**：

- `import { forceCollide } from 'd3-force-3d'`；
- `DEFAULT_MOTION.collideRadius = 1.0`（默认 1.0 = 与绘制半径完全一致）；
- `DEFAULT_MOTION.collideIterations = 2`（d3 默认 1，密集场景 ×2 让 quadtree pass 收敛更稳）；
- `.radius((n) => computeNodeRenderRadius(n) * collideRadius * (searchActive ? 1.6 : 1))` —— 与 nodeVal / nodeCanvasObject 的搜索放大同步；
- 同 charge / collide 路径用哨兵 `collideInitializedRef`，只在 fgRef 首次就绪时注册一次；panel 调 collideRadius 走 `setCollideRadius(r)` setter，走 d3-force-3d 链式 `.radius(fn)` 改写内部 wrap 函数 + `d3ReheatSimulation()`，**不重注册整个 force**。

`MotionRef` 类型加 `collideRadius: number` 字段，`decideForceBranchMotion` init / restore 都带 collideRadius —— restore 必须把"用户切到 tree/analyze 前调过的值"完整带回，与 orbit/jitter/centripetal 同款原则（详见同文件 § 5）。

**2) `useTreeLayout.ts` —— 每层 layerWidth 自适应**：

- `pickLayerWidth(layer, base)` 取 `max(base, longestTitleLen * 8 + maxRenderRadius * 2 + 24)`：
  - `longestTitleLen * 8` = 11px 字号下文本横向像素估（中文 ≈ 11px × 0.7 修正 = 7-8px 估，混合英文按 6.5px 估偏保守）；
  - `maxRenderRadius * 2 + 24` = 节点圆直径 + padding；
- 短 title 仍用 baseLayerWidth（不会无谓加宽）；
- DEFAULT_TREE_DIMS 也微调：`layerHeight 130 → 140`（跨层 title 与下方节点圆不打架）、`layerWidth 170 → 200`（基础宽度更宽松）；
- 模块内导出 `pickLayerWidthForTest` 给 vitest 直接覆盖边界，避免"为测私有函数 export 整个 helper"的污染。

**3) `nodeRadius.ts`（新增）—— 共享"绘制半径公式"**：

```ts
export const NODE_REL_SIZE = 4
export function computeNodeRenderRadius(node: BaseGraphNode): number {
  const val = 1 + Math.sqrt(node.refCount) * 2
  return Math.sqrt(Math.max(0, val)) * NODE_REL_SIZE
}
```

被 `useGraphPhysics`（collide radius 函数）和 `useTreeLayout`（pickLayerWidth 内 maxR 计算）共用，单测另开 `nodeRadius.test.ts` 直接覆盖。

**4) `ForceParamsPanel.tsx` —— 加 collideRadius 滑条（1 个）**：

- 范围 `[0.5, 2.5]`、步长 0.05，与 `DEFAULT_MOTION.collideRadius = 1.0` 协调；
- 输入受控（useState 本地 + motionRef 同步），与既有 `handleMotionChange / handleChargeChange` 同模式；
- 走 `setCollideRadius(r)` 路径而非直接 `fg.d3Force('collide')` —— 后者需要 panel 自己写 radius 闭包（要拿 searchActiveRef），把闭包放在 useGraphPhysics 内、setter 只传 number，保持 force 闭包逻辑集中在 hook；
- "重置默认"按钮同步把 collideRadius 拨回 1.0。

**5) `index.tsx` —— `searchActiveRef` 透传给 useGraphPhysics**：

useState 在 React 渲染周期更新，d3-force 的 force 函数每 tick 在 d3 闭包读 —— 用 `useRef + useEffect 同步 isSearchActive → searchActiveRef.current`，force 函数闭包每 tick 自动看到最新值，无需重注册 force。

### 4. 回归验证

- `npm run typecheck` 三端 + core 全绿；
- `npm run test:ui` **32/32**（`motionInit.test.ts` 12 个 + 新 `useTreeLayout.test.ts` 13 个 + 新 `nodeRadius.test.ts` 7 个）；
- `npm run test` 全量（core + book + life）也都过；
- **必须 Tauri 实跑肉眼验**：
  1. 开图默认 force 模式 → 节点之前互相覆盖的两点现在保持清晰贴边但不重叠（贴边距离 ≈ 各自绘制半径之和）；
  2. 拉近两节点（拖其中一个到另一个旁边）→ 松手后 ~200ms 内两节点被推开到贴边距离（collide 持续硬推，不像 charge 衰减）；
  3. 搜索框输入 → 命中节点的圆放大 1.6× → 旁边的未放大节点不会被推开碰撞侵入（搜索命中半径 1.6× 同步放大，碰撞距离增加）；
  4. 切到层级布局 → 同一层节点 title 都很长（中文 16+ 字符）时，节点横向间距明显变宽，title 不再互相覆盖；
  5. 短 title 单点层 → 仍用 base layerWidth（默认 200），不无谓加宽；
  6. 切回力导向 → 之前 panel 调到 1.6 的 collideRadius 恢复（与 orbit/jitter/centripetal 同款 restore 全量带回原则）；
  7. 鼠标进图（图冻结） → 节点仍按当前 collideRadius 推开（collide 不参与 hover 自适应，纯物理约束），只是切向运动停下。

### 5. 教训

1. **「碰撞」是 d3-force 的独立维度，不能用 charge 替代**。`d3-force-manyBody` 是 `1/r²` 斥力，**近距时推力自然归零**；物理上对应"长程电场"而不是"刚体碰撞"。需要实体不重叠时必须装 `d3-force-collide`（半径 = 节点实际占位），charge 提供的是"避免远距离吸引一坨"的散开。混淆两者是经典错误。**判断口诀**："节点能不能画完后贴在一起不挤" → 必须有 collide；"节点能不能均匀散开" → 用 charge。

2. **碰撞半径必须等于绘制半径**。两个公式各自独立 → 绘制半径 12 px、碰撞半径 8 px 时，画到画布上挨着的两节点 collision 看时已重叠 4px；反过来绘制 8 碰撞 12 时画完离很远看着空。本仓用 `nodeRadius.ts` 单点维护 `computeNodeRenderRadius`，forceCollide / treeLayout / nodeCanvasObject 三处共用同一份。**凡是新引入"碰撞 / 选中 area / hit detection"，先问"绘制半径从哪取"**。

3. **「`DEFAULT_MOTION.charge` 修复三连击」是并发相关的"症状层"问题，不等于"force 设计完整"**。charge 反复重置、panel 调值被冲、hover 塌缩——三连击都集中在"数值怎么写到 simulation / 怎么保持"这条链上，没人触碰"还有哪个 force 维度没装"。**规律**：调试一类视觉 bug 时，**先列全 d3-force 标准力清单**（charge / collide / link / center / x / y / radial / manyBody），对照当前 graph 用了哪几个；漏装的不是"未被发现"，是"没列出来过"。

4. **「tree 模式层宽固定」是和"重叠"完全不同的根因，恰好症状面像但修法独立**。本轮容易把两件事并为"重叠"一个大修，结果 force 模式修了 tree 没用、tree 修了 force 没用。区分口诀：
   - "节点圆互相覆盖" → collide force 或树形间距；
   - "标题文字横向撞车" → **只能 tree 模式 layerWidth 自适应**；collide 在 force 模式有效，tree 模式钉 fx/fy 完全不会动；
   - "搜索命中后大圆盖小圆" → collide radius 的搜索放大系数没传或没与 nodeVal 同步。

5. **「restore 必须保留新增字段」是 motionInit 的隐藏契约**。MotionRef 加 `collideRadius` 后，`decideForceBranchMotion` 的 `restore` 分支如果不带新字段，切到 tree 再切回 force 时 collideRadius 会被打回 DEFAULT。**规律**：给"被 useState 化的 ref" 加字段时，**重读**所有 restore / init 路径 + 对应单测，新增字段必须 pathwise 覆盖三个分支（restore / init / noop）+ path-aware 断言。

6. **不在 panel 里写 force 闭包**。如果 panel 直接调 `fg.d3Force('collide', newForce)`，要在 panel 里重写一遍 "computeNodeRenderRadius(n) × collideRadius × (searchActive ? 1.6 : 1)" —— 这是把"force 半径语义"分散到 panel + physics 两处的反模式。**正确做法**：useGraphPhysics 暴露 `setCollideRadius(number)` setter，闭包集中；panel 只负责"数字"层（受控 input + setter），闭包逻辑留在 hook。

7. **`d3-force-3d` 没官方 type declaration**（vasturiano 自维护），typecheck 报 `Could not find a declaration file for module 'd3-force-3d'`。本地解决方案：`packages/tracker-ui/src/GraphView/d3-force-3d.d.ts` 写一个最窄 ambient declaration（只暴露 `forceCollide<T>()` 的链式 API）。**不要**为了用 d3-force-3d 把 `@types/d3-force` 引进来 —— 那是 d3-force 的类型，而 v3 是另一个 fork（vasturiano 自维护），两个 API 不兼容。

---

## 2026-08：[book-tracker] 集笔记时间戳（v1.3 stamp）—— 整体替换式回写 + 时间用秒

### 1. 背景

v1.2 集笔记支持单集 watched / note / title，用户反馈"想给单集里的关键片段做时间戳笔记"。手输开始/结束 + 描述即可。

### 2. 决策：单条 IPC vs 整体替换式回写

候选两种 IPC 模式：

- **单条 IPC**：4 个 command（addStamp / updateStamp / deleteStamp / clearStamps），每条 stamp 一次 IPC
- **整体替换式**：1 个 command `books_episode_set_stamps(id, season, episode, stamps: TimeStamp[])`，前端 add/edit/delete 都构造新数组 + sortStamps 再整体回写

最终选**整体替换**。理由：

1. **stamp 输入短** —— 每条 1-2 个时间字段 + 1 个 note，提交即写盘；单条 IPC 的延迟开销不划算
2. **天然 idempotent** —— 整体回写是"读 → 改 → 写"，断网 / 重复点击 / 多窗口同时编辑都安全（最终态 = 最后一次 IPC 的完整数组）
3. **服务端兜底排序** —— 前端 `sortStamps` 排序后整体回写，服务端 `set_episode_stamps` 再 sort_by 一次；前端排序 bug 也不会污染持久化（双向防御）

教训：**短输入多操作的列表形态优先整体替换**。CRUD 类操作（加单条、改单条、删单条）全部走"读 list → 改 → 整体写"三步，比单条 IPC 更简单、更可证、更可恢复。

### 3. 决策：时间格式统一存秒

UI 输入 `00:32:15` / `12:34` / `45` 三种人类格式，但持久化统一用 `u32` 秒数。理由：

- 跨平台 / 跨语言避免格式不一致（Locale、时间分隔符 `:` vs `.`、前导零等）
- Rust 端不引 chrono / time crate，纯数字运算
- TS 端解析逻辑集中在 `parseStamp()` 一处，单元测试覆盖 `ss` / `mm:ss` / `hh:mm:ss` + 非法输入（60 秒位、负数、浮点、过多段数）

格式转换边界：
- **入界**（用户输入 → 存储）：`parseStamp()`，非法返回 `null`，前端 input 校验
- **出界**（存储 → 用户显示）：`formatStamp()`，根据大小自动选 `mm:ss` vs `hh:mm:ss`
- **边界检查**：每段位范围限制（分位 < 60、秒位 < 60），但时位无上限（避免"1:00:00:00"这种不合法场景在 parse 阶段就被拦掉）

教训：**时间字段前后端交互优先用最小公倍数（秒）**，UI 边界做格式转换；不要让 Rust 端处理字符串解析。

### 4. 决策：领域专属 vs 共享内核（stamp 工具函数测试放在哪）

v1.3 新增 `formatStamp` / `parseStamp` / `sortStamps` 三个纯函数。AGENTS.md §十三 写"TS 纯函数测试放 monorepo packages/tracker-core"——但这些函数绑定 `EpisodeRecord.stamps`（Book 领域字段），不应该进 tracker-core。

最终：

- **测试位置**：`apps/book-tracker/src/shared/__tests__/stamp.test.ts`（Book 领域专属）
- **vitest.config.ts::include** 同时扫 `packages/tracker-core/src/__tests__` + `src/shared/__tests__`，跑 `npm test` 一起跑
- **AGENTS.md §十三** 加例外说明

教训：**共享内核的判断要看"两个 app 是否都需要且语义一致"**。stamp 工具函数语义 = "EpisodeRecord.stamps 的辅助函数"——life-tracker 的 Goal 没有 episodes / stamps 概念，所以不共享。这与 v1.2 `episodeKey` / `parseEpisodeKey` 留 book-tracker 内的逻辑一致。

### 5. 决策：稀疏策略扩展 —— 加新字段时"删 key 判定"必须同步更新

v1.2 `set_episode_watched` / `set_episode_note` / `set_episode_title` 都有"如果该集没字段了 → 删 key（最稀疏）"的判断。v1.3 加 stamps 后，原来的判断"has_note && has_title"必须扩展成"has_note || has_title || has_stamps"——否则用户加 stamp 后清 note/title/watched，该集应该删 key 但 service 不删 → frontmatter 留个 `{ "stamps": [...] }` 空 watched/note/title 条目。

教训：**最稀疏策略的"删 key 判定"是 N 元谓词，加新字段必须同步更新所有 4 个 service 方法的 has_* 判定**。漏一处 = 该集不再被最稀疏策略清理，frontmatter 留半空 record。建议加单测断言"清空所有字段后该 key 完全消失"覆盖所有 4 条路径。

### 6. parse 容错：缺 id / start / note 的 stamp → 跳过该条

`parse_stamps` 单条缺 id / start / note 时直接 `continue`，不抛错。理由：book 文件可能被用户手改、可能被老版本 schema 写坏——任意一条 stamp 字段缺损都不能让整本不可读。

教训：**parse 阶段对"数组元素级"字段缺损的标准做法是 skip 该元素，让整本仍可读**。与 v1.2 `parse_episodes` "子对象字段缺失 → skip 该 key" 思路一致；统一在"破坏范围最小化"。

### 7. UX 决策：Enter 提交 / 时间校验 / 错误提示就地显示

stamp 添加区三段（开始 / 结束 / 笔记）+ 按钮 + Enter 提交。校验错误就地显示在按钮下方（不弹 alert）：

- 开始时间空 → "请输入开始时间"
- 开始 / 结束解析失败 → "格式错误:'xxx'(支持 ss / mm:ss / hh:mm:ss)"
- 结束 < 开始 → "结束时间不能早于开始时间"

UI 提示放按钮附近而非 toast / alert：单行短字段错误用 alert 太重；toast 又会消失；就地提示是"input 行级反馈"的最短路径。

教训：**表单校验错误提示放在出错的 input 附近，不要用 alert**。alert 阻断用户操作、toast 会消失、就地提示最直接。

### 8. 回归

- `episode_stamps_round_trip_and_omit_when_empty`（data/books.rs::tests）—— 6 个不变量：
  1. stamps 非空 → 写盘 + 按 start 升序读回
  2. raw 文件确实含 `"stamps"` 字段
  3. stamps 空数组 → 不写盘
  4. 老文件缺 stamps → 读回 None
  5. 缺 id / start / note 的 stamp → 跳过该条，整本仍可读
  6. 同 start 按 id 字典序稳定排序
- `stamp.test.ts`（apps/book-tracker）—— 13 个纯函数测试
- book-tracker cargo 33 / vitest 156；monorepo 全量 cargo 152 / vitest 563 全绿

---

## 2026-09：[book-tracker] 季设置实时写盘 + 「下一季」单向字段 + CleanMode 点击入口——v1.6 三处体验修复

用户反馈三处 tv/anime 相关问题:① 编辑模式改集数保存没用;② 没有"下一季"实际增添的地方;③ 日常模式点击作品后想做笔记 + 选看到哪但没入口。本轮一次性修复。

### 1. 现象 v1.5

- ① BookForm 弹窗"季设置"区块的 `episodeCount` input 只挂了 `onChange`,所有修改必须等底部"保存"按钮统一提交。EpisodesPanel 的"X 集"input 走失焦实时 IPC(setSeasons)——**两处季编辑入口行为不一致**:同一份季数据两个写盘时机,用户心智混乱,容易丢修改。
- ② 现有"季结构"= 同一 book 内的季列表(`seasons: SeasonInfo[]`);用户要的"下一季"是**跨作品关联**(S01 / S02 / S03+ 拆成独立 book 追踪时,把它们串起来),不是 book 内部加空季。
- ③ CleanMode 只有"搁置 / 看完"两个快捷按钮,每行不可点。要做笔记 / 选看到哪必须先切到 EditMode + 从左栏选作品,操作链路过长。

### 2. 修复

**修复 ① 季设置实时写盘**:

- BookForm `season.ts` input 加 `onBlur` + `onKeyDown(Enter)`,触发 `setSeasons(book.id, next)` IPC(与 EpisodesPanel 同款)。
- 新增 `flushSeasonsSaved()` 工具函数 + `seasonsSaved` 短提示 state,写盘成功 1.5s 显示"季设置已保存"。
- `addSeason` / `removeSeason` 同样改为实时写盘(避免"+ 新增一季"按钮触发后用户切走丢失)。
- BookForm `handleSubmit` 编辑模式不再带 `seasons` 字段(`delete patch.seasons`):避免"实时写盘 + 保存按钮 patch"双写竞态(虽然 Rust 端 update_book 不会覆盖 None 字段,但 patch 序列化 + 写盘 + read 三步仍有 IPC round-trip,语义不洁)。
- 新建模式保留 `input.seasons = seasons`(没有 book prop,onBlur 无处可写)。

**修复 ②「下一季」单向 `Book.nextSeasonId` 字段**:

数据模型选型对比三个候选:

| 候选 | 优势 | 劣势 |
|---|---|---|
| A. 复用 `Edge` 加 `kind: 'prereq' \| 'sequel'` | 不增字段 | 方向相反(prereq 是"想读 A 必须先读 B",sequel 是"读 A 之后看 B");`compute_unlocked` 需分流;GraphView 边样式要区分 |
| B. `Book.nextSeasonId?: string` 单向 | 最小侵入;用户场景单向 | 反向查询遍历所有 book |
| C. 独立 `sequels.json` | IO 独立 | 多一份文件;读写双路 |

**采纳 B**:语义清晰 = "我的下一季是 X";最小改动 Book 模型 + 新增 IPC `books_set_next_season`;反向"谁的下季是本季"代价可接受(用户场景不需要)。

实现细节:

- `types.rs` Book 加 `next_season_id: Option<String>`,`#[serde(default, skip_serializing_if = "Option::is_none")]`,空值不写 frontmatter。
- `data/books.rs` `persist` 写盘 `nextSeasonId`(同 notes / starring 策略);`normalize_book` 解析容错老文件缺字段 → None。
- `service/books.rs::set_next_season` 走专用业务方法(不走 BookPatch,因 next_season_id 不进 patch —— 与 seasons / episodes / characters 同款"关联字段走专用 IPC"):read → 改 merged.next_season_id → 调 `data::books::persist` 直接写盘。
- `data::books::persist` 从 `fn` 改为 `pub(crate) fn`,为 set_next_season 暴露。
- 校验:self-loop 拒绝(id === nextSeasonId → Err);目标 book 不存在不拒绝,前端 UI 兜底「原作品已删除 [× 清除]」。
- 新组件 `NextSeasonPicker.tsx`:弹 inline 选择器,候选排除自己 + tv/anime 优先 + title 模糊搜索(参考 PrereqEditor picker 模式)。
- BookDetail 加"下一季"区块:有 nextSeasonId → 显示 title 链接(点击跳到目标 book)+ 改/移除按钮;无 → 显示"+ 设置下一季"按钮;引用已删除 book → 显示「原作品已删除 (id: X)」+ 清除按钮。
- CSS 加 `.next-season-block` / `.next-season` / `.next-season-picker` 等类(单 app 样式,不动共享 base.css)。

**修复 ③ CleanMode 点击 → 切 EditMode + 选中**:

- CleanMode 新增 `openInEdit(id)` 函数:`useBooksStore.select(id)` + `useModeStore.setMode('edit')`。
- 三种视图(list / grid / focus-stack)的可点击元素加 onClick + `role="button"` + `tabIndex={0}` + Enter/Space 键盘支持:
  - list: `.clean-item-left`(标题 + 作者 + kind-tag)
  - focus-stack: `.focal-card`(整体)/ `.compact-item`(整体)/ `.stamp-card`(整体)
  - 折叠区: `.collapsed-item`(整体)
- 按钮区(搁置 / 看完 / 恢复)加 `onClick={(e) => e.stopPropagation()}` 防止冒泡触发切模式(否则用户点"搁置"会同时切模式 + 选中该作品)。
- CSS 加 `cursor: pointer` + `:focus-visible` 轮廓 + `transition: background`,提示可点击且符合 a11y。

### 3. 关键决策 & 教训

**BookForm 季设置两种模式混用**:同一个表单里"高频小步修改"(季集数)走实时 IPC + 失焦写盘,"一次性提交字段"(title / status / progress / notes / tags)走 form 提交 + 保存按钮。两种心智并存,但 UI 上要给用户足够提示(顶部"· 季设置已保存"短标签),否则容易让用户以为"我点保存了为什么没反应"。

**「下一季」用单向字段而不是复用前置依赖图**:前置依赖方向是"想读 A 必须先读 B",续作方向是"读 A 之后看 B",**方向相反**。复用会让 computeUnlocked 语义混乱,Edge 也要加 kind 字段分流。**判断关系图方向**比"省一个字段"更重要。

**专用 IPC vs 通用 patch**:`seasons` / `episodes` / `characters` / `nextSeasonId` 都走专用 IPC(`books_seasons_set` / `books_episode_*` / `books_characters_set` / `books_set_next_season`),不走通用 `books_update` 的 BookPatch。理由:① 关联字段写盘策略复杂(最稀疏、自空串、整体替换),通用 patch 的 merge 语义扛不住;② 专用 IPC 服务端可独立校验(self-loop、ref 完整性);③ 不进 BookPatch 让 patch 的 spread / 三态语义保持简单。

**Rust `persist` 函数从 `fn` 改 `pub(crate) fn`**:为 set_next_season 业务方法提供"读 → 改 → 写"的入口,避免把 patch 字段硬塞进 BookPatch。trade-off:`pub(crate)` 让模块边界松一点,但只在 service / data 同 crate 内可见,不破坏封装边界。

**CleanMode 点击按钮区要 stopPropagation**:列表行整体可点击时,行内的"搁置 / 看完 / 恢复"按钮必须 `e.stopPropagation()`,否则点按钮会同时切模式 + 选中该作品,与用户预期"只切状态"不符。这是「li 内嵌 button」通用模式,任何 clickable row + inline action 都要小心。

### 4. 回归

- `next_season_id_round_trip_and_omit`(`data/books.rs::tests`)—— 4 个不变量:① None / 空串不写盘;② 写入 nextSeasonId 后 raw 确实含字段;③ None 显式清空不写盘;④ 老文件缺字段 → None(向后兼容)。
- book-tracker typecheck / vitest / cargo 全绿,monorepo 全量 718 个测试(563 vitest + 155 cargo)全过。
- `cargo test -p book-tracker --lib` 35 → 36(新增 nextSeasonId round-trip 测试)。
- 手动流程验证:① BookForm 季设置失焦立即写盘 + 顶部"已保存"提示;② BookDetail 下一季关联 + 跳转;③ CleanMode 点击 + 按钮区 stopPropagation。

### 5. 后续 v1.6.1:「改了没失焦就保存」的兜底修复

**现象(本轮 commit 9f87475)**:v1.6 commit d2415f2 让 BookForm 季设置 input 走 onBlur 实时写盘,故意在 handleSubmit 编辑模式下 `delete patch.seasons` 防双写。但用户实测「鉴证实录 修改了集数 也还是没有用」—— **改了 input 没失焦就点保存的场景**,onBlur 没触发,handleSubmit 又把 patch.seasons 删掉,修改丢失。

同样问题出现在 EpisodesPanel 的 "X 集" input:v1.4 写了 `scheduleCountFlush` debounce 函数,但**从未在 onChange 中调用** —— input 仅靠 onBlur 写盘,用户切换作品 / 关闭 app 时丢失。

**修复**:

- **BookForm handleSubmit 编辑模式**:tv/anime 保留 input.seasons(以本地 React state 为准),不再总是 delete。非 tv/anime 仍 delete(保持 v1.5 前的"清掉老 seasons 字段"语义)。
- **EpisodesPanel "X 集" input**:onChange 调 scheduleCountFlush(),500ms debounce 实时写盘;onBlur / Enter 立即写盘。三种写盘时机(失焦 / 回车 / 停 500ms)统一心智。

**判断"实时写盘 vs form 提交"**:v1.6 我以为「实时写盘 + 删除 patch.seasons 防双写」是正确做法,但忽略了**用户不一定会失焦**。"双写同一个值"在 IPC 层面只是浪费一次调用,**不丢数据**——所以 patch.seasons 兜底是安全的。"删除 patch.seasons 防竞态"是过度防御,真正的修复是:**onBlur 实时写盘 + handleSubmit 兜底带 patch.seasons + debounce 实时写盘**三条防线一起上,而不是"删掉 patch.seasons 一了百了"。

**回归**:新增 `legacy_tv_set_seasons_round_trip`(模拟老 tv 文件无 seasons → 写 → 读);book-tracker cargo 36 → 37 + vitest 156 全绿;typecheck 3 端全过。

---

