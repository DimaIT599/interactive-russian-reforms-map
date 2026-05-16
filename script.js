const DEFAULT_CENTER = [61, 90];
const DEFAULT_ZOOM = 3;

const state = {
  reforms: [],
  filteredReforms: [],
  map: null,
  ymaps: null,
  clusterer: null,
  connectionLayer: null,
  reformObjectsById: new Map(),
  selectedId: null
};

const elements = {};

const PERIOD_PRIORITY = {
  "XVIII век": 18,
  "XIX век": 19,
  "XX век": 20
};

let yandexMapsPromise = null;

document.addEventListener("DOMContentLoaded", initApp);

async function initApp() {
  cacheElements();
  bindEvents();

  try {
    state.reforms = await loadReforms();
  } catch (error) {
    console.error(error);
    setMapStatus("Не удалось загрузить данные.");
    showMapOverlay("Не получилось загрузить reforms.json. Проверьте, что файл лежит рядом с index.html.");
    elements.resultsSummary.textContent = "Данные о реформах не загружены.";
    elements.listCaption.textContent = "Список недоступен из-за ошибки загрузки данных.";
    elements.detailsCard.innerHTML = `
      <h3>Ошибка загрузки данных</h3>
      <p>Проверьте структуру файла <code>reforms.json</code> и перезапустите локальный сервер.</p>
    `;
    return;
  }

  populateFilters(state.reforms);
  renderLegend(state.reforms);
  elements.totalCount.textContent = String(state.reforms.length);

  const apiKey = getApiKey();

  if (apiKey) {
    await initializeMap(apiKey);
  } else {
    setMapStatus("Нужен API-ключ.");
    showMapOverlay("Добавьте ключ Яндекс.Карт в .env, затем выполните команду `node generate-config.js`.");
  }

  applyFilters();
}

function cacheElements() {
  elements.reformerFilter = document.getElementById("reformer-filter");
  elements.typeFilter = document.getElementById("type-filter");
  elements.periodFilter = document.getElementById("period-filter");
  elements.resetFilters = document.getElementById("reset-filters");
  elements.resultsSummary = document.getElementById("results-summary");
  elements.mapStatus = document.getElementById("map-status");
  elements.mapOverlay = document.getElementById("map-overlay");
  elements.mapOverlayText = document.getElementById("map-overlay-text");
  elements.detailsCard = document.getElementById("details-card");
  elements.reformList = document.getElementById("reform-list");
  elements.totalCount = document.getElementById("total-count");
  elements.visibleCount = document.getElementById("visible-count");
  elements.selectedPeriod = document.getElementById("selected-period");
  elements.typeLegend = document.getElementById("type-legend");
  elements.listCaption = document.getElementById("list-caption");
}

function bindEvents() {
  elements.reformerFilter.addEventListener("change", () => applyFilters());
  elements.typeFilter.addEventListener("change", () => applyFilters());
  elements.periodFilter.addEventListener("change", () => applyFilters());
  elements.resetFilters.addEventListener("click", resetFilters);
}

