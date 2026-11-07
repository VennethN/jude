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

export function followStory(root: HTMLElement, onChange: (moving:boolean,pinned:boolean) => void) {
	const motion = matchMedia('(prefers-reduced-motion: no-preference)');
	const desktop = matchMedia('(min-width: 900px) and (min-height: 700px)');
	const scenes = [...root.querySelectorAll<HTMLElement>('[data-scene]')];
	const drifts = [...root.querySelectorAll<HTMLElement>('[data-drift]')];
	const risers = [...root.querySelectorAll<HTMLElement>('[data-rise]')];
	const visible = new Set<Element>();
	const assigned = new Map<HTMLElement,Set<string>>();
	let frame = 0;
	let active = true;
	const observer = new IntersectionObserver(entries => {
		for (const entry of entries) {
			if (entry.isIntersecting) visible.add(entry.target);
			else visible.delete(entry.target);
		}
		request();
	}, {rootMargin:'25% 0px'});
	for (const element of [...scenes,...risers,...drifts]) observer.observe(element);
	const clamp = (value:number) => Math.max(0,Math.min(1,value));
	function ease(value:number) {
		const at = clamp(value);
		return at * at * (3 - 2 * at);
	}
	function write(node:HTMLElement, name:string, amount:number) {
		const value = amount.toFixed(3);
		if (node.style.getPropertyValue(name) === value) return;
		node.style.setProperty(name,value);
		if (!assigned.has(node)) assigned.set(node,new Set());
		assigned.get(node)!.add(name);
	}
	function draw() {
		frame=0;
		if (!active || !motion.matches) return;
		const vh = innerHeight;
		const boxes = <T extends HTMLElement>(nodes:T[]) => nodes.filter(n => visible.has(n)).map(node => ({node,box:node.getBoundingClientRect()}));
		const activeScenes = boxes(scenes);
		const activeRisers = desktop.matches ? [] : boxes(risers);
		const activeDrifts = boxes(drifts);
		for (const {node,box} of activeScenes) {
			const name = node.dataset.scene!;
			const progress = name === 'hero' ? -box.top / box.height : name === 'closing' ? (vh-box.top)/(vh*.8) : desktop.matches ? -box.top/Math.max(1,box.height-vh) : 1;
			for (const [track,from,to] of tracks[name] ?? []) {
				const phase = (progress-from)/(to-from);
				// The reading rule and the sweep across the desk measure linear progress.
				write(node,'--'+track,track === 'hp' || track === 'sc' ? clamp(phase) : ease(phase));
			}
		}
		for (const {node,box} of activeRisers) write(node,'--p',ease((vh-box.top)/(vh*.45)));
		for (const {node,box} of activeDrifts) write(node,'--d',Math.max(-1,Math.min(1,(box.top+box.height/2-vh/2)/vh)));
	}
	function request() { if (active && !frame && motion.matches) frame = requestAnimationFrame(draw); }
	function sync() {
		onChange(motion.matches,motion.matches && desktop.matches);
		if (!motion.matches) {
			for (const [node,names] of assigned) for (const name of names) node.style.removeProperty(name);
			assigned.clear();
		}
		request();
	}
	const resized = new ResizeObserver(request);
	resized.observe(root);
	window.addEventListener('scroll',request,{passive:true});
	window.addEventListener('resize',request);
	motion.addEventListener('change',sync);
	desktop.addEventListener('change',sync);
	sync();
	return () => {
		active=false;
		cancelAnimationFrame(frame);
		observer.disconnect();
		resized.disconnect();
		window.removeEventListener('scroll',request);
		window.removeEventListener('resize',request);
		motion.removeEventListener('change',sync);
		desktop.removeEventListener('change',sync);
	};
}
