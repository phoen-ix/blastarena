export type ToastType = 'success' | 'error' | 'info';

export class NotificationUI {
  private container: HTMLElement;

  constructor() {
    this.container = document.getElementById('toast-container')!;
  }

  show(message: string, type: ToastType = 'info', duration: number = 3000): void {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    // The container is a polite live region (index.html); errors interrupt.
    if (type === 'error') toast.setAttribute('role', 'alert');
    toast.textContent = message;
    this.container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  success(message: string): void {
    this.show(message, 'success');
  }

  error(message: string): void {
    this.show(message, 'error', 5000);
  }

  info(message: string): void {
    this.show(message, 'info');
  }
}
