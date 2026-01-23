class Edge { // section of road that connects nodes
  constructor(from_, to_, wayid_) {
    this.wayid = wayid_;
    this.from = from_;
    this.to = to_;
    this.travels = 0;

    this.distance = calcdistance(this.from.lat, this.from.lon, this.to.lat, this.to.lon);

    if (!this.from.edges.includes(this)) this.from.edges.push(this);
    if (!this.to.edges.includes(this)) this.to.edges.push(this);
  }

  // Get current pixel positions for the endpoints
  getPixels() {
    const c1 = ol.proj.fromLonLat([this.from.lon, this.from.lat]);
    const c2 = ol.proj.fromLonLat([this.to.lon, this.to.lat]);
    const p1 = openlayersmap.getPixelFromCoordinate(c1);
    const p2 = openlayersmap.getPixelFromCoordinate(c2);
    return { p1, p2 };
  }

  show() {
    const { p1, p2 } = this.getPixels();
    if (!p1 || !p2) return;

    strokeWeight(min(10, (this.travels + 1) * 2));
    stroke(55, 255, 255, 0.8);
    line(p1[0], p1[1], p2[0], p2[1]);
    fill(0);
    noStroke();
  }

  highlight() {
    const { p1, p2 } = this.getPixels();
    if (!p1 || !p2) return;

    strokeWeight(4);
    stroke(20, 255, 255, 1);
    line(p1[0], p1[1], p2[0], p2[1]);
    fill(0);
    noStroke();
  }

  OtherNodeofEdge(node) {
    if (node == this.from) return this.to;
    return this.from;
  }

  // Better: distance from point to the line segment (in pixels)
  distanceToPoint(x, y) {
    const { p1, p2 } = this.getPixels();
    if (!p1 || !p2) return Infinity;

    const x1 = p1[0], y1 = p1[1];
    const x2 = p2[0], y2 = p2[1];

    const dx = x2 - x1;
    const dy = y2 - y1;
    if (dx === 0 && dy === 0) return dist(x, y, x1, y1);

    const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
    const tt = max(0, min(1, t));

    const projx = x1 + tt * dx;
    const projy = y1 + tt * dy;

    return dist(x, y, projx, projy);
  }
}
