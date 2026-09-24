const addColumnIfMissing = async (sequelize, table, column, definition) => {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [table, column] }
  );

  if (!rows.length) {
    try {
      await sequelize.query(
        `ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`
      );
      console.log(`✅ Added column ${table}.${column}`);
    } catch (error) {
      if (error?.parent?.code !== "ER_DUP_FIELDNAME") {
        throw error;
      }
    }
  }
};

const ensureSchema = async (sequelize) => {
  await addColumnIfMissing(
    sequelize,
    "products",
    "is_online",
    "TINYINT(1) NOT NULL DEFAULT 1"
  );
  await addColumnIfMissing(
    sequelize,
    "products",
    "is_featured",
    "TINYINT(1) NOT NULL DEFAULT 0"
  );
  await addColumnIfMissing(
    sequelize,
    "users",
    "permissions",
    "JSON NULL"
  );
  await addColumnIfMissing(
    sequelize,
    "users",
    "preferences",
    "JSON NULL"
  );
  await addColumnIfMissing(
    sequelize,
    "businesses",
    "storefront_slug",
    "VARCHAR(80) NULL"
  );
  await addColumnIfMissing(
    sequelize,
    "businesses",
    "storefront_enabled",
    "TINYINT(1) NOT NULL DEFAULT 0"
  );
  await addColumnIfMissing(
    sequelize,
    "businesses",
    "storefront_settings",
    "JSON NULL"
  );
  await addColumnIfMissing(
    sequelize,
    "businesses",
    "tax_tin",
    "VARCHAR(50) NULL"
  );
  await addColumnIfMissing(
    sequelize,
    "customers",
    "tin",
    "VARCHAR(50) NULL"
  );
  await addColumnIfMissing(
    sequelize,
    "suppliers",
    "tin",
    "VARCHAR(50) NULL"
  );
  await addColumnIfMissing(
    sequelize,
    "suppliers",
    "supplier_type",
    "ENUM('individual','company','government') NOT NULL DEFAULT 'individual'"
  );

  try {
    await sequelize.query(
      "ALTER TABLE customers MODIFY COLUMN customer_type ENUM('individual','business','company','government') NOT NULL DEFAULT 'individual'"
    );
    await sequelize.query(
      "UPDATE customers SET customer_type = 'company' WHERE customer_type = 'business'"
    );
    await sequelize.query(
      "ALTER TABLE customers MODIFY COLUMN customer_type ENUM('individual','company','government') NOT NULL DEFAULT 'individual'"
    );
  } catch (error) {
    console.warn("Customer type enum update skipped:", error.message);
  }

  try {
    const [rows] = await sequelize.query(
      `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'cash_transactions'
         AND COLUMN_NAME = 'reference_id'
         AND REFERENCED_TABLE_NAME IS NOT NULL`
    );
    for (const row of rows) {
      await sequelize.query(
        `ALTER TABLE cash_transactions DROP FOREIGN KEY \`${row.CONSTRAINT_NAME}\``
      );
      console.log(`✅ Dropped cash_transactions FK ${row.CONSTRAINT_NAME}`);
    }
  } catch (error) {
    console.warn("cash_transactions reference_id FK update skipped:", error.message);
  }
};

module.exports = { ensureSchema };
