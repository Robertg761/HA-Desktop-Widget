const dns = require('dns');
const nodeNet = require('net');

const MEDIA_ARTWORK_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MEDIA_ARTWORK_GENERIC_CONTENT_TYPES = new Set([
  'application/octet-stream',
  'binary/octet-stream',
]);
const MEDIA_ARTWORK_ALLOWED_CONTENT_TYPES = new Set([
  'image/apng',
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/vnd.microsoft.icon',
  'image/webp',
  'image/x-icon',
]);

const HA_ENTITY_ID_PATTERN = /^[a-z0-9_]+\.[a-z0-9_]+$/i;
const HLS_MASTER_WARMUP_TIMEOUT_MS = 8000;
const HLS_MASTER_RETRY_TIMEOUT_MS = 12000;
// An MJPEG stream sends frames continuously whether or not anything in view is moving, so a long
// silence means the stream is dead rather than the scene being still. Without this the renderer
// keeps a frozen first frame on screen and goes on calling it live, because a multipart image
// that simply stops arriving never fires an error.
const MJPEG_STREAM_STALL_TIMEOUT_MS = 15000;

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

function getHeaderValue(headers, name) {
  if (!headers || !name) return undefined;
  if (typeof headers.get === 'function') {
    const value = headers.get(name);
    return value === null ? undefined : value;
  }

  const normalizedName = String(name).toLowerCase();
  const value = headers[normalizedName] ?? headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

function createProtocolError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function getContentLength(headers) {
  const rawValue = getHeaderValue(headers, 'content-length');
  if (rawValue === undefined || rawValue === null || rawValue === '') return null;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function getMimeType(contentType) {
  if (!contentType || typeof contentType !== 'string') return '';
  return contentType.split(';')[0].trim().toLowerCase();
}

function isPotentialMediaArtworkContentType(contentType) {
  const mimeType = getMimeType(contentType);
  if (!mimeType) return true;
  if (MEDIA_ARTWORK_ALLOWED_CONTENT_TYPES.has(mimeType)) return true;
  return MEDIA_ARTWORK_GENERIC_CONTENT_TYPES.has(mimeType);
}

function sniffMediaArtworkContentType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }
  if (buffer.slice(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
  if (
    buffer.length >= 12 &&
    buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
    buffer.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (
    buffer.length >= 12 &&
    buffer.slice(4, 8).toString('ascii') === 'ftyp' &&
    ['avif', 'avis'].includes(buffer.slice(8, 12).toString('ascii'))
  ) {
    return 'image/avif';
  }
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return 'image/bmp';

  return null;
}

function resolveMediaArtworkContentType(headers, buffer) {
  const contentType = getHeaderValue(headers, 'content-type');
  const mimeType = getMimeType(contentType);
  if (MEDIA_ARTWORK_ALLOWED_CONTENT_TYPES.has(mimeType)) return mimeType;

  if (!mimeType || MEDIA_ARTWORK_GENERIC_CONTENT_TYPES.has(mimeType)) {
    return sniffMediaArtworkContentType(buffer);
  }

  return null;
}

function isPrivateOrReservedIp(address) {
  const ipVersion = nodeNet.isIP(address);
  if (ipVersion === 4) {
    const parts = address.split('.').map((part) => Number.parseInt(part, 10));
    const value = parts.reduce((result, part) => ((result << 8) | part) >>> 0, 0);
    const inCidr = (base, prefixLength) => {
      const baseValue = base
        .split('.')
        .map((part) => Number.parseInt(part, 10))
        .reduce((result, part) => ((result << 8) | part) >>> 0, 0);
      const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
      return (value & mask) >>> 0 === (baseValue & mask) >>> 0;
    };
    return [
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.88.99.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 4],
      ['240.0.0.0', 4],
    ].some(([base, prefixLength]) => inCidr(base, prefixLength));
  }

  if (ipVersion === 6) {
    const normalized = address.toLowerCase().split('%')[0];
    const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mappedIpv4) return isPrivateOrReservedIp(mappedIpv4);
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('::ffff:') ||
      /^f[cd]/.test(normalized) ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith('ff') ||
      normalized.startsWith('2001:db8:')
    );
  }

  return true;
}

