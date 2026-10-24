// A fetch that answers from a function, the way the browser's does.
export function res(status, body = '', headers = {}) {
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return { status, headers: { get: (k) => h[k.toLowerCase()] ?? null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
}

/** A fetch whose calls are recorded: answer(url, init) gives the response. */
export function fakeFetch(answer) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, init, method: init.method || 'GET', headers: init.headers || {}, body: init.body });
    return answer(url, init);
  };
  f.calls = calls;
  return f;
}
