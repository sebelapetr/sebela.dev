// Production smoke check of the public edge (issue #234). Not implemented yet.

export const PAGES = [];
export const REFUSED = [];

export function smoke() {
  return Promise.reject(new Error("not implemented"));
}
