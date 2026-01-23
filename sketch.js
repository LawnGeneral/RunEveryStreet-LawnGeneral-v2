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
    if (touches.length > 0) isTouchScreenDevice = true;
    clear();
    drawMask();

    if (mode != choosemapmode) {
        if (showRoads) showEdges();

        // --- SOLVER LOGIC ---
        if (mode == solveRESmode) {
            iterationsperframe = max(0.01, iterationsperframe - 1 * (5 - frameRate())); 
            for (let it = 0; it < iterationsperframe; it++) {
                iterations++;
                let solutionfound = false;
                while (!solutionfound) { 
                    shuffle(currentnode.edges, true);
                    currentnode.edges.sort((a, b) => a.travels - b.travels); 
                    let edgewithleasttravels = currentnode.edges[0];
                    let nextNode = edgewithleasttravels.OtherNodeofEdge(currentnode);
                    
                    let extraDist = (edgewithleasttravels.travels > 0) ? edgewithleasttravels.distance : 0;
                    
                    edgewithleasttravels.travels++;
                    currentroute.addWaypoint(nextNode, edgewithleasttravels.distance, extraDist);
                    currentnode = nextNode;
                    
                    if (edgewithleasttravels.travels == 1) remainingedges--; 
                    
                    // RETURN-TO-START LOGIC
                    if (remainingedges == 0 && currentnode == startnode) { 
                        solutionfound = true;
                        if (currentroute.distance < bestdistance) { 
                            bestdistance = currentroute.distance;
                            bestroute = new Route(null, currentroute);
                            efficiencyhistory.push(totaledgedistance / bestroute.distance);
                            distancehistory.push(bestroute.distance);
                        }
                        currentnode = startnode;
                        remainingedges = edges.length;
                        currentroute = new Route(currentnode, null);
                        resetEdges();
                    }
                }
            }
        }

        if (!navMode) showNodes();

        // --- ROUTE VISUALIZATION ---
        if (bestroute != null) {
            bestroute.show(); // Show the solid best route
        } else if (mode == solveRESmode && currentroute != null) {
            // Show "Ghost" route while searching for the first valid loop
            push();
            stroke(255, 100); 
            strokeWeight(2);
            currentroute.show();
            pop();
        }

        if (mode == downloadGPXmode) showReportOut();

        // --- UI OVERLAYS ---

        // 1. SOLVER STATS (Top Left - Only while solving)
        if (mode == solveRESmode && bestdistance != Infinity) {
            drawStatsBox("SOLVER ACTIVE", `Best Dist: ${bestdistance.toFixed(2)}km`, `Efficiency: ${(totaledgedistance / bestdistance * 100).toFixed(1)}%`);
        }

        // 2. LIVE ROAD MILEAGE (Top Left - Only while trimming/selecting)
        if (mode == trimmode || mode == selectnodemode) {
            let liveDist = getLiveTotalDistance();
            drawStatsBox("ROAD MILEAGE", `${liveDist.toFixed(2)}km`, "Trimming Mode");

            // 3. EDITING TOOLBAR (Top Right)
            drawToolbar();
        }
    }
}

// --- UI HELPER FUNCTIONS ---

function drawStatsBox(title, line1, line2) {
    push();
    fill(0, 180);
    noStroke();
    rect(10, 10, 200, 75, 5);
    fill(255);
    textAlign(LEFT, TOP);
    textSize(14);
    textStyle(BOLD);
    text(title, 20, 20);
    textStyle(NORMAL);
    text(line1, 20, 42);
    text(line2, 20, 58);
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
    removeOrphans();
    resetEdges(); // Clear any previous travel counts from the roads
    showRoads = false;
    
    currentnode = startnode; // Ensure we start where you clicked
    remainingedges = edges.length;
    
    currentroute = new Route(currentnode, null);
    bestroute = new Route(currentnode, null);
    
    bestdistance = Infinity;
    iterations = 0;
    iterationsperframe = 1;
    starttime = millis();
    
    // Clear history for the new run
    efficiencyhistory = [];
    distancehistory = [];
}

