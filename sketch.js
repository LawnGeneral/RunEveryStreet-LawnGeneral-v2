let currentroute;
let totalRoadsDist = 0; 
let totaledgedoublings = 0;
let lastRecordTime = 0; 
let autoStopThreshold = 60000; // 60 seconds
let navMode = false; // false = Trimming, true = Panning/Zooming
var deletedEdgesStack = [];
var openlayersmap = new ol.Map({
	target: 'map',
	layers: [
		new ol.layer.Tile({
			source: new ol.source.OSM(),
			opacity: 0.5
		})
	],
	view: new ol.View({
		// REPLACE THESE NUMBERS with your local Longitude and Latitude
		// Format: [Longitude, Latitude]
		center: ol.proj.fromLonLat([-76.88, 40.27]), 
		zoom: 14 // Increased zoom so you are closer to the streets
	})
});

var canvas;
var mapHeight;
var windowX, windowY;
let txtoverpassQuery;
var OSMxml;
var numnodes, numways;
var nodes;
var minlat = Infinity,
	maxlat = -Infinity,
	minlon = Infinity,
	maxlon = -Infinity;
var nodes = [],
	edges = [];
var mapminlat, mapminlon, mapmaxlat, mapmaxlon;
var totaledgedistance = 0;
var closestnodetomouse = -1;
var closestedgetomouse = -1;
var startnode, currentnode;
var selectnodemode = 1,
	solveRESmode = 2,
	choosemapmode = 3,
	trimmode = 4,
	downloadGPXmode = 5;
var mode;
var remainingedges;
var debugsteps = 0;
var bestdistance;
var bestroute;
var bestarea;
var bestdoublingsup;
var showSteps = false;
var showRoads = true;
var iterations, iterationsperframe;
var msgbckDiv, msgDiv, reportbckDiv,reportmsgDiv;
var margin;
var btnTLx, btnTLy, btnBRx, btnBRy; // button's top left and bottom right x and y coordinates.
var starttime;
var efficiencyhistory = [],
	distancehistory = [];
var totalefficiencygains = 0;
var isTouchScreenDevice = false;
var totaluniqueroads;

function setup() {
	if (navigator.geolocation) {
		// This tries to grab your GPS location immediately
		navigator.geolocation.getCurrentPosition(function (position) {
			let userCoords = ol.proj.fromLonLat([position.coords.longitude, position.coords.latitude]);
			openlayersmap.getView().setCenter(userCoords);
			openlayersmap.getView().setZoom(15); // Zoom in close to your house
		}, function(error) {
			console.warn("Geolocation blocked or failed. Using default center.");
		}, {
			enableHighAccuracy: true,
			timeout: 5000
		});
	}
    // ... rest of your setup code
	mapWidth = windowWidth;
	mapHeight = windowHeight;
	windowX = windowWidth;
	windowY = mapHeight;
	canvas = createCanvas(windowX, windowY - 34);
	colorMode(HSB);
	mode = choosemapmode;
	iterationsperframe = 1;
	margin = 0.05; // Slightly smaller margin so you see more of what you zoomed into
	showMessage("Zoom to selected area, then click here");

	// --- THE FIX ---
	// 1. Allow mouse events to pass through the canvas to the map by default
	canvas.elt.style.pointerEvents = 'none'; 

	// 2. Tell the map to redraw p5 roads every time you zoom or pan
	openlayersmap.on('postrender', function() {
		redraw(); 
	});
}
function draw() {
    // Detect if the user is on a touch device
    if (touches.length > 0) isTouchScreenDevice = true;

    // Standard p5.js cleanup
    clear();
    drawMask();

    // 1. SCENE MANAGEMENT: Skip map logic if we are still choosing a map
    if (mode === choosemapmode) return;

    // 2. BASE MAP RENDERING
    // We only show the blue roads if the solver isn't running (to keep the screen clean)
    if (showRoads) showEdges();
    if (!navMode) showNodes();

    // 3. THE ENGINE: Run the solver logic if in Solve mode
    if (mode === solveRESmode) {
        handleSolverEngine();
    }

    // 4. VISUALIZATION: Draw the hiker's current path and the best found path
    renderRouteGraphics();

    // 5. REPORTING: Show the "Success" screen if the user is downloading the GPX
    if (mode === downloadGPXmode) {
        showReportOut();
    }

    // 6. STANDARD UI: Buttons, zoom levels, and general labels
    renderUIOverlays();

    // 7. SOLVER STATS OVERLAY (Step 2 Logic)
    // This only displays when the solver is actually working
    if (mode === solveRESmode) {
        drawSolverStats();
    }
}

