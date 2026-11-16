// Types partagés par les modules d'actions (évite les importations circulaires).
import type { AuthContext } from "../context.ts";
import type { CapabilityName, Connector } from "../capabilities/types.ts";

export type ConnectorFactoryLookup = (auth: AuthContext, name: CapabilityName) => Promise<Connector>;
