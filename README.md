# 粒子花束 · Particle Bouquet

基于 Three.js 的 3D 花束交互网页：保留模型原始形态，可切换为粒子云效果，并支持
**粒子化、发光（Bloom）、爆炸、聚合** 动画。

## 运行

双击 `start.bat`（会自动启动本地服务器并打开浏览器），或手动运行：

```bat
cd bouquet-web
python -m http.server 8080
```

然后访问 <http://localhost:8080/>。

> 注意：必须通过 HTTP 访问（不能直接双击 index.html），否则浏览器会因 CORS
> 拒绝加载 GLB 模型。

## 操作

| 按钮 | 效果 |
| --- | --- |
| 原貌 | 展示完整花束模型 |
| 粒子 | 将花束转化为粒子，并保持花束结构 |
| 散开 | 粒子沿花束结构向外爆炸散开 |
| 聚合 | 粒子聚合回花束结构 |
| 写字 | 粒子先散成云，再汇聚成字母 "ZWC" |
| 自动 | 粒子化 → 散开 → 聚合 → 散射 → 聚合 → 还原，循环播放 |

右侧 ⚙ 面板可调节：粒子数量、粒子大小、爆炸距离、发光强度、自动旋转。

## 目录

```
bouquet-web/
  index.html        页面入口
  css/style.css     界面样式
  js/main.js        场景 / 粒子系统 / 动画逻辑
  assets/           花束 GLB 模型
  vendor/three/     Three.js 本地模块（离线可用）
```

## 模型来源

模型：Flower Bouquet，作者 icecool（Sketchfab），CC-BY-4.0
<https://sketchfab.com/3d-models/flower-bouquet-48e92013548247a9ad486dc13110c9b4>
