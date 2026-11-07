<script lang="ts">
  import { findingQuestion } from '$lib/workspace/format';
  import { onMount, tick } from 'svelte';
  import { ArrowRight, ArrowUpRight, ChevronDown, ChevronUp, ClipboardCopy, FileText, X } from '@lucide/svelte';
  import type { Finding, Lang, Reply, Workspace } from '@jude/core/domain';
  import Dialog from '../Dialog.svelte';
  import SheetHandle from '../SheetHandle.svelte';
  import Match from '$lib/evidence/Match.svelte';
  import StatusChip from '$lib/evidence/StatusChip.svelte';
  import SourceAvailability from '$lib/evidence/SourceAvailability.svelte';
  import { casePath, local, sourceOf } from '$lib/evidence/records';
  import { timecode } from '../format';
  import { voice } from './people';
  let {
    workspace: w,
    inline,
    lang,
    finding,
    reply,
    findings,
    select,
    close
  }: {
    workspace: Workspace;
    inline: boolean;
    lang: Lang;
    finding?: Finding;
    reply?: Reply;
    findings: Finding[];
    select: (id: string) => void;
    close: () => void;
  } = $props();
  let en = $derived(lang === 'en'),
    subject = $derived(finding ?? reply),
    statement = $derived(w.statements.find((s) => s.id === subject?.statementId)),
    first = $derived(finding?.sources[0]),
    source = $derived(first ? sourceOf(w, { kind: 'passage', id: first.passageId }, lang) : undefined);
  const kind = $derived(finding ? (en ? 'Finding' : 'Temuan') : (en ? 'Response' : 'Tanggapan'));
  const speaker = $derived(statement ? voice(w.speakers, statement.speakerId, lang) : undefined);
  function excerpt(text: string, match?: string) {
    const at = match ? text.toLocaleLowerCase().indexOf(match.toLocaleLowerCase()) : -1;
    if (at < 0 || !match) return text;
    const before = [...text.slice(0,at).matchAll(/\S+/gu)];
    const after = [...text.slice(at+match.length).matchAll(/\S+/gu)];
    const start = before.length > 8 ? before.at(-8)!.index : 0;
    const end = after.length > 8 ? at + match.length + after[7].index + after[7][0].length : text.length;
    return (start ? '…' : '') + text.slice(start,end) + (end < text.length ? '…' : '');
  }
  let previous = $derived(finding ? findings.findIndex((f) => f.id === finding?.id) : -1);
  let heading = $state<HTMLHeadingElement>(), status = $state('');
  onMount(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => { if (before?.isConnected) before.focus({preventScroll:true}); };
  });
  $effect(() => {
    if (subject) {
      status = '';
      void tick().then(() => heading?.focus({ preventScroll: true }));
    }
  });
  function step(delta: number) {
    const next = findings[previous + delta];
    if (finding && next) select(next.id);
  }
  function keys(e: KeyboardEvent) {
    if (
      e.metaKey ||
      e.altKey ||
      e.ctrlKey ||
      /input|textarea|select/i.test((e.target as HTMLElement)?.tagName)
    )
      return;
    if (e.key === 'Escape' && inline) {
      e.preventDefault();
      close();
    } else if (finding && ['j', 'k'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      step(e.key.toLowerCase() === 'j' ? 1 : -1);
    }
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      status = en ? 'Copied.' : 'Disalin.';
    } catch {
      status = en ? 'Select and copy the text manually.' : 'Pilih dan salin teks secara manual.';
    }
  }
</script>

