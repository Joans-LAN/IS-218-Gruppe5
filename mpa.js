const map = new maplibregl.Map({
  container: "map",
  style: {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    },
    layers: [{ id: "osm-tiles", type: "raster", source: "osm" }],
  },
  center: [8.0, 58.15],
  zoom: 11,
});

map.addControl(new maplibregl.NavigationControl(), "top-right");

const flomFiles = [
  "Samfunnssikkerhet_42_Agder_25833_Flomsoner_FGDB__flomsoner_analyseomrade.geojson",
  "Samfunnssikkerhet_42_Agder_25833_Flomsoner_FGDB__flomsoner_analyseomradegrense.geojson",
  "Samfunnssikkerhet_42_Agder_25833_Flomsoner_FGDB__flomsoner_elvbekk.geojson",
  "Samfunnssikkerhet_42_Agder_25833_Flomsoner_FGDB__flomsoner_flomareal.geojson",
  "Samfunnssikkerhet_42_Agder_25833_Flomsoner_FGDB__flomsoner_flomarealgrense.geojson",
  "Samfunnssikkerhet_42_Agder_25833_Flomsoner_FGDB__flomsoner_flomhoydekontur.geojson",
  "Samfunnssikkerhet_42_Agder_25833_Flomsoner_FGDB__flomsoner_havflate.geojson",
  "Samfunnssikkerhet_42_Agder_25833_Flomsoner_FGDB__flomsoner_innsjo.geojson",
  "Samfunnssikkerhet_42_Agder_25833_Flomsoner_FGDB__flomsoner_kanalgroft.geojson",
  "Samfunnssikkerhet_42_Agder_25833_Flomsoner_FGDB__flomsoner_tverrprofillinje.geojson",
];

const firestationFiles = [
  "firestationdata/brannstasjoner.geojson",
  "firestationdata/firestations.geojson",
  "brannstasjoner.geojson",
  "firestations.geojson",
];

const layerListElement = document.getElementById("layer-list");
const countSelectedZoneBtn = document.getElementById("count-selected-zone-btn");
const selectedZoneStatusElement = document.getElementById("selected-zone-status");
const analysisStatusElement = document.getElementById("analysis-status");
const supabaseStatusElement = document.getElementById("supabase-status");
const supabaseRadiusInputElement = document.getElementById("supabase-radius-input");

let loadedBuildingsFeatureCollection = null;
let selectedFloodZoneFeature = null;
const floodAreaFeatureCollection = { type: "FeatureCollection", features: [] };

const WFS_BASE_URL = "https://wfs.geonorge.no/skwms1/wfs.matrikkelen-bygningspunkt";
const WFS_TYPENAME = "app:Bygning";
const WFS_PAGE_SIZE = 2000;

// Replace these with your own values from Supabase -> Settings -> API Keys.
const SUPABASE_URL = "https://etwjzsfimhczozbjfncg.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_wtoX_TYqqdHPntTeTnBW8A_3h7urgb-";
const supabaseClient =
  typeof window.supabase !== "undefined" &&
  SUPABASE_URL.startsWith("https://") &&
  SUPABASE_ANON_KEY &&
  !SUPABASE_ANON_KEY.startsWith("REPLACE_WITH_")
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

proj4.defs(
  "EPSG:25833",
  "+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs +type=crs"
);

function setStatus(message) {
  if (analysisStatusElement) {
    analysisStatusElement.textContent = message;
  }
}

function setSelectedZoneStatus(message) {
  if (selectedZoneStatusElement) {
    selectedZoneStatusElement.textContent = message;
  }
}

function setSupabaseStatus(message) {
  if (supabaseStatusElement) {
    supabaseStatusElement.textContent = message;
  }
}

function getSupabaseRadiusMeters() {
  const parsed = Number.parseInt(supabaseRadiusInputElement?.value || "250", 10);
  if (!Number.isFinite(parsed)) {
    return 250;
  }
  return Math.max(50, Math.min(5000, parsed));
}

