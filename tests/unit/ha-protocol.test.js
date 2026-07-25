/**
 * @jest-environment node
 */

const { EventEmitter } = require('events');

const {
  MEDIA_ARTWORK_MAX_RESPONSE_BYTES,
  createElectronNetBinaryFetcher,
  createHaProtocolHandler,
} = require('../../src/ha-protocol.cjs');
const { isAllowedHlsProxyPath } = require('../../src/main-security.cjs');

function createHandler(overrides = {}) {
  const fetchStream = jest.fn(
    async () =>
      new Response('upstream data', {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      })
  );
  const fetchBinary = jest.fn(async () => ({
    status: 200,
    headers: { 'content-type': ['image/png'] },
    data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  }));
  const log = { error: jest.fn(), warn: jest.fn() };
  const config = {
    homeAssistant: {
      url: 'https://ha.example.test/',
      token: 'secret-token',
    },
  };
  const dependencies = {
    getConfig: () => config,
    fetchStream,
    fetchBinary,
    isAllowedHlsProxyPath,
    log,
    ...overrides,
  };

  return {
    handler: createHaProtocolHandler(dependencies),
    fetchStream: dependencies.fetchStream,
    fetchBinary: dependencies.fetchBinary,
    log: dependencies.log,
  };
}

function createRequest(url) {
  return { url, signal: new AbortController().signal };
}

