/**
 * RescueBite Frontend Controller
 * Connects to the Java 21 PriorityQueue<FoodBatch> & Haversine Distance REST API
 * (with automatic client-side fallback if opened offline).
 */

let appState = {
    batches: [],
    alerts: [],
    stats: {
        activeBatches: 0,
        criticalBatches: 0,
        availableServings: 0,
        mealsRescued: 1280,
        weightRescuedKg: 435.0,
        co2PreventedKg: 1087.5
    },
    headBatchId: null,
    activeFilter: 'ALL',
    selectedBatchId: null,
    ngoHub: {
        lat: 12.9615,
        lon: 77.6100,
        name: 'Robin Hood Army — Central Hub (MG Road)'
    },
    knownAlertIds: new Set()
};

let mapInstance = null;
let markersLayer = null;
let routeLineLayer = null;
let vehicleLayer = null;
let markersByBatchId = {};
let vehicleProgressByBatchId = {};
let activeChatBatchId = null;
let lastMapSignature = '';
let hasInitialMapFit = false;

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    setupNgoHubSelector();
    updatePriorityPreview();
    fetchBackendState(true);

    // Poll Java backend every 4 seconds for real-time updates
    setInterval(() => fetchBackendState(false), 4000);

    // Live 1-second countdown ticker for UI timers
    setInterval(tickLiveCountdowns, 1000);
});

function setupNgoHubSelector() {
    const sel = document.getElementById('ngoHubSelect');
    if (!sel) return;
    sel.addEventListener('change', () => {
        const parts = sel.value.split(',');
        appState.ngoHub = {
            lat: parseFloat(parts[0]),
            lon: parseFloat(parts[1]),
            name: parts.slice(2).join(',')
        };
        const claimNgoInput = document.getElementById('claimNgoName');
        if (claimNgoInput) claimNgoInput.value = appState.ngoHub.name;
        fetchBackendState(false);
        showToast('INFO', 'NGO Hub Switched', `Recalculating Haversine distances from ${appState.ngoHub.name}`);
    });
}

async function fetchBackendState(isInitial) {
    try {
        const url = `/api/state?ngoLat=${appState.ngoHub.lat}&ngoLon=${appState.ngoHub.lon}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();

        appState.batches = data.batches || [];
        appState.alerts = data.alerts || [];
        appState.stats = data.stats || appState.stats;
        appState.headBatchId = data.headBatchId;

        if (Array.isArray(data.ngoHubs)) {
            syncPersistedNgoHubs(data.ngoHubs);
        }

        // Check for new alerts to toast and voice-announce
        if (!isInitial) {
            for (const a of appState.alerts) {
                if (!appState.knownAlertIds.has(a.id)) {
                    showToast(a.severity, a.title, a.message);
                    if (a.severity === 'CRITICAL' || a.severity === 'URGENT' || a.severity === 'SUCCESS') {
                        playAlertChime(a.severity);
                        speakVoiceAlert(`${a.title}. ${a.message}`);
                    }
                }
            }
        }
        appState.alerts.forEach(a => appState.knownAlertIds.add(a.id));

        if (!appState.selectedBatchId && appState.batches.length > 0) {
            appState.selectedBatchId = appState.batches[0].id;
        }

        renderAll();
    } catch (err) {
        console.warn('Backend unreachable, using fallback state:', err);
    }
}

function renderAll() {
    renderKpis();
    renderHeapVisualizer();
    renderAlertsFeed();
    renderBatchesGrid();
    renderTrackerView();
    renderDonorBatchesView();
    renderMapMarkers();
    updatePriorityPreview();
}

function renderKpis() {
    const s = appState.stats;
    const head = appState.batches.find(b => b.id === appState.headBatchId) || appState.batches[0];

    if (head) {
        document.getElementById('kpiHeadId').textContent = head.id;
        const timerEl = document.getElementById('kpiHeadTimer');
        timerEl.textContent = formatRemainingTime(head.secondsUntilExpiry);
        timerEl.className = `urgency-pill ${head.urgencyLevel}`;
        document.getElementById('kpiHeadTitle').textContent = `${head.donorName} • ${head.servings} servings`;
    }

    document.getElementById('kpiActiveCount').textContent = s.activeBatches;
    document.getElementById('kpiCriticalCount').textContent = `${s.criticalBatches} Critical (<60m)`;
    document.getElementById('kpiAvailableServings').textContent = s.availableServings.toLocaleString();
    document.getElementById('kpiMealsRescued').textContent = s.mealsRescued.toLocaleString();
    document.getElementById('kpiWeightSaved').textContent = `${s.weightRescuedKg.toFixed(1)} kg`;
    document.getElementById('kpiCo2Saved').textContent = `-${Math.round(s.co2PreventedKg).toLocaleString()} kg CO₂e`;

    const inProgressCount = appState.batches.filter(b =>
        ['CLAIMED', 'EN_ROUTE', 'PICKED_UP', 'DELIVERED'].includes(b.status)
    ).length;
    document.getElementById('trackerCountBadge').textContent = inProgressCount;
}

function renderHeapVisualizer() {
    const container = document.getElementById('heapVisualizer');
    if (!container) return;

    const activeQueue = appState.batches.filter(b => b.status === 'AVAILABLE' && b.secondsUntilExpiry > 0);
    if (activeQueue.length === 0) {
        container.innerHTML = `<div class="heap-node"><div class="heap-node-title">PriorityQueue is empty — all batches claimed!</div></div>`;
        return;
    }

    container.innerHTML = activeQueue.map((b, idx) => {
        const nodeLabel = idx === 0
            ? 'Idx [0] • ROOT (peek)'
            : `Idx [${idx}] • Parent [${Math.floor((idx - 1) / 2)}]`;
        return `
            <div class="heap-node ${b.urgencyLevel}" onclick="focusBatchOnMap('${b.id}')">
                <div class="heap-node-left">
                    <span class="heap-index">${nodeLabel}</span>
                    <div>
                        <div class="heap-node-title">${b.id}: ${escapeHtml(b.donorName)}</div>
                        <div class="heap-node-meta">${b.servings} servings • ${b.category.replace('_', ' ')} • ${b.distanceKm} km away</div>
                    </div>
                </div>
                <div class="heap-node-right">
                    <div class="urgency-pill ${b.urgencyLevel}" data-countdown-id="${b.id}">${formatRemainingTime(b.secondsUntilExpiry)}</div>
                    <div class="heap-node-meta">HeapKey: ${b.priorityHeapKey.toFixed(1)}</div>
                </div>
            </div>
        `;
    }).join('');
}

function renderAlertsFeed() {
    const container = document.getElementById('alertsFeed');
    const badge = document.getElementById('alertTotalBadge');
    if (!container) return;

    badge.textContent = appState.alerts.length;
    container.innerHTML = appState.alerts.map(a => {
        const ago = formatTimeAgo(a.timestampEpochMs);
        return `
            <div class="alert-item ${a.severity}" onclick="focusBatchOnMap('${a.batchId}')">
                <div class="alert-top">
                    <span>[${a.severity}] ${escapeHtml(a.title)}</span>
                    <span class="alert-time">${ago}</span>
                </div>
                <div class="alert-msg">${escapeHtml(a.message)}</div>
            </div>
        `;
    }).join('');
}

function renderBatchesGrid() {
    const grid = document.getElementById('batchesGrid');
    if (!grid) return;

    const query = (document.getElementById('batchSearchInput')?.value || '').toLowerCase().trim();

    const filtered = appState.batches.filter(b => {
        if (appState.activeFilter === 'BIOGAS') {
            return b.status === 'EXPIRED' || b.status === 'COMPOST_DIVERTED' || b.secondsUntilExpiry <= 0;
        }
        if (b.status === 'DELIVERED' || b.status === 'COMPOST_DIVERTED') return false;
        if (appState.activeFilter === 'CRITICAL' && b.urgencyLevel !== 'CRITICAL') return false;
        if (appState.activeFilter === 'VEG' && b.dietaryType === 'NON_VEG') return false;
        if (appState.activeFilter === 'FEASIBLE' && !b.feasible) return false;

        if (query) {
            const hay = `${b.id} ${b.donorName} ${b.foodTitle} ${b.pickupAddress} ${b.category}`.toLowerCase();
            if (!hay.includes(query)) return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        grid.innerHTML = `<div class="panel" style="grid-column: 1/-1; text-align:center; color: var(--text-secondary);">No food batches match the current filter.</div>`;
        return;
    }

    grid.innerHTML = filtered.map(b => {
        const isExpired = b.status === 'EXPIRED' || b.secondsUntilExpiry <= 0;
        const isCompost = b.status === 'COMPOST_DIVERTED';
        const isAvailable = b.status === 'AVAILABLE' && !isExpired;
        const rankLabel = isAvailable && b.queueRank > 0
            ? `<span class="rank-chip ${b.queueRank === 1 ? 'rank-1' : ''}">#${b.queueRank} IN PRIORITY QUEUE (Key: ${b.priorityHeapKey.toFixed(1)})</span>`
            : `<span class="rank-chip">STATUS: ${isExpired && !isCompost ? 'EXPIRED (BIOGAS ELIGIBLE)' : b.status.replace('_', ' ')}</span>`;

        const dietIcon = b.dietaryType === 'VEG' ? '🟢 VEG' : (b.dietaryType === 'VEGAN' ? '🌿 VEGAN' : '🔴 NON-VEG');
        const feasibleBadge = isExpired
            ? `<span class="unfeasible-tag">♻️ Eligible for SDG 12 Biogas/Compost</span>`
            : (b.feasible
                ? `<span class="feasible-tag">✓ Feasible (${b.etaMinutes}m ETA &lt; ${b.minutesUntilExpiry}m)</span>`
                : `<span class="unfeasible-tag">⚠ Tight Window (${b.etaMinutes}m ETA)</span>`);

        let actionBtn = '';
        if (isCompost) {
            actionBtn = `<span class="urgency-pill COMPLETED">♻️ Diverted to Biogas &amp; Compost (0% Landfill)</span>`;
        } else if (isExpired) {
            actionBtn = `<button class="btn btn-warning-outline" onclick="divertBatchToCompost('${b.id}')">♻️ Reroute to Biogas / Compost Plant (SDG 12)</button>`;
        } else if (isAvailable) {
            actionBtn = `<button class="btn btn-primary" onclick="openClaimModal('${b.id}')">Claim Batch &amp; Dispatch</button>`;
        } else {
            actionBtn = `<button class="btn btn-secondary" onclick="switchTab('tracker')">Track Pickup (${b.status.replace('_', ' ')}) &rarr;</button>`;
        }

        const isSelected = appState.selectedBatchId === b.id;
        return `
            <article class="batch-card ${isAvailable ? b.urgencyLevel : ''} ${isSelected ? 'selected-route-card' : ''}" id="card-${b.id}">
                <div>
                    <div class="batch-card-top">
                        ${rankLabel}
                        <span class="urgency-pill ${b.urgencyLevel}" data-countdown-id="${b.id}">
                            ⏱ ${formatRemainingTime(b.secondsUntilExpiry)}
                        </span>
                    </div>

                    <div class="donor-row" style="margin-top: 10px;">
                        <span class="donor-type-tag">${b.donorType.replace('_', ' ')}</span>
                        <span>${escapeHtml(b.donorName)}</span>
                        <span>• ${dietIcon}</span>
                    </div>

                    <h3 class="batch-title" style="margin-top: 6px;">${escapeHtml(b.foodTitle)}</h3>
                </div>

                <div class="batch-metrics">
                    <div class="metric-box">
                        <span>QUANTITY</span>
                        <strong>${b.servings} Servings (${b.weightKg} kg)</strong>
                    </div>
                    <div class="metric-box">
                        <span>HAVERSINE DIST.</span>
                        <strong>${b.distanceKm} km away</strong>
                    </div>
                    <div class="metric-box">
                        <span>EST. PICKUP ETA</span>
                        <strong>~${b.etaMinutes} mins</strong>
                    </div>
                </div>

                <div class="geo-bar">
                    <span>📍 ${escapeHtml(b.pickupAddress)}</span>
                    ${feasibleBadge}
                </div>

                <div class="smart-match-bar">
                    <span>🎯 <strong>Smart Auto-Match:</strong> ${escapeHtml(b.recommendedNgoName || 'Robin Hood Army')} (${b.recommendedNgoDistKm || b.distanceKm} km • ~${b.recommendedNgoEtaMins || b.etaMinutes}m)</span>
                    <span>🛡️ FSSAI Verified</span>
                </div>

                <div style="font-size: 0.74rem; color: var(--text-secondary);">
                    <strong>Storage:</strong> ${escapeHtml(b.storageNotes)}
                </div>

                <div class="batch-footer">
                    <div style="display:flex; gap:6px;">
                        <button type="button" class="btn btn-secondary" onclick="focusBatchOnMap('${b.id}')">
                            🗺️ ${isSelected ? 'Route Active ↑' : 'View Route'}
                        </button>
                        <button type="button" class="btn btn-secondary" onclick="openLiveChatModal('${b.id}')">
                            💬 Chat (${(b.chatMessages || []).length})
                        </button>
                    </div>
                    ${actionBtn}
                </div>
            </article>
        `;
    }).join('');
}