function reprojectCoordinates(coords) {
  if (!Array.isArray(coords)) {
    return coords;
  }
  if (coords.length >= 2 && typeof coords[0] === "number") {
    return proj4("EPSG:25833", "EPSG:4326", coords);
  }
  return coords.map(reprojectCoordinates);
}

function reprojectFeatureCollection(featureCollection) {
  for (const feature of featureCollection.features || []) {
    if (feature.geometry?.coordinates) {
      feature.geometry.coordinates = reprojectCoordinates(feature.geometry.coordinates);
    }
  }
}

function findFirstPosition(coords) {
  if (!Array.isArray(coords)) {
    return null;
  }
  if (coords.length >= 2 && typeof coords[0] === "number" && typeof coords[1] === "number") {
    return coords;
  }
  for (const item of coords) {
    const position = findFirstPosition(item);
    if (position) {
      return position;
    }
  }
  return null;
}

function reprojectFeatureCollectionIfProjected(featureCollection) {
  const featureWithCoordinates = (featureCollection.features || []).find(
    (feature) => feature.geometry?.coordinates
  );
  const position = featureWithCoordinates
    ? findFirstPosition(featureWithCoordinates.geometry.coordinates)
    : null;
  if (!position) {
    return;
  }

  const [x, y] = position;
  if (Math.abs(x) > 180 || Math.abs(y) > 90) {
    reprojectFeatureCollection(featureCollection);
  }
}

function baseGeometryType(geometryType) {
  return geometryType.startsWith("Multi")
    ? geometryType.replace("Multi", "")
    : geometryType;
}

function collectBoundsFromCoordinates(coords, bounds) {
  if (!Array.isArray(coords)) {
    return;
  }
  if (coords.length >= 2 && typeof coords[0] === "number") {
    bounds.extend([coords[0], coords[1]]);
    return;
  }
  for (const item of coords) {
    collectBoundsFromCoordinates(item, bounds);
  }
}

function getBoundsFromFeatureCollection(featureCollection) {
  const bounds = new maplibregl.LngLatBounds();
  for (const feature of featureCollection.features || []) {
    if (feature.geometry?.coordinates) {
      collectBoundsFromCoordinates(feature.geometry.coordinates, bounds);
    }
  }
  return bounds;
}

function fitToFeatureCollection(featureCollection) {
  const bounds = getBoundsFromFeatureCollection(featureCollection);
  if (!bounds.isEmpty()) {
    map.fitBounds(bounds, { padding: 20 });
  }
}

function displayNameFromFileName(fileName) {
  return fileName
    .replace("Samfunnssikkerhet_42_Agder_25833_Flomsoner_FGDB__", "")
    .replace(".geojson", "")
    .replaceAll("_", " ");
}

function setLayerVisibility(layerIds, isVisible) {
  const visibility = isVisible ? "visible" : "none";
  for (const layerId of layerIds) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "visibility", visibility);
    }
  }
}

function addLayerToggle(labelText, layerIds, initiallyVisible = true) {
  if (!layerListElement || layerIds.length === 0) {
    return;
  }
  const label = document.createElement("label");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = initiallyVisible;
  checkbox.addEventListener("change", () => {
    setLayerVisibility(layerIds, checkbox.checked);
  });
  label.appendChild(checkbox);
  label.append(labelText);
  layerListElement.appendChild(label);
  setLayerVisibility(layerIds, initiallyVisible);
}

function popupHtmlFromProperties(properties, title) {
  const safeTitle = title ? `<strong>${title}</strong><br/>` : "";
  const keyValues = Object.entries(properties || {})
    .slice(0, 5)
    .map(([key, value]) => `<div><strong>${key}:</strong> ${String(value)}</div>`)
    .join("");
  return `${safeTitle}${keyValues || "<div>No attributes</div>"}`;
}

