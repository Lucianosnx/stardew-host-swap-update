// --- estado global ---
let ORIGINAL_XML_STRING = "";
let XMLDOC = null;
let PLAYERS = []; // [{name, type: 'host'|'farmhand', index}]

// Utils
const q1 = (root, sel) => root.querySelector(sel);
const qAll = (root, sel) => Array.from(root.querySelectorAll(sel));
const text = (el, sel) => {
  const n = sel ? q1(el, sel) : el;
  return n ? (n.textContent ?? "").trim() : "";
};
function ensureChild(parent, tag){
  let n = q1(parent, tag);
  if(!n){
    n = parent.ownerDocument.createElement(tag);
    parent.appendChild(n);
  }
  return n;
}
const childTexts = (parent, tag) => qAll(parent, tag).map(n => (n.textContent ?? "").trim());
function addChildText(parent, tag, val){
  const el = parent.ownerDocument.createElement(tag);
  el.textContent = val;
  parent.appendChild(el);
}
const serializeXML = (doc) => new XMLSerializer().serializeToString(doc);

// Copia filhos (sem usar innerHTML, que é problemático em XML)
function replaceChildrenWithClone(dest, src){
  while (dest.firstChild) dest.removeChild(dest.firstChild);
  const doc = dest.ownerDocument;
  for (let i = 0; i < src.childNodes.length; i++){
    dest.appendChild(src.childNodes[i].cloneNode(true));
  }
}

// === PARSE ===
function parseFromTextarea(e){
  ORIGINAL_XML_STRING = e.target.value;
  if(!ORIGINAL_XML_STRING || !ORIGINAL_XML_STRING.includes("<SaveGame")) return null;

  const parser = new DOMParser();
  XMLDOC = parser.parseFromString(ORIGINAL_XML_STRING, "text/xml");
  if(q1(XMLDOC, "parsererror")) return null;

  const save = q1(XMLDOC, "SaveGame");
  if(!save) return null;

  // CORREÇÃO: precisa de :scope >
  const host = q1(save, ":scope > player");
  if(!host) return null;

  const hostName = text(host, "name") || "Host";
  PLAYERS = [{ name: hostName, type: "host", index: -1 }];

  // Formato novo
  const farmhandsRoot = q1(save, ":scope > farmhands");
  let farmhands = [];
  if (farmhandsRoot){
    farmhands = qAll(farmhandsRoot, ":scope > Farmer");
  }
  // Formato antigo
  if (farmhands.length === 0){
    farmhands = qAll(save, ":scope > farmhand");
  }

  farmhands.forEach((fh, i) => {
    const nm = text(fh, "name") || `Farmhand ${i+1}`;
    PLAYERS.push({ name: nm, type: "farmhand", index: i });
  });

  return PLAYERS;
}

// === UI ===
function setCharacters(e){
  const players = parseFromTextarea(e);
  const div = document.getElementById("instructions");
  while(div.firstChild) div.removeChild(div.firstChild);

  if(!players){
    div.appendChild(document.createTextNode(
      "Erro: não consegui ler o save. Confira se colou o XML completo (começando por '<?xml ...')."
    ));
    return;
  }

  div.appendChild(document.createTextNode("Escolha o novo host (pode levar um momento): "));
  players.forEach((p, i) => {
    const input = document.createElement("input");
    input.type = "submit";
    input.value = p.name;
    input.onclick = () => submit(i);
    div.appendChild(input);
  });

  if(players.length < 2){
    const p = document.createElement("p");
    p.id = "instruction2";
    p.appendChild(document.createTextNode("Nenhum farmhand encontrado."));
    div.appendChild(p);
  }
}

// === Correções específicas ===
const TRANSFERRABLE_MAIL = new Set([
  "ccDoorUnlock","ccPantry","ccCraftsRoom","ccFishTank","ccBoilerRoom","ccBulletin","ccVault",
  "jojaPantry","jojaCraftsRoom","jojaFishTank","jojaBoilerRoom","jojaVault","JojaMember",
  "spring_2_1"
]);
const TRANSFERRABLE_EVENTS = new Set([
  "65","1590166","897405","611439","191393","502261"
]);

