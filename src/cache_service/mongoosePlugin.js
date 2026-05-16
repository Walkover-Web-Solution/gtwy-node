import { invalidateByTag } from "./index.js";

// Auto-busts cache on doc mutations.
// Opts: { tags?: string[], invalidate?: (doc, ctx) => any } where ctx = { op, update }.
// Does NOT fire on bulkWrite, $merge/$out aggregates, or raw driver calls.
// In transactions, hooks fire pre-commit — pair with an explicit post-commit DEL.
export function cacheInvalidationPlugin(schema, opts = {}) {
  const tags = Array.isArray(opts.tags) ? opts.tags : [];
  const customInvalidate = typeof opts.invalidate === "function" ? opts.invalidate : null;

  if (tags.length === 0 && !customInvalidate) return;

  const run = (doc, ctx) => {
    if (doc && doc._id) {
      for (const tag of tags) {
        invalidateByTag(tag, doc._id).catch((e) => console.error(`auto-invalidate(${tag}) failed:`, e));
      }
    }
    if (customInvalidate) {
      Promise.resolve()
        .then(() => customInvalidate(doc, ctx))
        .catch((e) => console.error("auto-invalidate(custom) failed:", e));
    }
  };

  schema.post("save", function (doc) {
    run(doc, { op: "save" });
  });

  ["findOneAndUpdate", "findOneAndDelete", "findOneAndReplace"].forEach((op) => {
    schema.post(op, function (doc) {
      run(doc, { op, update: this.getUpdate ? this.getUpdate() : null });
    });
  });

  const bulkOps = ["updateOne", "updateMany", "deleteOne", "deleteMany"];

  schema.pre(bulkOps, async function () {
    try {
      const filter = this.getQuery();
      if (!filter || Object.keys(filter).length === 0) {
        this._cacheInvalidateIds = [];
        return;
      }
      const docs = await this.model.find(filter).select({ _id: 1 }).lean();
      this._cacheInvalidateIds = docs.map((d) => d._id);
    } catch (e) {
      console.error("auto-invalidate pre-fetch failed:", e);
      this._cacheInvalidateIds = [];
    }
  });

  schema.post(bulkOps, function () {
    const ids = this._cacheInvalidateIds || [];
    const update = this.getUpdate ? this.getUpdate() : null;
    const op = this.op;
    for (const id of ids) run({ _id: id }, { op, update });
  });
}
