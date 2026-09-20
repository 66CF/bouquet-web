import { mulberry32 } from "./utils.js";

let fontReady;
function loadWritingFont() {
  if (!fontReady) {
    const url = new URL(
      "../assets/fonts/GreatVibes-Regular.ttf",
      import.meta.url,
    );
    const font = new FontFace("Bouquet Script", `url("${url}")`);
    fontReady = font
      .load()
      .then((loaded) => {
        document.fonts.add(loaded);
        return true;
      })
      .catch((error) => {
        console.warn("书写字体加载失败，使用衬线斜体回退。", error);
        return false;
      });
  }
  return fontReady;
}

// 等字体实际加载完成后再栅格化，避免缓存到系统回退字体。
export async function buildTextTargets(count, text) {
  const hasScript = await loadWritingFont();
  const W = 1280;
  const H = 640;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  const family = hasScript ? '"Bouquet Script"' : "Georgia, serif";
  const style = hasScript ? "" : "italic ";
  ctx.font = `${style}320px ${family}`;
  const metrics = ctx.measureText(text);
  const width = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
  const height =
    metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
  const fontSize = 320 * Math.min(1, (W - 140) / width, (H - 140) / height);
  ctx.font = `${style}${fontSize}px ${family}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const bounds = ctx.measureText(text);
  const x =
    (W - bounds.actualBoundingBoxRight + bounds.actualBoundingBoxLeft) / 2;
  const y =
    (H + bounds.actualBoundingBoxAscent - bounds.actualBoundingBoxDescent) / 2;
  ctx.fillText(text, x, y);
  // 保留连笔字体的细发丝，不用加粗字重抹平笔画粗细变化。
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 0.7;
  ctx.strokeText(text, x, y);
  const data = ctx.getImageData(0, 0, W, H).data;

  const pts = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 128) pts.push(x, y);
    }
  }
  const nPts = pts.length / 2;
  if (nPts < 32) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i]);
    maxX = Math.max(maxX, pts[i]);
    minY = Math.min(minY, pts[i + 1]);
    maxY = Math.max(maxY, pts[i + 1]);
  }
  const scale = Math.max(maxX - minX, maxY - minY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  // 洗牌，让粒子拼字时不会出现扫描线轨迹
  const order = new Uint32Array(nPts);
  for (let i = 0; i < nPts; i++) order[i] = i;
  const rand = mulberry32(20260807);
  for (let i = nPts - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = order[i];
    order[i] = order[j];
    order[j] = t;
  }

  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const oi = order[i % nPts] * 2;
    const nx = (pts[oi] - cx) / scale;
    const ny = (pts[oi + 1] - cy) / scale;
    out[i * 3] = nx + (rand() - 0.5) * 0.002;
    out[i * 3 + 1] = -ny + (rand() - 0.5) * 0.002; // canvas y 向下，翻转
    out[i * 3 + 2] = (rand() - 0.5) * 0.008; // 轻微厚度
  }
  return out;
}
