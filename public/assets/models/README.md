# Cyber Tank 3D model drop zone

Place optimized `.glb` files here, then map them in `catalog.json` without changing gameplay code.

```json
{
  "player-tank": {
    "url": "/assets/models/player-tank.glb",
    "scale": 1,
    "offset": [0, 0, 0],
    "rotationY": 0
  }
}
```

Name a movable turret node `CYBER_TURRET`. The runtime uses it for independent aiming. If a file is missing or fails to load, the procedural tank remains visible.
