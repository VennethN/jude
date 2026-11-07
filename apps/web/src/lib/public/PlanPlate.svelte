<script lang="ts">
  import type { Plan, Language } from '@jude/core/plans';
  let { plan, lang, size = 'md' }: { plan: Plan; lang: Language; size?: 'sm'|'md'|'lg'|'dot' } = $props();
</script>

<span class="plate tier-{plan.tier} {size}" aria-label={size === "dot" ? `${(lang === 'id' ? 'Paket' : 'Plan')} ${plan.name[lang]}` : undefined} role={size === "dot" ? "img" : undefined}>
  {#if plan.tier >= 2 && size !== "dot" && size !== "sm"}<span class="screw tl"></span><span class="screw tr"></span><span class="screw bl"></span><span class="screw br"></span>{/if}
  {#if size === "md" || size === "lg"}<span class="kicker">{(lang === 'id' ? 'Paket' : 'Plan')}</span>{/if}
  {#if size !== "dot"}<span class="name">{plan.name[lang]}</span>{/if}
</span>

<style>
  .plate {
    position: relative;
    isolation: isolate;
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 2px;
    overflow: hidden;
    border-radius: 6px;
    text-align: center;
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink);
  }
  .plate.lg {
    min-width: 260px;
    min-height: 96px;
    padding: 16px 30px;
  }
  .plate.md {
    min-height: 74px;
    padding: 12px 16px;
  }
  .plate.sm {
    display: inline-grid;
    min-height: 24px;
    padding: 2px 10px;
    border-radius: 4px;
  }
  .plate.dot {
    display: inline-block;
    width: 18px;
    height: 18px;
    border-radius: 4px;
  }
  .kicker {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    line-height: 1.35;
  }
  .name {
    font-family: var(--display);
    font-size: 24px;
    line-height: 1.1;
    white-space: nowrap;
  }
  .lg .name {
    font-size: 30px;
  }
  .sm .name {
    font-size: 14px;
    line-height: 1.3;
  }

  /* Tier 0: paper. */
  .plate.tier-0.sm,
  .plate.tier-0.dot {
    background: var(--surface);
  }

  /* Tier 1: forest enamel with a fine brass edge. */
  .plate.tier-1 {
    border-color: #b8955a;
    background: linear-gradient(160deg, #2a5a46 0%, #16382b 55%, #0e261d 100%);
    color: #f3e9d2;
    text-shadow: 0 1px 0 rgb(0 0 0 / 0.45);
    box-shadow:
      inset 0 0 0 2px rgb(16 40 30),
      inset 0 0 0 3px rgb(184 149 90 / 0.55),
      0 3px 8px rgb(14 38 29 / 0.25);
  }
  .plate.tier-1.sm,
  .plate.tier-1.dot {
    box-shadow: inset 0 0 0 1px rgb(184 149 90 / 0.5);
  }

  /* Tier 2: polished brass, engraved, with corner screws. */
  .plate.tier-2 {
    border-color: #5c4214;
    background: linear-gradient(135deg, #a67d3b 0%, #c29b55 16%, #f3dc9a 34%, #d0aa64 50%, #b18b47 66%, #e8c97f 84%, #a98440 100%);
    color: #2b1c08;
    text-shadow: 0 1px 0 rgb(255 240 200 / 0.65), 0 -1px 0 rgb(60 40 5 / 0.3);
    box-shadow:
      inset 0 0 0 1px rgb(255 236 180 / 0.55),
      inset 0 2px 3px rgb(255 255 255 / 0.45),
      inset 0 -3px 5px rgb(70 45 5 / 0.4),
      0 5px 14px rgb(90 62 12 / 0.32);
  }
  .plate.tier-2.sm,
  .plate.tier-2.dot {
    box-shadow: inset 0 0 0 1px rgb(255 236 180 / 0.55), inset 0 -2px 3px rgb(70 45 5 / 0.35);
  }

  /* Tier 3: platinum with an iridescent foil and a deeper bevel. */
  .plate.tier-3 {
    border-color: #6d747b;
    background: linear-gradient(135deg, #8f969d 0%, #eef1f3 20%, #b3b9bf 38%, #fbfcfd 54%, #a1a8af 70%, #e2e6ea 86%, #868d94 100%);
    color: #1b2730;
    text-shadow: 0 1px 0 rgb(255 255 255 / 0.8), 0 -1px 0 rgb(20 30 40 / 0.25);
    box-shadow:
      inset 0 0 0 1px rgb(255 255 255 / 0.7),
      inset 0 3px 4px rgb(255 255 255 / 0.6),
      inset 0 -4px 7px rgb(30 40 50 / 0.35),
      0 8px 22px rgb(30 40 50 / 0.3);
  }
  .plate.tier-3.sm,
  .plate.tier-3.dot {
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.7), inset 0 -2px 3px rgb(30 40 50 / 0.3);
  }
  .plate.tier-3::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    background: conic-gradient(from 200deg at 30% 40%, #ffc4e1, #bfe8ff, #d2ffc4, #ffe9a8, #e6c4ff, #ffc4e1);
    mix-blend-mode: overlay;
    line-height: 1.35;
  }
  .tier-2 .name,
  .tier-3 .name {
    letter-spacing: 0.02em;
  }

  .screw {
    position: absolute;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 35%, rgb(255 255 255 / 0.9), rgb(120 100 70 / 0.9) 45%, rgb(50 35 10) 100%);
    box-shadow: 0 1px 0 rgb(255 255 255 / 0.4);
  }
  .tier-3 .screw {
    background: radial-gradient(circle at 35% 35%, #fff, #9aa2aa 45%, #3a434b 100%);
  }
  .screw.tl { top: 7px; left: 7px; }
  .screw.tr { top: 7px; right: 7px; }
  .screw.bl { bottom: 7px; left: 7px; }
  .screw.br { bottom: 7px; right: 7px; }

  /* Sheen: one band of light, out of view at both ends. */
  .plate.tier-1::after,
  .plate.tier-2::after,
  .plate.tier-3::after {
    content: "";
    position: absolute;
    inset: -30% -60%;
    background: linear-gradient(105deg, transparent 40%, rgb(255 255 255 / var(--sheen)) 50%, transparent 60%);
    transform: translateX(-70%);
    pointer-events: none;
  }
  .plate.tier-1 { --sheen: 0.16; }
  .plate.tier-2 { --sheen: 0.55; }
  .plate.tier-3 { --sheen: 0.75; }
  @media (prefers-reduced-motion: no-preference) {
    .plate.tier-3::after {
      animation: sheen-arrive 1.6s ease 0.5s 1 both;
    }
    :global(.sheen-host:hover) .plate::after,
    :global(.sheen-host:focus-visible) .plate::after {
      animation: sheen-hover 1.1s ease 1 both;
    }
  }
  @keyframes sheen-arrive {
    from { transform: translateX(-70%); }
    to { transform: translateX(70%); }
  }
  @keyframes sheen-hover {
    from { transform: translateX(-70%); }
    to { transform: translateX(70%); }
  }
</style>