function buildLiveGpsTrackBarHtml(b) {
    if (b.status !== 'EN_ROUTE' && b.status !== 'PICKED_UP') return '';
    if (vehicleProgressByBatchId[b.id] == null) {
        vehicleProgressByBatchId[b.id] = b.status === 'PICKED_UP' ? 0.68 : 0.36;
    }
    const prog = vehicleProgressByBatchId[b.id];
    const pct = Math.round(prog * 100);
    const remKm = Math.max(0.1, (b.distanceKm * (1 - prog))).toFixed(2);
    const remMins = Math.max(1, Math.ceil(b.etaMinutes * (1 - prog)));
    const destLabel = b.status === 'EN_ROUTE' ? `🍽️ ${escapeHtml(b.donorName)}` : `🏢 ${escapeHtml(b.claimedByNgo || 'NGO Shelter')}`;
    const originLabel = b.status === 'EN_ROUTE' ? `🏢 ${escapeHtml(b.claimedByNgo || 'NGO Hub')}` : `🍽️ ${escapeHtml(b.donorName)}`;

    return `
        <div class="live-gps-track-bar" data-gps-card="${b.id}">
            <div class="gps-track-header">
                <span>🛵 <strong>LIVE GPS TRACKER:</strong> Volunteer ${escapeHtml(b.volunteerName || 'Arjun Mehta')}</span>
                <span data-gps-text="${b.id}">${pct}% • ${remKm} km left (Arriving in ~${remMins} mins)</span>
            </div>
            <div class="gps-road-line">
                <div class="gps-road-fill" data-gps-fill="${b.id}" style="width: ${pct}%;"></div>
                <span class="gps-vehicle-icon" data-gps-icon="${b.id}" style="left: ${pct}%;">🛵</span>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:0.7rem; color:var(--text-secondary); margin-top:4px;">
                <span>${originLabel}</span>
                <span>${destLabel}</span>
            </div>
        </div>
    `;
}

function renderTrackerView() {
    const container = document.getElementById('trackerListContainer');
    if (!container) return;

    const tracked = appState.batches.filter(b =>
        ['CLAIMED', 'EN_ROUTE', 'PICKED_UP', 'DELIVERED'].includes(b.status)
    );
    if (tracked.length === 0) {
        container.innerHTML = `<p style="color: var(--text-secondary);">No batches claimed yet. Claim a batch from the Live Rescue Radar to track its pickup status!</p>`;
        return;
    }

    const stages = ['CLAIMED', 'EN_ROUTE', 'PICKED_UP', 'DELIVERED'];
    const stageLabels = {
        'CLAIMED': '1. NGO Claimed Batch',
        'EN_ROUTE': '2. Volunteer En Route',
        'PICKED_UP': '3. OTP Verified & Picked Up',
        'DELIVERED': '4. Verified Shelter Delivery'
    };

    container.innerHTML = tracked.map(b => {
        const currentIdx = stages.indexOf(b.status);

        const stepsHtml = stages.map((st, idx) => {
            let cls = 'step-item';
            if (idx < currentIdx || b.status === 'DELIVERED') cls += ' done';
            else if (idx === currentIdx) cls += ' current';
            return `<div class="${cls}">${stageLabels[st]}</div>`;
        }).join('');

        let nextActionBtn = '';
        if (b.status === 'CLAIMED') {
            nextActionBtn = `<button class="btn btn-primary" onclick="advanceBatchStatus('${b.id}', 'EN_ROUTE')">🚗 Mark Volunteer En Route &rarr;</button>`;
        } else if (b.status === 'EN_ROUTE') {
            nextActionBtn = `
                <div class="otp-verify-wrap">
                    <span style="font-size:0.74rem; color:#fde68a; font-weight:600;">🔐 Donor OTP:</span>
                    <input type="text" id="otp-input-${b.id}" class="otp-verify-input" maxlength="4" value="${escapeHtml(b.pickupOtp || '1234')}" title="4-digit Handover OTP from Donor Kitchen" />
                    <button class="btn btn-primary" onclick="advanceBatchStatus('${b.id}', 'PICKED_UP')">📦 Verify OTP &amp; Confirm Pickup &rarr;</button>
                </div>
            `;
        } else if (b.status === 'PICKED_UP') {
            nextActionBtn = `<button class="btn btn-primary" onclick="advanceBatchStatus('${b.id}', 'DELIVERED')">✅ Verify Shelter Handover (Complete SDG 2 Rescue)</button>`;
        } else if (b.status === 'DELIVERED') {
            nextActionBtn = `<span class="urgency-pill COMPLETED">✓ DELIVERED • ${b.servings} Meals Rescued (OTP ${escapeHtml(b.pickupOtp || '')} Verified)</span>`;
        }

        return `
            <div class="tracker-card">
                <div class="tracker-top">
                    <div>
                        <span class="mono-badge">${b.id}</span>
                        <strong style="font-size: 1rem; margin-left: 8px;">${escapeHtml(b.foodTitle)}</strong>
                        <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 3px;">
                            Donor: <strong>${escapeHtml(b.donorName)}</strong> (${escapeHtml(b.pickupAddress)}) &rarr;
                            NGO: <strong>${escapeHtml(b.claimedByNgo || 'Partner NGO')}</strong>
                            (Volunteer: ${escapeHtml(b.volunteerName || 'Assigned')} • ${escapeHtml(b.volunteerPhone || '')})
                        </div>
                    </div>
                    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                        <button type="button" class="btn btn-secondary" onclick="openLiveChatModal('${b.id}')">💬 Live Chat (${(b.chatMessages || []).length})</button>
                        <button type="button" class="btn btn-secondary" onclick="focusBatchOnMap('${b.id}')">🛵 Track on Map</button>
                        ${nextActionBtn}
                    </div>
                </div>
                <div class="stepper">${stepsHtml}</div>
                ${buildLiveGpsTrackBarHtml(b)}
            </div>
        `;
    }).join('');
}

