import fs from 'node:fs';
import path from 'node:path';
import { wrap, okVoid, type AsyncResult } from './result';

export interface SinkEvent {
  ts: string;
  type: string;
  scope?: string;
  data?: Record<string, unknown>;
}

class Sink {
  private text: fs.WriteStream | null = null;
  private jsonl: fs.WriteStream | null = null;
  private textPath = '';
  private jsonlPath = '';

  public async open(dir: string): AsyncResult<null> {
    const [mkErr] = await wrap(fs.promises.mkdir(dir, { recursive: true }));
    if (mkErr) return [mkErr, null];

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    this.textPath = path.join(dir, `bot-${stamp}.log`);
    this.jsonlPath = path.join(dir, `events-${stamp}.jsonl`);

    this.text = fs.createWriteStream(this.textPath, { flags: 'a' });
    this.jsonl = fs.createWriteStream(this.jsonlPath, { flags: 'a' });

    this.text.on('error', (e: Error): void => console.error('[sink:text]', e.message));
    this.jsonl.on('error', (e: Error): void => console.error('[sink:jsonl]', e.message));

    return okVoid();
  }

  public writeText(line: string): void {
    this.text?.write(`${line}\n`);
  }

  public writeEvent(ev: SinkEvent): void {
    this.jsonl?.write(`${JSON.stringify(ev)}\n`);
  }

  public paths(): { text: string; jsonl: string } {
    return { text: this.textPath, jsonl: this.jsonlPath };
  }

  public close(): void {
    this.text?.end();
    this.jsonl?.end();
    this.text = null;
    this.jsonl = null;
  }
}

export const sink = new Sink();
