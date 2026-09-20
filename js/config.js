export const CONFIG = Object.freeze({
  modelUrl: "./assets/flower_bouquet.glb",
  maxParticles: 180000,
  desktopParticles: 100000,
  mobileParticles: 60000,
  text: "ZWC",
  size: 1,
  distance: 2.2,
  bloom: 0.25,
});

export const MODES = Object.freeze({
  original: {
    number: "01",
    title: "原貌",
    description: "花瓣的纹理，藏着温柔的细节。",
  },
  particles: {
    number: "02",
    title: "微光",
    description: "把一束花，化作细碎的星光。",
  },
  explode: {
    number: "03",
    title: "散开",
    description: "让心意散落，漫游在空气里。",
  },
  aggregate: {
    number: "04",
    title: "聚合",
    description: "每一点微光，都记得回来的方向。",
  },
  text: {
    number: "05",
    title: "写字",
    description: "那些没说出口的话，让花替你写。",
  },
  cycle: {
    number: "06",
    title: "流转",
    description: "静静看着，让花束自己讲述。",
  },
});