async function loadReforms() {
  const response = await fetch("reforms.json?v=20260516-1", { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Не удалось загрузить reforms.json: ${response.status}`);
  }

  const data = await response.json();

  if (!Array.isArray(data)) {
    throw new Error("Файл reforms.json должен содержать массив объектов.");
  }

  return data.map(normalizeReform);
}

function normalizeReform(reform) {
  const coordinates = normalizeCoordinates(reform.coordinates);
  const locations = resolveLocations(reform, coordinates);

  return {
    id: reform.id,
    name: String(reform.name || "Без названия"),
    reformer: String(reform.reformer || "Не указан"),
    year: reform.year,
    yearLabel: formatYear(reform.year),
    period: String(reform.period || "Период не указан"),
    type: String(reform.type || "Тип не указан"),
    region: String(reform.region || "Регион не указан"),
    coordinates,
    locations,
    goal: String(reform.goal || "Цель не указана."),
    measures: String(reform.measures || "Основные меры не указаны."),
    results: String(reform.results || "Последствия не указаны.")
  };
}

function normalizeCoordinates(rawCoordinates) {
  if (!Array.isArray(rawCoordinates) || rawCoordinates.length !== 2) {
    return null;
  }

  const coordinates = rawCoordinates.map(Number);
  return hasValidCoordinates(coordinates) ? coordinates : null;
}

function resolveLocations(reform, fallbackCoordinates) {
  const explicitLocations = normalizeLocationsArray(reform.locations, reform.region);

  if (explicitLocations.length > 0) {
    return explicitLocations;
  }

  if (hasValidCoordinates(fallbackCoordinates)) {
    return [
      {
        name: String(reform.region || "Ключевая точка"),
        coordinates: [...fallbackCoordinates]
      }
    ];
  }

  return [];
}

function normalizeLocationsArray(rawLocations, fallbackName) {
  if (!Array.isArray(rawLocations)) {
    return [];
  }

  return rawLocations
    .map((location, index) => normalizeLocation(location, fallbackName, index))
    .filter(Boolean);
}

function normalizeLocation(location, fallbackName, index) {
  if (Array.isArray(location)) {
    const coordinates = normalizeCoordinates(location);

    if (!coordinates) {
      return null;
    }

    return {
      name: `${fallbackName || "Точка"} ${index + 1}`,
      coordinates
    };
  }

  if (!location || typeof location !== "object") {
    return null;
  }

  const coordinates = normalizeCoordinates(location.coordinates || location.coords);

  if (!coordinates) {
    return null;
  }

  return {
    name: String(location.name || location.title || `${fallbackName || "Точка"} ${index + 1}`),
    coordinates
  };
}
async function initializeMap(apiKey) {
  setMapStatus("Загружаем Яндекс.Карты...");

  try {
    state.ymaps = await loadYandexMapsApi(apiKey);
    state.map = new state.ymaps.Map(
      "map",
      {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        controls: ["zoomControl", "fullscreenControl"]
      },
      {
        suppressMapOpenBlock: true
      }
    );

    state.connectionLayer = new state.ymaps.GeoObjectCollection();
    state.clusterer = new state.ymaps.Clusterer({
      preset: "islands#invertedDarkBlueClusterIcons",
      groupByCoordinates: false,
      clusterDisableClickZoom: false,
      clusterOpenBalloonOnClick: true
    });

    state.map.geoObjects.add(state.connectionLayer);
    state.map.geoObjects.add(state.clusterer);
    hideMapOverlay();
    setMapStatus("Карта готова.");
  } catch (error) {
    console.error(error);
    setMapStatus("Карта не загрузилась.");
    showMapOverlay("Проверьте API-ключ Яндекс.Карт, подключение к интернету и повторите запуск.");
  }
}

function loadYandexMapsApi(apiKey) {
  if (window.ymaps) {
    return new Promise((resolve) => {
      window.ymaps.ready(() => resolve(window.ymaps));
    });
  }

  if (yandexMapsPromise) {
    return yandexMapsPromise;
  }

  yandexMapsPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(apiKey)}&lang=ru_RU`;
    script.async = true;
    script.onload = () => {
      if (!window.ymaps) {
        reject(new Error("Yandex Maps API загружен, но объект ymaps не найден."));
        return;
      }

      window.ymaps.ready(() => resolve(window.ymaps));
    };
    script.onerror = () => reject(new Error("Не удалось подключить Яндекс.Карты."));
    document.head.append(script);
  });

  return yandexMapsPromise;
}

function populateFilters(reforms) {
  populateSelect(elements.reformerFilter, uniqueValues(reforms, "reformer"));
  populateSelect(elements.typeFilter, uniqueValues(reforms, "type"));
  populateSelect(elements.periodFilter, uniqueValues(reforms, "period", comparePeriods));
}

function populateSelect(select, values) {
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  });
}

function uniqueValues(reforms, key, customSorter = compareStrings) {
  return [...new Set(reforms.map((reform) => reform[key]).filter(Boolean))].sort(customSorter);
}

