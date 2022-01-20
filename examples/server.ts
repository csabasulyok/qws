import QWebSocket, { QWebSocketServer } from '../src';

const qwss = new QWebSocketServer({ port: 3000 });

qwss.onConnection((qws: QWebSocket) => {
  console.info('ws connected');

  qws.onJson((data: Record<string, unknown>, headers: Record<string, unknown>) => {
    console.log('> JSON', headers, data);
  });

  qws.onBin((data: Buffer, headers: Record<string, unknown>) => {
    console.log('> BIN', headers, data.toString());
  });
});

console.info('Listening for WSs on port 3000');
