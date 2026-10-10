// The stored sync file. The service keeps it exactly as the app wrote it: an
// encrypted file stays unreadable here, and a plaintext one is never altered.
// Writes are compare-and-swap on a revision number exposed as the ETag, so two
// devices writing at once cannot silently overwrite each other.

import { authenticate, getEntitlement, unauthorized } from './accounts.js';
import { errorResponse, json, readTextBody } from './util.js';

// Matches the limit the desktop app enforces on sync files.
export const MAX_PROFILE_BYTES = 512 * 1024;

function etag(revision) {
  return `"${revision}"`;
}

function parseEtag(value) {
  const match = /^(?:W\/)?"(\d{1,15})"$/.exec((value || '').trim());
  return match ? Number(match[1]) : null;
}

export async function handleGetProfile(request, env, deps) {
  const session = await authenticate(request, env, deps);
  if (!session) return unauthorized();
  const profile = await env.DB.prepare('SELECT revision, body FROM profiles WHERE user_id = ?')
    .bind(session.userId)
    .first();
  if (!profile) return errorResponse(404, 'not_found', 'No settings have been synced yet.');
  if (parseEtag(request.headers.get('If-None-Match')) === profile.revision) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag(profile.revision), 'Cache-Control': 'no-store' },
    });
  }
  return new Response(profile.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ETag: etag(profile.revision),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function handlePutProfile(request, env, deps) {
  const session = await authenticate(request, env, deps);
  if (!session) return unauthorized();
  const entitlement = await getEntitlement(env, deps, session);
  if (!entitlement.entitled) {
    return errorResponse(
      402,
      'subscription_required',
      'Cloud sync needs an active subscription to save changes.'
    );
  }

  const ifMatch = request.headers.get('If-Match');
  const createOnly = (request.headers.get('If-None-Match') || '').trim() === '*';
  const expectedRevision = parseEtag(ifMatch);
  if (!createOnly && expectedRevision === null) {
    return errorResponse(
      428,
      'precondition_required',
      'Send If-Match with the revision you read, or If-None-Match: * to create.'
    );
  }

  const body = await readTextBody(request, MAX_PROFILE_BYTES);
  if (body === null) {
    return errorResponse(413, 'too_large', 'The sync file is larger than 512 KB.');
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return errorResponse(400, 'invalid_profile', 'The sync file is not valid.');
  }
  if (typeof parsed.schemaVersion !== 'number' || !('payload' in parsed)) {
    return errorResponse(400, 'invalid_profile', 'The sync file is not valid.');
  }

  const now = deps.now();
  let result;
  let revision;
  if (createOnly) {
    revision = 1;
    result = await env.DB.prepare(
      'INSERT INTO profiles (user_id, revision, body, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO NOTHING'
    )
      .bind(session.userId, revision, body, now)
      .run();
  } else {
    revision = expectedRevision + 1;
    result = await env.DB.prepare(
      'UPDATE profiles SET revision = ?, body = ?, updated_at = ? WHERE user_id = ? AND revision = ?'
    )
      .bind(revision, body, now, session.userId, expectedRevision)
      .run();
  }
  if (!result.meta || result.meta.changes !== 1) {
    const current = await env.DB.prepare('SELECT revision FROM profiles WHERE user_id = ?')
      .bind(session.userId)
      .first();
    return errorResponse(
      412,
      'revision_conflict',
      'The synced settings changed on another device.',
      current ? { ETag: etag(current.revision) } : {}
    );
  }
  return json({ revision }, 200, { ETag: etag(revision) });
}