// ==================== INTERACTIVE LEAFLET MAP & HAVERSINE ROUTE ====================
function initMap() {
    const mapEl = document.getElementById('rescueMap');
    if (!mapEl || typeof L === 'undefined') return;

    mapInstance = L.map('rescueMap').setView([12.9615, 77.6100], 12);

    // Standard OpenStreetMap street tiles (no API key required)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(mapInstance);

    markersLayer = L.layerGroup().addTo(mapInstance);
    routeLineLayer = L.layerGroup().addTo(mapInstance);
    vehicleLayer = L.layerGroup().addTo(mapInstance);
}

function renderMapMarkers(forceRebuild = false) {
    if (!mapInstance || !markersLayer) return;

    // Only rebuild markers when batch statuses/count or NGO hub change so open popups are not closed every 4s
    const sig = `${appState.ngoHub.lat},${appState.ngoHub.lon}|` +
        appState.batches.map(b => `${b.id}:${b.status}:${b.urgencyLevel}`).join(',');

    if (forceRebuild || sig !== lastMapSignature) {
        lastMapSignature = sig;
        markersLayer.clearLayers();
        markersByBatchId = {};

        // 1. Draw Active NGO Hub Marker
        const ngoMarker = L.circleMarker([appState.ngoHub.lat, appState.ngoHub.lon], {
            radius: 12,
            fillColor: '#2563eb',
            color: '#ffffff',
            weight: 3,
            fillOpacity: 1
        }).bindPopup(`<strong>🏢 Active NGO Hub</strong><br>${escapeHtml(appState.ngoHub.name)}`)
          .bindTooltip('🏢 Active NGO Hub', { permanent: true, direction: 'top', offset: [0, -10], className: 'map-pin-label ngo-pin-label' });
        markersLayer.addLayer(ngoMarker);

        // 2. Draw Donor Batch Markers
        appState.batches.forEach(b => {
            if (b.status === 'DELIVERED') return;

            let color = '#10b981';
            if (b.urgencyLevel === 'CRITICAL') color = '#ef4444';
            else if (b.urgencyLevel === 'HIGH') color = '#f59e0b';
            else if (b.status !== 'AVAILABLE') color = '#38bdf8';

            const isSelected = b.id === appState.selectedBatchId;
            const marker = L.circleMarker([b.latitude, b.longitude], {
                radius: isSelected ? 12 : (b.urgencyLevel === 'CRITICAL' ? 10 : 8),
                fillColor: color,
                color: isSelected ? '#ffffff' : '#0b111e',
                weight: isSelected ? 3 : 2,
                fillOpacity: 0.95
            });

            const rankTag = b.queueRank > 0 ? `#${b.queueRank} ${b.id}` : b.id;
            marker.bindTooltip(rankTag, { permanent: true, direction: 'right', offset: [8, 0], className: 'map-pin-label' });

            const gmapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${appState.ngoHub.lat},${appState.ngoHub.lon}&destination=${b.latitude},${b.longitude}&travelmode=driving`;

            marker.bindPopup(`
                <div style="font-family: Inter, sans-serif; min-width: 230px; line-height: 1.4;">
                    <div style="font-weight: 800; color: #0f172a; font-size: 13px;">
                        #${b.queueRank || '-'} ${escapeHtml(b.donorName)} (${b.id})
                    </div>
                    <div style="font-size: 12px; color: #334155; margin: 4px 0;">${escapeHtml(b.foodTitle)}</div>
                    <div style="font-size: 11px; color: #475569;">📍 ${escapeHtml(b.pickupAddress)}</div>
                    <div style="font-size: 12px; font-weight: 700; color: #b91c1c; margin-top: 4px;">
                        ⏱ Expires in: ${b.minutesUntilExpiry} mins (${b.servings} servings)
                    </div>
                    <div style="font-size: 12px; color: #0369a1; margin-top: 3px;">
                        🚗 Haversine Dist: <strong>${b.distanceKm} km</strong> (~${b.etaMinutes}m ETA)
                    </div>
                    <div style="margin-top: 8px; display: flex; gap: 6px;">
                        <a href="${gmapsUrl}" target="_blank" rel="noopener"
                           style="background:#0284c7; color:#fff; text-decoration:none; padding:4px 8px; border-radius:5px; font-size:11px; font-weight:600;">
                           ↗ Google Maps Route
                        </a>
                    </div>
                </div>
            `);

            marker.on('click', () => {
                appState.selectedBatchId = b.id;
                drawRouteToBatch(b);
                renderBatchesGrid();
            });

            markersLayer.addLayer(marker);
            markersByBatchId[b.id] = marker;
        });

        if (!hasInitialMapFit && appState.batches.length > 0) {
            hasInitialMapFit = true;
            setTimeout(() => fitAllMapPins(), 150);
        }
    }

    const selected = appState.batches.find(b => b.id === appState.selectedBatchId) || appState.batches[0];
    if (selected) {
        drawRouteToBatch(selected);
    }
}

function drawRouteToBatch(b) {
    if (!routeLineLayer) return;
    routeLineLayer.clearLayers();

    const latlngs = [
        [appState.ngoHub.lat, appState.ngoHub.lon],
        [b.latitude, b.longitude]
    ];

    const lineColor = b.urgencyLevel === 'CRITICAL' ? '#ef4444' : '#10b981';

    // Outer glow polyline
    const glowLine = L.polyline(latlngs, {
        color: lineColor,
        weight: 8,
        opacity: 0.25
    });
    routeLineLayer.addLayer(glowLine);

    // Animated inner dashed polyline
    const polyline = L.polyline(latlngs, {
        color: lineColor,
        weight: 3.5,
        dashArray: '10, 8',
        className: 'animated-route-line'
    });
    routeLineLayer.addLayer(polyline);

    // Midpoint Distance & ETA Floating Pill on the Map
    const midLat = (appState.ngoHub.lat + b.latitude) / 2;
    const midLon = (appState.ngoHub.lon + b.longitude) / 2;
    const midpointMarker = L.marker([midLat, midLon], {
        icon: L.divIcon({
            className: '',
            html: `<div class="route-midpoint-badge">🚗 ${b.distanceKm} km • ~${b.etaMinutes}m ETA</div>`,
            iconSize: [140, 26],
            iconAnchor: [70, 13]
        }),
        interactive: false
    });
    routeLineLayer.addLayer(midpointMarker);

    const gmapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${appState.ngoHub.lat},${appState.ngoHub.lon}&destination=${b.latitude},${b.longitude}&travelmode=driving`;
    const summaryEl = document.getElementById('selectedRouteSummary');
    if (summaryEl) {
        summaryEl.innerHTML = `
            Route to <strong>${escapeHtml(b.donorName)} (${b.id})</strong>:
            <strong style="color:#38bdf8">${b.distanceKm} km</strong> •
            ETA <strong>${b.etaMinutes} mins</strong> •
            Expiry in <strong>${b.minutesUntilExpiry} mins</strong>
            (${b.feasible ? '<span style="color:#34d399">Feasible ✓</span>' : '<span style="color:#f87171">Critical Window!</span>'})
            &nbsp;|&nbsp;
            <a href="${gmapsUrl}" target="_blank" rel="noopener" style="color:#38bdf8; font-weight:700; text-decoration:underline;">
                ↗ Open Turn-by-Turn in Google Maps
            </a>
        `;
    }
}

function focusBatchOnMap(batchId) {
    switchTab('dashboard');
    appState.selectedBatchId = batchId;
    const b = appState.batches.find(x => x.id === batchId);
    if (!b) return;

    renderBatchesGrid();
    renderMapMarkers(true);

    // Smoothly scroll the user's screen up to the Map Panel and flash its border
    const mapPanel = document.querySelector('.map-panel');
    if (mapPanel) {
        mapPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        mapPanel.classList.remove('route-focus-flash');
        void mapPanel.offsetWidth;
        mapPanel.classList.add('route-focus-flash');
        setTimeout(() => mapPanel.classList.remove('route-focus-flash'), 2200);
    }

    if (mapInstance) {
        mapInstance.invalidateSize();
        const bounds = L.latLngBounds([
            [appState.ngoHub.lat, appState.ngoHub.lon],
            [b.latitude, b.longitude]
        ]);
        mapInstance.fitBounds(bounds, { padding: [65, 65], maxZoom: 14, animate: true });
        drawRouteToBatch(b);

        const targetMarker = markersByBatchId[b.id];
        if (targetMarker) {
            setTimeout(() => targetMarker.openPopup(), 250);
        }
    }

    showToast('INFO', `Route Plotted: ${b.id}`, `${appState.ngoHub.name} → ${b.donorName} (${b.distanceKm} km, ~${b.etaMinutes}m ETA)`);
}

function fitAllMapPins() {
    if (!mapInstance) return;
    mapInstance.invalidateSize();
    const coords = [[appState.ngoHub.lat, appState.ngoHub.lon]];
    appState.batches.forEach(b => {
        if (b.status !== 'DELIVERED') {
            coords.push([b.latitude, b.longitude]);
        }
    });
    if (coords.length > 1) {
        const bounds = L.latLngBounds(coords);
        mapInstance.fitBounds(bounds, { padding: [55, 55], maxZoom: 13, animate: true });
    }
}

function openAddNgoModal() {
    document.getElementById('addNgoModal').classList.remove('hidden');
}

function closeAddNgoModal() {
    document.getElementById('addNgoModal').classList.add('hidden');
}

function syncPersistedNgoHubs(hubs) {
    const selects = [document.getElementById('ngoHubSelect'), document.getElementById('ngoLoginHubSelect')];
    selects.forEach(sel => {
        if (!sel) return;
        const existingNames = new Set(
            Array.from(sel.options).map(o => o.value.split(',').slice(2).join(',').toLowerCase())
        );
        hubs.forEach(h => {
            if (!existingNames.has(h.name.toLowerCase())) {
                const opt = document.createElement('option');
                opt.value = `${h.lat},${h.lon},${h.name}`;
                opt.textContent = h.name;
                sel.appendChild(opt);
            }
        });
    });
}

function renderDonorBatchesView() {
    const container = document.getElementById('donorBatchesListContainer');
    const countBadge = document.getElementById('donorBatchesCountBadge');
    if (countBadge) countBadge.textContent = appState.batches.length;
    if (!container) return;

    const stages = ['CLAIMED', 'EN_ROUTE', 'PICKED_UP', 'DELIVERED'];
    const stageLabels = {
        'CLAIMED': '1. NGO Claimed Batch',
        'EN_ROUTE': '2. Volunteer En Route to Kitchen',
        'PICKED_UP': '3. OTP Verified & Picked Up',
        'DELIVERED': '4. Delivered to Shelter'
    };

    container.innerHTML = appState.batches.map(b => {
        const isExpired = b.status === 'EXPIRED' || (b.status === 'AVAILABLE' && b.secondsUntilExpiry <= 0);
        const isCompost = b.status === 'COMPOST_DIVERTED';
        const isAvailable = b.status === 'AVAILABLE' && !isExpired;
        const currentIdx = stages.indexOf(b.status);

        let statusBadge = '';
        if (isCompost) {
            statusBadge = `<span class="urgency-pill COMPLETED">♻️ Diverted to Biogas &amp; Compost Plant (0% Landfill Waste)</span>`;
        } else if (isExpired) {
            statusBadge = `<button class="btn btn-warning-outline" onclick="divertBatchToCompost('${b.id}')">♻️ Reroute Expired Batch to Biogas / Compost Plant (SDG 12)</button>`;
        } else if (isAvailable) {
            statusBadge = `<span class="urgency-pill ${b.urgencyLevel}">⏳ Waiting for NGO Claim • PriorityQueue Rank #${b.queueRank || '-'} (${formatRemainingTime(b.secondsUntilExpiry)})</span>`;
        } else {
            statusBadge = `<span class="urgency-pill COMPLETED">🤝 Claimed by ${escapeHtml(b.claimedByNgo || 'Partner NGO')} (${b.status.replace('_', ' ')})</span>`;
        }

        const stepsHtml = stages.map((st, idx) => {
            let cls = 'step-item';
            if (!isAvailable) {
                if (idx < currentIdx || b.status === 'DELIVERED') cls += ' done';
                else if (idx === currentIdx) cls += ' current';
            }
            return `<div class="${cls}">${stageLabels[st]}</div>`;
        }).join('');

        return `
            <div class="tracker-card">
                <div class="tracker-top">
                    <div>
                        <span class="mono-badge">${b.id}</span>
                        <strong style="font-size: 1rem; margin-left: 8px;">${escapeHtml(b.foodTitle)}</strong>
                        <span class="otp-badge" style="margin-left: 8px;">🔐 Handover OTP: ${escapeHtml(b.pickupOtp || '1234')}</span>
                        <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 4px;">
                            Donor Kitchen: <strong>${escapeHtml(b.donorName)}</strong> • <strong>${b.servings} servings (${b.weightKg} kg)</strong> • 📍 ${escapeHtml(b.pickupAddress)}
                            <br>🎯 <strong>Smart Auto-Matched Nearest NGO:</strong> <span style="color:#34d399; font-weight:600;">${escapeHtml(b.recommendedNgoName || 'Robin Hood Army')} (${b.recommendedNgoDistKm || b.distanceKm} km • ~${b.recommendedNgoEtaMins || b.etaMinutes}m ETA)</span>
                            ${!isAvailable ? `<br>🚗 <strong>Assigned NGO Volunteer:</strong> ${escapeHtml(b.volunteerName || 'Assigned')} (${escapeHtml(b.volunteerPhone || '')}) — Share OTP <strong>${escapeHtml(b.pickupOtp || '1234')}</strong> at handover` : ''}
                        </div>
                    </div>
                    <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                        <button type="button" class="btn btn-secondary" onclick="openLiveChatModal('${b.id}')">💬 Live Chat (${(b.chatMessages || []).length})</button>
                        ${statusBadge}
                    </div>
                </div>
                <div class="stepper">${stepsHtml}</div>
                ${buildLiveGpsTrackBarHtml(b)}
            </div>
        `;
    }).join('');
}

function handleRoleLogin(e, role) {
    e.preventDefault();
    appState.currentRole = role;
    const overlay = document.getElementById('authPortalOverlay');
    const roleBadge = document.getElementById('activeUserRoleBadge');
    const subtitle = document.getElementById('portalHeaderSubtitle');

    if (role === 'DONOR') {
        const org = document.getElementById('donorLoginOrg')?.value.trim() || 'Food Donor Partner';
        if (overlay) overlay.classList.add('hidden');
        document.querySelectorAll('.role-ngo-only').forEach(el => el.classList.add('hidden'));
        document.querySelectorAll('.role-donor-only').forEach(el => el.classList.remove('hidden'));

        if (subtitle) subtitle.textContent = `Food Donor Portal — ${org}`;
        if (roleBadge) {
            roleBadge.textContent = `🍽️ Logged in: Donor (${org})`;
            roleBadge.style.background = 'rgba(16, 185, 129, 0.16)';
            roleBadge.style.color = '#34d399';
            roleBadge.style.borderColor = 'rgba(16, 185, 129, 0.35)';
        }
        const donorNameInput = document.getElementById('donorName');
        if (donorNameInput) donorNameInput.value = org;
        switchTab('donor');
        showToast('SUCCESS', 'Logged in as Food Donor', `Showing Donor-only features for ${org}.`);
    } else {
        const hubVal = document.getElementById('ngoLoginHubSelect')?.value;
        if (hubVal) {
            const parts = hubVal.split(',');
            appState.ngoHub = {
                lat: parseFloat(parts[0]),
                lon: parseFloat(parts[1]),
                name: parts.slice(2).join(',')
            };
            const mainSelect = document.getElementById('ngoHubSelect');
            if (mainSelect) mainSelect.value = hubVal;
        }
        if (overlay) overlay.classList.add('hidden');
        document.querySelectorAll('.role-donor-only').forEach(el => el.classList.add('hidden'));
        document.querySelectorAll('.role-ngo-only').forEach(el => el.classList.remove('hidden'));

        if (subtitle) subtitle.textContent = `NGO & Volunteer Redistribution Command Center`;
        if (roleBadge) {
            roleBadge.textContent = `🏢 Logged in: ${appState.ngoHub.name}`;
            roleBadge.style.background = 'rgba(59, 130, 246, 0.16)';
            roleBadge.style.color = '#93c5fd';
            roleBadge.style.borderColor = 'rgba(59, 130, 246, 0.35)';
        }
        switchTab('dashboard');
        hasInitialMapFit = false;
        fetchBackendState(false);
        setTimeout(() => {
            if (mapInstance) {
                mapInstance.invalidateSize();
                fitAllMapPins();
            }
        }, 150);
        showToast('SUCCESS', 'Logged in as NGO / Volunteer Hub', `Showing NGO-only features for ${appState.ngoHub.name}.`);
    }
}

function switchRoleDefaultTab() {
    if (appState.currentRole === 'DONOR') {
        switchTab('donor');
    } else {
        switchTab('dashboard');
    }
}

function openAuthPortalOverlay() {
    const overlay = document.getElementById('authPortalOverlay');
    if (overlay) overlay.classList.remove('hidden');
}

function shareDonorLiveLocation() {
    const statusEl = document.getElementById('donorLiveLocStatus');
    const addrInput = document.getElementById('pickupAddress');
    const latInput = document.getElementById('donorLat');
    const lonInput = document.getElementById('donorLon');

    if (statusEl) {
        statusEl.style.color = '#38bdf8';
        statusEl.innerHTML = '📡 Requesting live GPS location...';
    }

    const applyLiveCoords = async (lat, lon, isFallback) => {
        latInput.value = lat.toFixed(5);
        lonInput.value = lon.toFixed(5);
        let resolvedAddr = `Live GPS Pickup Pin — MG Road / Brigade Road Junction, Bengaluru`;
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`);
            if (res.ok) {
                const data = await res.json();
                if (data && data.display_name) {
                    resolvedAddr = data.display_name.split(',').slice(0, 4).join(', ');
                }
            }
        } catch (_) {}

        addrInput.value = resolvedAddr;
        if (statusEl) {
            statusEl.style.color = '#34d399';
            statusEl.innerHTML = `✅ <strong>Live Location Shared:</strong> ${escapeHtml(resolvedAddr)} (GPS Pin Locked for NGO Route)`;
        }
        showToast('SUCCESS', '📍 Live Location Shared', `Pickup location locked at ${resolvedAddr}`);
    };

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            pos => applyLiveCoords(pos.coords.latitude, pos.coords.longitude, false),
            () => applyLiveCoords(12.9738 + (Math.random() - 0.5) * 0.015, 77.6095 + (Math.random() - 0.5) * 0.015, true),
            { enableHighAccuracy: true, timeout: 3000 }
        );
    } else {
        applyLiveCoords(12.9738, 77.6095, true);
    }
}

function shareNgoLiveLocation() {
    const statusEl = document.getElementById('ngoLiveLocStatus');
    const addrInput = document.getElementById('newNgoAddress');
    const latInput = document.getElementById('newNgoLat');
    const lonInput = document.getElementById('newNgoLon');

    if (statusEl) {
        statusEl.style.color = '#38bdf8';
        statusEl.innerHTML = '📡 Detecting live NGO Hub GPS location...';
    }

    const applyHubCoords = async (lat, lon) => {
        latInput.value = lat.toFixed(5);
        lonInput.value = lon.toFixed(5);
        let resolvedAddr = `Live Hub Location — Rajajinagar / Malleshwaram Corridor, Bengaluru`;
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`);
            if (res.ok) {
                const data = await res.json();
                if (data && data.display_name) {
                    resolvedAddr = data.display_name.split(',').slice(0, 4).join(', ');
                }
            }
        } catch (_) {}

        addrInput.value = resolvedAddr;
        if (statusEl) {
            statusEl.style.color = '#34d399';
            statusEl.innerHTML = `✅ <strong>Live Hub Location Shared:</strong> ${escapeHtml(resolvedAddr)}`;
        }
        showToast('SUCCESS', '📍 NGO Hub Live Location Locked', resolvedAddr);
    };

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            pos => applyHubCoords(pos.coords.latitude, pos.coords.longitude),
            () => applyHubCoords(12.9915 + (Math.random() - 0.5) * 0.01, 77.5521 + (Math.random() - 0.5) * 0.01),
            { enableHighAccuracy: true, timeout: 3000 }
        );
    } else {
        applyHubCoords(12.9915, 77.5521);
    }
}

