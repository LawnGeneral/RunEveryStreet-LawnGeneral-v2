class Route {
    constructor(startnode, originalroute) {
        if (originalroute == null) { 
            this.waypoints = [];
            this.minlat = Infinity;
            this.maxlat = -Infinity; // Changed from 0 to -Infinity for correct math
            this.minlon = Infinity;
            this.maxlon = -Infinity; // Changed from 0 to -Infinity for correct math
            if (startnode) this.waypoints.push(startnode);
            this.distance = 0;
            this.doublingsup = 0;
        } else { 
            this.waypoints = [...originalroute.waypoints];
            this.minlat = originalroute.minlat;
            this.maxlat = originalroute.maxlat;
            this.minlon = originalroute.minlon;
            this.maxlon = originalroute.maxlon;
            this.distance = originalroute.distance;
            this.doublingsup = originalroute.doublingsup;
        }
    }

    addWaypoint(node, dist, doublingsup = 0) {
        if (!node) return; // Safety check
        this.waypoints.push(node);
        this.distance += dist;
        this.doublingsup += doublingsup;
        
        // Update bounds for GPX/viewing
        if (node.lat !== undefined) {
            this.minlat = min(this.minlat, node.lat);
            this.maxlat = max(this.maxlat, node.lat);
            this.minlon = min(this.minlon, node.lon);
            this.maxlon = max(this.maxlon, node.lon);
        }
    }

    show() {
        if (this.waypoints.length < 2) return;
        
        push();
        noFill();
        strokeWeight(5);
        
        for (let i = 0; i < this.waypoints.length - 1; i++) {
            let fromNode = this.waypoints[i];
            let toNode = this.waypoints[i + 1];

            // --- THE CRITICAL FIX ---
            // Instead of using node.x, use getScreenPos() to ensure 
            // the coordinates match the current map zoom/pan.
            let p1 = fromNode.getScreenPos ? fromNode.getScreenPos() : {x: fromNode.x, y: fromNode.y};
            let p2 = toNode.getScreenPos ? toNode.getScreenPos() : {x: toNode.x, y: toNode.y};

            // Only draw if both points are valid numbers
            if (p1 && p2 && !isNaN(p1.x) && !isNaN(p2.x)) {
                let hue = map(i, 0, this.waypoints.length - 1, 0, 155);
                stroke(hue, 255, 255, 0.6);
                line(p1.x, p1.y, p2.x, p2.y);
            }
        }
        
        // Mark Start (Yellow) and End (Cyan) with same safety check
        let start = this.waypoints[0].getScreenPos ? this.waypoints[0].getScreenPos() : this.waypoints[0];
        let end = this.waypoints[this.waypoints.length - 1].getScreenPos ? this.waypoints[this.waypoints.length - 1].getScreenPos() : this.waypoints[this.waypoints.length - 1];

        if (start && !isNaN(start.x)) {
            fill(60, 255, 255); 
            ellipse(start.x, start.y, 15, 15);
        }
        if (end && !isNaN(end.x)) {
            fill(180, 255, 255); 
            ellipse(end.x, end.y, 10, 10);
        }
        pop();
    }

    exportGPX() {
        let xmlString = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xmlString += '<gpx version="1.1" creator="GeminiRoute" xmlns="http://www.topografix.com/GPX/1/1">\n';
        xmlString += '  <trk><name>Every Single Street</name><trkseg>\n';
        let now = new Date();
        this.waypoints.forEach((pt, i) => {
            if (pt.lat && pt.lon) { // Only export valid coordinates
                let time = new Date(now.getTime() + i * 10000).toISOString();
                xmlString += `    <trkpt lat="${pt.lat}" lon="${pt.lon}"><ele>0</ele><time>${time}</time></trkpt>\n`;
            }
        });
        xmlString += '  </trkseg></trk>\n</gpx>';
        saveStrings([xmlString], 'route.gpx');
    }
}