function getFloodZoneLabelFromProperties(properties) {
  return (
    properties?.flomsonenavn ||
    properties?.flomsoneomrade ||
    properties?.objtype ||
    properties?.lokalid ||
    "selected flood zone"
  );
}

function getFirestationLabelFromProperties(properties) {
  return (
    properties?.navn ||
    properties?.Navn ||
    properties?.name ||
    properties?.Name ||
    properties?.brannstasjon ||
    properties?.Brannstasjon ||
    properties?.stasjonsnavn ||
    properties?.Stasjonsnavn ||
    properties?.organisasjonsnavn ||
    "Fire station"
  );
}

function getPointCoordinates(feature) {
  if (!feature?.geometry) {
    return null;
  }
  if (feature.geometry.type === "Point") {
    return feature.geometry.coordinates;
  }
  if (feature.geometry.type === "MultiPoint") {
    return feature.geometry.coordinates?.[0] || null;
  }
  return null;
}

function ensureSelectedZoneOverlay() {
  if (!map.getSource("selected-flomsone")) {
    map.addSource("selected-flomsone", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    map.addLayer({
      id: "selected-flomsone-fill",
      type: "fill",
      source: "selected-flomsone",
      paint: {
        "fill-color": "#fdd835",
        "fill-opacity": 0.35,
      },
    });

    map.addLayer({
      id: "selected-flomsone-outline",
      type: "line",
      source: "selected-flomsone",
      paint: {
        "line-color": "#111111",
        "line-width": 2.5,
      },
    });
  }
}

function setSelectedFloodZone(feature) {
  if (!feature?.geometry) {
    return;
  }

  selectedFloodZoneFeature = {
    type: "Feature",
    geometry: JSON.parse(JSON.stringify(feature.geometry)),
    properties: { ...(feature.properties || {}) },
  };

  ensureSelectedZoneOverlay();
  map.getSource("selected-flomsone").setData({
    type: "FeatureCollection",
    features: [selectedFloodZoneFeature],
  });

  const label = getFloodZoneLabelFromProperties(selectedFloodZoneFeature.properties);
  setSelectedZoneStatus(`Selected zone: ${label}`);
}

function bindPopupToLayer(layerId, title) {
  map.on("click", layerId, (event) => {
    const feature = event.features?.[0];
    if (!feature) {
      return;
    }
    new maplibregl.Popup()
      .setLngLat(event.lngLat)
      .setHTML(popupHtmlFromProperties(feature.properties, title))
      .addTo(map);
  });

  map.on("mouseenter", layerId, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", layerId, () => {
    map.getCanvas().style.cursor = "";
  });
}

function addStyledLayer(sourceId, layerPrefix, geometryTypes) {
  const layerIds = [];
  if (geometryTypes.has("Polygon")) {
    const fillId = `${layerPrefix}-fill`;
    map.addLayer({
      id: fillId,
      type: "fill",
      source: sourceId,
      paint: {
        "fill-color": [
          "match",
          ["get", "objtype"],
          "Flomareal",
          "#ef5350",
          "Analyseområde",
          "#42a5f5",
          "Havflate",
          "#26a69a",
          "#7e57c2",
        ],
        "fill-opacity": 0.25,
      },
    });
    const outlineId = `${layerPrefix}-outline`;
    map.addLayer({
      id: outlineId,
      type: "line",
      source: sourceId,
      paint: { "line-color": "#1e3a8a", "line-width": 1.3 },
    });
    layerIds.push(fillId, outlineId);

    map.on("click", fillId, (event) => {
      const feature = event.features?.[0];
      if (feature) {
        setSelectedFloodZone(feature);
      }
    });
  }

  if (geometryTypes.has("LineString")) {
    const lineId = `${layerPrefix}-line`;
    map.addLayer({
      id: lineId,
      type: "line",
      source: sourceId,
      paint: { "line-color": "#e65100", "line-width": 1.4 },
    });
    layerIds.push(lineId);
  }

  if (geometryTypes.has("Point")) {
    const pointId = `${layerPrefix}-point`;
    map.addLayer({
      id: pointId,
      type: "circle",
      source: sourceId,
      paint: { "circle-color": "#4caf50", "circle-radius": 4 },
    });
    layerIds.push(pointId);
  }

  for (const layerId of layerIds) {
    bindPopupToLayer(layerId, "Flood data");
  }
  return layerIds;
}

