<script lang="ts">
  import { ArrowRight, ChevronRight } from '@lucide/svelte';
  import type { Finding, Lang, Workspace } from '@jude/core/domain';
  import ReviewMark from './ReviewMark.svelte';
  import { casePath, clock, local, meaningful, statuses } from './records';

  let { workspace, finding, lang, variant = 'row', showHearing = false, selected = false, onPreview, onFollow }: {
    workspace: Workspace;
    finding: Finding;
    lang: Lang;
    variant?: 'row' | 'pill' | 'lead';
    showHearing?: boolean;
    selected?: boolean;
    onPreview?: (finding: Finding) => void;
    onFollow?: () => void;
  } = $props();

  const status = $derived(statuses[finding.status][lang]);
  const title = $derived(local(finding.title, lang));
  const statement = $derived(workspace.statements.find(line => line.id === finding.statementId));
  const hearing = $derived(showHearing && workspace.hearings.find(item => item.id === finding.hearingId));
  const quiet = $derived(finding.reviewed || !meaningful(finding.status));

  function open(event: MouseEvent) {
    if (event.button || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (onPreview) {
      event.preventDefault();
      onPreview(finding);
    } else {
      onFollow?.();
    }
  }
</script>

<a class="finding-link" class:lead={variant === 'lead'} class:fresh={variant === 'lead' && finding.isNew} class:pill={variant === 'pill'} class:quiet
  class:loud={!quiet && finding.status === 'potential_inconsistency'} data-fid={finding.id}
  aria-current={selected ? 'true' : undefined} title={variant === 'pill' ? status + ' · ' + title : undefined}
  href={casePath(workspace) + '/findings/' + encodeURIComponent(finding.id)} onclick={open}>
  <ReviewMark status={finding.status} reviewed={finding.reviewed} size={variant === 'lead' ? 24 : 20}/>
  {#if variant === 'pill'}
    <span class="pill-label">{status} · {title}</span>
  {:else}
    <span class="body">
      <span class="meta"><span>{status}</span>{#if statement}<span>{clock(statement.t)}</span>{/if}{#if hearing}<span>{lang === 'id' ? 'Sidang' : 'Hearing'} {hearing.number}</span>{/if}</span>
      <span class="finding-title">{title}</span>
      {#if variant === 'lead' && finding.question}<span class="suggested"><b>{lang === 'id' ? 'Bisa ditanyakan' : 'You could ask'}</b> <span lang="id">{finding.question}</span></span>{/if}
    </span>
  {/if}
  {#if variant === 'lead'}<span class="quick-label">{lang === 'id' ? 'Lihat temuan' : 'View finding'}</span>{/if}
  {#if onPreview}<ChevronRight size={variant === 'pill' ? 12 : 14} aria-hidden="true"/>
  {:else}<ArrowRight size={variant === 'pill' ? 12 : 14} aria-hidden="true"/>{/if}
</a>

<style>
  .finding-link {
    --tone: var(--st-context-dot);
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    min-height: 48px;
    padding: 8px 10px;
    border-radius: 8px;
    color: var(--ink-strong);
    text-decoration: none;
    transition: background-color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
  }
  .finding-link.loud { --tone: var(--alert); }
  .finding-link.quiet { --tone: var(--line-strong); }
  .finding-link:hover { background: var(--sunken); }
  .finding-link[aria-current] { background: var(--selected); }
  .finding-link:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .body { flex: 1; min-width: 0; display: grid; gap: 2px; }
  .meta { display: flex; flex-wrap: wrap; gap: 0 8px; color: var(--muted); font: 600 12px/1.5 var(--sans); font-variant-numeric: tabular-nums; }
  .meta > span + span::before { content: '·'; margin-right: 8px; }
  .finding-title { display: -webkit-box; overflow: hidden; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; font: 500 14px/1.35 var(--sans); }
  .finding-link > :global(svg) { flex: none; color: var(--muted); }
  .lead { padding:12px 16px; border:1px solid color-mix(in srgb,var(--tone) 45%,var(--line)); border-radius:12px; background:color-mix(in srgb,var(--tone) 7%,var(--surface)); }
  .lead.fresh { background:color-mix(in srgb,var(--tone) 14%,var(--surface)); }
  .lead:hover,.lead[aria-current] { border-color:var(--tone); }
  .lead[aria-current] { box-shadow:inset 0 0 0 1px var(--tone); }
  .lead .body { gap:3px; }
  .lead .finding-title { display:block; font:400 19px/1.3 var(--display); }
  .suggested { margin-top:2px; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; line-clamp:2; overflow:hidden; text-wrap:pretty; color:var(--ink); font:400 13.5px/1.45 var(--sans); }
  .suggested b { color:var(--ink-strong); font-weight:600; }
  .suggested b::after { content:':'; }
  .quick-label { flex:none; font:600 13px/1.4 var(--sans); }
  @media(max-width:560px) { .lead { padding:10px 12px; } .lead .finding-title { font-size:17px; } .quick-label { display:none; } }
  .pill { width: fit-content; max-width: 100%; min-height: 30px; padding: 4px 10px 4px 4px; gap: 8px; border: 1px solid color-mix(in srgb,var(--tone) 40%,var(--line)); border-radius: 999px; background: color-mix(in srgb,var(--tone) 14%,var(--surface)); font: 600 12.5px/1.4 var(--sans); }
  .pill.quiet { background: var(--surface); color: var(--muted); font-weight: 500; }
  .pill:hover,.pill[aria-current] { border-color: var(--tone); }
  .pill-label { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
</style>
