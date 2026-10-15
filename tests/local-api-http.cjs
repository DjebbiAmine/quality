'use strict';
const assert = require('node:assert/strict');
const { app } = require('../local-api/server');

async function run() {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const statusResponse = await fetch(`${base}/quality/api/auth/status`);
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json();
    assert.equal(status.authRequired, true);
    assert.equal(status.storage, 'local-postgresql-minio');
    assert.equal(statusResponse.headers.get('x-powered-by'), null);

    const noSession = await fetch(`${base}/quality/api/state`);
    assert.equal(noSession.status, 401);
    assert.equal((await noSession.json()).code, 'AUTH_REQUIRED');
    const noDashboardSession = await fetch(`${base}/quality/api/dashboard/summary`);
    assert.equal(noDashboardSession.status, 401);
    const noAudioSession = await fetch(`${base}/quality/api/audio/audio-test`);
    assert.equal(noAudioSession.status, 401);

    const csrfResponse = await fetch(`${base}/quality/api/auth/csrf`);
    assert.equal(csrfResponse.status, 200);
    const { csrfToken } = await csrfResponse.json();
    assert.ok(csrfToken && csrfToken.length >= 32);
    const cookie = (csrfResponse.headers.get('set-cookie') || '').split(';')[0];
    assert.match(cookie, /^qc_csrf=/);

    const blockedWrite = await fetch(`${base}/quality/api/state`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: 1, data: {} })
    });
    assert.equal(blockedWrite.status, 403);
    assert.equal((await blockedWrite.json()).code, 'CSRF');

    const csrfButNoSession = await fetch(`${base}/quality/api/state`, {
      method: 'PUT', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken, cookie },
      body: JSON.stringify({ version: 1, data: {} })
    });
    assert.equal(csrfButNoSession.status, 401);
    assert.equal((await csrfButNoSession.json()).code, 'AUTH_REQUIRED');

    const initializeEmptyNoSession = await fetch(`${base}/quality/api/state/initialize-empty`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken, cookie }, body: '{}'
    });
    assert.equal(initializeEmptyNoSession.status, 401, 'L’initialisation vide doit rester protégée par une session authentifiée.');
    assert.equal((await initializeEmptyNoSession.json()).code, 'AUTH_REQUIRED');

    const removedLocalImport = await fetch(`${base}/quality/api/state/import-local`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken, cookie }, body: JSON.stringify({ data: {} })
    });
    assert.equal(removedLocalImport.status, 404, 'Aucune route d’import des données locales ne doit être publiée.');

    const staticApp = await fetch(`${base}/`);
    assert.equal(staticApp.status, 200);
    assert.match(staticApp.headers.get('content-type') || '', /text\/html/i);
    const secrets = await fetch(`${base}/.env.example`);
    assert.equal(secrets.status, 404);
    console.log('Local API HTTP/auth smoke tests passed (no database or MinIO required).');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
