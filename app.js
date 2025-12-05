/* =====================================================
   쓰레기통 웹앱 app.js
   - 마커 하이라이트
   - 중복 제거
   - 경로 표시 + 선 위 화살표
   - 내 위치 + 방향 화살표 + 정확도 개선
   - 우측 상단 나침반 표시
   - 타입 필터(모두 / 일반 / 재활용)
   - 지도 테마(라이트/다크) + 스타일(OSM/CARTO/Voyager) 선택
   - 슬라이드 설정 패널 + 문의하기 팝업
===================================================== */

/* ---------------------- GLOBAL STATE ---------------------- */
// ⭐ Google Apps Script Web App URL
const UPDATE_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbzeqmh1psSinf5Qv5Tt3C1lXT4IBbaOUpWnRXJURU-bPALs9wWa8PYalxYNKxEUD1t6/exec";
// ⭐ 문의사항 Google Sheets Web App URL
const INQUIRY_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbxQOfJQNFgGStxyMvOMdpg4RMkpz38hKaMDqpHt1mUw41GE1JZGeAt6YFUKQ_poYL3I/exec";

// ⭐ 앱 공유용 URL (나중에 실제 배포 주소로 바꿔도 됨)
const APP_SHARE_URL = window.location.href;

let userLat = null;
let userLng = null;
let lastClickedBinForInquiry = null; // 문의용으로 마지막 클릭한 쓰레기통

// 👉 첫 방문 안내 팝업을 이미 보여줬는지
let locateHintShown = localStorage.getItem("LOCATE_HINT_SHOWN") === "Y";

const markersById = {};
const binById = {}; // id → bin 데이터

// 타입 필터 상태 (기본: 둘 다 켜짐)
let typeFilterState = {
  general: true, // 일반
  recycle: true, // 재활용
};

// 현재 강조(하이라이트) 중인 마커
let currentHighlightedMarker = null;

// ✅ 앱 경로 안내 팝업을 이미 보여줬는지 여부
let inAppRouteAlertShown = false;

// ✅ 우리 앱에서 그린 경로(폴리라인)를 저장
let routeLayer = null;
// ✅ 경로 화살표 레이어 저장
let routeArrows = null;

// ✅ 내 위치 + 방향 화살표용 전역
let userMarker = null; // 내 위치 마커
let geoHeading = null; // GPS 이동 방향
let compassHeading = null; // 나침반 방향
let lastHeading = 0; // 마지막으로 사용한 각도
let geoWatchId = null; // watchPosition ID
let hasInitialFix = false; // 첫 위치를 잡았는지 여부

// 🔧 위치 정확도 개선용 전역
const MIN_ACCURACY = 50; // m, 이보다 안 좋으면 위치 업데이트 무시
let recentPositions = []; // 최근 위치 샘플들 (보정용)
const RECENT_POS_LIMIT = 5; // 최대 5개까지 평균

// 🔧 나침반 컨트롤용 전역
let compassSvgEl = null;

// ✅ 지도 테마/스타일 상태
let currentTheme = "light"; // "light" | "dark"
let currentStyle = "osm"; // "osm" | "carto" | "voyager"
let tileLayer = null;

// 🔄 로딩 오버레이용 전역
let loadingOverlayEl = null;
let loadingTextEl = null;

// 🧷 지도에서 문의 위치 선택 모드 여부
let isPickingInquiryLocation = false;