/**
 * Helper function to keep the draw() loop clean.
 * This draws the black box with real-time efficiency data.
 */
function drawSolverStats() {
    push();
    resetMatrix(); // Prevents the UI from moving when you pan/zoom the map
    
    // Background Box
    fill(0, 0, 0, 180); 
    noStroke();
    rect(15, 15, 260, 130, 12); 

    fill(255);
    textSize(15);
    textAlign(LEFT, TOP);
    textFont('monospace'); // Use a fixed-width font for clean alignment

    // Calculation: (Total Map Distance / Best Hiker Distance)
    // If bestdistance is Infinity, efficiency is 0.
    let efficiency = (bestdistance === Infinity) ? 0 : (totalRoadsDist / bestdistance) * 100;

    text(`ITERATIONS  : ${iterations}`, 30, 35);
    text(`TO VISIT    : ${remainingedges} roads`, 30, 55);
    
    let kmDisplay = (bestdistance === Infinity) ? "0.00" : (bestdistance / 1000).toFixed(2);
    text(`BEST ROUTE  : ${kmDisplay} km`, 30, 75);

    // Color code the efficiency for feedback
    // >85% is excellent (Green), >70% is okay (Yellow), <70% needs work (Red)
    if (efficiency > 85) fill(0, 255, 120); 
    else if (efficiency > 70) fill(255, 230, 0);
    else fill(255, 100, 100);

    textSize(18);
    textStyle(BOLD);
    text(`EFFICIENCY  : ${efficiency.toFixed(1)}%`, 30, 105);
    
    pop();
}

/**
 * Encapsulated Solver Logic
 */
function handleSolverEngine() {
    iterationsperframe = max(1, iterationsperframe - 1 * (5 - frameRate())); 

    for (let it = 0; it < iterationsperframe; it++) {
        iterations++;

       // 1. SORTING: Decides which way to turn
currentnode.edges.sort((a, b) => {
    let capA = a.isDoubled ? 2 : 1;
    let capB = b.isDoubled ? 2 : 1;
    let remainingA = capA - a.travels;
    let remainingB = capB - b.travels;

    // Priority 1: Take roads we haven't finished yet
    if (remainingA !== remainingB) return remainingB - remainingA; 
    
    // Priority 2: If both are "fresh" or both are "done", pick randomly
    // This is the "Engine" that explores new possibilities!
    return Math.random() - 0.5; 
});

        let chosenEdge = currentnode.edges[0];
        // SAFETY: If a node has no edges, we can't move. Stop this iteration.
        if (!chosenEdge) break; 

        let nextNode = chosenEdge.OtherNodeofEdge(currentnode);
        
        // SAFETY: Ensure the next node exists and has coordinates
        if (!nextNode || nextNode.lat === undefined) {
            console.warn("Skipping invalid node/edge connection.");
            break;
        }

        // 2. TRACKING
        let cap = chosenEdge.isDoubled ? 2 : 1;
        if (chosenEdge.travels < cap && chosenEdge.travels === 0) {
            remainingedges--; 
        }
        
        let extraDist = (chosenEdge.travels >= 1) ? chosenEdge.distance : 0;
        chosenEdge.travels++;
        
        // 3. RECORDING
        currentroute.addWaypoint(nextNode, chosenEdge.distance, extraDist);
        currentnode = nextNode;
        
        // 4. COMPLETION
        if (remainingedges <= 0 && currentnode === startnode) { 
            if (currentroute.distance < bestdistance) {
                bestdistance = currentroute.distance;
                bestroute = currentroute; 
                lastRecordTime = millis();
            }

            resetEdges();
            currentnode = startnode;
            remainingedges = edges.length; 
            currentroute = new Route(currentnode, null);
        }
    }
}

