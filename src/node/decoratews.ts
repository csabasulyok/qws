import { IncomingMessage } from 'http';
import { Duplex } from 'stream';
import WebSocket, { ServerOptions } from 'ws';
import autoBind from 'auto-bind';
import RouteRecognizer from 'route-recognizer';

import QWebSocket from '../common/queuews';
import { QwsParams } from '../common/message';

/**
 * Path parameters of routing
 * amended with query string
 */
export type QwsUrlParams = QwsParams & {
  queryParams: {
    [key: string]: string;
  };
};

/**
 * Callback function type
 */
export type ConnectionCallback = (
  qws: QWebSocket,
  params?: QwsUrlParams,
  req?: IncomingMessage,
) => void | number | Promise<void> | Promise<number>;

/**
 * Middleware callback function type
 */
export type BeforeConnectCallback = (req: IncomingMessage, params?: QwsUrlParams) => boolean | Promise<boolean>;

/**
 * Decorated incoming HTTP message
 * Allows setting callback and params in shouldHandle middleware
 */
type DecoratedIncomingMessage = IncomingMessage & {
  handler: ConnectionCallback;
  params: QwsUrlParams;
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
  private beforeConnectCallback?: BeforeConnectCallback;

  constructor(options?: ServerOptions) {
    super(options);
    this.router = new RouteRecognizer();
    autoBind(this);
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
    req.handler = routeResults[0].handler as ConnectionCallback;
    req.params = {
      ...routeResults[0].params,
      queryParams: routeResults.queryParams,
    } as QwsUrlParams;

    // check middleware if set
    if (this.beforeConnectCallback) {
      return this.beforeConnectCallback(req, req.params);
    }

    return true;
  }

  /**
   * Override handling of WebSocket upgrade process.
   * If route is valid, handle connection and emit open event.
   */
  handleUpgrade(req: DecoratedIncomingMessage, socket: Duplex, head: Buffer, callback: (ws, request) => void): void {
    super.handleUpgrade(req, socket, head, (ws, request) => {
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

  beforeConnect(callback: BeforeConnectCallback): void {
    this.beforeConnectCallback = callback;
  }

  //
  // Promisified super close
  //

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      super.close((err?: Error) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}
