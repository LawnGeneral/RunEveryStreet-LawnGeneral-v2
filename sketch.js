
let mapInteractive = true;  // controls whether map receives mouse events
const HEADER_H = 40; // height of your top bar/logo area
let mapInteractionMode = true; // true = MAP pan/zoom, false = EDIT (canvas clicks)
let mapPanZoomMode = true; // true = pan/zoom map, false = edit/trim on canvas
let currentroute = null;
let totalRoadsDist = 0; 
let totaledgedoublings = 0;
let navMode = false; // TRUE = Solver Active, FALSE = Prep Mode
var deletedEdgesStack = [];
var remainingedges;
var bestdistance = Infinity;
// Map Initialization
var openlayersmap = new ol.Map({
    target: 'map',
    layers: [
        new ol.layer.Tile({
            source: new ol.source.OSM(),
            opacity: 0.5
        })
    ],
    view: new ol.View({
        center: ol.proj.fromLonLat([-76.88, 40.27]), 
        zoom: 14 
    })
});

var canvas;
var mapHeight;
var windowX, windowY;
let txtoverpassQuery;
var OSMxml;
var numnodes, numways;

// Bounds & Data Arrays
var minlat = Infinity, maxlat = -Infinity, minlon = Infinity, maxlon = -Infinity;
var nodes = [], edges = []; // Combined into one declaration
var mapminlat, mapminlon, mapmaxlat, mapmaxlon;
var totaledgedistance = 0;
var closestnodetomouse = -1;
var closestedgetomouse = -1;
var startnode = null, currentnode = null;

// Operational Modes
var selectnodemode = 1,
    solveRESmode = 2,
    choosemapmode = 3,
    trimmodemode = 4,
    downloadGPXmode = 5;

var mode = choosemapmode; // START in Zoom/Pan mode
var debugsteps = 0;
var bestroute = null;
var bestarea;
var bestdoublingsup;

// Visualization Settings
var showSteps = false;
var showRoads = true;
var iterations = 0, iterationsperframe = 100;
var msgbckDiv, msgDiv, reportbckDiv, reportmsgDiv;
var margin;
var btnTLx, btnTLy, btnBRx, btnBRy;
var starttime;
var efficiencyhistory = [], distancehistory = [];
var totalefficiencygains = 0;
var isTouchScreenDevice = false;
var totaluniqueroads;

function setup() {
    // 1) Optional geolocation centering
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            function (position) {
                let userCoords = ol.proj.fromLonLat([
                    position.coords.longitude,
                    position.coords.latitude
                ]);
                openlayersmap.getView().setCenter(userCoords);
                openlayersmap.getView().setZoom(15);
            },
            function () {
                console.warn("Geolocation blocked or failed. Using default center.");
            },
            {
                enableHighAccuracy: true,
                timeout: 5000
            }
        );
    }

    // 2) Create p5 canvas to EXACTLY match map area (below header)
    // Make sure HEADER_H === header height (40 in your case)
    canvas = createCanvas(windowWidth, windowHeight - HEADER_H);
    canvas.position(0, HEADER_H);
    canvas.elt.style.pointerEvents = 'none';

    colorMode(HSB);
    noLoop();

    // 3) Initial app state
    mode = choosemapmode;
    iterationsperframe = 1;
    margin = 0.05;

    // 4) Redraw canvas whenever OpenLayers renders
    openlayersmap.on('postrender', function () {
        redraw();
    });

    // 5) HARD-FORCE map div size (fixes 400px-wide bug)
    const mapEl = document.getElementById('map');
    if (mapEl) {
        mapEl.style.width = window.innerWidth + "px";
        mapEl.style.height = (window.innerHeight - HEADER_H) + "px";
    }

    // 6) Force OpenLayers to re-measure after layout settles
    openlayersmap.updateSize();
    setTimeout(() => openlayersmap.updateSize(), 0);
    setTimeout(() => openlayersmap.updateSize(), 250);

    console.log("Setup complete: map + canvas sizes forced.");
}



function setMode(newMode) {
  mode = newMode;
  applyInputMode();
  console.log(`Mode=${mode} | Input=${mapPanZoomMode ? "PAN/ZOOM" : "EDIT/TRIM"} | canvas.pointerEvents=${canvas.elt.style.pointerEvents}`);
}

function draw() {
    if (touches.length > 0) isTouchScreenDevice = true;

    // Keep the canvas transparent over the OpenLayers map
    clear();

    // 1. RENDER MAP DATA
    if (edges.length > 0 && showRoads) {
        showEdges();
    }

    // 2. NODES / START HIGHLIGHT
    // Show nodes in BOTH selection and trimming modes.
    // Hover detection only runs when mode === selectnodemode (inside showNodes()).
    if (mode === selectnodemode || mode === trimmodemode) {
        showNodes();
    } else if (startnode) {
        drawStartNodeHighlight();
    }


    // 4. THE PATHS
    renderRouteGraphics();

    // 5. THE INTERFACE (Always draw last)
    renderUIOverlays();

    // 6. MODAL OVERLAYS
 
    if (mode === downloadGPXmode) {
        showReportOut();
    }
}



/**
 * Helper function to keep the draw() loop clean.
 * This draws the black box with real-time efficiency data.
 */
function drawSolverStats() {
    push();
    // 1. Ensure we are using RGB for this specific UI box
    colorMode(RGB); 
    resetMatrix(); 

    // 2. Background Box
    fill(0, 0, 0, 180); 
    noStroke();
    rect(15, 15, 260, 130, 12); 

    fill(255);
    textSize(15);
    textAlign(LEFT, TOP);
    textFont('monospace');

    // 3. MATH: Use totalRoadsDist (Target) / bestdistance (Actual)
    // If totalRoadsDist is 5km and you walked 10km, efficiency is 50%.
    let efficiency = (bestdistance === Infinity || bestdistance === 0) ? 0 : (totalRoadsDist / bestdistance) * 100;

    text(`ITERATIONS  : ${iterations}`, 30, 35);
    text(`TO VISIT    : ${remainingedges} roads`, 30, 55);
    
    // Convert bestdistance (meters) to KM for display
    let kmDisplay = (bestdistance === Infinity) ? "0.00" : (bestdistance / 1000).toFixed(2);
    text(`BEST ROUTE  : ${kmDisplay} km`, 30, 75);

    // 4. Color Feedback (RGB values)
    if (efficiency > 85) fill(0, 255, 120);      // Bright Green
    else if (efficiency > 70) fill(255, 230, 0); // Bright Yellow
    else fill(255, 100, 100);                    // Soft Red

    textSize(18);
    textStyle(BOLD);
    text(`EFFICIENCY  : ${efficiency.toFixed(1)}%`, 30, 105);
    
    pop();
}

/**
 * Encapsulated Solver Logic
 */

/**
 * Handles all Route-related drawing
 */
function renderRouteGraphics() {
    // 1. Draw the current path (Rainbow/Active)
    if (currentroute) {
        // currentroute.show() internally handles its own HSB colors
        currentroute.show();
    }

    // 2. Draw the best route (White Ghost Path)
    if (bestroute) {
        push();
        // FORCE RGB mode so white (255,255,255) works as expected
        colorMode(RGB); 
        
        stroke(255, 255, 255, 120); // semi-transparent white
        strokeWeight(8);            // thicker so it sits "under" the rainbow
        
        // Use the route's built-in show method
        bestroute.show();
        pop();
    }
}

/**
 * Handles Stats Boxes and Toolbars
 */
function renderUIOverlays() {
    // 1) ALWAYS DRAW THE TOOLBAR (mode toggle, undo, etc.)
    drawToolbar();

    // 2) MAP PREPARATION STATS (Selection / Trimming)
    if (mode === trimmodemode || mode === selectnodemode) {
        let liveDist = getLiveTotalDistance();
        let displayDist = liveDist > 1000
            ? (liveDist / 1000).toFixed(2) + "km"
            : liveDist.toFixed(0) + "m";

        drawStatsBox(
            "MAP PREPARATION",
            `Total Road: ${displayDist}`,
            mode === trimmodemode ? "TRIMMING ACTIVE" : "SELECT START NODE",
            ""
        );
    }

    // 3) ROUTE READY / EXPORT FLOW
    // If a route exists (bestroute built), show a "STOP SOLVER" button
    // that opens the summary/export modal. (No solver is actually running.)
    if (bestroute && bestroute.waypoints && bestroute.waypoints.length > 0) {
        drawSolverToggleButton(); // This button should open summary mode in mousePressed()
    }
    // If no route yet, but a start node is selected, still show the action button
    // so the user can build the route.
    else if (startnode) {
        drawSolverToggleButton();
    }
}