/**
 * Handles all Route-related drawing
 */
function renderRouteGraphics() {
    if (bestroute != null) {
        // High-priority: Show the best valid route found so far
        bestroute.show(); 
    } else if (mode === solveRESmode && displayRoute != null) {
        // While solving, show the last completed attempt as a faint "ghost"
        push();
        stroke(255, 120); 
        strokeWeight(2);
        displayRoute.show();
        pop();
    } else if (mode === solveRESmode && currentroute != null) {
        // If no full solution exists yet, show the live "snake"
        push();
        stroke(200, 100);
        strokeWeight(1);
        currentroute.show();
        pop();
    }
}

/**
 * Handles Stats Boxes and Toolbars
 */
function renderUIOverlays() {
    // Solver Active Stats
    if (mode === solveRESmode && bestdistance !== Infinity) {
        let timeLeft = ceil((autoStopThreshold - (millis() - lastRecordTime)) / 1000);
        drawStatsBox(
            "SOLVER ACTIVE", 
            `Best Dist: ${bestdistance.toFixed(2)}km`, 
            `Efficiency: ${(totaledgedistance / bestdistance * 100).toFixed(1)}%`,
            `Auto-stop in: ${max(0, timeLeft)}s`
        );
    }

    // Trimming Mode Stats
    if (mode === trimmode || mode === selectnodemode) {
        let liveDist = getLiveTotalDistance();
        drawStatsBox("ROAD MILEAGE", `${liveDist.toFixed(2)}km`, "Trimming Mode", "");
        drawToolbar();
    }
}
// --- UI HELPER FUNCTIONS ---

function drawStatsBox(title, line1, line2, line3) {
    push();
    fill(0, 180);
    noStroke();
    rect(10, 10, 210, 95, 5); // Increased height to 95
    fill(255);
    textAlign(LEFT, TOP);
    textSize(14);
    textStyle(BOLD);
    text(title, 20, 20);
    textStyle(NORMAL);
    text(line1, 20, 42);
    text(line2, 20, 58);
    text(line3, 20, 74); // The countdown line
    pop();
}

function drawToolbar() {
    push();
    colorMode(HSB); 
    
    // Nav Toggle
    fill(navMode ? 120 : 15, 255, 255); 
    stroke(0); strokeWeight(2);
    rect(width - 160, 10, 150, 40, 5);
    fill(0); noStroke(); textAlign(CENTER, CENTER); textSize(12); textStyle(BOLD);
    text(navMode ? "MODE: PAN/ZOOM" : "MODE: INTERACT", width - 85, 30);
    
    if (mode == trimmode) {
        // Undo
        fill(200, 20, 255); 
        stroke(0); strokeWeight(2);
        rect(width - 320, 10, 150, 40, 5);
        fill(0); noStroke();
        text("UNDO LAST TRIM", width - 245, 30);

        // Start
        fill(120, 255, 255); 
        stroke(0); strokeWeight(2);
        rect(width - 480, 10, 150, 40, 5);
        fill(0); noStroke();
        text("START SOLVER", width - 405, 30);
    }
    pop();
}

