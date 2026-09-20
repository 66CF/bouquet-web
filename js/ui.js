import { CONFIG, MODES } from "./config.js";

const $ = (id) => document.getElementById(id);
const formatCount = (value) => `${Number((value / 10000).toFixed(1))}万`;

export function createUI({
  settings,
  reducedMotion,
  onAction,
  onCount,
  onChange,
  onReset,
}) {
  const buttons = [...document.querySelectorAll("[data-action]")];
  const panel = $("settings");
  const toggle = $("settingsToggle");
  let activeButton = null;

  function selectMode(action) {
    activeButton = buttons.find((button) => button.dataset.action === action);
    for (const button of buttons) {
      const active = button === activeButton;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    const mode = MODES[action];
    $("modeNumber").textContent = mode?.number || "—";
    $("modeTitle").textContent = mode?.title || "停留";
    $("modeDescription").textContent =
      mode?.description || "在这一刻，停留一会儿。";
  }

  function setOpen(open) {
    panel.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
    $("settingsBody").inert = !open;
  }

  for (const button of buttons) {
    button.addEventListener("click", () =>
      selectMode(onAction(button.dataset.action)),
    );
  }
  toggle.addEventListener("click", () =>
    setOpen(!panel.classList.contains("open")),
  );
  $("closeSettings").addEventListener("click", () => {
    setOpen(false);
    toggle.focus();
  });
  $("resetView").addEventListener("click", onReset);
  document.addEventListener("pointerdown", (event) => {
    if (!panel.contains(event.target)) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && panel.classList.contains("open")) {
      setOpen(false);
      toggle.focus();
    }
  });

  const sliders = [
    ["particleSize", "size", 2],
    ["explodeDist", "distance", 1],
    ["bloomStrength", "bloom", 2],
  ];
  for (const [id, key, digits] of sliders) {
    const input = $(id);
    input.value = settings[key];
    const update = () => {
      settings[key] = Number(input.value);
      $(`${id}Val`).textContent = settings[key].toFixed(digits);
    };
    update();
    input.addEventListener("input", () => {
      update();
      onChange();
    });
  }
  $("particleCount").max = CONFIG.maxParticles;
  $("particleCount").value = settings.count;
  $("particleCountVal").textContent = formatCount(settings.count);
  $("particleCount").addEventListener("input", () => {
    settings.count = onCount(Number($("particleCount").value));
    $("particleCountVal").textContent = formatCount(settings.count);
  });
  $("autoRotate").checked = settings.autoRotate;
  $("autoRotate").addEventListener("change", () => {
    settings.autoRotate = $("autoRotate").checked;
    onChange();
  });
  reducedMotion.addEventListener("change", () => {
    settings.autoRotate = !reducedMotion.matches;
    $("autoRotate").checked = settings.autoRotate;
    onChange();
  });

  selectMode("original");
  return {
    selectMode,
    setStats(count, vertices, capacity) {
      const input = $("particleCount");
      input.max = capacity;
      input.min = Math.min(20000, capacity);
      input.step = capacity >= 20000 ? 5000 : 1;
      input.value = count;
      $("particleCountVal").textContent = formatCount(count);
      $("statCount").textContent = `${count.toLocaleString()} 粒子`;
      $("statVerts").textContent = `${vertices.toLocaleString()} 顶点`;
    },
  };
}
