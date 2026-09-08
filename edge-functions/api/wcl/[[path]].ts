import { onRequest as handleRequest } from "../../../server/entry";

// This route is source code and must be present in the Git repository.
export function onRequest(context: Parameters<typeof handleRequest>[0]) {
  return handleRequest(context);
}

export default onRequest;