// Helper to draw the Start/Stop button at the bottom
function drawSolverToggleButton() {
    push();
    colorMode(RGB);

    let btnW = 140;
    let btnH = 40;
    let btnX = 20;
    let btnY = height - 60;

    // Render only (NO click logic here)
    fill(navMode ? color(255, 50, 50) : color(50, 200, 50));
    stroke(255);
    strokeWeight(2);
    rect(btnX, btnY, btnW, btnH, 8);

    fill(255);
    noStroke();
    textAlign(CENTER, CENTER);
    textSize(14);
    textStyle(BOLD);
    text(navMode ? "STOP SOLVER" : "START SOLVER", btnX + btnW / 2, btnY + btnH / 2);

    pop();
}

// --- UI HELPER FUNCTIONS ---

function drawStatsBox(title, line1, line2, line3) {
    push();
    // 1. Force RGB for UI elements
    colorMode(RGB); 
    
    // 2. Background Box (Black with 180 alpha)
    fill(0, 0, 0, 180); 
    noStroke();
    rect(10, 10, 210, 95, 8); // Slightly rounded corners (8) look more modern

    // 3. Text Styling
    fill(255);
    textAlign(LEFT, TOP);
    
    // Title
    textSize(14);
    textStyle(BOLD);
    text(title, 20, 20);
    
    // Stats Lines
    textStyle(NORMAL);
    textSize(13); // Slightly smaller for lines to create hierarchy
    text(line1, 20, 42);
    text(line2, 20, 58);
    text(line3, 20, 74); 
    
    pop();
}

function drawToolbar() {
  push();
  colorMode(HSB);
  textAlign(CENTER, CENTER);
  textSize(12);
  textStyle(BOLD);

  const btnW = 170;
  const btnH = 40;
  const margin = 10;
  const y = 10;

  // --- LEFT: FIT ROADS (only useful after ingest) ---
  const fitX = margin;

  const hasRoadData =
    (edges && edges.length > 0) ||
    (nodes && nodes.length > 0 && isFinite(minlat) && isFinite(minlon) && isFinite(maxlat) && isFinite(maxlon));

  // Blue-ish when available, gray when not
  fill(hasRoadData ? 200 : 0, hasRoadData ? 80 : 0, hasRoadData ? 255 : 180);
  stroke(0); strokeWeight(2);
  rect(fitX, y, btnW, btnH, 5);

  fill(0); noStroke();
  text("FIT ROADS", fitX + btnW / 2, y + btnH / 2);

  if (mouseIsPressed && mouseX > fitX && mouseX < fitX + btnW && mouseY > y && mouseY < y + btnH) {
    if (!hasRoadData) {
      showMessage("Ingest roads first, then Fit Roads.");
    } else {
      // Use parsed OSM data bounds (min/max lat/lon) to fit view
      // (These are set during getOverpassData node parsing.)
      const extent4326 = [minlon, minlat, maxlon, maxlat];
      const extent3857 = ol.proj.transformExtent(extent4326, "EPSG:4326", "EPSG:3857");

      // Fit with padding so roads aren't under the header/buttons
      openlayersmap.getView().fit(extent3857, {
        size: openlayersmap.getSize(),
        padding: [60, 30, 30, 30], // top, right, bottom, left
        duration: 250
      });

      openlayersmap.updateSize();
      openlayersmap.render();
      redraw();

      showMessage("Fit to loaded roads");
    }

    mouseIsPressed = false; // debounce
  }

  // --- RIGHT: PAN/ZOOM <-> TRIM TOGGLE ---
  const toggleX = width - (btnW + margin);

  // Green when PAN/ZOOM, Orange when TRIM/EDIT
  fill(mapPanZoomMode ? 120 : 15, 80, 255);
  stroke(0); strokeWeight(2);
  rect(toggleX, y, btnW, btnH, 5);

  fill(0); noStroke();
  text(mapPanZoomMode ? "MODE: PAN / ZOOM" : "MODE: TRIM / EDIT", toggleX + btnW / 2, y + btnH / 2);

  if (mouseIsPressed && mouseX > toggleX && mouseX < toggleX + btnW && mouseY > y && mouseY < y + btnH) {
    mapPanZoomMode = !mapPanZoomMode;
    applyInputMode();

    // If switching into edit mode but we're still in choosemapmode, go to the correct edit mode
    if (!mapPanZoomMode) {
      if (startnode && mode === choosemapmode) mode = trimmodemode;
      if (!startnode && mode === choosemapmode) mode = selectnodemode;
    }

    showMessage(mapPanZoomMode ? "Pan/Zoom enabled" : "Trim/Edit enabled");
    mouseIsPressed = false; // debounce
  }

  // --- OPTIONAL: UNDO button only while trimming ---
  if (mode === trimmodemode) {
    const undoX = width - (btnW * 2 + margin * 2);

    fill(200, 20, 255);
    stroke(0); strokeWeight(2);
    rect(undoX, y, btnW, btnH, 5);

    fill(0); noStroke();
    text("UNDO TRIM", undoX + btnW / 2, y + btnH / 2);

    if (mouseIsPressed && mouseX > undoX && mouseX < undoX + btnW && mouseY > y && mouseY < y + btnH) {
      if (typeof undoTrim === "function") undoTrim();
      mouseIsPressed = false;
    }
  }

  pop();
}




function getOverpassData() {
    showMessage("Loading map data...");

    // Keep canvas aligned with map (below header)
    canvas.position(0, HEADER_H);

    // Reset global state
    bestroute = null;
    totaledgedistance = 0;
    totalRoadsDist = 0;
    totaluniqueroads = 0;
    showRoads = true;

    nodes = [];
    edges = [];

    // 1. Get current map bounds (EPSG:4326)
    let extent = ol.proj.transformExtent(
        openlayersmap.getView().calculateExtent(openlayersmap.getSize()),
        'EPSG:3857',
        'EPSG:4326'
    );

    mapminlat = extent[1];
    mapminlon = extent[0];
    mapmaxlat = extent[3];
    mapmaxlon = extent[2];

    // Apply margin
    let latSize = mapmaxlat - mapminlat;
    let lonSize = mapmaxlon - mapminlon;

    let dataminlat = mapminlat + latSize * margin;
    let dataminlon = mapminlon + lonSize * margin;
    let datamaxlat = mapmaxlat - latSize * margin;
    let datamaxlon = mapmaxlon - lonSize * margin;

    // Safety guard against giant queries
    let area = (datamaxlat - dataminlat) * (datamaxlon - dataminlon);
    if (area > 0.02) {
        showMessage("Zoom in more before loading roads");
        setMode(choosemapmode);
        return;
    }

    // 2. Build Overpass query (POST)
    let overpassquery = `
[out:xml][timeout:180];
(
  way(${dataminlat},${dataminlon},${datamaxlat},${datamaxlon})
    ["highway"]
    ["name"]
    ["highway"!~"^(bridleway|bus_guideway|bus_stop|busway|construction|corridor|cycleway|elevator|escape|footway|motorway|motorway_junction|motorway_link|path|platform|proposed|raceway|razed|rest_area|services|steps|via_ferrata)$"]
    ["access"!~"^(no|customers|permit|private)$"]
    ["indoor"!~"^(area|column|corridor|door|level|room|wall|yes)$"]
    ["service"!~"^(drive-through|driveway|parking_aisle)$"]
    ["foot"!~"no"]
    ["area"!~"yes"]
    ["motorroad"!~"yes"]
    ["toll"!~"yes"];
);
(._;>;);
out;
`;

    // 3. Execute Overpass query via POST
    runOverpassQuery(
        overpassquery,
        function (responseText) {
            let parser = new DOMParser();
            OSMxml = parser.parseFromString(responseText, "text/xml");

            let XMLnodes = OSMxml.getElementsByTagName("node");
            let XMLways = OSMxml.getElementsByTagName("way");

            if (XMLways.length === 0) {
                showMessage("No named roads found. Zoom in!");
                setMode(choosemapmode);
                return;
            }

            numnodes = XMLnodes.length;
            numways = XMLways.length;

            minlat = Infinity; maxlat = -Infinity;
            minlon = Infinity; maxlon = -Infinity;

            // 4. Parse Nodes
            for (let i = 0; i < numnodes; i++) {
                let lat = parseFloat(XMLnodes[i].getAttribute("lat"));
                let lon = parseFloat(XMLnodes[i].getAttribute("lon"));
                let id  = XMLnodes[i].getAttribute("id");

                minlat = min(minlat, lat);
                maxlat = max(maxlat, lat);
                minlon = min(minlon, lon);
                maxlon = max(maxlon, lon);

                nodes.push(new Node(id, lat, lon));
            }

            // 5. Parse Ways → Edges
            for (let i = 0; i < numways; i++) {
                let wayid = XMLways[i].getAttribute("id");
                let nds = XMLways[i].getElementsByTagName("nd");

                for (let j = 0; j < nds.length - 1; j++) {
                    let from = getNodebyId(nds[j].getAttribute("ref"));
                    let to   = getNodebyId(nds[j + 1].getAttribute("ref"));

                    if (from && to) {
                        let edge = new Edge(from, to, wayid);
                        edges.push(edge);
                        totaledgedistance += edge.distance;
                    }
                }
            }

            totalRoadsDist = totaledgedistance;
            totaluniqueroads = edges.length;

            // 6. Wake up UI
            setMode(selectnodemode);
            showMessage("Click a red node to set Start");

            // Force immediate draw (prevents “roads appear only after zoom”)
            redraw();

            console.log(`Loaded ${edges.length} road segments`);
        },
        function (err) {
            console.error("Overpass failed:", err);
            showMessage("Overpass failed (try smaller area).");
            setMode(choosemapmode);
        }
    );
}



