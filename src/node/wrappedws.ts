import autoBind from 'auto-bind';
import { WebSocket, MessageEvent, ClientOptions } from 'ws';
import {
  QwsMessage,
  AckQwsMessage,
  BinaryQwsMessage,
  ErrorQwsMessage,
  HeartbeatQwsMessage,
  JsonQwsMessage,
  ReadyQwsMessage,
} from '../common/message.js';
import { deserializeMessage, serializeMessage } from './messageencode.js';
import { Binary } from '../common/discriminator.js';

/**
 * Wrapper around WebSocket, built to serialize/deserialize
 * WSQ formatted messages.
 */
export default class WrappedWebSocket {
  ws: WebSocket;

  callbacks: {
    bin?: (message: BinaryQwsMessage) => void;
    json?: (message: JsonQwsMessage) => void;
    ready?: (message: ReadyQwsMessage) => void;
    ack?: (message: AckQwsMessage) => void;
    err?: (message: ErrorQwsMessage) => void;
    ping?: (message: HeartbeatQwsMessage) => void;
    pong?: (message: HeartbeatQwsMessage) => void;
  };

  /**
   * Time of the last message or heartbeat answer received, to detect dead connections
   */
  lastActivity: number;

  constructor(wsOrUrl: WebSocket | string, opts?: ClientOptions) {
    this.callbacks = {};
    this.lastActivity = Date.now();

    if (wsOrUrl instanceof WebSocket || wsOrUrl?.constructor?.name === 'WebSocket') {
      this.ws = wsOrUrl as WebSocket;
    } else {
      this.ws = new WebSocket(wsOrUrl, opts);
    }

    this.ws.addEventListener('message', async (event: MessageEvent) => {
      this.lastActivity = Date.now();
      const message = await deserializeMessage(event.data as Buffer);
      // logger.info('WRAPPER received', message);
      const callback = this.callbacks[message.headers.type] as (msg: QwsMessage) => void;
      callback?.(message);
    });

    // answers to protocol-level pings
    this.ws.on('pong', () => {
      this.lastActivity = Date.now();
    });

    autoBind(this);
  }

  /**
   * Proxy callbacks
   */

  onWsOpen(callback: () => void): void {
    this.ws.addEventListener('open', callback);
  }

  onWsClose(callback: () => void): void {
    this.ws.addEventListener('close', callback);
  }

  onWsError(callback: (event: unknown) => void): void {
    this.ws.addEventListener('error', callback);
  }

  /**
   * Proxy others
   */
  get readyState(): number {
    return this.ws.readyState;
  }

  get bufferedAmount(): number {
    return this.ws.bufferedAmount;
  }

  /**
   * Concrete message type callbacks
   */

  onBin(callback: (message: BinaryQwsMessage) => void): void {
    this.callbacks.bin = callback;
  }

  onJson(callback: (message: JsonQwsMessage) => void): void {
    this.callbacks.json = callback;
  }

  onReady(callback: (message: ReadyQwsMessage) => void): void {
    this.callbacks.ready = callback;
  }

  onAck(callback: (message: AckQwsMessage) => void): void {
    this.callbacks.ack = callback;
  }

  onErr(callback: (message: ErrorQwsMessage) => void): void {
    this.callbacks.err = callback;
  }

  onPing(callback: (message: HeartbeatQwsMessage) => void): void {
    this.callbacks.ping = callback;
  }

  onPong(callback: (message: HeartbeatQwsMessage) => void): void {
    this.callbacks.pong = callback;
  }

  /**
   * Proxy methods
   */
  send(message: QwsMessage): void {
    // logger.info('WRAPPER sending', message);
    const data = serializeMessage(message);
    this.ws.send(data);
  }

  sendRaw(data: Binary): void {
    // logger.info('WRAPPER send raw', data.toString());
    this.ws.send(data);
  }

  close(): void {
    this.ws.close();
  }

  /**
   * Heartbeat via protocol-level ping, every RFC 6455 peer (including browsers) answers it
   */
  readonly heartbeatAnsweredByProtocol = true;

  sendHeartbeat(): void {
    this.ws.ping();
  }

  /**
   * Destroy the connection without a closing handshake (which would hang on a dead connection)
   */
  terminate(): void {
    this.ws.terminate();
  }
}