<svelte:window onkeydown={keys} />
{#snippet content()}
  <header class="look-head">
    {#if !inline}<SheetHandle dismiss={close}/>{/if}
    <strong>{kind}</strong>
    <div>
      {#if finding && findings.length > 1}<span class="sequence">{previous+1} {en ? 'of' : 'dari'} {findings.length}</span><button
          class="icon-button"
          aria-label={en ? 'Previous finding' : 'Temuan sebelumnya'}
          disabled={previous <= 0}
          onclick={() => step(-1)}><ChevronUp size={16} /></button
        ><button
          class="icon-button"
          aria-label={en ? 'Next finding' : 'Temuan berikutnya'}
          disabled={previous >= findings.length - 1}
          onclick={() => step(1)}><ChevronDown size={16} /></button
        >{/if}<button
        class="icon-button"
        aria-label={finding ? (en ? 'Close finding' : 'Tutup temuan') : (en ? 'Close response' : 'Tutup tanggapan')}
        onclick={close}><X size={17} /></button
      >
    </div>
  </header>
  <div class="brief-body" data-status={finding?.status} class:loud={finding?.status === 'potential_inconsistency'}>
  {#if finding}
    <div class="headline">
      <div class="statusline"><StatusChip status={finding.status} {lang}/>
        {#if statement}<time>{timecode(statement.t)}</time>{/if}
        {#if finding.reviewed}<span class="reviewed">{en ? 'Reviewed' : 'Sudah dicek'}</span>{/if}
      </div>
      <h2 id="brief-title" tabindex="-1" bind:this={heading}>{local(finding.title, lang)}</h2>
    </div>
    <section class="question">
      <h3>{en ? 'You could ask' : 'Bisa ditanyakan'}</h3>
      <p lang={finding.questionTranslation ? lang : 'id'}>{findingQuestion(finding, lang)}</p>
      {#if en && !finding.questionTranslation}<small>Saved courtroom draft · original wording</small>{/if}
      <button class="text-action" onclick={() => copy(findingQuestion(finding, lang))}><ClipboardCopy size={13}/>{en ? 'Copy question' : 'Salin pertanyaan'}</button>
    </section>
    {#if statement || source}<div class="source-pair">
      {#if statement && speaker}<section class="comparison">
        <h3><span class="speaker-dot" data-tone={speaker.role} aria-hidden="true">{speaker.letters}</span>{en ? 'In court' : 'Di sidang'} · {speaker.name}</h3>
        <p>“<Match text={excerpt(statement.text,finding.said)} term={finding.said}/>”</p>
      </section>{/if}
      {#if source}<section class="comparison written"><h3><a href={source.href}><FileText size={13}/>{source.label}<ArrowUpRight size={12}/></a></h3>
        <p>“<Match text={excerpt(source.text,first?.match)} term={first?.match}/>”</p>
      </section>{/if}
    </div>{/if}
    <SourceAvailability {finding} {lang}/>
    <a class="button primary detail-link" href={casePath(w) + '/findings/' + encodeURIComponent(finding.id)}>{en ? 'Details in Findings' : 'Detail di Temuan'}<ArrowRight size={15}/></a>
  {:else if reply}
    <p class="folio note">
      {en ? 'For counsel' : 'Untuk kuasa hukum'}{statement ? ' · ' + timecode(statement.t) : ''}
    </p>
    <h2 id="brief-title" tabindex="-1" bind:this={heading}>{en ? 'Your response' : 'Tanggapan Anda'}</h2>
    {#if statement}<blockquote class="trigger">“{statement.text}”</blockquote>{/if}
    <ol class="suggestions">
      {#each [...reply.suggestions].sort((a, b) => b.confidence - a.confidence) as option}
        {@const basis = option.basis.kind === 'procedure' ? undefined : sourceOf(w, option.basis, lang)}
        <li>
          <p lang={option.textTranslation ? lang : 'id'}>{option.textTranslation?.[lang] ?? option.text}</p>
          {#if !option.textTranslation}<small>{en ? 'Saved courtroom draft · original wording' : 'Draf persidangan tersimpan · redaksi asli'}</small>{/if}
          <small>{local(option.why, lang)}</small>
          <div>
            {#if basis}<a href={basis.href}>{basis.label}<ArrowUpRight size={12} /></a>{:else}<span
                >{en ? 'Court procedure' : 'Tata cara persidangan'}</span
              >{/if}<span>{Math.round(option.confidence * 100)}% · {en ? 'fit' : 'kecocokan'}</span>
          </div>
          <button class="text-action" onclick={() => copy(option.textTranslation?.[lang] ?? option.text)}
            ><ClipboardCopy size={14} />{en ? 'Copy response' : 'Salin tanggapan'}</button
          >
        </li>
      {/each}
    </ol>
  {/if}
  {#if status}<p class="small muted" role="status">{status}</p>{/if}
  </div>
{/snippet}
{#if inline}<aside class="quick" aria-label={kind}>{@render content()}</aside>
{:else}<Dialog title={kind} {lang} {close} side>
  <div class="quick overlay">{@render content()}</div>
</Dialog>{/if}

<style>
  .quick { display:flex; flex-direction:column; min-width:0; color:var(--ink-strong,var(--ink)); background:var(--surface); }
  aside.quick { position:sticky; top:var(--hearing-sticky); max-height:calc(100dvh - var(--hearing-sticky) - 12px); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
  :global(dialog.side:has(.quick.overlay)) { width:min(560px,100%); }
  .quick.overlay { height:100%; }
  .look-head,.look-head > div,.statusline,.comparison h3,.comparison h3 a,.text-action,.suggestions li>div { display:flex; align-items:center; gap:6px; }
  .look-head { position:relative; flex:none; min-height:54px; padding:8px 8px 8px 18px; border-bottom:1px solid var(--line); }
  .look-head strong { flex:1; font:600 14px/1.4 var(--sans); }
  .look-head .icon-button { min-height:36px; width:36px; padding:0; border:0; background:transparent; }
  .look-head .icon-button:last-child { margin-left:3px; border-left:1px solid var(--line); border-radius:0; }
  .look-head .icon-button:hover { background:var(--surface-2,var(--wash)); }
  .look-head .icon-button:disabled { opacity:.4; }
  .sequence,.statusline time { color:var(--muted); font:400 12.5px/1.45 var(--sans); font-variant-numeric:tabular-nums; }
  .brief-body { display:grid; grid-auto-rows:max-content; align-content:start; gap:16px; min-width:0; overflow:auto; padding:20px 22px 24px; overscroll-behavior:contain; }
  .headline { display:grid; gap:8px; }
  .statusline { gap:6px 10px; flex-wrap:wrap; }
  .reviewed { padding:3px 7px; background:var(--selected,var(--wash)); border-radius:4px; font:600 11px var(--sans); }
  .quick h2 { margin:0; font:400 clamp(20px,2vw,24px)/1.22 var(--display); letter-spacing:-.005em; text-wrap:pretty; }
  .quick h2:focus { outline:none; }
  .question,.comparison { display:grid; gap:6px; align-content:start; }
  .question { padding:14px 16px 12px; background:var(--selected,var(--wash)); border-radius:12px; }
  .question h3,.comparison h3,.note { margin:0; color:var(--muted); font:600 11.5px/1.5 var(--sans); letter-spacing:.01em; }
  .question h3 { color:color-mix(in srgb,var(--muted) 65%,var(--ink-strong)); font-size:12px; }
  .question p { margin:0; color:var(--ink-strong,var(--ink)); font:400 18.5px/1.38 var(--display); text-wrap:pretty; }
  .text-action { justify-self:start; gap:5px; min-height:28px; border:0; padding:1px 0; text-decoration:underline; text-decoration-color:var(--line); text-underline-offset:3px; color:var(--ink-strong,var(--ink)); background:transparent; font:600 12px/1.45 var(--sans); }
  .text-action:hover,.written a:hover { text-decoration-color:currentColor; }
  .source-pair { display:grid; border:1px solid var(--line); border-radius:12px; background:var(--surface-2,var(--wash)); overflow:hidden; }
  .loud .source-pair { border-color:color-mix(in srgb,var(--alert) 34%,var(--line)); }
  .comparison { padding:12px 14px; min-width:0; }
  .comparison + .comparison { border-top:1px solid var(--line); }
  .loud .comparison + .comparison { border-color:color-mix(in srgb,var(--alert) 22%,var(--line)); }
  .comparison p { margin:0; overflow-wrap:anywhere; color:var(--ink-strong,var(--ink)); font:400 15px/1.5 var(--sans); }
  .written p { font-family:var(--mono); }
  .written a { color:var(--muted); text-decoration:underline; text-decoration-color:transparent; text-underline-offset:3px; }
  .speaker-dot { flex:none; display:grid; place-items:center; width:20px; height:20px; border-radius:50%; background:var(--speaker-paper,var(--role-unknown-soft)); color:var(--speaker-ink,var(--role-unknown-ink)); font:600 10px/1 var(--sans); }
  .speaker-dot[data-tone=witness] { --speaker-paper:var(--role-witness-soft); --speaker-ink:var(--role-witness-ink); }
  .speaker-dot[data-tone=counsel] { --speaker-paper:var(--role-counsel-soft); --speaker-ink:var(--role-counsel-ink); }
  .speaker-dot[data-tone=judge], .speaker-dot[data-tone=judge_member] { --speaker-paper:var(--role-judge-soft); --speaker-ink:var(--role-judge-ink); }
  .speaker-dot[data-tone=opposing] { --speaker-paper:var(--role-opposing-soft); --speaker-ink:var(--role-opposing-ink); }
  .speaker-dot[data-tone=party] { --speaker-paper:var(--role-party-soft); --speaker-ink:var(--role-party-ink); }
  .detail-link { min-height:42px; font-size:13px; }
  aside.quick:has(.brief-body[data-status]) { box-shadow:var(--shadow-raise); }
  .look-head:has(+ [data-status]) { min-height:54px; padding-block:8px; }
  .look-head:has(+ [data-status]) .icon-button { height:36px; min-width:36px; width:36px; }
  .brief-body[data-status] { --phrase:var(--alert); }
  .brief-body[data-status='supported'] { --phrase:var(--st-supported-dot); }
  .brief-body[data-status='context_needed'] { --phrase:var(--st-context-dot); }
  .brief-body[data-status='insufficient_evidence'] { --phrase:var(--st-insufficient-dot); }
  [data-status] h2 { text-wrap:balance; }
  [data-status] .question h3 { font-size:11.5px; color:var(--muted); }
  [data-status] .question .text-action { position:relative; min-height:26px; font-size:13px; }
  [data-status] .source-pair { border-color:color-mix(in srgb,var(--phrase) 30%,var(--line)); }
  [data-status] .speaker-dot { width:18px; height:18px; font-size:8px; color:var(--on-accent); background:var(--speaker-ink,var(--role-unknown-ink)); }
  [data-status] :global(mark.ev-mark) { padding:0 1px; border-radius:2px; color:inherit; background:color-mix(in srgb,var(--phrase) 22%,transparent); box-shadow:inset 0 -2px var(--phrase); box-decoration-break:clone; -webkit-box-decoration-break:clone; }
  [data-status] .detail-link { border-radius:6px; box-shadow:var(--shadow-raise); }
  :global([data-theme='night']) [data-status] .speaker-dot { color:var(--speaker-ink,var(--role-unknown-ink)); background:var(--speaker-paper,var(--role-unknown-soft)); }
  .trigger,.suggestions li { padding:10px 0; border-top:1px solid var(--line); }
  .trigger,.suggestions p { margin:0; line-height:1.5; }
  .suggestions { padding-left:18px; }
  .suggestions li > div { justify-content:space-between; flex-wrap:wrap; margin-top:5px; }
  @media(max-width:719px) {
    .quick.overlay .look-head { min-height:70px; padding:18px 10px 7px 18px; }
    .look-head .icon-button,.text-action { min-height:44px; }
    .look-head:has(+ [data-status]) .icon-button { min-width:44px; min-height:44px; }
    [data-status] .question .text-action::after { content:''; position:absolute; inset:-9px -4px; }
  }
</style>
