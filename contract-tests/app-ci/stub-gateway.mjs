// A hermetic stub gateway serving only the compare-gate read (GET /v1/bench/runs/:id/gate) that
// `ur app-ci` consumes for a workflow's offline-replay verdict. The quality verdict always comes
// from that gate; app-ci adds no verdict engine of its own.
import { createServer } from 'node:http';

/** A canonical BenchCompareGate for a verdict (mirrors the fixture in test/cli.test.ts). */
export function gateFixture(verdict, extra = {}) {
  const ct = {
    call_type_id: 'ct_checkout',
    eval_run_id: 'er_cand',
    baseline_eval_run_id: 'er_base',
    verdict,
    quality: extra.quality ?? verdict,
    cost: extra.cost ?? verdict,
    quality_interval: { low: 0.01, high: 0.03, point: 0.02, n: 40, clusters: 40, bar: -0.05 },
    cost_interval: { low: 0.25, high: 0.35, point: 0.3, n: 40, clusters: 40, bar: 0.1 },
    quality_margin_pp: 5,
    cost_min_savings: 0.1,
    mde_pp: 2.3,
    cost_ceiling: {
      enabled: false,
      ceiling_micro_usd: null,
      observed_mean_micro_usd: null,
      breached: false,
    },
    pairing: {
      candidate_items: 40,
      eligible_pairs: 40,
      ineligible_missing_artifact: 0,
      unpaired: 0,
      eligible_clusters: 40,
    },
    reasons: extra.reasons ?? [],
  };
  return {
    object: 'bench_compare_gate',
    bench_run_id: 'br_run1',
    baseline_run_id: 'br_base1',
    verdict,
    cost_ceiling_micro_usd: null,
    call_types: [ct],
    reasons: ct.reasons,
  };
}

/** Start the stub gateway; `gatesByRunId` maps a `gateRunId` → a gate fixture. Resolves `{ url, close }`. */
export function startStubGateway(gatesByRunId) {
  const server = createServer((req, res) => {
    const url = req.url ?? '';
    const method = req.method ?? 'GET';
    const send = (obj, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    const m = url.match(/\/v1\/bench\/runs\/([^/?]+)\/gate/);
    if (method === 'GET' && m) {
      const gate = gatesByRunId[decodeURIComponent(m[1])];
      if (!gate)
        return send({ error: { code: 'not_found', message: 'no gate', type: 'not_found' } }, 404);
      return send(gate);
    }
    send({ error: { code: 'not_found', message: 'nope', type: 'not_found' } }, 404);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}
