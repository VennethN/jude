<script lang="ts">
  import { displayTitle } from '$lib/workspace/format';

  import { ArrowLeftRight, ArrowRight, Check, LayoutDashboard, Link2, MessageSquare, Unlink } from '@lucide/svelte';
  import type { Lang, Relation, Workspace } from '@jude/core/domain';
  import { casePath, clock, statuses } from '../records';
  import { type Pairing, type Kind as EvidenceKind } from '../graph';
  import { idOf, kindOf, mapRecords, relationOrder as relations, type IconKind as Kind } from './map-records';
  import ReviewMark from '../ReviewMark.svelte';
  import KindIcon from './GraphIcon.svelte';
  let {
    workspace,
    lang,
    members,
    picked,
    pairings,
    busy,
    onchoose,
    onpair,
    onupdate,
    onremove
  }: {
    workspace: Workspace;
    lang: Lang;
    members: Set<string>;
    picked: string[];
    pairings: Pairing[];
    busy: boolean;
    onchoose: (key: string, keyboard?: boolean) => void;
    onpair: (key: string) => void;
    onupdate: (id: string, body: { relation?: Relation; reviewed?: boolean }) => void;
    onremove: (id: string) => void;
  } = $props();
  let {
    t,
    l,
    statement,
    whereOf,
    hearing,
    finding,
    passage,
    doc,
    speaker,
    shortName,
    statementsOf,
    passagesOf,
    findingPath,
    groupName
  } = $derived(mapRecords(workspace, lang));
  const connection = (id: string) => workspace.connections.find((c) => c.id === id);
  function shortLabel(key: string) {
    const kind = kindOf(key);
    if (kind === 'finding') return l(finding(idOf(key))?.title);
    if (kind === 'statement') {
      const line = statement(idOf(key));
      if (line) return shortName(speaker(line.speakerId)).split(' ')[0] + ' ' + clock(line.t);
    }
    return whereOf(key);
  }
  // The case's own order: hearings and their lines, findings, documents and their pages.
  let order = $derived.by(() => {
    const keys = [
      ...workspace.hearings.flatMap((h) => statementsOf(h.id).map((s) => `statement:${s.id}`)),
      ...workspace.findings.map((f) => `finding:${f.id}`),
      ...workspace.documents.flatMap((d) => passagesOf(d.id).map((p) => `passage:${p.id}`))
    ];
    return new Map(keys.map((k, i) => [k, i]));
  });
  let sorted = $derived([...members].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)));
  const types: { kind: EvidenceKind; name: Parameters<typeof t>[0]; icon: Kind }[] = [
    { kind: 'statement', name: 'nav.hearings', icon: 'hearing' },
    { kind: 'finding', name: 'nav.findings', icon: 'finding' },
    { kind: 'passage', name: 'nav.documents', icon: 'document' }
  ];
  let name = $derived(groupName(members, picked));
  let own = $derived(pairings.filter((p) => members.has(p.from) && members.has(p.to)));
  const relOrder: Record<Relation, number> = { conflicts: 0, context: 1, supports: 2, related: 3 };
  // The chosen evidence's pairings first, then those still waiting for a decision.
  let ranked = $derived(
    [...own].sort(
      (a, b) =>
        Number(picked.includes(b.from) || picked.includes(b.to)) -
          Number(picked.includes(a.from) || picked.includes(a.to)) ||
        Number(a.source !== 'link' || a.reviewed) - Number(b.source !== 'link' || b.reviewed) ||
        relOrder[a.relation] - relOrder[b.relation]
    )
  );
  let sources = $derived.by(() => {
    const out: { key: string; kind: Kind; name: string }[] = [];
    for (const k of sorted) {
      if (kindOf(k) === 'statement') {
        const h = hearing(statement(idOf(k))?.hearingId);
        if (h && !out.some((s) => s.key === h.id))
          out.push({ key: h.id, kind: 'hearing', name: t('common.hearingN', { n: h.number }) });
      } else if (kindOf(k) === 'passage') {
        const d = doc(passage(idOf(k))?.docId ?? '');
        if (d && !out.some((s) => s.key === d.id)) out.push({ key: d.id, kind: 'document', name: displayTitle(d, lang) });
      }
    }
    return out;
  });
  let single = $derived(picked.length === 1 && kindOf(picked[0]) !== 'finding' ? picked[0] : null);

  const select = (key: string) => onchoose(key, true);
  const textOf = (key: string) =>
    (kindOf(key) === 'statement'
      ? statement(idOf(key))?.text
      : kindOf(key) === 'passage'
        ? passage(idOf(key))?.text
        : l(finding(idOf(key))?.title)) ?? '';
  const iconOf = (key: string): Kind =>
    kindOf(key) === 'statement' ? 'statement' : kindOf(key) === 'passage' ? 'passage' : 'finding';
  const speakerOf = (key: string) => (kindOf(key) === 'statement' ? statement(idOf(key))?.speakerId : undefined);

  let ask = $derived.by(() => {
    const query = new URLSearchParams();
    const items = [...new Set([...picked, ...sorted])].slice(0, 6);
    for (const key of items) query.append('context', key);
    return casePath(workspace) + '/assistant/new?' + query;
  });