function compareStrings(first, second) {
  return first.localeCompare(second, "ru");
}

function comparePeriods(first, second) {
  const firstPriority = PERIOD_PRIORITY[first] || Number.MAX_SAFE_INTEGER;
  const secondPriority = PERIOD_PRIORITY[second] || Number.MAX_SAFE_INTEGER;

  if (firstPriority !== secondPriority) {
    return firstPriority - secondPriority;
  }

  return compareStrings(first, second);
}

function applyFilters() {
  const reformer = elements.reformerFilter.value;
  const type = elements.typeFilter.value;
  const period = elements.periodFilter.value;

  state.filteredReforms = state.reforms.filter((reform) => {
    const matchesReformer = reformer === "all" || reform.reformer === reformer;
    const matchesType = type === "all" || reform.type === type;
    const matchesPeriod = period === "all" || reform.period === period;

    return matchesReformer && matchesType && matchesPeriod;
  });

  elements.visibleCount.textContent = String(state.filteredReforms.length);
  elements.selectedPeriod.textContent = period === "all" ? "Все" : period;
  elements.resultsSummary.textContent = `Показано ${state.filteredReforms.length} из ${state.reforms.length} реформ.`;
  elements.listCaption.textContent = "Каждая реформа показывает точки, по которым она реально проходила или заметно меняла жизнь.";

  renderReformList();
  updateMapMarkers();
  syncSelectedCard();
}

function renderLegend(reforms) {
  const uniqueTypes = uniqueValues(reforms, "type");
  elements.typeLegend.innerHTML = "";

  uniqueTypes.forEach((type) => {
    const item = document.createElement("div");
    item.className = "legend__item";
    item.innerHTML = `
      <span class="legend__dot" style="background:${getTypeColor(type)}"></span>
      <span>${escapeHtml(type)}</span>
    `;
    elements.typeLegend.append(item);
  });
}

function renderReformList() {
  elements.reformList.innerHTML = "";

  if (state.filteredReforms.length === 0) {
    elements.reformList.innerHTML = `
      <div class="empty-state">
        По текущим фильтрам реформы не найдены. Попробуйте изменить период,
        тип реформы или выбрать другого реформатора.
      </div>
    `;
    return;
  }

  state.filteredReforms.forEach((reform) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "reform-list__button";
    button.dataset.reformId = String(reform.id);

    if (reform.id === state.selectedId) {
      button.classList.add("is-active");
    }

    button.innerHTML = `
      <p class="reform-list__title">${escapeHtml(reform.name)}</p>
      <p class="reform-list__meta">${escapeHtml(reform.reformer)} • ${escapeHtml(reform.region)} • ${formatLocationCount(reform.locations.length)}</p>
      <div class="reform-list__footer">
        <span class="chip">${escapeHtml(reform.type)}</span>
        <span class="reform-list__period">${escapeHtml(reform.yearLabel)}</span>
      </div>
    `;

    button.addEventListener("click", () => selectReform(reform.id, { centerMap: true, openBalloon: true }));
    elements.reformList.append(button);
  });
}

function updateMapMarkers() {
  if (!state.map || !state.clusterer || !state.connectionLayer) {
    return;
  }

  state.clusterer.removeAll();
  state.connectionLayer.removeAll();
  state.reformObjectsById.clear();

  state.filteredReforms.forEach((reform) => {
    const mapObjects = createReformGeoObjects(reform);

    if (mapObjects.placemarks.length === 0) {
      return;
    }

    state.clusterer.add(mapObjects.placemarks);
    state.reformObjectsById.set(reform.id, mapObjects);
  });

  applySelectionStyles();
  renderSelectedConnection();
  fitMapToVisibleReforms();
}

function createReformGeoObjects(reform) {
  const placemarks = reform.locations
    .filter((location) => hasValidCoordinates(location.coordinates))
    .map((location, index) => createPlacemark(reform, location, index));

  const connection = placemarks.length > 1
    ? createConnection(reform, placemarks.map((placemark) => placemark.geometry.getCoordinates()))
    : null;

  if (connection) {
    connection.events.add("click", () => selectReform(reform.id, { centerMap: true }));
  }

  return { reform, placemarks, connection };
}

