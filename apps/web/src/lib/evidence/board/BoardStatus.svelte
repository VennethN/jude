<script lang="ts">
  import type { Lang, Status } from '@jude/core/domain';
  import { statuses } from '../records';
  let { status, lang }: { status: Status; lang: Lang } = $props();
</script>

<span class="status" data-status={status}>{statuses[status][lang]}</span>

<style>
  .status {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border-radius: 4px;
    background: var(--wash);
    color: var(--muted);
    padding: 2px 5px;
    font: 600 0.71rem/1.25 var(--sans);
  }
  .status::before {
    content: '';
    width: 7px;
    height: 7px;
    border: 2px solid currentcolor;
    border-radius: 50%;
  }
  [data-status='potential_inconsistency'] {
    background: #f2dba8;
    color: #694919;
  }
  [data-status='potential_inconsistency']::before {
    border: 0;
    border-radius: 0;
    background: #a66e21;
    transform: rotate(45deg);
  }
  [data-status='context_needed'] {
    background: #e2dfee;
    color: #4a4166;
  }
  [data-status='supported'] {
    background: #dce6da;
    color: #365244;
  }
</style>