/* ---------------------- LOADING OVERLAY ---------------------- */
function ensureLoadingOverlay() {
  if (loadingOverlayEl) return;

  const overlay = document.createElement("div");
  overlay.id = "loading-overlay";
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.background = "rgba(0,0,0,0.25)";
  overlay.style.display = "none";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.zIndex = "13000";

  const card = document.createElement("div");
  card.style.minWidth = "220px";
  card.style.maxWidth = "80%";
  card.style.padding = "14px 16px";
  card.style.borderRadius = "14px";
  card.style.background = "#ffffff";
  card.style.boxShadow = "0 10px 30px rgba(0,0,0,0.3)";
  card.style.display = "flex";
  card.style.alignItems = "center";
  card.style.gap = "10px";
  card.style.fontSize = "14px";

  const spinner = document.createElement("div");
  spinner.style.width = "18px";
  spinner.style.height = "18px";
  spinner.style.borderRadius = "50%";
  spinner.style.border = "2px solid #e5e7eb";
  spinner.style.borderTopColor = "#1a73e8";
  spinner.style.animation = "loading-spin 0.8s linear infinite";

  const text = document.createElement("div");
  text.textContent = "불러오는 중이에요...";
  text.style.color = "#111827";

  card.appendChild(spinner);
  card.appendChild(text);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // 애니메이션 스타일 추가
  const styleEl = document.createElement("style");
  styleEl.textContent = `
    @keyframes loading-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(styleEl);

  loadingOverlayEl = overlay;
  loadingTextEl = text;
}

function showLoading(message) {
  ensureLoadingOverlay();
  if (loadingTextEl && message) loadingTextEl.textContent = message;
  loadingOverlayEl.style.display = "flex";
}

function hideLoading() {
  if (!loadingOverlayEl) return;
  loadingOverlayEl.style.display = "none";
}

/* ---------------------- 내 위치 화살표 아이콘 ---------------------- */
const myLocationSVG = `
<svg width="40" height="40" viewBox="0 0 24 24"
  xmlns="http://www.w3.org/2000/svg">
  <path d="M12 2 L20 22 L12 17 L4 22 Z"
    fill="#2979FF"
    stroke="white"
    stroke-width="2"
    stroke-linejoin="round"
  />
</svg>
`;

const userArrowIcon = L.divIcon({
  className: "",
  html: myLocationSVG,
  iconSize: [40, 40],
  iconAnchor: [20, 20], // 중심 기준
});

/* ---------------------- 방향 업데이트 ---------------------- */
function updateUserMarkerHeading() {
  let heading = null;

  if (geoHeading !== null && !isNaN(geoHeading)) {
    heading = geoHeading; // 이동 중이면 GPS 우선
  } else if (compassHeading !== null && !isNaN(compassHeading)) {
    heading = compassHeading; // 멈춰 있으면 나침반 사용
  }

  if (heading === null) return;

  lastHeading = heading;

  if (userMarker && typeof userMarker.setRotationAngle === "function") {
    userMarker.setRotationAngle(heading);
  } else if (userMarker && userMarker._icon) {
    userMarker._icon.style.transform = `rotate(${heading}deg)`;
  }

  if (compassSvgEl) {
    compassSvgEl.style.transform = `rotate(${heading}deg)`;
    compassSvgEl.style.transformOrigin = "50% 50%";
  }
}

/* ---------------------- 나침반 ---------------------- */
function handleOrientation(event) {
  const alpha = event.alpha;
  if (alpha === null || isNaN(alpha)) return;

  compassHeading = alpha;
  updateUserMarkerHeading();
}

function initCompass() {
  if (typeof DeviceOrientationEvent === "undefined") return;

  if (typeof DeviceOrientationEvent.requestPermission === "function") {
    DeviceOrientationEvent.requestPermission()
      .then((res) => {
        if (res === "granted") {
          window.addEventListener("deviceorientation", handleOrientation, true);
        } else {
          console.log("나침반 권한 거부됨");
        }
      })
      .catch((err) => console.error(err));
  } else {
    window.addEventListener("deviceorientation", handleOrientation, true);
  }
}

/* ---------------------- 위치 그룹핑 ---------------------- */
const locationGroups = {};
if (window.BINS_SEOUL) {
  window.BINS_SEOUL.forEach((bin) => {
    if (!bin.lat || !bin.lng) return;
    const key = `${bin.lat}|${bin.lng}`;
    if (!locationGroups[key]) locationGroups[key] = [];
    locationGroups[key].push(bin);
  });
}

/* ---------------------- BIN 중복 제거 ---------------------- */
function dedupeBins(bins) {
  if (!Array.isArray(bins)) return [];
  const seen = new Set();
  const result = [];

  bins.forEach((bin) => {
    const lat = bin.lat ?? "";
    const lng = bin.lng ?? "";
    const name = (bin.name || "").trim();
    const type = (bin.type || "").trim();

    const key = `${lat}|${lng}|${name}|${type}`;

    if (!seen.has(key)) {
      seen.add(key);
      result.push(bin);
    }
  });

  return result;
}

if (window.BINS_SEOUL) {
  window.BINS_SEOUL = dedupeBins(window.BINS_SEOUL);
  console.log("중복 제거 후 BINS_SEOUL 개수:", window.BINS_SEOUL.length);
}

/* ---------------------- MAP INIT ---------------------- */
const map = L.map("map").setView([37.5665, 126.978], 11);
map.zoomControl.setPosition("bottomright");

const TILE_URLS = {
  osm: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  carto_light:
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  carto_dark:
    "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  voyager:
    "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
};

const tileOptions = {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors, &copy; CARTO",
};

function getCurrentTileUrl() {
  if (currentStyle === "osm") {
    return TILE_URLS.osm;
  }

  if (currentStyle === "carto") {
    return currentTheme === "dark"
      ? TILE_URLS.carto_dark
      : TILE_URLS.carto_light;
  }

  if (currentStyle === "voyager") {
    return TILE_URLS.voyager;
  }

  return TILE_URLS.osm;
}

function refreshBaseLayer() {
  const url = getCurrentTileUrl();
  document.documentElement.setAttribute("data-theme", currentTheme);

  if (tileLayer) {
    map.removeLayer(tileLayer);
  }

  tileLayer = L.tileLayer(url, tileOptions).addTo(map);
}

refreshBaseLayer();

const markerCluster = L.markerClusterGroup({
  spiderfyOnClick: false,
  zoomToBoundsOnClick: true,
  maxClusterRadius: 40,
  disableClusteringAtZoom: 18,
});
map.addLayer(markerCluster);

/* ---------------------- 우측 상단 나침반 컨트롤 ---------------------- */
function createCompassControl() {
  const compassControl = L.control({ position: "topright" });

  compassControl.onAdd = function () {
    const div = L.DomUtil.create("div", "compass-control");
    div.style.width = "50px";
    div.style.height = "50px";
    div.style.borderRadius = "50%";
    div.style.background = "rgba(255,255,255,0.9)";
    div.style.boxShadow = "0 2px 6px rgba(0,0,0,0.25)";
    div.style.display = "flex";
    div.style.alignItems = "center";
    div.style.justifyContent = "center";
    div.style.cursor = "default";

    div.innerHTML = `
      <svg viewBox="0 0 100 100" width="36" height="36">
        <circle cx="50" cy="50" r="45" fill="#ffffff" stroke="#ccc" stroke-width="3"/>
        <text x="50" y="18" text-anchor="middle" font-size="14" fill="red">N</text>
        <text x="50" y="90" text-anchor="middle" font-size="14" fill="blue">S</text>
        <text x="88" y="54" text-anchor="middle" font-size="12" fill="#555">E</text>
        <text x="12" y="54" text-anchor="middle" font-size="12" fill="#555">W</text>
        <polygon points="50,22 58,42 42,42" fill="red"/>
        <polygon points="50,78 58,58 42,58" fill="blue"/>
      </svg>
    `;

    compassSvgEl = div.querySelector("svg");

    L.DomEvent.disableClickPropagation(div);
    return div;
  };

  compassControl.addTo(map);
}

createCompassControl();

/* ---------------------- TYPE & ICON ---------------------- */
const PURPLE_ICON_URL =
  "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-violet.png";

function getBinColor(bin) {
  const t = (bin.type || "").toLowerCase();

  if (t.includes("재활용")) return "green";
  if (t.includes("일반")) return "orange";
  return "red";
}

function getBinMarkerIcon(bin, highlighted = false) {
  const iconSize = highlighted ? [35, 57] : [25, 41];
  const iconAnchor = [iconSize[0] / 2, iconSize[1]];

  if (bin.edited === "Y") {
    return L.icon({
      iconUrl: PURPLE_ICON_URL,
      shadowUrl:
        "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-shadow.png",
      iconSize,
      iconAnchor,
      popupAnchor: [1, -34],
      shadowSize: [41, 41],
    });
  }

  const color = getBinColor(bin);

  return L.icon({
    iconUrl:
      "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-" +
      color +
      ".png",
    shadowUrl:
      "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-shadow.png",
    iconSize,
    iconAnchor,
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
  });
}

/* ---------------------- 타입 필터 ---------------------- */
function isBinVisibleByType(bin) {
  const t = (bin.type || "").toLowerCase();
  const isGeneral = t.includes("일반");
  const isRecycle = t.includes("재활용");

  if (isGeneral && !isRecycle) return typeFilterState.general;
  if (isRecycle && !isGeneral) return typeFilterState.recycle;

  return typeFilterState.general || typeFilterState.recycle;
}

function applyTypeFilterToMarkers() {
  Object.keys(markersById).forEach((id) => {
    const marker = markersById[id];
    const bin = binById[id];
    if (!marker || !bin) return;

    const visible = isBinVisibleByType(bin);

    if (visible) {
      if (!markerCluster.hasLayer(marker)) {
        markerCluster.addLayer(marker);
      }
    } else {
      if (markerCluster.hasLayer(marker)) {
        markerCluster.removeLayer(marker);
      }
    }
  });
}

/* ---------------------- 하이라이트 ---------------------- */
function highlightMarker(marker) {
  if (!marker) return;

  if (currentHighlightedMarker && currentHighlightedMarker !== marker) {
    if (currentHighlightedMarker._normalIcon) {
      currentHighlightedMarker.setIcon(currentHighlightedMarker._normalIcon);
    }
  }

  if (marker._highlightIcon) {
    marker.setIcon(marker._highlightIcon);
  }

  currentHighlightedMarker = marker;
}

/* ---------------------- DISTANCE ---------------------- */
function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(d) {
  return d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`;
}