function showNodes() {
    if (!nodes || nodes.length === 0) return;

    // 1. RESET STATE & SETUP
    push();
    colorMode(RGB);
    closestnodetomouse = -1; 
    let closestDist = 15; // Search radius for hover
    let winner = null;
    let winnerPix = null;

    // 2. DRAW START NODE (Green)
    // We draw this independently so it is always visible once set
    if (startnode) {
        let sCoord = ol.proj.fromLonLat([startnode.lon, startnode.lat]);
        let sPix = openlayersmap.getPixelFromCoordinate(sCoord);
        if (sPix) {
            fill(0, 255, 0); 
            stroke(255);
            strokeWeight(2);
            ellipse(sPix[0], sPix[1], 15, 15);
        }
    }

    // 3. DRAW NETWORK & FIND HOVER WINNER
    // This block keeps red nodes visible during Selection AND Trimming
    if (mode === selectnodemode || mode === trimmodemode) {
        for (let i = 0; i < nodes.length; i++) {
            let n = nodes[i];
            let coord = ol.proj.fromLonLat([n.lon, n.lat]);
            let pix = openlayersmap.getPixelFromCoordinate(coord);
            
            // Skip nodes that are off-screen for performance
            if (!pix || pix[0] < 0 || pix[0] > width || pix[1] < 0 || pix[1] > height) continue;

            // Draw the intersection point (Red)
            fill(255, 0, 0, 150); 
            noStroke();
            ellipse(pix[0], pix[1], 6, 6);
            
            // HOVER SEARCH: Only look for the "winner" if we are still in selection mode
            if (mode === selectnodemode) {
                let d = dist(pix[0], pix[1], mouseX, mouseY);
                if (d < closestDist) {
                    closestDist = d;
                    winner = n;
                    winnerPix = pix;
                }
            }
        }
    }

    // 4. DRAW THE SINGLE HOVER HIGHLIGHT (Yellow)
    // This is outside the loop so only ONE node is highlighted at a time
    if (winner && winnerPix) {
        closestnodetomouse = winner; // Lock the winner for mousePressed()
        noFill();
        stroke(255, 255, 0);
        strokeWeight(3);
        ellipse(winnerPix[0], winnerPix[1], 14, 14);
    }

    pop();
}

function showEdges() {
    let closestedgetomousedist = Infinity;

    // Always draw edges
    for (let i = 0; i < edges.length; i++) {
        edges[i].show();

        // Only compute closest edge when trimming AND when canvas is interactive (EDIT mode)
        if (mode === trimmodemode && !mapPanZoomMode) {
            let d = edges[i].distanceToPoint(mouseX, mouseY);
            if (d < closestedgetomousedist) {
                closestedgetomousedist = d;
                closestedgetomouse = i;
            }
        }
    }

    // IMPORTANT: Do NOT highlight the "closest" edge.
    // Highlighting is what makes it look like a click turned the segment red.
    // If you want hover feedback later, we can add a subtle highlight only on hover,
    // but for now this makes trimming feel instant and unambiguous.
}


function resetEdges() {
    // 0) Ensure every node has a clean adjacency list
    for (let i = 0; i < nodes.length; i++) {
        nodes[i].edges = [];
    }

    // 1) Rebuild adjacency from the master edges list
    for (let i = 0; i < edges.length; i++) {
        let e = edges[i];

        // Guard: skip broken edges
        if (!e || !e.from || !e.to) continue;

        // Ensure node.edges exists
        if (!Array.isArray(e.from.edges)) e.from.edges = [];
        if (!Array.isArray(e.to.edges)) e.to.edges = [];

        e.from.edges.push(e);
        e.to.edges.push(e);

        // Reset solver counter
        e.travels = 0;
    }

    // 2) Reset remaining edge count
    remainingedges = edges.filter(e => e && e.distance > 0).length;

    // 3) Reset the current position
    currentnode = startnode;
}

function removeOrphans() { 
    // 1. SAFETY: If there's no start node, we can't define what an "orphan" is
    if (!startnode) {
        showMessage("Set a Start Node first!");
        return;
    }

    showMessage("Cleaning map...");
    resetEdges();
    
    // 2. MARK REACHABLE EDGES
    // Start at your chosen point and "walk" everything connected to it
    floodfill(startnode); 

    let newedges = [];
    let reachableNodesSet = new Set(); // Using a Set prevents duplicates automatically
    totaledgedistance = 0;

    // 3. FILTER
    for (let i = 0; i < edges.length; i++) {
        // If travels > 0, it means the floodfill reached this edge
        if (edges[i].travels > 0) {
            newedges.push(edges[i]);
            totaledgedistance += edges[i].distance;
            
            // Add nodes to the Set (much faster than .includes)
            reachableNodesSet.add(edges[i].from);
            reachableNodesSet.add(edges[i].to);
        }
    }

    // 4. APPLY CHANGES
    edges = newedges;
    nodes = Array.from(reachableNodesSet); // Convert Set back to array
    
    // 5. CLEAN UP
    totaluniqueroads = edges.length;
    totalRoadsDist = totaledgedistance; // Update your efficiency target
    resetEdges(); 
    
    showMessage("Map Cleaned: " + edges.length + " roads remaining.");
}

function floodfill(startNode) {
    // 1. Our "To-Do List" (Stack)
    let stack = [startNode];

    while (stack.length > 0) {
        // Take the last node added to the list
        let node = stack.pop();

        for (let i = 0; i < node.edges.length; i++) {
            let edge = node.edges[i];

            // 2. If we haven't "walked" this road in the floodfill yet
            if (edge.travels === 0) {
                // Mark it as reached (using 1 is enough for the logic)
                edge.travels = 1;

                // 3. Find the node on the other side
                let nextNode = edge.OtherNodeofEdge(node);
                
                // Add the next node to the list to explore its neighbors later
                stack.push(nextNode);
            }
        }
    }
}

