// Fixtures de executor-gates.yml.
// @ts-nocheck
declare const connector: any;
declare function assertApprovedActionRequest(id: any): Promise<any>;
declare function assertCapabilityAllowed(name: any): any;

async function executeApprovedAction(id: string) {
  const approved = await assertApprovedActionRequest(id);
  // ok: releve-execute-without-approved-action-request
  await connector.invokeCapability(approved.capability, approved.params, {});
}

async function executeApprovedAction(id: string) {
  await assertApprovedActionRequest(id);
  // ok: releve-execute-without-approved-action-request
  await connector.invokeCapability("user.unlock", {}, {});
}

async function executeApprovedAction(id: string) {
  // ruleid: releve-execute-without-approved-action-request
  await connector.invokeCapability("user.reset_password", {}, {});
}

async function callCapability(name: string, params: any) {
  assertCapabilityAllowed(name);
  // ok: releve-call-capability-without-class-filter
  return connector.invokeCapability(name, params, {});
}

async function callCapability(name: string, params: any) {
  // ruleid: releve-call-capability-without-class-filter
  return connector.invokeCapability(name, params, {});
}