function mousePressed() {
  // Ensure the canvas is "solid" by default so we can catch button clicks
  if (!navMode) {
    canvas.elt.style.pointerEvents = 'auto';
  }

  // 1. MODE: CHOOSE MAP (Fetching Overpass Data)
  if (mode == choosemapmode && mouseY < btnBRy && mouseY > btnTLy && mouseX > btnTLx && mouseX < btnBRx) {
    getOverpassData();
    return;
  }

  // 2. MODE: SELECT START NODE
  if (mode == selectnodemode) {
    // Check if clicking the PAN/ZOOM Toggle (Top Right)
    if (mouseX > width - 160 && mouseX < width - 10 && mouseY > 10 && mouseY < 50) {
      navMode = !navMode;
      canvas.elt.style.pointerEvents = navMode ? 'none' : 'auto';
      return;
    }

    // If NOT in navMode and clicking the map area, select the node
    if (!navMode && mouseY < mapHeight) {
      showNodes(); // This finds the node closest to mouse and sets 'startnode'
      mode = trimmode; // Move to the next stage
      navMode = false; // Reset to trim mode so user can start editing immediately
      canvas.elt.style.pointerEvents = 'auto';
      showMessage('Click roads to trim. Use the top-right button to Pan/Zoom.');
      removeOrphans();
      return;
    }
  }

  // 3. MODE: TRIM ROADS
  if (mode == trimmode) {
    // A. PAN/ZOOM Toggle (Right-most)
    if (mouseX > width - 160 && mouseX < width - 10 && mouseY > 10 && mouseY < 50) {
      navMode = !navMode;
      canvas.elt.style.pointerEvents = navMode ? 'none' : 'auto';
      return;
    }

    // B. UNDO Button (Middle)
    if (mouseX > width - 320 && mouseX < width - 170 && mouseY > 10 && mouseY < 50) {
      undoTrim();
      return;
    }

    // C. START SOLVER Button (Left-most)
    if (mouseX > width - 480 && mouseX < width - 330 && mouseY > 10 && mouseY < 50) {
      mode = solveRESmode;
      navMode = false;
      canvas.elt.style.pointerEvents = 'auto';
      showMessage('Calculating… Click to stop when satisfied');
      solveRES();
      return;
    }

    // D. Perform Road Trim (Only if not in navMode and clicking map area)
    if (!navMode && mouseY < mapHeight) {
      trimSelectedEdge();
    }
  }

  // 4. MODE: SOLVING (Stop Logic)
  // Note: Keeping your original coordinates here as this button usually appears 
  // at the bottom during the solving phase.
  if (mode == solveRESmode) {
    if (mouseY < btnBRy && mouseY > btnTLy && mouseX > btnTLx && mouseX < btnBRx) {
      mode = downloadGPXmode;
      hideMessage();
      
      // Calculate final stats
      let uniqueways = [];
      for (let i = 0; i < edges.length; i++) {
        if (!uniqueways.includes(edges[i].wayid)) {
          uniqueways.push(edges[i].wayid);
        }
      }
      totaluniqueroads = uniqueways.length;
      return;
    }
  }

  // 5. MODE: DOWNLOAD
  if (mode == downloadGPXmode) {
    if (mouseY < height / 2 + 200 + 40 && mouseY > height / 2 + 200 && 
        mouseX > width / 2 - 140 && mouseX < width / 2 - 140 + 280) {
      bestroute.exportGPX();
      return;
    }
  }
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

	fill(250,255,0,0.6);
	noStroke();
	rect(width/2-150,height/2-250,300,500);
	fill(250,255,0,0.15);
	rect(width/2-147,height/2-247,300,500);
	strokeWeight(1);
	stroke(20,255,255,0.8);
	line(width/2-150,height/2-200,width/2+150,height/2-200);
	noStroke();
	fill(0,0,255,1);
	textSize(28);
	textAlign(CENTER);
	text('Route Summary',width/2,height/2-215);
	fill(0,0,255,0.75);
	textSize(16);
	text('Total roads covered',width/2,height/2-170+0*95);
	text('Total length of all roads',width/2,height/2-170+1*95);
	text('Length of final route',width/2,height/2-170+2*95);
	text('Efficiency',width/2,height/2-170+3*95);

	textSize(36);
	fill(20,255,255,1);
	text(totaluniqueroads,width/2,height/2-120+0*95);
	text(nf(totaledgedistance, 0, 1) + "km",width/2,height/2-120+1*95);
	text(nf(bestroute.distance, 0, 1) + "km",width/2,height/2-120+2*95);
	text(round(100 * totaledgedistance / bestroute.distance) + "%",width/2,height/2-120+3*95);

	fill(20,255,100,0.75);
	rect(width/2-140,height/2+200,280,40);
	fill(0,0,255,1);
	textSize(28);
	text('Download Route',width/2,height/2+230);
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