function solveRES() {
  if (!startnode) {
    showMessage("Error: No start node selected.");
    return;
  }

  showMessage("Building route (closed Euler tour)...");

  navMode = false;
  solverRunning = false;

  // Clean graph & rebuild adjacency
  removeOrphans();
  resetEdges();

  // ---- 1) Odd nodes ----
  const oddNodes = [];
  for (let i = 0; i < nodes.length; i++) {
    const deg = nodes[i].edges ? nodes[i].edges.length : 0;
    if (deg % 2 !== 0) oddNodes.push(nodes[i]);
  }

  // ---- 2) Multiplicity counts (NOT boolean) ----
  for (let e of edges) e.extraTraversals = 0;

  // ---- 3) Build distance matrix between odd nodes ----
  const nOdd = oddNodes.length;
  const matrix = Array.from({ length: nOdd }, () => Array(nOdd).fill(0));

  const distMaps = [];
  for (let i = 0; i < nOdd; i++) {
    const res = dijkstra(oddNodes[i]);
    distMaps[i] = res && res.distances ? res.distances : new Map();
  }

  for (let i = 0; i < nOdd; i++) {
    for (let j = 0; j < nOdd; j++) {
      if (i === j) matrix[i][j] = 0;
      else {
        const d = distMaps[i].get(oddNodes[j]);
        matrix[i][j] = (d === undefined) ? 1e15 : d;
      }
    }
  }

  // ---- 4) Multi-start greedy pairing + local swap improvement (GLOBAL pool) ----
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function totalCostIdx(pairsIdx) {
    let sum = 0;
    for (let k = 0; k < pairsIdx.length; k++) {
      sum += matrix[pairsIdx[k][0]][pairsIdx[k][1]];
    }
    return sum;
  }

  function greedyPairingFromOrder(orderIdx) {
    const unmatched = new Set(orderIdx);
    const pairsIdx = [];

    while (unmatched.size > 1) {
      let i = null;
      for (const v of orderIdx) {
        if (unmatched.has(v)) { i = v; break; }
      }
      if (i === null) break;
      unmatched.delete(i);

      let bestJ = -1;
      let bestCost = Infinity;

      for (const j of unmatched) {
        const c = matrix[i][j];
        if (c < bestCost) {
          bestCost = c;
          bestJ = j;
        }
      }

      if (bestJ !== -1 && bestCost < 1e14) {
        pairsIdx.push([i, bestJ]);
        unmatched.delete(bestJ);
      } else {
        break;
      }
    }
    return pairsIdx;
  }

  function localSwapImprove(pairsIdx) {
    let improved = true;
    let passes = 0;
    const MAX_PASSES = 200;

    while (improved && passes < MAX_PASSES) {
      improved = false;
      passes++;

      for (let p = 0; p < pairsIdx.length; p++) {
        for (let q = p + 1; q < pairsIdx.length; q++) {
          const a = pairsIdx[p][0], b = pairsIdx[p][1];
          const c = pairsIdx[q][0], d = pairsIdx[q][1];

          const current = matrix[a][b] + matrix[c][d];
          const swap1 = matrix[a][c] + matrix[b][d];
          const swap2 = matrix[a][d] + matrix[b][c];

          if (swap1 + 1e-9 < current || swap2 + 1e-9 < current) {
            if (swap1 <= swap2) {
              pairsIdx[p] = [a, c];
              pairsIdx[q] = [b, d];
            } else {
              pairsIdx[p] = [a, d];
              pairsIdx[q] = [b, c];
            }
            improved = true;
          }
        }
      }
    }
    return { pairsIdx, passes };
  }

  const baseOrder = [];
  for (let i = 0; i < nOdd; i++) baseOrder.push(i);

  const TRIES = 800;
  let bestPairsIdx = [];
  let bestCost = Infinity;
  let bestPasses = 0;

  for (let t = 0; t < TRIES; t++) {
    const order = shuffle(baseOrder.slice());
    let pairsIdx = greedyPairingFromOrder(order);

    const improved = localSwapImprove(pairsIdx);
    pairsIdx = improved.pairsIdx;

    const cost = totalCostIdx(pairsIdx);
    if (cost < bestCost) {
      bestCost = cost;
      bestPairsIdx = pairsIdx.slice();
      bestPasses = improved.passes;
    }
  }

  const pairs = bestPairsIdx.map(([i, j]) => [oddNodes[i], oddNodes[j]]);
  console.log(`Pairing complete: odd=${nOdd} pairs=${pairs.length} tries=${TRIES} swapPasses=${bestPasses} pairCost=${bestCost.toFixed(2)}`);

  // ---- 5) Apply doublings via shortest paths (increment counts) ----
  // NOTE: totaledgedoublings (count) isn't the right stat for efficiency; we'll compute addedDistance below.
  for (const [a, b] of pairs) {
    const pathEdges = getPathEdges(a, b);
    for (const e of pathEdges) {
      if (!e) continue;
      e.extraTraversals = (e.extraTraversals || 0) + 1;
    }
  }

  // ---- 6) Hierholzer on multigraph ----
  const usedCount = new Map();

  function requiredTraversals(edge) {
    if (!edge || edge.distance <= 0) return 0;
    return 1 + (edge.extraTraversals || 0);
  }

  function getUnusedIncidentEdge(node) {
    if (!node || !node.edges) return null;
    for (let k = 0; k < node.edges.length; k++) {
      const e = node.edges[k];
      const req = requiredTraversals(e);
      if (req <= 0) continue;
      const used = usedCount.get(e) || 0;
      if (used < req) return e;
    }
    return null;
  }

  function safeOtherNode(edge, node) {
    if (!edge || !node) return null;
    if (edge.from === node) return edge.to;
    if (edge.to === node) return edge.from;
    return null;
  }

  resetEdges();

  const nodeStack = [startnode];
  const edgeStack = [];
  const circuitEdges = [];

  while (nodeStack.length > 0) {
    const v = nodeStack[nodeStack.length - 1];
    const e = getUnusedIncidentEdge(v);

    if (e) {
      usedCount.set(e, (usedCount.get(e) || 0) + 1);

      const w = safeOtherNode(e, v);
      if (!w) {
        console.warn("Discontinuity during Euler build: edge not incident to current node", e, v);
        break;
      }

      nodeStack.push(w);
      edgeStack.push(e);
    } else {
      nodeStack.pop();
      if (edgeStack.length > 0) {
        circuitEdges.push(edgeStack.pop());
      }
    }
  }

  circuitEdges.reverse();

  // ---- 7) Convert to Route ----
  mode = solveRESmode;

  bestdistance = Infinity;
  bestroute = null;

  currentroute = new Route(startnode, null);

  let curr = startnode;
  for (let i = 0; i < circuitEdges.length; i++) {
    const e = circuitEdges[i];

    const next = safeOtherNode(e, curr);
    if (!next) {
      console.warn("Discontinuity during route conversion: edge not incident to curr", e, curr);
      break;
    }

    currentroute.addWaypoint(next, e.distance, 0);
    curr = next;
  }

  bestdistance = currentroute.distance;
  bestroute = currentroute.copy ? currentroute.copy() : currentroute;
  remainingedges = 0;

  const endedAtStart = (curr === startnode);
  showMessage(endedAtStart ? "Closed route built. Click STOP SOLVER for summary/export." : "Route built but not closed (unexpected).");

  redraw();
  openlayersmap.render();

  // ---- 8) Correct stats: added distance (meters) and sanity check ----
  let addedDistance = 0;
  let addedTraversals = 0;
  for (const e of edges) {
    const extra = (e.extraTraversals || 0);
    if (extra > 0) {
      addedTraversals += extra;
      addedDistance += extra * e.distance;
    }
  }

  const expectedFinal = totalRoadsDist + addedDistance; // meters
  const eff = (bestdistance && bestdistance > 0) ? (totalRoadsDist / bestdistance) * 100 : 0;

  console.log(
    `Euler route built: ${(bestdistance / 1000).toFixed(2)} km | ` +
    `Efficiency: ${eff.toFixed(1)}% | ` +
    `Added distance: ${(addedDistance / 1000).toFixed(2)} km | ` +
    `Extra traversals: ${addedTraversals} | ` +
    `Expected final: ${(expectedFinal / 1000).toFixed(2)} km | ` +
    `Closed: ${endedAtStart}`
  );

  // Sanity check: bestdistance should be very close to expectedFinal (floating error aside)
  const diff = Math.abs(bestdistance - expectedFinal);
  if (diff > 5) { // >5 meters discrepancy is worth noting
    console.warn("Sanity check: bestdistance differs from expectedFinal by", diff.toFixed(2), "meters");
  }
}