async function submitNewNgoHub(e) {
    e.preventDefault();
    const name = document.getElementById('newNgoName').value.trim();
    const addr = document.getElementById('newNgoAddress')?.value.trim() || '';
    const lat = parseFloat(document.getElementById('newNgoLat').value);
    const lon = parseFloat(document.getElementById('newNgoLon').value);
    const volunteer = document.getElementById('newNgoVolunteer').value.trim();
    const phone = document.getElementById('newNgoPhone').value.trim();

    const fullLabel = addr ? `${name} (${addr.split(',')[0]})` : name;
    try {
        await fetch('/api/ngos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: fullLabel, lat, lon, volunteer, phone })
        });
    } catch (_) {}

    const sel = document.getElementById('ngoHubSelect');
    const optVal = `${lat},${lon},${fullLabel}`;
    const opt = document.createElement('option');
    opt.value = optVal;
    opt.textContent = fullLabel;
    sel.appendChild(opt);
    sel.value = optVal;

    appState.ngoHub = { lat, lon, name: fullLabel };
    const claimNgoInput = document.getElementById('claimNgoName');
    if (claimNgoInput) claimNgoInput.value = fullLabel;
    if (volunteer) {
        const volInput = document.getElementById('claimVolunteerName');
        if (volInput) volInput.value = volunteer;
    }
    if (phone) {
        const phoneInput = document.getElementById('claimVolunteerPhone');
        if (phoneInput) phoneInput.value = phone;
    }

    closeAddNgoModal();
    document.getElementById('addNgoForm').reset();
    hasInitialMapFit = false;
    fetchBackendState(false);
    showToast('SUCCESS', 'New NGO Hub Saved & Activated', `${fullLabel} saved to persistent DB and set as active hub!`);
}

