import WebSocket, { ServerOptions } from 'ws';
import { IncomingMessage } from 'http';

import QWebSocket from '../common/queuews';

/**
 * Callback function type
 */
export type ConnectionCallback = (qws: QWebSocket, req?: IncomingMessage) => void | number | Promise<void> | Promise<number>;

/**
 * Wrapper around WebSocket server provided by the ws package.
 * Allows building up QWebSocket objects on connect.
 */
export default class QWebSocketServer extends WebSocket.Server {
  /**
   * callback for connection, provided by the client
   */
  private callback?: ConnectionCallback;

  constructor(options?: ServerOptions) {
    super(options);

    this.on('connection', (ws: WebSocket, req?: IncomingMessage) => {
      try {
        const qws = new QWebSocket(ws, {
          name: req.url,
          reconnect: false, // do not reconnect on server-side
        });

        // set current callback
        qws.onConnect(() => this.callback?.(qws, req));

        // re-emit open event, since original consumed by express-ws
        // this will trigger the callback correctly
        ws.emit('open');
      } catch (err) {
        console.error(err);
        throw err;
      }
    });
  }

  /**
   * Set callback for connection
   */
  onConnection(callback: ConnectionCallback): void {
    this.callback = callback;
  }
}
