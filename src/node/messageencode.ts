import logger from '../common/logger.js';
import { QwsMessage, BinaryQwsMessage, JsonQwsMessage } from '../common/message.js';

/**
 * Converts generic object into base64-encoded JSON.
 * Used in headers and optionally JSON-style body.
 */
function objectToJsonBinary(object: Record<string, unknown>): string {
  const objectJson = JSON.stringify(object);
  return Buffer.from(objectJson).toString('base64');
}

/**
 * Deserializes base64-json buffers
 * Used in headers and optionally JSON-style body.
 */
function jsonBinaryToObject(jsonBinary: Buffer): Record<string, unknown> {
  const objectJson = Buffer.from(jsonBinary.toString(), 'base64').toString();
  return JSON.parse(objectJson) as Record<string, unknown>;
}

/**
 * Convert binary data received through underlying WS into WSQ message
 * Changes type based on type header
 */
// async to keep the same signature as the browser implementation (which reads Blobs)
// eslint-disable-next-line @typescript-eslint/require-await
export async function deserializeMessage(buffer: Buffer): Promise<QwsMessage> {
  if (buffer.length < 4) {
    logger.error('Invalid buffer size');
    return {
      headers: { type: 'bin' },
      body: buffer,
    };
  }

  // take first 4 bytes from header, check if not a too large size
  const headersSize = buffer.readUInt32LE();
  if (headersSize > buffer.length - 4) {
    logger.error(`Invalid header size ${headersSize} > ${buffer.length - 4}`);
    return {
      headers: { type: 'bin' },
      body: buffer,
    };
  }

  try {
    // decode base64-JSON
    const headers = jsonBinaryToObject(buffer.subarray(4, headersSize + 4));

    // remaning bytes are body
    const bodyBlob = buffer.subarray(headersSize + 4);
    let body: Buffer | Record<string, unknown> | undefined;
    const type = headers.type || 'bin';

    switch (type) {
      case 'bin': {
        body = bodyBlob;
        break;
      }
      case 'json': {
        body = jsonBinaryToObject(bodyBlob);
        break;
      }
      default:
    }

    return { headers, body } as QwsMessage;
  } catch (error) {
    logger.error(`Could not decode message: ${error}`);
    logger.error(error);
    return {
      headers: { type: 'bin' },
      body: buffer,
    };
  }
}

/**
 * Converts WSQ message into Blob to be sent through underlying WebSocket
 */
export function serializeMessage(message: QwsMessage): Buffer {
  // headers encoded into base64(json)
  const headersEncoded = objectToJsonBinary(message.headers);

  // body is either JSON Blob, original binary data or nothing
  let finalLength: number = 4 + headersEncoded.length;
  let bodyEncoded: Buffer | string | undefined;

  switch (message.headers.type) {
    case 'bin': {
      bodyEncoded = (message as BinaryQwsMessage).body;
      finalLength += bodyEncoded.length;
      break;
    }
    case 'json': {
      bodyEncoded = objectToJsonBinary((message as JsonQwsMessage).body);
      finalLength += bodyEncoded.length;
      break;
    }
    case 'ready':
    case 'ack':
    case 'err': {
      // no body
      break;
    }
  }

  const ret = Buffer.alloc(finalLength);
  ret.writeUInt32LE(headersEncoded.length);
  ret.write(headersEncoded, 4);

  switch (message.headers.type) {
    case 'bin': {
      const bodyBuffer = bodyEncoded as Buffer;
      bodyBuffer.copy(ret, 4 + headersEncoded.length, 0, bodyBuffer.length);
      break;
    }
    case 'json': {
      ret.write(bodyEncoded as string, 4 + headersEncoded.length);
      break;
    }
    case 'ready':
    case 'ack':
    case 'err': {
      // no body
      break;
    }
  }

  return ret;
}
