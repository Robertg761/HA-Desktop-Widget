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
  const fetchStream = jest.fn(async () =>
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
  const log = { error: jest.fn() };
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
        headers: { Authorization: 'Bearer secret-token' },
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
  });

  it('returns upstream camera failures without exposing their body', async () => {
    const fetchStream = jest.fn(async () => new Response('private details', { status: 401 }));
    const { handler } = createHandler({ fetchStream });

    const response = await handler(createRequest('ha://camera/camera.front_door'));

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('');
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

    const result = await fetchBinary('https://ha.example.test/image', { Authorization: 'Bearer x' }, 1000, {
      maxBytes: 4,
      validateContentType: (value) => value === 'image/png',
    });

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
