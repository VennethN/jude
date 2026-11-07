type Box = { x: number; y: number; w: number; h: number; r: number };
const papers: Record<"bap" | "law" | "talk" | "roster" | "log" | "cctv", Box> = {
  bap: { x: 70, y: 46, w: 262, h: 330, r: -7 },
  law: { x: 52, y: 404, w: 238, h: 190, r: -12 },
  talk: { x: 372, y: 104, w: 276, h: 330, r: 4 },
  roster: { x: 712, y: 34, w: 212, h: 168, r: 11 },
  log: { x: 660, y: 262, w: 290, h: 214, r: -5 },
  cctv: { x: 380, y: 470, w: 218, h: 138, r: 7 },
};
export const order = Object.keys(papers) as (keyof typeof papers)[];
function on(p: keyof typeof papers, fx: number, fy: number) {
  const b = papers[p];
  const a = (b.r * Math.PI) / 180;
  const lx = (fx - 0.5) * b.w;
  const ly = (fy - 0.5) * b.h;
  return { x: b.x + b.w / 2 + lx * Math.cos(a) - ly * Math.sin(a), y: b.y + b.h / 2 + lx * Math.sin(a) + ly * Math.cos(a) };
}
export const place = (p: keyof typeof papers) => {
  const b = papers[p];
  return `left:${b.x / 10}%;top:${b.y / 6.4}%;width:${b.w / 10}%;height:${b.h / 6.4}%;--r:${b.r}deg;--i:${order.indexOf(p)}`;
};
// Where each time sits across the desk (0 to 1), for the moment the reading light passes it.
export const across = (p: keyof typeof papers, fx: number, fy: number) => (on(p, fx, fy).x / 1000).toFixed(3);
// The three lines that belong together, numbered as they are listed beside the desk.
export const pins = [
  { n: 1, ...on("talk", 20 / 276, 0.69) },
  { n: 2, ...on("bap", 20 / 262, 0.69) },
  { n: 3, ...on("log", 20 / 290, 0.633) },
];
function thread(a: { x: number; y: number }, b: { x: number; y: number }, bend: number) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const cx = (a.x + b.x) / 2 - ((b.y - a.y) / len) * bend;
  const cy = (a.y + b.y) / 2 + ((b.x - a.x) / len) * bend;
  return `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
}
export const threads = [thread(pins[0], pins[1], -46), thread(pins[0], pins[2], 40)];

export const wires: Record<string, { d: string; x: number; y: number }> = {
  bap: { d: "M360,105 C405,105 392,255 430,255", x: 33.2, y: 31.5 },
  log: { d: "M380,455 C414,455 398,305 430,305", x: 33.8, y: 68 },
  shift: { d: "M840,115 C796,115 808,255 770,255", x: 66.8, y: 32.5 },
  law: { d: "M820,445 C788,445 802,305 770,305", x: 66.2, y: 67.5 },
};

/**
 * The line art on the public pages' forest surfaces: hairline rings, like sound spreading from a
 * source, each fainter as it widens. Radii and opacities for circles in a 1440-unit square.
 */
export const rings = Array.from({ length: 15 }, (_, i) => ({ r: 96 + i * 42, o: +(0.2 * Math.min(1, (15 - i) / 8)).toFixed(3) }));