function createPlacemark(reform, location, locationIndex) {
  const placemark = new state.ymaps.Placemark(
    location.coordinates,
    {
      hintContent: `${escapeHtml(reform.name)} • ${escapeHtml(location.name)}`,
      balloonContentHeader: escapeHtml(reform.name),
      clusterCaption: escapeHtml(reform.name),
      balloonContentBody: createBalloonContent(reform, location)
    },
    getPlacemarkOptions(reform.type, false)
  );

  placemark.events.add("click", () => {
    selectReform(reform.id, { focusLocationIndex: locationIndex });
  });

  return placemark;
}

function createConnection(reform, coordinates) {
  return new state.ymaps.Polyline(
    coordinates,
    {
      hintContent: `${escapeHtml(reform.name)} — связанная география реформы`
    },
    getConnectionOptions(reform.type, false)
  );
}

function getPlacemarkOptions(type, isSelected) {
  const baseColor = getTypeColor(type);

  return {
    preset: isSelected ? "islands#circleIcon" : "islands#circleDotIcon",
    iconColor: isSelected ? darkenHexColor(baseColor, 0.18) : baseColor,
    openBalloonOnClick: true,
    zIndex: isSelected ? 3000 : 1200
  };
}

function getConnectionOptions(type, isSelected) {
  const baseColor = getTypeColor(type);

  return {
    strokeColor: hexToRgba(baseColor, isSelected ? 0.95 : 0.42),
    strokeWidth: isSelected ? 4 : 2,
    strokeStyle: isSelected ? "solid" : "dash",
    zIndex: isSelected ? 2200 : 300,
    interactivityModel: "default#transparent"
  };
}

function applySelectionStyles() {
  state.reformObjectsById.forEach((mapObjects, reformId) => {
    const isSelected = reformId === state.selectedId;

    mapObjects.placemarks.forEach((placemark) => {
      placemark.options.set(getPlacemarkOptions(mapObjects.reform.type, isSelected));
    });

    if (mapObjects.connection) {
      mapObjects.connection.options.set(getConnectionOptions(mapObjects.reform.type, isSelected));
    }
  });
}

function renderSelectedConnection() {
  if (!state.connectionLayer) {
    return;
  }

  state.connectionLayer.removeAll();

  const selectedObjects = state.selectedId === null ? null : state.reformObjectsById.get(state.selectedId);

  if (selectedObjects && selectedObjects.connection) {
    state.connectionLayer.add(selectedObjects.connection);
  }
}

function fitMapToVisibleReforms() {
  const visibleCoordinates = state.filteredReforms.flatMap((reform) => getReformCoordinates(reform));
  fitMapToPoints(visibleCoordinates);
}

function fitMapToPoints(points) {
  if (!state.map) {
    return;
  }

  const validPoints = points.filter(hasValidCoordinates);

  if (validPoints.length === 0) {
    state.map.setCenter(DEFAULT_CENTER, DEFAULT_ZOOM, { duration: 250 });
    return;
  }

  if (validPoints.length === 1) {
    state.map.setCenter(validPoints[0], 5, { duration: 250 });
    return;
  }

  const bounds = calculateBounds(validPoints);

  if (
    bounds[0][0] === bounds[1][0] &&
    bounds[0][1] === bounds[1][1]
  ) {
    state.map.setCenter(bounds[0], 5, { duration: 250 });
    return;
  }

  state.map.setBounds(bounds, {
    checkZoomRange: true,
    zoomMargin: 56,
    duration: 250
  });
}

function calculateBounds(points) {
  const latitudes = points.map((point) => point[0]);
  const longitudes = points.map((point) => point[1]);

  return [
    [Math.min(...latitudes), Math.min(...longitudes)],
    [Math.max(...latitudes), Math.max(...longitudes)]
  ];
}

