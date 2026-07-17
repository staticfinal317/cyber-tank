# 技术架构

## 1. 定位

「坦克大作战」是经典像素坦克对战游戏的家庭非商业复刻版：单人闯关、Canvas 2D 渲染、无账号、无网络依赖。核心目标是确定性的战斗模拟 + 只读渲染，方便回归测试与后续内容扩展。

## 2. 分层不变式

以下约束在 `src/classic/core/types.ts` 与各模块文件头注释中标注为架构契约，改动需要评审：

1. **模拟确定性**：`src/classic/sim/` 只依赖 `core/types.ts`、`core/constants.ts` 与注入的 `RNG`（`src/core/RNG.ts`）；零浏览器 API、零 `Math.random()`、零 `Date.now()`。所有坐标为整数 subpx（见 `constants.SUBPX`），保证同一输入序列在任意环境下产生完全一致的输出。
2. **渲染只读快照**：`src/classic/render/ClassicRenderer.ts` 只消费 `WorldSnapshot` 与 `SimEvent`，不 import `sim/` 任何模块、不访问模拟内部状态。渲染循环（rAF）由上层持有，渲染器被动响应 `render()`/`resize()`/`dispose()`。
3. **事件驱动音频**：`src/classic/audio/ClassicAudio.ts` 只依赖 `core/types` 的 `SimEvent` 类型，不 import `sim`/`render`/`game` 任何模块。数据（音符表、包络参数，见 `soundSpecs.ts`、`jingles.ts`）与 WebAudio 调用（`ClassicAudio.ts`）分离；无 WebAudio 环境（如 Node 测试）时静默为空实现。
4. **编排层瘦身**：`src/classic/game/ClassicGame.ts` 是薄的副作用编排层，持有 `World`（模拟）/ `ClassicRenderer`（渲染）/ `KeyboardController`（输入）/ `ScreensOverlay`（界面）/ `GameLoop`（固定步长循环），把纯逻辑的 FSM 转移映射为具体的舞台切换，本身不包含战斗规则。

## 3. 目录职责

```text
src/classic/
  core/     架构契约：types.ts（方向/地形/实体视图/事件类型）、constants.ts（网格、定点数、tick 速率等全局常量）
  sim/      确定性战斗模拟：World（权威状态与 tick）、ai.ts（敌人行为）、collide.ts（碰撞）、
            terrain.ts（地形/破坏）、entities.ts（实体工厂）、hash.ts（FNV-1a 状态哈希，回归测试用）
  content/  关卡文本解析（parseLevel.ts）与第 1-3 关数据（levels.ts，FC 原版布局转写，来源见文件头注释）
  game/     顶层编排：fsm.ts（纯逻辑状态机）、keyboard.ts（键盘输入归一化）、loop.ts（固定步长主循环）、
            screens.ts（菜单/结算界面）、ClassicGame.ts（装配以上各层）
  render/   Canvas 2D 分层渲染：ClassicRenderer.ts（主渲染器）、sprites.ts（精灵图集）、
            terrainLayer.ts（地形层缓存）、effects.ts（特效队列）、digits.ts（数字精灵）、
            dirty.ts（脏矩形/脏格计算）、layout.ts（逻辑分辨率与缩放布局）
  audio/    程序化 WebAudio 音效：ClassicAudio.ts（合成与调度）、soundSpecs.ts（音色参数表）、
            jingles.ts（过场音乐数据）
src/core/
  RNG.ts    注入式确定性随机数生成器（Xorshift），被 sim 与 core/types 引用；仓库内唯一保留的旧目录文件
src/main.ts 入口：装配 ClassicGame + ClassicAudio，处理 AudioContext 用户手势解锁，注册离线 Service Worker
```

## 4. 确定性设计

- **定点数**：逻辑坐标以 subpx（1 逻辑像素 = 16 subpx）整数存储与运算，模拟内不出现浮点坐标，避免跨平台浮点误差导致的轨迹漂移。棋盘为 26×26 半格（`GRID`），对应逻辑分辨率 208×208 px。
- **注入 RNG**：`World` 与 `ai.ts` 的随机行为（敌人生成点、AI 决策分支等）通过构造参数注入 `RNG` 实例，不直接调用全局随机源；相同 seed 输入相同 tick 序列必然复现相同结果。
- **固定步长 tick**：`FixedStepAccumulator`（`game/loop.ts`）以 60Hz（`TICK_RATE`）步长驱动模拟，单帧最多补 5 个 tick，超额时间直接丢弃，避免长时间后台切回后的补 tick 死亡螺旋，同时保证模拟推进节奏与真实时间解耦。
- **哈希回归**：`sim/hash.ts` 实现 FNV-1a 32 位哈希，`World` 对 tick 数、地形、砖块掩码、坦克与子弹的全部字段、比分与状态做逐字段哈希（见 `World.ts` 中 `fnvInt32`/`fnvByte`/`fnvBool`/`fnvBytes` 的调用序列）。回归测试可用该哈希比对同一输入序列在代码改动前后是否产生完全一致的模拟状态，快速发现无意的行为变化。

## 5. 测试策略

- `tests/rng.test.ts`：`RNG`/`seedFromDate` 的纯函数测试。
- `tests/classic-sim.test.ts`：`World` 的模拟正确性（碰撞、地形破坏、道具、结冰等）。
- `tests/classic-levels.test.ts`：关卡解析与数据校验。
- `tests/classic-renderer.test.ts` / `tests/classic-sprites.test.ts`：渲染层布局、脏格计算与精灵图集的单元测试。
- `tests/classic-audio.test.ts`：音效参数与 Jingle 时长的单元测试。
- `tests/classic-game.test.ts`：FSM 转移、键盘输入归一化、固定步长循环的纯逻辑测试。
- `tests/pwa.test.ts`：`vite.config.ts` 中 Service Worker 源码生成逻辑的测试。
- `tests/ui_smoke.mjs`（经 `tests/with_server.py` 拉起开发服务器）：Playwright 驱动的浏览器 UI 冒烟测试。

## 6. 复刻范围与阶段计划

详见 [docs/BATTLE_CITY_REMAKE_PLAN.md](BATTLE_CITY_REMAKE_PLAN.md)。