function getOverpassData() { 
    showMessage("Loading map data…");
    canvas.position(0, 34); 
    bestroute = null;
    totaledgedistance = 0;
    showRoads = true;
    totaluniqueroads = 0;

    // Get the coordinates from the current map view
    var extent = ol.proj.transformExtent(openlayersmap.getView().calculateExtent(openlayersmap.getSize()), 'EPSG:3857', 'EPSG:4326');
    
    mapminlat = extent[1];
    mapminlon = extent[0];
    mapmaxlat = extent[3];
    mapmaxlon = extent[2];

    // Using a smaller margin to ensure the data matches the visual zoom
    dataminlat = extent[1] + (extent[3] - extent[1]) * margin;
    dataminlon = extent[0] + (extent[2] - extent[0]) * margin;
    datamaxlat = extent[3] - (extent[3] - extent[1]) * margin;
    datamaxlon = extent[2] - (extent[2] - extent[0]) * margin;

    let OverpassURL = "https://overpass-api.de/api/interpreter?data=";

    // This query uses the CityStrides logic to filter for "runnable" named streets only
    let overpassquery = `[out:xml][timeout:30];
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
out;`;

    // Properly encode the query for the URL
    let fullURL = OverpassURL + encodeURIComponent(overpassquery);

    httpGet(fullURL, 'text', true, function (response) {
        var parser = new DOMParser();
        OSMxml = parser.parseFromString(response, "text/xml");
        var XMLnodes = OSMxml.getElementsByTagName("node");
        var XMLways = OSMxml.getElementsByTagName("way");

        // SAFETY: If CityStrides logic returns 0 roads, don't freeze the UI
        if (XMLways.length === 0) {
            showMessage("No named roads found. Zoom out and try again!");
            setTimeout(() => { mode = choosemapmode; showMessage("Zoom to area, then click here"); }, 3000);
            return;
        }

        numnodes = XMLnodes.length;
        numways = XMLways.length;

        for (let i = 0; i < numnodes; i++) {
            var lat = XMLnodes[i].getAttribute('lat');
            var lon = XMLnodes[i].getAttribute('lon');
            minlat = min(minlat, lat);
            maxlat = max(maxlat, lat);
            minlon = min(minlon, lon);
            maxlon = max(maxlon, lon);
        }

        nodes = [];
        edges = [];

        for (let i = 0; i < numnodes; i++) {
            var lat = XMLnodes[i].getAttribute('lat');
            var lon = XMLnodes[i].getAttribute('lon');
            var nodeid = XMLnodes[i].getAttribute('id');
            let node = new Node(nodeid, lat, lon);
            nodes.push(node);
        }

        // Parse ways into edges
        for (let i = 0; i < numways; i++) {
            let wayid = XMLways[i].getAttribute('id');
            let nodesinsideway = XMLways[i].getElementsByTagName('nd');
            for (let j = 0; j < nodesinsideway.length - 1; j++) {
                let fromnode = getNodebyId(nodesinsideway[j].getAttribute("ref"));
                let tonode = getNodebyId(nodesinsideway[j + 1].getAttribute("ref"));
                if (fromnode != null && tonode != null) {
                    let newEdge = new Edge(fromnode, tonode, wayid);
                    edges.push(newEdge);
                    totaledgedistance += newEdge.distance;
                }
            }
        }

        mode = selectnodemode;
        showMessage("Click on start of route");
    }, function (err) {
        console.error("Overpass failed:", err);
        showMessage("Overpass failed. Click here to retry");
        mode = choosemapmode;
    });
}

function showNodes() {
    let closestnodetomousedist = Infinity;
    for (let i = 0; i < nodes.length; i++) {
        let pos = nodes[i].getScreenPos(); // Use the dynamic position
        if (!pos) continue;

        if (showRoads) {
            nodes[i].show();
        }
        
        if (mode == selectnodemode) {
            // Calculate distance based on current screen pixels
            let disttoMouse = dist(pos.x, pos.y, mouseX, mouseY);
            if (disttoMouse < closestnodetomousedist) {
                closestnodetomousedist = disttoMouse;
                closestnodetomouse = i;
            }
        }
    }
    
    if (mode == selectnodemode && closestnodetomouse !== -1) {
        startnode = nodes[closestnodetomouse];
    }
    
    if (startnode != null && (!isTouchScreenDevice || mode != selectnodemode)) {
        startnode.highlight();
    }
}

