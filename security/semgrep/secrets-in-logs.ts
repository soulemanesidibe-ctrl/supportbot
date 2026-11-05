// Fixtures de secrets-in-logs.yml.
// @ts-nocheck
declare const req: any, auth: any, log: any, logger: any, user: any, token: any, apiKey: any;

// --- releve-secret-in-console-log
// ruleid: releve-secret-in-console-log
console.log(token);
// ruleid: releve-secret-in-console-log
console.error("échec", user.password);
// ruleid: releve-secret-in-console-log
console.info({ token });
// ruleid: releve-secret-in-console-log
console.debug({ authorization: req.headers.get("authorization") });
// ruleid: releve-secret-in-console-log
console.log(`jeton=${token}`);
// ruleid: releve-secret-in-console-log
console.warn(apiKey);
// ok: releve-secret-in-console-log
console.log("jeton rafraîchi");
// ok: releve-secret-in-console-log
console.log({ userId: user.id, hasToken: Boolean(token) });
// ok: releve-secret-in-console-log
console.log(`utilisateur ${user.id} connecté`);

// --- releve-secret-in-logger
// ruleid: releve-secret-in-logger
log.info("connexion", token);
// ruleid: releve-secret-in-logger
logger.error("échec", { apiKey });
// ruleid: releve-secret-in-logger
log.info("x", { password: user.password });
// ok: releve-secret-in-logger
log.info("connexion", { userId: user.id, orgId: auth.orgId });
// ok: releve-secret-in-logger
log.info("jeton vérifié", { hasToken: true });

// --- releve-log-whole-request-or-env
// ruleid: releve-log-whole-request-or-env
console.log(req.headers);
// ruleid: releve-log-whole-request-or-env
console.log(Deno.env.toObject());
// ruleid: releve-log-whole-request-or-env
log.info("requête", Object.fromEntries(req.headers));
// ruleid: releve-log-whole-request-or-env
console.log(process.env);
// ok: releve-log-whole-request-or-env
console.log(req.method, new URL(req.url).pathname);
