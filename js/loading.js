const loading = document.getElementById("loading");
const progress = document.getElementById("loadingBar");
const text = document.getElementById("loadingText");

export function setLoadingProgress(value, message) {
  progress.setAttribute("aria-valuenow", String(value));
  document.getElementById("loadingFill").style.width = `${value}%`;
  text.textContent = message;
}

export function hideLoading() {
  setLoadingProgress(100, "花束已准备好");
  loading.classList.add("hidden");
  loading.setAttribute("aria-hidden", "true");
  loading.inert = true;
  document.getElementById("controls").inert = false;
  document.getElementById("settings").inert = false;
}

export function showLoadError(message) {
  loading.classList.remove("hidden");
  loading.removeAttribute("aria-hidden");
  loading.inert = false;
  document.getElementById("controls").inert = true;
  document.getElementById("settings").inert = true;
  document.getElementById("loadingTitle").textContent = "花束暂时无法显示";
  text.textContent = message;
  progress.hidden = true;
  document.getElementById("retryLoad").hidden = false;
}