function mergeMail(newHostEl, oldHostEl){
  const newMailRoot = ensureChild(newHostEl, "mailReceived");
  const oldMailRoot = ensureChild(oldHostEl, "mailReceived");
  const newSet = new Set(childTexts(newMailRoot, "string"));
  const oldList = childTexts(oldMailRoot, "string");
  oldList.forEach(m => {
    if (TRANSFERRABLE_MAIL.has(m) && !newSet.has(m)){
      addChildText(newMailRoot, "string", m);
      newSet.add(m);
    }
  });
}

function mergeEvents(newHostEl, oldHostEl){
  const newEvRoot = ensureChild(newHostEl, "eventsSeen");
  const oldEvRoot = ensureChild(oldHostEl, "eventsSeen");
  const newSet = new Set(childTexts(newEvRoot, "int"));
  const oldList = childTexts(oldEvRoot, "int");
  oldList.forEach(ev => {
    if (TRANSFERRABLE_EVENTS.has(ev) && !newSet.has(ev)){
      addChildText(newEvRoot, "int", ev);
      newSet.add(ev);
    }
  });
}

function copySimpleTag(destEl, srcEl, tag){
  const d = ensureChild(destEl, tag);
  const s = ensureChild(srcEl, tag);
  d.textContent = (s.textContent ?? "").trim();
}

function fixUpgradeLevels(newHostEl, oldHostEl){
  copySimpleTag(newHostEl, oldHostEl, "houseUpgradeLevel");
  copySimpleTag(newHostEl, oldHostEl, "daysUntilHouseUpgrade");
}
function fixHomeLocationForceFarmHouse(newHostEl){
  const h = ensureChild(newHostEl, "homeLocation");
  h.textContent = "FarmHouse";
}
function fixHomeLocationCopy(newHostEl, oldHostEl){
  copySimpleTag(newHostEl, oldHostEl, "homeLocation");
}

// === SWAP ===
function submit(idx){
  const div = document.getElementById("instructions");
  const prev = document.getElementById("instruction2");
  if(prev) div.removeChild(prev);

  const note = document.createElement("p");
  note.id = "instruction2";
  note.appendChild(document.createTextNode(
    `Novo host: ${PLAYERS[idx].name}. Substitua o conteúdo do seu arquivo de save por este resultado.`
  ));
  div.appendChild(note);

  const out = document.getElementById("output");
  if(idx === 0){
    out.value = ORIGINAL_XML_STRING;
    out.select();
    return;
  }

  const save = q1(XMLDOC, "SaveGame");
  const host = q1(save, ":scope > player"); // CORREÇÃO :scope

  // localizar farmhand alvo (novo e antigo)
  let targetEl = null;
  const farmhandsRoot = q1(save, ":scope > farmhands"); // CORREÇÃO :scope
  if (farmhandsRoot){
    const list = qAll(farmhandsRoot, ":scope > Farmer");
    targetEl = list[PLAYERS[idx].index] || null;
  }
  if(!targetEl){
    const listOld = qAll(save, ":scope > farmhand");
    targetEl = listOld[PLAYERS[idx].index] || null;
  }
  if(!targetEl){
    out.value = "Erro: não foi possível localizar o farmhand selecionado no XML.";
    return;
  }

  // Clones para correções
  const hostClone = host.cloneNode(true);
  const tgtClone  = targetEl.cloneNode(true);

  // Swap de filhos (em XML, sem innerHTML)
  const hostTemp = host.cloneNode(false);
  replaceChildrenWithClone(hostTemp, targetEl);
  replaceChildrenWithClone(targetEl, host);
  replaceChildrenWithClone(host, hostTemp);

  // Correções
  mergeEvents(host, hostClone);
  mergeMail(host, hostClone);
  fixUpgradeLevels(host, hostClone);
  fixHomeLocationForceFarmHouse(host);

  fixUpgradeLevels(targetEl, tgtClone);
  fixHomeLocationCopy(targetEl, tgtClone);

  const finalStr = serializeXML(XMLDOC);
  const hasXmlDecl = /^\s*<\?xml/i.test(ORIGINAL_XML_STRING);
  out.value = hasXmlDecl ? finalStr : '<?xml version="1.0" encoding="utf-8"?>\n' + finalStr;
  out.select();
}

// Copiar
function copyOut(){
  const out = document.getElementById("output");
  out.select();
  document.execCommand("copy");
}
// Alias opcional se seu HTML ainda chama copy()
function copy(){ copyOut(); }
