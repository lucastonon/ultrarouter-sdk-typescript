// A hermetic stub GitHub REST API (issue comments + Check Runs) for the app-ci battery. It
// records every call and lets the tests assert idempotency (one comment/check per workflow) and the
// fail-closed Check Run conclusions — no real GitHub, no network.
import { createServer } from 'node:http';

/**
 * Start the stub; resolves to `{ url, state, close }`. `state` holds comments/checkRuns/calls.
 *
 * `options.routes` is an OPTIONAL extra handler consulted BEFORE the built-in comment/check routes
 * (the flywheel-ci battery adds its repository-write routes on top of this stub rather than
 * standing up a second forge). It receives `{ method, url, body, state, send }` and returns `true` when it handled
 * the request. Every call still lands in `state.calls`, so a merge attempt is visible either way.
 */
export function startStubGitHub(options = {}) {
  const routes = typeof options.routes === 'function' ? options.routes : null;
  const state = {
    comments: [],
    checkRuns: [],
    calls: [],
    nextCommentId: 1000,
    nextCheckId: 2000,
    ...(options.state ?? {}),
  };
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw === '' ? undefined : JSON.parse(raw);
      const url = req.url ?? '';
      const method = req.method ?? 'GET';
      state.calls.push({ method, url, body, auth: req.headers.authorization ?? null });
      const send = (obj, status = 200) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      let m;
      if (routes && routes({ method, url, body, state, send }) === true) return;
      if (method === 'GET' && /\/issues\/\d+\/comments/.test(url)) {
        return send(state.comments);
      }
      if (method === 'POST' && /\/issues\/\d+\/comments/.test(url)) {
        const c = { id: state.nextCommentId++, body: body?.body ?? '' };
        state.comments.push(c);
        return send(c, 201);
      }
      if (method === 'PATCH' && (m = url.match(/\/issues\/comments\/(\d+)/))) {
        const c = state.comments.find((x) => x.id === Number(m[1]));
        if (c) c.body = body?.body ?? c.body;
        return send(c ?? {}, 200);
      }
      if (method === 'GET' && /\/commits\/[^/]+\/check-runs/.test(url)) {
        return send({ check_runs: state.checkRuns });
      }
      if (method === 'POST' && /\/check-runs$/.test(url.split('?')[0])) {
        const c = {
          id: state.nextCheckId++,
          name: body?.name,
          head_sha: body?.head_sha,
          conclusion: body?.conclusion,
          status: body?.status,
          output: body?.output,
        };
        state.checkRuns.push(c);
        return send(c, 201);
      }
      if (method === 'PATCH' && (m = url.match(/\/check-runs\/(\d+)/))) {
        const c = state.checkRuns.find((x) => x.id === Number(m[1]));
        if (c) Object.assign(c, body);
        return send(c ?? {}, 200);
      }
      send({ message: 'stub: not found', url, method }, 404);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, state, close: () => server.close() });
    });
  });
}
