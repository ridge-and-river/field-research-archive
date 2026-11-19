const byId = id => document.getElementById(id);
const campaignStatus = {initial: "第一次調査", planned: "収録データなし", ongoing: "調査中", complete: "完了"};
const lifecycle = {active: "候補", merged: "統合済み", excluded: "除外済み"};
const historyAction = {import: "移行", add: "追加", update: "修正", merge: "統合", exclude: "除外", restore: "復帰"};
const scopes = ["campaign", "country", "region", "area"];
const keys = ["campaignId", "countryCode", "region", "adminArea"];
const controls = ["q", ...scopes, "archive", "json", "csv"];

function node(tag, value, className) {
  const element = document.createElement(tag);
  if (value !== undefined) element.textContent = value;
  if (className) element.className = className;
  return element;
}

async function read(path) {
  const response = await fetch(new URL(path, new URL("./", import.meta.url)));
  if (!response.ok) throw new Error(`${response.status} ${path}`);
  return response.json();
}

function download(filename, content, type) {
  const link = node("a");
  link.href = URL.createObjectURL(new Blob([content], {type}));
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function csv(records) {
  const columns = ["id", "name", "campaignId", "countryCode", "region", "adminArea", "locality",
    "topicId", "lifecycle", "researchStatus", "mergedInto", "positions", "sourceRefs", "riverLinks", "verificationNotes"];
  function cell(value) {
    let text = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "");
    if (/^[\s]*[=+@-]|^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  }
  return "\uFEFF" + [columns.join(","), ...records.map(record => columns.map(key => cell(record[key])).join(","))].join("\r\n");
}

function locationView(place, country, topic, changes) {
  const record = node("details", undefined, "record");
  const summary = node("summary");
  const title = node("strong", place.name);
  if (place.lifecycle !== "active") title.append(node("span", lifecycle[place.lifecycle], "meta"));
  summary.append(
    node("span", place.id, "record-id"),
    title,
    node("span", [country, place.adminArea, place.locality].filter(Boolean).join(" ／ "), "meta")
  );
  const body = node("div", undefined, "record-body");
  body.append(node("p", topic + " ｜ " + place.researchStatus));
  const fields = node("dl");
  for (const [key, label] of Object.entries({representative: "代表位置", waterfront: "水際候補", sampling: "採水候補"})) {
    const position = place.positions[key];
    fields.append(node("dt", label), node("dd", position ? `${position.latitude}, ${position.longitude}` : "座標未登録"));
  }
  body.append(fields);
  if (place.sourceRefs.length) body.append(node("p", "元資料の出典ID  " + place.sourceRefs.join("、"), "meta"));
  if (place.mergedInto) body.append(node("p", "統合先  " + place.mergedInto));
  for (const note of place.verificationNotes ?? []) {
    const paragraph = node("p", note.text);
    for (const source of note.sources) {
      const url = new URL(source.url);
      if (!["https:", "http:"].includes(url.protocol)) continue;
      const link = node("a", source.title);
      link.href = url.href;
      paragraph.append(" ", link);
    }
    body.append(paragraph);
  }
  for (const change of changes) body.append(node("p", `${change.date}  ${historyAction[change.action]}  ${change.note}`, "meta"));
  record.append(summary, body);
  return record;
}

async function start() {
  const catalog = await read("catalog.json");
  const [history, ...entries] = await Promise.all([read(catalog.historyPath),
    ...catalog.datasets.map(async dataset => (await read(dataset.path)).map(place => ({
      ...place, campaignId: dataset.campaignId, datasetId: dataset.id
    })))]);
  const records = entries.flat();
  const countryNames = new Map(catalog.countries.map(({code, name}) => [code, name]));
  const campaignNames = new Map(catalog.campaigns.map(({id, name}) => [id, name]));
  const topicNames = new Map(catalog.topics.map(({id, name}) => [id, name]));
  const labels = [campaignNames, countryNames];
  for (const campaign of catalog.campaigns) {
    const card = node("li", campaign.name);
    card.dataset.status = campaign.status;
    card.append(node("span", campaignStatus[campaign.status]));
    byId("campaigns").append(card);
  }
  for (const change of history.slice().reverse()) {
    byId("history").append(node("li", `${change.date}  ${historyAction[change.action]}  ${change.locationId ?? ""} ${change.note}`));
  }
  const normalize = text => text.normalize("NFKC").toLocaleLowerCase("ja");
  function render() {
    const active = records.filter(place => byId("archive").checked || place.lifecycle === "active");
    let filtered = active;
    for (const [index, scope] of scopes.entries()) {
      const select = byId(scope);
      const prior = select.value;
      const key = keys[index];
      const options = index === 0 ? [...campaignNames.keys()] : [...new Set(filtered.map(place => place[key]).filter(Boolean))];
      select.replaceChildren(new Option("すべて", ""), ...options.map(value => new Option(labels[index]?.get(value) ?? value, value)));
      select.value = options.includes(prior) ? prior : "";
      if (select.value) filtered = filtered.filter(place => place[key] === select.value);
    }
    const terms = normalize(byId("q").value).trim().split(/\s+/).filter(Boolean);
    const matches = filtered.filter(place => {
      const text = normalize([place.id, place.name, place.countryCode, countryNames.get(place.countryCode),
        place.region, place.adminArea, place.locality, topicNames.get(place.topicId)].join(" "));
      return terms.every(term => text.includes(term));
    });
    byId("count").textContent = `${matches.length} / ${active.length} 地点を表示`;
    const views = matches.map(place => locationView(place, countryNames.get(place.countryCode), topicNames.get(place.topicId),
      history.filter(change => change.locationId === place.id).slice().reverse()));
    const empty = campaignStatus[catalog.campaigns.find(item => item.id === byId("campaign").value)?.status];
    byId("results").replaceChildren(...(views.length ? views : [node("p", empty === "収録データなし" ? empty : "該当地点なし")]));
    byId("json").disabled = byId("csv").disabled = !matches.length;
    byId("json").onclick = () => download("field-locations.json", JSON.stringify(matches, null, 2) + "\n", "application/json");
    byId("csv").onclick = () => download("field-locations.csv", csv(matches), "text/csv;charset=utf-8");
  }
  byId("filters").addEventListener("submit", event => event.preventDefault());
  byId("filters").addEventListener("input", render);
  for (const id of controls) byId(id).disabled = false;
  render();
}

start().catch(error => {
  byId("count").textContent = "調査データを読み込めませんでした。ページを再読み込みしてください。";
  console.error(error);
});
