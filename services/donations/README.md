# Donations

A Cloudflare Worker that lets people donate by card from inside the app, without
a GitHub account. GitHub Sponsors stays the main way to give and the only way to
give monthly; this covers one-time card donations.

## How it works

1. **Donate by card** in the app's Support dialog asks the main process
   ([`src/card-donation.cjs`](../../src/card-donation.cjs)) to start a checkout.
2. The main process `POST`s `{"amount": 5, "locale": "de"}` to
   `https://donate.hadesktopwidget.com/v1/checkout`. The Worker creates a Stripe
   Checkout session (one-time, US dollars, cards only) and returns its
   `checkout.stripe.com` URL.
3. The app opens that page in a window of its own. The window has no preload,
   runs sandboxed in a throwaway session that grants no permissions, and only
   stays on `*.stripe.com`. Card details go from that page to Stripe and nowhere
   else.
4. When the donor pays or cancels, Stripe sends the window to `/v1/return`. The
   app closes the window on that navigation and thanks the donor. The page at
   `/v1/return` is only a fallback.

Checkout asks for an optional "Name for the sponsors list", stored on the
payment as the `sponsor_name` custom field. Add those names to `SPONSORS.md` by
hand, as with GitHub sponsors.

Cards only: other payment methods can hand off to a bank's or provider's site,
which the checkout window does not open. Apple Pay and Google Pay don't work
inside Electron, so Checkout doesn't offer them there.

## Deploying

You need a Stripe account with payouts set up. The free Cloudflare plan is
enough.

1. In the Stripe dashboard, create a **restricted key** with only
   **Checkout Sessions: Write** permission. The Worker needs nothing else, so a
   leaked key can't read payments or customers.
2. In Stripe's public business details, set the name and statement descriptor
   donors will see, such as "HA Desktop Widget".
3. Deploy:

```bash
cd services/donations
npx wrangler login
npx wrangler secret put STRIPE_SECRET_KEY   # the restricted key from step 1
npx wrangler deploy
```

The `[[routes]]` block in `wrangler.toml` serves the Worker on
`donate.hadesktopwidget.com`, which needs the `hadesktopwidget.com` zone on
Cloudflare. If the domain stays elsewhere, delete that block, deploy, and set
`DONATION_SERVICE_URL` in `src/card-donation.cjs` to the `*.workers.dev`
URL that `wrangler deploy` prints.

Deploy the Worker before a release with the card button ships. Until then the
button shows "Could not open card checkout".

Try it with a test-mode key (`rk_test_...`) and Stripe's test card
`4242 4242 4242 4242` first, then switch the secret to the live key.

## Abuse

Creating a Checkout session costs nothing and charges nothing. Stripe's hosted
Checkout and Radar handle card-testing attempts on the payment itself. The
Worker also allows at most 10 sessions a minute from one address (the
`CHECKOUT_LIMITER` binding in `wrangler.toml`). The address is only handed to
the limiter and never stored, and Workers Logs stay off.

## Fees

Stripe charges its card fee on each donation: about 3% plus a fixed fee per
charge, more for cards from other countries or currencies. GitHub Sponsors charges nothing for personal accounts, which is why it stays
the dialog's main button.
