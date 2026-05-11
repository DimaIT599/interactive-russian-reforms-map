const DEFAULT_CENTER = [61, 90];
const DEFAULT_ZOOM = 3;

const state = {
  reforms: [],
  filteredReforms: [],
  map: null,
  ymaps: null,
  clusterer: null,
  placemarksById: new Map(),
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
  const response = await fetch("reforms.json", { cache: "no-store" });

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
  return {
    id: reform.id,
    name: String(reform.name || "Без названия"),
    reformer: String(reform.reformer || "Не указан"),
    year: reform.year,
    yearLabel: formatYear(reform.year),
    period: String(reform.period || "Период не указан"),
    type: String(reform.type || "Тип не указан"),
    region: String(reform.region || "Регион не указан"),
    coordinates: Array.isArray(reform.coordinates) ? reform.coordinates.map(Number) : null,
    goal: String(reform.goal || "Цель не указана."),
    measures: String(reform.measures || "Основные меры не указаны."),
    results: String(reform.results || "Последствия не указаны.")
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

    state.clusterer = new state.ymaps.Clusterer({
      preset: "islands#invertedDarkBlueClusterIcons",
      groupByCoordinates: false,
      clusterDisableClickZoom: false,
      clusterOpenBalloonOnClick: true
    });

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

  // Подключаем API динамически, чтобы брать ключ из window.APP_CONFIG.
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

  // Один и тот же набор фильтров управляет и картой, и списком, и карточкой.
  state.filteredReforms = state.reforms.filter((reform) => {
    const matchesReformer = reformer === "all" || reform.reformer === reformer;
    const matchesType = type === "all" || reform.type === type;
    const matchesPeriod = period === "all" || reform.period === period;

    return matchesReformer && matchesType && matchesPeriod;
  });

  elements.visibleCount.textContent = String(state.filteredReforms.length);
  elements.selectedPeriod.textContent = period === "all" ? "Все" : period;
  elements.resultsSummary.textContent = `Показано ${state.filteredReforms.length} из ${state.reforms.length} реформ.`;
  elements.listCaption.textContent = `В списке отображаются реформы, подходящие под текущие фильтры.`;

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
      <p class="reform-list__meta">${escapeHtml(reform.reformer)} • ${escapeHtml(reform.region)}</p>
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
  if (!state.map || !state.clusterer) {
    return;
  }

  // На каждом изменении фильтра пересобираем видимые метки заново.
  state.clusterer.removeAll();
  state.placemarksById.clear();

  const placemarks = state.filteredReforms
    .filter((reform) => hasValidCoordinates(reform.coordinates))
    .map((reform) => createPlacemark(reform));

  state.clusterer.add(placemarks);
  fitMapToVisibleReforms();
}

function createPlacemark(reform) {
  const placemark = new state.ymaps.Placemark(
    reform.coordinates,
    {
      hintContent: `${escapeHtml(reform.name)} (${escapeHtml(reform.yearLabel)})`,
      balloonContentHeader: escapeHtml(reform.name),
      clusterCaption: escapeHtml(reform.name),
      balloonContentBody: createBalloonContent(reform)
    },
    {
      preset: "islands#circleDotIcon",
      iconColor: getTypeColor(reform.type),
      openBalloonOnClick: true
    }
  );

  placemark.events.add("click", () => selectReform(reform.id));
  state.placemarksById.set(reform.id, placemark);
  return placemark;
}

function fitMapToVisibleReforms() {
  const visibleCoordinates = state.filteredReforms
    .map((reform) => reform.coordinates)
    .filter(hasValidCoordinates);

  if (visibleCoordinates.length === 0) {
    state.map.setCenter(DEFAULT_CENTER, DEFAULT_ZOOM, { duration: 250 });
    return;
  }

  if (visibleCoordinates.length === 1) {
    state.map.setCenter(visibleCoordinates[0], 5, { duration: 250 });
    return;
  }

  const bounds = calculateBounds(visibleCoordinates);

  if (
    bounds[0][0] === bounds[1][0] &&
    bounds[0][1] === bounds[1][1]
  ) {
    state.map.setCenter(bounds[0], 5, { duration: 250 });
    return;
  }

  state.map.setBounds(bounds, {
    checkZoomRange: true,
    zoomMargin: 40,
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
  const { centerMap = false, openBalloon = false } = options;
  const reform = state.reforms.find((item) => item.id === reformId);

  if (!reform) {
    return;
  }

  state.selectedId = reformId;
  renderDetailsCard(reform);
  renderReformList();

  const placemark = state.placemarksById.get(reformId);

  if (placemark && state.map) {
    if (centerMap) {
      state.map.setCenter(reform.coordinates, 5, { duration: 250 });
    }

    if (openBalloon) {
      placemark.balloon.open();
    }
  }
}

function syncSelectedCard() {
  if (state.selectedId === null) {
    renderEmptyDetails();
    return;
  }

  const selectedStillVisible = state.filteredReforms.some((reform) => reform.id === state.selectedId);

  if (!selectedStillVisible) {
    state.selectedId = null;
    renderEmptyDetails();
    renderReformList();
  }
}

function renderEmptyDetails() {
  elements.detailsCard.className = "details-card details-card--empty";
  elements.detailsCard.innerHTML = `
    <h3>Выберите реформу</h3>
    <p>
      Нажмите на метку на карте или выберите реформу из списка ниже, чтобы
      изучить её содержание и последствия.
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

function createBalloonContent(reform) {
  return `
    <article class="balloon-card">
      <h3 class="balloon-card__title">${escapeHtml(reform.name)}</h3>
      <p class="balloon-card__meta"><strong>Реформатор:</strong> ${escapeHtml(reform.reformer)}</p>
      <p class="balloon-card__meta"><strong>Год / период:</strong> ${escapeHtml(reform.yearLabel)} • ${escapeHtml(reform.period)}</p>
      <p class="balloon-card__meta"><strong>Тип:</strong> ${escapeHtml(reform.type)}</p>
      <p class="balloon-card__meta"><strong>Регион:</strong> ${escapeHtml(reform.region)}</p>
      <p class="balloon-card__text"><strong>Цель:</strong> ${escapeHtml(reform.goal)}</p>
      <p class="balloon-card__text"><strong>Меры:</strong> ${escapeHtml(reform.measures)}</p>
      <p class="balloon-card__text"><strong>Последствия:</strong> ${escapeHtml(reform.results)}</p>
    </article>
  `;
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
