// Fixtures de capability-gate.yml.
// @ts-nocheck
declare const connector: any, supabaseClient: any, request: any, other: any;

async function handler() {
  // ruleid: releve-capability-invoked-outside-gate
  await connector.invokeCapability("user.reset_password", { upn: "x" }, {});
  // ruleid: releve-capability-invoked-outside-gate
  await connector.invokeCapability(request.tool, request.args, {});
  // ruleid: releve-capability-invoked-outside-gate
  const fn = connector.invokeCapability;
  // ruleid: releve-capability-invoked-outside-gate
  const g = connector["invokeCapability"];
  // ruleid: releve-capability-invoked-outside-gate
  const { invokeCapability } = connector;
  // ok: releve-capability-invoked-outside-gate
  await supabaseClient.functions.invoke("chat", { body: {} });
  // ok: releve-capability-invoked-outside-gate
  await other.invoke("x");
}
