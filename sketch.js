let solverRunning = false;   // replaces navMode for solver logic
let mapInteractive = true;  // controls whether map receives mouse events
const HEADER_H = 40; // height of your top bar/logo area

let currentroute = null;
let totalRoadsDist = 0; 
let totaledgedoublings = 0;
let lastRecordTime = 0; 
let autoStopThreshold = 60000; // 60 seconds
let navMode = false; // TRUE = Solver Active, FALSE = Prep Mode
var deletedEdgesStack = [];

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
var remainingedges;
var debugsteps = 0;
var bestdistance = Infinity; // Essential for the solver to record the first path
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
    
    // If we are in Zoom/Pan mode, let clicks pass THROUGH the canvas to the map
    if (mode === choosemapmode) {
        canvas.elt.style.pointerEvents = 'none';
        console.log("Mode: Zoom & Pan (Map Active)");
    } 
    // If we are setting nodes or trimming, the canvas must CATCH the clicks
    else {
        canvas.elt.style.pointerEvents = 'auto';
        console.log("Mode: Editing (Canvas Active)");
    }
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

    // 3. THE SOLVER ENGINE
    // (If you renamed navMode -> solverRunning, use solverRunning here instead)
    if (mode === solveRESmode && navMode) {
        handleSolverEngine();
    }

    // 4. THE PATHS
    renderRouteGraphics();

    // 5. THE INTERFACE (Always draw last)
    renderUIOverlays();

    // 6. MODAL OVERLAYS
    if (mode === solveRESmode) {
        drawSolverStats();
    }

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
function handleSolverEngine() {
    // 1. SAFETY GUARD: Only run if we are in Solve Mode AND the Start Button was pressed
    if (mode !== solveRESmode || !navMode) return;
    
    if (!currentnode || !currentroute || !startnode) {
        return; 
    }

    // Dynamic Speed: Adjusts based on performance
    iterationsperframe = max(1, iterationsperframe - 1 * (5 - frameRate())); 

    for (let it = 0; it < iterationsperframe; it++) {
        iterations++;

        // 2. SMART SORTING
        if (!currentnode.edges || currentnode.edges.length === 0) break;

        currentnode.edges.sort((a, b) => {
            let capA = a.isDoubled ? 2 : 1;
            let capB = b.isDoubled ? 2 : 1;
            
            let remainingA = capA - a.travels;
            let remainingB = capB - b.travels;

            // Priority: Take unvisited edges first
            if (remainingA !== remainingB) {
                return remainingB - remainingA; 
            }
            // If equal, introduce random exploration
            return Math.random() - 0.5; 
        });

        let chosenEdge = currentnode.edges[0];
        if (!chosenEdge) break; 

        let nextNode = chosenEdge.OtherNodeofEdge(currentnode);
        
        if (!nextNode || nextNode.lat === undefined) {
            break;
        }

        // 3. PROGRESS TRACKING
        if (chosenEdge.travels === 0) {
            remainingedges--; 
        }
        
        let moveDist = chosenEdge.distance; 
        chosenEdge.travels++;
        
        // 4. RECORDING
        let extraDist = (chosenEdge.travels > 1) ? moveDist : 0;
        currentroute.addWaypoint(nextNode, moveDist, extraDist);
        currentnode = nextNode;
        
        // 5. COMPLETION LOGIC
        if (remainingedges <= 0) {
            let dLat = currentnode.lat - startnode.lat;
            let dLon = currentnode.lon - startnode.lon;
            let distToHome = Math.sqrt(dLat * dLat + dLon * dLon);
            
            // Check if returned to start (approx 10 meters)
            if (currentnode === startnode || distToHome < 0.0001) { 
                
                if (currentroute.distance < bestdistance) {
                    bestdistance = currentroute.distance;
                    bestroute = currentroute.copy(); 
                    lastRecordTime = millis();
                    console.log("New Best Route: " + (bestdistance / 1000).toFixed(2) + "km");
                }

                // --- THE RESET CYCLE ---
                // 1. Clear the 'travels' counter on all edges
                resetEdges(); 
                
                // 2. Teleport hiker back to start
                currentnode = startnode;
                
                // 3. Reset the countdown of roads to visit
                remainingedges = edges.filter(e => e.distance > 0).length; 
                
                // 4. Create a fresh path for the new attempt
                currentroute = new Route(currentnode, null);
            }
        }
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
    // 1. ALWAYS DRAW THE TOOLBAR
    // This ensures your 1. Zoom, 2. Set Start, and 3. Trim buttons never vanish.
    drawToolbar();

    // 2. SOLVER ACTIVE STATS
    if (mode === solveRESmode && bestdistance !== Infinity) {
        let timeLeft = ceil((autoStopThreshold - (millis() - lastRecordTime)) / 1000);
        
        // Use totalRoadsDist for efficiency if that's your "100%" goal
        let efficiency = (totalRoadsDist / bestdistance * 100).toFixed(1);

        drawStatsBox(
            "SOLVER ACTIVE", 
            `Best Dist: ${(bestdistance / 1000).toFixed(2)}km`, 
            `Efficiency: ${efficiency}%`,
            `Auto-stop in: ${max(0, timeLeft)}s`
        );
    }

    // 3. TRIMMING / SELECTION STATS
    // FIX: Using 'trimmodemode' to match your global variable list
    if (mode === trimmodemode || mode === selectnodemode) {
        let liveDist = getLiveTotalDistance();
        let displayDist = liveDist > 1000 ? (liveDist / 1000).toFixed(2) + "km" : liveDist.toFixed(0) + "m";
        
        drawStatsBox(
            "MAP PREPARATION", 
            `Total Road: ${displayDist}`, 
            mode === trimmodemode ? "TRIMMING ACTIVE" : "SELECT START NODE", 
            ""
        );
    }

    // 4. ACTION BUTTON (Bottom Left)
    // Only shows once a start node is picked, preventing accidental engine starts
    if (startnode) {
        drawSolverToggleButton();
    }
}

// Helper to draw the Start/Stop button at the bottom
function drawSolverToggleButton() {
    push();
    colorMode(RGB); // Ensure we're in RGB for red/green logic
    
    let btnW = 140;
    let btnH = 40;
    let btnX = 20;
    let btnY = height - 60;

    // 1. CLICK DETECTION
    // Check if mouse is within bounds AND just clicked
    if (mouseIsPressed && mouseX > btnX && mouseX < btnX + btnW && mouseY > btnY && mouseY < btnY + btnH) {
        // Toggle the navigation/solving state
        navMode = !navMode;
        
        // If starting, ensure we are in the correct mode
        if (navMode) {
            setMode(solveRESmode); 
        }
        
        // Small delay to prevent "double clicking" due to frame rate
        mouseIsPressed = false; 
    }

    // 2. RENDERING
    // Red if running (Stop), Green if ready (Start)
    fill(navMode ? color(255, 50, 50) : color(50, 200, 50));
    stroke(255);
    strokeWeight(2);
    rect(btnX, btnY, btnW, btnH, 8);

    fill(255);
    noStroke();
    textAlign(CENTER, CENTER);
    textSize(14);
    textStyle(BOLD);
    text(navMode ? "STOP SOLVER" : "START SOLVER", btnX + btnW/2, btnY + btnH/2);
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

    let btnW = 150;
    let btnH = 40;
    let margin = 10;

    // --- 1. NAV/INTERACT TOGGLE (Far Right) ---
    let navX = width - (btnW + margin);
    // Green (120) if Panning, Orange (15) if Interacting
    fill(navMode ? 120 : 15, 80, 255); 
    stroke(0); strokeWeight(2);
    rect(navX, 10, btnW, btnH, 5);
    
    fill(0); noStroke();
    text(navMode ? "MAP: PAN/ZOOM" : "MAP: LOCKED", navX + btnW/2, 30);

    // Handle Click for Nav Toggle
    if (mouseIsPressed && mouseX > navX && mouseX < navX + btnW && mouseY > 10 && mouseY < 10 + btnH) {
        navMode = !navMode;
        // If map is active, clicks pass through. If map is locked, canvas catches them.
        canvas.elt.style.pointerEvents = navMode ? 'none' : 'auto';
        mouseIsPressed = false; // Debounce
    }

    // --- 2. TRIM MODE SPECIFIC BUTTONS ---
    // Only show these if we are actually in the trimming phase
    if (mode === trimmodemode) {
        // UNDO BUTTON
        let undoX = width - (btnW * 2 + margin * 2);
        fill(200, 20, 255); 
        stroke(0); strokeWeight(2);
        rect(undoX, 10, btnW, btnH, 5);
        fill(0); noStroke();
        text("UNDO LAST TRIM", undoX + btnW/2, 30);

        if (mouseIsPressed && mouseX > undoX && mouseX < undoX + btnW && mouseY > 10 && mouseY < 10 + btnH) {
            if (typeof undoLastTrim === "function") undoLastTrim();
            mouseIsPressed = false;
        }

        // START SOLVER BUTTON
        let startX = width - (btnW * 3 + margin * 3);
        fill(120, 255, 255); 
        stroke(0); strokeWeight(2);
        rect(startX, 10, btnW, btnH, 5);
        fill(0); noStroke();
        text("GO TO SOLVER", startX + btnW/2, 30);

        if (mouseIsPressed && mouseX > startX && mouseX < startX + btnW && mouseY > 10 && mouseY < 10 + btnH) {
            setMode(solveRESmode);
            mouseIsPressed = false;
        }
    }
    pop();
}

function getOverpassData() {
    showMessage("Loading map data...");

    // Keep canvas aligned with map
    canvas.position(0, 0);

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
	for (let i = 0; i < edges.length; i++) {
		edges[i].show();
		if (mode == trimmodemode) {
			let dist = edges[i].distanceToPoint(mouseX, mouseY)
			if (dist < closestedgetomousedist) {
				closestedgetomousedist = dist;
				closestedgetomouse = i;
			}
		}
	}
	if (closestedgetomouse >= 0 && !isTouchScreenDevice) {
		edges[closestedgetomouse].highlight();
	}

}

function resetEdges() {
    // 1. Reset the travel count for every road segment
    for (let i = 0; i < edges.length; i++) {
        edges[i].travels = 0;
        // Correct: isDoubled stays as-is (it's your map's "Master Plan")
    }

    // 2. CRITICAL: Reset the counter that the Solver Engine watches
    // We only count edges that have a physical distance (valid roads)
    remainingedges = edges.filter(e => e.distance > 0).length;

    // 3. Reset the starting point for the new attempt
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
    // 1. Initial Cleanup
    if (!startnode) {
        showMessage("Error: No start node selected.");
        return;
    }

    // Make sure solver is NOT running while we prep
    solverRunning = false;

    // (Optional but helpful) lock the map while solving/prepping
    // so clicks don't accidentally pan/zoom when you're trying to edit
    // mapInteractive = false;
    // canvas.elt.style.pointerEvents = mapInteractive ? 'none' : 'auto';

    removeOrphans();
    resetEdges();

    // 2. The Strategy (Odd nodes -> distance matrix -> pairing -> apply doubling)
    let myOddNodes = getOddDegreeNodes();
    let myMatrix = buildOddNodeMatrix(myOddNodes);
    let optimalPairs = findPairs(myOddNodes, myMatrix);
    applyDoublings(optimalPairs);

    // 3. UI and State
    // Engage solver mode
    setMode(solveRESmode);

    // Start the solver engine
    solverRunning = true;

    // 4. Distance Synchronization
    totalRoadsDist = 0;
    let validRoadsCount = 0;

    for (let e of edges) {
        let d = parseFloat(e.distance) || 0;
        if (d > 0) {
            totalRoadsDist += d;
            validRoadsCount++;
        }
    }

    remainingedges = validRoadsCount;

    // 5. Solver Initialization
    currentnode = startnode;
    currentroute = new Route(currentnode, null);

    // Reset best records
    bestdistance = Infinity;
    bestroute = null;
    iterations = 0;
    lastRecordTime = millis();

    console.log("--- SOLVER READY ---");
    console.log(`Target: ${(totalRoadsDist / 1000).toFixed(2)}km across ${validRoadsCount} roads.`);
}

function mousePressed() {
    // 1. UI GUARD: Don't click map through the toolbar
    if (mouseY < 60) return; 

    // 2. ACTION BUTTON (Bottom Left)
    // Using fixed values that match your drawing function exactly
    let btnW = 140;
    let btnH = 40;
    let btnX = 20;
    let btnY = height - 60;

    if (mouseX > btnX && mouseX < btnX + btnW && mouseY > btnY && mouseY < btnY + btnH) {
        if (startnode) {
            if (mode === solveRESmode) {
                navMode = !navMode; // Toggle movement
                showMessage(navMode ? "Solver Running..." : "Solver Paused");
            } else {
                // IMPORTANT: Ensure we are in solveRESmode when we start
                mode = solveRESmode;
                solveRES(); 
            }
        } else {
            showMessage("Click a red node to set Start first!");
        }
        return; 
    }

    // 3. SELECTION LOGIC (Node Picking)
    if (mode === selectnodemode) {
        // Validation: must be an object and not our default -1
        if (closestnodetomouse && typeof closestnodetomouse === 'object') {
            startnode = closestnodetomouse;
            currentnode = startnode;
            
            // Initialize route
            if (typeof Route === "function") {
                currentroute = new Route(startnode, null);
            }
            
            console.log("Start Node Set:", startnode.nodeId);
            showMessage("Start Locked! Click roads to trim or click START.");

            // STATE TRANSITION: Stop selecting nodes, start trimming
            mode = trimmodemode; 
            closestnodetomouse = -1; 
        }
        return;
    }

    // 4. TRIMMING LOGIC (Edge Deletion)
    if (mode === trimmodemode) {
        if (closestedgetomouse !== -1) {
            handleTrimming(); 
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
  if (!bestroute || !bestroute.waypoints || bestroute.waypoints.length === 0) {
    console.error("No route data found to download.");
    return;
  }

  let gpxHeader = '<?xml version="1.0" encoding="UTF-8"?>\n' +
                  '<gpx version="1.1" creator="GeminiRoute" xmlns="http://www.topografix.com/GPX/1/1">\n' +
                  '  <trk><name>Every Single Street</name><trkseg>\n';
  
  let gpxFooter = '  </trkseg></trk>\n</gpx>';
  let gpxBody = "";

  // Build waypoints from your bestroute data 
  for (let i = 0; i < bestroute.waypoints.length; i++) {
    let p = bestroute.waypoints[i];
    // Use the current time to ensure the GPX file is valid for apps 
    let timeStr = new Date(Date.now() + i * 1000).toISOString(); 
    gpxBody += `    <trkpt lat="${p.lat}" lon="${p.lon}"><ele>0</ele><time>${timeStr}</time></trkpt>\n`;
  }

  let fullContent = gpxHeader + gpxBody + gpxFooter;

  // This forces the browser to recognize the file as GPX, not TXT
  let blob = new Blob([fullContent], { type: 'application/gpx+xml' });
  let url = URL.createObjectURL(blob);
  let link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", "route.gpx"); // Explicitly sets the extension
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
function getOddDegreeNodes() {
  let oddNodes = [];
  
  for (let i = 0; i < nodes.length; i++) {
    // If the number of edges is 1, 3, 5, etc., it's an odd node
    if (nodes[i].edges.length % 2 !== 0) {
      oddNodes.push(nodes[i]);
    }
  }
  
  console.log("Step 1 Complete: Found " + oddNodes.length + " odd-degree nodes.");
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
    let unmatched = new Set();
    for (let i = 0; i < oddNodes.length; i++) unmatched.add(i);
    
    let pairs = [];

    while (unmatched.size > 1) {
        let i = unmatched.values().next().value; // Pick first available
        unmatched.delete(i);

        let closestDist = Infinity;
        let closestJ = -1;

        // Find the closest available partner
        for (let j of unmatched) {
            if (matrix[i][j] < closestDist) {
                closestDist = matrix[i][j];
                closestJ = j;
            }
        }

        if (closestJ !== -1) {
            pairs.push([oddNodes[i], oddNodes[closestJ]]);
            unmatched.delete(closestJ);
        }
    }
    console.log(`Step 3: Created ${pairs.length} optimal pairs for backtracking.`);
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
    // 1. Start loading OSM data
    getOverpassData();

    // 2. Hide the ingest button panel
    let panel = document.getElementById('ui-panel');
    if (panel) {
        panel.style.display = 'none';
    }

    // 3. Wake up canvas interaction (node selection / trimming)
    canvas.elt.style.pointerEvents = 'auto';

    // 4. Switch to node-selection mode
    mode = selectnodemode;

    // 5. CRITICAL: Force OpenLayers to re-measure the map size
    // This fixes the right-side black area
    openlayersmap.updateSize();
    setTimeout(() => openlayersmap.updateSize(), 0);

    console.log("Ingest triggered, UI hidden, map resized.");
}


function handleTrimming() {
    // closestedgetomouse is the index found by showEdges()
    if (closestedgetomouse >= 0 && closestedgetomouse < edges.length) {
        
        // 1. Remove the edge from the main array
        // .splice returns an array, so we take the first [0] element
        let removedEdge = edges.splice(closestedgetomouse, 1)[0];
        
        // 2. Add it to the Undo Stack so we can bring it back if we mess up
        deletedEdgesStack.push(removedEdge);
        
        // 3. Update the total distance counters
        totaledgedistance -= removedEdge.distance;
        totalRoadsDist = totaledgedistance; 
        totaluniqueroads = edges.length;

        // 4. Reset the hover index so it doesn't "ghost" delete
        closestedgetomouse = -1;
        
        console.log("Road removed. New total distance: " + (totalRoadsDist / 1000).toFixed(2) + " km");
        showMessage("Road removed. Use Undo if needed.");
    }
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
