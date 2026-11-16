// Edge Function « chat » : conversation du salarié. Déployée avec verify_jwt = false (voir supabase/config.toml) : la vérification du
// jeton est faite ICI par requireOrgMember, car les nouvelles clés de la plateforme ne sont pas des JWT.
import { createChatHandler } from "../_shared/chat/handler.ts";
import { defaultChatPorts } from "../_shared/chat/ports.ts";
import { limiterFor } from "../_shared/ratelimit.ts";
import { registerConnectors } from "../_shared/connectors/register.ts";

registerConnectors();

Deno.serve(createChatHandler({ ports: defaultChatPorts, limits: { chat: limiterFor("chat"), widget: limiterFor("widget") } }));