/* ---------------------- 경로 & 길찾기 ---------------------- */
function drawRouteToBin(bin) {
  if (userLat == null || userLng == null) {
    alert(
      "먼저 ‘📍 내 위치’ 버튼을 눌러 현재 위치를 가져와 주세요.\n\n" +
        "내 위치가 있어야 쓰레기통까지의 경로를 그릴 수 있어요."
    );
    return;
  }

  if (!bin || !bin.lat || !bin.lng) {
    alert(
      "이 쓰레기통의 위치 정보가 정확하지 않아 경로를 표시할 수 없어요.\n\n" +
        "지도에서 주변 도로를 직접 확인해 주세요."
    );
    return;
  }

  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }
  if (routeArrows) {
    map.removeLayer(routeArrows);
    routeArrows = null;
  }

  const startLat = userLat;
  const startLng = userLng;
  const endLat = bin.lat;
  const endLng = bin.lng;

  const url = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson`;

  showLoading("쓰레기통까지 경로를 불러오는 중이에요...");

  fetch(url)
    .then((res) => res.json())
    .then((data) => {
      if (!data.routes || !data.routes.length) {
        alert(
          "경로를 찾지 못했어요.\n\n" +
            "조금 더 지도를 확대해서 주변 도로를 확인해 주세요."
        );
        return;
      }

      const coords = data.routes[0].geometry.coordinates.map((c) => [c[1], c[0]]);

      routeLayer = L.polyline(coords, {
        color: "#007aff",
        weight: 7,
        opacity: 0.9,
      }).addTo(map);

      if (L.polylineDecorator) {
        routeArrows = L.polylineDecorator(routeLayer, {
          patterns: [
            {
              offset: 25,
              repeat: 50,
              symbol: L.Symbol.arrowHead({
                pixelSize: 12,
                polygon: false,
                pathOptions: {
                  stroke: true,
                  color: "#007aff",
                  weight: 2,
                },
              }),
            },
          ],
        }).addTo(map);
      } else {
        console.warn("leaflet.polylineDecorator가 로드되지 않았어요.");
      }

      map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });
    })
    .catch((err) => {
      console.error(err);
      alert(
        "길찾기 경로를 불러오는 데 실패했어요.\n\n" +
          "네트워크 상태를 확인한 뒤\n잠시 후 다시 시도해 주세요."
      );
    })
    .finally(() => {
      hideLoading();
    });
}

function openInAppRoute(bin) {
  if (!bin || !bin.lat || !bin.lng) {
    alert(
      "이 쓰레기통의 위치 정보가 정확하지 않아 길찾기를 제공할 수 없어요.\n\n" +
        "지도에서 주변 도로를 직접 확인해 주세요."
    );
    return;
  }

  drawRouteToBin(bin);

  if (!inAppRouteAlertShown) {
    alert(
      "이 화면의 ‘앱에서 경로 보기’는\n지도 위에 대략적인 경로만 보여줘요.\n\n" +
        "실제 내비게이션 안내가 필요하다면\n‘카카오맵 내비 열기’를 이용해 주세요."
    );
    inAppRouteAlertShown = true;
  }
}

function openDirections(bin) {
  if (!bin || !bin.lat || !bin.lng) {
    alert(
      "이 쓰레기통의 위치 정보가 정확하지 않아 길찾기를 제공할 수 없어요.\n\n" +
        "지도에서 주변 도로를 직접 확인해 주세요."
    );
    return;
  }

  const url = `https://map.kakao.com/link/to/${encodeURIComponent(
    bin.name || "쓰레기통"
  )},${bin.lat},${bin.lng}`;
  window.open(url, "_blank");
}

/* ---------------------- 문의 위치명 입력 헬퍼 ---------------------- */
function updateInquiryLocationField() {
  const locInput = document.getElementById("inquiry-location");
  if (!locInput) return;
  if (!lastClickedBinForInquiry) return;

  const b = lastClickedBinForInquiry;

  // 주소를 최우선 → 없으면 이름 → 그래도 없으면 ""
  locInput.value = b.addr || b.name || "";
}

/* ---------------------- MARKERS ---------------------- */
function addBinsToMap() {
  const groupIndex = {};

  BINS_SEOUL.forEach((bin) => {
    if (!bin.lat || !bin.lng) return;

    const key = `${bin.lat}|${bin.lng}`;
    const group = locationGroups[key] || [];

    let markerLat = bin.lat;
    let markerLng = bin.lng;

    if (group.length > 1) {
      const idx = groupIndex[key] || 0;
      groupIndex[key] = idx + 1;

      const n = group.length;
      const angle = (2 * Math.PI * idx) / n;
      const radiusMeters = 6;

      const dLat = (radiusMeters / 111000) * Math.cos(angle);
      const dLng =
        (radiusMeters /
          (111000 * Math.cos((markerLat * Math.PI) / 180))) *
        Math.sin(angle);

      markerLat += dLat;
      markerLng += dLng;
    }

    const normalIcon = getBinMarkerIcon(bin, false);
    const highlightIcon = getBinMarkerIcon(bin, true);

    const marker = L.marker([markerLat, markerLng], {
      icon: normalIcon,
    });

    marker._normalIcon = normalIcon;
    marker._highlightIcon = highlightIcon;

    marker.on("click", () => {
      const newZoom = Math.max(map.getZoom(), 16);
      map.setView([markerLat, markerLng], newZoom);
      openMiniInfo(bin);
      highlightMarker(marker);

      lastClickedBinForInquiry = bin;
      updateInquiryLocationField();

      // 🧷 문의 위치 선택 모드일 때 → 이 핀을 문의 위치로 확정하고 모달 다시 열기
      if (isPickingInquiryLocation) {
        isPickingInquiryLocation = false;

        const inquiryBackdrop = document.getElementById("inquiry-backdrop");
        const inquiryModal = document.getElementById("inquiry-modal");
        if (inquiryBackdrop) inquiryBackdrop.classList.add("open");
        if (inquiryModal) inquiryModal.classList.add("open");
      }
    });

    markersById[bin.id] = marker;
    binById[bin.id] = bin;

    if (isBinVisibleByType(bin)) {
      markerCluster.addLayer(marker);
    }
  });
}

/* ---------------------- MINI INFO CARD ---------------------- */
let miniInfoEl = null;

function ensureMiniInfoDom() {
  if (miniInfoEl) return miniInfoEl;

  miniInfoEl = document.createElement("div");
  miniInfoEl.id = "mini-info";
  document.body.appendChild(miniInfoEl);

  map.on("click", () => {
    miniInfoEl.classList.remove("active");
    document.body.classList.remove("mini-open");
  });

  return miniInfoEl;
}

function openMiniInfo(bin) {
  const el = ensureMiniInfoDom();

  let distanceText = "";
  if (userLat != null && userLng != null) {
    const d = getDistanceMeters(userLat, userLng, bin.lat, bin.lng);
    distanceText = ` · ${formatDistance(d)}`;
  }

  const metaParts = [];
  if (bin.district) metaParts.push(bin.district);
  if (bin.type) metaParts.push(bin.type);
  const meta = metaParts.join(" · ");

  el.innerHTML = `
    <div class="mini-header">
      <strong>${bin.name || "쓰레기통"}</strong>
    </div>
    <div class="mini-addr">${bin.addr || ""}</div>
    <div class="mini-meta">${meta}${distanceText}</div>
    <div class="mini-note">
      ※ 공공데이터 기반으로 실제 위치와 몇 미터 차이가 날 수 있어요.
    </div>
    <div class="mini-btn-row">
      <button class="direction-btn app-route-btn">앱에서 경로 보기</button>
      <button class="direction-btn kakao-route-btn">카카오맵 내비 열기</button>
    </div>
  `;

  el.querySelector(".app-route-btn").addEventListener("click", () => {
    openInAppRoute(bin);
  });

  el.querySelector(".kakao-route-btn").addEventListener("click", () => {
    openDirections(bin);
  });

  el.classList.add("active");
  document.body.classList.add("mini-open");
}

/* ---------------------- DISTRICT FILTER ---------------------- */
function populateDistrictFilter() {
  const select = document.getElementById("districtFilter");
  if (!select) return;

  const set = new Set();
  BINS_SEOUL.forEach((b) => {
    if (b.district) set.add(b.district.trim());
  });

  [...set].sort().forEach((dist) => {
    const opt = document.createElement("option");
    opt.value = dist;
    opt.textContent = dist;
    select.appendChild(opt);
  });
}

/* ---------------------- MAIN LIST ---------------------- */
function updateNearbyBins(lat, lng) {
  const listEl = document.getElementById("nearby-list");
  if (!listEl) return;

  if (lat == null || lng == null) {
    listEl.innerHTML = `<li class="empty-state">
        아직 <strong>내 위치</strong> 정보를 가져오지 않았어요.<br/><br/>
        오른쪽 아래의 <strong>파란 동그라미 버튼(📍)</strong>을 누르면<br/>
        현재 위치 기준으로 가까운 쓰레기통을 보여드려요.<br/><br/>
        또는 위 검색창에 <strong>구 이름, 주소, 장소명</strong>을 입력해서<br/>
        원하는 위치 근처의 쓰레기통을 직접 찾을 수도 있어요.
      </li>`;
    return;
  }

  const searchInput = document.getElementById("searchInput");
  const keyword = searchInput ? searchInput.value.trim().toLowerCase() : "";

  const districtSelect = document.getElementById("districtFilter");
  const district =
    districtSelect && districtSelect.value ? districtSelect.value : "ALL";

  const viewportOnly =
    document.getElementById("viewportOnly")?.checked || false;
  const districtCenterMode =
    document.getElementById("districtCenterMode")?.checked || false;

  const bounds = map.getBounds();

  let filtered = BINS_SEOUL.filter((b) => b.lat && b.lng);

  filtered = filtered.filter((b) => isBinVisibleByType(b));

  if (district !== "ALL") {
    filtered = filtered.filter((b) => b.district === district);
  }

  if (keyword !== "") {
    filtered = filtered.filter(
      (b) =>
        (b.name || "").toLowerCase().includes(keyword) ||
        (b.addr || "").toLowerCase().includes(keyword) ||
        (b.district || "").toLowerCase().includes(keyword)
    );
  }

  if (viewportOnly && keyword === "") {
    filtered = filtered.filter((b) => bounds.contains([b.lat, b.lng]));
  }

  let baseLat = lat;
  let baseLng = lng;

  if (districtCenterMode && district !== "ALL" && filtered.length > 0) {
    baseLat = filtered.reduce((s, x) => s + x.lat, 0) / filtered.length;
    baseLng = filtered.reduce((s, x) => s + x.lng, 0) / filtered.length;
  }

  const sorted = filtered
    .map((b) => ({
      bin: b,
      distance: getDistanceMeters(baseLat, baseLng, b.lat, b.lng),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 50);

  listEl.innerHTML = "";

  if (sorted.length === 0) {
    listEl.innerHTML =
      "<li>조건에 맞는 쓰레기통을 찾지 못했어요.<br/>검색어 또는 필터를 조금 넓혀서 다시 시도해 주세요.</li>";
    return;
  }

  sorted.forEach((item, i) => {
    const b = item.bin;

    const li = document.createElement("li");
    li.classList.add("nearby-item");
    if (i === 0) li.classList.add("nearest-item");

    li.innerHTML = `
      ${i === 0 ? `<span class="badge-nearest">가장 가까움</span>` : ""}
      <strong>${b.name}</strong>
      <span>${b.addr}</span>
      <span class="info">${b.district || ""}${b.type ? " · " + b.type : ""}</span>
      <span class="distance">${formatDistance(item.distance)}</span>
      <button class="direction-btn list-direction-btn">앱에서 경로 보기</button>
    `;

    li.querySelector(".list-direction-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      openInAppRoute(b);
    });

    li.addEventListener("click", () => {
      const m = markersById[b.id];
      if (m) {
        map.setView(m.getLatLng(), 18);
        openMiniInfo(b);
        highlightMarker(m);
      }
    });

    listEl.appendChild(li);
  });
}

/* ---------------------- SEARCH AUTOCOMPLETE ---------------------- */
function updateSearchSuggest(keyword) {
  const box = document.getElementById("search-suggest");
  if (!box) return;

  const q = keyword.trim().toLowerCase();

  if (!q || q.length < 2) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }

  const matches = BINS_SEOUL.filter((b) => {
    const name = (b.name || "").toLowerCase();
    const addr = (b.addr || "").toLowerCase();
    const dist = (b.district || "").toLowerCase();
    return name.includes(q) || addr.includes(q) || dist.includes(q);
  }).slice(0, 10);

  if (matches.length === 0) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }

  box.innerHTML =
    "<ul>" +
    matches
      .map(
        (b) => `
      <li>
        <strong>${b.name || "쓰레기통"}</strong>
        <span>${b.addr || ""}</span>
      </li>`
      )
      .join("") +
    "</ul>";

  box.style.display = "block";

  const lis = box.querySelectorAll("li");
  lis.forEach((li, idx) => {
    const bin = matches[idx];

    li.addEventListener("click", () => {
      const input = document.getElementById("searchInput");
      if (input) {
        input.value = bin.addr || "";
      }

      map.setView([bin.lat, bin.lng], 17);
      openMiniInfo(bin);
      const m = markersById[bin.id];
      if (m) highlightMarker(m);

      // 🔥 자동완성에서 항목 클릭 시 → 리스트 패널 자동 열기 + 내 위치 기준 리스트 갱신
      openListPanel();
      if (userLat != null && userLng != null) {
        updateNearbyBins(userLat, userLng);
      }

      box.style.display = "none";
      box.innerHTML = "";
    });
  });
}

/* ---------------------- 내 위치 ---------------------- */
function locateMe() {
  if (!navigator.geolocation) {
    alert(
      "이 기기에서는 위치 기능을 사용할 수 없어요.\n\n" +
        "다른 브라우저나 기기에서 다시 시도해 주세요."
    );
    return;
  }

  // 이미 watch 중이면 위치로 이동만
  if (geoWatchId !== null) {
    if (userLat != null && userLng != null) {
      map.setView([userLat, userLng], 16);
    }
    return;
  }

  initCompass();
  hasInitialFix = false;
  showLoading("현재 위치를 가져오는 중이에요...");

  geoWatchId = navigator.geolocation.watchPosition(
    (p) => {
      const rawLat = p.coords.latitude;
      const rawLng = p.coords.longitude;
      const acc = p.coords.accuracy || 9999;

      if (acc > MIN_ACCURACY && userLat !== null && userLng !== null) {
        console.log("정확도 나쁨, 위치 무시:", acc, "m");
        return;
      }

      recentPositions.push({ lat: rawLat, lng: rawLng });
      if (recentPositions.length > RECENT_POS_LIMIT) {
        recentPositions.shift();
      }

      const avg = recentPositions.reduce(
        (sum, pos) => {
          sum.lat += pos.lat;
          sum.lng += pos.lng;
          return sum;
        },
        { lat: 0, lng: 0 }
      );
      userLat = avg.lat / recentPositions.length;
      userLng = avg.lng / recentPositions.length;

      const heading = p.coords.heading;
      const speed = p.coords.speed;

      if (heading !== null && !isNaN(heading) && speed !== null && speed > 0.5) {
        geoHeading = heading;
      } else {
        geoHeading = null;
      }

      if (!userMarker) {
        userMarker = L.marker([userLat, userLng], {
          icon: userArrowIcon,
          rotationAngle: lastHeading,
          rotationOrigin: "center center",
        }).addTo(map);
      } else {
        userMarker.setLatLng([userLat, userLng]);
      }

      if (!hasInitialFix) {
        map.setView([userLat, userLng], 16);
        hasInitialFix = true;
        hideLoading();
      }

      updateUserMarkerHeading();
      updateNearbyBins(userLat, userLng);
    },
    (err) => {
      console.error(err);
      hideLoading();

      if (err.code === 1) {
        alert(
          "위치 권한이 거부된 것 같아요.\n\n" +
            "• 브라우저 주소창 오른쪽의 자물쇠 아이콘을 눌러 위치 권한을 허용하거나\n" +
            "• 휴대폰 설정 > 앱 > 브라우저(또는 이 앱) > 권한에서 위치를 허용해 주세요.\n\n" +
            "위치 권한 없이도 검색 기능은 사용할 수 있습니다."
        );
      } else if (err.code === 2) {
        alert(
          "현재 위치를 정확하게 가져오지 못했어요.\n\n" +
            "실내/지하일 경우 창가나 실외에서 다시 시도해 보거나,\n네트워크 상태를 확인해 주세요."
        );
      } else {
        alert(
          "위치 정보를 가져오는 중 문제가 발생했어요.\n\n" +
            "잠시 후 다시 시도해 주세요."
        );
      }

      geoWatchId = null;
    },
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000,
    }
  );
}

/* ---------------------- sheet-open 상태 갱신 ---------------------- */
function refreshSheetOpenClass() {
  const listPanel = document.getElementById("list-panel");

  let isOpen = false;
  if (listPanel) {
    const b = parseInt(window.getComputedStyle(listPanel).bottom, 10);
    if (b >= -10) isOpen = true;
  }

  if (isOpen) {
    document.body.classList.add("sheet-open");
  } else {
    document.body.classList.remove("sheet-open");
  }
}

/* ✅ 검색/흐름용: 리스트 패널 펼치기 헬퍼 */
function openListPanel() {
  const listPanel = document.getElementById("list-panel");
  if (!listPanel) return;

  listPanel.style.bottom = "0px"; // 완전히 올린 상태
  refreshSheetOpenClass();
}

/* ---------------------- DRAG SHEET ---------------------- */
function enableDrag(panel, handle) {
  if (!panel || !handle) return;

  let startY = 0;
  let startBottom = 0;
  let dragging = false;

  const onStart = (e) => {
    dragging = true;
    startY = e.touches ? e.touches[0].clientY : e.clientY;
    startBottom = parseInt(window.getComputedStyle(panel).bottom, 10);
  };

  const onMove = (e) => {
    if (!dragging) return;
    const currentY = e.touches ? e.touches[0].clientY : e.clientY;
    const diff = startY - currentY;
    let newBottom = startBottom + diff;

    const maxUp = 0;
    const maxDown = -panel.offsetHeight;
    if (newBottom > maxUp) newBottom = maxUp;
    if (newBottom < maxDown) newBottom = maxDown;

    panel.style.bottom = `${newBottom}px`;
  };

  const onEnd = () => {
    if (!dragging) return;
    dragging = false;
    const currentBottom = parseInt(window.getComputedStyle(panel).bottom, 10);
    if (currentBottom > -panel.offsetHeight / 2) {
      panel.style.bottom = "0px";
    } else {
      panel.style.bottom = `-${panel.offsetHeight}px`;
    }
    refreshSheetOpenClass();
  };

  handle.addEventListener("mousedown", onStart);
  handle.addEventListener("touchstart", onStart);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("touchmove", onMove);
  window.addEventListener("mouseup", onEnd);
  window.addEventListener("touchend", onEnd);
}

/* ---------------------- FLOATING LOCATE BTN ---------------------- */
function createFloatingLocateButton() {
  if (document.getElementById("floating-locate")) return;

  const btn = document.createElement("button");
  btn.id = "floating-locate";
  btn.type = "button";

  btn.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" fill="#1A73E8"></circle>
      <circle cx="12" cy="12" r="7" fill="none" stroke="#1A73E8" stroke-width="2"></circle>
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3"
            stroke="#1A73E8"
            stroke-width="2"
            stroke-linecap="round"></path>
    </svg>
  `;

  btn.addEventListener("click", locateMe);
  document.body.appendChild(btn);
}

