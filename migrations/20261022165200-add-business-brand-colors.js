"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("businesses");

    if (!table.primary_color) {
      await queryInterface.addColumn("businesses", "primary_color", {
        type: Sequelize.STRING(20),
        allowNull: true,
        defaultValue: "#0D9488",
      });
    }

    if (!table.secondary_color) {
      await queryInterface.addColumn("businesses", "secondary_color", {
        type: Sequelize.STRING(20),
        allowNull: true,
        defaultValue: "#134E4A",
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable("businesses");

    if (table.secondary_color) {
      await queryInterface.removeColumn("businesses", "secondary_color");
    }
    if (table.primary_color) {
      await queryInterface.removeColumn("businesses", "primary_color");
    }
  },
};