function mousePressed() {
  // 0) If the Route Summary modal is up, ONLY handle its button click
  if (mode === downloadGPXmode) {
    let boxW = 400;
    let boxH = 450;
    let y = height / 2 - boxH / 2;

    let btnW = 300;
    let btnH = 50;
    let btnX = width / 2 - btnW / 2;
    let btnY = y + 350;

    if (mouseX > btnX && mouseX < btnX + btnW && mouseY > btnY && mouseY < btnY + btnH) {
      if (typeof downloadGPX === "function") {
        downloadGPX();
        showMessage("Downloading GPX...");
      } else {
        console.error("downloadGPX() not found.");
        showMessage("Download failed: missing downloadGPX()");
      }
      return;
    }
    return; // keep modal open
  }

  // 0.5) TOP TOOLBAR CLICK: UNDO TRIM (must be handled here because draw() is not looping)
  // These values MUST match drawToolbar()
  const toolBtnW = 170;
  const toolBtnH = 40;
  const toolMargin = 10;
  const toolY = 10;

  // Undo button exists only while trimming
  if (mode === trimmodemode) {
    const undoX = width - (toolBtnW * 2 + toolMargin * 2); // matches drawToolbar()
    const undoY = toolY;

    if (mouseX > undoX && mouseX < undoX + toolBtnW && mouseY > undoY && mouseY < undoY + toolBtnH) {
      if (typeof undoTrim === "function") {
        undoTrim();
        showMessage("Undo trim");
      } else {
        console.error("undoTrim() not found.");
        showMessage("Undo failed: missing undoTrim()");
      }

      // force refresh (because noLoop())
      redraw();
      openlayersmap.render();
      return;
    }
  }

  // 1) UI GUARD: Don't click through the top toolbar area
  // (We already handled undo above.)
  if (mouseY < 60) return;

  // 2) START/STOP BUTTON (Bottom Left)
  let btnW = 140;
  let btnH = 40;
  let btnX = 20;
  let btnY = height - 60;

  if (mouseX > btnX && mouseX < btnX + btnW && mouseY > btnY && mouseY < btnY + btnH) {
    if (!startnode) {
      showMessage("Click a red node to set Start first!");
      return;
    }

    const routeReady =
      (bestroute && bestroute.waypoints && bestroute.waypoints.length > 0) ||
      (bestdistance !== Infinity && bestdistance > 0);

    if (navMode === true || routeReady) {
      navMode = false;
      solverRunning = false;

      noLoop();
      mode = downloadGPXmode;
      showMessage("Route Summary (export when ready).");

      redraw();
      openlayersmap.render();
      return;
    }

    mode = solveRESmode;
    solverRunning = false;

    solveRES();

    noLoop();
    navMode = true;

    showMessage("Route built. Click STOP SOLVER for summary/export.");

    redraw();
    openlayersmap.render();
    return;
  }

  // 3) If we're in PAN/ZOOM mode, ignore canvas editing clicks
  if (mapPanZoomMode) return;

  // 4) NODE PICKING
  if (mode === selectnodemode) {
    const R = 18;
    const R2 = R * R;

    let best = null;
    let bestD2 = R2;

    for (let i = 0; i < nodes.length; i++) {
      let n = nodes[i];
      let coord = ol.proj.fromLonLat([n.lon, n.lat]);
      let pix = openlayersmap.getPixelFromCoordinate(coord);
      if (!pix) continue;

      if (pix[0] < -20 || pix[0] > width + 20 || pix[1] < -20 || pix[1] > height + 20) continue;

      let dx = pix[0] - mouseX;
      let dy = pix[1] - mouseY;
      let d2 = dx * dx + dy * dy;

      if (d2 < bestD2) {
        bestD2 = d2;
        best = n;
      }
    }

    if (best) {
      startnode = best;
      currentnode = startnode;

      if (typeof Route === "function") {
        currentroute = new Route(startnode, null);
      }

      bestroute = null;
      bestdistance = Infinity;
      navMode = false;
      solverRunning = false;

      showMessage("Start Locked! Toggle PAN/ZOOM to move, or TRIM/EDIT to trim roads.");
      mode = trimmodemode;

      redraw();
      openlayersmap.render();
    } else {
      showMessage("No node close enough—zoom in and click nearer a red dot.");
    }
    return;
  }

  // 5) TRIMMING (PIXEL-SPACE PICK)
  if (mode === trimmodemode) {
    function pointSegDist2(px, py, ax, ay, bx, by) {
      const abx = bx - ax, aby = by - ay;
      const apx = px - ax, apy = py - ay;
      const abLen2 = abx * abx + aby * aby;
      if (abLen2 === 0) {
        const dx = px - ax, dy = py - ay;
        return dx * dx + dy * dy;
      }
      let t = (apx * abx + apy * aby) / abLen2;
      t = Math.max(0, Math.min(1, t));
      const cx = ax + t * abx;
      const cy = ay + t * aby;
      const dx = px - cx, dy = py - cy;
      return dx * dx + dy * dy;
    }

    const PICK_PX = 22;
    const PICK_PX2 = PICK_PX * PICK_PX;

    let bestIdx = -1;
    let bestD2 = Infinity;

    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      if (!e || !e.from || !e.to) continue;

      const aCoord = ol.proj.fromLonLat([e.from.lon, e.from.lat]);
      const bCoord = ol.proj.fromLonLat([e.to.lon, e.to.lat]);
      const aPix = openlayersmap.getPixelFromCoordinate(aCoord);
      const bPix = openlayersmap.getPixelFromCoordinate(bCoord);
      if (!aPix || !bPix) continue;

      const pad = 30;
      const minX = Math.min(aPix[0], bPix[0]) - pad;
      const maxX = Math.max(aPix[0], bPix[0]) + pad;
      const minY = Math.min(aPix[1], bPix[1]) - pad;
      const maxY = Math.max(aPix[1], bPix[1]) + pad;
      if (mouseX < minX || mouseX > maxX || mouseY < minY || mouseY > maxY) continue;

      const d2 = pointSegDist2(mouseX, mouseY, aPix[0], aPix[1], bPix[0], bPix[1]);
      if (d2 < bestD2) {
        bestD2 = d2;
        bestIdx = i;
      }
    }

    if (bestIdx !== -1 && bestD2 <= PICK_PX2) {
      closestedgetomouse = bestIdx;
      handleTrimming();
    } else {
      showMessage("Click closer to the road line (or zoom in a bit).");
    }

    return;
  }
}










/**
 * Helper to check if mouse is over the start/solve button
 * Adjust coordinates based on your specific UI placement
 */
function isOverStartButton(mx, my) {
    // These must match the values in drawSolverToggleButton()
    let btnW = 140;
    let btnH = 40;
    let btnX = 20; // Bottom-left position
    let btnY = height - 60;

    // 1. Check if mouse is inside the rectangle
    let inside = (mx > btnX && mx < btnX + btnW && my > btnY && my < btnY + btnH);
    
    // 2. The button only "exists" logically if we have a start node
    return inside && startnode != null;
}

/** * HELPER FUNCTIONS FOR CLEANER CODE
 */

// Centralized check for button clicks
function isInside(mx, my, x1, y1, x2, y2) {
  return mx > x1 && mx < x2 && my > y1 && my < y2;
}

// Logic for handling Pan/Zoom toggle
function toggleNav() {
  navMode = !navMode;
  canvas.elt.style.pointerEvents = navMode ? 'none' : 'auto';
}

// Logic to stop solver and calculate final stats
function finalizeSession() {
  mode = downloadGPXmode;
  hideMessage();
  
  // Look at the successful BEST ROUTE to count roads
  if (bestroute && bestroute.waypoints) {
      // We calculate how many UNIQUE edges were part of this path
      let uniqueEdges = new Set();
      
      // If your waypoints store the edge they came from, use that.
      // Otherwise, we can count the edges that were marked as 'travels > 0'
      for (let i = 0; i < edges.length; i++) {
          if (edges[i].travels > 0) {
              uniqueEdges.add(edges[i].wayid);
          }
      }
      totaluniqueroads = uniqueEdges.size;
  } else {
      totaluniqueroads = 0;
  }

  downloadGPX(); 
}

// Reset the "glass wall" when mouse is released so the map stays zoomable in choosemapmode
function mouseReleased() {
    if (mode == choosemapmode) {
        canvas.elt.style.pointerEvents = 'none';
    }
}

// Ensure pointerEvents reset when moving mouse so zoom works
function mouseReleased() {
    // If we are just in "browsing" mode, let clicks pass back to the map
    if (mode == choosemapmode) {
        canvas.elt.style.pointerEvents = 'none';
    }
}

function positionMap(minlon_, minlat_, maxlon_, maxlat_) {
	extent = [minlon_, minlat_, maxlon_, maxlat_];
	//try to fit the map to these coordinates
	openlayersmap.getView().fit(ol.proj.transformExtent(extent, 'EPSG:4326', 'EPSG:3857'), openlayersmap.getSize());
	//capture the exact coverage of the map after fitting
	var extent = ol.proj.transformExtent(openlayersmap.getView().calculateExtent(openlayersmap.getSize()), 'EPSG:3857', 'EPSG:4326');
	mapminlat = extent[1];
	mapminlon = extent[0];
	mapmaxlat = extent[3];
	mapmaxlon = extent[2];
}

function calcdistance(lat1, long1, lat2, long2) {
	lat1 = radians(lat1);
	long1 = radians(long1);
	lat2 = radians(lat2);
	long2 = radians(long2);
	return 2 * asin(sqrt(pow(sin((lat2 - lat1) / 2), 2) + cos(lat1) * cos(lat2) * pow(sin((long2 - long1) / 2), 2))) * 6371.0;
}

function getNodebyId(id) {
	for (let i = 0; i < nodes.length; i++) {
		if (nodes[i].nodeId == id) {
			return nodes[i];
		}
	}
	return null;
}

function showMessage(msg) {
	if (msgDiv) {
		hideMessage();
	}
	let ypos = 20;
	let btnwidth = 320;
	msgbckDiv = createDiv('');
	msgbckDiv.style('position', 'fixed');
	msgbckDiv.style('width', btnwidth + 'px');
	msgbckDiv.style('top', ypos + 45 + 'px');
	msgbckDiv.style('left', '50%');
	msgbckDiv.style('background', 'black');
	msgbckDiv.style('opacity', '0.3');
	msgbckDiv.style('-webkit-transform', 'translate(-50%, -50%)');
	msgbckDiv.style('transform', 'translate(-50%, -50%)');
	msgbckDiv.style('height', '30px');
	msgbckDiv.style('border-radius', '7px');
	msgDiv = createDiv('');
	msgDiv.style('position', 'fixed');
	msgDiv.style('width', btnwidth + 'px');
	msgDiv.style('top', ypos + 57 + 'px');
	msgDiv.style('left', '50%');
	msgDiv.style('color', 'white');
	msgDiv.style('background', 'none');
	msgDiv.style('opacity', '1');
	msgDiv.style('-webkit-transform', 'translate(-50%, -50%)');
	msgDiv.style('transform', 'translate(-50%, -50%)');
	msgDiv.style('font-family', '"Lucida Sans Unicode", "Lucida Grande", sans-serif');
	msgDiv.style('font-size', '16px');
	msgDiv.style('text-align', 'center');
	msgDiv.style('vertical-align', 'middle');
	msgDiv.style('height', '50px');
	msgDiv.html(msg);
	btnTLx = windowWidth / 2 - 200; // area that is touch/click sensitive
	btnTLy = ypos - 4;
	btnBRx = btnTLx + 400;
	btnBRy = btnTLy + 32;
}

