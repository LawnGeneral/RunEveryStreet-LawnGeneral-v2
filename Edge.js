class Edge { 
    constructor(from_, to_, wayid_) {
        this.wayid = wayid_;
        this.from = from_;
        this.to = to_;
        this.travels = 0;
        this.isDoubled = false; 

        // calculate distance using the Haversine formula (meters)
        this.distance = this.calculateRealDistance(this.from, this.to);

        if (!this.from.edges.includes(this)) {
            this.from.edges.push(this);
        }
        if (!this.to.edges.includes(this)) {
            this.to.edges.push(this);
        }
    }

    // New helper method to ensure distance is NEVER zero
    calculateRealDistance(nodeA, nodeB) {
        const R = 6371000; // Radius of the Earth in meters
        const dLat = (nodeB.lat - nodeA.lat) * Math.PI / 180;
        const dLon = (nodeB.lon - nodeA.lon) * Math.PI / 180;
        const a = 
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(nodeA.lat * Math.PI / 180) * Math.cos(nodeB.lat * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const d = R * c; 
        
        return d > 0 ? d : 0.1; // Fallback to 0.1m so it's never exactly zero
    }
    
    // ... rest of your show() and highlight() methods ...
}
