import { SocketClient } from '../network/SocketClient';
import { PublicUser } from '@blast-arena/shared';

export class ChatUI {
  private container: HTMLElement;
  private socketClient: SocketClient;
  private messages: HTMLElement | null = null;

  constructor(socketClient: SocketClient) {
    this.socketClient = socketClient;
    this.container = document.createElement('div');
    this.container.className = 'chat-container';
    this.render();
    this.setupListener();
  }

  show(): void {
    const uiOverlay = document.getElementById('ui-overlay');
    if (uiOverlay && !uiOverlay.contains(this.container)) {
      uiOverlay.appendChild(this.container);
    }
  }

  hide(): void {
    this.container.remove();
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-input">
        <input type="text" id="chat-input" placeholder="Type a message..." maxlength="500">
        <button id="chat-send">Send</button>
      </div>
    `;

    this.messages = this.container.querySelector('#chat-messages')!;

    const input = this.container.querySelector('#chat-input') as HTMLInputElement;
    const sendBtn = this.container.querySelector('#chat-send')!;

    const send = () => {
      const msg = input.value.trim();
      if (!msg) return;
      this.socketClient.emit('chat:message', { message: msg });
      input.value = '';
    };

    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') send();
    });
  }

  private setupListener(): void {
    this.socketClient.on('chat:message', (data: { user: PublicUser; message: string; timestamp: number }) => {
      this.addMessage(data.user.username, data.message);
    });
  }

  addMessage(username: string, message: string): void {
    if (!this.messages) return;

    const el = document.createElement('div');
    el.className = 'chat-message';
    el.innerHTML = `<span class="chat-user">${this.escapeHtml(username)}</span>: ${this.escapeHtml(message)}`;
    this.messages.appendChild(el);
    this.messages.scrollTop = this.messages.scrollHeight;

    // Limit to 100 messages
    while (this.messages.children.length > 100) {
      this.messages.removeChild(this.messages.firstChild!);
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
