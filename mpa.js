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
    layers: [
      {
        id: "osm-tiles",
        type: "raster",
        source: "osm",
      },
    ],
  },
  center: [8.0, 58.15], // Kristiansand area
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

proj4.defs(
  "EPSG:25833",
  "+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs +type=crs"
);

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
    const geometry = feature.geometry;
    if (!geometry || !geometry.coordinates) {
      continue;
    }
    geometry.coordinates = reprojectCoordinates(geometry.coordinates);
  }
}

function baseGeometryType(geometryType) {
  return geometryType.startsWith("Multi")
    ? geometryType.replace("Multi", "")
    : geometryType;
}

function addStyledLayer(sourceId, layerPrefix, geometryTypes) {
  const addedLayerIds = [];

  if (geometryTypes.has("Polygon")) {
    const fillId = `${layerPrefix}-fill`;
    map.addLayer({
      id: fillId,
      type: "fill",
      source: sourceId,
      paint: {
        "fill-color": "#1e88e5",
        "fill-opacity": 0.2,
      },
    });
    addedLayerIds.push(fillId);

    const outlineId = `${layerPrefix}-outline`;
    map.addLayer({
      id: outlineId,
      type: "line",
      source: sourceId,
      paint: {
        "line-color": "#1565c0",
        "line-width": 1.5,
      },
    });
    addedLayerIds.push(outlineId);
  }

  if (geometryTypes.has("LineString")) {
    const lineId = `${layerPrefix}-line`;
    map.addLayer({
      id: lineId,
      type: "line",
      source: sourceId,
      paint: {
        "line-color": "#e65100",
        "line-width": 1.5,
      },
    });
    addedLayerIds.push(lineId);
  }

  if (geometryTypes.has("Point")) {
    const pointId = `${layerPrefix}-point`;
    map.addLayer({
      id: pointId,
      type: "circle",
      source: sourceId,
      paint: {
        "circle-color": "#4caf50",
        "circle-radius": 4,
      },
    });
    addedLayerIds.push(pointId);
  }

  return addedLayerIds;
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

function fitToFeatureCollection(featureCollection) {
  const bounds = new maplibregl.LngLatBounds();

  for (const feature of featureCollection.features || []) {
    if (feature.geometry?.coordinates) {
      collectBoundsFromCoordinates(feature.geometry.coordinates, bounds);
    }
  }

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

function addLayerToggle(fileName, layerIds) {
  if (!layerListElement || layerIds.length === 0) {
    return;
  }

  const label = document.createElement("label");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = true;
  checkbox.addEventListener("change", () => {
    setLayerVisibility(layerIds, checkbox.checked);
  });

  label.appendChild(checkbox);
  label.append(displayNameFromFileName(fileName));
  layerListElement.appendChild(label);
}

map.on("load", async () => {
  let hasFitBounds = false;

  for (const fileName of flomFiles) {
    const sourceId = `flom-${fileName.replace(".geojson", "")}`;
    const layerPrefix = sourceId;

    try {
      const response = await fetch(`flomdata/${fileName}`);
      if (!response.ok) {
        // Skip files that are unavailable but keep loading the rest.
        continue;
      }

      const data = await response.json();
      reprojectFeatureCollection(data);

      map.addSource(sourceId, {
        type: "geojson",
        data,
      });

      const geometryTypes = new Set(
        (data.features || [])
          .map((f) => f.geometry?.type)
          .filter(Boolean)
          .map(baseGeometryType)
      );

      const layerIds = addStyledLayer(sourceId, layerPrefix, geometryTypes);
      addLayerToggle(fileName, layerIds);

      if (!hasFitBounds && fileName.includes("analyseomrade")) {
        fitToFeatureCollection(data);
        hasFitBounds = true;
      }
    } catch (error) {
      console.error(`Failed to load ${fileName}:`, error);
    }
  }
});