function findFirstElementByLocalName(root, localName) {
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || node.nodeType !== 1) {
      continue;
    }
    if (node.localName === localName) {
      return node;
    }
    for (let i = node.children.length - 1; i >= 0; i -= 1) {
      stack.push(node.children[i]);
    }
  }
  return null;
}

function parseWfsPointFeatureCollection(xmlText) {
  const xml = new DOMParser().parseFromString(xmlText, "text/xml");
  const exceptionNode = findFirstElementByLocalName(xml.documentElement, "ExceptionText");
  if (exceptionNode?.textContent) {
    throw new Error(exceptionNode.textContent.trim());
  }

  const members = [];
  const allElements = xml.getElementsByTagName("*");
  for (const element of allElements) {
    if (element.localName === "member") {
      members.push(element);
    }
  }

  const features = [];
  for (const member of members) {
    const featureElement = Array.from(member.children)[0];
    if (!featureElement) {
      continue;
    }
    const posElement = findFirstElementByLocalName(featureElement, "pos");
    if (!posElement?.textContent) {
      continue;
    }

    const values = posElement.textContent
      .trim()
      .split(/\s+/)
      .map((v) => Number.parseFloat(v));

    if (values.length < 2 || Number.isNaN(values[0]) || Number.isNaN(values[1])) {
      continue;
    }

    // We request EPSG:4326 from WFS and interpret coordinates as lon/lat.
    // Fallback to swapped order only if the primary interpretation is invalid.
    let lon = values[0];
    let lat = values[1];
    if (Math.abs(lon) > 180 || Math.abs(lat) > 90) {
      lon = values[1];
      lat = values[0];
    }

    const properties = {};
    for (const child of featureElement.children) {
      if (child.children.length === 0 && child.textContent?.trim()) {
        properties[child.localName] = child.textContent.trim();
      }
    }

    features.push({
      type: "Feature",
      properties,
      geometry: { type: "Point", coordinates: [lon, lat] },
    });
  }

  return { type: "FeatureCollection", features };
}

function boundsToBboxParam(bounds) {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  return `${sw.lng},${sw.lat},${ne.lng},${ne.lat},EPSG:4326`;
}

async function fetchWfsHits(bboxParam) {
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: WFS_TYPENAME,
    srsName: "EPSG:4326",
    bbox: bboxParam,
    resultType: "hits",
  });

  const response = await fetch(`${WFS_BASE_URL}?${params.toString()}`);
  const text = await response.text();
  const xml = new DOMParser().parseFromString(text, "text/xml");
  const exceptionNode = findFirstElementByLocalName(xml.documentElement, "ExceptionText");
  if (exceptionNode?.textContent) {
    throw new Error(exceptionNode.textContent.trim());
  }
  const numberMatched = xml.documentElement.getAttribute("numberMatched");
  return Number.parseInt(numberMatched || "0", 10);
}

async function fetchWfsPoints(bboxParam, count = 4000, startIndex = 0) {
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: WFS_TYPENAME,
    srsName: "EPSG:4326",
    bbox: bboxParam,
    count: String(count),
    startIndex: String(startIndex),
  });
  const response = await fetch(`${WFS_BASE_URL}?${params.toString()}`);
  const text = await response.text();
  return parseWfsPointFeatureCollection(text);
}

