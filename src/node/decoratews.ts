import WebSocket, { ServerOptions } from 'ws';
import { IncomingMessage } from 'http';

import QWebSocket from '../common/queuews';

export default class QWebSocketServer extends WebSocket.Server {
  callback: (ws: QWebSocket, req?: IncomingMessage) => void;

  constructor(options?: ServerOptions, callback?: () => void) {
    super(options, callback);

    this.on('connection', (ws: WebSocket, req?: IncomingMessage) => {
      try {
        const qws = new QWebSocket(ws, {
          name: req.url,
          reconnect: false, // do not reconnect on server-side
        });

        this.callback?.(qws, req);

        // re-emit open event, since original consumed by express-ws
        ws.emit('open');
      } catch (err) {
        console.error(err);
        throw err;
      }
    });
  }

  onConnection(callback: (ws: QWebSocket, req?: IncomingMessage) => void): void {
    this.callback = callback;
  }
}
