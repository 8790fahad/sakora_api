const db = require("../models");
const { getAllowedOrigins, isOriginAllowed } = require("./origins");

let io = null;

function relayStock(message) {
  if (!io || message?.type !== "stock" || !message.slug) return;
  io.to(`shop:${message.slug}`).emit("stock", { products: message.products || [] });
}

function attachLive(httpServer) {
  const { Server } = require("socket.io");
  const allowedOrigins = getAllowedOrigins();

  io = new Server(httpServer, {
    cors: {
      origin(origin, callback) {
        callback(null, isOriginAllowed(origin, allowedOrigins));
      },
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    socket.on("join", (slug) => {
      if (typeof slug === "string" && /^[a-z0-9-]{1,80}$/i.test(slug)) {
        socket.join(`shop:${slug}`);
      }
    });
  });

  return io;
}

async function publishStock(businessId, productIds) {
  if (!io || !businessId || !productIds?.length) return;
  const business = await db.Business.findByPk(businessId, {
    attributes: ["id", "storefrontSlug", "storefrontEnabled"],
  });
  if (!business?.storefrontEnabled || !business.storefrontSlug) return;

  const branch =
    (await db.Branch.findOne({
      where: { businessId, isMainBranch: true },
    })) || (await db.Branch.findOne({ where: { businessId } }));

  const rows = await db.Inventory.findAll({
    where: {
      productId: productIds,
      ...(branch ? { branchId: branch.id } : {}),
    },
  });

  const products = rows.map((row) => ({
    id: row.productId,
    stock: Math.max(
      0,
      parseFloat(row.quantity || 0) - parseFloat(row.reservedQuantity || 0)
    ),
  }));

  const message = {
    type: "stock",
    slug: business.storefrontSlug,
    products,
  };
  relayStock(message);
  if (typeof process.send === "function") process.send(message);
}

function listenForStockRelay() {
  process.on("message", relayStock);
}

module.exports = { attachLive, publishStock, listenForStockRelay };