async function fetchWfsPointsPaged(bboxParam, expectedTotal = null) {
  const allFeatures = [];
  let startIndex = 0;

  while (true) {
    const page = await fetchWfsPoints(bboxParam, WFS_PAGE_SIZE, startIndex);
    const pageFeatures = page.features || [];

    if (pageFeatures.length === 0) {
      break;
    }

    allFeatures.push(...pageFeatures);
    startIndex += pageFeatures.length;

    if (pageFeatures.length < WFS_PAGE_SIZE) {
      break;
    }

    if (expectedTotal !== null && allFeatures.length >= expectedTotal) {
      break;
    }
  }

  return {
    type: "FeatureCollection",
    features: allFeatures,
  };
}

function addBuildingLayer(buildingsFeatureCollection) {
  const sourceId = "wfs-buildings";
  if (map.getSource(sourceId)) {
    map.getSource(sourceId).setData(buildingsFeatureCollection);
    return;
  }

  map.addSource(sourceId, { type: "geojson", data: buildingsFeatureCollection });
  map.addLayer({
    id: "wfs-buildings-circle",
    type: "circle",
    source: sourceId,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 2, 12, 4],
      "circle-color": [
        "case",
        [">", ["coalesce", ["to-number", ["get", "bygningstype"]], 0], 0],
        "#ffb300",
        "#6a1b9a",
      ],
      "circle-stroke-color": "#1f2937",
      "circle-stroke-width": 0.4,
      "circle-opacity": 0.85,
    },
  });

  bindPopupToLayer("wfs-buildings-circle", "WFS building point");
  addLayerToggle("wfs bygningspunkt", ["wfs-buildings-circle"], true);
}

function countPointsInsideFloodPolygons(pointsFeatureCollection, polygonsFeatureCollection) {
  if (!polygonsFeatureCollection || !polygonsFeatureCollection.features?.length) {
    return 0;
  }

  let insideCount = 0;
  for (const pointFeature of pointsFeatureCollection.features || []) {
    for (const polygonFeature of polygonsFeatureCollection.features || []) {
      if (turf.booleanPointInPolygon(pointFeature, polygonFeature)) {
        insideCount += 1;
        break;
      }
    }
  }
  return insideCount;
}

function addFloodAreaFeatures(fileName, featureCollection) {
  if (!fileName.endsWith("__flomsoner_flomareal.geojson")) {
    return;
  }

  const polygonFeatures = (featureCollection.features || []).filter((feature) => {
    const geometryType = feature.geometry?.type;
    return geometryType === "Polygon" || geometryType === "MultiPolygon";
  });
  floodAreaFeatureCollection.features.push(...polygonFeatures);
}

async function countLoadedBuildingsInSelectedZone() {
  if (!selectedFloodZoneFeature) {
    setStatus("Select a flood zone first (turn on a flood layer, then click a polygon).");
    return;
  }

  const selectedCollection = {
    type: "FeatureCollection",
    features: [selectedFloodZoneFeature],
  };

  try {
    const zoneBounds = getBoundsFromFeatureCollection(selectedCollection);
    if (zoneBounds.isEmpty()) {
      setStatus("Selected zone has no valid geometry bounds.");
      return;
    }

    const bboxParam = boundsToBboxParam(zoneBounds);
    const zoneLabel = getFloodZoneLabelFromProperties(selectedFloodZoneFeature.properties);
    setStatus(`Querying WFS buildings in bbox around "${zoneLabel}"...`);

    const totalHits = await fetchWfsHits(bboxParam);
    const zoneBuildingsFeatureCollection = await fetchWfsPointsPaged(
      bboxParam,
      Number.isFinite(totalHits) ? totalHits : null
    );
    loadedBuildingsFeatureCollection = zoneBuildingsFeatureCollection;

    addBuildingLayer(zoneBuildingsFeatureCollection);

    const insideCount = countPointsInsideFloodPolygons(
      zoneBuildingsFeatureCollection,
      selectedCollection
    );
    const loadedCount = zoneBuildingsFeatureCollection.features.length;
    const loadedNote =
      Number.isFinite(totalHits) && totalHits >= 0
        ? ` Loaded ${loadedCount} of ${totalHits} bbox matches.`
        : ` Loaded ${loadedCount} bbox matches.`;

    setStatus(`Zone "${zoneLabel}": ${insideCount} buildings inside selected flood zone.${loadedNote}`);
  } catch (error) {
    console.error(error);
    setStatus(`Zone count failed: ${error.message}`);
  }
}

