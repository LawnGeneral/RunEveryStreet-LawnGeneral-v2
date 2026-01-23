class Route {
    constructor(startnode, originalroute) {
        if (originalroute == null) { 
            this.waypoints = [];
            this.minlat = Infinity;
            this.maxlat = 0;
            this.minlon = Infinity;
            this.maxlon = 0;
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
        this.waypoints.push(node);
        this.distance += dist;
        this.doublingsup += doublingsup;
        this.minlat = min(this.minlat, node.lat);
        this.maxlat = max(this.maxlat, node.lat);
        this.minlon = min(this.minlon, node.lon);
        this.maxlon = max(this.maxlon, node.lon);
    }

    show() {
        if (this.waypoints.length < 2) return;
        push();
        noFill();
        strokeWeight(5);
        for (let i = 0; i < this.waypoints.length - 1; i++) {
            let from = this.waypoints[i];
            let to = this.waypoints[i + 1];
            let hue = map(i, 0, this.waypoints.length - 1, 0, 155);
            stroke(hue, 255, 255, 0.6);
            line(from.x, from.y, to.x, to.y);
        }
        
        // Mark Start (Yellow) and End (Cyan)
        fill(60, 255, 255); // Yellow
        ellipse(this.waypoints[0].x, this.waypoints[0].y, 15, 15);
        fill(180, 255, 255); // Cyan
        ellipse(this.waypoints[this.waypoints.length - 1].x, this.waypoints[this.waypoints.length - 1].y, 10, 10);
        pop();
    }

    exportGPX() {
        let xmlString = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xmlString += '<gpx version="1.1" creator="GeminiRoute" xmlns="http://www.topografix.com/GPX/1/1">\n';
        xmlString += '  <trk><name>Every Single Street</name><trkseg>\n';
        let now = new Date();
        this.waypoints.forEach((pt, i) => {
            let time = new Date(now.getTime() + i * 10000).toISOString();
            xmlString += `    <trkpt lat="${pt.lat}" lon="${pt.lon}"><ele>0</ele><time>${time}</time></trkpt>\n`;
        });
        xmlString += '  </trkseg></trk>\n</gpx>';
        saveStrings([xmlString], 'route.gpx');
    }
}
