# Cyber Tank 自研 3D 资产管线

这里的 `.glb` 全部由 `scripts/generate-models.mjs` 在本项目内生成，不含第三方美术资产。运行 `npm run assets:models` 可确定性重建。

- `high / balanced / low` 三档 LOD 跟随画质策略选择。
- 模型使用 glTF 2.0 PBR metallic-roughness 材质、索引几何和二进制 GLB 容器。
- `CYBER_TURRET` 是可独立转向的炮塔节点。
- 首次实例化时才请求模型；加载失败自动保留程序几何后备。

所有新增资产必须保留生成脚本、LOD、尺寸预算和离线加载失败后备，避免不可追溯的手工二进制文件。