function ensureSupabaseResultOverlays() {
  if (!map.getSource("supabase-click-point")) {
    map.addSource("supabase-click-point", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: "supabase-click-point-circle",
      type: "circle",
      source: "supabase-click-point",
      paint: {
        "circle-radius": 7,
        "circle-color": "#ef4444",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.8,
      },
    });
  }

  if (!map.getSource("supabase-click-radius")) {
    map.addSource("supabase-click-radius", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: "supabase-click-radius-fill",
      type: "fill",
      source: "supabase-click-radius",
      paint: {
        "fill-color": "#ef4444",
        "fill-opacity": 0.08,
      },
    });
    map.addLayer({
      id: "supabase-click-radius-outline",
      type: "line",
      source: "supabase-click-radius",
      paint: {
        "line-color": "#b91c1c",
        "line-width": 2,
      },
    });
  }

  if (!map.getSource("supabase-nearby-buildings")) {
    map.addSource("supabase-nearby-buildings", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: "supabase-nearby-buildings-circle",
      type: "circle",
      source: "supabase-nearby-buildings",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 3, 13, 6],
        "circle-color": "#f59e0b",
        "circle-stroke-color": "#111827",
        "circle-stroke-width": 1,
        "circle-opacity": 0.95,
      },
    });

    map.on("click", "supabase-nearby-buildings-circle", (event) => {
      const feature = event.features?.[0];
      if (!feature) {
        return;
      }
      const properties = feature.properties || {};
      new maplibregl.Popup()
        .setLngLat(event.lngLat)
        .setHTML(
          popupHtmlFromProperties(
            {
              bygningid: properties.bygningid,
              bygningstype: properties.bygningstype,
              objtype: properties.objtype,
              distance_m: properties.distance_m,
            },
            "Supabase nearby building"
          )
        )
        .addTo(map);
    });

    map.on("mouseenter", "supabase-nearby-buildings-circle", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "supabase-nearby-buildings-circle", () => {
      map.getCanvas().style.cursor = "";
    });
  }
}

function setSupabaseClickAndRadius(lng, lat, radiusMeters) {
  ensureSupabaseResultOverlays();
  map.getSource("supabase-click-point").setData({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: {},
      },
    ],
  });

  const radiusFeature = turf.circle([lng, lat], radiusMeters / 1000, {
    steps: 64,
    units: "kilometers",
  });
  map.getSource("supabase-click-radius").setData({
    type: "FeatureCollection",
    features: [radiusFeature],
  });
}

function setSupabaseResultFeatures(rows) {
  ensureSupabaseResultOverlays();
  const rawCount = (rows || []).length;
  let invalidCoordCount = 0;
  const features = (rows || [])
    .map((row) => {
      const lon = Number(row.lon);
      const lat = Number(row.lat);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        invalidCoordCount += 1;
        return null;
      }
      return {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [lon, lat],
        },
        properties: {
          bygningid: row.bygningid ?? "",
          bygningstype: row.bygningstype ?? "",
          objtype: row.objtype ?? "",
          distance_m: row.distance_m !== null ? Number(row.distance_m).toFixed(1) : "",
        },
      };
    })
    .filter(Boolean);
  map.getSource("supabase-nearby-buildings").setData({
    type: "FeatureCollection",
    features,
  });
  return { features, rawCount, invalidCoordCount };
}

