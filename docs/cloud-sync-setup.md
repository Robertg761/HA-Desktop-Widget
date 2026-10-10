# Cloud Sync: setting up the service

Cloud Sync lets people sign in with Google or GitHub and have their widget settings follow
them to every computer, with no sync app or folder to set up. It is the paid alternative to
the free, self-managed [folder sync](../README.md#profile-sync).

This guide is for whoever runs the service. It covers every account you need, deploying the
service, and pointing the app at it. Until the app knows the service address, the Cloud Sync
option stays hidden, so nothing here affects users until you ship a build that has it.

## How it fits together

- **The service** (`cloud-sync-service/`) is a Cloudflare Worker with a D1 (SQLite) database.
  It has no runtime dependencies.
- **Sign-in** happens in the user's browser with Google or GitHub. The service then hands the
  app a one-time code on a local loopback address. The app redeems it, with a PKCE verifier,
  for a session token that it encrypts locally with Electron's secure storage API. The service
  stores only a hash of each token.
- **The synced profile** is the same file folder sync writes. The service stores it exactly as
  the app sends it. If the user turns on encryption, it is ciphertext the service cannot read.
  Writes are compare-and-swap on a revision number, so two computers saving at once never
  overwrite each other.
- **Billing** is a yearly Stripe subscription. New accounts get a free trial (14 days by
  default). After it, saving changes needs a subscription, but downloading still works, so
  nobody is locked out of their own settings.

## What you need

| Account                | Used for                                    | Cost                                           |
| ---------------------- | ------------------------------------------- | ---------------------------------------------- |
| Cloudflare             | Running the Worker and D1 database          | Free plan to start; Workers Paid when you grow |
| Google Cloud           | "Sign in with Google"                       | Free                                           |
| GitHub                 | "Sign in with GitHub"                       | Free                                           |
| Stripe                 | Subscriptions                               | A share of each payment                        |
| A domain (recommended) | A stable address such as `sync.example.com` | Whatever your registrar charges                |

Check each provider's current pricing and limits before launch. They change.

You also need Node.js on your computer to run `wrangler`, Cloudflare's command-line tool. It
runs through `npx`, so there is nothing to install globally.

## 1. Cloudflare

1. Create a Cloudflare account and sign in on the command line:

   ```sh
   cd cloud-sync-service
   npx wrangler login
   ```

2. Create the database. The command prints a `database_id`:

   ```sh
   npx wrangler d1 create ha-widget-cloud-sync
   ```

3. Copy the configuration template and fill it in:

   ```sh
   cp wrangler.toml.example wrangler.toml
   ```

   Set `database_id` to the printed ID and `PUBLIC_URL` to the address the service will have.
   `wrangler.toml` is ignored by git, so your IDs stay out of the repository.

4. Create the tables:

   ```sh
   npx wrangler d1 migrations apply ha-widget-cloud-sync --remote
   ```

5. Choose the address. Either use the `*.workers.dev` address Cloudflare assigns on the first
   deploy, or add a custom domain to the Worker in the Cloudflare dashboard (**Workers & Pages →
   your Worker → Settings → Domains & Routes**). A custom domain is better, because changing
   the address later means re-registering it with Google, GitHub and Stripe. Set
   `PUBLIC_URL` to it.

## 2. Google sign-in

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project (for
   example "HA Desktop Widget Cloud Sync").
2. Under **APIs & Services → OAuth consent screen**, set it up for **External** users. The app
   name, a support email and links to your home page and privacy policy go here. Only the
   `openid` and `email` scopes are needed. They are non-sensitive, so the review is light.
3. Under **APIs & Services → Credentials**, create an **OAuth client ID** of type **Web
   application**, with this authorized redirect URI:

   ```
   <PUBLIC_URL>/v1/auth/callback/google
   ```

4. Store the client ID and secret as Worker secrets:

   ```sh
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```

5. Publish the consent screen when you are ready for real users. Google's basic sign-in
   scopes have an exception to the test-user restriction even in Testing mode. Use the
   Worker's `LAUNCH_MODE` and private email allowlist to control access before launch.
   See [Google's audience requirements](https://support.google.com/cloud/answer/15549945).

## 3. GitHub sign-in

1. On GitHub, open **Settings → Developer settings → OAuth Apps → New OAuth App**. Use an
   organization account if you have one, so the app is not tied to a person.
2. Set **Authorization callback URL** to:

   ```
   <PUBLIC_URL>/v1/auth/callback/github
   ```

3. Generate a client secret, then store both values:

   ```sh
   npx wrangler secret put GITHUB_CLIENT_ID
   npx wrangler secret put GITHUB_CLIENT_SECRET
   ```

If you leave out either provider's secrets, the service does not offer that sign-in and the
app hides its button.

When someone signs in with Google and GitHub using the same verified email address, both
sign-ins lead to one account.

## 4. Stripe

1. Create a Stripe account and complete its business profile.
2. **Product catalog → Add product**: "Cloud Sync", with a **recurring yearly** price. Copy
   the price ID (`price_...`) into `STRIPE_PRICE_ID` in `wrangler.toml`.
3. Turn on the **customer portal** (**Settings → Billing → Customer portal**) and allow
   cancelling and updating payment methods. The app's **Manage subscription** button opens it.
4. Store the secret key (use the test-mode key first):

   ```sh
   npx wrangler secret put STRIPE_SECRET_KEY
   ```

5. **Developers → Webhooks → Add endpoint** at `<PUBLIC_URL>/v1/billing/webhook`, sending these
   events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`

   The service reads each subscription back from Stripe rather than trusting the event's copy,
   since Stripe may deliver events out of order. If an event cannot be applied, the endpoint
   answers 500 and Stripe sends it again. When the app opens the account after Checkout, the
   service also settles a paid Checkout whose events never arrived. A restricted key therefore
   needs write access to Checkout Sessions, Customer portal and Subscriptions.

   Store its signing secret:

   ```sh
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```

**Tax.** Selling to consumers in many countries means collecting and filing sales tax and VAT.
The simplest route is a merchant of record, which takes on that work. Stripe offers this as
**Managed Payments** to eligible accounts. If yours is approved, follow Stripe's documentation
to use it with Checkout; if that needs an extra checkout-session parameter, add it where
`handleCheckout` builds the session in `cloud-sync-service/src/billing.js`. Otherwise use
**Stripe Tax**, or move billing to a merchant of record such as Paddle. All payment code lives
in `cloud-sync-service/src/billing.js` and its webhook, so switching providers means replacing
that file; nothing else reads anything but the `subscriptions` table.

If using Stripe Tax, set `STRIPE_AUTOMATIC_TAX = "true"` after configuring the appropriate
Stripe Tax registrations. Checkout will collect a billing address and calculate tax for new
subscriptions. Existing customers' billing address is updated when they check out again.
This setting does not register the business with tax authorities or replace tax advice.

**Pricing.** A single yearly price keeps card fees small relative to the payment. Per-payment
fixed fees take a large share of small monthly charges.

Leave the Stripe secrets out until billing is ready. The app then hides the Subscribe
button, and the service reports billing as unavailable.

## 5. Deploy and check

```sh
npx wrangler deploy
curl <PUBLIC_URL>/v1/health     # {"ok":true}
curl <PUBLIC_URL>/v1/config     # lists the sign-in providers you configured
```

For HA Desktop Widget 4.0, `cloud-sync-service/wrangler.production.toml` stages the live
Worker on its own D1 database. It has no public route and disables `workers.dev` and preview URLs. Deploy it
with `npx wrangler deploy --config wrangler.production.toml`. Its `LAUNCH_MODE = "prelaunch"`
setting lets `/v1/health` respond but rejects all other requests with 503, including sign-in,
profile writes, Checkout, and webhooks. Configure the live secrets on this Worker before
moving `sync.hadesktopwidget.com` to it. Changing `LAUNCH_MODE` to `public` requires a new
deployment. Set it to `private` with `PRIVATE_TEST_EMAILS` as a comma-separated list of
verified emails for a release rehearsal. Private mode denies other sign-ins and existing
sessions; it still accepts signed Stripe webhooks for allowlisted customers. An unknown
nonempty launch mode remains closed. Keep the Stripe live webhook disabled until the
public route points to the live Worker.

Migration `0003_unique_user_email.sql` adds a unique index on `users.email`, which fails if
two accounts already share an address. Before migrating a database that has had sign-ins,
check production for duplicates:

```sh
npx wrangler d1 execute ha-widget-cloud-sync-production --remote --config wrangler.production.toml --command "SELECT email, COUNT(*) FROM users WHERE email IS NOT NULL GROUP BY email HAVING COUNT(*) > 1;"
```

If it lists any address, merge those accounts or clear the extra `users.email` values first,
then migrate.

Apply all pending D1 migrations before deploying an updated Worker:

```sh
npx wrangler d1 migrations apply ha-widget-cloud-sync-production --remote --config wrangler.production.toml
```

The billing tables introduced in `0002_billing_checkouts.sql` track pending payment pages.
Checkout retries reuse the same page and Stripe idempotency key. New pages expire after
31 minutes. Account deletion expires an unpaid page or cancels its completed subscription
before removing the account. If a checkout request failed before its result could be
stored, deletion waits for that page's expiry. Checkout creation and deletion cannot run
at the same time for one account. Checkout stays unavailable until the API key, price ID,
and webhook signing secret are all configured.

## 6. Point the app at the service

Set `DEFAULT_CLOUD_SYNC_SERVICE_URL` in `src/cloud-sync-client.cjs` to your `PUBLIC_URL` and
release a build. The Cloud Sync option then appears under **Settings → Advanced → Profile
Syncing → Sync app**.

To try it before release, leave the default empty and start the app with the address in an
environment variable instead:

```sh
HA_WIDGET_CLOUD_SYNC_URL=https://sync.example.com npm start
```

The app only accepts `https` addresses, plus `http` on this computer for local development.

## Settings reference

| Setting                        | Where    | Meaning                                                                                                                                |
| ------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_URL`                   | `[vars]` | The service's public address. Must match the callback URLs registered with Google and GitHub.                                          |
| `LAUNCH_MODE`                  | `[vars]` | `prelaunch` closes all routes except health; `private` allows listed emails; `public` opens the service. Omit for an existing sandbox. |
| `PRIVATE_TEST_EMAILS`          | `[vars]` | Verified email addresses allowed when `LAUNCH_MODE` is `private`, separated by commas.                                                 |
| `TRIAL_DAYS`                   | `[vars]` | Days a new account can save changes without a subscription (default 14).                                                               |
| `ENTITLEMENT_MODE`             | `[vars]` | `subscription` (default), or `open` to let every signed-in account sync, such as for a free beta.                                      |
| `STRIPE_PRICE_ID`              | `[vars]` | The yearly price.                                                                                                                      |
| `STRIPE_AUTOMATIC_TAX`         | `[vars]` | `true` adds Stripe Tax to new Checkout subscriptions after registrations are configured.                                               |
| `GOOGLE_CLIENT_ID` / `_SECRET` | secret   | Google sign-in.                                                                                                                        |
| `GITHUB_CLIENT_ID` / `_SECRET` | secret   | GitHub sign-in.                                                                                                                        |
| `STRIPE_SECRET_KEY`            | secret   | Checkout and portal sessions, reading subscriptions and Checkouts, cancelling on account deletion.                                     |
| `STRIPE_WEBHOOK_SECRET`        | secret   | Verifying webhook deliveries.                                                                                                          |

## Running it locally

```sh
cd cloud-sync-service
npx wrangler d1 migrations apply ha-widget-cloud-sync --local
npx wrangler dev          # serves on http://127.0.0.1:8787
```

Put local secrets in `cloud-sync-service/.dev.vars` (ignored by git), set `PUBLIC_URL` to
`http://localhost:8787`, and register `http://localhost:8787/v1/auth/callback/<provider>` as an
extra redirect URI with Google and GitHub. Then run the app with
`HA_WIDGET_CLOUD_SYNC_URL=http://127.0.0.1:8787 npm start`.

The automated tests (`npm test`) run the whole service against its real migration on an
in-memory SQLite database, with Google, GitHub and Stripe simulated. They need no accounts.

## Before launch

- **Privacy policy.** It must describe what is stored:
  - each account's email address and Google or GitHub user ID;
  - a hash of each session token, the device name supplied during sign-in, and session times;
  - the synced profile, which is readable by the service unless the user turned on
    encryption;
  - the Stripe customer and subscription IDs.

  Payment details stay with Stripe.

- **Terms of service** for the subscription, including refunds.
- **Account deletion** is built in: **Delete Account...** in the app cancels any subscription
  and deletes everything stored for the account.
- **Backups.** D1 keeps point-in-time recovery for a limited window (**Time Travel**). Check its
  current retention and decide whether you need exports beyond it.
