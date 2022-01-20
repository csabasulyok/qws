import WebSocket, { ServerOptions } from 'ws';
import { IncomingMessage } from 'http';
import { Duplex } from 'stream';
import RouteRecognizer, { Params } from 'route-recognizer';

import QWebSocket from '../common/queuews';

/**
 * Callback function type
 */
export type ConnectionCallback = (
  qws: QWebSocket,
  params?: Params,
  req?: IncomingMessage,
) => void | number | Promise<void> | Promise<number>;

/**
 * Decorated incoming HTTP message
 * Allows setting callback and params in shouldHandle middleware
 */
type DecoratedIncomingMessage = IncomingMessage & {
  handler: ConnectionCallback;
  params: Params;
};

/**
 * Wrapper around WebSocket server provided by the ws package.
 * Allows building up QWebSocket objects on connect.
 * Allows simple routing via the route-recognizer package.
 */
export default class QWebSocketServer extends WebSocket.Server {
  /**
   * callbacks held per route
   */
  private router: RouteRecognizer;

  constructor(options?: ServerOptions) {
    super(options);
    this.router = new RouteRecognizer();
  }

  /**
   * Override whether WS should be handled.
   * Check if route is mapped correctly.
   */
  shouldHandle(req: DecoratedIncomingMessage): boolean | Promise<boolean> {
    if (!super.shouldHandle(req)) {
      return false;
    }
    // check if route exists
    const routeResults = this.router.recognize(req.url || '/');
    if (!routeResults) {
      return false;
    }
    // save handler and params
    const { handler, params } = routeResults[0];
    req.handler = handler as ConnectionCallback;
    req.params = params;
    return true;
  }

  /**
   * Override handling of WebSocket upgrade process.
   * If route is valid, handle connection and emit open event.
   */
  handleUpgrade(req: DecoratedIncomingMessage, socket: Duplex, head: Buffer, callback: (ws, request) => void): void {
    super.handleUpgrade(req, socket, head, (ws, request) => {
      console.log('handleupgrade');
      try {
        const qws = new QWebSocket(ws, {
          name: req.url,
          reconnect: false, // do not reconnect on server-side
        });

        // set current connection callback
        qws.onConnect(() => req.handler?.(qws, req.params, req));

        // call original callback
        callback(qws, request);

        // re-emit open event, since original consumed by express-ws
        // this will trigger the callback correctly
        ws.emit('open');
      } catch (err) {
        console.error(err);
        throw err;
      }
    });
  }

  //
  // Callbacks for regular and routed connections
  //

  onRoute(routePattern: string, callback: ConnectionCallback): void {
    console.log(routePattern, 'routed');
    this.router.add([
      {
        path: routePattern,
        handler: callback,
      },
    ]);
  }

  onConnection(callback: ConnectionCallback): void {
    this.onRoute('*', callback);
  }
}
