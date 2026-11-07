<script lang="ts">
  import type { Snippet } from 'svelte';

  let { title, lead, children }: { title: string; lead: string; children: Snippet } = $props();
</script>

<section class="login-cover" aria-labelledby="login-title">
  <div class="spread">
    <div class="introduction">
      <h1 id="login-title">{title}</h1>
      <p>{lead}</p>
      <img class="folder" src="/public/clay/folder.webp" width="760" height="725" alt="" />
    </div>
    <div class="login-leaf">
      {@render children()}
    </div>
  </div>
</section>

<style>
  .login-cover {
    --cover-cream: #f6f0e4;
    padding: 14px;
    background: #faf7f0;
  }
  .spread {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(340px, 0.9fr);
    align-items: center;
    column-gap: clamp(42px, 6vw, 96px);
    min-height: calc(100svh - 28px);
    padding: clamp(134px, 17vh, 170px) clamp(40px, 6vw, 112px) clamp(44px, 8vh, 96px);
    border-radius: 28px;
    color: var(--cover-cream);
    background-color: #153328;
    background-image:
      radial-gradient(110% 80% at 0 0, rgb(98 160 124 / 25%), transparent 68%),
      url('/public/jude-case-files.webp');
    background-size: cover;
    background-position: center bottom;
  }
  .introduction {
    align-self: start;
    padding-top: clamp(8px, 3vh, 32px);
  }
  .introduction h1 {
    max-width: 11ch;
    color: var(--cover-cream);
    font: 400 clamp(65px, 5.8vw, 92px)/0.99 Rufina, Georgia, serif;
    letter-spacing: -0.03em;
    text-wrap: balance;
  }
  .introduction p {
    max-width: 37ch;
    margin-top: 22px;
    color: color-mix(in srgb, var(--cover-cream) 92%, var(--pub-green));
    font: 400 18px/1.54 var(--pub-body);
    text-wrap: pretty;
  }
  .folder {
    display: block;
    width: clamp(164px, 15.5vw, 234px);
    height: auto;
    margin: clamp(38px, 6vh, 64px) 0 0 clamp(28px, 9.2vw, 150px);
    transform: rotate(-8deg);
    filter: drop-shadow(6px 13px 9px rgb(13 25 16 / 22%));
    pointer-events: none;
  }
  .login-leaf {
    justify-self: end;
    width: min(100%, 488px);
    padding: clamp(28px, 3.6vw, 54px);
    border-radius: 12px 12px 6px 6px;
    background: #f5eee2 url('/public/ivory-paper.webp') center / 600px;
    color: var(--pub-ink);
    box-shadow: 0 3px 0 #e7ddc8, 0 18px 38px -12px rgb(11 27 17 / 35%);
  }
  .login-leaf :global(.pub-form) {
    gap: 20px;
  }
  .login-leaf :global(.pub-form label) {
    gap: 8px;
    color: var(--pub-ink);
    font: 600 14px/1.42 var(--pub-body);
  }
  .login-leaf :global(input:not([type='hidden'])) {
    min-height: 51px;
    padding: 11px 14px;
    border-color: #a8b0a0;
    border-radius: 6px;
    background: #fffdf7;
    color: var(--pub-ink);
    caret-color: var(--pub-green);
    font: 400 16px/1.5 var(--pub-body);
  }
  .login-leaf :global(:focus-visible) {
    outline: 2px solid #805a23;
    outline-offset: 3px;
  }
  .login-leaf :global(.forgot) {
    justify-self: end;
    display: inline-flex;
    align-items: center;
    min-height: 36px;
    margin: -15px 0 -6px;
    padding: 4px 0;
    color: var(--pub-green);
    font-size: 13px;
    text-underline-offset: 0.22em;
  }
  .login-leaf :global(.pub-button) {
    justify-content: space-between;
    min-height: 51px;
    padding: 10px 18px;
    border-radius: 6px;
    background: #173a2c;
    color: var(--cover-cream);
    font: 400 22px/1.25 var(--pub-display);
  }
  .login-leaf :global(.pub-button:hover:not(:disabled)) {
    background: #234d39;
  }
  .login-leaf :global(.account-links) {
    gap: 6px;
    margin-top: 22px;
    padding-top: 16px;
    border-top: 1px solid var(--pub-line);
    font-size: 14px;
  }
  .login-leaf :global(.account-links a) {
    display: inline-flex;
    align-items: center;
    min-height: 33px;
    color: var(--pub-green);
  }
  @media (max-width: 820px) {
    .spread {
      grid-template-columns: minmax(0, 1fr);
      gap: 28px;
      padding: 124px clamp(32px, 8vw, 82px) 54px;
      align-content: center;
    }
    .introduction {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(80px, 26%);
      align-items: center;
      column-gap: 16px;
      padding: 0;
    }
    .introduction h1 {
      font-size: clamp(40px, 7.8vw, 64px);
    }
    .introduction p {
      grid-column: 1 / -1;
      margin-top: 16px;
      font-size: 16px;
    }
    .folder {
      grid-area: 1 / 2;
      justify-self: center;
      width: min(92%, 134px);
      margin: 0;
    }
    .login-leaf {
      justify-self: stretch;
      width: 100%;
      padding: 30px;
    }
  }
  @media (max-width: 600px) {
    .login-cover { padding: 8px; }
    .spread {
      min-height: calc(100svh - 16px);
      align-content: start;
      gap: 24px;
      padding: 105px 20px 36px;
      border-radius: 23px;
    }
    .introduction {
      column-gap: 12px;
    }
    .introduction p {
      font-size: 15px;
      line-height: 1.5;
    }
    .login-leaf { padding: 24px 21px 18px; }
  }
  @media (max-width: 355px) {
    .spread { padding-inline: 15px; }
    .introduction { grid-template-columns: minmax(0, 1fr) 64px; gap: 0 10px; }
    .introduction h1 { font-size: 34px; }
    .folder { width: 100%; }
    .login-leaf { padding-inline: 17px; }
  }
  @media (pointer: coarse) {
    .login-leaf :global(.forgot),
    .login-leaf :global(.account-links a) { min-height: 44px; }
  }
</style>