function hideMessage() {
	msgbckDiv.remove();
	msgDiv.remove();
}

function drawMask() {
	noFill();
	stroke(0, 000, 255, 0.4);
	strokeWeight(0.5);
	rect(windowWidth * margin, windowHeight * margin, windowWidth * (1 - 2 * margin), windowHeight * (1 - 2 * margin));
}

function trimSelectedEdge() {
    // Prevent trimming if we are currently in Nav Mode
    if (navMode) return;

    if (closestedgetomouse >= 0) {
        let edgetodelete = edges[closestedgetomouse];

        // --- NEW LINE: Save the edge to our history stack before deleting ---
        deletedEdgesStack.push(edgetodelete);

        edges.splice(edges.findIndex((element) => element == edgetodelete), 1);
        
        for (let i = 0; i < nodes.length; i++) { 
            if (nodes[i].edges.includes(edgetodelete)) {
                nodes[i].edges.splice(nodes[i].edges.findIndex((element) => element == edgetodelete), 1);
            }
        }
        
        removeOrphans(); 
        closestedgetomouse = -1;
    }
}

function drawProgressGraph() {
	if (efficiencyhistory.length > 0) {
		noStroke();
		fill(0, 0, 0, 0.3);
		let graphHeight = 100;
		rect(0, height - graphHeight, windowWidth, graphHeight);
		fill(0, 5, 225, 255);
		textAlign(LEFT);
		textSize(12);
		text("Routes tried: " + (iterations.toLocaleString()) + ", Length of all roads: " + nf(totaledgedistance, 0, 1) + "km, Best route: " + nf(bestroute.distance, 0, 1) + "km (" + round(efficiencyhistory[efficiencyhistory.length - 1] * 100) + "%)", 15, height - graphHeight + 18);
		textAlign(CENTER);
		textSize(12);
		for (let i = 0; i < efficiencyhistory.length; i++) {
			fill(i * 128 / efficiencyhistory.length, 255, 205, 1);
			let startx = map(i, 0, efficiencyhistory.length, 0, windowWidth);
			let starty = height - graphHeight * efficiencyhistory[i];
			rect(startx, starty, windowWidth / efficiencyhistory.length, graphHeight * efficiencyhistory[i]);
			fill(0, 5, 0);
			text(round(distancehistory[i]) + "km", startx + windowWidth / efficiencyhistory.length / 2, height - 5);
		}
	}
}

function showReportOut() {
    push();
    resetMatrix(); // Keep the UI fixed on screen while the map is behind it

    // 1. DIM THE BACKGROUND
    fill(0, 0, 0, 150);
    rect(0, 0, width, height);

    // 2. DRAW THE DIALOG BOX
    let boxW = 400;
    let boxH = 450;
    let x = width / 2 - boxW / 2;
    let y = height / 2 - boxH / 2;

    fill(45, 40, 35); // Dark chocolate brown to match your theme
    stroke(255, 50);
    strokeWeight(2);
    rect(x, y, boxW, boxH, 15);

    // 3. TITLE
    fill(255);
    noStroke();
    textAlign(CENTER, TOP);
    textSize(28);
    textStyle(BOLD);
    text("Route Summary", width / 2, y + 30);

    // Decorative underline
    stroke(255, 100);
    line(width / 2 - 50, y + 70, width / 2 + 50, y + 70);
    noStroke();

    // 4. STATS (Converting meters to km)
    textSize(16);
    fill(200);
    
    // Total Unique Roads
    text("Total unique distance", width / 2, y + 100);
    fill(255);
    textSize(24);
    let totalDistKm = (totalRoadsDist / 1000).toFixed(1);
    text(`${totalDistKm} km`, width / 2, y + 130);

    // Final Route Length
    fill(200);
    textSize(16);
    text("Length of final route", width / 2, y + 180);
    fill(255);
    textSize(24);
    let finalRouteKm = (bestdistance / 1000).toFixed(1);
    text(`${finalRouteKm} km`, width / 2, y + 210);

    // Efficiency
    fill(200);
    textSize(16);
    text("Efficiency", width / 2, y + 260);
    fill(0, 255, 120); // Bright green
    textSize(32);
    let efficiency = (bestdistance === 0) ? 0 : (totalRoadsDist / bestdistance * 100).toFixed(0);
    text(`${efficiency}%`, width / 2, y + 300);

    // 5. THE BUTTON
    // We draw the button here, but mouse click logic goes in mousePressed()
    let btnW = 300;
    let btnH = 50;
    let btnX = width / 2 - btnW / 2;
    let btnY = y + 350;

    // Hover effect
    if (mouseX > btnX && mouseX < btnX + btnW && mouseY > btnY && mouseY < btnY + btnH) {
        fill(60, 55, 50); 
        cursor(HAND);
    } else {
        fill(20, 15, 10);
        cursor(ARROW);
    }

    stroke(255);
    rect(btnX, btnY, btnW, btnH, 8);
    
    fill(255);
    noStroke();
    textSize(18);
    text("Download GPX Route", width / 2, btnY + 32);

    pop();
}
function showStatus() {
	if (startnode != null) {
		let textx = 2;
		let texty = mapHeight - 400;
		fill(0, 5, 225);
		noStroke();
		textSize(12);
		textAlign(LEFT);
		text("Total number nodes: " + nodes.length, textx, texty);
		text("Total number road sections: " + edges.length, textx, texty + 20);
		text("Length of roads: " + nf(totaledgedistance, 0, 3) + "km", textx, texty + 40);
		if (bestroute != null) {
			if (bestroute.waypoints.length > 0) {
				text("Best route: " + nf(bestroute.distance, 0, 3) + "km, " + nf(100 * totaledgedistance / bestroute.distance, 0, 2) + "%", textx, texty + 60);
			}
			text("Routes tried: " + iterations, textx, texty + 80);
			text("Frame rate: " + frameRate(), textx, texty + 100);
			text("Solutions per frame: " + iterationsperframe, textx, texty + 120);
			text("Iterations/second: " + iterations / (millis() - starttime) * 1000, textx, texty + 140);
			text("best routes: " + efficiencyhistory.length, textx, texty + 160);
			text("efficiency gains: " + nf(100 * totalefficiencygains, 0, 2) + "% and " + nf(100 * totalefficiencygains / (millis() - starttime) * 1000, 0, 2) + "% gains/sec:", textx, texty + 180); //
			text("isTouchScreenDevice: " + isTouchScreenDevice, textx, texty + 200);
		}
	}
}
function windowResized() {
    // Resize p5 canvas
    resizeCanvas(windowWidth, windowHeight - HEADER_H);
    canvas.position(0, HEADER_H);

    // Force map div size again
    const mapEl = document.getElementById('map');
    if (mapEl) {
        mapEl.style.width = window.innerWidth + "px";
        mapEl.style.height = (window.innerHeight - HEADER_H) + "px";
    }

    // Tell OpenLayers to re-measure
    openlayersmap.updateSize();
}


// Add this to the very end of sketch.js

function keyPressed() {
    // Switching to ALT to avoid the OpenLayers "Shift-Zoom-Box" conflict
    if (keyCode === ALT) {
        canvas.elt.style.pointerEvents = 'none';
        cursor('grab'); 
    }
}

