function resolveSellingMode({ storefrontEnabled, requested } = {}) {
  if (storefrontEnabled) {
    return { mode: "online", locked: true };
  }
  if (requested === "hybrid") {
    return { mode: "hybrid", locked: false };
  }
  return { mode: "online", locked: false };
}

module.exports = { resolveSellingMode };
