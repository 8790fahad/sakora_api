const { decryptSecret } = require("../utils/secretBox");

const readMerchantSquad = (business) => {
  if (!business?.squadEnabled) return null;
  let secretKey = "";
  try {
    secretKey = decryptSecret(business.squadSecretCipher || "");
  } catch (error) {
    return null;
  }
  const publicKey = String(business.squadPublicKey || "").trim();
  if (!secretKey || !publicKey) return null;
  return { secretKey, publicKey };
};

const publicSquadStatus = (business) => ({
  enabled: Boolean(business?.squadEnabled) && Boolean(readMerchantSquad(business)),
  publicKey: business?.squadPublicKey || "",
  hasSecret: Boolean(business?.squadSecretCipher),
});

module.exports = { readMerchantSquad, publicSquadStatus };