async function runSupabaseNearbySearch(lng, lat) {
  const radiusMeters = getSupabaseRadiusMeters();
  setSupabaseClickAndRadius(lng, lat, radiusMeters);

  if (!supabaseClient) {
    setSupabaseStatus(
      "Supabase not configured. Add SUPABASE_URL and SUPABASE_ANON_KEY in mpa.js first."
    );
    setSupabaseResultFeatures([]);
    return;
  }

  setSupabaseStatus(
    `Querying buildings within ${radiusMeters} m at ${lng.toFixed(5)}, ${lat.toFixed(5)}...`
  );
  const { data, error } = await supabaseClient.rpc("buildings_within_distance", {
    clicked_lng: lng,
    clicked_lat: lat,
    radius_m: radiusMeters,
  });

  if (error) {
    console.error(error);
    setSupabaseResultFeatures([]);
    setSupabaseStatus(`Supabase query failed: ${error.message}`);
    return;
  }

  const { features, rawCount, invalidCoordCount } = setSupabaseResultFeatures(data || []);
  if (features.length > 0) {
    const bounds = new maplibregl.LngLatBounds();
    for (const feature of features) {
      bounds.extend(feature.geometry.coordinates);
    }
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 40, maxZoom: 15, duration: 500 });
    }
    const first = features[0].geometry.coordinates;
    setSupabaseStatus(
      `Found ${features.length} buildings within ${radiusMeters} m at ${lng.toFixed(5)}, ${lat.toFixed(5)} (raw ${rawCount}, invalid ${invalidCoordCount}). First point: ${first[0].toFixed(5)}, ${first[1].toFixed(5)}.`
    );
  } else {
    setSupabaseStatus(
      `Found 0 plottable buildings within ${radiusMeters} m at ${lng.toFixed(5)}, ${lat.toFixed(5)} (raw ${rawCount}, invalid ${invalidCoordCount}).`
    );
  }
}

function firestationPopupHtml(feature, radiusMeters, nearbyCount, floodCount) {
  const properties = feature.properties || {};
  const stationName = getFirestationLabelFromProperties(properties);
  return `
    <strong>${stationName}</strong>
    <div><strong>Houses within ${radiusMeters} m:</strong> ${nearbyCount}</div>
    <div><strong>Houses inside flood zone:</strong> ${floodCount}</div>
    <hr/>
    ${popupHtmlFromProperties(properties, "Fire station data")}
  `;
}

async function runFirestationAnalysis(feature, lngLat) {
  const coordinates = getPointCoordinates(feature) || [lngLat.lng, lngLat.lat];
  const [lng, lat] = coordinates;
  const radiusMeters = getSupabaseRadiusMeters();
  const stationName = getFirestationLabelFromProperties(feature.properties || {});

  setSupabaseClickAndRadius(lng, lat, radiusMeters);

  const popup = new maplibregl.Popup()
    .setLngLat(coordinates)
    .setHTML(
      `<strong>${stationName}</strong><div>Querying houses within ${radiusMeters} m...</div>`
    )
    .addTo(map);

  if (!supabaseClient) {
    setSupabaseResultFeatures([]);
    setSupabaseStatus(
      "Supabase not configured. Add SUPABASE_URL and SUPABASE_ANON_KEY in mpa.js first."
    );
    popup.setHTML(
      `<strong>${stationName}</strong><div>Supabase is not configured, so nearby houses cannot be counted.</div>`
    );
    return;
  }

  setSupabaseStatus(`Querying houses within ${radiusMeters} m of "${stationName}"...`);
  const { data, error } = await supabaseClient.rpc("buildings_within_distance", {
    clicked_lng: lng,
    clicked_lat: lat,
    radius_m: radiusMeters,
  });

  if (error) {
    console.error(error);
    setSupabaseResultFeatures([]);
    setSupabaseStatus(`Fire station query failed: ${error.message}`);
    popup.setHTML(`<strong>${stationName}</strong><div>Query failed: ${error.message}</div>`);
    return;
  }

  const { features, rawCount, invalidCoordCount } = setSupabaseResultFeatures(data || []);
  const nearbyBuildings = { type: "FeatureCollection", features };
  const floodCount = countPointsInsideFloodPolygons(
    nearbyBuildings,
    floodAreaFeatureCollection
  );

  setSupabaseStatus(
    `"${stationName}": ${features.length} houses within ${radiusMeters} m, ${floodCount} inside a flood zone (raw ${rawCount}, invalid ${invalidCoordCount}).`
  );
  popup.setHTML(firestationPopupHtml(feature, radiusMeters, features.length, floodCount));
}

