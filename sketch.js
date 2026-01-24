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
    textFont('monospace');

    // --- MATH CHECK ---
    // Both totalRoadsDist and bestdistance are now in meters (e.g., 3838)
    // Efficiency calculation is safe because the units match!
    let efficiency = (bestdistance === Infinity || bestdistance === 0) ? 0 : (totalRoadsDist / bestdistance) * 100;

    text(`ITERATIONS  : ${iterations}`, 30, 35);
    text(`TO VISIT    : ${remainingedges} roads`, 30, 55);
    
    // Convert meters to km for display only
    let kmDisplay = (bestdistance === Infinity) ? "0.00" : (bestdistance / 1000).toFixed(2);
    text(`BEST ROUTE  : ${kmDisplay} km`, 30, 75);

    // Color code the efficiency for feedback
    if (efficiency > 85) fill(0, 255, 120);      // Green
    else if (efficiency > 70) fill(255, 230, 0); // Yellow
    else fill(255, 100, 100);                    // Red

    textSize(18);
    textStyle(BOLD);
    text(`EFFICIENCY  : ${efficiency.toFixed(1)}%`, 30, 105);
    
    pop();
}

/**
 * Encapsulated Solver Logic
 */
function handleSolverEngine() {
    // Dynamic Speed: Keeps the browser from freezing if the frame rate drops
    iterationsperframe = max(1, iterationsperframe - 1 * (5 - frameRate())); 

    for (let it = 0; it < iterationsperframe; it++) {
        iterations++;

        // 1. SMART SORTING: Decides which way to turn
        // This is the "Brain" – it prioritizes unvisited roads and doubled segments
        currentnode.edges.sort((a, b) => {
            let capA = a.isDoubled ? 2 : 1;
            let capB = b.isDoubled ? 2 : 1;
            
            let remainingA = capA - a.travels;
            let remainingB = capB - b.travels;

            // Priority 1: Take roads that haven't reached their "Capacity" yet
            if (remainingA !== remainingB) {
                return remainingB - remainingA; 
            }
            
            // Priority 2: If both are equal, introduce randomness to explore new paths
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

        // 2. PROGRESS TRACKING
        // We only decrement 'remainingedges' the VERY first time we touch a road
        if (chosenEdge.travels === 0) {
            remainingedges--; 
        }
        
        // 3. DISTANCE CALCULATION
        let moveDist = chosenEdge.distance; 
        chosenEdge.travels++;
        
        // 4. RECORDING
        // currentroute.addWaypoint(node, totalDistanceIncrement, extraBacktrackDistance)
        // We track the backtracking specifically for efficiency stats later
        let extraDist = (chosenEdge.travels > 1) ? moveDist : 0;
        currentroute.addWaypoint(nextNode, moveDist, extraDist);
        currentnode = nextNode;
        
        // 5. COMPLETION LOGIC
        // We finish if all roads are visited AND we are close to the start node
        if (remainingedges <= 0) {
            let distToHome = dist(currentnode.lat, currentnode.lon, startnode.lat, startnode.lon);
            
            // Checking for exact match OR very close proximity (0.0001 degrees)
            if (currentnode === startnode || distToHome < 0.0001) { 
                
                if (currentroute.distance < bestdistance) {
                    bestdistance = currentroute.distance;
                    
                    // CLONING: We create a deep copy of the route. 
                    // Otherwise, bestroute would change when currentroute resets!
                    bestroute = JSON.parse(JSON.stringify(currentroute)); 
                    lastRecordTime = millis();
                }

                // RESET: Start a new attempt to see if we can beat the 4.99km record
                resetEdges();
                currentnode = startnode;
                
                // Count how many physical roads exist to reset the counter
                remainingedges = edges.filter(e => e.distance > 0).length; 
                currentroute = new Route(currentnode, null);
            }
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
    // Ensure we are working with a clean, connected graph
    removeOrphans();
    resetEdges();
    
    // 2. The Strategy (The "Genius" Math)
    // Find odd nodes and calculate the shortest paths to pair them up
    let myOddNodes = getOddDegreeNodes(); 
    let myMatrix = buildOddNodeMatrix(myOddNodes); 
    let optimalPairs = findPairs(myOddNodes, myMatrix); 
    applyDoublings(optimalPairs); // Marks edges as .isDoubled = true

    // 3. UI and State Reset
    showRoads = false; // Switch view to the solver's path
    currentnode = startnode; 
    
  // 4. Distance Synchronization & Road Counting
    totalRoadsDist = 0;
    let validRoadsCount = 0;

    for (let e of edges) {
        // DEBUG: Let's see what the first edge looks like if distance is 0
        if (validRoadsCount === 0) console.log("Sample Edge Data:", e);

        // Try every common name for distance just in case
        let d = parseFloat(e.distance) || parseFloat(e.dist) || parseFloat(e.len) || 0;
        
        if (d > 0) {
            totalRoadsDist += d; // Keep this as raw meters!
            validRoadsCount++;
            e.distance = d; // Force it to the correct property for the solver
        }
    }

    // Set the "Finish Line" based on actual physical roads found
    remainingedges = validRoadsCount; 
    
    // 5. Solver Variables Reset
    // We initialize these to start a fresh search for the best circuit
    currentroute = new Route(currentnode, null);
    bestroute = new Route(currentnode, null);
    bestdistance = Infinity;
    iterations = 0;
    lastRecordTime = millis();
    
    // Debugging logs to verify the numbers in the Console (F12)
    console.log("--- SOLVER INITIALIZED ---");
    console.log("Total Unique Distance: " + (totalRoadsDist / 1000).toFixed(2) + " km");
    console.log("Physical Roads to Visit: " + remainingedges);
    console.log("Start Node ID: " + (startnode ? startnode.nodeId : "NOT SET"));
}
function mousePressed() {
  // 1. REPORT / DOWNLOAD MODE
  // We check this first so the download button takes priority over the map
  if (mode === downloadGPXmode) {
    let boxW = 400;
    let boxH = 450;
    let x = width / 2 - boxW / 2;
    let y = height / 2 - boxH / 2;

    let btnW = 300;
    let btnH = 50;
    let btnX = width / 2 - btnW / 2;
    let btnY = y + 350;

    // Check if the click is specifically on the "Download" button
    if (mouseX > btnX && mouseX < btnX + btnW && mouseY > btnY && mouseY < btnY + btnH) {
      generateAndDownloadGPX(bestroute);
      return; 
    }

    // Optional: Click outside the box to close the report
    if (mouseX < x || mouseX > x + boxW || mouseY < y || mouseY > y + boxH) {
      mode = solveRESmode;
      navMode = false;
    }
    return; // Exit after handling the report screen
  }

  // 2. SOLVER MODE (Setting the start node or clicking Start)
  if (mode === solveRESmode) {
    
    // Check if you are clicking the "START" button in the UI
    // Adjust these coordinates to where your Start button actually lives
    if (mouseX > 20 && mouseX < 120 && mouseY > height - 60 && mouseY < height - 20) {
        if (startnode) {
            navMode = !navMode;
            if (navMode) solveRES();
        } else {
            alert("Pick a green start node on the map first!");
        }
        return;
    }

    // If we aren't clicking a button, we are picking a node on the map
    if (!navMode) {
      let closest = getClosestNode(mouseX, mouseY);
      if (closest) {
        startnode = closest;
        currentnode = startnode;
        console.log("Start Node set to: " + startnode.nodeId);
      }
    }
  }
}

/**
 * Helper to check if mouse is over the start/solve button
 * Adjust coordinates based on your specific UI placement
 */
function isOverStartButton(mx, my) {
  // Example: Button is at bottom center
  return (mx > width/2 - 50 && mx < width/2 + 50 && my > height - 60 && my < height - 20);
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
    // 1. Convert mouse pixels to map coordinates (lon/lat)
    // This uses the OpenLayers 'map' object from your index.html
    let coords = map.getCoordinateFromPixel([mx, my]);
    
    if (!coords) return null;

    let closest = null;
    let minDist = Infinity;

    // 2. Search through your nodes array
    // 'nodes' must be the array where you stored your ingested node data
    for (let i = 0; i < nodes.length; i++) {
        let n = nodes[i];
        
        // Use p5.js dist() to find the distance between click and node
        let d = dist(coords[0], coords[1], n.lon, n.lat);
        
        if (d < minDist) {
            minDist = d;
            closest = n;
        }
    }

    // 3. Threshold Check
    // If the click is too far from any node (e.g., clicking in a field), ignore it.
    // 0.001 is roughly 100 meters in coordinate distance.
    if (minDist < 0.001) {
        return closest;
    } else {
        return null;
    }
}
