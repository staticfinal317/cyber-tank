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

**Findings**

- [P1] 3D 机体与环境资产仍低于视觉基线的成品精度
  Location: 3D tank, movement modules, companion robot, mountain/river backdrop.
  Evidence: source uses a dense PBR tank, articulated wheel assembly, detailed robot and cinematic mountain-water landscape; implementation uses programmatic geometry with simpler silhouettes and materials.
  Impact: core flow is usable and visually coherent, but the first impression does not yet reach the selected “premium console-game” art target.
  Fix: introduce an asset pipeline for optimized glTF/GLB tank parts, PBR material sets, instanced foliage and a higher-detail mountain-water kit; retain the current procedural models as Battery-mode fallback.

- [P2] Destination landscape has less depth and route storytelling
  Location: upper background behind the tank.
  Evidence: source shows winding mountain and river routes, sea horizon, waterfall spray and layered atmospheric depth; implementation shows mountain silhouettes, waterfall, trees and sky but the routes are not yet readable in-world.
  Impact: weather and terrain ratings are clear, but the child sees less reason to choose one route over another.
  Fix: add emissive route splines, water shimmer, waterfall particles, distant cloud layers and a second terrain depth band.

- [P2] Part drawer thumbnails repeat a generic category icon
  Location: bottom module carousel.
  Evidence: source shows a distinct rendered wheel/module in every tile; implementation uses Phosphor tire icons and text.
  Impact: children must read labels instead of recognizing parts visually.
  Fix: render each part to an offscreen thumbnail canvas and cache it as the card preview.

**Required Fidelity Surfaces**

- Fonts and typography: hierarchy, weights and Chinese wrapping are consistent; title scale is slightly smaller than source but remains clear. No clipping found.
- Spacing and layout rhythm: desktop major regions align with the source; Pad and mobile actions stay within bounds. Pad category targets are 64 × 66px; mobile targets are 85.75 × 52px. No horizontal overflow.
- Colors and visual tokens: navy/cyan/yellow tokens match. Workshop exposure and bloom were reduced after the first QA pass to restore body and wheel detail.
- Image quality and asset fidelity: blocking P1 remains because procedural 3D assets are materially simpler than the selected visual truth.
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

- Add optimized glTF/PBR part asset pipeline with procedural fallback.
- Generate cached 3D thumbnails for all movement, ammo, tool and appearance cards.
- Add readable in-world mountain/water route lines and environmental particles.
- Repeat desktop/Pad/mobile capture and comparison.

**Follow-up Polish**

- Add small suspension bounce during module installation.
- Add reduced-flash mode for magnetic sparks.
- Add a child-friendly preset rename keypad.

final result: blocked
