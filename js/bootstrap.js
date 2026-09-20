import { showLoadError } from "./loading.js";

document
  .getElementById("retryLoad")
  .addEventListener("click", () => location.reload());

// 捕获模块加载、WebGL 初始化等早于模型加载的异常，避免永久停在加载页。
import("./main.js").catch((error) => {
  console.error(error);
  showLoadError("无法启动 3D 场景，请确认浏览器支持 WebGL 2，然后重新加载。");
});
