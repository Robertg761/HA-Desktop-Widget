/**
 * @jest-environment node
 */

const {
  checkoutLocale,
  checkoutSessionParams,
  handleRequest,
  parseCheckoutRequest,
} = require('../../services/donations/src/index.js');

const ORIGIN = 'https://donate.hadesktopwidget.com';
const ENV = { STRIPE_SECRET_KEY: 'rk_test_123' };

const checkoutRequest = (body, headers = {}) =>
  new Request(`${ORIGIN}/v1/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

function stripeReturning(status, body) {
  return jest.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe('donations worker', () => {
  test('accepts whole-dollar amounts from $1 to $12,000 only', () => {
    expect(parseCheckoutRequest({ amount: 5 })).toEqual({ amount: 5, locale: 'auto' });
    expect(parseCheckoutRequest({ amount: 12000, locale: 'de' })).toEqual({
      amount: 12000,
      locale: 'de',
    });
    for (const amount of [0, 12001, 2.5, '5', null, -1]) {
      expect(parseCheckoutRequest({ amount })).toBeNull();
    }
    expect(parseCheckoutRequest({ amount: 5, locale: 7 })).toBeNull();
    expect(parseCheckoutRequest(null)).toBeNull();
  });

  test('passes on languages Checkout speaks and lets it choose for the rest', () => {
    expect(checkoutLocale('fr')).toBe('fr');
    expect(checkoutLocale('zh-CN')).toBe('zh');
    expect(checkoutLocale('pt-BR')).toBe('pt-BR');
    expect(checkoutLocale('ar')).toBe('auto');
    expect(checkoutLocale('hi')).toBe('auto');
    expect(checkoutLocale(undefined)).toBe('auto');
  });

  test('asks Stripe for a one-time card donation in US cents that returns to this Worker', () => {
    const params = checkoutSessionParams({ amount: 25, locale: 'es' }, ORIGIN);
    expect(params.get('mode')).toBe('payment');
    expect(params.get('submit_type')).toBe('donate');
    expect(params.get('payment_method_types[0]')).toBe('card');
    expect(params.get('line_items[0][price_data][currency]')).toBe('usd');
    expect(params.get('line_items[0][price_data][unit_amount]')).toBe('2500');
    expect(params.get('custom_fields[0][optional]')).toBe('true');
    expect(params.get('locale')).toBe('es');
    expect(params.get('success_url')).toBe(`${ORIGIN}/v1/return?result=complete`);
    expect(params.get('cancel_url')).toBe(`${ORIGIN}/v1/return?result=cancelled`);
  });

  test('returns the checkout URL Stripe creates', async () => {
    const fetchImpl = stripeReturning(200, { url: 'https://checkout.stripe.com/c/pay/cs_1' });
    const response = await handleRequest(checkoutRequest({ amount: 10, locale: 'de' }), ENV, {
      fetchImpl,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_1' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(init.headers.Authorization).toBe('Bearer rk_test_123');
    expect(new URLSearchParams(init.body).get('line_items[0][price_data][unit_amount]')).toBe(
      '1000'
    );
  });

  test('rejects bad requests before calling Stripe', async () => {
    const fetchImpl = jest.fn();
    const send = (request, env = ENV) => handleRequest(request, env, { fetchImpl });

    expect((await send(checkoutRequest({ amount: 0 }))).status).toBe(400);
    expect((await send(checkoutRequest('{not json'))).status).toBe(400);
    expect((await send(checkoutRequest('x'.repeat(2048)))).status).toBe(413);
    expect((await send(new Request(`${ORIGIN}/v1/checkout`))).status).toBe(405);
    expect((await send(checkoutRequest({ amount: 5 }), {})).status).toBe(503);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('reports a Stripe failure without passing on its details', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const fetchImpl = stripeReturning(401, { error: { message: 'Invalid API Key provided' } });
    const response = await handleRequest(checkoutRequest({ amount: 5 }), ENV, { fetchImpl });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'checkout_unavailable' });
    console.error.mockRestore();
  });

  test('turns away an address over the rate limit', async () => {
    const limit = jest.fn(async () => ({ success: false }));
    const fetchImpl = jest.fn();
    const response = await handleRequest(
      checkoutRequest({ amount: 5 }, { 'CF-Connecting-IP': '203.0.113.9' }),
      { ...ENV, CHECKOUT_LIMITER: { limit } },
      { fetchImpl }
    );

    expect(response.status).toBe(429);
    expect(limit).toHaveBeenCalledWith({ key: '203.0.113.9' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('serves a locked-down return page for each outcome', async () => {
    const complete = await handleRequest(new Request(`${ORIGIN}/v1/return?result=complete`), ENV);
    expect(complete.status).toBe(200);
    expect(complete.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(await complete.text()).toContain('Thank you for supporting HA Desktop Widget');

    const other = await handleRequest(new Request(`${ORIGIN}/v1/return?result=<script>`), ENV);
    expect(await other.text()).toContain('Nothing was charged');

    expect((await handleRequest(new Request(`${ORIGIN}/elsewhere`), ENV)).status).toBe(404);
  });
});
