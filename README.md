# 坦克大作战

经典像素坦克对战游戏的家庭非商业复刻版。给孩子玩：单人闯关、守护基地，没有账号、没有联网、没有广告。

## 快速开始

要求 Node.js 20+。

```bash
npm install
npm run dev
```

开发地址固定为 `http://127.0.0.1:4317/`；生产预览固定为 `http://127.0.0.1:4318/`。脚本启用了 `strictPort`，端口冲突时会直接提示，避免误打开其他项目。

质量检查与生产构建：

```bash
npm run check
npm run build
npm run preview
```

`npm run check` 依次执行类型检查、单元测试与桌面浏览器 UI 冒烟测试（Playwright）。

## 键位

- 移动：方向键 或 WASD
- 开火：空格 或 J
- 确认（菜单/开始下一关）：Enter
- 暂停：Esc 或 P

## 项目结构

```text
src/
  classic/
    audio/    程序化 WebAudio 8-bit 音效与过场 Jingle，只依赖 core/types 的 SimEvent
    content/  关卡文本解析与第 1-3 关数据（FC 原版布局转写）
    core/     架构契约：类型（types.ts）与常量（constants.ts），改动需主线评审
    game/     顶层编排：FSM 状态机、键盘输入、固定步长循环、菜单/结算界面
    render/   Canvas 2D 分层渲染器，只读消费 WorldSnapshot/SimEvent
    sim/      确定性战斗模拟（World/AI/碰撞/地形/哈希回归），零浏览器 API
  core/
    RNG.ts    注入式确定性随机数生成器，被 sim 与 core/types 引用
  main.ts     入口：装配 ClassicGame + ClassicAudio，注册离线 Service Worker
tests/        单元测试（classic-*.test.ts、rng.test.ts）与 Playwright UI 冒烟测试
legacy/       历史原型参照，不参与生产构建
docs/         架构文档与复刻计划
```

详细分层不变式与确定性设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，复刻范围与阶段计划见 [docs/BATTLE_CITY_REMAKE_PLAN.md](docs/BATTLE_CITY_REMAKE_PLAN.md)。

## 儿童隐私原则

无账号、无行为数据上传、无广告。完全离线可玩，不依赖任何服务器。