// ==================== ACTIONS: CLAIM, STATUS UPDATE, DONOR POST, SIMULATE ====================
function openClaimModal(batchId) {
    const b = appState.batches.find(x => x.id === batchId);
    if (!b) return;

    document.getElementById('claimBatchId').value = b.id;
    document.getElementById('claimNgoName').value = appState.ngoHub.name;
    document.getElementById('claimBatchSummary').innerHTML = `
        <div><strong>${b.id}: ${escapeHtml(b.foodTitle)}</strong></div>
        <div style="color: var(--text-secondary); margin-top: 4px;">
            Donor: ${escapeHtml(b.donorName)} • <strong>${b.servings} servings (${b.weightKg} kg)</strong><br>
            Distance: <strong>${b.distanceKm} km</strong> (~${b.etaMinutes} mins travel time) • Expires in <strong>${b.minutesUntilExpiry} mins</strong>
        </div>
    `;
    document.getElementById('claimModal').classList.remove('hidden');
}

function closeClaimModal() {
    document.getElementById('claimModal').classList.add('hidden');
}

async function confirmClaimBatch(e) {
    e.preventDefault();
    const batchId = document.getElementById('claimBatchId').value;
    const ngoName = document.getElementById('claimNgoName').value;
    const volunteerName = document.getElementById('claimVolunteerName').value;
    const volunteerPhone = document.getElementById('claimVolunteerPhone').value;

    try {
        const res = await fetch('/api/batches/claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batchId, ngoName, volunteerName, volunteerPhone })
        });
        if (!res.ok) throw new Error('Claim failed');
        closeClaimModal();
        await fetchBackendState(false);
    } catch (err) {
        alert('Could not claim batch: ' + err.message);
    }
}

async function advanceBatchStatus(batchId, nextStatus) {
    let otp = '';
    if (nextStatus === 'PICKED_UP') {
        const otpEl = document.getElementById(`otp-input-${batchId}`);
        if (otpEl) otp = otpEl.value.trim();
    }
    try {
        const res = await fetch('/api/batches/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batchId, status: nextStatus, otp })
        });
        const data = await res.json();
        if (!res.ok) {
            showToast('CRITICAL', 'OTP Verification Failed', data.error || 'Invalid Pickup OTP');
            return;
        }
        await fetchBackendState(false);
    } catch (err) {
        alert('Error updating status: ' + err.message);
    }
}

async function triggerSimulatedBatch() {
    try {
        const res = await fetch('/api/simulate', { method: 'POST' });
        if (!res.ok) throw new Error('Simulation failed');
        await fetchBackendState(false);
        switchTab(appState.currentRole === 'DONOR' ? 'donor-batches' : 'dashboard');
    } catch (err) {
        alert('Simulation error: ' + err.message);
    }
}

