import { ServerMessageSchema, type ClientMessage, type ServerMessage } from "@tma/schema";

export type ConnectionStatus = "connecting" | "open" | "closed" | "failed";

type Handlers = {
  onMessage: (msg: ServerMessage) => void;
  onStatus: (status: ConnectionStatus) => void;
};

/**
 * WebSocket to the harness with reconnect and an outbound queue. Messages are
 * validated against the protocol on the way in; anything unrecognized is
 * dropped rather than crashing the playhead.
 */
export class HarnessConnection {
  private ws: WebSocket | null = null;
  private attempts = 0;
  private queue: string[] = [];
  private closedByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly url: string,
    private readonly handlers: Handlers,
  ) {}

  connect(): void {
    this.handlers.onStatus("connecting");
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.handlers.onStatus("open");
      for (const m of this.queue) ws.send(m);
      this.queue = [];
    };
    ws.onmessage = (e) => {
      let data: unknown;
      try {
        data = JSON.parse(String(e.data));
      } catch {
        return;
      }
      const parsed = ServerMessageSchema.safeParse(data);
      if (parsed.success) this.handlers.onMessage(parsed.data);
    };
    ws.onclose = () => {
      this.handlers.onStatus("closed");
      if (!this.closedByUser) this.scheduleReconnect();
    };
    ws.onerror = () => {
      // onclose follows and handles the retry.
    };
  }

  private scheduleReconnect(): void {
    this.attempts++;
    if (this.attempts > 6) {
      this.handlers.onStatus("failed");
      return;
    }
    const delay = Math.min(8000, 400 * 2 ** this.attempts);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(msg: ClientMessage): void {
    const data = JSON.stringify(msg);
    if (this.isOpen) this.ws!.send(data);
    else this.queue.push(data);
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
