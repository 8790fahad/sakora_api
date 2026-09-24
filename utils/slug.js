const slugify = (value = "") =>
  String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 60) || "store";

const uniqueSlug = async (db, base, excludeBusinessId = null) => {
  let slug = slugify(base);
  let attempt = 0;
  while (true) {
    const candidate = attempt === 0 ? slug : `${slug}-${attempt + 1}`;
    const existing = await db.Business.findOne({
      where: { storefrontSlug: candidate },
      paranoid: false,
    });
    if (!existing || existing.id === excludeBusinessId) {
      return candidate;
    }
    attempt += 1;
  }
};

module.exports = { slugify, uniqueSlug };