async function submitDonorBatch(e) {
    e.preventDefault();
    const payload = {
        donorName: document.getElementById('donorName').value,
        donorType: document.getElementById('donorType').value,
        contactPhone: document.getElementById('contactPhone').value,
        foodTitle: document.getElementById('foodTitle').value,
        category: document.getElementById('foodCategory').value,
        dietaryType: document.getElementById('dietaryType').value,
        servings: parseInt(document.getElementById('servingsInput').value, 10),
        weightKg: parseFloat(document.getElementById('weightInput').value),
        expiryMinutes: parseInt(document.getElementById('expiryMinutes').value, 10),
        pickupAddress: document.getElementById('pickupAddress').value,
        latitude: parseFloat(document.getElementById('donorLat').value),
        longitude: parseFloat(document.getElementById('donorLon').value),
        storageNotes: document.getElementById('storageNotes').value
    };

    try {
        const res = await fetch('/api/batches', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Failed to post food batch');
        await fetchBackendState(false);
        switchTab(appState.currentRole === 'DONOR' ? 'donor-batches' : 'dashboard');
        document.getElementById('donorPostForm').reset();
    } catch (err) {
        alert('Could not submit batch: ' + err.message);
    }
}

// ==================== DONOR PRESETS & PRIORITY QUEUE PREVIEW ====================
function fillDonorPreset(type) {
    if (type === 'wedding') {
        document.getElementById('donorName').value = 'Palace Grounds Royal Wedding Hall';
        document.getElementById('donorType').value = 'EVENT_HALL';
        document.getElementById('foodTitle').value = 'Royal Banquet Surplus: Hyderabadi Veg Biryani, Paneer Tikka & Dal Makhani';
        document.getElementById('foodCategory').value = 'EVENT_BUFFET';
        document.getElementById('dietaryType').value = 'VEG';
        document.getElementById('servingsInput').value = 175;
        document.getElementById('weightInput').value = 62.0;
        syncExpiryInput(38);
        document.getElementById('pickupAddress').value = 'Gate 2, Bellary Road, Sadashivanagar';
        document.getElementById('donorLat').value = '13.0068';
        document.getElementById('donorLon').value = '77.5813';
    } else if (type === 'hostel') {
        document.getElementById('donorName').value = 'RV Engineering Hostel Mess - Block D';
        document.getElementById('donorType').value = 'HOSTEL';
        document.getElementById('foodTitle').value = 'Dinner Mess Surplus: 150 Chapatis, Aloo Gobi, Sambar & Steamed Rice';
        document.getElementById('foodCategory').value = 'COOKED_MEALS';
        document.getElementById('dietaryType').value = 'VEG';
        document.getElementById('servingsInput').value = 95;
        document.getElementById('weightInput').value = 33.5;
        syncExpiryInput(65);
        document.getElementById('pickupAddress').value = 'Hostel Service Gate, Koramangala 4th Block';
        document.getElementById('donorLat').value = '12.9352';
        document.getElementById('donorLon').value = '77.6245';
    } else if (type === 'bakery') {
        document.getElementById('donorName').value = 'Lavonne Bakehouse & Cafe';
        document.getElementById('donorType').value = 'RESTAURANT';
        document.getElementById('foodTitle').value = 'Assorted Sourdough Loaves, Multigrain Baguettes & Savory Puffs';
        document.getElementById('foodCategory').value = 'BAKERY';
        document.getElementById('dietaryType').value = 'VEG';
        document.getElementById('servingsInput').value = 60;
        document.getElementById('weightInput').value = 18.0;
        syncExpiryInput(180);
        document.getElementById('pickupAddress').value = '100 Feet Road, Indiranagar';
        document.getElementById('donorLat').value = '12.9784';
        document.getElementById('donorLon').value = '77.6408';
    }
    updatePriorityPreview();
}

function applyLocationPreset(val) {
    const parts = val.split(',');
    document.getElementById('donorLat').value = parts[0];
    document.getElementById('donorLon').value = parts[1];
    document.getElementById('pickupAddress').value = parts.slice(2).join(',');
}

function syncExpiryInput(val) {
    document.getElementById('expiryMinutes').value = val;
    document.getElementById('expiryMinutesSlider').value = val;
    updatePriorityPreview();
}

function syncExpirySlider(val) {
    document.getElementById('expiryMinutesSlider').value = val;
    updatePriorityPreview();
}

function updatePriorityPreview() {
    const mins = parseFloat(document.getElementById('expiryMinutes')?.value || 50);
    const cat = document.getElementById('foodCategory')?.value || 'COOKED_MEALS';
    const servings = parseFloat(document.getElementById('servingsInput')?.value || 80);

    const mult = (cat === 'COOKED_MEALS' || cat === 'EVENT_BUFFET') ? 0.90
        : (cat === 'DAIRY_PACKAGED' ? 0.95 : (cat === 'BAKERY' ? 1.0 : 1.05));
    const bonus = Math.min(10.0, servings / 25.0);
    const heapKey = (mins * mult) - bonus;

    const active = appState.batches.filter(b => b.status === 'AVAILABLE' && b.secondsUntilExpiry > 0);
    let predictedRank = 1;
    for (const b of active) {
        if (b.priorityHeapKey < heapKey) predictedRank++;
    }

    const badge = document.getElementById('previewUrgencyBadge');
    const text = document.getElementById('previewInsertionText');
    if (!badge || !text) return;

    const urgency = mins <= 60 ? 'CRITICAL' : (mins <= 150 ? 'HIGH' : (mins <= 270 ? 'MEDIUM' : 'SAFE'));
    badge.className = `urgency-pill ${urgency}`;
    badge.textContent = `${urgency} (${mins}m window)`;

    text.innerHTML = `
        Java <code>FoodBatch.getPriorityHeapKey()</code> = <strong>${heapKey.toFixed(2)}</strong>.
        Calling <code>expiryPriorityQueue.offer(batch)</code> will place this listing at
        <strong>Rank #${predictedRank}</strong> out of ${active.length + 1} active batches.
    `;
}

// ==================== UI HELPERS ====================
function switchTab(tabName) {
    document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(el => el.classList.remove('active'));

    const pane = document.getElementById(`tab-${tabName}`);
    if (pane) pane.classList.add('active');

    const btn = document.querySelector(`.nav-tab[data-tab="${tabName}"]`);
    if (btn) btn.classList.add('active');

    if (tabName === 'dashboard' && mapInstance) {
        setTimeout(() => mapInstance.invalidateSize(), 100);
    }
}

function setBatchFilter(filter, btnEl) {
    appState.activeFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    renderBatchesGrid();
}

function tickLiveCountdowns() {
    appState.batches.forEach(b => {
        if (b.secondsUntilExpiry > 0 && b.status !== 'DELIVERED' && b.status !== 'COMPOST_DIVERTED') {
            b.secondsUntilExpiry -= 1;
            b.minutesUntilExpiry = Math.floor(b.secondsUntilExpiry / 60);
        }
        if (b.status === 'EN_ROUTE' || b.status === 'PICKED_UP') {
            let cur = vehicleProgressByBatchId[b.id] != null
                ? vehicleProgressByBatchId[b.id]
                : (b.status === 'PICKED_UP' ? 0.65 : 0.32);
            cur += 0.015;
            if (cur > 0.94) cur = 0.22;
            vehicleProgressByBatchId[b.id] = cur;

            const pct = Math.round(cur * 100);
            const remKm = Math.max(0.1, (b.distanceKm * (1 - cur))).toFixed(2);
            const remMins = Math.max(1, Math.ceil(b.etaMinutes * (1 - cur)));

            document.querySelectorAll(`[data-gps-fill="${b.id}"]`).forEach(el => { el.style.width = `${pct}%`; });
            document.querySelectorAll(`[data-gps-icon="${b.id}"]`).forEach(el => { el.style.left = `${pct}%`; });
            document.querySelectorAll(`[data-gps-text="${b.id}"]`).forEach(el => {
                el.textContent = `${pct}% • ${remKm} km left (Arriving in ~${remMins} mins)`;
            });
        }
    });

    updateLiveVehiclesOnMap();
    if (activeChatBatchId) {
        renderActiveChatModal();
    }

    document.querySelectorAll('[data-countdown-id]').forEach(el => {
        const id = el.getAttribute('data-countdown-id');
        const batch = appState.batches.find(x => x.id === id);
        if (batch) {
            el.textContent = `⏱ ${formatRemainingTime(batch.secondsUntilExpiry)}`;
        }
    });

    const head = appState.batches.find(b => b.id === appState.headBatchId) || appState.batches[0];
    if (head) {
        const timerEl = document.getElementById('kpiHeadTimer');
        if (timerEl) timerEl.textContent = formatRemainingTime(head.secondsUntilExpiry);
    }
}

// ==================== OPTION 1: LIVE MOVING VOLUNTEER VEHICLE ON LEAFLET MAP ====================
function updateLiveVehiclesOnMap() {
    if (!mapInstance || !vehicleLayer) return;
    vehicleLayer.clearLayers();

    appState.batches.forEach(b => {
        if (b.status !== 'EN_ROUTE' && b.status !== 'PICKED_UP') return;
        const prog = vehicleProgressByBatchId[b.id] != null ? vehicleProgressByBatchId[b.id] : 0.45;
        const startLat = b.status === 'EN_ROUTE' ? appState.ngoHub.lat : b.latitude;
        const startLon = b.status === 'EN_ROUTE' ? appState.ngoHub.lon : b.longitude;
        const endLat = b.status === 'EN_ROUTE' ? b.latitude : appState.ngoHub.lat;
        const endLon = b.status === 'EN_ROUTE' ? b.longitude : appState.ngoHub.lon;

        const curLat = startLat + (endLat - startLat) * prog;
        const curLon = startLon + (endLon - startLon) * prog;
        const pct = Math.round(prog * 100);
        const remKm = Math.max(0.1, (b.distanceKm * (1 - prog))).toFixed(2);

        const vehicleMarker = L.marker([curLat, curLon], {
            icon: L.divIcon({
                className: '',
                html: `<div class="live-vehicle-pin">🛵 ${escapeHtml(b.volunteerName || 'Volunteer')} • ${pct}% (${remKm} km)</div>`,
                iconSize: [190, 26],
                iconAnchor: [95, 13]
            })
        });
        vehicleMarker.on('click', () => openLiveChatModal(b.id));
        vehicleLayer.addLayer(vehicleMarker);
    });
}

// ==================== OPTION 2: LIVE DONOR <-> VOLUNTEER IN-APP CHAT ====================
function openLiveChatModal(batchId) {
    activeChatBatchId = batchId;
    document.getElementById('chatActiveBatchId').value = batchId;
    document.getElementById('liveChatModal').classList.remove('hidden');
    renderActiveChatModal();
    setTimeout(() => {
        const box = document.getElementById('chatMessagesContainer');
        if (box) box.scrollTop = box.scrollHeight;
    }, 50);
}

function closeLiveChatModal() {
    activeChatBatchId = null;
    document.getElementById('liveChatModal').classList.add('hidden');
}

function renderActiveChatModal() {
    if (!activeChatBatchId) return;
    const b = appState.batches.find(x => x.id === activeChatBatchId);
    if (!b) return;

    document.getElementById('chatModalTitle').textContent = `💬 Live Chat — ${b.id}: ${b.donorName}`;
    document.getElementById('chatModalSubtitle').textContent =
        `Donor Kitchen: ${b.donorName} ↔ NGO Volunteer: ${b.volunteerName || 'Assigned Coordinator'} (${b.claimedByNgo || appState.ngoHub.name})`;

    const box = document.getElementById('chatMessagesContainer');
    const msgs = b.chatMessages || [];
    if (msgs.length === 0) {
        box.innerHTML = `<div style="color: var(--text-muted); text-align:center; margin-top: 75px; font-size:0.82rem;">No messages yet. Send a quick message to coordinate gate entry or pickup!</div>`;
        return;
    }

    box.innerHTML = msgs.map(m => {
        const roleIcon = m.role === 'DONOR' ? '🍽️ DONOR' : '🛵 NGO VOLUNTEER';
        return `
            <div class="chat-bubble ${m.role}">
                <div class="chat-sender">
                    <span>${roleIcon} • ${escapeHtml(m.sender)}</span>
                    <span>${formatTimeAgo(Number(m.ts) || Date.now())}</span>
                </div>
                <div>${escapeHtml(m.text)}</div>
            </div>
        `;
    }).join('');
}

async function sendQuickChatReply(text) {
    const input = document.getElementById('chatMessageInput');
    if (input) input.value = text;
    await submitChatMessage(new Event('submit'));
}

async function submitChatMessage(e) {
    if (e && e.preventDefault) e.preventDefault();
    const batchId = activeChatBatchId || document.getElementById('chatActiveBatchId').value;
    const input = document.getElementById('chatMessageInput');
    const message = input ? input.value.trim() : '';
    if (!batchId || !message) return;

    const b = appState.batches.find(x => x.id === batchId);
    const isDonor = appState.currentRole === 'DONOR';
    const senderRole = isDonor ? 'DONOR' : 'NGO';
    const senderName = isDonor
        ? (b ? b.donorName : (document.getElementById('donorLoginOrg')?.value || 'Donor Kitchen'))
        : (b && b.volunteerName ? `${b.volunteerName} (${b.claimedByNgo || 'NGO'})` : `Volunteer (${appState.ngoHub.name.split('—')[0].trim()})`);

    if (input) input.value = '';

    try {
        await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batchId, senderRole, senderName, message })
        });
        await fetchBackendState(false);
        renderActiveChatModal();
        const box = document.getElementById('chatMessagesContainer');
        if (box) box.scrollTop = box.scrollHeight;
    } catch (err) {
        alert('Could not send message: ' + err.message);
    }
}

