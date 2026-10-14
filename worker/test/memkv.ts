/** A Map-backed stand-in for the parts of KVNamespace the activity code uses. */
export function memKv() {
  const store = new Map<string, string>();
  const kv = {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => {
      store.set(k, v);
    },
    delete: async (k: string) => {
      store.delete(k);
    },
    list: async ({ prefix = "" }: { prefix?: string; cursor?: string } = {}) => ({
      keys: [...store.keys()].filter((name) => name.startsWith(prefix)).map((name) => ({ name })),
      list_complete: true,
      cursor: "",
    }),
  };
  return { store, kv: kv as unknown as KVNamespace };
}
