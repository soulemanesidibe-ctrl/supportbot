// Fixtures de secrets-flow.yml (analyse de flux).
// @ts-nocheck
declare const req: any, log: any, logger: any, user: any, token: any, apiKey: any;
declare function redact(v: any): string;

function flows() {
  // ruleid: releve-secret-flows-to-log
  console.log(JSON.stringify({ token }));

  const msg = "échec avec " + apiKey;
  // ruleid: releve-secret-flows-to-log
  console.error(msg);

  // ruleid: releve-secret-flows-to-log
  throw new Error(`échec avec ${apiKey}`);
}

function flowsLogger() {
  // ruleid: releve-secret-flows-to-log
  log.info("x", JSON.stringify(user.password));
  const copy = token;
  // ruleid: releve-secret-flows-to-log
  logger.warn("y", copy);
}

function safe() {
  // ok: releve-secret-flows-to-log
  console.log(Boolean(token));
  // ok: releve-secret-flows-to-log
  console.log(token.length);
  // ok: releve-secret-flows-to-log
  console.log({ hasToken: Boolean(token) });
  // ok: releve-secret-flows-to-log
  console.log("jeton rafraîchi");
  // ok: releve-secret-flows-to-log
  throw new Error("jeton invalide");
  // ok: releve-secret-flows-to-log
  console.log(redact(token));
  // ok: releve-secret-flows-to-log
  log.info("connexion", { userId: user.id });
}
