const assert = require("node:assert/strict");
const { resolveSellingMode } = require("./utils/sellingMode");

assert.deepEqual(resolveSellingMode({ requested: "hybrid" }), {
  mode: "hybrid",
  locked: false,
});

assert.deepEqual(resolveSellingMode({ requested: "online" }), {
  mode: "online",
  locked: false,
});

assert.deepEqual(
  resolveSellingMode({ storefrontEnabled: true, requested: "hybrid" }),
  { mode: "online", locked: true }
);

console.log("selling mode tests passed");
