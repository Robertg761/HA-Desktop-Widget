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
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
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

      const request = net.request({
        method: 'GET',
        url,
        redirect: 'follow',
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

      request.on('error', rejectRequest);
      request.end();
    });
  };
}

function createHaProtocolHandler({
  getConfig,
  fetchStream,
  fetchBinary,
  isAllowedHlsProxyPath,
  log = console,
  ResponseCtor = globalThis.Response,
  maxArtworkBytes = MEDIA_ARTWORK_MAX_RESPONSE_BYTES,
}) {
  if (typeof getConfig !== 'function') throw new TypeError('getConfig must be a function');
  if (typeof fetchStream !== 'function') throw new TypeError('fetchStream must be a function');
  if (typeof fetchBinary !== 'function') throw new TypeError('fetchBinary must be a function');
  if (typeof isAllowedHlsProxyPath !== 'function') {
    throw new TypeError('isAllowedHlsProxyPath must be a function');
  }
  if (typeof ResponseCtor !== 'function') throw new TypeError('Response is unavailable');

  const errorResponse = (status) => new ResponseCtor(null, { status });
  const streamResponse = (upstreamResponse, fallbackContentType) => {
    const status = Number(upstreamResponse?.status) || 502;
    if (status < 200 || status >= 300) return errorResponse(status);

    const contentType =
      getHeaderValue(upstreamResponse.headers, 'content-type') || fallbackContentType;
    const body = [204, 205].includes(status) ? null : upstreamResponse.body;
    return new ResponseCtor(body, {
      status,
      headers: {
        'Content-Type': contentType,
        ...NO_CACHE_HEADERS,
      },
    });
  };

  return async function handleHaProtocol(request) {
    try {
      const url = new URL(request.url);
      const host = url.hostname;
      const entityId = decodeURIComponent(url.pathname.replace(/^\//, ''));
      const currentConfig = getConfig() || {};
      const haUrl = String(currentConfig?.homeAssistant?.url || '').replace(/\/$/, '');
      const token = String(currentConfig?.homeAssistant?.token || '');

      if (!haUrl || !token || !entityId) return errorResponse(403);

      if (host === 'camera_stream') {
        const upstream = `${haUrl}/api/camera_proxy_stream/${entityId}`;
        const response = await fetchStream(upstream, {
          headers: { Authorization: `Bearer ${token}` },
          redirect: 'follow',
          signal: request.signal,
        });
        return streamResponse(response, 'multipart/x-mixed-replace;boundary=--myboundary');
      }

      if (host === 'hls') {
        if (!isAllowedHlsProxyPath(url.pathname)) return errorResponse(403);
        const upstream = `${haUrl}${url.pathname}${url.search || ''}`;
        const response = await fetchStream(upstream, {
          headers: { Authorization: `Bearer ${token}` },
          redirect: 'follow',
          signal: request.signal,
        });
        const fallbackContentType = url.pathname.toLowerCase().endsWith('.m3u8')
          ? 'application/vnd.apple.mpegurl'
          : 'video/MP2T';
        return streamResponse(response, fallbackContentType);
      }

      if (host === 'camera') {
        const upstream = `${haUrl}/api/camera_proxy/${entityId}`;
        const timeoutSignal = AbortSignal.timeout(15000);
        const response = await fetchStream(upstream, {
          headers: { Authorization: `Bearer ${token}` },
          redirect: 'follow',
          signal: request.signal
            ? AbortSignal.any([request.signal, timeoutSignal])
            : timeoutSignal,
        });
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
        const headers = isExternalUrl ? {} : { Authorization: `Bearer ${token}` };
        const response = await fetchBinary(upstream, headers, 10000, {
          maxBytes: maxArtworkBytes,
          validateContentType: isPotentialMediaArtworkContentType,
        });

        if (response.status < 200 || response.status >= 300) {
          return errorResponse(response.status || 502);
        }

        const buffer = Buffer.isBuffer(response.data)
          ? response.data
          : Buffer.from(response.data);
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
      log.error('Protocol handler error:', error);
      return errorResponse(error?.statusCode || 500);
    }
  };
}

module.exports = {
  MEDIA_ARTWORK_MAX_RESPONSE_BYTES,
  createElectronNetBinaryFetcher,
  createHaProtocolHandler,
  isPotentialMediaArtworkContentType,
  resolveMediaArtworkContentType,
};