/* ---------------------- INIT ---------------------- */
window.addEventListener("DOMContentLoaded", () => {
  const listPanel = document.getElementById("list-panel");
  enableDrag(listPanel, document.getElementById("list-handle"));
  createFloatingLocateButton();

  // ✅ 문의 위치 입력칸은 항상 사용자가 직접 수정 가능하도록
  const inquiryLocationInput = document.getElementById("inquiry-location");
  if (inquiryLocationInput) {
    inquiryLocationInput.removeAttribute("readonly");
    inquiryLocationInput.removeAttribute("disabled");
  }

  /* ---------- 설정 패널 & 햄버거 버튼 ---------- */
  const settingsBtn = document.getElementById("settings-btn");
  const sidePanel = document.getElementById("side-panel");
  const sideBackdrop = document.getElementById("side-panel-backdrop");
  const sideCloseBtn = document.getElementById("side-panel-close");

  function openSidePanel() {
    if (sidePanel) sidePanel.classList.add("open");
    if (sideBackdrop) sideBackdrop.classList.add("open");
    if (settingsBtn) settingsBtn.style.display = "none";
  }

  function closeSidePanel() {
    if (sidePanel) sidePanel.classList.remove("open");
    if (sideBackdrop) sideBackdrop.classList.remove("open");
    if (settingsBtn) settingsBtn.style.display = "flex";
  }

  if (settingsBtn) {
    settingsBtn.addEventListener("click", openSidePanel);
  }
  if (sideCloseBtn) {
    sideCloseBtn.addEventListener("click", closeSidePanel);
  }
  if (sideBackdrop) {
    sideBackdrop.addEventListener("click", (e) => {
      if (e.target === sideBackdrop) {
        closeSidePanel();
      }
    });
  }

  /* ---------- 📄 앱 정보 패널 ---------- */
  const appinfoPanel = document.getElementById("appinfo-panel");
  const appinfoBackdrop = document.getElementById("appinfo-backdrop");
  const openAppinfoBtn = document.getElementById("open-appinfo-btn");
  const appinfoCloseBtn = document.getElementById("appinfo-close");

  function openAppInfo() {
    if (appinfoPanel) appinfoPanel.classList.add("open");
    if (appinfoBackdrop) appinfoBackdrop.classList.add("open");
  }

  function closeAppInfo() {
    if (appinfoPanel) appinfoPanel.classList.remove("open");
    if (appinfoBackdrop) appinfoBackdrop.classList.remove("open");
  }

  if (openAppinfoBtn) {
    openAppinfoBtn.addEventListener("click", () => {
      closeSidePanel();
      openAppInfo();
    });
  }
  if (appinfoCloseBtn) {
    appinfoCloseBtn.addEventListener("click", closeAppInfo);
  }
  if (appinfoBackdrop) {
    appinfoBackdrop.addEventListener("click", (e) => {
      if (e.target === appinfoBackdrop) {
        closeAppInfo();
      }
    });
  }

      /* ---------- 앱 공유 ---------- */
  const shareBtn = document.getElementById("share-app-btn");
  if (shareBtn) {
    shareBtn.addEventListener("click", async () => {
      // 테스트용 알림 (정상 동작 확인)
      alert("공유 버튼 눌림 ✅");

      // 설정 패널 열려 있으면 닫기 (있을 때만)
      if (typeof closeSidePanel === "function") {
        closeSidePanel();
      }

      // 지금 주소 그대로 공유
      const url = window.location.href;
      const isFile = window.location.protocol === "file:";

      // 🔹 파일로 열었을 때(file://) → 그냥 주소만 보여주기
      if (isFile) {
        window.prompt(
          "아래 주소를 복사해서 친구에게 보내 주세요.",
          url
        );
        return;
      }

      // 🔹 1) Web Share API 지원하는 환경이면 그걸 먼저 사용
      if (navigator.share) {
        try {
          await navigator.share({
            title: "내 주변 쓰레기통 찾기",
            text: "지도에서 가까운 쓰레기통을 바로 찾을 수 있어요!",
            url: url,
          });
          return;
        } catch (err) {
          console.warn("공유 취소 또는 오류:", err);
        }
      }

      // 🔹 2) 클립보드 복사 시도 (https/localhost에서만 됨)
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(url);
          alert(
            "앱 주소가 복사되었습니다!\n\n" +
              "채팅앱에 붙여넣기 해서 친구에게 보내 주세요.\n\n" +
              url
          );
          return;
        } catch (err) {
          console.warn("클립보드 복사 실패:", err);
        }
      }

      // 🔹 3) 마지막 fallback: 무조건 프롬프트
      window.prompt(
        "공유 기능을 지원하지 않는 환경이에요.\n아래 주소를 복사해 친구에게 보내 주세요.",
        url
      );
    });
  }


  /* ---------- 앱 평가하기 ---------- */
  const rateBtn = document.getElementById("rate-app-btn");
  if (rateBtn) {
    rateBtn.addEventListener("click", () => {
      // 설정 패널 닫기
      closeSidePanel();

      // 🔹 나중에 실제 스토어/배포 주소로 변경하면 됨
      const reviewUrl = "https://google.com"; // 임시

      window.open(reviewUrl, "_blank");
    });
  }

  /* ---------- 문의 팝업 ---------- */
  const inquiryBackdrop = document.getElementById("inquiry-backdrop");
  const inquiryModal = document.getElementById("inquiry-modal");
  const inquiryOpenBtn = document.getElementById("open-inquiry-btn");
  const inquiryCancelBtn = document.getElementById("inquiry-cancel-btn");
  const inquirySubmitBtn = document.getElementById("inquiry-submit-btn");
  const inquiryPickBtn = document.getElementById("inquiry-pick-btn");

  function openInquiryModal() {
    if (inquiryBackdrop) inquiryBackdrop.classList.add("open");
    if (inquiryModal) inquiryModal.classList.add("open");
    updateInquiryLocationField();
  }
  function closeInquiryModal() {
    if (inquiryBackdrop) inquiryBackdrop.classList.remove("open");
    if (inquiryModal) inquiryModal.classList.remove("open");
  }

  if (inquiryOpenBtn) {
    inquiryOpenBtn.addEventListener("click", () => {
      closeSidePanel();
      openInquiryModal();
    });
  }
  if (inquiryCancelBtn) {
    inquiryCancelBtn.addEventListener("click", closeInquiryModal);
  }
  if (inquiryBackdrop) {
    inquiryBackdrop.addEventListener("click", (e) => {
      if (e.target === inquiryBackdrop) {
        closeInquiryModal();
      }
    });
  }

  // 🔹 제목 드롭다운 + 기타 입력 처리
  const titleSelectEl = document.getElementById("inquiry-title-select");
  const titleCustomEl = document.getElementById("inquiry-title-custom");

  if (titleSelectEl && titleCustomEl) {
    titleSelectEl.addEventListener("change", () => {
      if (
        titleSelectEl.value === "기타" ||
        titleSelectEl.value.startsWith("기타")
      ) {
        titleCustomEl.style.display = "block";
      } else {
        titleCustomEl.style.display = "none";
        titleCustomEl.value = "";
      }
    });
  }

  // 🔹 "지도에서 위치 선택" 버튼 동작
  if (inquiryPickBtn) {
    inquiryPickBtn.addEventListener("click", () => {
      isPickingInquiryLocation = true;

      const locEl = document.getElementById("inquiry-location");
      if (locEl) locEl.value = "";

      // 모달 잠깐 닫고 지도에서 핀 선택 유도
      if (inquiryBackdrop) inquiryBackdrop.classList.remove("open");
      if (inquiryModal) inquiryModal.classList.remove("open");

      alert("문의에 연결할 쓰레기통 핀을 지도에서 한 번 눌러 주세요.");
    });
  }

  if (inquirySubmitBtn) {
    inquirySubmitBtn.addEventListener("click", async () => {
      const locEl = document.getElementById("inquiry-location");
      const contentEl = document.getElementById("inquiry-content");

      const loc = locEl?.value.trim() || "";
      const content = contentEl?.value.trim() || "";

      // 🔹 제목 결정 로직 (드롭다운 + 기타 입력)
      let finalTitle = "";
      const sel = document.getElementById("inquiry-title-select");
      const custom = document.getElementById("inquiry-title-custom");

      if (sel) {
        if (sel.value === "기타") {
          finalTitle = custom?.value.trim() || "";
        } else {
          finalTitle = sel.value;
        }
      }

      if (!finalTitle || !content) {
        alert("제목과 내용을 모두 입력해 주세요.");
        return;
      }

      // 🔹 lastClickedBinForInquiry에서 쓰레기통 정보 추출
      const bin = lastClickedBinForInquiry || {};

      // 🔹 Google Sheets로 보낼 파라미터 조립
      const params = new URLSearchParams({
        type: sel?.value || "",
        title: finalTitle,
        location: loc,
        content,
        bin_id: bin.id || "",
        bin_name: bin.name || "",
        bin_lat: bin.lat || "",
        bin_lng: bin.lng || "",
      });

      try {
        showLoading("문의 내용을 보내는 중이에요...");

        const resp = await fetch(`${INQUIRY_ENDPOINT}?${params.toString()}`);
        const text = await resp.text();
        console.log("문의 전송 응답:", text);

        if (text.trim() === "OK") {
          alert("문의가 정상적으로 접수되었습니다. 감사합니다!");

          // 초기화
          if (sel) sel.value = "위치 오류";
          if (custom) {
            custom.value = "";
            custom.style.display = "none";
          }
          if (locEl) locEl.value = "";
          if (contentEl) contentEl.value = "";

          closeInquiryModal();
        } else {
          alert("문의 전송에 실패했어요. 잠시 후 다시 시도해 주세요.");
        }
      } catch (err) {
        console.error(err);
        alert("문의 전송 중 오류가 발생했어요. 네트워크 상태를 확인해 주세요.");
      } finally {
        hideLoading();
      }
    });
  }

  /* ---------- 화면 모드 & 지도 스타일 ---------- */
  const themeToggle = document.getElementById("themeToggle");
  if (themeToggle) {
    const prefersDark =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;

    if (prefersDark) {
      currentTheme = "dark";
      themeToggle.checked = true;
    } else {
      currentTheme = "light";
      themeToggle.checked = false;
    }

    refreshBaseLayer();

    themeToggle.addEventListener("change", () => {
      currentTheme = themeToggle.checked ? "dark" : "light";
      refreshBaseLayer();
    });
  }

  const styleRadios = document.querySelectorAll('input[name="mapStyle"]');
  styleRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      currentStyle = radio.value;
      refreshBaseLayer();
    });
  });

  const districtSelect = document.getElementById("districtFilter");
  const viewportCheckbox = document.getElementById("viewportOnly");
  const centerCheckbox = document.getElementById("districtCenterMode");
  const searchInput = document.getElementById("searchInput");

  const typeAll = document.getElementById("typeAll");
  const typeGeneral = document.getElementById("typeGeneral");
  const typeRecycle = document.getElementById("typeRecycle");

  function applyTypeFilterFromUI() {
    if (typeGeneral) typeFilterState.general = typeGeneral.checked;
    if (typeRecycle) typeFilterState.recycle = typeRecycle.checked;

    if (typeAll) {
      typeAll.checked = typeFilterState.general && typeFilterState.recycle;
    }

    if (userLat != null && userLng != null) {
      updateNearbyBins(userLat, userLng);
    }
    applyTypeFilterToMarkers();
  }

  if (typeGeneral) {
    typeGeneral.addEventListener("change", applyTypeFilterFromUI);
  }
  if (typeRecycle) {
    typeRecycle.addEventListener("change", applyTypeFilterFromUI);
  }
  if (typeAll) {
    typeAll.addEventListener("change", () => {
      const checked = typeAll.checked;
      if (typeGeneral) typeGeneral.checked = checked;
      if (typeRecycle) typeRecycle.checked = checked;
      applyTypeFilterFromUI();
    });
  }

  if (districtSelect) {
    districtSelect.addEventListener("change", () => {
      if (userLat != null) updateNearbyBins(userLat, userLng);
    });
  }
  if (viewportCheckbox) {
    viewportCheckbox.addEventListener("change", () => {
      if (userLat != null) updateNearbyBins(userLat, userLng);
    });
  }
  if (centerCheckbox) {
    centerCheckbox.addEventListener("change", () => {
      if (userLat != null) updateNearbyBins(userLat, userLng);
    });
  }

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      const val = searchInput.value;
      updateSearchSuggest(val);
      if (userLat != null) updateNearbyBins(userLat, userLng);
    });

    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const q = searchInput.value.trim().toLowerCase();
        if (!q) return;

        const match = BINS_SEOUL.find((b) => {
          return (
            (b.name || "").toLowerCase().includes(q) ||
            (b.addr || "").toLowerCase().includes(q) ||
            (b.district || "").toLowerCase().includes(q)
          );
        });

        if (!match) {
          alert(
            "일치하는 위치를 찾지 못했어요.\n\n검색어를 조금 줄이거나 다른 키워드로 다시 시도해 주세요."
          );
          return;
        }

        map.setView([match.lat, match.lng], 17);
        openMiniInfo(match);

        const m = markersById[match.id];
        if (m) highlightMarker(m);

        // 🔥 Enter 검색 성공 시 → 리스트 패널 자동 열기 + 내 위치 기준 리스트 갱신
        openListPanel();
        if (userLat != null && userLng != null) {
          updateNearbyBins(userLat, userLng);
        }

        const box = document.getElementById("search-suggest");
        if (box) {
          box.style.display = "none";
          box.innerHTML = "";
        }
      }
    });
  }

  map.on("moveend", () => {
    if (userLat != null) updateNearbyBins(userLat, userLng);
  });

  map.on("click", () => {
    const box = document.getElementById("search-suggest");
    if (box) {
      box.style.display = "none";
      box.innerHTML = "";
    }
  });

  addBinsToMap();
  populateDistrictFilter();

  /* ---------- 온보딩 팝업 (2단계) ---------- */
  if (!locateHintShown) {
    function showLocateHintPopup() {
      if (document.getElementById("locate-hint-popup")) return;

      const wrapper = document.createElement("div");
      wrapper.id = "locate-hint-popup";

      wrapper.innerHTML = `
        <div class="popup-card">
          <div id="onboarding-step-1">
            <h2>먼저 내 위치를 불러올게요</h2>
            <p>
              이 앱은 <strong>내 위치 기준</strong>으로 주변 쓰레기통을 보여줘요.<br/><br/>
              화면 <strong>오른쪽 아래 파란 동그라미 버튼(📍)</strong>을 눌러
              현재 위치를 가져와 주세요.
            </p>
            <button id="onboarding-next-btn">다음</button>
          </div>

          <div id="onboarding-step-2" style="display:none;">
            <h2>쓰레기통 보는 방법</h2>
            <p>
              • 지도에서 <strong>핀을 누르면</strong> 아래에 상세 정보 카드가 떠요.<br/>
              • 카드에서 <strong>앱에서 경로 보기</strong>를 누르면<br/>
              간단한 경로를 지도 위에 보여줘요.<br/><br/>
              화면 아래 <strong>리스트 패널을 위로 끌어올리면</strong><br/>
              내 위치 기준으로 가까운 순으로 쓰레기통을 볼 수 있어요.
            </p>
            <button id="onboarding-done-btn">시작하기</button>
          </div>
        </div>
      `;

      document.body.appendChild(wrapper);

      const step1 = document.getElementById("onboarding-step-1");
      const step2 = document.getElementById("onboarding-step-2");
      const nextBtn = document.getElementById("onboarding-next-btn");
      const doneBtn = document.getElementById("onboarding-done-btn");

      if (nextBtn) {
        nextBtn.addEventListener("click", () => {
          if (step1) step1.style.display = "none";
          if (step2) step2.style.display = "block";
        });
      }

      if (doneBtn) {
        doneBtn.addEventListener("click", () => {
          wrapper.remove();
        });
      }

      wrapper.addEventListener("click", (e) => {
        if (e.target === wrapper) {
          wrapper.remove();
        }
      });
    }

    showLocateHintPopup();
    locateHintShown = true;
    localStorage.setItem("LOCATE_HINT_SHOWN", "Y");
  }
});

/* ---------- 📄 약관 · 개인정보 링크 연결 (HTML에 id가 있다면 동작) ---------- */
const termsLink = document.getElementById("terms-link");
const privacyLink = document.getElementById("privacy-link");

if (termsLink) {
  termsLink.addEventListener("click", (e) => {
    e.preventDefault();
    window.open("terms.html", "_blank");
  });
}

if (privacyLink) {
  privacyLink.addEventListener("click", (e) => {
    e.preventDefault();
    window.open("privacy.html", "_blank");
  });
}

/* ---------------------- Google Sheets UPDATE (GET) ---------------------- */
async function updateBinLocation(binId, newLat, newLng) {
  try {
    const url =
      `${UPDATE_ENDPOINT}?id=${encodeURIComponent(binId)}` +
      `&lat=${encodeURIComponent(newLat)}` +
      `&lng=${encodeURIComponent(newLng)}`;

    console.log("시트 업데이트 요청:", url);

    const resp = await fetch(url);
    const text = await resp.text();
    console.log("업데이트 응답:", text);
  } catch (err) {
    console.error("업데이트 실패:", err);
  }
}