function selectReform(reformId, options = {}) {
  const { centerMap = false, openBalloon = false, focusLocationIndex = 0 } = options;
  const reform = state.reforms.find((item) => item.id === reformId);

  if (!reform) {
    return;
  }

  state.selectedId = reformId;
  renderDetailsCard(reform);
  renderReformList();
  applySelectionStyles();
  renderSelectedConnection();

  const mapObjects = state.reformObjectsById.get(reformId);

  if (!mapObjects || !state.map) {
    return;
  }

  const targetPlacemark = mapObjects.placemarks[focusLocationIndex] || mapObjects.placemarks[0] || null;
  const reformCoordinates = getReformCoordinates(reform);

  if (centerMap) {
    fitMapToPoints(reformCoordinates);
  }

  if (openBalloon && targetPlacemark) {
    window.setTimeout(() => {
      targetPlacemark.balloon.open();
    }, centerMap ? 320 : 40);
  }
}

function syncSelectedCard() {
  if (state.selectedId === null) {
    renderEmptyDetails();
    applySelectionStyles();
    renderSelectedConnection();
    return;
  }

  const selectedStillVisible = state.filteredReforms.some((reform) => reform.id === state.selectedId);

  if (!selectedStillVisible) {
    state.selectedId = null;
    renderEmptyDetails();
    renderReformList();
  }

  applySelectionStyles();
  renderSelectedConnection();
}

function renderEmptyDetails() {
  elements.detailsCard.className = "details-card details-card--empty";
  elements.detailsCard.innerHTML = `
    <h3>Выберите реформу</h3>
    <p>
      Нажмите на точку на карте или выберите реформу из списка ниже, чтобы
      увидеть её географию влияния и связанные территории.
    </p>
  `;
}

function renderDetailsCard(reform) {
  elements.detailsCard.className = "details-card";
  elements.detailsCard.innerHTML = `
    <h3>${escapeHtml(reform.name)}</h3>
    <p>${escapeHtml(reform.reformer)}</p>
    <div class="details-card__meta">
      <span class="chip">${escapeHtml(reform.yearLabel)}</span>
      <span class="chip">${escapeHtml(reform.period)}</span>
      <span class="chip">${escapeHtml(reform.type)}</span>
      <span class="chip">${escapeHtml(reform.region)}</span>
    </div>
    <div class="details-card__grid">
      <section class="details-card__section">
        <p class="details-card__section-title">География влияния</p>
        <div class="details-card__locations">
          ${renderLocationChips(reform.locations)}
        </div>
      </section>
      <section class="details-card__section">
        <p class="details-card__section-title">Цель</p>
        <p>${escapeHtml(reform.goal)}</p>
      </section>
      <section class="details-card__section">
        <p class="details-card__section-title">Основные меры</p>
        <p>${escapeHtml(reform.measures)}</p>
      </section>
      <section class="details-card__section">
        <p class="details-card__section-title">Последствия</p>
        <p>${escapeHtml(reform.results)}</p>
      </section>
    </div>
  `;
}

function renderLocationChips(locations) {
  if (!locations.length) {
    return `<p>Для этой реформы пока не задана карта влияния.</p>`;
  }

  return locations
    .map((location) => `<span class="chip chip--location">${escapeHtml(location.name)}</span>`)
    .join("");
}

