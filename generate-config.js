const fs = require("fs");
const path = require("path");

const projectRoot = __dirname;
const envPath = path.join(projectRoot, ".env");
const outputPath = path.join(projectRoot, "config.js");

// Браузер не читает .env напрямую, поэтому переносим ключ в config.js.
function parseEnv(content) {
  return content.split(/\r?\n/).reduce((accumulator, rawLine) => {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      return accumulator;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex === -1) {
      return accumulator;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    accumulator[key] = value;
    return accumulator;
  }, {});
}

if (!fs.existsSync(envPath)) {
  console.error("Файл .env не найден. Создайте его на основе .env.example.");
  process.exit(1);
}

const env = parseEnv(fs.readFileSync(envPath, "utf8"));
const apiKey = env.YANDEX_MAPS_API_KEY || "insert_your_yandex_maps_api_key_here";

const configContent = `window.APP_CONFIG = {
  YANDEX_MAPS_API_KEY: ${JSON.stringify(apiKey)}
};
`;

fs.writeFileSync(outputPath, configContent, "utf8");

if (
  !apiKey ||
  apiKey === "your_api_key_here" ||
  apiKey === "insert_your_yandex_maps_api_key_here"
) {
  console.warn("config.js создан с заглушкой. Замените ключ в .env и запустите генерацию снова.");
} else {
  console.log("config.js успешно создан из .env.");
}
