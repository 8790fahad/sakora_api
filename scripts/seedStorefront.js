require("dotenv").config();
const db = require("../models");
const { uniqueSlug } = require("../utils/slug");

const products = [
  {
    name: "Premium Rice 5kg",
    description: "Long grain rice for everyday cooking",
    sellingPrice: 8500,
    costPrice: 6200,
    opening: 40,
  },
  {
    name: "Cooking Oil 2L",
    description: "Vegetable oil for the kitchen",
    sellingPrice: 4200,
    costPrice: 3000,
    opening: 25,
  },
  {
    name: "Tomato Paste Pack",
    description: "Rich tomato paste, pack of 3",
    sellingPrice: 1800,
    costPrice: 1100,
    opening: 60,
  },
];

async function run() {
  await db.sequelize.authenticate();
  const business = await db.Business.findOne({
    order: [["createdAt", "ASC"]],
  });
  if (!business) {
    console.log("No business found. Register an account first.");
    process.exit(1);
  }

  const slug = await uniqueSlug(db, business.name, business.id);
  await business.update({
    storefrontSlug: business.storefrontSlug || slug,
    storefrontEnabled: true,
    storefrontSettings: {
      tagline: "Fresh stock. Pay securely with Squad.",
      shippingFee: 500,
      allowNotes: true,
    },
  });

  const branch =
    (await db.Branch.findOne({
      where: { businessId: business.id, isMainBranch: true },
    })) ||
    (await db.Branch.findOne({ where: { businessId: business.id } }));

  const existingCount = await db.Product.count({
    where: { businessId: business.id },
  });

  if (existingCount === 0) {
    for (const item of products) {
      const product = await db.Product.create({
        businessId: business.id,
        name: item.name,
        description: item.description,
        sellingPrice: item.sellingPrice,
        costPrice: item.costPrice,
        unit: "piece",
        status: "active",
        isOnline: true,
        isFeatured: true,
        trackInventory: true,
      });
      if (branch) {
        await db.Inventory.create({
          productId: product.id,
          branchId: branch.id,
          quantity: item.opening,
          reorderPoint: 5,
          averageCostPrice: item.costPrice,
          lastStockUpdate: new Date(),
        });
      }
    }
    console.log("Created demo storefront products");
  } else {
    await db.Product.update(
      { isOnline: true },
      { where: { businessId: business.id } }
    );
    console.log("Marked existing products as online");
  }

  console.log(`Storefront ready: /shop/${business.storefrontSlug}`);
  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
