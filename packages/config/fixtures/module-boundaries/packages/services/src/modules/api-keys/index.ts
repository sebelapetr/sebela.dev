// The API-key entry: a module without dependencies on other modules.
export const createApiKey = (name: string): string => `key-for-${name}`;