function keyReleased() {
    if (keyCode === ALT) {
        canvas.elt.style.pointerEvents = 'auto';
        cursor(ARROW);
    }
}
function undoTrim() {
  if (deletedEdgesStack.length > 0) {
    // 1. Take the most recently deleted road out of the memory bank
    let restoredEdge = deletedEdgesStack.pop();
    
    // 2. Put it back into the main edges array so it draws again
    edges.push(restoredEdge);
    
    // 3. Re-link the road to its start and end nodes
    // This is crucial so the routing algorithm knows the road exists
    restoredEdge.from.edges.push(restoredEdge);
    restoredEdge.to.edges.push(restoredEdge);
    
    // 4. If the nodes were hidden because they had no roads, bring them back
    if (!nodes.includes(restoredEdge.from)) nodes.push(restoredEdge.from);
    if (!nodes.includes(restoredEdge.to)) nodes.push(restoredEdge.to);
    
    // 5. Refresh the connection logic
    removeOrphans(); 
    
    console.log("Restored the last deleted road.");
  } else {
    console.log("Nothing to undo!");
  }
}
function getLiveTotalDistance() {
    let total = 0;
    for (let i = 0; i < edges.length; i++) {
        // Only count edges that are currently active/visible
        total += edges[i].distance;
    }
    // Returns distance (assumed to be in km based on your screenshot)
    return total;
}
function downloadGPX() {
  // Use bestroute if available; otherwise fall back to currentroute
  const route = (bestroute && bestroute.waypoints && bestroute.waypoints.length > 0) ? bestroute : currentroute;

  if (!route || !route.waypoints || route.waypoints.length === 0 || !startnode) {
    console.error("No route data found to download.");
    showMessage("No route available to export yet.");
    return;
  }

  // Build a clean list of trackpoints:
  // 1) start node
  // 2) every waypoint that has lat/lon
  const pts = [];
  pts.push({ lat: startnode.lat, lon: startnode.lon });

  for (let i = 0; i < route.waypoints.length; i++) {
    const p = route.waypoints[i];
    if (p && typeof p.lat === "number" && typeof p.lon === "number") {
      pts.push({ lat: p.lat, lon: p.lon });
    }
  }

  // If we somehow ended up with too few points, abort
  if (pts.length < 2) {
    console.error("Not enough valid points to export.");
    showMessage("Route export failed: not enough valid points.");
    return;
  }

  // Optional: close the loop back to start if last point isn't start-ish
  const last = pts[pts.length - 1];
  const dLat = last.lat - startnode.lat;
  const dLon = last.lon - startnode.lon;
  if (Math.sqrt(dLat * dLat + dLon * dLon) > 0.00005) { // ~5m-ish
    pts.push({ lat: startnode.lat, lon: startnode.lon });
  }

  const gpxHeader =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="RunEveryStreet" xmlns="http://www.topografix.com/GPX/1/1">\n` +
    `  <trk><name>RunEveryStreet Route</name><trkseg>\n`;

  const gpxFooter = `  </trkseg></trk>\n</gpx>\n`;

  let gpxBody = "";
  const t0 = Date.now();

  for (let i = 0; i < pts.length; i++) {
    const timeStr = new Date(t0 + i * 1000).toISOString();
    // NOTE: GPX is lat=".." lon=".." (do not swap)
    gpxBody += `    <trkpt lat="${pts[i].lat}" lon="${pts[i].lon}"><ele>0</ele><time>${timeStr}</time></trkpt>\n`;
  }

  const fullContent = gpxHeader + gpxBody + gpxFooter;

  // Create file ONLY when user clicks (this function should be called from your button click)
  const blob = new Blob([fullContent], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = "route.gpx";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
  console.log(`GPX exported: ${pts.length} points`);
}

function getOddDegreeNodes() {
    let oddNodes = [];
    let deg1 = 0;
    let deg0 = 0;
    let maxDeg = 0;

    for (let i = 0; i < nodes.length; i++) {
        const deg = nodes[i].edges ? nodes[i].edges.length : 0;

        if (deg === 0) deg0++;
        if (deg === 1) deg1++;
        if (deg % 2 !== 0) oddNodes.push(nodes[i]);
        if (deg > maxDeg) maxDeg = deg;
    }

    console.log(
        `Graph stats: nodes=${nodes.length}, edges=${edges.length}, oddNodes=${oddNodes.length}, deg1(deadEnds)=${deg1}, deg0(orphanNodes)=${deg0}, maxDeg=${maxDeg}`
    );

    // A quick “tree-ness” indicator:
    // For a connected graph, edges ≈ nodes-1 means very tree-like (lots of forced repeats).
    // More cycles -> edges >> nodes.
    console.log(
        `Cycle signal: edges - nodes + 1 = ${(edges.length - nodes.length + 1)} (higher => more loops, easier to get high efficiency)`
    );

    return oddNodes;
}

function dijkstra(startNode) {
    let distances = new Map();
    let parents = new Map(); // Track the way back
    let pq = [];

    for (let node of nodes) { distances.set(node, Infinity); }
    distances.set(startNode, 0);
    pq.push([startNode, 0]);

    while (pq.length > 0) {
        pq.sort((a, b) => a[1] - b[1]);
        let [u, distU] = pq.shift();
        if (distU > distances.get(u)) continue;

        for (let edge of u.edges) {
            let v = edge.OtherNodeofEdge(u);
            let alt = distU + edge.distance;
            if (alt < distances.get(v)) {
                distances.set(v, alt);
                parents.set(v, {node: u, edge: edge}); // Save the edge used
                pq.push([v, alt]);
            }
        }
    }
    return { distances, parents };
}

function getPathEdges(startNode, endNode) {
    let { parents } = dijkstra(startNode);
    let path = [];
    let curr = endNode;
    while (curr !== startNode) {
        let step = parents.get(curr);
        if (!step) break;
        path.push(step.edge);
        curr = step.node;
    }
    return path;
}
function buildOddNodeMatrix(oddNodesList) {
    let matrix = [];
    for (let i = 0; i < oddNodesList.length; i++) {
        // Run Dijkstra from this odd node
        let allDistances = dijkstra(oddNodesList[i]); 
        matrix[i] = [];
        
        for (let j = 0; j < oddNodesList.length; j++) {
            // If they are the same node, distance is 0
            if (i === j) {
                matrix[i][j] = 0;
                continue;
            }

            // Get distance from the Map. 
            // If dijkstra returns a Map, use .get(). 
            // If it returns a plain object, use allDistances[oddNodesList[j]]
            let d = (allDistances instanceof Map) 
                    ? allDistances.get(oddNodesList[j]) 
                    : allDistances[oddNodesList[j]];

            // Fallback: If no path exists, use a very large number instead of 'undefined'
            matrix[i][j] = (d !== undefined) ? d : 999999;
        }
    }
    console.log("Step 2 Complete: Distance matrix built for matching.");
    return matrix;
}
function findPairs(oddNodes, matrix) {
    // ---------- helpers ----------
    function shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    function totalCostIdx(pairsIdx) {
        let sum = 0;
        for (let k = 0; k < pairsIdx.length; k++) {
            sum += matrix[pairsIdx[k][0]][pairsIdx[k][1]];
        }
        return sum;
    }

    function greedyPairingFromOrder(orderIdx) {
        let unmatched = new Set(orderIdx);
        let pairsIdx = [];

        while (unmatched.size > 1) {
            // pick the "first" element in the current order
            let i = null;
            for (let v of orderIdx) {
                if (unmatched.has(v)) { i = v; break; }
            }
            if (i === null) break;
            unmatched.delete(i);

            let bestJ = -1;
            let bestCost = Infinity;
            for (let j of unmatched) {
                const c = matrix[i][j];
                if (c < bestCost) {
                    bestCost = c;
                    bestJ = j;
                }
            }
            if (bestJ !== -1) {
                pairsIdx.push([i, bestJ]);
                unmatched.delete(bestJ);
            } else {
                break;
            }
        }
        return pairsIdx;
    }

    function localSwapImprove(pairsIdx) {
        let improved = true;
        let passes = 0;
        const MAX_PASSES = 50;

        while (improved && passes < MAX_PASSES) {
            improved = false;
            passes++;

            for (let p = 0; p < pairsIdx.length; p++) {
                for (let q = p + 1; q < pairsIdx.length; q++) {
                    const a = pairsIdx[p][0];
                    const b = pairsIdx[p][1];
                    const c = pairsIdx[q][0];
                    const d = pairsIdx[q][1];

                    const current = matrix[a][b] + matrix[c][d];
                    const swap1 = matrix[a][c] + matrix[b][d];
                    const swap2 = matrix[a][d] + matrix[b][c];

                    if (swap1 + 1e-9 < current || swap2 + 1e-9 < current) {
                        if (swap1 <= swap2) {
                            pairsIdx[p] = [a, c];
                            pairsIdx[q] = [b, d];
                        } else {
                            pairsIdx[p] = [a, d];
                            pairsIdx[q] = [b, c];
                        }
                        improved = true;
                    }
                }
            }
        }

        return { pairsIdx, passes };
    }

    // ---------- multi-start search ----------
    const n = oddNodes.length;
    const baseOrder = [];
    for (let i = 0; i < n; i++) baseOrder.push(i);

    // Start with a reasonable number; bump if you want more searching
    const TRIES = 80;

    let bestPairsIdx = null;
    let bestCost = Infinity;
    let bestPasses = 0;

    for (let t = 0; t < TRIES; t++) {
        const order = shuffle(baseOrder.slice());
        let pairsIdx = greedyPairingFromOrder(order);

        const improved = localSwapImprove(pairsIdx);
        pairsIdx = improved.pairsIdx;

        const cost = totalCostIdx(pairsIdx);
        if (cost < bestCost) {
            bestCost = cost;
            bestPairsIdx = pairsIdx.slice();
            bestPasses = improved.passes;
        }
    }

    // Convert best result to node pairs
    const pairs = bestPairsIdx.map(([i, j]) => [oddNodes[i], oddNodes[j]]);

    console.log(
        `Pairing complete (multi-start): pairs=${pairs.length} tries=${TRIES} bestPasses=${bestPasses} pairCost=${bestCost.toFixed(2)}`
    );

    return pairs;
}


function applyDoublings(pairs) {
    totaledgedoublings = 0; // Notice: NO 'let' here. We are just resetting the existing variable.
    for (let e of edges) { e.isDoubled = false; }

    for (let pair of pairs) {
        let pathEdges = getPathEdges(pair[0], pair[1]); 
        for (let edge of pathEdges) {
            edge.isDoubled = true;
            totaledgedoublings++;
        }
    }
    console.log(`Step 4: Strategy applied. Doubled ${totaledgedoublings} segments.`);
}
function generateAndDownloadGPX(route) {
    // 1. Safety Check: Make sure there is actually a path to save
    if (!route || !route.waypoints || route.waypoints.length === 0) {
        alert("No route has been found yet. Please wait for the solver to finish!");
        return;
    }

    // 2. Build the GPX Header
    let gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RunEveryStreet-Gemini" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>RunEveryStreet - Optimal Route</name>
    <desc>Calculated with ${((totalRoadsDist / bestdistance) * 100).toFixed(1)}% efficiency</desc>
    <trkseg>`;

    // 3. Add every coordinate point in order
    // We use waypoints which were recorded in the Route class during the solve
    for (let i = 0; i < route.waypoints.length; i++) {
        let pt = route.waypoints[i];
        gpxContent += `\n      <trkpt lat="${pt.lat}" lon="${pt.lon}"></trkpt>`;
    }

    // 4. Close the tags
    gpxContent += `\n    </trkseg>\n  </trk>\n</gpx>`;

    // 5. Trigger the Browser Download
    let blob = new Blob([gpxContent], { type: 'application/gpx+xml' });
    let url = URL.createObjectURL(blob);
    let a = document.createElement('a');
    
    // Give it a timestamp so files don't overwrite each other
    let timestamp = new Date().getTime();
    a.href = url;
    a.download = `RES_Route_${timestamp}.gpx`;
    
    document.body.appendChild(a);
    a.click();
    
    // Cleanup
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log("GPX File Generated Successfully.");
}
function getClosestNode(mx, my) {
    // 1. IMPORTANT: Adjust for the Header!
    // Since the map starts 40px down, we must subtract the header height
    // from the mouse position so the map knows where we actually clicked.
    let adjustedY = my - 40; 
    
    // 2. Get the map coordinate from the adjusted pixel
    let pixelCoords = openlayersmap.getCoordinateFromPixel([mx, adjustedY]);
    if (!pixelCoords) return null;

    // 3. Convert to Lat/Lon for comparison with Node data
    let lonLat = ol.proj.toLonLat(pixelCoords);
    let mouseLon = lonLat[0];
    let mouseLat = lonLat[1];

    let closest = null;
    let minDist = Infinity;

    // 4. Loop through nodes
    for (let i = 0; i < nodes.length; i++) {
        let n = nodes[i];
        
        // Manual Distance Calculation (Lon/Lat units)
        let dx = mouseLon - n.lon;
        let dy = mouseLat - n.lat;
        let d = Math.sqrt(dx * dx + dy * dy);
        
        if (d < minDist) {
            minDist = d;
            closest = n;
        }
    }

    // 5. Threshold check 
    // Increased slightly to 0.001 to make it easier to click on mobile/touch
    if (minDist < 0.001) {
        console.log("Success! Found Node: " + closest.nodeId);
        return closest;
    } else {
        console.warn("Too far! Distance: " + minDist.toFixed(6) + ". Try clicking closer to a red dot.");
        return null;
    }
}
function triggerIngest() {
  getOverpassData();

  const panel = document.getElementById('ui-panel');
  if (panel) panel.style.display = 'none';

  // After loading roads, user should be able to pan/zoom to choose start
  mapPanZoomMode = true;
  setMode(selectnodemode); // nodes visible; clicks pass to map until you toggle to TRIM/EDIT

  openlayersmap.updateSize();
  setTimeout(() => openlayersmap.updateSize(), 0);

  console.log("Ingest triggered: start in PAN/ZOOM, toggle to TRIM/EDIT to click nodes/roads.");
}

