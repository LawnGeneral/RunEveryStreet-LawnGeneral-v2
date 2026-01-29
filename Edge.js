class Edge { 
  constructor(from_, to_, wayid_, wayName_ = "", wayRef_ = "") {
    this.wayid = wayid_;
    this.name = wayName_ || "";   // e.g., "Main St"
    this.ref = wayRef_ || "";     // e.g., "PA 23" (optional)
    this.from = from_;
    this.to = to_;
    this.travels = 0;
    this.isDoubled = false;

    // --- Integrated Distance Calculation ---
    if (this.from && this.to) {
      const R = 6371000; // meters
      const dLat = (this.to.lat - this.from.lat) * Math.PI / 180;
      const dLon = (this.to.lon - this.from.lon) * Math.PI / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(this.from.lat * Math.PI / 180) *
        Math.cos(this.to.lat * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      this.distance = R * c;
    } else {
      this.distance = 0;
    }

    // Add this edge to the nodes' adjacency lists
    if (this.from && !this.from.edges.includes(this)) this.from.edges.push(this);
    if (this.to && !this.to.edges.includes(this)) this.to.edges.push(this);
  }

  show() {
    let p1 = this.from ? this.from.getScreenPos() : null;
    let p2 = this.to ? this.to.getScreenPos() : null;

    if (p1 && p1.x !== undefined && p2 && p2.x !== undefined) {
      push();
      colorMode(RGB);

      if (this.isDoubled) {
        stroke(255, 0, 255, 180);
        strokeWeight(6);
      } else {
        stroke(255, 255, 0, 150);
        strokeWeight(min(10, (this.travels + 1) * 2));
      }

      line(p1.x, p1.y, p2.x, p2.y);
      pop();
    }
  }

  OtherNodeofEdge(node) {
    return (node === this.from) ? this.to : this.from;
  }

  distanceToPoint(x, y) {
    let p1 = this.from ? this.from.getScreenPos() : null;
    let p2 = this.to ? this.to.getScreenPos() : null;
    if (p1 && p2) return dist(x, y, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
    return Infinity;
  }
}
