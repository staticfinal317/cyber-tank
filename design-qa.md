# Expedition Workshop Design QA

- source visual truth path: `docs/design/expedition-workshop-visual-target.png`
- implementation screenshot path: `test-results/workshop-desktop-final.png`
- Pad screenshot path: `test-results/workshop-pad-final.png`
- mobile screenshot path: `test-results/workshop-mobile-final.png`
- full-view comparison evidence: `test-results/workshop-qa-comparison-final.png`
- viewport: 1440 × 900
- state: 远征工坊 / 行走分类 / 浮航模块已安装
- primary interactions tested: 进入工坊、选择浮航模块、评分更新、保存方案、20 秒试驾、自动返回工坊
- responsive checks: 1180 × 820 Pad、390 × 844 手机
- console errors checked: 0 error / 0 warning

**2026-07-15 Remediation**

- [Resolved P1] 自研 GLB/PBR 机体与霸主已接入 High/Balanced/Low 三档 LOD。画质切换会热替换已显示实例，旧异步请求不能覆盖新档位；程序几何继续作为断网/加载失败与 Battery 兜底。
- [Resolved P1] `ARMORED_BODY`、能量/传感器节点与独立行走模块分别接收涂装、灯色和轮胎配置；实例共享几何但克隆材质，避免串色并保持可靠释放。
- [Resolved P2] 山海谷新增两条可读发光样条路线、远景云层、双层山体、瀑布、河海与季节粒子，路线选择在场景中有明确空间对应。
- [Resolved P2] 部件抽屉不再复用字体图标；行走、炮弹、工具和涂装卡使用按部件 ID 生成的立体 CSS 微缩轮廓，并与真实安装颜色同步。
- [Validated] 当前 `npm run check` 包含 TypeScript、Vitest 与 Node Playwright；E2E 覆盖桌面、1180×820 iPad 共享车组和 390×844 手机的主页→工坊→兼容部件→发车→HUD，桌面另测暂停/恢复。

**Required Fidelity Surfaces**

- Fonts and typography: hierarchy, weights and Chinese wrapping are consistent; title scale is slightly smaller than source but remains clear. No clipping found.
- Spacing and layout rhythm: desktop major regions align with the source; Pad and mobile actions stay within bounds. Pad category targets are 64 × 66px; mobile targets are 85.75 × 52px. No horizontal overflow.
- Colors and visual tokens: navy/cyan/yellow tokens match. Workshop exposure and bloom were reduced after the first QA pass to restore body and wheel detail.
- Image quality and asset fidelity: GLB/PBR is the primary High/Balanced path; program geometry is retained deliberately as resilient fallback.
- Copy and content: specified Chinese labels, weather, destination, terrain ratings, save/test/launch actions and dual ammo slots are present.

**Comparison History**

1. First capture: `test-results/workshop-desktop-before.png`
   - Findings: severe bloom/overexposure, tank silhouette blown out, landscape not visible, camera scale too aggressive.
   - Fixes: lowered workshop exposure and bloom, reduced emissive intensities, resized the tank, brightened the destination sky and water.
2. Second capture: `test-results/workshop-desktop-landscape.png`
   - Findings: readable tank but empty middle region and shallow destination storytelling.
   - Fixes: added sky plane, layered mountains, waterfall, trees and blossoms; changed camera target; added armor details, amphibious wheel structure and a dedicated companion robot.
3. Post-fix capture: `test-results/workshop-desktop-final.png`
   - Result: functional layout, legibility, responsive behavior and visual tokens pass; P1 asset fidelity remains.

**Implementation Checklist**

- [x] Add optimized glTF/PBR part asset pipeline with procedural fallback.
- [x] Generate distinct miniatures for movement, ammo, tool and appearance cards.
- [x] Add readable in-world mountain/water route lines and environmental particles.
- [x] Add automated desktop/Pad/mobile interaction verification to the quality gate.

**Follow-up Polish**

- Add small suspension bounce during module installation.
- Add reduced-flash mode for magnetic sparks.
- Add a child-friendly preset rename keypad.

final result: pass
