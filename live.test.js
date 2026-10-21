const assert = require("node:assert/strict");
const http = require("http");
const { io: connect } = require("socket.io-client");
const { attachLive } = require("./utils/live");

const server = http.createServer();
const io = attachLive(server);

server.listen(0, () => {
  const port = server.address().port;
  const socket = connect(`http://127.0.0.1:${port}`, {
    transports: ["websocket"],
  });
  let finished = false;

  const fail = setTimeout(() => {
    if (finished) return;
    console.error("socket test timed out");
    process.exit(1);
  }, 4000);

  socket.on("connect", () => {
    socket.emit("join", "ada-shop");
    setTimeout(() => {
      io.to("shop:ada-shop").emit("stock", { products: [{ id: "p1", stock: 7 }] });
    }, 50);
  });
  socket.on("stock", (payload) => {
    finished = true;
    clearTimeout(fail);
    assert.equal(payload.products[0].id, "p1");
    assert.equal(payload.products[0].stock, 7);
    socket.close();
    server.close(() => {
      console.log("storefront socket test passed");
    });
  });
});
