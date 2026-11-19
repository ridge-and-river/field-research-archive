import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const data = new URL("./", import.meta.url);
const read = async path => JSON.parse(await readFile(new URL(path, data), "utf8"));
const catalog = await read("catalog.json");
assert.equal(catalog.schemaVersion, 1);
function unique(items, key) {
  const values = items.map(item => item[key]);
  assert(values.every(value => typeof value === "string" && value.trim()), `Missing ${key}`);
  assert.equal(new Set(values).size, values.length, `Duplicate ${key}`);
  return new Set(values);
}
const campaigns = unique(catalog.campaigns, "id");
const countries = unique(catalog.countries, "code");
const topics = unique(catalog.topics, "id");
const datasets = unique(catalog.datasets, "id");
unique(catalog.datasets, "path");
const locations = new Map();
for (const dataset of catalog.datasets) {
  assert(campaigns.has(dataset.campaignId) && countries.has(dataset.countryCode) && topics.has(dataset.topicId), dataset.id);
  for (const place of await read(dataset.path)) {
    assert(place.id && place.name && !locations.has(place.id), `Duplicate or incomplete location ${place.id}`);
    assert.equal(place.countryCode, dataset.countryCode, place.id);
    assert.equal(place.topicId, dataset.topicId, place.id);
    assert(["active", "merged", "excluded"].includes(place.lifecycle), place.id);
    assert(Array.isArray(place.sourceRefs) && Array.isArray(place.riverLinks), place.id);
    for (const key of ["representative", "waterfront", "sampling"]) {
      const point = place.positions[key];
      assert(point === null || (Number.isFinite(point?.latitude) && Math.abs(point.latitude) <= 90 &&
        Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180), `${place.id} ${key}`);
    }
    locations.set(place.id, {...place, datasetId: dataset.id});
  }
}
for (const place of locations.values()) {
  if (place.lifecycle !== "merged") {
    assert(!place.mergedInto, place.id);
    continue;
  }
  const visited = new Set([place.id]);
  let target = place;
  while (target.lifecycle === "merged") {
    const next = locations.get(target.mergedInto);
    assert(next && !visited.has(next.id), `Missing or circular merge target for ${place.id}`);
    visited.add(next.id);
    target = next;
  }
}
for (const event of await read(catalog.historyPath)) {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(event.date) && event.note?.trim() && datasets.has(event.datasetId), "Invalid history entry");
  if (event.action !== "import") {
    assert(["add", "update", "merge", "exclude", "restore"].includes(event.action), event.action);
    assert.equal(locations.get(event.locationId)?.datasetId, event.datasetId, event.locationId);
  }
}
console.log(`${locations.size} locations across ${datasets.size} datasets validated`);