function showEdges() {
	let closestedgetomousedist = Infinity;
	for (let i = 0; i < edges.length; i++) {
		edges[i].show();
		if (mode == trimmode) {
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
    for (let i = 0; i < edges.length; i++) {
        edges[i].travels = 0;
        // Note: we do NOT reset isDoubled here because that's 
        // part of our "Master Plan" calculated in solveRES()
    }
}
function removeOrphans() { // remove unreachable nodes and edges
	resetEdges();
	currentnode = startnode;
	floodfill(currentnode, 1); // recursively walk every unwalked route until all connected nodes have been reached at least once, then remove unwalked ones.
	let newedges = [];
	let newnodes = [];
	totaledgedistance = 0;
	for (let i = 0; i < edges.length; i++) {
		if (edges[i].travels > 0) {
			newedges.push(edges[i]);
			totaledgedistance += edges[i].distance;
			if (!newnodes.includes(edges[i].from)) {
				newnodes.push(edges[i].from);
			}
			if (!newnodes.includes(edges[i].to)) {
				newnodes.push(edges[i].to);
			}
		}
	}
	edges = newedges;
	nodes = newnodes;
	resetEdges();
}

function floodfill(node, stepssofar) {
	for (let i = 0; i < node.edges.length; i++) {
		if (node.edges[i].travels == 0) {
			node.edges[i].travels = stepssofar;
			floodfill(node.edges[i].OtherNodeofEdge(node), stepssofar + 1);
		}
	}
}

function solveRES() {
    // 1. Initial Cleanup
    removeOrphans();
    resetEdges();
    
    // 2. The Strategy (The "Genius" Math)
    // This identifies the odd nodes and decides which roads to double
    let myOddNodes = getOddDegreeNodes(); 
    let myMatrix = buildOddNodeMatrix(myOddNodes); 
    let optimalPairs = findPairs(myOddNodes, myMatrix); 
    applyDoublings(optimalPairs); // This marks edges with .isDoubled = true

    // 3. UI and State Reset
    showRoads = false; // Hide the blue lines to show the solver trail
    currentnode = startnode; 
    
    // 4. Distance Synchronization
    // Calculate total unique distance ONCE for the efficiency UI
    totalRoadsDist = 0;
    for (let e of edges) {
        totalRoadsDist += e.distance;
    }

    // IMPORTANT: The counter only tracks the first time we hit a road.
    // It must match the number of physical roads, not the doubled ones.
    remainingedges = edges.length; 
    
    // 5. Solver Variables Reset
    currentroute = new Route(currentnode, null);
    bestroute = new Route(currentnode, null);
    bestdistance = Infinity;
    iterations = 0;
    lastRecordTime = millis();
    
    console.log("Solver Initialized:");
    console.log("- Total Unique Distance: " + (totalRoadsDist/1000).toFixed(2) + " km");
    console.log("- Physical Roads to visit: " + remainingedges);
}
function mousePressed() {
  // Ensure the canvas can catch clicks unless we are explicitly in Navigation (Pan/Zoom) mode
  canvas.elt.style.pointerEvents = navMode ? 'none' : 'auto';

  // 1. MODE: CHOOSE MAP (Fetching Overpass Data)
  if (mode == choosemapmode && isInside(mouseX, mouseY, btnTLx, btnTLy, btnBRx, btnBRy)) {
    getOverpassData();
    return;
  }

  // 2. MODE: SELECT START NODE
  if (mode == selectnodemode) {
    // Check if clicking the PAN/ZOOM Toggle (Top Right)
    if (isInside(mouseX, mouseY, width - 160, 10, width - 10, 50)) {
      toggleNav();
      return;
    }

    // If NOT in navMode and clicking the map area, select the node
    if (!navMode && mouseY < mapHeight) {
      showNodes(); // sets 'startnode'
      mode = trimmode;
      navMode = false;
      showMessage('Click roads to trim. Use the top-right button to Pan/Zoom.');
      removeOrphans();
      return;
    }
  }

  // 3. MODE: TRIM ROADS
  if (mode == trimmode) {
    // A. PAN/ZOOM Toggle (Right-most)
    if (isInside(mouseX, mouseY, width - 160, 10, width - 10, 50)) {
      toggleNav();
      return;
    }

    // B. UNDO Button (Middle)
    if (isInside(mouseX, mouseY, width - 320, 10, width - 170, 50)) {
      undoTrim();
      return;
    }

    // C. START SOLVER Button (Left-most)
    if (isInside(mouseX, mouseY, width - 480, 10, width - 330, 50)) {
      mode = solveRESmode;
      navMode = false;
      showMessage('Calculating… Click to stop when satisfied');
      solveRES();
      return;
    }

    // D. Road Trim Logic
    if (!navMode && mouseY < mapHeight) {
      trimSelectedEdge();
    }
  }

  // 4. MODE: SOLVING (Stop Logic)
  if (mode == solveRESmode && isInside(mouseX, mouseY, btnTLx, btnTLy, btnBRx, btnBRy)) {
    finalizeSession();
    return;
  }

  // 5. MODE: DOWNLOAD SUMMARY
  if (mode == downloadGPXmode) {
    // Large "Download Route" button at the bottom of the summary
    if (isInside(mouseX, mouseY, width / 2 - 140, height / 2 + 200, width / 2 + 140, height / 2 + 240)) {
      downloadGPX(); // Use the robust Blob-based downloader
      return;
    }
  }
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
    // 1. Background Panel
    push();
    fill(30, 30, 30, 220); // Darker, more professional semi-transparent gray
    noStroke();
    rectMode(CENTER);
    rect(width / 2, height / 2, 320, 520, 10); // Added rounded corners
    
    // 2. Title Section
    strokeWeight(2);
    stroke(255, 165, 0); // Orange accent line
    line(width / 2 - 140, height / 2 - 200, width / 2 + 140, height / 2 - 200);
    
    noStroke();
    fill(255);
    textSize(28);
    textAlign(CENTER, CENTER);
    textStyle(BOLD);
    text('Route Summary', width / 2, height / 2 - 225);
    pop();

    // 3. Stats Labels and Values
    let labels = ['Total roads covered', 'Total length of all roads', 'Length of final route', 'Efficiency'];
    
    // Ensure we don't divide by zero if bestroute is somehow missing
    let finalDist = (bestroute && bestroute.distance > 0) ? bestroute.distance : 1;
    let efficiency = round(100 * totaledgedistance / finalDist);
    
    let values = [
        totaluniqueroads, 
        nf(totaledgedistance, 0, 1) + "km", 
        nf(finalDist, 0, 1) + "km", 
        efficiency + "%"
    ];

    for (let i = 0; i < 4; i++) {
        let yPos = height / 2 - 150 + (i * 90);
        
        // Label
        fill(200);
        textSize(16);
        textAlign(CENTER);
        text(labels[i], width / 2, yPos);
        
        // Value
        fill(255, 165, 0); // High-contrast Orange
        textSize(42);
        textStyle(BOLD);
        text(values[i], width / 2, yPos + 45);
    }

    // 4. Download Button
    push();
    fill(255, 165, 0); // Orange button
    rectMode(CENTER);
    rect(width / 2, height / 2 + 225, 280, 50, 5);
    
    fill(255);
    textSize(24);
    textStyle(BOLD);
    text('Download Route', width / 2, height / 2 + 233);
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
    mapWidth = windowWidth;
    mapHeight = windowHeight;
    resizeCanvas(windowWidth, windowHeight - 34);
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
