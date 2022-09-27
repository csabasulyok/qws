import { IncomingMessage } from 'http';
import { Duplex } from 'stream';
import { promisify } from 'util';
import WebSocket, { ServerOptions } from 'ws';
import autoBind from 'auto-bind';
import RouteRecognizer from 'route-recognizer';

import QWebSocket from '../common/queuews';
import { QwsParams } from '../common/message';
import logger from '../common/logger';

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
   * routes for callbacks
   */
  private router: RouteRecognizer;

  /**
   * Callback for check middleware
   */
  private beforeConnectCallback?: BeforeConnectCallback;

  /**
   * Set of connections
   */
  private wsToQws: Map<WebSocket, QWebSocket>;

  constructor(options?: ServerOptions) {
    super(options);
    this.router = new RouteRecognizer();
    this.wsToQws = new Map<WebSocket, QWebSocket>();
    autoBind(this);
  }

  /**
   * Override whether WS should be handled.
   * Check if route is mapped correctly.
   */
  shouldHandle(req: DecoratedIncomingMessage): boolean {
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

    return true;
  }

  /**
   * Override handling of WebSocket upgrade process.
   * If route is valid, handle connection and emit open event.
   */
  async handleUpgrade(
    req: DecoratedIncomingMessage,
    socket: Duplex,
    head: Buffer,
    callback: (ws, request) => void,
  ): Promise<void> {
    // check if pre-connect middleware is set
    if (this.beforeConnectCallback) {
      const shouldUpgrade = await this.beforeConnectCallback(req, req.params);
      if (!shouldUpgrade) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    super.handleUpgrade(req, socket, head, (ws, request) => {
      try {
        const name = new URL(req.url, `http://${req.headers.host}`).pathname;
        const qws = new QWebSocket(ws, {
          name,
          reconnect: false, // do not reconnect on server-side
        });

        // map ws to qws for later event wrapping
        this.wsToQws.set(ws, qws);
        logger.info(`WS open, now maintaining ${this.wsToQws.size} connections`);
        ws.on('close', () => {
          this.wsToQws.delete(ws);
          logger.info(`WS closed, now maintaining ${this.wsToQws.size} connections`);
        });

        // set current connection callback
        qws.onConnect(() => req.handler?.(qws, req.params, req));

        // call original callback
        callback(qws, request);

        // re-emit open event, since original consumed by express-ws
        // this will trigger the callback correctly
        ws.emit('open');
      } catch (err) {
        logger.error(err);
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

  async closeAsync(): Promise<void> {
    // take all qws through super client mapping, and close them
    await Promise.all([...this.clients].map((ws) => this.wsToQws.get(ws)?.close()));
    // promisify original close method
    const closeP = promisify(this.close.bind(this));
    await closeP();
  }
}
