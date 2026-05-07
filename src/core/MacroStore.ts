export class MacroStore {
  private readonly byName = new Map<string, string>();

  public put(name: string, body: string): void {
    this.byName.set(name, body);
  }

  public get(name: string): string | null {
    const v = this.byName.get(name);
    if (v === undefined) return null;
    return v;
  }

  public remove(name: string): boolean {
    return this.byName.delete(name);
  }

  public names(): string[] {
    return [...new Set(this.byName.keys())].sort((a, b): number =>
      a.localeCompare(b),
    );
  }
}
