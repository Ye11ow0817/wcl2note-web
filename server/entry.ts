import { gateway, type Env } from "./gateway";
export function onRequest({ request, env }: { request: Request; env: Env }) {
  return gateway(request, env);
}
