const fs = require("fs");
const path = require("path");

const RULES_DIR = path.join(__dirname, "..", "rules");

function loadRules(ruleName = "default") {
  const filePath = path.join(RULES_DIR, `${ruleName}.json`);
  if (!fs.existsSync(filePath)) {
    console.warn(`[Rules] 规则文件不存在: ${filePath}，使用 default`);
    return loadRules("default");
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  const rules = JSON.parse(raw);
  resolveReferences(rules, rules);
  return rules;
}

function resolveReferences(obj, root) {
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === "string" && val.startsWith("$")) {
      const refPath = val.slice(1).split(".");
      let resolved = root;
      for (const seg of refPath) {
        resolved = resolved?.[seg];
      }
      if (resolved !== undefined) {
        obj[key] = resolved;
      }
    } else if (typeof val === "object" && val !== null) {
      resolveReferences(val, root);
    }
  }
}

function listRules() {
  if (!fs.existsSync(RULES_DIR)) return [];
  return fs.readdirSync(RULES_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(RULES_DIR, f), "utf-8"));
        return { name: data.name, label: data.label, version: data.version };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

module.exports = { loadRules, listRules };