async function validatePublicArtworkUrl(value, lookup = dns.promises.lookup) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw createProtocolError('Artwork URL is invalid', 400, 'MEDIA_ARTWORK_INVALID_URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw createProtocolError('Artwork URL is not allowed', 403, 'MEDIA_ARTWORK_BLOCKED_URL');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.home.arpa') ||
    (!hostname.includes('.') && nodeNet.isIP(hostname) === 0)
  ) {
    throw createProtocolError('Artwork URL is not public', 403, 'MEDIA_ARTWORK_BLOCKED_URL');
  }

  if (nodeNet.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      throw createProtocolError('Artwork URL is not public', 403, 'MEDIA_ARTWORK_BLOCKED_URL');
    }
    return parsed.toString();
  }

  let addresses;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw createProtocolError('Artwork host could not be resolved', 502, 'MEDIA_ARTWORK_DNS_ERROR');
  }
  const resolved = Array.isArray(addresses) ? addresses : [addresses];
  if (
    resolved.length === 0 ||
    resolved.some((entry) => isPrivateOrReservedIp(String(entry?.address || '')))
  ) {
    throw createProtocolError('Artwork URL is not public', 403, 'MEDIA_ARTWORK_BLOCKED_URL');
  }

  return parsed.toString();
}

function createElectronNetBinaryFetcher(net) {
  return function fetchBinaryWithElectronNet(url, headers = {}, timeoutMs = 10000, options = {}) {
    return new Promise((resolve, reject) => {
      let completed = false;
      const chunks = [];
      let receivedBytes = 0;
      const maxBytes = Number.isFinite(Number(options.maxBytes))
        ? Math.max(0, Math.floor(Number(options.maxBytes)))
        : null;
      const validateContentType =
        typeof options.validateContentType === 'function' ? options.validateContentType : null;
      const validateRedirectUrl =
        typeof options.validateRedirectUrl === 'function' ? options.validateRedirectUrl : null;
      let redirectsRemaining = Number.isFinite(Number(options.maxRedirects))
        ? Math.max(0, Math.floor(Number(options.maxRedirects)))
        : 5;

      const request = net.request({
        method: 'GET',
        url,
        redirect: 'manual',
      });

      Object.entries(headers || {}).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        request.setHeader(key, String(value));
      });
      request.setHeader('Accept', 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8');

      const timeoutId = setTimeout(() => {
        if (completed) return;
        completed = true;
        try {
          request.abort();
        } catch {
          // The request may already have closed.
        }
        reject(new Error(`Artwork request timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const rejectRequest = (error) => {
        if (completed) return;
        completed = true;
        clearTimeout(timeoutId);
        try {
          request.abort();
        } catch {
          // The request may already have closed.
        }
        reject(error);
      };

      request.on('response', (response) => {
        const responseHeaders = response.headers || {};
        const statusCode = response.statusCode || 0;
        const shouldValidateBody = statusCode >= 200 && statusCode < 300;
        if (
          shouldValidateBody &&
          validateContentType &&
          !validateContentType(getHeaderValue(responseHeaders, 'content-type'))
        ) {
          rejectRequest(
            createProtocolError(
              'Artwork response is not an image',
              415,
              'MEDIA_ARTWORK_UNSUPPORTED_TYPE'
            )
          );
          return;
        }

        const contentLength = getContentLength(responseHeaders);
        if (maxBytes !== null && contentLength !== null && contentLength > maxBytes) {
          rejectRequest(
            createProtocolError('Artwork response is too large', 413, 'MEDIA_ARTWORK_TOO_LARGE')
          );
          return;
        }

        response.on('data', (chunk) => {
          if (completed) return;
          const chunkBuffer = Buffer.from(chunk);
          receivedBytes += chunkBuffer.length;
          if (maxBytes !== null && receivedBytes > maxBytes) {
            rejectRequest(
              createProtocolError('Artwork response is too large', 413, 'MEDIA_ARTWORK_TOO_LARGE')
            );
            return;
          }
          chunks.push(chunkBuffer);
        });

        response.on('end', () => {
          if (completed) return;
          completed = true;
          clearTimeout(timeoutId);
          resolve({
            status: response.statusCode || 0,
            headers: response.headers || {},
            data: Buffer.concat(chunks, receivedBytes),
          });
        });

        response.on('error', rejectRequest);
      });

      request.on('redirect', (_statusCode, _method, redirectUrl) => {
        if (completed) return;
        if (redirectsRemaining <= 0) {
          rejectRequest(
            createProtocolError(
              'Artwork redirected too many times',
              502,
              'MEDIA_ARTWORK_TOO_MANY_REDIRECTS'
            )
          );
          return;
        }
        redirectsRemaining -= 1;
        Promise.resolve(validateRedirectUrl ? validateRedirectUrl(redirectUrl) : undefined)
          .then(() => {
            if (!completed) request.followRedirect();
          })
          .catch(rejectRequest);
      });

      request.on('error', rejectRequest);
      request.end();
    });
  };
}

// "Protocol handler error: TimeoutError" on its own cannot tell a stalled snapshot apart from a
// stalled stream, which makes user-reported camera problems unreproducible. HLS playlist paths
// embed a signed access token, so only the trailing filename from those is safe to record.
function describeHaProtocolRequest(host, url, entityId) {
  if (host === 'camera' || host === 'camera_stream') return `${host}/${entityId}`;
  if (host === 'hls') return `hls/${url.pathname.split('/').filter(Boolean).pop() || ''}`;
  return host || 'unknown';
}

// An integration serving a cached frame looks exactly like a working camera from the widget's
// side: HTTP 200, a decodable JPEG, no errors anywhere. Identical response sizes in a row are the
// cheapest signal that the picture on screen has stopped changing, and saying so once turns an
// unreproducible "my camera looks wrong" report into a one-line answer.
const IDENTICAL_SNAPSHOT_WARNING_THRESHOLD = 5;
const repeatedCameraSnapshots = new Map();

function reportRepeatedCameraSnapshot(entityId, contentLength, log) {
  if (!entityId || contentLength === null) return;
  const previous = repeatedCameraSnapshots.get(entityId);

  if (!previous || previous.contentLength !== contentLength) {
    repeatedCameraSnapshots.set(entityId, { contentLength, count: 1, warned: false });
    return;
  }

  previous.count += 1;
  if (previous.count < IDENTICAL_SNAPSHOT_WARNING_THRESHOLD || previous.warned) return;
  previous.warned = true;
  log.warn(
    `Camera ${entityId} has returned ${previous.count} identical ${contentLength}-byte snapshots in a row; ` +
      'Home Assistant is probably serving a cached frame rather than a current one.'
  );
}

// Ends the passthrough stream when the upstream goes quiet, which surfaces to the renderer as a
// plain image error. Doing it here rather than in the renderer avoids sampling pixels from a
// canvas the ha:// scheme would taint, and needs no extra IPC channel.
function watchStreamForStall(body, timeoutMs, onStall) {
  if (!body || typeof body.getReader !== 'function') return body;
  if (typeof ReadableStream !== 'function') return body;

  const reader = body.getReader();
  return new ReadableStream({
    async pull(controller) {
      let timeoutId = null;
      try {
        const result = await Promise.race([
          reader.read(),
          new Promise((_resolve, reject) => {
            timeoutId = setTimeout(
              () => reject(createProtocolError('Camera stream stalled', 504, 'STREAM_STALLED')),
              timeoutMs
            );
          }),
        ]);

        if (result.done) {
          controller.close();
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        try {
          await reader.cancel(error);
        } catch {
          // The upstream may already have torn the connection down.
        }
        controller.error(error);
        if (error?.code === 'STREAM_STALLED' && typeof onStall === 'function') onStall();
      } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

function createHaProtocolHandler({
  getConfig,
  fetchStream,
  fetchBinary,
  isAllowedHlsProxyPath,
  log = console,
  ResponseCtor = globalThis.Response,
  maxArtworkBytes = MEDIA_ARTWORK_MAX_RESPONSE_BYTES,
  validateExternalArtworkUrl = validatePublicArtworkUrl,
}) {
  if (typeof getConfig !== 'function') throw new TypeError('getConfig must be a function');
  if (typeof fetchStream !== 'function') throw new TypeError('fetchStream must be a function');
  if (typeof fetchBinary !== 'function') throw new TypeError('fetchBinary must be a function');
  if (typeof isAllowedHlsProxyPath !== 'function') {
    throw new TypeError('isAllowedHlsProxyPath must be a function');
  }
  if (typeof ResponseCtor !== 'function') throw new TypeError('Response is unavailable');

  const errorResponse = (status) => new ResponseCtor(null, { status });
  const streamResponse = (upstreamResponse, fallbackContentType, options = {}) => {
    const status = Number(upstreamResponse?.status) || 502;
    if (status < 200 || status >= 300) return errorResponse(status);

    const contentType =
      getHeaderValue(upstreamResponse.headers, 'content-type') || fallbackContentType;
    const rawBody = [204, 205].includes(status) ? null : upstreamResponse.body;
    const body = options.stallTimeoutMs
      ? watchStreamForStall(rawBody, options.stallTimeoutMs, options.onStall)
      : rawBody;
    return new ResponseCtor(body, {
      status,
      headers: {
        'Content-Type': contentType,
        ...NO_CACHE_HEADERS,
      },
    });
  };

  return async function handleHaProtocol(request) {
    let requestContext = 'unknown';
    try {
      const url = new URL(request.url);
      const host = url.hostname;
      const entityId = decodeURIComponent(url.pathname.replace(/^\//, ''));
      requestContext = describeHaProtocolRequest(host, url, entityId);
      const currentConfig = getConfig() || {};
      const haUrl = String(currentConfig?.homeAssistant?.url || '').replace(/\/$/, '');
      const token = String(currentConfig?.homeAssistant?.token || '');

      if (!haUrl || !token || !entityId) return errorResponse(403);

      if (host === 'camera_stream') {
        if (!HA_ENTITY_ID_PATTERN.test(entityId)) return errorResponse(400);
        const upstream = `${haUrl}/api/camera_proxy_stream/${entityId}`;
        const response = await fetchStream(upstream, {
          cache: 'no-store',
          headers: {
            Authorization: `Bearer ${token}`,
            'Cache-Control': 'no-cache, no-store',
            Pragma: 'no-cache',
          },
          redirect: 'follow',
          signal: request.signal,
        });
        return streamResponse(response, 'multipart/x-mixed-replace;boundary=--myboundary', {
          stallTimeoutMs: MJPEG_STREAM_STALL_TIMEOUT_MS,
          onStall: () =>
            log.warn(
              `Camera ${entityId} stopped sending MJPEG frames after ${MJPEG_STREAM_STALL_TIMEOUT_MS}ms; ` +
                'ending the stream so the preview stops presenting a frozen frame as live.'
            ),
        });
      }

      if (host === 'hls') {
        if (!isAllowedHlsProxyPath(url.pathname)) return errorResponse(403);
        const upstream = `${haUrl}${url.pathname}${url.search || ''}`;
        const fetchOptions = {
          cache: 'no-store',
          headers: {
            Authorization: `Bearer ${token}`,
            'Cache-Control': 'no-cache, no-store',
            Pragma: 'no-cache',
          },
          redirect: 'follow',
          signal: request.signal,
        };
        let response;
        if (/\/master_playlist\.m3u8$/i.test(url.pathname)) {
          try {
            const warmupTimeoutSignal = AbortSignal.timeout(HLS_MASTER_WARMUP_TIMEOUT_MS);
            response = await fetchStream(upstream, {
              ...fetchOptions,
              signal: request.signal
                ? AbortSignal.any([request.signal, warmupTimeoutSignal])
                : warmupTimeoutSignal,
            });
          } catch (error) {
            const isWarmupTimeout = ['AbortError', 'TimeoutError'].includes(error?.name);
            if (request.signal?.aborted || !isWarmupTimeout) throw error;
            // Some cloud cameras prepare the stream only after the first playlist request is
            // cancelled. Retry inside the protocol handler so Hls.js receives the warmed playlist.
            // The retry is bounded too: an unbounded one hangs on a camera that never produces a
            // playlist, holding the connection open until the renderer gives up on its own timer.
            const retryTimeoutSignal = AbortSignal.timeout(HLS_MASTER_RETRY_TIMEOUT_MS);
            response = await fetchStream(upstream, {
              ...fetchOptions,
              signal: request.signal
                ? AbortSignal.any([request.signal, retryTimeoutSignal])
                : retryTimeoutSignal,
            });
          }
        } else {
          response = await fetchStream(upstream, fetchOptions);
        }
        const fallbackContentType = url.pathname.toLowerCase().endsWith('.m3u8')
          ? 'application/vnd.apple.mpegurl'
          : 'video/MP2T';
        return streamResponse(response, fallbackContentType);
      }

      if (host === 'camera') {
        if (!HA_ENTITY_ID_PATTERN.test(entityId)) return errorResponse(400);
        const upstream = `${haUrl}/api/camera_proxy/${entityId}`;
        const timeoutSignal = AbortSignal.timeout(15000);
        const response = await fetchStream(upstream, {
          cache: 'no-store',
          headers: {
            Authorization: `Bearer ${token}`,
            'Cache-Control': 'no-cache, no-store',
            Pragma: 'no-cache',
          },
          redirect: 'follow',
          signal: request.signal ? AbortSignal.any([request.signal, timeoutSignal]) : timeoutSignal,
        });
        reportRepeatedCameraSnapshot(entityId, getContentLength(response?.headers), log);
        return streamResponse(response, 'image/jpeg');
      }

      if (host === 'media_artwork') {
        const encodedUrl = decodeURIComponent(url.pathname.replace(/^\//, ''));
        const artworkUrl = Buffer.from(encodedUrl, 'base64').toString('utf-8');
        if (!artworkUrl) return errorResponse(400);

        const isExternalUrl = /^https?:\/\//i.test(artworkUrl);
        const upstream = isExternalUrl
          ? artworkUrl
          : `${haUrl}${artworkUrl.startsWith('/') ? artworkUrl : `/${artworkUrl}`}`;
        if (isExternalUrl) {
          await validateExternalArtworkUrl(upstream);
        }
        const headers = isExternalUrl ? {} : { Authorization: `Bearer ${token}` };
        const expectedHaOrigin = new URL(haUrl).origin;
        const response = await fetchBinary(upstream, headers, 10000, {
          maxBytes: maxArtworkBytes,
          validateContentType: isPotentialMediaArtworkContentType,
          validateRedirectUrl: isExternalUrl
            ? validateExternalArtworkUrl
            : (redirectUrl) => {
                if (new URL(redirectUrl).origin !== expectedHaOrigin) {
                  throw createProtocolError(
                    'Authenticated artwork redirect changed origin',
                    403,
                    'MEDIA_ARTWORK_BLOCKED_REDIRECT'
                  );
                }
              },
        });

        if (response.status < 200 || response.status >= 300) {
          return errorResponse(response.status || 502);
        }

        const buffer = Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data);
        const contentType = resolveMediaArtworkContentType(response.headers, buffer);
        if (!contentType) return errorResponse(415);

        return new ResponseCtor(buffer, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=1800',
          },
        });
      }

      return errorResponse(404);
    } catch (error) {
      log.error(`Protocol handler error (${requestContext}):`, error);
      return errorResponse(error?.statusCode || 500);
    }
  };
}

module.exports = {
  MEDIA_ARTWORK_MAX_RESPONSE_BYTES,
  createElectronNetBinaryFetcher,
  createHaProtocolHandler,
  isPrivateOrReservedIp,
  isPotentialMediaArtworkContentType,
  resolveMediaArtworkContentType,
  validatePublicArtworkUrl,
};