function addFirestationLayer(featureCollection, label) {
  const sourceId = "firestations";
  const layerId = "firestations-circle";
  if (map.getSource(sourceId)) {
    map.getSource(sourceId).setData(featureCollection);
    return [layerId];
  }

  map.addSource(sourceId, { type: "geojson", data: featureCollection });
  map.addLayer({
    id: layerId,
    type: "circle",
    source: sourceId,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 5, 13, 9],
      "circle-color": "#dc2626",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });

  map.on("click", layerId, async (event) => {
    const feature = event.features?.[0];
    if (!feature) {
      return;
    }
    await runFirestationAnalysis(feature, event.lngLat);
  });

  map.on("mouseenter", layerId, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", layerId, () => {
    map.getCanvas().style.cursor = "";
  });

  addLayerToggle(label, [layerId], true);
  return [layerId];
}

async function loadFirestations() {
  for (const fileName of firestationFiles) {
    try {
      const response = await fetch(fileName);
      if (!response.ok) {
        continue;
      }

      const data = await response.json();
      reprojectFeatureCollectionIfProjected(data);
      addFirestationLayer(data, "Fire stations");
      return true;
    } catch (error) {
      console.error(`Failed to load ${fileName}:`, error);
    }
  }
  return false;
}

map.on("load", async () => {
  let hasFitBounds = false;

  for (const fileName of flomFiles) {
    const sourceId = `flom-${fileName.replace(".geojson", "")}`;
    const layerPrefix = sourceId;

    try {
      const response = await fetch(`flomdata/${fileName}`);
      if (!response.ok) {
        continue;
      }

      const data = await response.json();
      reprojectFeatureCollection(data);
      addFloodAreaFeatures(fileName, data);

      map.addSource(sourceId, { type: "geojson", data });
      const geometryTypes = new Set(
        (data.features || [])
          .map((feature) => feature.geometry?.type)
          .filter(Boolean)
          .map(baseGeometryType)
      );

      const layerIds = addStyledLayer(sourceId, layerPrefix, geometryTypes);
      addLayerToggle(displayNameFromFileName(fileName), layerIds, false);

      if (!hasFitBounds && fileName.includes("analyseomrade")) {
        fitToFeatureCollection(data);
        hasFitBounds = true;
      }
    } catch (error) {
      console.error(`Failed to load ${fileName}:`, error);
    }
  }

  const hasFirestations = await loadFirestations();

  if (countSelectedZoneBtn) {
    countSelectedZoneBtn.addEventListener("click", async () => {
      await countLoadedBuildingsInSelectedZone();
    });
  }

  ensureSupabaseResultOverlays();
  map.on("click", async (event) => {
    if (
      map.getLayer("firestations-circle") &&
      map.queryRenderedFeatures(event.point, { layers: ["firestations-circle"] }).length > 0
    ) {
      return;
    }
    await runSupabaseNearbySearch(event.lngLat.lng, event.lngLat.lat);
  });

  setSelectedZoneStatus("Selected zone: none");
  setStatus("Ready. Turn on a flood layer, click a zone, then run the zone count.");
  if (supabaseClient) {
    setSupabaseStatus(
      hasFirestations
        ? "Ready. Click the map or a fire station to query buildings nearby."
        : "Ready. Click the map to query buildings nearby. No firestation GeoJSON file was found."
    );
  } else {
    setSupabaseStatus(
      "Supabase not configured yet. Add SUPABASE_URL and SUPABASE_ANON_KEY in mpa.js."
    );
  }
});
