/**
 * 场景加载器
 * 从 scenarios/*.json 加载 Demo 场景数据
 */

const fs = require("fs");
const path = require("path");

const scenariosDir = path.join(__dirname, "..", "scenarios");

function loadScenarios() {
  const scenarios = {};
  if (!fs.existsSync(scenariosDir)) return scenarios;

  const files = fs.readdirSync(scenariosDir).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(scenariosDir, file), "utf-8"));
      Object.assign(scenarios, data);
    } catch (err) {
      console.error(`[Scenarios] 加载 ${file} 失败:`, err.message);
    }
  }
  return scenarios;
}

const scenarios = loadScenarios();

function getScenarioList() {
  return Object.values(scenarios).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    icon: s.icon,
  }));
}

function getScenario(id) {
  return scenarios[id] || scenarios[Object.keys(scenarios)[0]] || null;
}

module.exports = { scenarios, getScenarioList, getScenario };