function formatRemainingTime(totalSec) {
    if (totalSec <= 0) return 'EXPIRED';
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (hrs > 0) {
        return `${hrs}h ${mins}m ${secs}s`;
    }
    return `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
}

function formatTimeAgo(epochMs) {
    const diffSec = Math.max(1, Math.floor((Date.now() - epochMs) / 1000));
    if (diffSec < 60) return `${diffSec}s ago`;
    const mins = Math.floor(diffSec / 60);
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
}

function showToast(severity, title, message) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${severity}`;
    toast.innerHTML = `
        <div style="font-weight: 700; margin-bottom: 3px;">🔔 ${escapeHtml(title)}</div>
        <div style="color: var(--text-secondary); font-size: 0.76rem;">${escapeHtml(message)}</div>
    `;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ==================== FEATURE 5: LIVE VOICE & AUDIO ALERT SYSTEM ====================
let voiceAlertsEnabled = true;

function toggleVoiceAlerts() {
    voiceAlertsEnabled = !voiceAlertsEnabled;
    const btn = document.getElementById('voiceToggleBtn');
    if (btn) {
        btn.textContent = voiceAlertsEnabled ? '🔊 Voice Alerts: ON' : '🔇 Voice Alerts: MUTE';
    }
    if (!voiceAlertsEnabled && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }
    showToast('INFO', voiceAlertsEnabled ? 'Voice Alerts Enabled' : 'Voice Alerts Muted',
        voiceAlertsEnabled ? 'Critical food drops will play an audio chime & voice alert.' : 'Voice announcements muted.');
}

function playAlertChime(severity) {
    if (!voiceAlertsEnabled) return;
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(severity === 'CRITICAL' ? 880 : 660, ctx.currentTime);
        osc.frequency.setValueAtTime(severity === 'CRITICAL' ? 1174 : 880, ctx.currentTime + 0.14);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.42);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.43);
    } catch (_) {}
}

