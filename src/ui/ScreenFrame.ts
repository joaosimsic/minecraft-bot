import blessed from 'blessed';

export class ScreenFrame {
  public readonly screen: blessed.Widgets.Screen;
  private renderDue = false;

  public constructor(title: string) {
    this.screen = blessed.screen({
      smartCSR: true,
      title,
    });
  }

  public scheduleRender(): void {
    if (this.renderDue) return;
    this.renderDue = true;
    queueMicrotask((): void => {
      this.renderDue = false;
      this.screen.render();
    });
  }

  public destroy(): void {
    this.screen.destroy();
  }
}
