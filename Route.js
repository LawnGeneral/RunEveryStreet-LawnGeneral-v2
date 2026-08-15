class Route {
    constructor(startnode, originalroute) {
        if (originalroute == null) { 
            this.waypoints = [];
            this.minlat = Infinity;
            this.maxlat = -Infinity;
            this.minlon = Infinity;
            this.maxlon = -Infinity;
            if (startnode) this.waypoints.push(startnode);
            this.distance = 0;
            this.doublingsup = 0;
        } else { 
            // Create a new array, but keep the object references for the nodes
            this.waypoints = [...originalroute.waypoints];
            this.minlat = originalroute.minlat;
            this.maxlat = originalroute.maxlat;
            this.minlon = originalroute.minlon;
            this.maxlon = originalroute.maxlon;
            this.distance = originalroute.distance;
            this.doublingsup = originalroute.doublingsup;
        }
    }

    // This replaces the dangerous JSON.parse(JSON.stringify())
    copy() {
        return new Route(null, this);
    }

    addWaypoint(node, dist, doublingsup = 0) {
        if (!node) return;
        this.waypoints.push(node);
        this.distance += dist;
        this.doublingsup += doublingsup;
        
        // Ensure lat/lon are numbers before comparing
        let lat = parseFloat(node.lat);
        let lon = parseFloat(node.lon);
        
        if (!isNaN(lat) && !isNaN(lon)) {
            this.minlat = Math.min(this.minlat, lat);
            this.maxlat = Math.max(this.maxlat, lat);
            this.minlon = Math.min(this.minlon, lon);
            this.maxlon = Math.max(this.maxlon, lon);
        }
    }

show() {
    if (this.waypoints.length < 2) return;

    push();
    colorMode(RGB);
    noFill();

    // One solid blue route line
    stroke(37, 99, 235, 230);
    strokeWeight(6);

    for (let i = 0; i < this.waypoints.length - 1; i++) {
        const fromNode = this.waypoints[i];
        const toNode = this.waypoints[i + 1];

        const p1 = this.getPix(fromNode);
        const p2 = this.getPix(toNode);

        if (p1 && p2) {
            line(p1.x, p1.y, p2.x, p2.y);
        }
    }

    const startNode = this.waypoints[0];
    const endNode =
        this.waypoints[this.waypoints.length - 1];

    const startPix = this.getPix(startNode);
    const endPix = this.getPix(endNode);

    // Green start marker
    if (startPix) {
        fill(34, 197, 94);
        stroke(255);
        strokeWeight(2);
        ellipse(startPix.x, startPix.y, 15, 15);
    }

    // Orange end marker, only when the route is not closed
    if (endPix && endNode !== startNode) {
        fill(249, 115, 22);
        stroke(255);
        strokeWeight(2);
        ellipse(endPix.x, endPix.y, 12, 12);
    }

    pop();
}

    // Helper to get pixels directly from OpenLayers
    getPix(node) {
        if (!node || !node.lat || !node.lon) return null;
        let coords = ol.proj.fromLonLat([parseFloat(node.lon), parseFloat(node.lat)]);
        let pix = openlayersmap.getPixelFromCoordinate(coords);
        if (pix) return { x: pix[0], y: pix[1] };
        return null;
    }

    exportGPX() {
        let xmlString = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xmlString += '<gpx version="1.1" creator="GeminiRoute" xmlns="http://www.topografix.com/GPX/1/1">\n';
        xmlString += '  <trk><name>Every Single Street</name><trkseg>\n';
        let now = new Date();
        this.waypoints.forEach((pt, i) => {
            if (pt.lat && pt.lon) {
                let time = new Date(now.getTime() + i * 10000).toISOString();
                xmlString += `    <trkpt lat="${pt.lat}" lon="${pt.lon}"><ele>0</ele><time>${time}</time></trkpt>\n`;
            }
        });
        xmlString += '  </trkseg></trk>\n</gpx>';
        saveStrings([xmlString], 'route.gpx');
    }
}
