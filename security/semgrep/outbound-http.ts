// Fixtures de outbound-http.yml. `ruleid:` = la ligne suivante DOIT être signalée, `ok:` = non.
// @ts-nocheck
declare const url: string, deps: { fetch: typeof fetch }, fetchFn: typeof fetch;

// ruleid: releve-direct-fetch
const a = await fetch(url);
// ruleid: releve-direct-fetch
const b = await globalThis.fetch(url, { method: "POST" });
// ruleid: releve-direct-fetch
const c = await fetch(`https://exemple.fr/${url}`);

// ok: releve-direct-fetch
const d = await fetchFn(url);
// ok: releve-direct-fetch
const e = await deps.fetch(url);
// ok: releve-direct-fetch
const f = (this as any).fetchFn(url, {});
// ok: releve-direct-fetch
const g: typeof fetch = fetchFn;