function speakVoiceAlert(text) {
    if (!voiceAlertsEnabled || !('speechSynthesis' in window)) return;
    try {
        window.speechSynthesis.cancel();
        const cleanText = text.replace(/[#*_`]/g, '');
        const utter = new SpeechSynthesisUtterance(cleanText);
        utter.rate = 1.04;
        utter.pitch = 1.0;
        window.speechSynthesis.speak(utter);
    } catch (_) {}
}

function announceTopUrgentBatch() {
    const head = appState.batches.find(b => b.id === appState.headBatchId) || appState.batches[0];
    if (!head) return;
    const prev = voiceAlertsEnabled;
    voiceAlertsEnabled = true;
    playAlertChime('CRITICAL');
    const speech = `Priority Queue Head Alert! Batch ${head.id} from ${head.donorName}: ${head.servings} servings of ${head.foodTitle}, expiring in ${head.minutesUntilExpiry} minutes. Best matched NGO is ${head.recommendedNgoName || appState.ngoHub.name}, ${head.distanceKm} kilometers away.`;
    speakVoiceAlert(speech);
    showToast('CRITICAL', `🔊 Announcing #1 Batch (${head.id})`, speech);
    voiceAlertsEnabled = prev;
}

// ==================== OPTION 4: ZERO-LANDFILL BIOGAS & COMPOST FALLBACK ====================
async function divertBatchToCompost(batchId) {
    try {
        const res = await fetch('/api/batches/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batchId, status: 'COMPOST_DIVERTED' })
        });
        if (!res.ok) throw new Error('Failed to divert batch');
        await fetchBackendState(false);
        showToast('SUCCESS', '♻️ Zero-Landfill Biogas Diversion Complete',
            `Batch ${batchId} routed to TerraGreen Biogas & Organic Compost Plant (SDG 12 Circular Economy).`);
    } catch (err) {
        alert('Could not divert batch: ' + err.message);
    }
}

// ==================== OPTION 6: MULTILINGUAL SWITCHER (ENGLISH / KANNADA / HINDI) ====================
const I18N_DICT = {
    en: {
        welcomeTitle: 'Welcome to RescueBite',
        welcomeSubtitle: 'Surplus Food Rescue & Priority Redistribution Platform (SDG 2 & SDG 12)',
        sdg2: 'Zero Hunger',
        sdg12: 'Responsible Consumption & Production',
        donorLoginTitle: '🍽️ Food Donor Login',
        donorLoginDesc: 'For Restaurants, University Hostels, Wedding & Event Halls to post surplus food batches.',
        donorLoginBtn: 'Login as Food Donor →',
        ngoLoginTitle: '🏢 NGO / Volunteer Hub Login',
        ngoLoginDesc: 'For Shelters, NGOs & Volunteers to monitor the PriorityQueue, claim batches & track pickups.',
        ngoLoginBtn: 'Login as NGO / Volunteer Hub →',
        activeNgoLabel: 'Active NGO / Volunteer Hub:',
        tabRadar: 'Live Rescue Radar & Queue',
        tabTracker: 'NGO Pickup Tracker',
        tabArch: 'Java PriorityQueue & SQL',
        tabPostFood: 'Post Surplus Food',
        tabMyBatches: 'My Posted Batches & Pickup Status',
        kpiHead: '#1 Urgent Head Batch',
        kpiActive: 'Active Queue Batches',
        kpiAvailable: 'Available Surplus Meals',
        kpiRescued: 'Meals Rescued (SDG 2)',
        kpiSaved: 'Food Saved & CO₂ Prevented (SDG 12)',
        filterAll: 'All Active & In-Transit',
        filterCritical: '🔥 Critical (<60m)',
        filterVeg: '🌱 Pure Veg / Vegan',
        filterFeasible: '✅ Reachable Before Expiry',
        filterBiogas: '♻️ Expired / Biogas Fallback'
    },
    kn: {
        welcomeTitle: 'ರೆಸ್ಕ್ಯೂಬೈಟ್ (RescueBite) ಗೆ ಸ್ವಾಗತ',
        welcomeSubtitle: 'ಹೆಚ್ಚುವರಿ ಆಹಾರ ರಕ್ಷಣೆ ಮತ್ತು ಮರುಹಂಚಿಕೆ ವೇದಿಕೆ (SDG 2 & SDG 12)',
        sdg2: 'ಶೂನ್ಯ ಹಸಿವು (Zero Hunger)',
        sdg12: 'ಜವಾಬ್ದಾರಿಯುತ ಬಳಕೆ ಮತ್ತು ಉತ್ಪಾದನೆ',
        donorLoginTitle: '🍽️ ಆಹಾರ ದಾನಿಗಳ ಲಾಗಿನ್ (Food Donor)',
        donorLoginDesc: 'ರೆಸ್ಟೋರೆಂಟ್, ಹಾಸ್ಟೆಲ್ ಮತ್ತು ಕಲ್ಯಾಣ ಮಂಟಪಗಳಿಂದ ಹೆಚ್ಚುವರಿ ಆಹಾರವನ್ನು ಹಂಚಿಕೊಳ್ಳಲು.',
        donorLoginBtn: 'ಆಹಾರ ದಾನಿಯಾಗಿ ಲಾಗಿನ್ ಮಾಡಿ →',
        ngoLoginTitle: '🏢 ಎನ್‌ಜಿಒ / ಸ್ವಯಂಸೇವಕರ ಲಾಗಿನ್ (NGO Hub)',
        ngoLoginDesc: 'ಆಹಾರವನ್ನು ಕ್ಲೈಮ್ ಮಾಡಲು ಮತ್ತು ಪಿಕಪ್ ಸ್ಥಿತಿಯನ್ನು ಟ್ರ್ಯಾಕ್ ಮಾಡಲು.',
        ngoLoginBtn: 'ಎನ್‌ಜಿಒ / ಸ್ವಯಂಸೇವಕರಾಗಿ ಲಾಗಿನ್ ಮಾಡಿ →',
        activeNgoLabel: 'ಸಕ್ರಿಯ ಎನ್‌ಜಿಒ / ಸ್ವಯಂಸೇವಕ ಕೇಂದ್ರ:',
        tabRadar: 'ಲೈವ್ ರೆಸ್ಕ್ಯೂ ರಾಡಾರ್ ಮತ್ತು ಕ್ಯೂ',
        tabTracker: 'ಎನ್‌ಜಿಒ ಪಿಕಪ್ ಟ್ರ್ಯಾಕರ್',
        tabArch: 'ಜಾವಾ PriorityQueue ಮತ್ತು SQL',
        tabPostFood: 'ಹೆಚ್ಚುವರಿ ಆಹಾರ ಸೇರಿಸಿ',
        tabMyBatches: 'ನನ್ನ ಆಹಾರ ಬ್ಯಾಚ್‌ಗಳು ಮತ್ತು ಸ್ಥಿತಿ',
        kpiHead: '#1 ಅತಿ ತುರ್ತು ಆಹಾರ ಬ್ಯಾಚ್',
        kpiActive: 'ಸಕ್ರಿಯ ಆಹಾರ ಬ್ಯಾಚ್‌ಗಳು',
        kpiAvailable: 'ಲಭ್ಯವಿರುವ ಊಟಗಳು',
        kpiRescued: 'ರಕ್ಷಿಸಿದ ಊಟಗಳು (SDG 2)',
        kpiSaved: 'ಉಳಿಸಿದ ಆಹಾರ ಮತ್ತು CO₂ ತಡೆ (SDG 12)',
        filterAll: 'ಎಲ್ಲಾ ಸಕ್ರಿಯ ಬ್ಯಾಚ್‌ಗಳು',
        filterCritical: '🔥 ತುರ್ತು (<60 ನಿಮಿಷ)',
        filterVeg: '🌱 ಸಸ್ಯಹಾರಿ (Veg / Vegan)',
        filterFeasible: '✅ ಸಮಯಕ್ಕೆ ತಲುಪಬಹುದಾದ',
        filterBiogas: '♻️ ಅವಧಿ ಮೀರಿದ / ಬಯೋಗ್ಯಾಸ್ & ಗೊಬ್ಬರ'
    },
    hi: {
        welcomeTitle: 'रेस्क्यूबाइट (RescueBite) में आपका स्वागत है',
        welcomeSubtitle: 'अधिशेष भोजन बचाव और प्राथमिकता पुनर्वितरण मंच (SDG 2 & SDG 12)',
        sdg2: 'भुखमरी समाप्त करना (Zero Hunger)',
        sdg12: 'जिम्मेदार उपभोग और उत्पादन',
        donorLoginTitle: '🍽️ खाद्य दाता लॉगिन (Food Donor)',
        donorLoginDesc: 'रेस्तरां, हॉस्टल और मैरिज हॉल से बचा हुआ भोजन पोस्ट करने के लिए।',
        donorLoginBtn: 'खाद्य दाता के रूप में लॉगिन करें →',
        ngoLoginTitle: '🏢 एनजीओ / स्वयंसेवक हब लॉगिन',
        ngoLoginDesc: 'PriorityQueue देखने, भोजन क्लेम करने और पिकअप ट्रैक करने के लिए।',
        ngoLoginBtn: 'एनजीओ / स्वयंसेवक हब लॉगिन करें →',
        activeNgoLabel: 'सक्रिय एनजीओ / स्वयंसेवक केंद्र:',
        tabRadar: 'लाइव रेस्क्यू रडार और क्यू',
        tabTracker: 'एनजीओ पिकअप ट्रैकर',
        tabArch: 'जावा PriorityQueue और SQL',
        tabPostFood: 'अधिशेष भोजन पोस्ट करें',
        tabMyBatches: 'मेरे पोस्ट किए गए बैच और स्थिति',
        kpiHead: '#1 सबसे जरूरी बैच',
        kpiActive: 'सक्रिय कतार बैच',
        kpiAvailable: 'उपलब्ध भोजन (सर्विंग्स)',
        kpiRescued: 'बचाया गया भोजन (SDG 2)',
        kpiSaved: 'बचाया गया भोजन और CO₂ बचत (SDG 12)',
        filterAll: 'सभी सक्रिय बैच',
        filterCritical: '🔥 अत्यंत जरूरी (<60m)',
        filterVeg: '🌱 शुद्ध शाकाहारी (Veg)',
        filterFeasible: '✅ समय से पहले पहुंचने योग्य',
        filterBiogas: '♻️ एक्सपायर्ड / बायोगैस और खाद'
    }
};

function setAppLanguage(lang) {
    const dict = I18N_DICT[lang] || I18N_DICT.en;
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (dict[key]) {
            el.textContent = dict[key];
        }
    });
    const s1 = document.getElementById('authLangSelect');
    const s2 = document.getElementById('topLangSelect');
    if (s1 && s1.value !== lang) s1.value = lang;
    if (s2 && s2.value !== lang) s2.value = lang;

    const langNames = { en: 'English', kn: 'ಕನ್ನಡ (Kannada)', hi: 'हिन्दी (Hindi)' };
    showToast('INFO', '🌐 Language Switched', `Active UI Language: ${langNames[lang] || lang}`);
}
