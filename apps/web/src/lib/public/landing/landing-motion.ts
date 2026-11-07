import Lenis from 'lenis';
import 'lenis/dist/lenis.css';

/** Pinned scenes follow native document scroll. Every read precedes writes in a frame. */
  const tracks: Record<string, [name: string, from: number, to: number][]> = {
    hero: [["hv", 0, 1]],
    gather: [
      ["g0", -0.3, -0.05],
      ["g1", 0, 0.16],
      ["w1", 0.12, 0.24],
      ["g2", 0.2, 0.36],
      ["w2", 0.32, 0.44],
      ["g3", 0.4, 0.56],
      ["w3", 0.52, 0.64],
      ["g4", 0.6, 0.76],
      ["w4", 0.72, 0.84],
      ["gl", 0.84, 0.94],
    ],
    how: [
      ["h1o", 0.27, 0.37],
      ["h2", 0.29, 0.39],
      ["h2o", 0.6, 0.7],
      ["h3", 0.62, 0.72],
      ["hp", 0, 1],
    ],
    signal: [
      ["r1", -0.3, -0.12],
      ["r2", -0.18, 0],
      ["r3", -0.05, 0.12],
      ["r4", 0.08, 0.24],
      ["fw", 0.28, 0.48],
      ["mk", 0.36, 0.54],
      ["nt", 0.5, 0.68],
      ["r5", 0.66, 0.82],
    ],
    page: [
      ["pg", -0.35, 0.05],
      ["hl", 0.12, 0.36],
      ["nt", 0.36, 0.56],
      ["rl", 0.52, 0.7],
    ],
    closing: [
      ["cs", 0.1, 0.6],
      ["ck", 0.55, 0.85],
    ],
    // The showpiece: papers land on the desk, Jude reads them, three lines stay lit and are tied
    // together, then they come forward readable, and the finding after them.
    show: [
      ["si", -0.4, 0],
      ["dr", -0.3, 0.05],
      ["sc", 0.08, 0.42],
      ["fd", 0.4, 0.5],
      ["th", 0.48, 0.62],
      ["co", 0.54, 0.74],
      ["fs", 0.76, 0.9],
      ["orb", -0.4, 1],
    ],
  };

const unit = (value: number) => Math.min(1, Math.max(0, value));
const easeOut = (value: number) => 1 - (1 - unit(value)) ** 3;

type MotionLayout = { moving: boolean; desktop: boolean; phoneDesk: boolean };

export function followStory(root: HTMLElement, onLayout: (layout: MotionLayout) => void) {
  const motion = matchMedia('(prefers-reduced-motion: no-preference)');
  const wide = matchMedia('(min-width: 900px) and (min-height: 700px)');
  const tallPhone = matchMedia('(max-width: 899px) and (min-height: 560px)');
  const scenes = [...root.querySelectorAll<HTMLElement>('[data-scene]')];
  const risers = [...root.querySelectorAll<HTMLElement>('[data-rise]')];
  const drifters = [...root.querySelectorAll<HTMLElement>('[data-drift]')];
  const values = new Map<HTMLElement, Map<string, string>>();
  let wheel: Lenis | null = null;
  let frame = 0;
  let needsResize = false;

  function write(element: HTMLElement, key: string, value: number) {
    const next = value.toFixed(3);
    let previous = values.get(element);
    if (!previous) {
      previous = new Map();
      values.set(element, previous);
    }
    if (previous.get(key) !== next) {
      previous.set(key, next);
      element.style.setProperty('--' + key, next);
    }
  }

  function draw() {
    if (!motion.matches) return;
    const vh = innerHeight;
    // Read every position together, before changing any transforms.
    const sceneBoxes = scenes.map(node => node.getBoundingClientRect());
    const riseBoxes = wide.matches ? [] : risers.map(node => node.getBoundingClientRect());
    const driftBoxes = drifters.map(node => node.getBoundingClientRect());
    scenes.forEach((node, index) => {
      const name = node.dataset.scene!;
      const box = sceneBoxes[index];
      let progress: number;
      if (name === 'hero') progress = unit(-box.top / box.height);
      else if (name === 'closing') progress = unit((vh - box.top) / (vh * .8));
      else if (wide.matches || (name === 'show' && tallPhone.matches)) progress = -box.top / Math.max(1, box.height - vh);
      else if (name === 'show') progress = (vh * .75 - box.top) / box.height;
      else return;
      for (const [key, from, to] of tracks[name] ?? []) write(node, key, easeOut((progress - from) / (to - from)));
    });
    riseBoxes.forEach((box, index) => write(risers[index], 'p', easeOut((vh - box.top) / (vh * .45))));
    driftBoxes.forEach((box, index) => write(drifters[index], 'd', Math.max(-1, Math.min(1, (box.top + box.height / 2 - vh / 2) / vh))));
  }

  function paint(time: number) {
    if (!wheel) return;
    if (needsResize) {
      wheel.resize();
      needsResize = false;
    }
    wheel.raf(Math.max(time, wheel.time));
    draw();
    frame = wheel.isScrolling === 'smooth' ? requestAnimationFrame(paint) : 0;
  }

  function request() {
    if (!wheel || frame || document.hidden) return;
    // Start this gesture's clock here so time spent at rest cannot advance its first frame.
    wheel.time = performance.now();
    frame = requestAnimationFrame(paint);
  }

  function nativeScroll() {
    // A scrollbar drag or history jump can interrupt a section link already easing to its target.
    if (wheel?.isScrolling === 'smooth' && Math.abs(scrollY - wheel.animatedScroll) > 1) {
      wheel.stop();
      wheel.start();
    }
    request();
  }

  function resize() {
    needsResize = true;
    request();
  }

  function cancel() {
    cancelAnimationFrame(frame);
    frame = 0;
  }

  function visibility() {
    if (document.hidden) cancel();
    else request();
  }

  function sync() {
    onLayout({ moving: motion.matches, desktop: motion.matches && wide.matches, phoneDesk: motion.matches && tallPhone.matches });
    if (motion.matches) {
      if (!wheel) {
        wheel = new Lenis({ autoRaf: false, autoResize: false, lerp: .11 });
        wheel.on('virtual-scroll', request);
      }
      resize();
    } else {
      cancel();
      wheel?.destroy();
      wheel = null;
      for (const [node, fields] of values) for (const key of fields.keys()) node.style.removeProperty('--' + key);
      values.clear();
    }
  }

  const resized = new ResizeObserver(resize);
  resized.observe(root);
  resized.observe(document.documentElement);
  window.addEventListener('scroll', nativeScroll, { passive: true });
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', visibility);
  const queries = [motion, wide, tallPhone];
  for (const query of queries) query.addEventListener('change', sync);
  sync();

  return {
    scrollTo(target: HTMLElement | 0, immediate = false) {
      if (wheel) {
        wheel.resize();
        needsResize = false;
        wheel.scrollTo(target, { immediate });
        request();
      } else if (target === 0) {
        window.scrollTo({ top: 0, behavior: 'instant' });
      } else {
        target.scrollIntoView({ block: 'start', behavior: 'instant' });
      }
    },
    destroy() {
      cancel();
      wheel?.destroy();
      wheel = null;
      resized.disconnect();
      window.removeEventListener('scroll', nativeScroll);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', visibility);
      for (const query of queries) query.removeEventListener('change', sync);
    },
  };
}
