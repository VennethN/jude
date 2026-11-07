<script lang="ts">
	type Name = 'arrow' | 'forward' | 'back' | 'book' | 'mic' | 'file' | 'search' | 'mark' | 'link' | 'chevron' | 'menu' | 'close' | 'check' | 'globe' | 'lines';
	let { name, size = 18 }: { name: Name; size?: number } = $props();
	const paths: Record<Name, string[]> = {
		arrow: ['M5 12h14m-6-6 6 6-6 6'],
		forward: ['M6 18 18 6M7 6h11v11'], back: ['M19 12H5m6 6-6-6 6-6'],
		book: ['M3 5.5c4-1.5 6-1.2 9 1.2 3-2.4 5-2.7 9-1.2v13c-4-1.5-6-1.2-9 1.2-3-2.4-5-2.7-9-1.2zM12 7v12'],
		mic: ['M8.5 5.5a3.5 3.5 0 0 1 7 0V12a3.5 3.5 0 0 1-7 0zM5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3m-3 0h6'],
		file: ['M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h5'],
		search: ['M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm5-1.5 5 5'],
		mark: ['M7 3h10v18l-5-3-5 3z'],
		link: ['m8.5 14.5 7-7m-5 0 1.5-1.5a4 4 0 0 1 5.7 5.7l-1.5 1.5m-2.7 3.3L12 18a4 4 0 0 1-5.7-5.7l1.5-1.5'],
		chevron:['m6 9 6 6 6-6'], menu: ['M4 7h16M4 12h16M4 17h16'], close: ['M6 6l12 12M18 6 6 18'],
		check: ['m5 12 4 4L19 6'], globe: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18m-9-9a17 17 0 0 0 0 18 17 17 0 0 0 0-18Z'],
		lines: ['M4 9v6m4-9v12m4-15v18m4-14v10m4-7v4']
	};
</script>
<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{#each paths[name] as path}<path d={path}/>{/each}</svg>
