let navMode = false; // TRUE = Solver Active, FALSE = Prep Mode
const HEADER_H = 40; // height of your top bar/logo area
let mapPanZoomMode = true; // true = pan/zoom map, false = edit/trim on canvas
let currentroute = null;
let totalRoadsDist = 0; 
let totaledgedoublings = 0;
var deletedEdgesStack = [];
var remainingedges;
var bestdistance = Infinity;
// Map Initialization
var openlayersmap = new ol.Map({
  target: 'map',

  // ✅ OpenLayers v7 legacy build: defaults.defaults(...)
  controls: ol.control.defaults.defaults({
    attributionOptions: {
      collapsible: true,
      collapsed: true
    }
  }),

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


var showRoads = true;

var msgbckDiv, msgDiv, reportbckDiv, reportmsgDiv;
var margin;

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
  if (touches && touches.length > 0) isTouchScreenDevice = true;

  // Keep the canvas transparent over the OpenLayers map
  clear();

  // SAFETY: During resize / early lifecycle, these can be undefined briefly
  const safeEdges = Array.isArray(edges) ? edges : [];
  const safeNodes = Array.isArray(nodes) ? nodes : [];

  // 1. RENDER MAP DATA
  if (showRoads && safeEdges.length > 0) {
    showEdges();
  }

  // 2. NODES / START HIGHLIGHT
  // Show nodes in BOTH selection and trimming modes.
  // Hover detection only runs when mode === selectnodemode (inside showNodes()).
  if ((mode === selectnodemode || mode === trimmodemode) && safeNodes.length > 0) {
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

  // NOTE: click logic happens in mousePressed() now (because noLoop()).
  // If you were clicking this inside drawToolbar() previously, that caused weirdness.
  // We'll keep it draw-only here.

  // --- RIGHT: UNDO button only while trimming ---
  if (mode === trimmodemode) {
    const undoX = width - (btnW + margin);

    fill(200, 20, 255);
    stroke(0); strokeWeight(2);
    rect(undoX, y, btnW, btnH, 5);

    fill(0); noStroke();
    text("UNDO TRIM", undoX + btnW / 2, y + btnH / 2);
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
    "EPSG:3857",
    "EPSG:4326"
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

    // IMPORTANT: keep ingest button visible so user can retry
    const panel = document.getElementById("ui-panel");
    if (panel) panel.style.display = "block";

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
        showMessage("No named roads found. Zoom in and try again.");

        // Re-show ingest panel so user can retry
        const panel = document.getElementById("ui-panel");
        if (panel) panel.style.display = "block";

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

      // ✅ SUCCESS: hide ingest button ONLY now
      const panel = document.getElementById("ui-panel");
      if (panel) panel.style.display = "none";

      // 6. Wake up UI
      setMode(selectnodemode);
      showMessage("Click a red node to set Start");

      // Force immediate draw (prevents “roads appear only after zoom”)
      redraw();

      console.log(`Loaded ${edges.length} road segments`);
    },
    function (err) {
      console.error("Overpass failed:", err);
      showMessage("Overpass failed (zoom in more and try again).");

      // Re-show ingest panel so user can retry
      const panel = document.getElementById("ui-panel");
      if (panel) panel.style.display = "block";

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

  // ---- 4) Multi-start greedy pairing + local swap improvement ----
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

  // ---- 5) Apply doublings via shortest paths ----
  for (const [a, b] of pairs) {
    const pathEdges = getPathEdges(a, b);
    for (const e of pathEdges) {
      if (!e) continue;
      e.extraTraversals = (e.extraTraversals || 0) + 1;
    }
  }

  // ---- 6) Hierholzer on multigraph (TURN-AWARE + POCKET-CLEARING) ----
  const usedCount = new Map();

  function requiredTraversals(edge) {
    if (!edge || edge.distance <= 0) return 0;
    return 1 + (edge.extraTraversals || 0);
  }

  function safeOtherNode(edge, node) {
    if (!edge || !node) return null;
    if (edge.from === node) return edge.to;
    if (edge.to === node) return edge.from;
    return null;
  }

  function bearingDeg(a, b) {
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;
    const dLon = ((b.lon - a.lon) * Math.PI) / 180;

    const y = Math.sin(dLon) * Math.cos(lat2);
    const x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

    let brng = (Math.atan2(y, x) * 180) / Math.PI;
    brng = (brng + 360) % 360;
    return brng;
  }

  function turnAngleDeg(prevBear, nextBear) {
    let d = Math.abs(nextBear - prevBear);
    if (d > 180) d = 360 - d;
    return d;
  }

  // Count how many traversals remain globally (rough scale factor)
  function totalRemainingTraversals() {
    let total = 0;
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const req = requiredTraversals(e);
      const used = usedCount.get(e) || 0;
      if (used < req) total += (req - used);
    }
    return total;
  }

  // Estimate "pocket size" reachable from startNode WITHOUT crossing blockedEdge
  // We count remaining-traversal edges in that reachable region.
  function pocketSizeTraversals(startNode, blockedEdge) {
    if (!startNode) return 0;

    const visitedNodes = new Set();
    const visitedEdges = new Set();
    const stack = [startNode];
    visitedNodes.add(startNode);

    let count = 0;

    while (stack.length > 0) {
      const u = stack.pop();
      if (!u.edges) continue;

      for (let i = 0; i < u.edges.length; i++) {
        const e = u.edges[i];
        if (!e) continue;
        if (e === blockedEdge) continue;

        const req = requiredTraversals(e);
        const used = usedCount.get(e) || 0;
        if (used >= req) continue; // no remaining need => ignore for pocket sizing

        if (!visitedEdges.has(e)) {
          visitedEdges.add(e);
          count += (req - used);
        }

        const v = safeOtherNode(e, u);
        if (v && !visitedNodes.has(v)) {
          visitedNodes.add(v);
          stack.push(v);
        }
      }
    }
    return count;
  }

  // Choose next edge:
  //  - minimize turning
  //  - avoid U-turns
  //  - BUT if an edge leads into a small "pocket", clear it now
  function getBestNextEdge(node, prevNode, prevEdge, globalRemaining) {
    if (!node || !node.edges || node.edges.length === 0) return null;

    const hasIncoming = !!(prevNode && prevNode !== node);
    const incomingBearing = hasIncoming ? bearingDeg(prevNode, node) : null;

    let best = null;
    let bestScore = Infinity;

    // Define "small pocket" as: pocket traversal count <= max(6, 6% of remaining)
    const pocketThresh = Math.max(6, Math.floor(globalRemaining * 0.06));

    for (let k = 0; k < node.edges.length; k++) {
      const e = node.edges[k];
      const req = requiredTraversals(e);
      if (req <= 0) continue;

      const used = usedCount.get(e) || 0;
      if (used >= req) continue;

      const other = safeOtherNode(e, node);
      if (!other) continue;

      let score = 0;

      // --- Turn minimization ---
      if (hasIncoming) {
        const outBearing = bearingDeg(node, other);
        const ang = turnAngleDeg(incomingBearing, outBearing);
        score += ang;
        if (ang > 150) score += 200; // strong U-turn penalty
      }

      // --- Pocket clearing ---
      // If treating e as a doorway, and the far side is a small pocket, clear it now.
      const pocket = pocketSizeTraversals(other, e);
      if (pocket > 0 && pocket <= pocketThresh) {
        // Bigger bonus for smaller pockets
        // (e.g., pocket=2 gets huge bonus, pocket=10 smaller bonus)
        score -= (220 - Math.min(200, pocket * 20));
      }

      // Prefer staying on same wayid (often same street)
      if (prevEdge && e.wayid && prevEdge.wayid && e.wayid === prevEdge.wayid) {
        score -= 15;
      }

      // Mild preference to consume edges with more remaining required traversals
      const remaining = req - used;
      score -= Math.min(5, remaining);

      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }

    return best;
  }

  resetEdges();

  const nodeStack = [startnode];
  const edgeStack = [];
  const circuitEdges = [];

  const prevNodeStack = [null];
  const prevEdgeStack = [null];

  while (nodeStack.length > 0) {
    const v = nodeStack[nodeStack.length - 1];
    const prevV = prevNodeStack[prevNodeStack.length - 1];
    const prevE = prevEdgeStack[prevEdgeStack.length - 1];

    const globalRem = totalRemainingTraversals();
    const e = getBestNextEdge(v, prevV, prevE, globalRem);

    if (e) {
      usedCount.set(e, (usedCount.get(e) || 0) + 1);

      const w = safeOtherNode(e, v);
      if (!w) {
        console.warn("Discontinuity during Euler build: edge not incident to current node", e, v);
        break;
      }

      nodeStack.push(w);
      edgeStack.push(e);

      prevNodeStack.push(v);
      prevEdgeStack.push(e);
    } else {
      nodeStack.pop();
      prevNodeStack.pop();
      prevEdgeStack.pop();

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

  const diff = Math.abs(bestdistance - expectedFinal);
  if (diff > 5) {
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
   const undoX = width - (toolBtnW + toolMargin); // matches new drawToolbar()
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

// Reset the "glass wall" when mouse is released so the map stays zoomable in choosemapmode
function mouseReleased() {
    if (mode == choosemapmode) {
        canvas.elt.style.pointerEvents = 'none';
    }
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

// Single reusable toast (no stacked boxes)
let msgToast = null;
let msgToastTimer = null;

function showMessage(msg) {
  // Create once
  if (!msgToast) {
    msgToast = createDiv('');
    msgToast.id('statusMsg');
    msgToast.style('position', 'fixed');
    msgToast.style('top', (HEADER_H + 12) + 'px');   // just below the header
    msgToast.style('left', '50%');
    msgToast.style('transform', 'translateX(-50%)');
    msgToast.style('padding', '8px 14px');
    msgToast.style('border-radius', '10px');
    msgToast.style('background', 'rgba(0,0,0,0.70)');
    msgToast.style('color', 'white');
    msgToast.style('font-family', '"Lucida Sans Unicode", "Lucida Grande", sans-serif');
    msgToast.style('font-size', '14px');
    msgToast.style('line-height', '1.2');
    msgToast.style('text-align', 'center');
    msgToast.style('z-index', '10002');
    msgToast.style('max-width', '70vw');
    msgToast.style('pointer-events', 'none'); // never blocks map clicks
  }

  msgToast.html(msg);
  msgToast.show();

  // Auto-hide after a bit (prevents permanent clutter)
  if (msgToastTimer) clearTimeout(msgToastTimer);
  msgToastTimer = setTimeout(() => {
    hideMessage();
  }, 2500);
}

function hideMessage() {
  if (msgToast) msgToast.hide();
  if (msgToastTimer) {
    clearTimeout(msgToastTimer);
    msgToastTimer = null;
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
  if (deletedEdgesStack.length === 0) {
    console.log("Nothing to undo!");
    showMessage("Nothing to undo.");
    return;
  }

  // Pop the most recent batch
  const batch = deletedEdgesStack.pop();
  if (!Array.isArray(batch) || batch.length === 0) return;

  // Restore edges
  for (const e of batch) {
    if (!edges.includes(e)) {
      edges.push(e);
    }

    if (e.from && Array.isArray(e.from.edges) && !e.from.edges.includes(e)) {
      e.from.edges.push(e);
    }
    if (e.to && Array.isArray(e.to.edges) && !e.to.edges.includes(e)) {
      e.to.edges.push(e);
    }

    if (e.from && !nodes.includes(e.from)) nodes.push(e.from);
    if (e.to && !nodes.includes(e.to)) nodes.push(e.to);
  }

  // Rebuild adjacency & counts cleanly
  resetEdges();

  showMessage(`Undo restored ${batch.length} segment(s).`);

  redraw();
  openlayersmap.render();
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

  // -----------------------------
  // Helpers (meters + bearings)
  // -----------------------------
  function haversineMeters(a, b) {
    const R = 6371000;
    const lat1 = a.lat * Math.PI / 180;
    const lat2 = b.lat * Math.PI / 180;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLon = (b.lon - a.lon) * Math.PI / 180;
    const s1 = Math.sin(dLat / 2);
    const s2 = Math.sin(dLon / 2);
    const h = s1 * s1 + Math.cos(lat1) * Math.cos(lat2) * s2 * s2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function bearingDeg(a, b) {
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;
    const dLon = ((b.lon - a.lon) * Math.PI) / 180;

    const y = Math.sin(dLon) * Math.cos(lat2);
    const x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

    let brng = (Math.atan2(y, x) * 180) / Math.PI;
    brng = (brng + 360) % 360;
    return brng;
  }

  function turnAngleDeg(prevBear, nextBear) {
    let d = Math.abs(nextBear - prevBear);
    if (d > 180) d = 360 - d;
    return d;
  }

  // -----------------------------
  // Build initial points list
  // -----------------------------
  const pts = [];
  pts.push({ lat: startnode.lat, lon: startnode.lon });

  for (let i = 0; i < route.waypoints.length; i++) {
    const p = route.waypoints[i];
    if (p && typeof p.lat === "number" && typeof p.lon === "number") {
      pts.push({ lat: p.lat, lon: p.lon });
    }
  }

  if (pts.length < 2) {
    console.error("Not enough valid points to export.");
    showMessage("Route export failed: not enough valid points.");
    return;
  }

  // Close the loop back to start if needed (~5m)
  const last = pts[pts.length - 1];
  if (haversineMeters(last, pts[0]) > 5) {
    pts.push({ lat: pts[0].lat, lon: pts[0].lon });
  }

  // -----------------------------
  // GPX optimization for COROS
  // -----------------------------
  // Goal: fewer jittery micro-turns, points not too dense.
  //
  // Tunable knobs:
  // - MIN_SPACING_M: drop points closer than this (unless a real corner)
  // - CORNER_KEEP_DEG: always keep points that create a turn >= this
  // - STRAIGHT_DROP_DEG: drop middle point if turn angle <= this
  //
  // Practical COROS-friendly defaults:
  const MIN_SPACING_M = 10;        // avoid overly dense points
  const CORNER_KEEP_DEG = 28;      // keep real corners
  const STRAIGHT_DROP_DEG = 8;     // remove nearly straight intermediate points

  // Pass 1: spacing filter (but preserve corners)
  const spaced = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prevKept = spaced[spaced.length - 1];
    const d = haversineMeters(prevKept, pts[i]);

    if (d >= MIN_SPACING_M) {
      spaced.push(pts[i]);
    } else {
      // Too close: keep it ONLY if it's a corner candidate
      // We can decide corner-ness when we have prev+curr+next
      // For now, skip; Pass 2 will keep corners properly.
    }
  }

  // Ensure we didn't delete everything
  const base = (spaced.length >= 2) ? spaced : pts.slice();

  // Pass 2: collinearity / corner preservation
  const simplified = [];
  simplified.push(base[0]);

  for (let i = 1; i < base.length - 1; i++) {
    const A = simplified[simplified.length - 1]; // last kept
    const B = base[i];
    const C = base[i + 1];

    const bear1 = bearingDeg(A, B);
    const bear2 = bearingDeg(B, C);
    const ang = turnAngleDeg(bear1, bear2);

    // If it's a meaningful corner, keep it
    if (ang >= CORNER_KEEP_DEG) {
      simplified.push(B);
      continue;
    }

    // If it's almost straight, drop B
    if (ang <= STRAIGHT_DROP_DEG) {
      continue;
    }

    // In-between: keep it if it's not too dense (helps curves)
    const dAB = haversineMeters(A, B);
    if (dAB >= MIN_SPACING_M) simplified.push(B);
  }

  simplified.push(base[base.length - 1]);

  // Final sanity: ensure loop closes
  if (haversineMeters(simplified[0], simplified[simplified.length - 1]) > 5) {
    simplified.push({ lat: simplified[0].lat, lon: simplified[0].lon });
  }

  // -----------------------------
  // Build GPX
  // -----------------------------
  const gpxHeader =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="RunEveryStreet" xmlns="http://www.topografix.com/GPX/1/1">\n` +
    `  <trk><name>RunEveryStreet Route</name><trkseg>\n`;

  const gpxFooter = `  </trkseg></trk>\n</gpx>\n`;

  let gpxBody = "";
  const t0 = Date.now();

  for (let i = 0; i < simplified.length; i++) {
    const timeStr = new Date(t0 + i * 1000).toISOString();
    gpxBody += `    <trkpt lat="${simplified[i].lat}" lon="${simplified[i].lon}"><ele>0</ele><time>${timeStr}</time></trkpt>\n`;
  }

  const fullContent = gpxHeader + gpxBody + gpxFooter;

  const blob = new Blob([fullContent], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = "route.gpx";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);

  console.log(`GPX exported: raw=${pts.length} points | spaced=${base.length} | simplified=${simplified.length}`);
  showMessage(`GPX ready (optimized): ${simplified.length} points`);
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

function triggerIngest() {
  // Show loading UI (and make sure panel stays available)
  const panel = document.getElementById('ui-panel');
  if (panel) panel.style.display = 'block';

  getOverpassData();

  // After clicking load, user should be able to pan/zoom immediately
  mapPanZoomMode = true;
  setMode(choosemapmode);

  openlayersmap.updateSize();
  setTimeout(() => openlayersmap.updateSize(), 0);

  console.log("Ingest triggered: start in PAN/ZOOM, toggle to TRIM/EDIT to click nodes/roads.");
}


function handleTrimming() {
  if (closestedgetomouse < 0 || closestedgetomouse >= edges.length) return;

  // --- BEGIN UNDO BATCH ---
  const undoBatch = [];

  // 1) Remove the explicitly clicked edge
  const removedEdge = edges.splice(closestedgetomouse, 1)[0];
  if (!removedEdge) return;

  undoBatch.push(removedEdge);

  // Unlink from adjacency
  if (removedEdge.from && Array.isArray(removedEdge.from.edges)) {
    const idx = removedEdge.from.edges.indexOf(removedEdge);
    if (idx !== -1) removedEdge.from.edges.splice(idx, 1);
  }
  if (removedEdge.to && Array.isArray(removedEdge.to.edges)) {
    const idx = removedEdge.to.edges.indexOf(removedEdge);
    if (idx !== -1) removedEdge.to.edges.splice(idx, 1);
  }

  // 2) Capture current edge set BEFORE orphan cleanup
  const edgesBefore = new Set(edges);

  // 3) Remove orphaned components
  if (startnode) {
    removeOrphans();
  }

  // 4) Anything that existed before but is gone now = orphan-removed
  for (const e of edgesBefore) {
    if (!edges.includes(e)) {
      undoBatch.push(e);
    }
  }

  // 5) Push the WHOLE batch as one undo step
  deletedEdgesStack.push(undoBatch);

  // Reset hover index
  closestedgetomouse = -1;

  showMessage(`Road removed. ${undoBatch.length} segment(s) affected. Undo available.`);

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