function createBalloonContent(reform, location) {
  const otherLocations = reform.locations
    .map((item) => item.name)
    .filter((name) => name !== location.name)
    .slice(0, 4)
    .join(", ");

  const connectedText = otherLocations
    ? `Связанные точки: ${escapeHtml(otherLocations)}.`
    : "Это основная точка влияния реформы на карте.";

  return `
    <article class="balloon-card">
      <h3 class="balloon-card__title">${escapeHtml(reform.name)}</h3>
      <p class="balloon-card__meta"><strong>Точка на карте:</strong> ${escapeHtml(location.name)}</p>
      <p class="balloon-card__meta"><strong>Реформатор:</strong> ${escapeHtml(reform.reformer)}</p>
      <p class="balloon-card__meta"><strong>Год / период:</strong> ${escapeHtml(reform.yearLabel)} • ${escapeHtml(reform.period)}</p>
      <p class="balloon-card__meta"><strong>Тип:</strong> ${escapeHtml(reform.type)}</p>
      <p class="balloon-card__meta"><strong>Охват:</strong> ${escapeHtml(formatLocationCount(reform.locations.length))}</p>
      <p class="balloon-card__text"><strong>Цель:</strong> ${escapeHtml(reform.goal)}</p>
      <p class="balloon-card__text"><strong>Меры:</strong> ${escapeHtml(reform.measures)}</p>
      <p class="balloon-card__text"><strong>Последствия:</strong> ${escapeHtml(reform.results)}</p>
      <p class="balloon-card__text"><strong>Связь:</strong> ${connectedText}</p>
    </article>
  `;
}

function getReformCoordinates(reform) {
  return reform.locations
    .map((location) => location.coordinates)
    .filter(hasValidCoordinates);
}

function formatLocationCount(count) {
  if (count === 1) {
    return "1 точка влияния";
  }

  if (count >= 2 && count <= 4) {
    return `${count} точки влияния`;
  }

  return `${count} точек влияния`;
}

function resetFilters() {
  elements.reformerFilter.value = "all";
  elements.typeFilter.value = "all";
  elements.periodFilter.value = "all";
  applyFilters();
}

function getTypeColor(type) {
  const normalizedType = String(type).toLowerCase();

  if (normalizedType.includes("военн")) {
    return "#9e3d2c";
  }

  if (normalizedType.includes("эконом") || normalizedType.includes("финанс")) {
    return "#b66a1e";
  }

  if (normalizedType.includes("социал") || normalizedType.includes("крестьян")) {
    return "#2f7d5b";
  }

  if (normalizedType.includes("культур") || normalizedType.includes("образ")) {
    return "#26708f";
  }

  if (normalizedType.includes("суд")) {
    return "#6f5f1d";
  }

  if (normalizedType.includes("полит") || normalizedType.includes("государ")) {
    return "#7a4532";
  }

  if (normalizedType.includes("администра")) {
    return "#1f4b7a";
  }

  return "#5f6770";
}

function darkenHexColor(hex, amount) {
  const [red, green, blue] = hexToRgb(hex);

  return rgbToHex(
    Math.max(0, Math.round(red * (1 - amount))),
    Math.max(0, Math.round(green * (1 - amount))),
    Math.max(0, Math.round(blue * (1 - amount)))
  );
}

function hexToRgba(hex, alpha) {
  const [red, green, blue] = hexToRgb(hex);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  const chunkSize = normalized.length === 3 ? 1 : 2;
  const channels = normalized.match(new RegExp(`.{${chunkSize}}`, "g")) || [];
  const values = channels.map((chunk) => Number.parseInt(chunkSize === 1 ? chunk + chunk : chunk, 16));

  return [values[0] || 0, values[1] || 0, values[2] || 0];
}

function rgbToHex(red, green, blue) {
  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function getApiKey() {
  const config = window.APP_CONFIG || {};
  const key = typeof config.YANDEX_MAPS_API_KEY === "string" ? config.YANDEX_MAPS_API_KEY.trim() : "";

  if (!key || key === "your_api_key_here" || key === "insert_your_yandex_maps_api_key_here") {
    return "";
  }

  return key;
}

function hasValidCoordinates(coordinates) {
  return (
    Array.isArray(coordinates) &&
    coordinates.length === 2 &&
    Number.isFinite(coordinates[0]) &&
    Number.isFinite(coordinates[1])
  );
}

function formatYear(year) {
  return String(year ?? "Дата не указана");
}

function setMapStatus(message) {
  elements.mapStatus.textContent = message;
}

function showMapOverlay(message) {
  elements.mapOverlayText.innerHTML = message;
  elements.mapOverlay.classList.remove("is-hidden");
}

function hideMapOverlay() {
  elements.mapOverlay.classList.add("is-hidden");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
