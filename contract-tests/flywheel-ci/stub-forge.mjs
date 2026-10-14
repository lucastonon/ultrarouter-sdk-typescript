// The repository-WRITE half of the stub forge. It EXTENDS the stub GitHub
// (`../app-ci/stub-github.mjs`) through its `routes` hook rather than standing up a second forge, so
// one stub records comments, Check Runs AND writes in a single `state.calls` log.
//
// It deliberately implements `PUT /repos/:o/:r/pulls/:n/merge` — and answers 405. That is not a gap:
// the suite asserts that no merge request is ever MADE, and a route that exists but refuses proves
// the assertion is about the CLI's behaviour, not about the stub lacking the endpoint.
import { startStubGitHub } from '../app-ci/stub-github.mjs';

/**
 * Start the forge.
 *
 * @param {object} opts
 * @param {'granted'|'denied'|'error'} opts.repositoryWrite how `GET /repos/:o/:r` answers.
 * @param {Record<string,string>} [opts.files] seed blobs: `path` → blob sha.
 * @param {Record<string,string>} [opts.refs] seed refs: `branch` → commit sha.
 * @param {Record<string,string>} [opts.pulls] seed PRs: `number` → head branch ref.
 */
export function startStubForge(opts) {
  const files = new Map(Object.entries(opts.files ?? {}));
  const refs = new Map(
    Object.entries(opts.refs ?? { main: 'basesha0000000000000000000000000000000000' }),
  );
  const pulls = new Map(Object.entries(opts.pulls ?? {}));
  const forge = {
    branches: [],
    puts: [],
    pullRequests: [],
    mergeAttempts: [],
    permissionProbes: 0,
  };

  const routes = ({ method, url, body, state, send }) => {
    const path = url.split('?')[0];
    const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
    let m;

    // The scoped-write probe.
    if (method === 'GET' && /^\/repos\/[^/]+\/[^/]+$/.test(path)) {
      forge.permissionProbes += 1;
      if (opts.repositoryWrite === 'error') return (send({ message: 'boom' }, 500), true);
      send({ permissions: { push: opts.repositoryWrite === 'granted', pull: true } });
      return true;
    }
    // Resolve a branch ref.
    if (method === 'GET' && (m = path.match(/^\/repos\/[^/]+\/[^/]+\/git\/ref\/heads\/(.+)$/))) {
      const sha = refs.get(decodeURIComponent(m[1]));
      if (sha === undefined) return (send({ message: 'no ref' }, 404), true);
      send({ object: { sha } });
      return true;
    }
    // Create a branch ref.
    if (method === 'POST' && /^\/repos\/[^/]+\/[^/]+\/git\/refs$/.test(path)) {
      const ref = String(body?.ref ?? '');
      const branch = ref.replace(/^refs\/heads\//, '');
      if (refs.has(branch)) return (send({ message: 'Reference already exists' }, 422), true);
      refs.set(branch, String(body?.sha ?? ''));
      forge.branches.push(branch);
      send({ ref }, 201);
      return true;
    }
    // Read a blob sha.
    if (method === 'GET' && (m = path.match(/^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/))) {
      const sha = files.get(decodeURIComponent(m[1]));
      if (sha === undefined) return (send({ message: 'Not Found' }, 404), true);
      send({ sha });
      return true;
    }
    // Write a file (one commit per file).
    if (method === 'PUT' && (m = path.match(/^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/))) {
      const p = decodeURIComponent(m[1]);
      forge.puts.push({
        path: p,
        branch: body?.branch,
        message: body?.message,
        content: Buffer.from(String(body?.content ?? ''), 'base64').toString('utf8'),
        sha: body?.sha ?? null,
      });
      files.set(p, `blob-${String(forge.puts.length)}`);
      send({ content: { path: p } }, 201);
      return true;
    }
    // Merge — implemented AND refused, so an attempt is both visible and unsuccessful.
    if (method === 'PUT' && (m = path.match(/^\/repos\/[^/]+\/[^/]+\/pulls\/(\d+)\/merge$/))) {
      forge.mergeAttempts.push({ number: Number(m[1]), body });
      send({ message: 'ultrarouter never auto-merges' }, 405);
      return true;
    }
    // One Check Run per workflow / CURRENT HEAD: GitHub scopes this listing to the ref, and so
    // does the stub (the stub answers with every run, which would hide a per-head bug).
    if (
      method === 'GET' &&
      (m = path.match(/^\/repos\/[^/]+\/[^/]+\/commits\/([^/]+)\/check-runs$/))
    ) {
      const ref = decodeURIComponent(m[1]);
      send({ check_runs: state.checkRuns.filter((c) => c.head_sha === ref) });
      return true;
    }
    // List OPEN pull requests for a head branch (`?head=owner:branch`) — the idempotency lookup.
    if (method === 'GET' && /^\/repos\/[^/]+\/[^/]+\/pulls$/.test(path)) {
      const head = new URLSearchParams(query).get('head') ?? '';
      const branch = head.includes(':') ? head.slice(head.indexOf(':') + 1) : head;
      const open = forge.pullRequests
        .filter((p) => p.head === branch)
        .map((p) => ({
          number: p.number,
          html_url: `https://forge.invalid/pull/${String(p.number)}`,
        }));
      send(open);
      return true;
    }
    // Open a PR (never merged).
    if (method === 'POST' && /^\/repos\/[^/]+\/[^/]+\/pulls$/.test(path)) {
      const number = 900 + forge.pullRequests.length;
      forge.pullRequests.push({ number, ...body });
      pulls.set(String(number), String(body?.head ?? ''));
      send({ number, html_url: `https://forge.invalid/pull/${String(number)}`, draft: true }, 201);
      return true;
    }
    // Read an existing PR's head ref (the `attach` path).
    if (method === 'GET' && (m = path.match(/^\/repos\/[^/]+\/[^/]+\/pulls\/(\d+)$/))) {
      const head = pulls.get(m[1]);
      if (head === undefined) return (send({ message: 'no pr' }, 404), true);
      send({ number: Number(m[1]), head: { ref: head } });
      return true;
    }
    return false;
  };

  return startStubGitHub({ routes }).then((gh) => ({ ...gh, forge }));
}
