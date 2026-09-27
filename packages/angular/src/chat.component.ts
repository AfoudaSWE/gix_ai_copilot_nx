import { ChangeDetectionStrategy, Component, Input, ViewChild, computed, inject, signal } from '@angular/core';
import type { ElementRef } from '@angular/core';
import type { CopilotMessage } from '@gixcopilot/headless';
import { CopilotService } from './copilot.service.js';
import { GenerativeUiOutletComponent } from './generative-ui.js';

function textOf(message: CopilotMessage): string {
  return message.content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('');
}

/**
 * A minimal accessible chat surface over `CopilotService`: a polite live log of messages,
 * a labelled composer, stop while busy, retry on error, pending approvals and inline trusted
 * generative UI. Text is rendered with Angular interpolation (escaped), never as HTML. For a
 * fully custom UI, inject `CopilotService` and use its signals directly.
 */
@Component({
  selector: 'aicopilot-chat',
  imports: [GenerativeUiOutletComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'aicopilot-chat', '[attr.dir]': 'dir()' },
  styles: `
    :host { display: flex; flex-direction: column; gap: 0.5rem; font: inherit; color: var(--aicopilot-fg, CanvasText); }
    .log { display: flex; flex-direction: column; gap: 0.5rem; overflow-y: auto; min-height: 8rem; }
    .message { padding: 0.5rem 0.75rem; border-radius: 0.5rem; max-inline-size: 85%; white-space: pre-wrap; overflow-wrap: anywhere; }
    .user { align-self: flex-end; background: var(--aicopilot-user-bg, #e6effd); }
    .assistant { align-self: flex-start; background: var(--aicopilot-assistant-bg, #f3f4f6); }
    form { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    textarea { flex: 1 1 12rem; min-block-size: 2.5rem; font: inherit; }
    button { font: inherit; min-block-size: 2.5rem; min-inline-size: 2.75rem; }
    :focus-visible { outline: 2px solid var(--aicopilot-focus, #1a56db); outline-offset: 2px; }
    .error { color: var(--aicopilot-error, #b42318); }
    .visually-hidden { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto; transition: none; } }
  `,
  template: `
    <div class="log" role="log" aria-live="polite" [attr.aria-label]="label()" [attr.aria-busy]="copilot.busy()">
      @for (message of copilot.messages(); track message.id) {
        <div class="message" [class.user]="message.role === 'user'" [class.assistant]="message.role !== 'user'">
          <span class="visually-hidden">{{ message.role === 'user' ? 'You' : 'Assistant' }}:</span>{{ text(message) }}
        </div>
      }
      @for (request of copilot.generativeUiRequests(); track request.id) {
        <aicopilot-generative-ui [request]="request" />
      }
      @for (approval of copilot.pendingApprovals(); track approval.approvalId) {
        <div class="approval" role="group" [attr.aria-label]="'Approval required: ' + approval.summary">
          <p>{{ approval.summary }}</p>
          <button type="button" (click)="copilot.approveAction(approval.approvalId)">Approve</button>
          <button type="button" (click)="copilot.rejectAction(approval.approvalId)">Reject</button>
        </div>
      }
    </div>
    @if (copilot.error(); as error) {
      <div class="error" role="alert">
        {{ error.message }}
        <button type="button" (click)="copilot.retry()">Retry</button>
      </div>
    }
    <form (submit)="send($event)">
      <label class="visually-hidden" for="aicopilot-input-{{ uid }}">Message</label>
      <textarea
        #input
        id="aicopilot-input-{{ uid }}"
        [attr.placeholder]="placeholder()"
        (keydown.enter)="onEnter($event)"
      ></textarea>
      @if (copilot.busy()) {
        <button type="button" (click)="copilot.stop()">Stop</button>
      } @else {
        <button type="submit">Send</button>
      }
    </form>
  `,
})
export class CopilotChatComponent {
  private static nextUid = 0;
  protected readonly copilot = inject(CopilotService);
  protected readonly uid = ++CopilotChatComponent.nextUid;
  protected readonly label = signal('Copilot conversation');
  protected readonly placeholder = signal('Ask the copilot…');
  private readonly directionValue = signal<'ltr' | 'rtl' | 'auto'>('auto');
  protected readonly dir = computed(() => (this.directionValue() === 'auto' ? null : this.directionValue()));

  /** Accessible name of the conversation log. */
  @Input('label') set labelInput(value: string) {
    this.label.set(value);
  }
  @Input('placeholder') set placeholderInput(value: string) {
    this.placeholder.set(value);
  }
  /** Text direction; `auto` (default) follows the document. */
  @Input() set direction(value: 'ltr' | 'rtl' | 'auto') {
    this.directionValue.set(value);
  }
  @ViewChild('input', { static: true }) private inputRef?: ElementRef<HTMLTextAreaElement>;

  protected text(message: CopilotMessage): string {
    return textOf(message);
  }

  protected onEnter(event: Event): void {
    if ((event as KeyboardEvent).shiftKey) return;
    this.send(event);
  }

  protected send(event: Event): void {
    event.preventDefault();
    const element = this.inputRef?.nativeElement;
    if (!element) return;
    if (this.copilot.sendMessage(element.value)) element.value = '';
    element.focus();
  }
}
