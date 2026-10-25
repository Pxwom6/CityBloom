/**
 * A link carries a room's text messages, whatever is underneath (M30): a WebSocket to a relay or an
 * online room, a WebRTC data channel to a host's browser, or a loopback inside one page (the host's
 * own game talking to the room it runs).
 */
export interface Link {
  send(text: string): void;
  close(): void;
  onmessage: ((text: string) => void) | null;
  /** Called once when the link goes, for any reason (not after `close()` from this side). */
  onclose: ((why: string) => void) | null;
}

/** Open a WebSocket; resolves once it's open, rejects if it can't connect within `timeoutMs`. */
export function webSocketLink(url: string, timeoutMs = 8000): Promise<Link> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    let open = false;
    let closedHere = false;
    const timer = setTimeout(() => {
      if (!open) {
        ws.close();
        reject(new Error('timeout'));
      }
    }, timeoutMs);
    const link: Link = {
      send: (t) => {
        if (ws.readyState === 1) ws.send(t);
      },
      close: () => {
        closedHere = true;
        ws.close(1000);
      },
      onmessage: null,
      onclose: null,
    };
    ws.onopen = () => {
      open = true;
      clearTimeout(timer);
      resolve(link);
    };
    ws.onmessage = (e) => link.onmessage?.(typeof e.data === 'string' ? e.data : '');
    ws.onerror = () => {
      if (!open) {
        clearTimeout(timer);
        reject(new Error('could not connect'));
      }
    };
    ws.onclose = (e) => {
      clearTimeout(timer);
      if (!open) return reject(new Error('could not connect'));
      if (!closedHere) link.onclose?.(e.reason || `closed (${e.code})`);
    };
  });
}

/** Two ends of a link inside one page; messages arrive asynchronously, in order. */
export function loopbackPair(): [Link, Link] {
  const make = (): Link & { peer?: Link & { closed?: boolean }; closed?: boolean } => ({
    send(text) {
      const peer = this.peer;
      if (this.closed || !peer || peer.closed) return;
      queueMicrotask(() => {
        if (!peer.closed) peer.onmessage?.(text);
      });
    },
    close() {
      if (this.closed) return;
      this.closed = true;
      const peer = this.peer;
      // Messages already sent arrive first, then the close.
      if (peer && !peer.closed)
        queueMicrotask(() => {
          if (peer.closed) return;
          peer.closed = true;
          peer.onclose?.('closed');
        });
    },
    onmessage: null,
    onclose: null,
  });
  const a = make();
  const b = make();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

/** A WebRTC data channel as a link (it must be open, or opening). */
export function dataChannelLink(dc: RTCDataChannel): Link {
  let closedHere = false;
  const queue: string[] = [];
  const link: Link = {
    send: (t) => {
      if (dc.readyState === 'open') dc.send(t);
      else if (dc.readyState === 'connecting') queue.push(t);
    },
    close: () => {
      closedHere = true;
      dc.close();
    },
    onmessage: null,
    onclose: null,
  };
  dc.onopen = () => {
    for (const t of queue.splice(0)) dc.send(t);
  };
  dc.onmessage = (e) => link.onmessage?.(typeof e.data === 'string' ? e.data : '');
  dc.onclose = () => {
    if (!closedHere) link.onclose?.('the connection closed');
  };
  return link;
}
