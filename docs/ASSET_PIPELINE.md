# Cyber Tank glTF / PBR 资产管线

## 目标

战斗逻辑不依赖具体模型。程序化几何是始终可用的降级层，量产模型通过 `public/assets/models/catalog.json` 热替换，因此更换机体、Boss 或场景资产不需要改玩法代码。

## 模型约定

- 格式：glTF 2.0 二进制 `.glb`，Y 轴向上，坦克前方朝 -Z。
- 单位：1 unit = 1 meter；玩家坦克包围盒建议约 1.6 × 1.2 × 2.1。
- 原点：机体履带接地点中心；不要把模型原点留在 DCC 世界原点之外。
- PBR：Base Color、Metallic/Roughness、Normal、Emissive；发光纹理保持低亮度，由 Bloom 完成扩散。
- 节点：可旋转炮塔命名 `CYBER_TURRET`；后续武器挂点使用 `SOCKET_MUZZLE`，轮组使用 `SOCKET_MOVEMENT_*`。
- 网格预算：玩家 LOD0 ≤ 35k 三角面、普通敌人 ≤ 16k、Boss ≤ 70k；单材质优先。
- 纹理预算：移动端 1K、Boss/工坊近景 2K；Base Color 用 sRGB，Normal/Metallic-Roughness 用 Linear。

## 运行时策略

`ModelAssetLibrary` 负责清单注册、Promise 缓存、克隆实例和加载失败降级。渲染器使用 ACES 色调映射、RoomEnvironment 生成的 PMREM 环境反射、MeshPhysicalMaterial 清漆层、动态灯光、Bloom 与色差后处理。

后续量产阶段建议接入：

1. Draco 或 Meshopt 网格压缩。
2. KTX2/Basis Universal 纹理压缩，并按 ASTC/ETC2 能力选择。
3. LOD0/LOD1/LOD2 和设备画质档位联动。
4. 资产哈希清单、预加载优先级、显存预算遥测。
5. 炮塔、炮口、轮组、受击点的标准 Socket 校验脚本。