describe('Home Assistant protocol handler', () => {
  it('streams camera responses through Electron fetch with authorization', async () => {
    const { handler, fetchStream } = createHandler();

    const response = await handler(createRequest('ha://camera_stream/camera.front_door'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toBe('no-cache, no-store, must-revalidate');
    expect(await response.text()).toBe('upstream data');
    expect(fetchStream).toHaveBeenCalledWith(
      'https://ha.example.test/api/camera_proxy_stream/camera.front_door',
      expect.objectContaining({
        cache: 'no-store',
        headers: {
          Authorization: 'Bearer secret-token',
          'Cache-Control': 'no-cache, no-store',
          Pragma: 'no-cache',
        },
        redirect: 'follow',
      })
    );
  });

  it('allows only approved HLS proxy paths and preserves the query string', async () => {
    const { handler, fetchStream } = createHandler({
      fetchStream: jest.fn(async () => new Response(null, { status: 200 })),
    });

    const allowed = await handler(
      createRequest('ha://hls/api/hls/stream/master_playlist.m3u8?token=short-lived')
    );
    const rejected = await handler(createRequest('ha://hls/api/services/light/turn_on'));

    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('content-type')).toBe('application/vnd.apple.mpegurl');
    expect(rejected.status).toBe(403);
    expect(fetchStream).toHaveBeenCalledTimes(1);
    expect(fetchStream.mock.calls[0][0]).toBe(
      'https://ha.example.test/api/hls/stream/master_playlist.m3u8?token=short-lived'
    );
    expect(fetchStream.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        cache: 'no-store',
        headers: {
          Authorization: 'Bearer secret-token',
          'Cache-Control': 'no-cache, no-store',
          Pragma: 'no-cache',
        },
        redirect: 'follow',
      })
    );
  });

  it('retries an HLS master playlist after a cloud-camera warmup timeout', async () => {
    const warmupTimeout = new Error('The operation timed out');
    warmupTimeout.name = 'TimeoutError';
    const fetchStream = jest
      .fn()
      .mockRejectedValueOnce(warmupTimeout)
      .mockResolvedValueOnce(
        new Response('#EXTM3U\nplaylist.m3u8\n', {
          status: 200,
          headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
        })
      );
    const { handler } = createHandler({ fetchStream });

    const response = await handler(createRequest('ha://hls/api/hls/session/master_playlist.m3u8'));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('#EXTM3U');
    expect(fetchStream).toHaveBeenCalledTimes(2);
    expect(fetchStream.mock.calls[1][0]).toBe(
      'https://ha.example.test/api/hls/session/master_playlist.m3u8'
    );
    expect(fetchStream.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        cache: 'no-store',
        headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }),
      })
    );
    // The retry has to be bounded too, or a camera that never produces a playlist hangs the
    // connection until the renderer abandons it.
    expect(fetchStream.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('gives up on an HLS master playlist when the retry also stalls', async () => {
    const stall = () => {
      const timeout = new Error('The operation timed out');
      timeout.name = 'TimeoutError';
      return Promise.reject(timeout);
    };
    const fetchStream = jest.fn(stall);
    const { handler, log } = createHandler({ fetchStream });

    const response = await handler(createRequest('ha://hls/api/hls/session/master_playlist.m3u8'));

    expect(response.status).toBe(500);
    expect(fetchStream).toHaveBeenCalledTimes(2);
    expect(log.error).toHaveBeenCalledWith(
      'Protocol handler error (hls/master_playlist.m3u8):',
      expect.objectContaining({ name: 'TimeoutError' })
    );
  });

  it('does not retry non-timeout HLS master failures', async () => {
    const fetchStream = jest.fn().mockRejectedValue(new Error('connection refused'));
    const { handler, log } = createHandler({ fetchStream });

    const response = await handler(createRequest('ha://hls/api/hls/session/master_playlist.m3u8'));

    expect(response.status).toBe(500);
    expect(fetchStream).toHaveBeenCalledTimes(1);
    // The failing endpoint has to be identifiable, but the signed session segment must not leak.
    expect(log.error).toHaveBeenCalledWith(
      'Protocol handler error (hls/master_playlist.m3u8):',
      expect.objectContaining({ message: 'connection refused' })
    );
    expect(log.error.mock.calls[0][0]).not.toContain('session');
  });

  it('ends an MJPEG stream that stops sending frames', async () => {
    jest.useFakeTimers();
    try {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('frame-one'));
          // and then nothing, forever — the camera is gone but the socket stays open
        },
      });
      const fetchStream = jest.fn(async () => new Response(body, { status: 200 }));
      const { handler, log } = createHandler({ fetchStream });

      const response = await handler(createRequest('ha://camera_stream/camera.front_door'));
      const reader = response.body.getReader();

      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toBe('frame-one');

      const stalled = reader.read();
      const settled = stalled.then(
        () => 'resolved',
        (error) => error
      );
      await jest.advanceTimersByTimeAsync(15000);
      const outcome = await settled;

      expect(outcome).not.toBe('resolved');
      expect(outcome.code).toBe('STREAM_STALLED');
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining('camera.front_door stopped sending MJPEG frames')
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('leaves a healthy MJPEG stream alone', async () => {
    jest.useFakeTimers();
    try {
      let controllerRef = null;
      const body = new ReadableStream({
        start(controller) {
          controllerRef = controller;
          controller.enqueue(new TextEncoder().encode('frame-one'));
        },
      });
      const fetchStream = jest.fn(async () => new Response(body, { status: 200 }));
      const { handler, log } = createHandler({ fetchStream });

      const response = await handler(createRequest('ha://camera_stream/camera.front_door'));
      const reader = response.body.getReader();
      await reader.read();

      // A frame arriving inside the window keeps the stream open.
      const next = reader.read();
      await jest.advanceTimersByTimeAsync(10000);
      controllerRef.enqueue(new TextEncoder().encode('frame-two'));
      const second = await next;

      expect(new TextDecoder().decode(second.value)).toBe('frame-two');
      expect(log.warn).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('warns once when a camera keeps returning an identically sized snapshot', async () => {
    const fetchStream = jest.fn(
      async () =>
        new Response('jpeg-bytes', { status: 200, headers: { 'Content-Length': '80656' } })
    );
    const { handler, log } = createHandler({ fetchStream });

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await handler(createRequest('ha://camera/camera.repeated_frame'));
    }

    const warnings = log.warn.mock.calls.filter(([message]) =>
      String(message).includes('camera.repeated_frame')
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0][0]).toContain('identical 80656-byte snapshots');

    // A different size means the picture moved on; the warning re-arms rather than repeating.
    fetchStream.mockResolvedValue(
      new Response('other', { status: 200, headers: { 'Content-Length': '90000' } })
    );
    await handler(createRequest('ha://camera/camera.repeated_frame'));
    expect(
      log.warn.mock.calls.filter(([message]) => String(message).includes('camera.repeated_frame'))
    ).toHaveLength(1);
  });

  it('names the camera entity when a snapshot request fails', async () => {
    const fetchStream = jest.fn().mockRejectedValue(new Error('boom'));
    const { handler, log } = createHandler({ fetchStream });

    await handler(createRequest('ha://camera/camera.front_door'));

    expect(log.error).toHaveBeenCalledWith(
      'Protocol handler error (camera/camera.front_door):',
      expect.objectContaining({ message: 'boom' })
    );
  });

  it('returns upstream camera failures without exposing their body', async () => {
    const fetchStream = jest.fn(async () => new Response('private details', { status: 401 }));
    const { handler } = createHandler({ fetchStream });

    const response = await handler(createRequest('ha://camera/camera.front_door'));

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('');
  });

  it('rejects camera_stream entity ids that escape the camera proxy path', async () => {
    const { handler, fetchStream } = createHandler();

    const response = await handler(createRequest('ha://camera_stream/..%2F..%2Fapi%2Fstates'));

    expect(response.status).toBe(400);
    expect(fetchStream).not.toHaveBeenCalled();
  });

  it('rejects camera entity ids that escape the camera proxy path', async () => {
    const { handler, fetchStream } = createHandler();

    const response = await handler(createRequest('ha://camera/..%2F..%2Fapi%2Fstates'));

    expect(response.status).toBe(400);
    expect(fetchStream).not.toHaveBeenCalled();
  });

  it('rejects camera entity ids containing slashes after decoding', async () => {
    const { handler, fetchStream } = createHandler();

    const response = await handler(createRequest('ha://camera/camera.front%2Fapi%2Fstates'));

    expect(response.status).toBe(400);
    expect(fetchStream).not.toHaveBeenCalled();
  });

  it('accepts valid camera entity ids and ignores renderer cache-busting queries', async () => {
    const { handler, fetchStream } = createHandler();

    const response = await handler(
      createRequest('ha://camera/camera.front_door?preview=2&t=1784299200000')
    );

    expect(response.status).toBe(200);
    expect(fetchStream).toHaveBeenCalledWith(
      'https://ha.example.test/api/camera_proxy/camera.front_door',
      expect.objectContaining({
        cache: 'no-store',
        headers: {
          Authorization: 'Bearer secret-token',
          'Cache-Control': 'no-cache, no-store',
          Pragma: 'no-cache',
        },
      })
    );
  });

  it('fetches relative artwork with authorization and enforces the size/type validators', async () => {
    const { handler, fetchBinary } = createHandler();
    const encodedPath = encodeURIComponent(
      Buffer.from('/api/media_player_proxy/media_player.office').toString('base64')
    );

    const response = await handler(createRequest(`ha://media_artwork/${encodedPath}`));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(fetchBinary).toHaveBeenCalledWith(
      'https://ha.example.test/api/media_player_proxy/media_player.office',
      { Authorization: 'Bearer secret-token' },
      10000,
      expect.objectContaining({
        maxBytes: MEDIA_ARTWORK_MAX_RESPONSE_BYTES,
        validateContentType: expect.any(Function),
      })
    );
    const { validateContentType } = fetchBinary.mock.calls[0][3];
    expect(validateContentType('image/webp')).toBe(true);
    expect(validateContentType('text/html')).toBe(false);
  });

  it('does not attach the Home Assistant token to external artwork requests', async () => {
    const { handler, fetchBinary } = createHandler();
    const artworkUrl = 'https://cdn.example.test/artwork.png';
    const encodedUrl = encodeURIComponent(Buffer.from(artworkUrl).toString('base64'));

    await handler(createRequest(`ha://media_artwork/${encodedUrl}`));

    expect(fetchBinary.mock.calls[0][0]).toBe(artworkUrl);
    expect(fetchBinary.mock.calls[0][1]).toEqual({});
  });

  it('fails closed for missing credentials, unknown hosts, and bounded-fetch errors', async () => {
    const noCredentials = createHandler({ getConfig: () => ({}) });
    const regular = createHandler();
    const tooLarge = new Error('too large');
    tooLarge.statusCode = 413;
    const failingArtwork = createHandler({
      fetchBinary: jest.fn(async () => {
        throw tooLarge;
      }),
    });
    const encodedUrl = encodeURIComponent(Buffer.from('/api/image').toString('base64'));

    expect((await noCredentials.handler(createRequest('ha://camera/camera.front'))).status).toBe(
      403
    );
    expect((await regular.handler(createRequest('ha://unknown/value'))).status).toBe(404);
    expect(
      (await failingArtwork.handler(createRequest(`ha://media_artwork/${encodedUrl}`))).status
    ).toBe(413);
    expect(failingArtwork.log.error).toHaveBeenCalled();
  });
});

