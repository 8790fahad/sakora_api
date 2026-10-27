const dropIndexIfExists = async (sequelize, table, indexName) => {
  const [rows] = await sequelize.query(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    { replacements: [table, indexName] }
  );
  if (rows.length) {
    await sequelize.query(`ALTER TABLE \`${table}\` DROP INDEX \`${indexName}\``);
  }
};

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
    "products",
    "vat_status",
    "VARCHAR(20) NOT NULL DEFAULT 'Vatable'"
  );
  await addColumnIfMissing(
    sequelize,
    "products",
    "kind",
    "VARCHAR(20) NOT NULL DEFAULT 'product'"
  );
  await addColumnIfMissing(sequelize, "products", "images", "JSON NULL");
  try {
    const [imageCols] = await sequelize.query(
      `SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'image'`
    );
    const imageType = String(imageCols[0]?.DATA_TYPE || "");
    if (imageCols.length && !/text/i.test(imageType)) {
      await sequelize.query(`ALTER TABLE products MODIFY COLUMN image LONGTEXT NULL`);
      console.log("✅ Widened products.image to LONGTEXT");
    }
  } catch (error) {
    console.warn("products.image column update skipped:", error.message);
  }
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
    "users",
    "email_verified",
    "TINYINT(1) NOT NULL DEFAULT 0"
  );
  await addColumnIfMissing(
    sequelize,
    "users",
    "email_verification_code",
    "VARCHAR(255) NULL"
  );
  await addColumnIfMissing(
    sequelize,
    "users",
    "email_verification_expires",
    "DATETIME NULL"
  );
  await addColumnIfMissing(
    sequelize,
    "users",
    "google_id",
    "VARCHAR(255) NULL"
  );
  await addColumnIfMissing(
    sequelize,
    "users",
    "password_reset_code",
    "VARCHAR(255) NULL"
  );
  await addColumnIfMissing(
    sequelize,
    "users",
    "password_reset_expires",
    "DATETIME NULL"
  );

  // Email is the only unique account field. Phone, Google id, and
  // business registration number may be shared across accounts.
  await dropIndexIfExists(sequelize, "users", "phone");
  await dropIndexIfExists(sequelize, "users", "users_phone_unique");
  await dropIndexIfExists(sequelize, "users", "users_google_id_unique");
  await dropIndexIfExists(sequelize, "businesses", "registration_number");
  await dropIndexIfExists(sequelize, "businesses", "businesses_registration_number_unique");

  // Existing accounts predate email verification — keep them signed-in capable.
  try {
    await sequelize.query(
      `UPDATE users
       SET email_verified = 1
       WHERE email_verified = 0
         AND (email_verification_code IS NULL OR email_verification_code = '')`
    );
  } catch (error) {
    console.warn("email_verified backfill skipped:", error.message);
  }
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
    "selling_mode",
    "VARCHAR(20) NOT NULL DEFAULT 'online'"
  );
  await addColumnIfMissing(
    sequelize,
    "businesses",
    "primary_color",
    "VARCHAR(20) NULL DEFAULT '#0D9488'"
  );
  await addColumnIfMissing(
    sequelize,
    "businesses",
    "secondary_color",
    "VARCHAR(20) NULL DEFAULT '#134E4A'"
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

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id CHAR(36) NOT NULL,
      business_id CHAR(36) NOT NULL,
      user_id CHAR(36) NOT NULL,
      subject VARCHAR(160) NOT NULL,
      status ENUM('open','closed') NOT NULL DEFAULT 'open',
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      deleted_at DATETIME NULL,
      PRIMARY KEY (id),
      KEY support_tickets_business (business_id)
    )
  `);
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS support_messages (
      id CHAR(36) NOT NULL,
      ticket_id CHAR(36) NOT NULL,
      business_id CHAR(36) NOT NULL,
      user_id CHAR(36) NULL,
      author ENUM('merchant','support') NOT NULL DEFAULT 'merchant',
      body TEXT NOT NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      deleted_at DATETIME NULL,
      PRIMARY KEY (id),
      KEY support_messages_ticket (ticket_id)
    )
  `);

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS newsletter_subscribers (
      id CHAR(36) NOT NULL,
      email VARCHAR(180) NOT NULL,
      source VARCHAR(40) NOT NULL DEFAULT 'website',
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      deleted_at DATETIME NULL,
      PRIMARY KEY (id),
      UNIQUE KEY newsletter_subscribers_email (email)
    )
  `);
  await addColumnIfMissing(
    sequelize,
    "newsletter_subscribers",
    "deleted_at",
    "DATETIME NULL"
  );

  await addColumnIfMissing(
    sequelize,
    "businesses",
    "referral_code",
    "VARCHAR(16) NULL"
  );
  await addColumnIfMissing(
    sequelize,
    "businesses",
    "referred_by_business_id",
    "CHAR(36) NULL"
  );

  try {
    await sequelize.query(
      `CREATE UNIQUE INDEX businesses_referral_code_unique ON businesses (referral_code)`
    );
  } catch (error) {
    if (!/Duplicate|exists/i.test(error.message || "")) {
      console.warn("businesses.referral_code unique index skipped:", error.message);
    }
  }

  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS referral_commissions (
      id CHAR(36) NOT NULL,
      referrer_business_id CHAR(36) NOT NULL,
      referred_business_id CHAR(36) NOT NULL,
      subscription_id CHAR(36) NOT NULL,
      payment_id CHAR(36) NOT NULL,
      amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
      rate DECIMAL(5,2) NOT NULL DEFAULT 20.00,
      currency VARCHAR(255) NOT NULL DEFAULT 'NGN',
      status ENUM('pending','approved','paid','cancelled') NOT NULL DEFAULT 'approved',
      paid_at DATETIME NULL,
      metadata JSON NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      deleted_at DATETIME NULL,
      PRIMARY KEY (id),
      UNIQUE KEY referral_commissions_payment_id (payment_id),
      KEY referral_commissions_referrer (referrer_business_id),
      KEY referral_commissions_referred (referred_business_id)
    )
  `);

  // Backfill referral codes for existing businesses
  try {
    const [missing] = await sequelize.query(
      `SELECT id FROM businesses WHERE referral_code IS NULL OR referral_code = ''`
    );
    for (const row of missing) {
      let code = null;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const candidate = require("crypto")
          .randomBytes(4)
          .toString("hex")
          .toUpperCase();
        const [taken] = await sequelize.query(
          `SELECT id FROM businesses WHERE referral_code = ? LIMIT 1`,
          { replacements: [candidate] }
        );
        if (!taken.length) {
          code = candidate;
          break;
        }
      }
      if (code) {
        await sequelize.query(
          `UPDATE businesses SET referral_code = ? WHERE id = ?`,
          { replacements: [code, row.id] }
        );
      }
    }
  } catch (error) {
    console.warn("referral_code backfill skipped:", error.message);
  }

  await addColumnIfMissing(
    sequelize,
    "sales",
    "bank_account_id",
    "VARCHAR(64) NULL"
  );
  await addColumnIfMissing(
    sequelize,
    "businesses",
    "squad_enabled",
    "TINYINT(1) NOT NULL DEFAULT 0"
  );
  await addColumnIfMissing(
    sequelize,
    "businesses",
    "squad_public_key",
    "VARCHAR(255) NULL"
  );
  await addColumnIfMissing(
    sequelize,
    "businesses",
    "squad_secret_cipher",
    "TEXT NULL"
  );

  try {
    await sequelize.query(
      "ALTER TABLE businesses MODIFY COLUMN subscription_plan VARCHAR(32) NOT NULL DEFAULT 'free'"
    );
    await sequelize.query(
      "ALTER TABLE subscriptions MODIFY COLUMN plan VARCHAR(32) NOT NULL DEFAULT 'free'"
    );
    await sequelize.query(
      "UPDATE businesses SET subscription_plan = 'growth' WHERE subscription_plan = 'basic'"
    );
    await sequelize.query(
      "UPDATE businesses SET subscription_plan = 'business' WHERE subscription_plan = 'premium'"
    );
    await sequelize.query(
      "UPDATE subscriptions SET plan = 'growth' WHERE plan = 'basic'"
    );
    await sequelize.query(
      "UPDATE subscriptions SET plan = 'business' WHERE plan = 'premium'"
    );
  } catch (error) {
    console.warn("subscription plan column update skipped:", error.message);
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
