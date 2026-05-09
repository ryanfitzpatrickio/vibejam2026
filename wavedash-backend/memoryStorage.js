export function createMemoryStorage(initialEntries = null) {
  const values = new Map(initialEntries ?? []);

  return {
    async get(key) {
      return values.has(key) ? values.get(key) : undefined;
    },

    async put(key, value) {
      values.set(key, value);
    },

    async delete(key) {
      values.delete(key);
    },

    async list() {
      return new Map(values);
    },
  };
}