describe('Electron net binary fetcher', () => {
  function createNet(responseDefinition) {
    const request = new EventEmitter();
    request.setHeader = jest.fn();
    request.abort = jest.fn();
    request.end = jest.fn(() => {
      const response = new EventEmitter();
      Object.assign(response, responseDefinition);
      request.emit('response', response);
      process.nextTick(() => {
        for (const chunk of responseDefinition.chunks || []) response.emit('data', chunk);
        response.emit('end');
      });
    });

    return {
      net: { request: jest.fn(() => request) },
      request,
    };
  }

  it('collects an accepted binary response', async () => {
    const { net, request } = createNet({
      statusCode: 200,
      headers: { 'content-type': ['image/png'], 'content-length': ['4'] },
      chunks: [Buffer.from([0x89, 0x50]), Buffer.from([0x4e, 0x47])],
    });
    const fetchBinary = createElectronNetBinaryFetcher(net);

    const result = await fetchBinary(
      'https://ha.example.test/image',
      { Authorization: 'Bearer x' },
      1000,
      {
        maxBytes: 4,
        validateContentType: (value) => value === 'image/png',
      }
    );

    expect(result.status).toBe(200);
    expect(result.data).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(request.setHeader).toHaveBeenCalledWith('Authorization', 'Bearer x');
    expect(request.setHeader).toHaveBeenCalledWith(
      'Accept',
      'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
    );
  });

  it('rejects oversized and non-image responses before buffering them', async () => {
    const oversized = createNet({
      statusCode: 200,
      headers: { 'content-type': ['image/png'], 'content-length': ['5'] },
    });
    const wrongType = createNet({
      statusCode: 200,
      headers: { 'content-type': ['text/html'], 'content-length': ['2'] },
    });

    await expect(
      createElectronNetBinaryFetcher(oversized.net)('https://example.test/large', {}, 1000, {
        maxBytes: 4,
      })
    ).rejects.toMatchObject({ statusCode: 413, code: 'MEDIA_ARTWORK_TOO_LARGE' });
    await expect(
      createElectronNetBinaryFetcher(wrongType.net)('https://example.test/html', {}, 1000, {
        maxBytes: 4,
        validateContentType: (value) => value.startsWith('image/'),
      })
    ).rejects.toMatchObject({
      statusCode: 415,
      code: 'MEDIA_ARTWORK_UNSUPPORTED_TYPE',
    });
  });
});
