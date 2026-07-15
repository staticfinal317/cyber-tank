# Cyber Tank “2+3” Fusion Design QA

- source visual truth 2 (neon objective arena): `/Users/longda/.codex/generated_images/019f5fde-3417-7792-88de-0e021f30ba3c/exec-315b545e-a3e0-4f14-9a80-67411636ad22.png`
- source visual truth 3 (mountain-sea battle zone): `/Users/longda/.codex/generated_images/019f5fde-3417-7792-88de-0e021f30ba3c/exec-8f97efcd-a33d-483d-87be-8035087d66be.png`
- implementation screenshot: `test-results/cyber-tank-23-final-pad.png`
- full-view comparison evidence: `test-results/cyber-tank-23-final-comparison.png`
- generated environment assets: `public/assets/environment/mountain-sea-citadel.jpg`, `public/assets/environment/neon-tactical-floor.jpg`
- viewport: 1280 × 720 landscape Pad
- state: `?touch=1` / expedition / spring / ridge route / standard aim assist / wave 1

## Intended Fusion

- Concept 2 contributes the three readable tactical lanes, A / CORE / B capture objectives, neon objective beams, cover rhythm, dark PBR-like floor and action-control hierarchy.
- Concept 3 contributes the mountain-sea citadel horizon, storm boundary, seasonal rain, expedition route context and a more cinematic lowered 3D camera.
- Existing Cyber Tank HUD and Pad control language remain the product design system; the references guide battlefield composition, depth, lighting and interaction rather than replacing the established UI.

## Interaction and Functional Verification

- [x] Player starts on a safe ridge surface and remains clear of the Pad movement stick.
- [x] Five enemies appear in wave 1; HUD copy uses `敌方机` rather than the misleading former `伙伴机`.
- [x] A / CORE / B are real Simulation objectives with capture progress, score, shield reward and wave reset.
- [x] Pointer/touch fire, manual fire button and aim direction are connected to the combat input path.
- [x] Every player projectile is created at the physical barrel endpoint (`player.pos + aim * 1.7`), and renderer muzzle flash, cone light and recoil use that same projectile origin.
- [x] Cannon-origin behavior is covered by an adversarial Simulation test; tactical capture/reward is covered by an automated test.
- [x] Browser smoke covers menu → workshop → compatible module → combat on desktop, iPad shared-crew layout and phone.
- [x] Browser smoke checks page/console errors; none were reported.

## Required Fidelity Surfaces

- Typography and copy: existing Chinese HUD hierarchy is retained; wave, score, mission and enemy count remain readable over the new scene.
- Spacing and controls: touch joystick and right action cluster stay within the 1280 × 720 safe regions; the player spawn no longer sits under the movement control.
- Color and tokens: cyan / magenta / yellow objectives, dark gunmetal floor and the existing health/action tokens match the selected references.
- Image quality: two original raster environment assets were produced with the built-in ImageGen workflow, optimized to JPEG and loaded asynchronously with generation guards and procedural fallback.
- 3D depth: perspective camera, shadowed cover, raised bridges, animated objective rings/beams, projectile lights, bloom, chromatic separation and the citadel horizon create foreground/midground/background separation.
- Responsive behavior: desktop, iPad and 390 × 844 phone smoke paths pass; touch HUD remains available on forced-touch Pad QA.

## Comparison History

1. Initial implementation: `/tmp/cyber-tank-23-pad.png`
   - Finding: tactical structure existed, but the bright low-poly natural ground dominated and the horizon lacked the selected mountain-sea density.
   - Fix: lowered the camera, darkened expedition lighting, added the citadel/storm/waterfall fallback and generated dedicated scene art.
2. Intermediate implementation: `/tmp/cyber-tank-23-final-pad-v3.png`
   - Finding: the citadel plate appeared, but the detailed gunmetal material was restricted to narrow lane strips; bright procedural foliage competed with enemies and objectives.
   - Fix: mapped the generated PBR-like floor across the full arena, retained three lane identities as overlays, hid low-detail foliage after the raster art is ready and expanded the horizon plate to cover the full viewport.
3. Final implementation: `test-results/cyber-tank-23-final-pad.png`
   - Result: the scene now combines a detailed neon tactical foreground with a mountain-sea citadel horizon; objectives, tank and touch controls remain legible and functional.

## Quality Gates

- `npm run check`: passed — TypeScript, 18 Vitest files / 57 tests, desktop/iPad/phone browser smoke.
- `npm run build`: passed — Vite production bundle generated successfully.

## P3 Follow-up Polish

- Replace the remaining deliberately simple cover silhouettes with authored glTF modular ruins, cliff props and wet-surface normal/roughness maps.
- Add depth-aware fog cards and parallax vegetation clusters for high-end tablets while keeping the current generated-floor and procedural paths as Balanced/Battery fallbacks.
- Add a dedicated visual regression capture at projectile age 0–80 ms so muzzle flash alignment is also image-diffed in CI, in addition to the exact-coordinate gameplay test.

final result: passed