</script>

<div class="group" data-tour="connections-group">
  <header class="group-head" data-tour="group-head">
    <h2 class="t-serif" tabindex="-1" id="connection-group-name">{name}</h2>
    <p class="small muted">{t('cx.group.items', { n: members.size })} · {t('cx.group.pairs', { n: own.length })}</p>
    {#if sources.length}
      <ul class="sources">
        {#each sources as s (s.key)}<li>
            <KindIcon speakers={workspace.speakers} kind={s.kind} size={13} />{s.name}
          </li>{/each}
      </ul>
    {/if}
    <div class="head-actions">
      {#if single}<button class="btn btn-sm" onclick={() => onpair(single!)}
          ><Link2 size={14} />{t('cx.group.pairWith')}</button
        >{/if}
      <a class="btn btn-sm" href={ask}><MessageSquare size={14} />{t('top.ask')}</a>
      {#if picked[0]}<a
          class="btn btn-sm"
          href={casePath(workspace) + '/findings?view=board&start=' + encodeURIComponent(picked[0])}
          ><LayoutDashboard size={14} />{t('fx.board')}</a
        >{/if}
    </div>
  </header>

  {#if members.size <= picked.length && !own.length}
    <p class="alone muted">{t('cx.group.alone')}</p>
  {/if}

  <section class="members" aria-label={t('cx.group.members')}>
    <h3 class="small-head">{t('cx.group.members')}</h3>
    {#each types as type (type.kind)}
      {@const list = sorted.filter((k) => kindOf(k) === type.kind)}
      {#if list.length}
        <h4 class="type">
          <KindIcon speakers={workspace.speakers} kind={type.icon} size={14} />{t(type.name)}
          <span class="tabular count">{list.length}</span>
        </h4>
        <ul class="list">
          {#each list as key (key)}
            {#if type.kind === 'finding'}
              {@const f = finding(idOf(key))}
              {#if f}
                <li class="finding-row" data-member={key} class:on={picked.includes(key)}>
                  <a
                    class="finding-link"
                    href={findingPath(f.id)}
                    aria-current={picked.includes(key) ? 'true' : undefined}
                  >
                    <ReviewMark status={f.status} reviewed={f.reviewed} size={20} />
                    <span class="finding-body">
                      <span class="finding-meta"
                        >{statuses[f.status][lang]}<span>·</span>{clock(statement(f.statementId)?.t ?? 0)}</span
                      >
                      <span class="clamp-2">{l(f.title)}</span>
                    </span>
                    <ArrowRight size={14} aria-hidden="true" />
                  </a>
                </li>
              {/if}
            {:else}
              <li class="member" data-member={key} class:on={picked.includes(key)}>
                <button
                  class="member-main"
                  aria-current={picked.includes(key) ? 'true' : undefined}
                  onclick={() => select(key)}
                >
                  <span class="where"
                    ><KindIcon
                      speakers={workspace.speakers}
                      kind={iconOf(key)}
                      speakerId={speakerOf(key)}
                      size={type.kind === 'statement' ? 19 : 13}
                    /><span>{whereOf(key)}</span></span
                  >
                  <span class="text clamp-2" lang="id" class:doc-text={type.kind === 'passage'}>{textOf(key)}</span>
                </button>
                <button
                  class="btn btn-sm btn-ghost btn-icon"
                  aria-label={t('cx.group.pairWith')}
                  title={t('cx.group.pairWith')}
                  onclick={() => onpair(key)}><Link2 size={15} /></button
                >
              </li>
            {/if}
          {/each}
        </ul>
      {/if}
    {/each}
  </section>

  {#if ranked.length}
    <section class="pairings" data-tour="pairings" aria-label={t('cx.group.pairings')}>
      <h3 class="small-head">{t('cx.group.pairings')} <span class="tabular count">{ranked.length}</span></h3>
      <p class="xsmall muted hint">{t('cx.group.pairHint')}</p>
      <ul class="list">
        {#each ranked as pr (pr.key)}
          {@const c = pr.connectionId ? connection(pr.connectionId) : undefined}
          <li class="pair" data-pair={pr.key} class:mine={picked.includes(pr.from) || picked.includes(pr.to)}>
            <div class="ends">
              <button class="end" onclick={() => select(pr.from)}
                ><KindIcon
                  speakers={workspace.speakers}
                  kind={iconOf(pr.from)}
                  speakerId={speakerOf(pr.from)}
                  size={kindOf(pr.from) === 'statement' ? 17 : 13}
                /><span>{shortLabel(pr.from)}</span></button
              >
              <span class="between" data-rel={pr.relation} aria-hidden="true"><ArrowLeftRight size={14} /></span>
              <button class="end" onclick={() => select(pr.to)}
                ><KindIcon
                  speakers={workspace.speakers}
                  kind={iconOf(pr.to)}
                  speakerId={speakerOf(pr.to)}
                  size={kindOf(pr.to) === 'statement' ? 17 : 13}
                /><span>{shortLabel(pr.to)}</span></button
              >
            </div>
            {#if pr.source === 'link' && c}
              <div class="how">
                <label class="sr-only" for="rel-{pr.key}">{t('cx.group.relation')}</label>
                <select
                  id="rel-{pr.key}"
                  class="rel-select"
                  data-rel={c.relation}
                  value={c.relation}
                  disabled={busy}
                  onchange={(e) => onupdate(c.id, { relation: e.currentTarget.value as Relation })}
                >
                  {#each relations as r (r)}<option value={r}>{t(`rel.${r}`)}</option>{/each}
                </select>
                <span class="state" class:waiting={!c.reviewed}
                  >{#if c.reviewed}<Check size={13} />{/if}{c.reviewed
                    ? t('cx.confirmed')
                    : t('cx.suggested')}</span
                >
              </div>
              {#if c.why}<p class="why xsmall muted">{l(c.why)}</p>{/if}
              <div class="acts">
                <button
                  class="btn btn-sm"
                  class:btn-primary={!c.reviewed}
                  disabled={busy}
                  onclick={() => onupdate(c.id, { reviewed: !c.reviewed })}
                  >{c.reviewed ? t('cx.group.unconfirm') : t('cx.group.confirm')}</button
                >
                <button class="btn btn-sm btn-ghost" disabled={busy} onclick={() => onremove(c.id)}
                  ><Unlink size={14} />{t('cx.group.unpair')}</button
                >
              </div>
            {:else}
              <div class="how">
                <span class="relation-name" data-rel={pr.relation}
                  >{t(('rel.' + pr.relation) as `rel.${Relation}`)}</span
                >
                <span class="state">{pr.source === 'about' ? t('cx.group.about') : t('cx.group.cited')}</span>
                {#if pr.findingId}<a class="link-btn manage" href={findingPath(pr.findingId)}
                    >{t('cx.group.manage')}<ArrowRight size={13} /></a
                  >{/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>

<style>
  /* Single columns that may shrink: long names ellipsize instead of widening the panel. */
  .group,
  .group-head,
  .list,
  .pair,
  .member-main {
    grid-template-columns: minmax(0, 1fr);
  }
  .finding-row {
    border: 1px solid var(--line);
    border-radius: var(--radius-action);
  }
  .finding-link {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 48px;
    padding: 8px 10px;
    border-radius: inherit;
    color: var(--ink);
    text-decoration: none;
  }
  .finding-link:hover {
    background: var(--sunken);
  }
  .finding-body {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
    font-size: 14px;
    font-weight: 500;
    line-height: 1.35;
  }
  .finding-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    color: var(--muted);
    font-size: 12px;
    font-weight: 600;
    line-height: 1.5;
  }
  .finding-link > :global(svg) {
    flex: none;
    color: var(--muted);
  }
  .group {
    display: grid;
    gap: 18px;
    padding: 18px;
    border: 1px solid var(--line);
    border-radius: var(--radius-surface);
    background: var(--surface);
  }
  .group-head {
    display: grid;
    gap: 8px;
  }
  .group-head h2 {
    font-size: 24px;
    line-height: 1.2;
  }
  .group-head p {
    margin: 0;
  }
  .sources {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .sources li {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border-radius: 20px;
    background: var(--sunken);
    font-size: 12px;
    color: var(--ink);
  }
  .head-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .alone {
    margin: 0;
    padding: 12px 14px;
    border-radius: var(--radius-action);
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--line);
  }
  .small-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-strong);
  }
  .count {
    color: var(--muted);
    font-weight: 500;
  }
  .type {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 10px 0 4px;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--muted);
  }
  .list {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .member {
    display: flex;
    align-items: flex-start;
    gap: 4px;
    border: 1px solid var(--line);
    border-radius: var(--radius-action);
    transition:
      border-color var(--dur-fast) var(--ease-out),
      background-color var(--dur-fast) var(--ease-out);
  }
  /* The chosen evidence: tinted with a firm edge, the same selection as the findings queue. */
  .member.on,
  .finding-row.on {
    border-color: var(--selected-line);
    box-shadow: inset 0 0 0 1px var(--selected-line);
    background: var(--selected);
    border-radius: var(--radius-action);
  }
  .member-main {
    flex: 1;
    display: grid;
    gap: 4px;
    min-width: 0;
    padding: 8px 10px;
    text-align: left;
    border-radius: var(--radius-control);
  }
  .member-main:hover {
    background: var(--sunken);
  }
  .member .btn-icon {
    margin: 6px 6px 0 0;
  }
  .where {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ink-strong);
  }
  .where span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .member .text {
    font-size: 13.5px;
    line-height: 1.45;
    color: var(--ink);
  }
  .hint {
    margin: 0 0 8px;
  }
  .pair {
    display: grid;
    gap: 6px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius-control);
  }
  .pair.mine {
    border-color: var(--line-strong);
    background: var(--surface-2);
  }
  .ends {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
  }
  .end {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    padding: 2px 6px 2px 2px;
    border-radius: var(--radius-control);
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ink-strong);
    text-align: left;
  }
  .end span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .end:hover {
    background: var(--sunken);
  }
  .between {
    display: inline-flex;
    color: var(--rel-related);
  }
  .between[data-rel='conflicts'] {
    color: var(--rel-conflicts-ink);
  }
  .between[data-rel='context'] {
    color: var(--rel-context-ink);
  }
  .between[data-rel='supports'] {
    color: var(--rel-supports-ink);
  }
  .how {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    font-size: 12.5px;
  }
  .rel-select {
    min-height: 32px;
    padding: 4px 28px 4px 10px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-control);
    background-color: var(--surface);
    color: var(--ink-strong);
    font: inherit;
    font-weight: 600;
  }
  .rel-select[data-rel='conflicts'] {
    color: var(--rel-conflicts-ink);
  }
  .rel-select[data-rel='context'] {
    color: var(--rel-context-ink);
  }
  .rel-select[data-rel='supports'] {
    color: var(--rel-supports-ink);
  }
  .state {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--muted);
  }
  .state.waiting {
    color: var(--sand-ink);
  }
  .manage {
    margin-left: auto;
  }
  .why {
    margin: 0;
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
</style>
