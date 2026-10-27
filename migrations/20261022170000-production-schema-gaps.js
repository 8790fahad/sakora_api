"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const products = await queryInterface.describeTable("products");
    if (!products.expiry_date) {
      await queryInterface.addColumn("products", "expiry_date", {
        type: Sequelize.DATEONLY,
        allowNull: true,
      });
    }

    const tables = await queryInterface.showAllTables();
    const names = tables.map((table) =>
      typeof table === "string" ? table : table.tableName || table.TABLE_NAME
    );

    if (!names.includes("quotations")) {
      await queryInterface.createTable("quotations", {
        id: {
          type: Sequelize.CHAR(36),
          primaryKey: true,
          allowNull: false,
        },
        business_id: {
          type: Sequelize.CHAR(36),
          allowNull: false,
        },
        branch_id: {
          type: Sequelize.CHAR(36),
          allowNull: false,
        },
        customer_id: {
          type: Sequelize.CHAR(36),
          allowNull: true,
        },
        created_by: {
          type: Sequelize.CHAR(36),
          allowNull: false,
        },
        quotation_number: {
          type: Sequelize.STRING,
          allowNull: false,
        },
        date: {
          type: Sequelize.DATEONLY,
          allowNull: false,
        },
        customer_name: {
          type: Sequelize.STRING,
          allowNull: false,
        },
        customer_phone: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        customer_email: {
          type: Sequelize.STRING,
          allowNull: true,
        },
        subtotal: {
          type: Sequelize.DECIMAL(15, 2),
          allowNull: false,
          defaultValue: 0,
        },
        tax_amount: {
          type: Sequelize.DECIMAL(15, 2),
          allowNull: false,
          defaultValue: 0,
        },
        total: {
          type: Sequelize.DECIMAL(15, 2),
          allowNull: false,
          defaultValue: 0,
        },
        notes: {
          type: Sequelize.TEXT,
          allowNull: true,
        },
        status: {
          type: Sequelize.ENUM("open", "cancelled"),
          allowNull: false,
          defaultValue: "open",
        },
        inventory_reduced: {
          type: Sequelize.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
        },
        deleted_at: {
          type: Sequelize.DATE,
          allowNull: true,
        },
      });
      await queryInterface.addIndex("quotations", ["business_id", "quotation_number"], {
        unique: true,
        name: "quotations_business_number_unique",
      });
    }

    if (!names.includes("quotation_items")) {
      await queryInterface.createTable("quotation_items", {
        id: {
          type: Sequelize.CHAR(36),
          primaryKey: true,
          allowNull: false,
        },
        quotation_id: {
          type: Sequelize.CHAR(36),
          allowNull: false,
        },
        product_id: {
          type: Sequelize.CHAR(36),
          allowNull: true,
        },
        position: {
          type: Sequelize.INTEGER,
          allowNull: false,
          defaultValue: 0,
        },
        description: {
          type: Sequelize.STRING,
          allowNull: false,
        },
        unit: {
          type: Sequelize.STRING,
          allowNull: false,
          defaultValue: "pcs",
        },
        quantity: {
          type: Sequelize.DECIMAL(15, 3),
          allowNull: false,
        },
        unit_price: {
          type: Sequelize.DECIMAL(15, 2),
          allowNull: false,
        },
        total_price: {
          type: Sequelize.DECIMAL(15, 2),
          allowNull: false,
        },
        created_at: {
          type: Sequelize.DATE,
          allowNull: false,
        },
        updated_at: {
          type: Sequelize.DATE,
          allowNull: false,
        },
        deleted_at: {
          type: Sequelize.DATE,
          allowNull: true,
        },
      });
    }
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    const names = tables.map((table) =>
      typeof table === "string" ? table : table.tableName || table.TABLE_NAME
    );
    if (names.includes("quotation_items")) {
      await queryInterface.dropTable("quotation_items");
    }
    if (names.includes("quotations")) {
      await queryInterface.dropTable("quotations");
    }
    const products = await queryInterface.describeTable("products");
    if (products.expiry_date) {
      await queryInterface.removeColumn("products", "expiry_date");
    }
  },
};