function handleTrimming() {
    // Only act if we have a valid closest edge index
    if (closestedgetomouse < 0 || closestedgetomouse >= edges.length) return;

    // 1) Remove the edge from the master list
    const removedEdge = edges.splice(closestedgetomouse, 1)[0];
    if (!removedEdge) return;

    // 2) Add to undo stack
    deletedEdgesStack.push(removedEdge);

    // 3) Unlink from node adjacency lists (IMPORTANT so floodfill/orphan logic is correct)
    if (removedEdge.from && Array.isArray(removedEdge.from.edges)) {
        const idx = removedEdge.from.edges.indexOf(removedEdge);
        if (idx !== -1) removedEdge.from.edges.splice(idx, 1);
    }
    if (removedEdge.to && Array.isArray(removedEdge.to.edges)) {
        const idx = removedEdge.to.edges.indexOf(removedEdge);
        if (idx !== -1) removedEdge.to.edges.splice(idx, 1);
    }

    // 4) Reset hover index so we don't "ghost delete"
    closestedgetomouse = -1;

    // 5) AUTO-CLEAN: Remove any disconnected components not reachable from startnode
    // This will rebuild edges/nodes and re-calc totals internally.
    if (startnode) {
        removeOrphans();
    }

    console.log("Road removed + orphans cleaned.");
    showMessage("Road removed. Orphaned areas cleaned. Use Undo if needed.");

    // 6) FORCE VISUAL UPDATE (because you use noLoop())
    redraw();
    openlayersmap.render();
}





// --- VISUALIZATION HELPERS ---

function drawStartNodeHighlight() {
    if (startnode) {
        // This converts the GPS coordinates of the node to screen pixels
        let pos = getScreenPosition(startnode); 
        
        push();
        // Set the style: a green circle with a white border
        stroke(255);
        strokeWeight(2);
        fill(0, 255, 0); 
        ellipse(pos.x, pos.y, 14, 14);
        
        // Optional: A soft outer glow to make it pop
        noFill();
        stroke(0, 255, 0, 100);
        ellipse(pos.x, pos.y, 22, 22);
        pop();
    }
}
function getScreenPosition(node) {
    // This uses the OpenLayers map to find where the node is on the screen
    let coord = ol.proj.fromLonLat([node.lon, node.lat]);
    let pixel = openlayersmap.getPixelFromCoordinate(coord);
    return {
        x: pixel[0],
        y: pixel[1]
    };
}
function runOverpassQuery(overpassQuery, onSuccess, onFail) {
    fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
        },
        body: "data=" + encodeURIComponent(overpassQuery)
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`Overpass HTTP ${response.status}`);
        }
        return response.text();
    })
    .then(onSuccess)
    .catch(onFail);
}
function applyInputMode() {
  if (!canvas || !canvas.elt) return;

  // 1) Route input: PAN lets map receive events; EDIT lets canvas receive events
  canvas.elt.style.pointerEvents = mapPanZoomMode ? 'none' : 'auto';

  // 2) IMPORTANT: Never override solver/report modes.
  // setMode(solveRESmode) must "stick" or the solver will never run.
  if (mode === solveRESmode || mode === downloadGPXmode) {
    redraw();
    openlayersmap.render();
    return;
  }

  // 3) If we're in PAN/ZOOM, do not force any p5 mode.
  // User is just navigating the map.
  if (mapPanZoomMode) {
    redraw();
    openlayersmap.render();
    return;
  }

  // 4) We are in EDIT mode: choose the correct editing sub-mode
  if (!startnode) {
    mode = selectnodemode;
    showMessage("Click a red node to set Start");
  } else {
    mode = trimmodemode;
    showMessage("Trim mode: click a road to remove (Undo available)");
  }

  redraw();
  openlayersmap.render();
}


function togglePanTrim() {
  mapPanZoomMode = !mapPanZoomMode;
  applyInputMode();

  const btn = document.getElementById("mode-toggle");
  if (btn) btn.textContent = mapPanZoomMode ? "MODE: PAN/ZOOM" : "MODE: TRIM/EDIT";

  showMessage(mapPanZoomMode ? "Pan/Zoom enabled" : "Trim/Edit enabled");
}
