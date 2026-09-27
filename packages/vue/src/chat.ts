import { defineComponent, h, nextTick, ref, watch } from 'vue';
import type { PropType } from 'vue';
import type { CopilotMessage } from '@gixcopilot/headless';
import { useCopilot } from './copilot.js';

function textOf(message: CopilotMessage): string {
  return message.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

let nextUid = 0;

/**
 * A minimal accessible chat surface over the nearest copilot: a polite live log, a labelled
 * composer (Enter sends, Shift+Enter adds a line), Stop while busy, Retry on error and pending
 * approvals. Text is rendered as text, never as HTML. Style it with `@gixcopilot/vue/styles.css`
 * or your own CSS; for a fully custom UI use `useCopilot()` directly.
 */
export const CopilotChat = defineComponent({
  name: 'CopilotChat',
  props: {
    /** Accessible name of the conversation log. */
    label: { type: String, default: 'Copilot conversation' },
    placeholder: { type: String, default: 'Ask the copilot…' },
    /** Text direction; `auto` (default) follows the document. */
    direction: { type: String as PropType<'ltr' | 'rtl' | 'auto'>, default: 'auto' },
  },
  setup(props) {
    const copilot = useCopilot();
    const uid = ++nextUid;
    const draft = ref('');
    const input = ref<HTMLTextAreaElement | null>(null);
    const log = ref<HTMLElement | null>(null);

    watch(
      () => copilot.messages.value,
      () =>
        void nextTick(() => {
          if (log.value) log.value.scrollTop = log.value.scrollHeight;
        }),
    );

    const send = (event?: Event): void => {
      event?.preventDefault();
      if (copilot.sendMessage(draft.value)) draft.value = '';
      input.value?.focus();
    };

    return () =>
      h('div', { class: 'aicopilot-chat', dir: props.direction === 'auto' ? undefined : props.direction }, [
        h(
          'div',
          { ref: log, class: 'aicopilot-chat__log', role: 'log', 'aria-live': 'polite', 'aria-label': props.label, 'aria-busy': copilot.busy.value },
          [
            ...copilot.messages.value.map((message) =>
              h('div', { key: message.id, class: ['aicopilot-chat__message', message.role === 'user' ? 'aicopilot-chat__message--user' : 'aicopilot-chat__message--assistant'] }, [
                h('span', { class: 'aicopilot-visually-hidden' }, message.role === 'user' ? 'You: ' : 'Assistant: '),
                textOf(message),
              ]),
            ),
            ...copilot.pendingApprovals.value.map((approval) =>
              h('div', { key: approval.approvalId, class: 'aicopilot-chat__approval', role: 'group', 'aria-label': `Approval required: ${approval.summary}` }, [
                h('p', approval.summary),
                h('button', { type: 'button', onClick: () => void copilot.approveAction(approval.approvalId) }, 'Approve'),
                h('button', { type: 'button', onClick: () => void copilot.rejectAction(approval.approvalId) }, 'Reject'),
              ]),
            ),
          ],
        ),
        copilot.error.value
          ? h('div', { class: 'aicopilot-chat__error', role: 'alert' }, [
              copilot.error.value.message,
              ' ',
              h('button', { type: 'button', onClick: () => copilot.retry() }, 'Retry'),
            ])
          : null,
        h('form', { class: 'aicopilot-chat__composer', onSubmit: send }, [
          h('label', { class: 'aicopilot-visually-hidden', for: `aicopilot-input-${uid}` }, 'Message'),
          h('textarea', {
            ref: input,
            id: `aicopilot-input-${uid}`,
            placeholder: props.placeholder,
            value: draft.value,
            onInput: (event: Event) => {
              draft.value = (event.target as HTMLTextAreaElement).value;
            },
            onKeydown: (event: KeyboardEvent) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) send(event);
            },
          }),
          copilot.busy.value
            ? h('button', { type: 'button', onClick: () => copilot.stop() }, 'Stop')
            : h('button', { type: 'submit' }, 'Send'),
        ]),
      ]);
  },
});
