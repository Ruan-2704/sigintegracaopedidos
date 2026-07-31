function criarCache(ttl) {
  return {
    data: null,
    updatedAt: 0,
    ttl: Number(ttl || 0),
  };
}

function cacheValido(cacheItem) {
  return Boolean(cacheItem?.data && Date.now() - cacheItem.updatedAt < cacheItem.ttl);
}

function salvarCache(cacheItem, data, extra = {}) {
  cacheItem.data = data;
  cacheItem.updatedAt = Date.now();

  Object.assign(cacheItem, extra);

  return data;
}

function invalidarCache(cacheItem) {
  cacheItem.data = null;
  cacheItem.updatedAt = 0;
}

module.exports = {
  criarCache,
  cacheValido,
  salvarCache,
  invalidarCache,
};
