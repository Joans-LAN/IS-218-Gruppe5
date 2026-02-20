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

const layerListElement = document.getElementById("layer-list");
const countSelectedZoneBtn = document.getElementById("count-selected-zone-btn");
const selectedZoneStatusElement = document.getElementById("selected-zone-status");
const analysisStatusElement = document.getElementById("analysis-status");

let loadedBuildingsFeatureCollection = null;
let selectedFloodZoneFeature = null;

const WFS_BASE_URL = "https://wfs.geonorge.no/skwms1/wfs.matrikkelen-bygningspunkt";
const WFS_TYPENAME = "app:Bygning";
const WFS_PAGE_SIZE = 2000;

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

  if (countSelectedZoneBtn) {
    countSelectedZoneBtn.addEventListener("click", async () => {
      await countLoadedBuildingsInSelectedZone();
    });
  }

  setSelectedZoneStatus("Selected zone: none");
  setStatus("Ready. Turn on a flood layer, click a zone, then run the zone count.");
});
